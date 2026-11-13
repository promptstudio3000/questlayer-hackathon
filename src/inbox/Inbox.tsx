// The encrypted player inbox (docs/PLAYER-INBOX.md). Mounted once the
// explorer account is ready. Opens on `questlayer:inbox-open` (detail
// { playerId, name } for one conversation, none for the list) and shows a
// small envelope when something new arrived.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, EnvelopeSimple, LockSimple, PaperPlaneRight, X } from "@phosphor-icons/react";
import { api } from "../api";
import { tr } from "../i18n";
import { Dialog } from "../Dialog";
import type { NativeSigner } from "../native-signer";
import type { Player } from "../types";
import { INBOX_MAX_CHARS, validInboxText } from "../../server/inbox/crypto.mjs";
import {
  ensureInboxKey,
  openInboxMessages,
  reportInboxMessage,
  sendInboxMessage,
  type InboxKeyState,
  type InboxOverview,
  type InboxThread,
  type OpenedMessage,
} from "./client";
import "./inbox.css";

export const INBOX_OPEN_EVENT = "questlayer:inbox-open";
const REASONS: [string, () => string][] = [
  ["spam", () => tr("Spam")],
  ["harassment", () => tr("Harassment")],
  ["privacy", () => tr("Shares personal details")],
  ["other", () => tr("Something else")],
];
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Inbox({ signer, player }: { signer: NativeSigner; player: Player }) {
  const [summary, setSummary] = useState({ unread: 0, requests: 0 });
  const [view, setView] = useState<null | { list: true } | { playerId: string; name: string }>(null);
  const [key, setKey] = useState<InboxKeyState | null>(null);
  const [keyError, setKeyError] = useState("");
  const setup = useRef<Promise<unknown> | null>(null);

  const refresh = useCallback(() => {
    api<{ unread: number; requests: number; enabled?: boolean }>("/inbox/summary")
      .then((r) => setSummary({ unread: r.unread || 0, requests: r.requests || 0 }))
      .catch(() => {});
  }, []);
  const prepareKey = useCallback(
    (rotate = false) => {
      if (setup.current && !rotate) return setup.current;
      setKeyError("");
      setup.current = ensureInboxKey(signer, player.id, rotate)
        .then((k) => {
          setKey(k);
          // Not on chain yet: the next refresh tries again.
          if (!k.published && !k.elsewhere) setup.current = null;
        })
        .catch((e: Error) => {
          setup.current = null;
          setKeyError(e.message);
        });
      return setup.current;
    },
    [signer, player.id],
  );
  // Quietly publish the inbox key so others can write; no popup, no fee.
  useEffect(() => {
    void prepareKey();
    refresh();
    const timer = setInterval(() => {
      refresh();
      void prepareKey();
    }, 30000);
    return () => clearInterval(timer);
  }, [prepareKey, refresh]);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ playerId?: string; name?: string } | undefined>).detail;
      setView(detail?.playerId ? { playerId: detail.playerId, name: detail.name || tr("Explorer") } : { list: true });
    };
    window.addEventListener(INBOX_OPEN_EVENT, open);
    return () => window.removeEventListener(INBOX_OPEN_EVENT, open);
  }, []);
  const close = () => {
    setView(null);
    refresh();
  };
  const fresh = summary.unread + summary.requests;
  return (
    <>
      {fresh > 0 && !view && (
        <button className="inbox-pill" onClick={() => setView({ list: true })} aria-label={tr("Messages: {0} new", { 0: fresh })}>
          <EnvelopeSimple size={20} weight="fill" aria-hidden="true" />
          <span>{fresh}</span>
        </button>
      )}
      {view && (
        <Dialog label={tr("Messages")} onClose={close}>
          <div className="inbox">
            {"list" in view ? (
              <InboxList onOpen={(playerId, name) => setView({ playerId, name })} onClose={close} />
            ) : (
              <Conversation
                key={view.playerId}
                signer={signer}
                player={player}
                peerId={view.playerId}
                peerName={view.name}
                ownKey={key}
                keyError={keyError}
                onSetupHere={() => void prepareKey(true)}
                onBack={() => setView({ list: true })}
                onClose={close}
              />
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Header({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose: () => void }) {
  return (
    <header className="inbox-header">
      {onBack && (
        <button className="inbox-icon" onClick={onBack} aria-label={tr("All messages")}>
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
      )}
      <h2>{title}</h2>
      <button className="inbox-icon" onClick={onClose} aria-label={tr("Close")}>
        <X size={22} aria-hidden="true" />
      </button>
    </header>
  );
}

function InboxList({ onOpen, onClose }: { onOpen: (playerId: string, name: string) => void; onClose: () => void }) {
  const [data, setData] = useState<InboxOverview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<InboxOverview>("/inbox").then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  const answer = async (playerId: string, accept: boolean) => {
    try {
      await api("/inbox/answer", { playerId, accept });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const chats = data?.conversations?.filter((c) => c.state !== "incoming") ?? [];
  return (
    <>
      <Header title={tr("Messages")} onClose={onClose} />
      <p className="inbox-note">
        <LockSimple size={16} aria-hidden="true" /> {tr("End-to-end encrypted. Only you and the other explorer can read a message.")}
      </p>
      {error && <p role="alert">{error}</p>}
      {data?.enabled === false && <p>{tr("Messages are switched off right now.")}</p>}
      {!!data?.incoming?.length && (
        <section>
          <h3>{tr("Requests")}</h3>
          <ul className="inbox-rows">
            {data.incoming.map((r) => (
              <li key={r.id}>
                <span>{tr("{0} wants to message you.", { 0: r.name })}</span>
                <div className="inbox-actions">
                  <button className="primary" onClick={() => void answer(r.id, true)}>
                    {tr("Accept")}
                  </button>
                  <button onClick={() => void answer(r.id, false)}>{tr("Decline")}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data && (
        <section>
          <h3>{tr("Conversations")}</h3>
          {chats.length ? (
            <ul className="inbox-rows">
              {chats.map((c) => (
                <li key={c.playerId}>
                  <button className="inbox-row" onClick={() => onOpen(c.playerId, c.name)}>
                    <strong>{c.name}</strong>
                    <span>
                      {c.state === "requested"
                        ? tr("Request sent")
                        : c.unread
                          ? tr("{0} new", { 0: c.unread })
                          : time(c.lastAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{tr("No conversations yet. Tap an explorer on the map and choose Write a message.")}</p>
          )}
        </section>
      )}
    </>
  );
}

function Conversation({
  signer,
  player,
  peerId,
  peerName,
  ownKey,
  keyError,
  onSetupHere,
  onBack,
  onClose,
}: {
  signer: NativeSigner;
  player: Player;
  peerId: string;
  peerName: string;
  ownKey: InboxKeyState | null;
  keyError: string;
  onSetupHere: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<InboxThread | null>(null);
  const [texts, setTexts] = useState<Record<string, OpenedMessage>>({});
  const asked = useRef(new Set<string>());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [reporting, setReporting] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const list = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    try {
      const t = await api<InboxThread>(`/inbox/thread?playerId=${encodeURIComponent(peerId)}`);
      setThread(t);
      const missing = t.messages.filter((m) => m.state === "delivered" && !asked.current.has(m.id));
      if (missing.length) {
        for (const m of missing) asked.current.add(m.id);
        const opened = await openInboxMessages(missing.map((m) => ({ sender: m.sender, recipient: m.recipient, messageId: m.id })));
        // A record not yet readable on chain is asked again on the next poll.
        for (const o of opened) if (o.error === "pending") asked.current.delete(o.messageId);
        setTexts((now) => ({
          ...now,
          ...Object.fromEntries(opened.filter((o) => o.error !== "pending" && !now[o.messageId]?.text).map((o) => [o.messageId, o])),
        }));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [peerId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length, Object.keys(texts).length]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    act(async () => {
      const peer = thread?.peer;
      if (!peer?.accountId) throw Error(tr("This explorer has not opened their inbox yet."));
      const text = draft;
      const r = await sendInboxMessage(signer, player.id, { id: peer.id, accountId: peer.accountId }, text);
      setTexts((now) => ({ ...now, [r.messageId]: { messageId: r.messageId, text } }));
      setDraft("");
      setStatus(r.state === "delivered" ? tr("Sent and stored on NEAR.") : tr("Sent. Waiting for NEAR to confirm."));
    });
  const report = (messageId: string, reason: string) =>
    act(async () => {
      const m = thread?.messages.find((x) => x.id === messageId);
      if (!m) return;
      const r = await reportInboxMessage({ sender: m.sender, recipient: m.recipient, messageId }, reason);
      setReporting(null);
      setStatus(r.verified ? tr("Reported. A moderator can read this one message.") : tr("Reported."));
    });
  const block = () =>
    act(async () => {
      const r = await fetch("/api/social/blocks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPlayerId: peerId }),
      });
      if (!r.ok) throw Error((await r.json()).error || tr("Could not block."));
      window.dispatchEvent(new Event("questlayer:social-blocks"));
      onBack();
    });

  const name = thread?.peer.name || peerName;
  const state = thread?.state;
  const left = INBOX_MAX_CHARS - [...draft].length;
  const keyReady = !!ownKey?.published;
  return (
    <>
      <Header title={name} onBack={onBack} onClose={onClose} />
      <p className="inbox-note">
        <LockSimple size={16} aria-hidden="true" /> {tr("Encrypted on your device and stored on NEAR. Nobody else can read it, not even QuestLayer.")}
      </p>
      {error && <p role="alert">{error}</p>}
      {keyError && <p role="alert">{keyError}</p>}
      {ownKey?.elsewhere && (
        <div className="inbox-callout">
          <p>{tr("Your inbox is set up on another device. Messages sent there can only be read there.")}</p>
          <button onClick={onSetupHere}>{tr("Use this device for new messages")}</button>
        </div>
      )}
      {thread && (
        <ol className="inbox-messages" ref={list} aria-live="polite">
          {thread.messages.map((m) => {
            const o = texts[m.id];
            return (
              <li key={m.id} className={m.mine ? "mine" : "theirs"}>
                <p>
                  {o?.text ??
                    (o?.error === "other-device"
                      ? tr("Sent to your inbox on another device.")
                      : o?.error === "unreadable"
                        ? tr("This message could not be opened.")
                        : m.state === "pending"
                          ? tr("Sending…")
                          : tr("Opening…"))}
                </p>
                <small>
                  {time(m.at)}
                  {m.mine && m.state === "pending" ? ` · ${tr("waiting for NEAR")}` : ""}
                </small>
                {!m.mine && o?.text && (
                  reporting === m.id ? (
                    <div className="inbox-report">
                      {REASONS.map(([value, label]) => (
                        <button key={value} disabled={busy} onClick={() => void report(m.id, value)}>
                          {label()}
                        </button>
                      ))}
                      <button onClick={() => setReporting(null)}>{tr("Cancel")}</button>
                    </div>
                  ) : (
                    <button className="inbox-link" onClick={() => setReporting(m.id)}>
                      {tr("Report")}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ol>
      )}
      {thread && !thread.messages.length && state === "open" && <p>{tr("Say hello. Messages have up to 500 characters.")}</p>}
      {status && <p role="status">{status}</p>}
      {thread?.muted && <p role="alert">{tr("Your messages are paused while a moderator reviews reports.")}</p>}
      {state === "open" && !thread?.muted && (
        <form
          className="inbox-compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && validInboxText(draft) && keyReady) void send();
          }}
        >
          <label htmlFor="inbox-draft">{tr("Message to {0}", { 0: name })}</label>
          <textarea
            id="inbox-draft"
            value={draft}
            maxLength={INBOX_MAX_CHARS * 2}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby="inbox-left"
          />
          <div className="inbox-actions">
            <small id="inbox-left" className={left < 0 ? "over" : ""}>
              {tr("{0} characters left", { 0: left })}
            </small>
            <button className="primary" disabled={busy || !validInboxText(draft) || !keyReady || !thread?.peer.inbox}>
              <PaperPlaneRight size={18} aria-hidden="true" /> {tr("Send")}
            </button>
          </div>
          {!thread?.peer.inbox && <p>{tr("This explorer has not opened their inbox yet.")}</p>}
          {!keyReady && !ownKey?.elsewhere && !keyError && <p>{tr("Setting up your inbox…")}</p>}
        </form>
      )}
      {(state === "none" || state === "declined") && (
        <div className="inbox-callout">
          <p>{tr("Ask {0} first. They decide whether you may write. When you are within 1 km of each other, you can write right away.", { 0: name })}</p>
          <button className="primary" disabled={busy || state === "declined"} onClick={() => void act(() => api("/inbox/request", { playerId: peerId }))}>
            {tr("Ask to message")}
          </button>
          {state === "declined" && <p>{tr("{0} declined your request.", { 0: name })}</p>}
        </div>
      )}
      {state === "requested" && <p className="inbox-callout">{tr("Request sent. You can write once {0} accepts.", { 0: name })}</p>}
      {state === "incoming" && (
        <div className="inbox-callout">
          <p>{tr("{0} wants to message you.", { 0: name })}</p>
          <div className="inbox-actions">
            <button className="primary" disabled={busy} onClick={() => void act(() => api("/inbox/answer", { playerId: peerId, accept: true }))}>
              {tr("Accept")}
            </button>
            <button disabled={busy} onClick={() => void act(() => api("/inbox/answer", { playerId: peerId, accept: false }))}>
              {tr("Decline")}
            </button>
          </div>
        </div>
      )}
      {thread && (
        <div className="inbox-actions inbox-footer">
          {confirmBlock ? (
            <>
              <button className="danger" disabled={busy} onClick={() => void block()}>
                {tr("Block {0}", { 0: name })}
              </button>
              <button onClick={() => setConfirmBlock(false)}>{tr("Cancel")}</button>
            </>
          ) : (
            <button className="danger" onClick={() => setConfirmBlock(true)}>
              {tr("Block")}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// Encounter sheet for a roaming NPC: 3D portrait, speech bubble, the offer
// buttons the server computed (they always work without AI), a short chat
// box and the player's open tasks from this character, with turn-in.
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import LockedChip, { OPEN_STAKE_EVENT } from "./LockedChip";
import type { ActorEncounter, ActorOffer } from "./actor-types";
import {
  keeperView,
  npcAccept,
  npcGreet,
  npcTalk,
  npcTurnIn,
  tradeAccept,
  tradeUpComplete,
  type KeeperView,
  type NpcActiveLine,
  type NpcReply,
  type NpcTrade,
} from "./npc-client";
import "./npc-sheet.css";

const EMOTE: Record<string, string> = { wave: "👋", think: "🤔", laugh: "😄", shrug: "🤷", none: "" };
const isTrade = (offer: ActorOffer) => offer.kind.startsWith("trade_");
const near = (yocto: string) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toFixed(3);

function tradeText(t: NpcTrade, who: string) {
  if (t.kind === "trade_up")
    return t.state === "completed"
      ? `Done. ${t.aura ? `${t.aura.name} (${t.aura.rarity}) is yours; secure it on NEAR from your wardrobe.` : ""}${t.ledgerAura ? ` ${who} also hands you the ${t.ledgerAura.name}.` : ""}`
      : `Send ${t.tokens?.join(", ")} to ${t.receiver} (wardrobe → transfer), then tap "Check hand-over". The deal stays open 30 minutes.`;
  const minutes = Math.max(1, Math.round((t.deadlineMs - Date.now()) / 60000));
  return t.kind === "trade_buy"
    ? `${who} signed a buy order: ${near(t.price)} test NEAR for ${t.tokenId}. Open Market → Signed offers and tap "Hand to the market and accept" within ${minutes} min.`
    : `${who} signed a sell order: ${t.tokenId} for ${near(t.price)} test NEAR. Open Market → Signed offers and buy it within ${minutes} min.`;
}

function Portrait({ model, label }: { model: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose: (() => void) | undefined, cancelled = false;
    import("./actor-models").then(({ createActorScene }) => {
      if (!cancelled && host.current) dispose = createActorScene(host.current, model, { label }).dispose;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [model, label]);
  return <div className="npc-portrait" ref={host} />;
}

export default function NpcSheet({ actorId, encounter, onClose }: { actorId: string; encounter: ActorEncounter; onClose: () => void }) {
  const [reply, setReply] = useState<NpcReply | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trades, setTrades] = useState<Record<string, NpcTrade>>({});
  const [vault, setVault] = useState<KeeperView | null>(null);
  const token = encounter.encounter;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    run(async () => setReply(await npcGreet(actorId, token)));
    if (encounter.actor.archetype === "keeper") keeperView(actorId, token).then(setVault, () => setVault(null));
  }, [actorId, token]);
  const refresh = async () => setReply(await npcGreet(actorId, token));
  const accept = (offer: ActorOffer) =>
    run(async () => {
      if (isTrade(offer)) {
        const t = await tradeAccept(actorId, token, offer.id);
        setTrades((all) => ({ ...all, [offer.id]: t }));
        setNotice(tradeText(t, reply?.npc?.name || encounter.actor.name));
        return;
      }
      await npcAccept(actorId, token, offer.id);
      setNotice(`Task accepted: ${offer.label}`);
      await refresh();
    });
  const turnIn = (line: NpcActiveLine) =>
    run(async () => {
      const r = await npcTurnIn(actorId, token, line.offerId);
      setNotice(
        r.replay
          ? "Already turned in."
          : `+${r.xp} XP${r.aura ? ` and ${r.aura.name} (${r.aura.rarity}). Secure it on NEAR from your wardrobe.` : "."}${r.note ? ` ${r.note}` : ""}`,
      );
      await refresh();
    });
  const handOver = (offerId: string) =>
    run(async () => {
      const t = await tradeUpComplete(actorId, token, offerId);
      setTrades((all) => ({ ...all, [offerId]: t }));
      setNotice(tradeText(t, reply?.npc?.name || encounter.actor.name));
    });
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    run(async () => {
      const r = await npcTalk(actorId, token, text);
      setReply((old) => ({ ...r, npc: r.npc ?? old?.npc }));
      setMessage("");
    });
  };
  const name = reply?.npc?.name || encounter.actor.name;
  const suggested = reply?.offer?.id;
  return (
    <Dialog label={`Talk to ${name}`} onClose={onClose}>
      <div className="npc-sheet">
        <header className="npc-head">
          <Portrait model={encounter.actor.model} label={name} />
          <div>
            <h2>{name}</h2>
            {(reply?.npc?.title || encounter.actor.title) && <p className="npc-title">{reply?.npc?.title || encounter.actor.title}</p>}
            <p className="npc-source">{reply?.source && reply.source !== "template" ? "AI voice · answers from game data only" : "Standard replies"}</p>
          </div>
          <button type="button" className="npc-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="npc-bubble" aria-live="polite">
          {reply ? `${EMOTE[reply.emote] || ""} ${reply.say}`.trim() : "…"}
        </p>
        {reply?.note && <p className="npc-note">{reply.note}</p>}
        {!!reply?.active.length && (
          <section aria-label="Your tasks">
            <h3>Your tasks</h3>
            {reply.active.map((line) => {
              const ready = line.steps.every((s) => s.done);
              return (
                <div className="npc-task" key={line.offerId}>
                  <p>{line.label}</p>
                  <ul>
                    {line.steps.map((s) => (
                      <li key={s.questId} className={s.done ? "done" : ""}>
                        {s.done ? "✓" : "○"} {s.title}
                        {s.zone ? ` · ${s.zone}` : ""}
                      </li>
                    ))}
                  </ul>
                  <button type="button" disabled={busy || !ready} onClick={() => turnIn(line)}>
                    {ready ? `Turn in for ${line.xp} XP${line.aura ? " + Aura" : ""}` : "Finish the stops, then come back"}
                  </button>
                </div>
              );
            })}
          </section>
        )}
        {!!reply?.menu.length && (
          <section aria-label="Offers">
            <h3>Offers</h3>
            {reply.menu.map((offer) => (
              <button
                type="button"
                key={offer.id}
                className={`npc-offer${offer.id === suggested ? " suggested" : ""}`}
                disabled={busy}
                onClick={() => accept(offer)}
              >
                <span>{offer.label}</span>
                <small>
                  {isTrade(offer)
                    ? trades[offer.id]
                      ? "Signed · see below"
                      : offer.kind === "trade_up"
                        ? "3 commons → 1 rare"
                        : "Signed order on the testnet market"
                    : `${String((offer.terms as { xp?: number }).xp ?? "")} XP${(offer.terms as { aura?: boolean }).aura ? " + Aura" : ""}`}
                </small>
              </button>
            ))}
            {Object.entries(trades)
              .filter(([, t]) => t.kind === "trade_up" && t.state === "issued")
              .map(([offerId]) => (
                <button type="button" key={offerId} disabled={busy} onClick={() => handOver(offerId)}>
                  Check hand-over
                </button>
              ))}
          </section>
        )}
        {!!reply?.locked?.length && (
          <section aria-label="For stakers">
            <h3>For stakers</h3>
            {reply.locked.map((chip) => (
              <LockedChip
                key={chip.id}
                label={chip.label}
                perk={chip.perk}
                gate={chip.locked}
                onStake={() => {
                  onClose();
                  window.dispatchEvent(new Event(OPEN_STAKE_EVENT));
                }}
              />
            ))}
          </section>
        )}
        {vault && (
          <section aria-label="Your vault and balance">
            <h3>Your vault and balance</h3>
            <ul className="npc-keeper">
              {vault.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
        <form className="npc-chat" onSubmit={send}>
          <input
            value={message}
            maxLength={300}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Say something to ${name}`}
            aria-label={`Message to ${name}`}
          />
          <button type="submit" disabled={busy || !message.trim()}>Send</button>
        </form>
        {notice && <p className="npc-notice" role="status">{notice}</p>}
        {error && <p className="npc-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

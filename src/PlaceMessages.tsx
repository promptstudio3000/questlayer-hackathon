import { useCallback, useEffect, useState } from "react";
import { ChatsCircle, Flag, Megaphone, PaperPlaneRight, Trash, UserPlus, X } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { NotePinArt } from "./NotePinArt";
import { PinLine } from "./PinLine";
import { remaining } from "./api";
import { tr } from "./i18n";
import {
  placeCreate,
  placeExtend,
  placeFeed,
  placeFollow,
  placeOpen,
  placePost,
  placeRemove,
  placeReport,
  type Fix,
  type PlaceFeed,
  type PlaceSort,
  type PlaceThread,
} from "./gold-spend-client";
import "./gold-spend.css";
import "./local-chat.css";
import { EmptyState } from "./EmptyState";

// Place messages (QGOLD stream 4): a shout is a short bubble at a place, paid
// per day (at most 7). A topic is a discussion anyone can write in from
// level 2; once enough different players have written it stays free for good.
// The feed lists everything within 1–10 km.
const SORTS: { id: PlaceSort; label: () => string }[] = [
  { id: "latest", label: () => tr("Latest") },
  { id: "following", label: () => tr("Following") },
  { id: "popular", label: () => tr("Popular") },
  { id: "recommended", label: () => tr("Recommended") },
];

export function PlaceMessages({
  position,
  fix,
  arena,
  notify,
  onSpent,
  openId,
  onOpened,
  onPublish,
}: {
  position: { lat: number; lng: number };
  fix: Fix | null;
  arena: boolean;
  notify: (text: string, error?: boolean) => void;
  onSpent: () => void;
  /** A pin tapped on the map opens this message. */
  openId?: string | null;
  onOpened?: () => void;
  /** Keep a message as a public record on NEAR Social (own account). */
  onPublish?: (targetId: string) => Promise<boolean>;
}) {
  const [radiusKm, setRadius] = useState(3);
  const [sort, setSort] = useState<PlaceSort>("latest");
  const [feed, setFeed] = useState<PlaceFeed | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState<PlaceThread | null>(null);
  const [compose, setCompose] = useState<"shout" | "topic" | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const { lat, lng } = position;
  const load = useCallback(
    () => placeFeed(lat, lng, radiusKm, sort).then(
      value => { setFeed(value); setLoadError(""); },
      e => { setLoadError(e.message); notify(e.message, true); },
    ),
    // Re-read on a ~100 m move, not every GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.round(lat * 1000), Math.round(lng * 1000), radiusKm, sort, notify],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!openId) return;
    placeOpen(openId).then((r) => setOpen(r.thread), (e) => notify(e.message, true));
    onOpened?.();
  }, [openId, onOpened, notify]);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      notify(e instanceof Error ? e.message : tr("Could not connect to the game."), true);
    } finally {
      setBusy(false);
    }
  };
  const prices = feed?.prices;

  if (open)
    return (
      <div className="place-thread">
        <button type="button" className="place-back" onClick={() => setOpen(null)}>
          ← {tr("All messages")}
        </button>
        <header>
          <span className={`place-kind place-kind-${open.kind}`}>{open.kind === "shout" ? <Megaphone weight="duotone" /> : <ChatsCircle weight="duotone" />}</span>
          <div>
            {open.title && <h3>{open.title}</h3>}
            <p className="place-text">{open.text}</p>
            <PinLine at={open} you={position} title={open.title || open.text} />
            <small>
              {open.author.name} · {open.freeForever ? tr("free for good") : open.state === "live" ? tr("{0} left", { 0: remaining(open.paidUntil) }) : tr("no longer on the map")}
            </small>
          </div>
        </header>
        <div className="place-actions">
          {!open.mine && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await placeFollow(open.author.id, !open.author.following);
                  setOpen({ ...open, author: { ...open.author, following: !open.author.following } });
                })
              }
            >
              <UserPlus weight="bold" /> {open.author.following ? tr("Unfollow") : tr("Follow")}
            </button>
          )}
          {!open.freeForever && open.state === "live" && (open.kind === "topic" || open.mine) && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await placeExtend(open.id, 1);
                  setOpen({ ...r.thread, replies: open.replies });
                  onSpent();
                  notify(tr("One more day on the map."));
                })
              }
            >
              {tr("Keep it 1 more day ({0} GOLD)", { 0: open.kind === "topic" ? prices?.topicPerDay ?? 0 : prices?.shoutPerDay ?? 0 })}
            </button>
          )}
          {open.mine && onPublish && open.social.state !== "confirmed" && (
            <button type="button" disabled={busy} onClick={() => run(async () => void (await onPublish(open.id)))}>
              {tr("Keep on NEAR Social")}
            </button>
          )}
          {open.mine ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await placeRemove(open.id);
                  setOpen(null);
                  void load();
                })
              }
            >
              <Trash weight="bold" /> {tr("Remove")}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => run(async () => void (await placeReport(open.id, "spam"), notify(tr("Thanks. Moderators will look at it."))))}>
              <Flag weight="bold" /> {tr("Report")}
            </button>
          )}
        </div>
        {open.kind === "topic" && (
          <>
            {!open.freeForever && (
              <p className="gold-shop-note">
                {tr("When {0} different players have written here, the topic stays free for good.", { 0: prices?.freeAuthors ?? 6 })} ({open.authors}/{prices?.freeAuthors ?? 6})
              </p>
            )}
            <ul className="place-replies">
              {(open.replies || []).map((r) => (
                <li key={r.id}>
                  <b>{r.author.name}</b> {r.text}
                </li>
              ))}
            </ul>
            {open.state === "live" && (
              <form
                className="place-reply"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const r = await placePost(open.id, reply);
                    setOpen(r.thread);
                    setReply("");
                    if (r.becameFree) notify(tr("This topic is now free for good."));
                  });
                }}
              >
                <input value={reply} maxLength={280} onChange={(e) => setReply(e.target.value)} placeholder={tr("Write to the topic")} aria-label={tr("Write to the topic")} />
                <button type="submit" disabled={busy || !reply.trim()} aria-label={tr("Send")}>
                  <PaperPlaneRight weight="bold" />
                </button>
              </form>
            )}
          </>
        )}
      </div>
    );

  return (
    <div className="place-messages">
      <div className="community-head">
        <h2>{tr("Around you")}</h2>
        <div className="community-head-actions">
          <button type="button" className="is-quiet" onClick={() => setCompose("shout")}>
            <Megaphone weight="duotone" aria-hidden="true" /> {tr("Shout")}
          </button>
          <button type="button" onClick={() => setCompose("topic")}>
            <ChatsCircle weight="duotone" aria-hidden="true" /> {tr("Topic")}
          </button>
        </div>
      </div>
      {compose && (
        <PlaceCompose
          kind={compose}
          position={position}
          fix={fix}
          arena={arena}
          prices={prices}
          notify={notify}
          onClose={() => setCompose(null)}
          onCreated={(thread) => {
            setCompose(null);
            onSpent();
            setOpen(thread);
            void load();
          }}
        />
      )}
      <div className="place-filters" role="group" aria-label={tr("Feed")}>
        {SORTS.map((s) => (
          <button type="button" key={s.id} aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
            {s.label()}
          </button>
        ))}
        <select value={radiusKm} onChange={(e) => setRadius(Number(e.target.value))} aria-label={tr("Radius")}>
          {[1, 3, 10].map((k) => (
            <option key={k} value={k}>
              {tr("{0} km", { 0: k })}
            </option>
          ))}
        </select>
      </div>
      {loadError && <div className="secondary-load-error" role="alert">
        <EmptyState title={tr("Places")} action={{ label: tr("Try again"), onClick: () => { setLoadError(""); void load(); } }}>{loadError}</EmptyState>
      </div>}
      {!feed ? (!loadError && <EmptyState title={tr("Loading…")} status />) : !feed.items.length ? (
        <EmptyState title={tr("No shouts or topics around you yet. Open the first one.")} />
      ) : (
        <ul className="community-rows place-feed-rows">
          {feed.items.map((t) => (
            <li key={t.id} className="community-row">
              <span className={`community-row-icon place-kind-${t.kind}`} aria-hidden="true">
                {t.kind === "shout" ? <Megaphone weight="duotone" size={20} /> : <ChatsCircle weight="duotone" size={20} />}
              </span>
              <span className="community-row-body">
                <button type="button" className="community-row-open" onClick={() => run(async () => setOpen((await placeOpen(t.id)).thread))}>
                  <b>{t.title || t.text}</b>
                  {t.title && <p>{t.text}</p>}
                  <span className="community-row-meta">
                    {t.mine ? tr("You") : t.author.name}
                    {t.kind === "topic" ? ` · ${tr("{0} posts", { 0: t.posts })}` : ` · ${tr("Shout")}`}
                  </span>
                </button>
                <PinLine at={t} you={position} title={t.title || t.text} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Compact create dialog for a shout or a topic (Lubos, 10 Nov 2026): the
 * pinned-message illustration, the text, a small days switch and the price on
 * the button. Opens from Local chat and from the Actions button on the map.
 */
export function PlaceCompose({
  kind,
  position,
  fix,
  arena,
  prices: known,
  notify,
  onClose,
  onCreated,
}: {
  kind: "shout" | "topic";
  position: { lat: number; lng: number };
  fix: Fix | null;
  arena: boolean;
  prices?: PlaceFeed["prices"];
  notify: (text: string, error?: boolean) => void;
  onClose: () => void;
  onCreated: (thread: PlaceThread) => void;
}) {
  const [prices, setPrices] = useState(known);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const [anchor] = useState({ lat: position.lat, lng: position.lng });
  useEffect(() => {
    if (prices) return;
    placeFeed(anchor.lat, anchor.lng, 1, "latest").then(
      (f) => setPrices(f.prices),
      () => undefined,
    );
  }, [prices, anchor.lat, anchor.lng]);
  const perDay = (kind === "topic" ? prices?.topicPerDay : prices?.shoutPerDay) ?? 0;
  const maxDays = prices?.maxDays ?? 7;
  const dayOptions = [1, 3, maxDays].filter((d, i, all) => d <= maxDays && all.indexOf(d) === i);
  const label = kind === "topic" ? tr("Open a topic") : tr("Shout here");
  return (
    <Dialog label={label} onClose={() => !busy && onClose()}>
      <form
        className="quick-create"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          placeCreate({ kind, title: kind === "topic" ? title : undefined, text, days, lat: anchor.lat, lng: anchor.lng, arena, fix: arena ? null : fix, publicConsent: true })
            .then(
              (r) => onCreated(r.thread),
              (err) => notify(err instanceof Error ? err.message : tr("Could not connect to the game."), true),
            )
            .finally(() => setBusy(false));
        }}
      >
        <button type="button" className="quick-create-close" aria-label={tr("Close")} disabled={busy} onClick={onClose}>
          <X size={22} aria-hidden="true" />
        </button>
        <NotePinArt kind="topic" />
        <h2>{label}</h2>
        {kind === "topic" && (
          <input type="text" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder={tr("Topic title")} aria-label={tr("Topic title")} required autoFocus />
        )}
        <textarea
          value={text}
          rows={3}
          maxLength={kind === "shout" ? 140 : 280}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "shout" ? tr("What do you want to shout?") : tr("Your opening message")}
          aria-label={tr("Message")}
          required
          autoFocus={kind === "shout"}
        />
        <div className="quick-create-tools">
          <div className="quick-create-days" role="radiogroup" aria-label={tr("Days on the map")}>
            {dayOptions.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} disabled={busy} onClick={() => setDays(d)}>
                {d === 1 ? tr("1 day") : tr("{0} days", { 0: d })}
              </button>
            ))}
          </div>
        </div>
        <p className="quick-create-fine">
          {kind === "shout"
            ? tr("A short bubble here for everyone nearby. No replies.")
            : tr("Anyone from level {0} can write in it for free.", { 0: prices?.postLevel ?? 2 })}{" "}
          {tr("Public at this map spot. GOLD is burned and not returned if the message is removed.")}
        </p>
        <button type="submit" className="gold-primary" disabled={busy || !text.trim() || (kind === "topic" && !title.trim())}>
          {tr("Post for {0} GOLD", { 0: Math.round(perDay * days * 1e6) / 1e6 })}
        </button>
      </form>
    </Dialog>
  );
}

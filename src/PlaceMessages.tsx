import { useCallback, useEffect, useState } from "react";
import { ChatsCircle, Flag, Megaphone, PaperPlaneRight, Trash, UserPlus } from "@phosphor-icons/react";
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
  const [open, setOpen] = useState<PlaceThread | null>(null);
  const [compose, setCompose] = useState<"shout" | "topic" | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [days, setDays] = useState(1);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const { lat, lng } = position;
  const load = useCallback(
    () => placeFeed(lat, lng, radiusKm, sort).then(setFeed, (e) => notify(e.message, true)),
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
  const perDay = compose === "topic" ? prices?.topicPerDay : prices?.shoutPerDay;

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
      <div className="place-compose-row">
        <button type="button" className="gold-primary" onClick={() => setCompose(compose === "shout" ? null : "shout")}>
          <Megaphone weight="duotone" /> {tr("Shout here")}
        </button>
        <button type="button" className="gold-primary" onClick={() => setCompose(compose === "topic" ? null : "topic")}>
          <ChatsCircle weight="duotone" /> {tr("Open a topic")}
        </button>
      </div>
      {compose && (
        <form
          className="place-compose"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await placeCreate({ kind: compose, title: compose === "topic" ? title : undefined, text, days, lat, lng, arena, fix: arena ? null : fix, publicConsent: true });
              setCompose(null);
              setText("");
              setTitle("");
              onSpent();
              setOpen(r.thread);
              void load();
            });
          }}
        >
          <p className="gold-shop-note">
            {compose === "shout"
              ? tr("A short bubble at this place for everyone nearby. No replies. Up to 7 days.")
              : tr("An opening message with a discussion under it. Anyone from level {0} can write for free.", { 0: prices?.postLevel ?? 2 })}
          </p>
          {compose === "topic" && (
            <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder={tr("Topic title")} aria-label={tr("Topic title")} required />
          )}
          <textarea
            value={text}
            maxLength={compose === "shout" ? 140 : 280}
            onChange={(e) => setText(e.target.value)}
            placeholder={compose === "shout" ? tr("What do you want to shout?") : tr("Your opening message")}
            aria-label={tr("Message")}
            required
          />
          <label className="place-days">
            {tr("Days on the map")}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {Array.from({ length: prices?.maxDays ?? 7 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <p className="gold-shop-note">{tr("Public at this map spot. GOLD is burned and not returned if the message is removed.")}</p>
          <button type="submit" className="gold-primary" disabled={busy || !text.trim()}>
            {tr("Post for {0} GOLD", { 0: Math.round((perDay ?? 0) * days * 1e6) / 1e6 })}
          </button>
        </form>
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
      {!feed ? null : !feed.items.length ? (
        <p className="gold-shop-empty">{tr("No messages around you yet. Leave the first one.")}</p>
      ) : (
        <ul className="place-feed">
          {feed.items.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => run(async () => setOpen((await placeOpen(t.id)).thread))}
              >
                <span className={`place-kind place-kind-${t.kind}`}>{t.kind === "shout" ? <Megaphone weight="duotone" /> : <ChatsCircle weight="duotone" />}</span>
                <span className="place-feed-body">
                  <b>{t.title || t.text}</b>
                  {t.title && <span>{t.text}</span>}
                  <small>
                    {t.author.name} · {tr("{0} m", { 0: t.distanceM ?? 0 })}{t.kind === "topic" ? ` · ${tr("{0} posts", { 0: t.posts })}` : ""}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

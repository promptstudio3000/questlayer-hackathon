// Rating and discussion under a creator quest (Lubos, 12 Nov 2026): tap a
// star, write a line. The average shows in the quest list.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PaperPlaneRight, Star, Trash } from "@phosphor-icons/react";
import { ExplorerAvatar, Stars } from "./CommunityCards";
import type { CreatorClient } from "./creator-community-client";
import type { QuestFeedback as Feedback } from "./creator-community-types";
import { tr } from "./i18n";

const COMMENT_MAX = 500;
const ago = (at: number) => {
  const m = Math.max(1, Math.round((Date.now() - at) / 60000));
  return m < 60 ? tr("{0} min", { 0: m }) : m < 1440 ? tr("{0} h", { 0: Math.round(m / 60) }) : tr("{0} d", { 0: Math.round(m / 1440) });
};

export function QuestFeedback({
  client,
  questId,
  onRated,
}: {
  client: CreatorClient;
  questId: string;
  /** Lets the page above update its header stars without a reload. */
  onRated?: (rating: Feedback["rating"]) => void;
}) {
  const [data, setData] = useState<Feedback | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [refresh, setRefresh] = useState(0);
  const rated = useRef(onRated);
  rated.current = onRated;
  useEffect(() => {
    const controller = new AbortController();
    client
      .read<Feedback>(`/quests/${encodeURIComponent(questId)}/feedback`, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
        rated.current?.(next.rating);
      })
      .catch(() => {
        // Older hosts have no feedback; the quest itself still works.
        if (!controller.signal.aborted) setData(null);
      });
    return () => controller.abort();
  }, [client, questId, refresh]);
  async function run(path: string, method: "POST" | "PUT", body: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await client.mutate(`/quests/${encodeURIComponent(questId)}${path}`, method, body);
      setRefresh((n) => n + 1);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Try again"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!data) return null;
  const { rating, comments } = data;
  async function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (await run("/comments", "POST", { body })) setText("");
  }
  return (
    <section className="qd-feedback" aria-label={tr("Rating and discussion")}>
      <div className="qd-rate">
        {rating.canRate ? (
          <div className="qd-stars" role="radiogroup" aria-label={tr("Rate this quest")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating.mine === n}
                aria-label={tr("{0} of 5 stars", { 0: n })}
                disabled={busy}
                onClick={() => void run("/rating", "PUT", { stars: n })}
              >
                <Star size={28} weight={rating.mine && n <= rating.mine ? "fill" : "regular"} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <strong className="qd-rate-title">{tr("Discussion")}</strong>
        )}
        {rating.count > 0 ? (
          <Stars rating={rating} />
        ) : (
          rating.canRate && <span className="qd-rate-hint">{tr("Rate this quest")}</span>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {comments.length > 0 && (
        <ul className="qd-comments">
          {comments.map((c) => (
            <li key={c.id}>
              <ExplorerAvatar look={c.author.look} size={28} />
              <div>
                <span className="qd-comment-by">
                  <b>{c.author.displayName}</b>
                  {c.author.creator && <span className="qd-comment-creator">{tr("Creator")}</span>}
                  <small>{ago(c.at)}</small>
                </span>
                <p>{c.body}</p>
              </div>
              {c.canRemove && (
                <button
                  type="button"
                  className="qd-comment-remove"
                  aria-label={tr("Remove comment")}
                  title={tr("Remove comment")}
                  disabled={busy}
                  onClick={() => void run(`/comments/${encodeURIComponent(c.id)}/remove`, "POST", {})}
                >
                  <Trash size={18} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="qd-comment-form" onSubmit={send}>
        <input
          aria-label={tr("Write a comment")}
          placeholder={tr("Write a comment")}
          maxLength={COMMENT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="primary-button" aria-label={tr("Send")} disabled={busy || !text.trim()}>
          <PaperPlaneRight size={20} weight="fill" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

/** Shrinks a chosen photo in the browser so phone camera shots fit the upload. */
export async function questPhotoData(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

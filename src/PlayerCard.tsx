import { useEffect, useState } from "react";
import { ChatCircleText, X } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import { Dialog } from "./Dialog";
import { characterMarkerMarkup } from "./character-art";
import { WearableTile } from "./GotchiWardrobe";
import type { WornWearable } from "./types";
import "./wearables.css";

/** The ready phrases, translated on this device (server keys → text). */
export const WAVE_TEXT: Record<string, () => string> = {
  hello: () => tr("Hello!"),
  "nice-look": () => tr("Nice look!"),
  "team-up": () => tr("Want to explore together?"),
  "found-here": () => tr("There is a find near here."),
  thanks: () => tr("Thanks!"),
  "see-you": () => tr("See you around!"),
};
const waveText = (key: string, fallback: string) => WAVE_TEXT[key]?.() || fallback;

type Card = {
  id: string;
  name: string;
  level: number;
  xp: number;
  /** A test-world bot (TEST_SEED) walking the map, not a real explorer. */
  demoBot: boolean;
  joinedAt: number;
  badges: number;
  self: boolean;
  wearables: (WornWearable & { name: string })[];
  auras: { above: string | null; below: string | null };
  original: boolean;
  canWave: boolean;
  waveHint: string | null;
  phrases: { key: string; text: string }[];
};

/**
 * Another explorer, tapped on the map: name, level, XP, badges, what they
 * wear (gold check = their wallet holds the original), ready-phrase waves,
 * a "Write a message" slot (not open yet) and Block. Test-world bots get the
 * same card with a "demo-bot" tag. Only while they share their position; no
 * wallet address, no inventory.
 */
export function PlayerCard({
  playerId,
  onClose,
  onBlocked,
  onMessage,
}: {
  playerId: string;
  onClose: () => void;
  onBlocked?: () => void;
  /** Opens a conversation with this explorer; the button is disabled without it. */
  onMessage?: (playerId: string, name: string) => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  useEffect(() => {
    let live = true;
    api<Card>(`/players/card?playerId=${encodeURIComponent(playerId)}`)
      .then((r) => live && setCard(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [playerId]);
  async function wave(phrase: string) {
    setBusy(true);
    try {
      const r = await api<{ phrase: string }>("/players/wave", { playerId, phrase });
      setStatus(tr("Sent: “{0}”", { 0: waveText(phrase, r.phrase) }));
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function block() {
    setBusy(true);
    try {
      await fetch("/api/social/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ targetPlayerId: playerId }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || tr("Could not block."));
      });
      window.dispatchEvent(new Event("questlayer:social-blocks"));
      onBlocked?.();
      onClose();
    } catch (e) {
      setStatus((e as Error).message);
      setBusy(false);
    }
  }
  const verified = card?.wearables.filter((w) => w.verified).length || 0;
  return (
    <Dialog label={card ? card.name : tr("Explorer")} onClose={onClose}>
      <div className="player-card">
        <header>
          {card && (
            <div
              className="player-card-avatar"
              aria-hidden="true"
              // Same sanitised markup as the map marker (hex colours, catalogue ids).
              dangerouslySetInnerHTML={{
                __html: characterMarkerMarkup({
                  above: card.auras.above,
                  below: card.auras.below,
                  skinUrl: card.original
                    ? `/api/presence/skin?playerId=${encodeURIComponent(card.id)}`
                    : undefined,
                  wearables: card.wearables,
                }),
              }}
            />
          )}
          <div>
            <h2>
              {card?.name || tr("Explorer")}
              {card?.demoBot && <span className="player-card-bot">{"demo-bot"}</span>}
            </h2>
            {card && (
              <p>
                {tr("Level {0}", { 0: card.level })} · {tr("{0} XP", { 0: card.xp.toLocaleString("en-US") })}
                {verified ? ` · ${tr("{0} verified", { 0: verified })}` : ""}
              </p>
            )}
          </div>
          <button className="player-card-close" onClick={onClose} aria-label={tr("Close")}>
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {card && (
          <>
            <dl className="player-card-stats">
              <div>
                <dt>{tr("Level")}</dt>
                <dd>{card.level}</dd>
              </div>
              <div>
                <dt>XP</dt>
                <dd>{card.xp.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>{tr("Badges")}</dt>
                <dd>{card.badges}</dd>
              </div>
              <div>
                <dt>{tr("Exploring since")}</dt>
                <dd>
                  {new Date(card.joinedAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </dd>
              </div>
            </dl>
            {card.demoBot && (
              <p className="player-card-bot-note">
                {tr("A demo bot from the test world. It walks the map so you can see how other explorers look.")}
              </p>
            )}
            <h3>{tr("Wearing")}</h3>
            {card.wearables.length ? (
              <div className="wearable-grid">
                {card.wearables.map((w) => (
                  <WearableTile key={w.id} item={w} />
                ))}
              </div>
            ) : (
              <p>{tr("No Aavegotchi wearables on right now.")}</p>
            )}
            {card.original && <p>{tr("Wearing an original Aavegotchi from their wallet.")}</p>}
            {!card.self && (
              <div className="player-card-actions">
                <button
                  disabled={!onMessage || card.demoBot}
                  onClick={() => onMessage?.(card.id, card.name)}
                >
                  <ChatCircleText size={18} aria-hidden="true" /> {tr("Write a message")}
                </button>
                {(!onMessage || card.demoBot) && <small>{tr("Messages are coming soon.")}</small>}
              </div>
            )}
            {!card.self && !card.demoBot && (
              <>
                <h3>{tr("Wave")}</h3>
                {card.canWave ? (
                  <div className="player-card-waves">
                    {card.phrases.map((p) => (
                      <button key={p.key} disabled={busy} onClick={() => void wave(p.key)}>
                        {waveText(p.key, p.text)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>
                    {card.waveHint === "You are in a different realm."
                      ? tr("You are in a different realm.")
                      : tr("Share your position to wave.")}
                  </p>
                )}
                <p>
                  <small>{tr("Waves are ready phrases only. No chat, no personal details.")}</small>
                </p>
                {status && <p role="status">{status}</p>}
                <div className="player-card-actions">
                  {confirmBlock ? (
                    <>
                      <button className="danger" disabled={busy} onClick={() => void block()}>
                        {tr("Block {0}", { 0: card.name })}
                      </button>
                      <button onClick={() => setConfirmBlock(false)}>{tr("Cancel")}</button>
                    </>
                  ) : (
                    <button className="danger" onClick={() => setConfirmBlock(true)}>
                      {tr("Block")}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

import { useEffect, useState, type CSSProperties } from "react";
import { ChatCircleText, HandWaving, Prohibit, SealCheck, X } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import { Dialog } from "./Dialog";
import { characterMarkerMarkup } from "./character-art";
import { levelProgress } from "./levels";
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
const SLOT_LABEL: Record<string, () => string> = {
  body: () => tr("Body"),
  face: () => tr("Face"),
  eyes: () => tr("Eyes"),
  head: () => tr("Head"),
  handLeft: () => tr("Left hand"),
  handRight: () => tr("Right hand"),
  pet: () => tr("Pet"),
};

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
  gotchi: { name: string; brs: number | null } | null;
  stats: { finds: number; quests: number; monsters: number; wearables: number };
  slots: { slot: string; item: (WornWearable & { name: string; source: "original" | "clone" }) | null }[];
  canWave: boolean;
  waveHint: string | null;
  phrases: { key: string; text: string }[];
};

/**
 * An explorer's public profile (docs/PLAYER-CARDS.md): name, level and XP,
 * the worn original and its rarity score, play stats, and the equipment slots
 * with what they wear now (gold seal = their wallet holds the original).
 * Message, ready-phrase waves and Block for other explorers. Visible without
 * sharing a position and never showing one; only what is worn, no wallet
 * address and no inventory. Test-world bots carry a "demo-bot" tag.
 */
export function PlayerCard({
  playerId,
  onClose,
  onBlocked,
  onMessage,
  onEdit,
}: {
  playerId: string;
  /** Own profile: opens the Inventory to change what is worn. */
  onEdit?: () => void;
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
  const [waving, setWaving] = useState(false);
  const progress = card ? levelProgress(card.xp) : null;
  const ratio = progress
    ? Math.min(1, (card!.xp - progress.levelStartXp) / Math.max(1, progress.nextLevelXp - progress.levelStartXp))
    : 0;
  const stats = card
    ? [
        [tr("Finds"), card.stats.finds],
        [tr("Quests"), card.stats.quests],
        [tr("Monsters"), card.stats.monsters],
        [tr("Wearables"), card.stats.wearables],
        [tr("Badges"), card.badges],
        [
          tr("Exploring since"),
          new Date(card.joinedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
        ],
      ]
    : [];
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
                    ? `/api/players/skin?playerId=${encodeURIComponent(card.id)}`
                    : undefined,
                  wearables: card.wearables,
                }),
              }}
            />
          )}
          <div className="player-card-who">
            <h2>
              {card?.name || tr("Explorer")}
              {card?.demoBot && <span className="player-card-bot">{"demo-bot"}</span>}
            </h2>
            {card && progress && (
              <>
                <p>
                  {tr("Level {0}", { 0: card.level })} · {tr("{0} XP", { 0: card.xp.toLocaleString("en-US") })}
                </p>
                <div
                  className="player-card-xp"
                  role="progressbar"
                  aria-label={tr("Level {0} progress", { 0: card.level })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(ratio * 100)}
                >
                  <span style={{ width: `${Math.round(ratio * 100)}%` }} />
                </div>
                {card.gotchi && (
                  <p className="player-card-gotchi">
                    <SealCheck size={16} weight="fill" aria-hidden="true" />
                    {card.gotchi.name || tr("Aavegotchi")}
                    {card.gotchi.brs != null && <> · {tr("BRS {0}", { 0: card.gotchi.brs })}</>}
                  </p>
                )}
              </>
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
              {stats.map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{typeof value === "number" ? value.toLocaleString("en-US") : value}</dd>
                </div>
              ))}
            </dl>
            {card.demoBot && (
              <p className="player-card-bot-note">
                {tr("A demo bot from the test world. It walks the map so you can see how other explorers look.")}
              </p>
            )}
            {!card.self && !card.demoBot && (
              <div className="player-card-actions">
                <button disabled={!onMessage} onClick={() => onMessage?.(card.id, card.name)}>
                  <ChatCircleText size={18} aria-hidden="true" /> {tr("Message")}
                </button>
                <button aria-expanded={waving} onClick={() => setWaving((v) => !v)}>
                  <HandWaving size={18} aria-hidden="true" /> {tr("Wave")}
                </button>
                {confirmBlock ? (
                  <>
                    <button className="danger" disabled={busy} onClick={() => void block()}>
                      {tr("Block {0}", { 0: card.name })}
                    </button>
                    <button onClick={() => setConfirmBlock(false)}>{tr("Cancel")}</button>
                  </>
                ) : (
                  <button className="danger" aria-label={tr("Block")} title={tr("Block")} onClick={() => setConfirmBlock(true)}>
                    <Prohibit size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            {waving && !card.self && !card.demoBot && (
              card.canWave ? (
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
              )
            )}
            {status && <p role="status">{status}</p>}
            {card.self && onEdit && (
              <div className="player-card-actions">
                <button onClick={onEdit}>{tr("Change outfit")}</button>
              </div>
            )}
            <h3>{tr("Wearing")}</h3>
            <ul className="player-card-slots">
              {card.slots.map(({ slot, item }) => (
                <li key={slot} className={item ? `filled rarity-${item.rarity || "common"}` : "empty"}>
                  {item ? (
                    <img src={`/api/wearables/art/${item.id}.svg`} alt={item.name} loading="lazy" />
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  {item?.verified && (
                    <SealCheck className="player-card-verified" size={18} weight="fill" aria-label={tr("Verified original")} />
                  )}
                  <small>{SLOT_LABEL[slot]?.() || slot}</small>
                </li>
              ))}
              {(["above", "below"] as const).map((slot) => {
                const color = card.auras[slot];
                return (
                  <li key={slot} className={color ? "filled" : "empty"}>
                    <span
                      className="player-card-aura"
                      aria-label={color ? tr("Aura") : undefined}
                      style={color ? ({ "--aura": color } as CSSProperties) : undefined}
                    />
                    <small>{slot === "above" ? tr("Above") : tr("Below")}</small>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

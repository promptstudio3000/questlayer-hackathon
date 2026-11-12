import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ChatCircleText, HandWaving, Prohibit, SealCheck, X } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import { Dialog } from "./Dialog";
import { characterMarkerMarkup } from "./character-art";
import { levelProgress } from "./levels";
import type { Player, WornWearable } from "./types";
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

/**
 * A short demo conversation with a test-world bot. Bots have no NEAR account
 * and no inbox key, so the encrypted inbox cannot reach them; the server
 * answers from fixed in-character lines and stores nothing (server/demo-bot-chat.mjs).
 */
function DemoBotChat({ botId, name }: { botId: string; name: string }) {
  const [lines, setLines] = useState<{ mine: boolean; text: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => input.current?.focus(), []);
  // Keep the newest line in view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [lines, busy]);
  async function send(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError("");
    setLines((l) => [...l, { mine: true, text: message }]);
    setText("");
    try {
      const r = await api<{ reply: string }>("/players/bot-chat", { playerId: botId, text: message });
      setLines((l) => [...l, { mine: false, text: r.reply }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="player-card-botchat" aria-label={tr("Chat with {0}", { 0: name })}>
      <p className="player-card-hint">
        {tr("Demo chat: {0} answers with ready lines. Nothing is stored or sent on chain; real explorers get the encrypted inbox.", { 0: name })}
      </p>
      {lines.length > 0 && (
        <ol ref={list} aria-live="polite">
          {lines.map((l, i) => (
            <li key={i} className={l.mine ? "mine" : "theirs"}>
              <span className="sr-only">{l.mine ? tr("You") : name}: </span>
              {l.text}
            </li>
          ))}
          {busy && <li className="theirs typing">{tr("{0} is typing…", { 0: name })}</li>}
        </ol>
      )}
      {error && <p role="alert">{error}</p>}
      <form onSubmit={(e) => void send(e)}>
        <textarea
          ref={input}
          value={text}
          maxLength={500}
          rows={2}
          aria-label={tr("Message to {0}", { 0: name })}
          placeholder={tr("Write to {0}…", { 0: name })}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) void send(e);
          }}
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {tr("Send")}
        </button>
      </form>
    </section>
  );
}
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
  /** Outfit tag of the worn gotchi (changes the avatar URL). */
  look: string;
  /** Own profile: slots dress the worn gotchi, or the starter ghost's clones. */
  dress: { gotchi: boolean; dressed: string[] } | null;
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
type Owned = { id: number; name: string; slot: string; rarity: string; source: "find" | "original"; equipped: boolean; verified: boolean };
const catalogSlot = (slot: string) => (slot === "handLeft" || slot === "handRight" ? "hand" : slot);

export function PlayerCard({
  playerId,
  onClose,
  onBlocked,
  onMessage,
  onEdit,
  onPlayer,
}: {
  playerId: string;
  /** Own profile: the explorer after an outfit change (map marker, Inventory). */
  onPlayer?: (player: Player) => void;
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
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    api<Card>(`/players/card?playerId=${encodeURIComponent(playerId)}`)
      .then((r) => live && setCard(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [playerId, reload]);
  // Own profile: tap a slot to dress it from what you found or your wallet holds.
  const [picking, setPicking] = useState<string | null>(null);
  const [owned, setOwned] = useState<Owned[] | null>(null);
  useEffect(() => {
    if (!picking || owned) return;
    api<{ items: Owned[] }>("/wearables")
      .then((r) => setOwned(r.items))
      .catch((e: Error) => setStatus(e.message));
  }, [picking, owned]);
  async function dress(slot: string, itemId: number | null) {
    if (!card?.dress) return;
    setBusy(true);
    try {
      let r: { player: Player; items?: Owned[] };
      if (card.dress.gotchi) r = await api("/aavegotchi/outfit", { slot, itemId });
      else {
        const current = card.slots.find((s) => s.slot === slot)?.item;
        r = itemId
          ? await api("/wearables/equip", { itemId, equipped: true })
          : await api("/wearables/equip", { itemId: current?.id, equipped: false });
      }
      if (r.items) setOwned(r.items);
      onPlayer?.(r.player);
      setPicking(null);
      setStatus("");
      setReload((n) => n + 1);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const choices =
    picking && owned && card?.dress
      ? owned.filter(
          (i) =>
            i.slot === catalogSlot(picking) &&
            // A gotchi wears map finds and originals the wallet holds now.
            (!card.dress!.gotchi || i.source === "find" || i.verified),
        )
      : [];
  const pickedItem = picking ? card?.slots.find((s) => s.slot === picking)?.item : null;
  async function wave(phrase: string) {
    setBusy(true);
    try {
      const r = await api<{ phrase: string; reply?: { key: string; text: string } }>("/players/wave", { playerId, phrase });
      const sent = tr("Sent: “{0}”", { 0: waveText(phrase, r.phrase) });
      // A demo bot waves straight back, so the reply shows right here.
      setStatus(r.reply && card ? `${sent} ${tr("{0} waved back: “{1}”", { 0: card.name, 1: waveText(r.reply.key, r.reply.text) })}` : sent);
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
  const [botChat, setBotChat] = useState(false);
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
                    ? `/api/players/skin?playerId=${encodeURIComponent(card.id)}${card.look ? `&v=${encodeURIComponent(card.look)}` : ""}`
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
            {card.demoBot && !card.self && (
              <div className="player-card-actions">
                <button aria-expanded={botChat} onClick={() => setBotChat((v) => !v)}>
                  <ChatCircleText size={18} aria-hidden="true" /> {tr("Message")}
                </button>
                <button aria-expanded={waving} onClick={() => setWaving((v) => !v)}>
                  <HandWaving size={18} aria-hidden="true" /> {tr("Wave")}
                </button>
              </div>
            )}
            {card.demoBot && botChat && <DemoBotChat botId={card.id} name={card.name} />}
            {!card.self && !card.demoBot && (
              <div className="player-card-actions">
                <button
                  disabled={!onMessage}
                  title={onMessage ? undefined : tr("Messages need your explorer account. Sign in with it to write.")}
                  onClick={() => onMessage?.(card.id, card.name)}
                >
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
            {!card.self && !card.demoBot && !onMessage && (
              <p className="player-card-hint">{tr("Messages need your explorer account. Sign in with it to write.")}</p>
            )}
            {waving && !card.self && (
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
            {card.dress && <p className="player-card-hint">{tr("Tap a slot to dress it.")}</p>}
            <ul className="player-card-slots">
              {card.slots.map(({ slot, item }) => {
                const inner = (
                  <>
                    {item ? (
                      <img src={`/api/wearables/art/${item.id}.svg`} alt={item.name} loading="lazy" />
                    ) : (
                      <span aria-hidden="true" />
                    )}
                    {item?.verified && (
                      <SealCheck className="player-card-verified" size={18} weight="fill" aria-label={tr("Verified original")} />
                    )}
                    <small>{SLOT_LABEL[slot]?.() || slot}</small>
                  </>
                );
                return (
                  <li
                    key={slot}
                    className={`${item ? `filled rarity-${item.rarity || "common"}` : "empty"}${picking === slot ? " picking" : ""}`}
                  >
                    {card.dress ? (
                      <button
                        aria-expanded={picking === slot}
                        aria-label={`${SLOT_LABEL[slot]?.() || slot}: ${item?.name || tr("Empty")}`}
                        onClick={() => setPicking((p) => (p === slot ? null : slot))}
                      >
                        {inner}
                      </button>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
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
            {picking && card.dress && (
              <div className="player-card-picker" aria-label={SLOT_LABEL[picking]?.() || picking}>
                {!owned ? (
                  <p>{tr("Loading…")}</p>
                ) : (
                  <ul>
                    {choices.map((i) => (
                      <li key={i.id}>
                        <button
                          disabled={busy || pickedItem?.id === i.id}
                          aria-pressed={pickedItem?.id === i.id}
                          className={`rarity-${i.rarity}`}
                          onClick={() => void dress(picking, i.id)}
                        >
                          <img src={`/api/wearables/art/${i.id}.svg`} alt="" loading="lazy" />
                          <span>{i.name}</span>
                          {i.verified && <SealCheck size={14} weight="fill" aria-label={tr("Verified original")} />}
                        </button>
                      </li>
                    ))}
                    {(card.dress.gotchi || pickedItem) && (
                      <li>
                        <button disabled={busy || (card.dress.gotchi && !pickedItem)} onClick={() => void dress(picking, card.dress!.gotchi ? 0 : null)}>
                          <span>{tr("Empty")}</span>
                        </button>
                      </li>
                    )}
                    {card.dress.gotchi && card.dress.dressed.includes(picking) && (
                      <li>
                        <button disabled={busy} onClick={() => void dress(picking, null)}>
                          <span>{tr("Gotchi's own gear")}</span>
                        </button>
                      </li>
                    )}
                  </ul>
                )}
                {owned && !choices.length && (
                  <p>{tr("Nothing for this slot yet. Find wearables on the map or link the wallet that holds them.")}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

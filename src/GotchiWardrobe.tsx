import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { tr } from "./i18n";
import { wearableArtUrl } from "./character-art";
import type { Player, WearableRarity } from "./types";
import "./wearables.css";

export type WardrobeWearable = {
  id: number;
  name: string;
  slot: string;
  rarity: WearableRarity;
  source: "find" | "original";
  equipped: boolean;
  verified: boolean;
};
type WardrobeState = {
  items: WardrobeWearable[];
  linked: boolean;
  verifiedAt: number | null;
  catalogSize: number;
};
export const SLOT_NAMES: Record<string, () => string> = {
  head: () => tr("Head"),
  face: () => tr("Face"),
  eyes: () => tr("Eyes"),
  body: () => tr("Body"),
  hand: () => tr("Hand"),
  pet: () => tr("Pet"),
};
export const RARITY_NAMES: Record<string, () => string> = {
  common: () => tr("Common"),
  uncommon: () => tr("Uncommon"),
  rare: () => tr("Rare"),
  legendary: () => tr("Legendary"),
  mythical: () => tr("Mythical"),
  godlike: () => tr("Godlike"),
};

/** One wearable with its official art and a gold check or a "Clone" tag. */
export function WearableTile({
  item,
  onClick,
  disabled,
  detail,
}: {
  item: { id: number; name?: string; slot: string; rarity?: string; verified: boolean; equipped?: boolean };
  onClick?: () => void;
  disabled?: boolean;
  detail?: string;
}) {
  const body = (
    <>
      {item.verified ? (
        <i className="verified-check" role="img" aria-label={tr("Verified original")} title={tr("Verified original")} />
      ) : (
        <span className="clone-badge">{tr("Clone")}</span>
      )}
      <img src={wearableArtUrl(item.id)} alt="" loading="lazy" draggable={false} />
      <strong>{item.name || tr("Item #{0}", { 0: item.id })}</strong>
      <small>
        {[RARITY_NAMES[item.rarity || ""]?.(), SLOT_NAMES[item.slot]?.()]
          .filter(Boolean)
          .join(" · ")}
      </small>
      {detail && <small>{detail}</small>}
    </>
  );
  const className = `wearable-tile rarity-${item.rarity || "common"}${item.equipped ? " equipped" : ""}`;
  return onClick ? (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={!!item.equipped}
    >
      {body}
    </button>
  ) : (
    <article className={className}>{body}</article>
  );
}

/**
 * Wardrobe section: Aavegotchi wearable clones found on the map, plus the
 * originals a linked Base wallet holds (gold check). Wearing one puts it on
 * your character on the map, where nearby explorers can see it.
 */
export function GotchiWardrobe({
  onPlayer,
  onLink,
  linking,
}: {
  onPlayer: (player: Player) => void;
  onLink: () => void;
  linking?: boolean;
}) {
  const [state, setState] = useState<WardrobeState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => {
    api<WardrobeState>("/wearables")
      .then((r) => {
        setState(r);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  async function toggle(item: WardrobeWearable) {
    setBusy(item.id);
    try {
      const r = await api<WardrobeState & { player: Player }>("/wearables/equip", {
        itemId: item.id,
        equipped: !item.equipped,
      });
      setState(r);
      onPlayer(r.player);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const items = state?.items || [];
  const verified = items.filter((i) => i.verified).length;
  return (
    <section className="gotchi-wardrobe" aria-labelledby="gotchi-wardrobe-title">
      <h3 id="gotchi-wardrobe-title">{tr("Aavegotchi wearables")}</h3>
      <p>
        {tr("Find wearables on the map: they float in a coloured ring. Each find gives you a free in-game clone to wear. Own the real one? Link your wallet and it gets a gold check.")}
      </p>
      <p className="wearable-legend">
        <span>
          <i className="verified-check" aria-hidden="true" /> {tr("Verified original in your wallet")}
        </span>
        <span>
          <span className="clone-badge">{tr("Clone")}</span> {tr("In-game copy")}
        </span>
      </p>
      {error && (
        <p className="inventory-error" role="alert">
          {error}
        </p>
      )}
      {state && !items.length && (
        <p>{tr("No wearables yet. Walk to a wearable find on the map to pick up your first one.")}</p>
      )}
      {!!items.length && (
        <>
          <p role="status">
            {tr("{0} of {1} wearables", { 0: items.length, 1: state?.catalogSize || 0 })}
            {verified ? ` · ${tr("{0} verified", { 0: verified })}` : ""}
          </p>
          <div className="wearable-grid">
            {items.map((item) => (
              <WearableTile
                key={item.id}
                item={item}
                disabled={busy !== null}
                onClick={() => void toggle(item)}
                detail={item.equipped ? tr("Wearing · tap to take off") : tr("Tap to wear")}
              />
            ))}
          </div>
        </>
      )}
      {state && !state.linked && (
        <button className="inventory-secondary" onClick={onLink} disabled={linking}>
          {tr("Link wallet to verify originals")}
        </button>
      )}
      {state?.linked && (
        <p>
          {state.verifiedAt
            ? tr("Wallet checked {0}. Checks older than a day lose the gold check until you check again.", {
                0: new Date(state.verifiedAt).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })
            : tr("Check your originals below to verify the wearables you own.")}
        </p>
      )}
    </section>
  );
}

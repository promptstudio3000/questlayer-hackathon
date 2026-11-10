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
 * Aavegotchi wearable clones found on the map, plus the originals a linked
 * Base wallet holds (gold check). Wearing one puts it on your character on
 * the map, where nearby explorers can see it. The Inventory wardrobe grid
 * shows them next to the Auras.
 */
export function useWardrobeWearables(onPlayer: (player: Player) => void) {
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
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { state, error, busy, toggle, reload: load };
}

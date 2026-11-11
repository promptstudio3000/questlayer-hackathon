// Dressing an owned Aavegotchi in the game (Lubos, 10 Nov 2026: "a player
// wears whatever they own or found as a clone"). The outfit is cosmetic and
// lives only here: nothing changes on Base. It is stored in the explorer's
// appearance as slot index -> item id (0 = slot left empty) over the gotchi's
// real gear, and drawn by the Aavegotchi diamond's previewAavegotchi view.
//
// An item can go on only when the explorer has it in their Wardrobe: a clone
// found on the map, or an original their linked wallet holds (verified, at
// most a day old). The art is cached per gotchi + outfit.
import { createHash } from "node:crypto";
import { assert } from "./domain.mjs";
import { previewGotchiSvg } from "./aavegotchi.mjs";
import { WEARABLES, verifiedItemIds, ensureWearablesSchema } from "./gotchi-wearables.mjs";

// equippedWearables indexes on the diamond.
export const OUTFIT_SLOTS = Object.freeze({ body: 0, face: 1, eyes: 2, head: 3, handLeft: 4, handRight: 5, pet: 6 });
const CATALOG_SLOT = { body: "body", face: "face", eyes: "eyes", head: "head", handLeft: "hand", handRight: "hand", pet: "pet" };

const parse = (json) => {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
};

/** The 16 wearable ids to draw: the gotchi's own gear with the outfit on top. */
export function outfitEquipped(gotchi, outfit = {}) {
  const base = Array.from({ length: 16 }, (_, i) => Number(gotchi?.equipped?.[i]) || 0);
  for (const [index, item] of Object.entries(outfit || {})) {
    const i = Number(index);
    if (Number.isInteger(i) && i >= 0 && i <= 6) base[i] = Number(item) || 0;
  }
  return base;
}

/** A short tag that changes with the outfit (art URLs carry it to skip stale caches). */
export const outfitVersion = (outfit) =>
  Object.entries(outfit || {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([slot, id]) => `${slot}.${Number(id) || 0}`)
    .join("-")
    .slice(0, 80);

/** Items the explorer may put on: found clones, and originals verified in the wallet. */
export function ownedItemIds(db, player, now = Date.now()) {
  ensureWearablesSchema(db);
  const verified = verifiedItemIds(db, player, now);
  const owned = new Set(verified);
  for (const row of db
    .prepare("SELECT item_id FROM wearable_clones WHERE player_id=? AND source='find'")
    .all(player))
    owned.add(row.item_id);
  return owned;
}

/**
 * Puts an item into one slot of the worn original, empties it (itemId 0), or
 * gives the slot back to the gotchi's real gear (itemId null).
 */
export function setOutfitSlot(db, player, slot, itemId, now = Date.now()) {
  assert(Object.hasOwn(OUTFIT_SLOTS, slot), "Unknown slot.", 400);
  const row = db.prepare("SELECT appearance FROM players WHERE id=?").get(player);
  const appearance = parse(row?.appearance);
  assert(appearance.originTokenId, "Wear one of your Aavegotchis first.", 409);
  const outfit = { ...(appearance.outfit || {}) };
  const index = String(OUTFIT_SLOTS[slot]);
  if (itemId === null || itemId === undefined) delete outfit[index];
  else {
    const id = Number(itemId);
    if (id === 0) outfit[index] = 0;
    else {
      const item = WEARABLES.get(id);
      assert(Number.isSafeInteger(id) && item, "Unknown wearable.", 400);
      assert(item.slot === CATALOG_SLOT[slot], "This item does not fit that slot.", 400);
      assert(ownedItemIds(db, player, now).has(id), "Find this wearable or link the wallet that holds it first.", 403);
      outfit[index] = id;
    }
  }
  const next = { ...appearance, outfit };
  if (!Object.keys(outfit).length) delete next.outfit;
  db.prepare("UPDATE players SET appearance=? WHERE id=?").run(JSON.stringify(next), player);
  return next;
}

/** Drops outfit items the explorer no longer owns (sold, or the wallet link expired). */
export function ownedOutfit(db, player, outfit, now = Date.now()) {
  if (!outfit || !Object.keys(outfit).length) return {};
  const owned = ownedItemIds(db, player, now);
  return Object.fromEntries(
    Object.entries(outfit).filter(([, id]) => Number(id) === 0 || owned.has(Number(id))),
  );
}

export class GotchiOutfitArt {
  constructor({ render = previewGotchiSvg, max = 300 } = {}) {
    this.render = render;
    this.max = max;
    this.cache = new Map();
    this.pending = new Map();
  }

  /** The gotchi's art with this outfit; its plain art when there is no outfit or Base fails. */
  async svg(gotchi, outfit) {
    if (!gotchi) return null;
    if (!outfit || !Object.keys(outfit).length || !gotchi.preview) return gotchi.svg || null;
    const equipped = outfitEquipped(gotchi, outfit);
    const key = createHash("sha256").update(`${gotchi.tokenId}:${equipped.join(",")}`).digest("hex");
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.pending.has(key))
      this.pending.set(
        key,
        this.render(gotchi.preview, equipped)
          .then((svg) => {
            if (typeof svg !== "string" || svg.length > 200_000 || !svg.startsWith("<svg")) return null;
            if (this.cache.size >= this.max) this.cache.delete(this.cache.keys().next().value);
            this.cache.set(key, svg);
            return svg;
          })
          .catch(() => null)
          .finally(() => this.pending.delete(key)),
      );
    return (await this.pending.get(key)) || gotchi.svg || null;
  }
}

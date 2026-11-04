// Pure wardrobe helpers: filtering and catalog progress. Kept free of React so
// Node tests can import them.
import {
  AURA_CATALOG,
  AURA_RARITIES,
  catalogEditionFor,
  type AuraRarity,
} from "./aura-catalog.ts";

export type WardrobeFilter = Readonly<{
  slot: "all" | "above" | "below";
  rarity: "all" | AuraRarity;
  set: string; // "all" or a set id
}>;
export const DEFAULT_WARDROBE_FILTER: WardrobeFilter = Object.freeze({
  slot: "all",
  rarity: "all",
  set: "all",
});
type WardrobeItem = {
  name?: string | null;
  edition?: string | null;
  color?: string | null;
  slot?: string | null;
  rarity?: string | null;
};

export function filterAuras<T extends WardrobeItem>(
  items: readonly T[],
  filter: WardrobeFilter,
): T[] {
  return items.filter((item) => {
    if (filter.slot !== "all" && item.slot !== filter.slot) return false;
    if (filter.rarity !== "all" && item.rarity !== filter.rarity) return false;
    if (filter.set !== "all" && catalogEditionFor(item)?.set !== filter.set)
      return false;
    return true;
  });
}
export function isFiltered(filter: WardrobeFilter) {
  return filter.slot !== "all" || filter.rarity !== "all" || filter.set !== "all";
}
/** Rarity order for sorting: legendary first, unknown last. */
export function sortAuras<T extends WardrobeItem>(items: readonly T[]): T[] {
  const rank = (r?: string | null) => {
    const i = AURA_RARITIES.indexOf(r as AuraRarity);
    return i < 0 ? -1 : i;
  };
  return [...items].sort((a, b) => rank(b.rarity) - rank(a.rarity));
}
/** How many of each catalog edition the player holds. */
export function catalogProgress(items: readonly WardrobeItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const edition = catalogEditionFor(item);
    if (edition) counts.set(edition.id, (counts.get(edition.id) || 0) + 1);
  }
  return {
    entries: AURA_CATALOG.map((edition) => ({
      edition,
      owned: counts.get(edition.id) || 0,
    })),
    found: counts.size,
    total: AURA_CATALOG.length,
  };
}

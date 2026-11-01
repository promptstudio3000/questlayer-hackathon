// Server view of the shared cosmetic Aura catalog (server/data/aura-catalog.json).
// Chest drops follow these zone/level entitlements; set bonuses are visual only.
import { readFileSync } from "node:fs";

const catalog = JSON.parse(
  readFileSync(new URL("./data/aura-catalog.json", import.meta.url), "utf8"),
);
export const AURA_SUPPLY = catalog.supplyPerEdition;
export const AURA_ENTITLEMENTS = Object.freeze(catalog.entitlements);
export const AURA_CATALOG = Object.freeze(
  catalog.editions.map((e) => Object.freeze({ ...e })),
);
export const AURA_SETS = Object.freeze(
  catalog.sets.map((s) => Object.freeze({ ...s })),
);
/** Demo inventory names, in catalog order. Existing rows keep their stored names. */
export const DEMO_AURA_NAMES = Object.freeze(AURA_CATALOG.map((e) => e.demoName));

export function auraEntitled(edition, zoneTier, level) {
  const rule = AURA_ENTITLEMENTS[edition.rarity] || AURA_ENTITLEMENTS.legendary;
  return zoneTier >= rule.minZoneTier && level >= rule.minLevel;
}
export function entitledEditions(zoneTier, level) {
  return AURA_CATALOG.filter((e) => auraEntitled(e, zoneTier, level));
}
export function editionForDemoName(name) {
  return AURA_CATALOG.find((e) => e.demoName === name || e.name === name) || null;
}
/** Whether any edition a chest of this tier can hold for this level has supply left. */
export function chestAuraAvailable(db, zoneTier, level) {
  return entitledEditions(zoneTier, level).some(
    (e) =>
      (db.prepare("SELECT minted FROM editions WHERE name=?").get(e.demoName)
        ?.minted || 0) < AURA_SUPPLY,
  );
}

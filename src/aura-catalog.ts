// Typed view of the shared Aura catalog (server/data/aura-catalog.json). The server
// reads the same JSON in server/aura-catalog.mjs; tests keep the two in step.
// Everything here is cosmetic: entitlements decide which editions a chest can
// hold, and set bonuses only change how the explorer glows.
import catalog from "../server/data/aura-catalog.json" with { type: "json" };
import { tr } from "./i18n.ts";

export type AuraRarity = "common" | "rare" | "epic" | "legendary";
export type AuraCatalogEdition = Readonly<{
  id: string;
  name: string;
  demoName: string;
  rarity: AuraRarity;
  slot: "above" | "below";
  color: string;
  demoColor?: string;
  set: string;
  native: boolean;
  /** chest: zone chest drops; npc / monster: only earned from those, never from chests. */
  source: "chest" | "npc" | "monster" | "level" | "season";
  motif: string;
  /** How an NPC or monster edition is earned. */
  how?: string;
}>;
export type AuraSet = Readonly<{
  id: string;
  name: string;
  glow: string;
  bonus: string;
}>;
export type AuraEntitlement = Readonly<{ minZoneTier: number; minLevel: number }>;

export const AURA_CATALOG_VERSION: number = catalog.version;
/** Per-edition cap, or null: editions are uncapped (owner, 11 Nov 2026). */
export const AURA_SUPPLY: number | null = catalog.supplyPerEdition ?? null;
export const AURA_RARITIES = catalog.rarities as readonly AuraRarity[];
export const AURA_CATALOG = Object.freeze(
  catalog.editions.map((e) => Object.freeze(e)),
) as readonly AuraCatalogEdition[];
export const AURA_SETS = Object.freeze(
  catalog.sets.map((s) => Object.freeze(s)),
) as readonly AuraSet[];
export const AURA_ENTITLEMENTS = catalog.entitlements as Readonly<
  Record<AuraRarity, AuraEntitlement>
>;

export function catalogEdition(id: unknown) {
  return AURA_CATALOG.find((e) => e.id === id) || null;
}
/** Match an inventory item or token by edition id, either of its names or its color. */
export function catalogEditionFor(item: {
  edition?: string | null;
  name?: string | null;
  color?: string | null;
}) {
  const byId = catalogEdition(item.edition);
  if (byId) return byId;
  const name = item.name || "";
  return (
    AURA_CATALOG.find((e) => e.name === name || e.demoName === name) || null
  );
}
export function auraSet(id: unknown) {
  return AURA_SETS.find((s) => s.id === id) || null;
}
export function entitlementFor(rarity: unknown): AuraEntitlement {
  return (
    AURA_ENTITLEMENTS[rarity as AuraRarity] || AURA_ENTITLEMENTS.legendary
  );
}
/** Whether a chest in a zone of `zoneTier` can hold this edition for a player at `level`. */
export function auraEntitled(
  edition: AuraCatalogEdition,
  zoneTier: number,
  level: number,
) {
  if (edition.source !== "chest") return false;
  const rule = entitlementFor(edition.rarity);
  return zoneTier >= rule.minZoneTier && level >= rule.minLevel;
}
/** Where an edition is found: chest entitlement, or the NPC / monster that awards it. */
export function editionSourceLabel(edition: AuraCatalogEdition) {
  if (edition.source === "npc") return tr("NPC only · {0}", { 0: edition.how || "Earned from a roaming NPC" });
  if (edition.source === "season")
    return tr("Keepsake · {0}", { 0: edition.how || "No longer awarded" });
  if (edition.source === "level")
    return tr("Level reward · {0}", { 0: edition.how || "Earned by reaching a level" });
  if (edition.source === "monster")
    return tr("Monster only · {0}", { 0: edition.how || "Earned by beating a monster" });
  return entitlementLabel(edition.rarity);
}
export function entitlementLabel(rarity: unknown) {
  const rule = entitlementFor(rarity);
  const zone =
    rule.minZoneTier >= 3
      ? "gold zones"
      : rule.minZoneTier === 2
        ? "expedition or gold zones"
        : "any zone chest";
  return rule.minLevel > 1 ? tr("Level {0}+ · {1}", { 0: rule.minLevel, 1: zone }) : tr("Any level · {0}", { 0: zone });
}
/**
 * The cosmetic set bonus for the worn pair, or null. Both slots must hold
 * different editions of the same set.
 */
export function activeAuraSet(
  above?: { edition?: string | null; name?: string | null; color?: string | null } | null,
  below?: { edition?: string | null; name?: string | null; color?: string | null } | null,
) {
  if (!above || !below) return null;
  const a = catalogEditionFor(above),
    b = catalogEditionFor(below);
  if (!a || !b || a.id === b.id || a.set !== b.set) return null;
  return auraSet(a.set);
}
export function setMembers(setId: string) {
  return AURA_CATALOG.filter((e) => e.set === setId);
}

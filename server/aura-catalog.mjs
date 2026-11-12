// Server view of the shared cosmetic Aura catalog (server/data/aura-catalog.json).
// Chest drops follow these zone/level entitlements; set bonuses are visual only.
import { readFileSync } from "node:fs";

const catalog = JSON.parse(
  readFileSync(new URL("./data/aura-catalog.json", import.meta.url), "utf8"),
);
// No capped supply (owner, 11 Nov 2026): Auras keep appearing as rewards.
// The editions table keeps a max_supply column, so "uncapped" is stored as
// the largest safe integer.
export const AURA_SUPPLY = catalog.supplyPerEdition ?? Number.MAX_SAFE_INTEGER;
export const AURA_UNCAPPED = catalog.supplyPerEdition == null;
// Collectibles builds before the uncapped-editions upgrade minted at most 256
// copies per edition on NEAR. While the deployed testnet manifest still names
// one of those builds, native token ids keep that bound; once the upgrade
// rewrites the manifest (or on a network without an older deployment) the
// on-chain editions are uncapped too.
const CAPPED_COLLECTIBLES_BUILDS = new Set([
  "52edcff46ee1a6d55bb5833838637ae4bcb986b5c0ee2620086665a9f4f96a16",
  "e2a41b19830c79a25d42634d618e89dd09d6f75305a8e0573070f7a6f8d531e9",
  "1cb649afccc9ccfb7ef2a99e29bf346e312b94915feb17fdd1c4fdfb8bf07488",
]);
function deployedCollectiblesBuild() {
  try {
    return JSON.parse(
      readFileSync(new URL("../public/native-editions-testnet.json", import.meta.url), "utf8"),
    ).wasmSha256;
  } catch {
    return null;
  }
}
export const AURA_CHAIN_CAPPED = CAPPED_COLLECTIBLES_BUILDS.has(deployedCollectiblesBuild());
/** On-chain copies per edition: 256 on the old build, otherwise unlimited. */
export const AURA_CHAIN_COPIES = AURA_CHAIN_CAPPED ? 256 : Infinity;
/** True while an edition still has an on-chain serial left. */
export const chainEditionOpen = (minted) => Number.isSafeInteger(minted) && minted >= 0 && minted < AURA_CHAIN_COPIES;
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
/** Chest editions a chest of this tier can hold. NPC and monster editions never drop from chests. */
export function entitledEditions(zoneTier, level) {
  return AURA_CATALOG.filter(
    (e) => e.source === "chest" && auraEntitled(e, zoneTier, level),
  );
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
/** Editions the collectibles contract can mint (catalog `native` flag). */
export const NATIVE_EDITIONS = Object.freeze(
  AURA_CATALOG.filter((e) => e.native).map((e) => e.id),
);
/** Editions every deployed collectibles version mints, before `supported_editions`. */
export const LEGACY_NATIVE_EDITIONS = Object.freeze(["polar", "moon", "gold"]);
const NATIVE_TOKEN = new RegExp(`^aura:(${NATIVE_EDITIONS.join("|")}):([1-9]\\d{0,9})$`);
/** Parse `aura:<edition>:<serial>` for a native edition; null otherwise. */
export function nativeAuraToken(tokenId) {
  const m = typeof tokenId === "string" ? NATIVE_TOKEN.exec(tokenId) : null;
  if (!m || Number(m[2]) > AURA_CHAIN_COPIES) return null;
  return { edition: m[1], serial: Number(m[2]) };
}
export const isNativeAuraTokenId = (value) => !!nativeAuraToken(value);
export function isNativeEdition(edition) {
  return NATIVE_EDITIONS.includes(edition);
}
/** Native edition for a demo inventory name (either catalog name), or null. */
export function nativeEditionForName(name) {
  const edition = editionForDemoName(name);
  return edition?.native ? edition.id : null;
}
/** Claim-id prefix the collectibles contract requires (CLAIM_ONLY_EDITIONS). */
export const AWARD_CLAIM_PREFIX = Object.freeze({
  chest: "earned:",
  npc: "earned:npc:",
  monster: "earned:monster:",
  level: "earned:level:",
  season: "earned:season:",
});
export function awardClaimPrefix(edition) {
  const source = AURA_CATALOG.find((e) => e.id === edition)?.source || "chest";
  return AWARD_CLAIM_PREFIX[source] || AWARD_CLAIM_PREFIX.chest;
}

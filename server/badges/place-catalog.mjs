// Place badges: notable places (peaks, viewpoints, landmarks, bigger cities)
// a player earns once by physically reaching them. The curated list lives in
// server/data/place-badges.json; badges built from the global POI pipeline
// (scripts/build-place-badges.mjs, docs/WORLDS-PLAN.md C.2) load from an extra
// file. Badges are cosmetic: they are not inventory items, cannot be listed on
// the market and never pay GOLD, XP or NEAR.
import { existsSync, readFileSync } from "node:fs";
import { distance } from "../domain.mjs";

export const PLACE_KINDS = Object.freeze(["peak", "viewpoint", "landmark", "city"]);
export const PLACE_RARITIES = Object.freeze(["common", "rare", "epic", "legendary"]);
export const KIND_ICONS = Object.freeze({ peak: "⛰️", viewpoint: "🔭", landmark: "🏛️", city: "🏙️" });
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DEFAULT_PATH = new URL("../data/place-badges.json", import.meta.url);

function check(b, source) {
  const where = `${source}: ${b?.id ?? "?"}`;
  if (!b || typeof b.id !== "string" || !ID.test(b.id) || b.id.length > 64) throw new Error(`${where}: invalid id`);
  if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 80) throw new Error(`${where}: invalid name`);
  if (!PLACE_KINDS.includes(b.kind)) throw new Error(`${where}: invalid kind`);
  if (!PLACE_RARITIES.includes(b.rarity)) throw new Error(`${where}: invalid rarity`);
  if (!(Math.abs(b.lat) <= 85 && Math.abs(b.lng) <= 180)) throw new Error(`${where}: invalid point`);
  const max = b.kind === "city" ? 20_000 : 500;
  if (!(Number.isFinite(b.radiusM) && b.radiusM >= 30 && b.radiusM <= max)) throw new Error(`${where}: invalid radius`);
  return Object.freeze({
    id: b.id,
    name: b.name,
    nameCs: typeof b.nameCs === "string" && b.nameCs ? b.nameCs : b.name,
    kind: b.kind,
    rarity: b.rarity,
    lat: b.lat,
    lng: b.lng,
    radiusM: b.radiusM,
    country: typeof b.country === "string" ? b.country : "",
    region: typeof b.region === "string" ? b.region : "",
    elevationM: Number.isFinite(b.elevationM) ? b.elevationM : null,
    note: typeof b.note === "string" ? b.note.slice(0, 160) : "",
    icon: KIND_ICONS[b.kind],
    source: source === "curated" ? "curated" : "poi",
  });
}

/** Loads the curated list plus an optional POI-built file. Ids must be unique. */
export function loadPlaceBadges({ path = DEFAULT_PATH, extraPath = null } = {}) {
  const base = JSON.parse(readFileSync(path, "utf8"));
  const badges = base.badges.map((b) => check(b, "curated"));
  let extraVersion = null;
  if (extraPath && existsSync(extraPath)) {
    const extra = JSON.parse(readFileSync(extraPath, "utf8"));
    extraVersion = String(extra.version || "poi");
    badges.push(...extra.badges.map((b) => check(b, "poi")));
  }
  const seen = new Set();
  for (const b of badges) {
    if (seen.has(b.id)) throw new Error(`place badge ${b.id} is listed twice`);
    seen.add(b.id);
  }
  return Object.freeze({
    version: extraVersion ? `${base.version}+${extraVersion}` : base.version,
    badges: Object.freeze(badges),
    byId: new Map(badges.map((b) => [b.id, b])),
  });
}

/** Badges whose radius contains the point, nearest first. */
export function placesAt(catalog, at) {
  return catalog.badges
    .map((b) => ({ badge: b, distanceM: distance(at, b) }))
    .filter((x) => x.distanceM <= x.badge.radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** The nearest badges to a point, with distance to their edge. */
export function nearestPlaces(catalog, at, { limit = 5, skip = new Set() } = {}) {
  return catalog.badges
    .filter((b) => !skip.has(b.id))
    .map((b) => {
      const d = distance(at, b);
      return { badge: b, distanceM: d, toEdgeM: Math.max(0, d - b.radiusM) };
    })
    .sort((a, b) => a.toEdgeM - b.toEdgeM)
    .slice(0, limit);
}

import { distance } from "./domain.mjs";

// Short XP "street finds" are a subset of the world's existing coin seeds, so
// they reuse the coin treasury reservation and claim path (no new GOLD).
// Greedy spacing keeps one find roughly every 150–250 m along mapped paths.
export const STREET_FIND_SPACING_M = 150;
export const STREET_FIND_MAX = 60;
export const STREET_FIND_XP = 15;
export const STREET_COIN_XP = 2;

const cache = new WeakMap();

function coinIndex(id) {
  const n = Number(String(id).split(":coin:")[1]);
  return Number.isSafeInteger(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function pickStreetFinds(
  coins,
  { spacing = STREET_FIND_SPACING_M, max = STREET_FIND_MAX } = {},
) {
  const ordered = [...coins].sort(
    (a, b) => coinIndex(a.id) - coinIndex(b.id) || (a.id < b.id ? -1 : 1),
  );
  const chosen = [];
  for (const coin of ordered) {
    if (chosen.length >= max) break;
    if (chosen.every((c) => distance(c, coin) >= spacing)) chosen.push(coin);
  }
  return new Set(chosen.map((c) => c.id));
}

// Deterministic per world: computed from every seed (claimed or not), so a
// find stays a find after neighbours are collected.
export function streetFindIds(db, worldId) {
  let byWorld = cache.get(db);
  if (!byWorld) cache.set(db, (byWorld = new Map()));
  const hit = byWorld.get(worldId);
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM coins WHERE world_id=?")
    .get(worldId).n;
  if (hit && hit.count === count) return hit.ids;
  const ids = pickStreetFinds(
    db.prepare("SELECT id,lat,lng FROM coins WHERE world_id=?").all(worldId),
  );
  if (byWorld.size > 64) byWorld.clear();
  byWorld.set(worldId, { count, ids });
  return ids;
}

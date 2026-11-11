// One coin on the street is one coin for everybody.
//
// The same H3 cell can be dropped into several worlds on one day (the GPS
// city world and the city demo arena, a compact demo day next to the
// citywide one, ...). Every drop draws its coins from the same street samples
// with the same day seed, so each world gets its own row for a coin at the
// very same spot. Two explorers standing at that spot then saw "one" coin but
// each picked up a different row, and both were paid (11 Nov 2026 testnet).
//
// A spot is the coin's exact coordinates (placement rounds them to 7
// decimals) within one game day. The first pick-up of a spot wins: claimCoin
// refuses every other row at that spot with ALREADY_CLAIMED, the map hides
// them, and the pick-up event reaches viewers of every world holding a copy.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "./schema-compatibility.mjs";

export const COIN_SPOTS_SCHEMA = registerModuleSchema({
  name: "coin-spots",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS coin_spots_schema(version INTEGER PRIMARY KEY);
CREATE INDEX IF NOT EXISTS coins_spot ON coins(lat,lng);
CREATE INDEX IF NOT EXISTS coins_spot_taken ON coins(lat,lng,world_id) WHERE claimant IS NOT NULL;
`,
});

const ready = new WeakSet();
export function ensureCoinSpots(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, COIN_SPOTS_SCHEMA);
  ready.add(db);
}

/** Another row at this coin's spot, today, that somebody already picked up. */
export function spotTakenBy(db, coin) {
  ensureCoinSpots(db);
  return (
    db
      .prepare(
        `SELECT s.id,s.claimant FROM coins s JOIN worlds w ON w.id=s.world_id
         WHERE s.lat=? AND s.lng=? AND s.id<>? AND s.claimant IS NOT NULL
           AND w.day=(SELECT day FROM worlds WHERE id=?) LIMIT 1`,
      )
      .get(coin.lat, coin.lng, coin.id, coin.world_id) || null
  );
}

/** Worlds (other than the coin's own) that hold a copy of this coin's spot today. */
export function spotWorlds(db, coinId) {
  ensureCoinSpots(db);
  return db
    .prepare(
      `SELECT DISTINCT s.world_id AS id FROM coins c
       JOIN worlds cw ON cw.id=c.world_id
       JOIN coins s ON s.lat=c.lat AND s.lng=c.lng AND s.world_id<>c.world_id
       JOIN worlds w ON w.id=s.world_id AND w.day=cw.day
       WHERE c.id=?`,
    )
    .all(String(coinId))
    .map((r) => r.id);
}

/**
 * Drops the coins whose spot was already picked up in another world today.
 * `rows` are open coins of world `worldId`.
 */
export function withoutTakenSpots(db, worldId, rows) {
  if (!rows.length) return rows;
  ensureCoinSpots(db);
  let south = Infinity,
    north = -Infinity;
  for (const c of rows) {
    if (c.lat < south) south = c.lat;
    if (c.lat > north) north = c.lat;
  }
  const taken = new Set(
    db
      .prepare(
        `SELECT s.lat,s.lng FROM coins s JOIN worlds w ON w.id=s.world_id
         WHERE s.lat BETWEEN ? AND ? AND s.claimant IS NOT NULL AND s.world_id<>?
           AND w.day=(SELECT day FROM worlds WHERE id=?)`,
      )
      .all(south, north, worldId, worldId)
      .map((s) => `${s.lat},${s.lng}`),
  );
  return taken.size ? rows.filter((c) => !taken.has(`${c.lat},${c.lng}`)) : rows;
}

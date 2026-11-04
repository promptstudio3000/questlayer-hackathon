// Storage of the daily Czechia-wide reward plan and of cell visits.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";

export const MAP_REWARDS_SCHEMA = registerModuleSchema({
  name: "map-rewards",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS map_reward_days(day TEXT PRIMARY KEY, policy TEXT NOT NULL, seed TEXT NOT NULL, root TEXT, coins_u INTEGER NOT NULL CHECK(coins_u>=0), zones_u INTEGER NOT NULL CHECK(zones_u>=0), pioneer_u INTEGER NOT NULL CHECK(pioneer_u>=0), pioneer_left_u INTEGER NOT NULL CHECK(pioneer_left_u>=0), summary TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS map_reward_cells(day TEXT NOT NULL, cell TEXT NOT NULL, coins_u INTEGER NOT NULL CHECK(coins_u>=0), zones_u INTEGER NOT NULL CHECK(zones_u>=0), zones INTEGER NOT NULL CHECK(zones BETWEEN 0 AND 3), coins INTEGER NOT NULL CHECK(coins>=0), pioneer INTEGER NOT NULL CHECK(pioneer IN (0,1)), leaf TEXT NOT NULL, PRIMARY KEY(day,cell));
CREATE TABLE IF NOT EXISTS map_cell_visits(cell TEXT PRIMARY KEY, first_day TEXT NOT NULL, last_day TEXT NOT NULL, visits INTEGER NOT NULL CHECK(visits>0));
CREATE TABLE IF NOT EXISTS map_cell_drops(world_id TEXT NOT NULL, cell TEXT NOT NULL, day TEXT NOT NULL, coins INTEGER NOT NULL, coins_u INTEGER NOT NULL, zones_u INTEGER NOT NULL, pioneer_u INTEGER NOT NULL, pioneer INTEGER NOT NULL CHECK(pioneer IN (0,1)), created_at INTEGER NOT NULL, PRIMARY KEY(world_id,cell));
CREATE TABLE IF NOT EXISTS map_coin_meta(coin_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, cell TEXT NOT NULL, tier TEXT NOT NULL CHECK(tier IN ('small','medium','rare')), wave INTEGER NOT NULL CHECK(wave BETWEEN 0 AND 11), opens_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS map_cell_drops_day ON map_cell_drops(day,cell);
CREATE INDEX IF NOT EXISTS map_coin_meta_world ON map_coin_meta(world_id,cell)`,
});

const ready = new WeakSet();
export function ensureMapRewardsSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, MAP_REWARDS_SCHEMA);
  ready.add(db);
}

// Indexes found by the 500-walker load test (npm run load:test,
// docs/PERFORMANCE-BUDGET.md "Load"). Without them two reads on every coin
// pick-up and every /api/me scan the whole coins table, which holds every
// coin of every street world of every past day:
// - street finds count a world's coins (all of them, claimed or not);
// - the profile counts the coins a player collected.
// The player's own rows (history, inventory, positions, withdrawals, wallets,
// quest claims) were read without an index on every /api/me and pick-up, so
// each read scanned every player's rows. coins_near covers the nearby-coins
// read of /api/world: lat range, lng filter and the answer come from the index
// alone instead of one table lookup per coin in the latitude band (claimant is
// in the columns only so SQLite treats the index as covering).
// Shipped as its own schema module, like map-read-indexes.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "./schema-compatibility.mjs";

export const HOT_PATH_INDEXES_SCHEMA = registerModuleSchema({
  name: "hot-path-indexes",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS hot_path_indexes(version INTEGER PRIMARY KEY);
CREATE INDEX IF NOT EXISTS coins_world ON coins(world_id);
CREATE INDEX IF NOT EXISTS coins_claimant ON coins(claimant) WHERE claimant IS NOT NULL;
CREATE INDEX IF NOT EXISTS coins_near ON coins(world_id,lat,lng,value_u,id,claimant) WHERE claimant IS NULL;
CREATE INDEX IF NOT EXISTS history_player ON history(player_id,created_at);
CREATE INDEX IF NOT EXISTS inventory_player ON inventory(player_id);
CREATE INDEX IF NOT EXISTS positions_player ON positions(player_id);
CREATE INDEX IF NOT EXISTS withdrawals_player ON withdrawals(player_id);
CREATE INDEX IF NOT EXISTS wallet_links_player ON wallet_links(player_id);
CREATE INDEX IF NOT EXISTS quest_claims_player ON quest_claims(player_id)
`,
});

export function ensureHotPathIndexes(db) {
  return ensureModuleVersion(db, HOT_PATH_INDEXES_SCHEMA);
}

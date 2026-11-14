// Retired schema module "season" v1. The season was removed on 14 Nov 2026
// (Lubos: no time-limited events for now); nothing reads or writes this table.
// It stays registered only because live databases already hold it and the
// schema check refuses unknown tables. The planned testnet DB wipe drops it,
// together with this module.
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const SEASON_SCHEMA = registerModuleSchema({
  name: "season",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS season_finishers(season_id TEXT NOT NULL,player_id TEXT NOT NULL,points INTEGER NOT NULL CHECK(points>=0),edition TEXT,item_id TEXT,data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),created_at INTEGER NOT NULL,PRIMARY KEY(season_id,player_id));
CREATE INDEX IF NOT EXISTS season_finishers_time ON season_finishers(season_id,created_at)
`,
});

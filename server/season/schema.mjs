// Schema module "season" v1 (docs/SEASON.md): one row per explorer and season
// once they reach the season goal and claim the season mark. Standings are
// derived from rows other slices already write (monster wins, boss hits, zone
// checkpoints, NPC lines), so nothing here can drift or be bought.
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const SEASON_SCHEMA = registerModuleSchema({
  name: "season",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS season_finishers(season_id TEXT NOT NULL,player_id TEXT NOT NULL,points INTEGER NOT NULL CHECK(points>=0),edition TEXT,item_id TEXT,data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),created_at INTEGER NOT NULL,PRIMARY KEY(season_id,player_id));
CREATE INDEX IF NOT EXISTS season_finishers_time ON season_finishers(season_id,created_at)
`,
});

// Schema module "daily-board" v1 (docs/GAME-LOOPS.md P0-5): one row per
// explorer and world day once the three goals are done and the bonus is
// claimed. Progress itself is derived from rows other slices already write
// (coins, quest claims, monster wins, NPC talk), so nothing here can drift.
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const DAILY_BOARD_SCHEMA = registerModuleSchema({
  name: "daily-board",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS daily_board_claims(player_id TEXT NOT NULL,day_id TEXT NOT NULL,xp INTEGER NOT NULL CHECK(xp>=0),goals TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(goals)),data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),created_at INTEGER NOT NULL,PRIMARY KEY(player_id,day_id));
CREATE INDEX IF NOT EXISTS daily_board_claims_day ON daily_board_claims(day_id,created_at)
`,
});

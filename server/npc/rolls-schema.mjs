// Schema module "npc-rolls" v1 (docs/NPC-GAMES.md): one row per earned wisp
// roll, from the signed ticket to the paid prize. No IO at import.
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const NPC_ROLLS_SCHEMA = registerModuleSchema({
  name: "npc-rolls",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS npc_rolls(roll_id TEXT PRIMARY KEY,player_id TEXT NOT NULL,account_id TEXT NOT NULL,table_id TEXT NOT NULL,secret TEXT NOT NULL,commit_hex TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('issued','started','settled')),start_height INTEGER,outcome TEXT,prize TEXT,capped INTEGER NOT NULL DEFAULT 0,reward TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(reward)),item_id TEXT UNIQUE,claim_id TEXT UNIQUE,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS npc_rolls_player ON npc_rolls(player_id,state)
`,
});

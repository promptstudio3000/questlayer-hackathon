// Schema module "monster-hunt" v1 (docs/NPC-PLAN.md §13.4–13.6, slices M3+M4):
// idempotent reward rows for monster wins and crafting, the weekly boss event
// with its shared HP pool, and one row per boss hit. The shared actors v1
// tables stay untouched (shards still live in actor_shards).
import { registerModuleSchema } from "../../schema-compatibility.mjs";

export const HUNT_SCHEMA = registerModuleSchema({
  name: "monster-hunt",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS monster_rewards(player_id TEXT NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('xp','shard','roll','edition','craft')),amount INTEGER NOT NULL,day_id TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),created_at INTEGER NOT NULL,PRIMARY KEY(player_id,source,kind));
CREATE INDEX IF NOT EXISTS monster_rewards_day ON monster_rewards(player_id,kind,day_id);
CREATE TABLE IF NOT EXISTS monster_boss_events(id TEXT PRIMARY KEY,city_id TEXT NOT NULL,week_id TEXT NOT NULL,actor_id TEXT NOT NULL,max_hp INTEGER NOT NULL CHECK(max_hp>0),hp INTEGER NOT NULL CHECK(hp>=0),state TEXT NOT NULL CHECK(state IN('active','defeated')),data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),created_at INTEGER NOT NULL,defeated_at INTEGER);
CREATE TABLE IF NOT EXISTS monster_boss_hits(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,player_id TEXT NOT NULL,format TEXT NOT NULL,seed TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('open','landed','missed','expired')),damage INTEGER NOT NULL DEFAULT 0 CHECK(damage>=0),score INTEGER,created_at INTEGER NOT NULL,finished_at INTEGER);
CREATE INDEX IF NOT EXISTS monster_boss_hits_player ON monster_boss_hits(event_id,player_id,created_at)
`,
});

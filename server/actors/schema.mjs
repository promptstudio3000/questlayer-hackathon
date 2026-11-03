// Schema module "actors" v1: every table the roaming NPC and monster slices
// share (docs/NPC-PLAN.md §14). The schema system can only loosen CHECK
// clauses in a later version, never add columns or tables, so each table
// carries a JSON `data` column for slice-specific detail.
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const ACTORS_SCHEMA = registerModuleSchema({
  name: "actors",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS actor_encounters(id TEXT PRIMARY KEY,player_id TEXT NOT NULL,actor_id TEXT NOT NULL,world_id TEXT NOT NULL,day_id TEXT NOT NULL,segment_index INTEGER NOT NULL,menu_hash TEXT NOT NULL,distance_m REAL NOT NULL,arena INTEGER NOT NULL CHECK(arena IN(0,1)),data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS actor_encounters_player ON actor_encounters(player_id,actor_id,created_at);
CREATE INDEX IF NOT EXISTS actor_encounters_expiry ON actor_encounters(expires_at);
CREATE TABLE IF NOT EXISTS actor_offers(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,player_id TEXT NOT NULL,encounter_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('quest','chapter','trade_buy','trade_sell','trade_up','challenge','roll')),terms TEXT NOT NULL CHECK(json_valid(terms)),menu_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('offered','accepted','completed','expired')),expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER);
CREATE INDEX IF NOT EXISTS actor_offers_player ON actor_offers(player_id,actor_id,created_at);
CREATE INDEX IF NOT EXISTS actor_offers_encounter ON actor_offers(encounter_id);
CREATE TABLE IF NOT EXISTS actor_relationships(player_id TEXT NOT NULL,actor_id TEXT NOT NULL,trust INTEGER NOT NULL DEFAULT 0 CHECK(trust BETWEEN 0 AND 5),notes TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(notes)),language TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(player_id,actor_id));
CREATE TABLE IF NOT EXISTS actor_progress(player_id TEXT NOT NULL,actor_id TEXT NOT NULL,day_id TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),defeats INTEGER NOT NULL DEFAULT 0 CHECK(defeats>=0),cooldown_until INTEGER,last_outcome TEXT,data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),updated_at INTEGER NOT NULL,PRIMARY KEY(player_id,actor_id,day_id));
CREATE TABLE IF NOT EXISTS actor_shards(player_id TEXT NOT NULL,element TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0 CHECK(count>=0),updated_at INTEGER NOT NULL,PRIMARY KEY(player_id,element));
CREATE TABLE IF NOT EXISTS actor_challenges(id TEXT PRIMARY KEY,encounter_id TEXT NOT NULL,player_id TEXT NOT NULL,actor_id TEXT NOT NULL,day_id TEXT NOT NULL,format TEXT NOT NULL CHECK(format IN('quiz','minigame','duel')),seed TEXT NOT NULL,spec TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(spec)),state TEXT NOT NULL CHECK(state IN('open','won','lost','expired')),result TEXT CHECK(result IS NULL OR json_valid(result)),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,submitted_at INTEGER);
CREATE INDEX IF NOT EXISTS actor_challenges_player ON actor_challenges(player_id,actor_id,created_at);
CREATE TABLE IF NOT EXISTS actor_player_fixes(player_id TEXT PRIMARY KEY,lat REAL NOT NULL,lng REAL NOT NULL,accuracy REAL,fix_at INTEGER NOT NULL,flagged INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_npc_requests(id TEXT PRIMARY KEY,player_id TEXT NOT NULL,actor_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,outcome TEXT NOT NULL CHECK(outcome IN('answered','fallback','template','limited')),reason TEXT,facts_hash TEXT NOT NULL,menu_hash TEXT,output_hash TEXT,signature_hash TEXT,attested INTEGER NOT NULL DEFAULT 0 CHECK(attested IN(0,1)),created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ai_npc_requests_player ON ai_npc_requests(player_id,created_at);
CREATE INDEX IF NOT EXISTS ai_npc_requests_time ON ai_npc_requests(created_at)
`,
});

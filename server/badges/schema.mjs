// Schema module "badges" v1 (docs/BADGES.md): place badge awards, player
// badge designs and their claims (the queue in front of questlayer_badges).
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const BADGES_SCHEMA = registerModuleSchema({
  name: "badges",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS place_badge_awards(player_id TEXT NOT NULL,badge_id TEXT NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL,accuracy REAL NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,badge_id));
CREATE INDEX IF NOT EXISTS place_badge_awards_badge ON place_badge_awards(badge_id,created_at);
CREATE TABLE IF NOT EXISTS user_badges(id TEXT PRIMARY KEY,creator_player TEXT NOT NULL,creator_account TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,icon TEXT NOT NULL,color TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('place','quest','event')),lat REAL,lng REAL,radius_m INTEGER,quest_ref TEXT,code TEXT,max_supply INTEGER NOT NULL CHECK(max_supply>0),starts_at INTEGER,ends_at INTEGER,state TEXT NOT NULL CHECK(state IN('queued','live','hidden','failed')),attempts INTEGER NOT NULL DEFAULT 0,chain_tx TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS user_badges_creator ON user_badges(creator_player,created_at);
CREATE INDEX IF NOT EXISTS user_badges_state ON user_badges(state,updated_at);
CREATE TABLE IF NOT EXISTS user_badge_claims(badge_id TEXT NOT NULL REFERENCES user_badges(id),player_id TEXT NOT NULL,account_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','minted','failed')),attempts INTEGER NOT NULL DEFAULT 0,chain_tx TEXT,token_id TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(badge_id,player_id));
CREATE UNIQUE INDEX IF NOT EXISTS user_badge_claims_account ON user_badge_claims(badge_id,account_id);
CREATE INDEX IF NOT EXISTS user_badge_claims_state ON user_badge_claims(state,updated_at)
`,
});

// Schema module "place-badge-mints" v1: every place badge a player earns is
// also minted as a soulbound NFT on questlayer_badges (docs/BADGES.md §1a).
// One sponsored design per place (creator = the badge contract itself), then
// one claim per player. account_id is resolved at mint time, so a player who
// links an account later still gets every badge they already earned.
export const PLACE_BADGE_MINTS_SCHEMA = registerModuleSchema({
  name: "place-badge-mints",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS place_badge_designs(badge_id TEXT PRIMARY KEY,chain_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN('queued','live','failed')),attempts INTEGER NOT NULL DEFAULT 0,chain_tx TEXT,error TEXT,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS place_badge_mints(player_id TEXT NOT NULL,badge_id TEXT NOT NULL,account_id TEXT,state TEXT NOT NULL CHECK(state IN('queued','minted','failed')),attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,chain_tx TEXT,token_id TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(player_id,badge_id));
CREATE INDEX IF NOT EXISTS place_badge_mints_queue ON place_badge_mints(state,next_at)
`,
});

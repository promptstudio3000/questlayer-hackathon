// GOLD spending (QGOLD build plan, stream 4): every spend is a burn row, so
// the same rows become `ft_burn` memos once the QGOLD vault is live. Until
// then a burn takes practice GOLD out of players.gold_u for good.
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const GOLD_SPEND_SCHEMA = registerModuleSchema({
  name: "gold-spend",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS gold_burns(
 id TEXT PRIMARY KEY,
 player_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('emote','cosmetic','gear','altar','lure','shout','topic')),
 ref TEXT NOT NULL,
 amount_u INTEGER NOT NULL CHECK(amount_u>0),
 memo TEXT NOT NULL,
 realm TEXT NOT NULL DEFAULT 'practice' CHECK(realm IN ('practice','qgold')),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gold_burns_player ON gold_burns(player_id,created_at);
CREATE INDEX IF NOT EXISTS gold_burns_kind ON gold_burns(kind,created_at);
CREATE TABLE IF NOT EXISTS gold_unlocks(
 player_id TEXT NOT NULL,
 sku TEXT NOT NULL,
 burn_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,sku)
);
CREATE TABLE IF NOT EXISTS gold_looks(
 player_id TEXT PRIMARY KEY,
 frame TEXT,
 emote TEXT,
 emote_until INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gold_lures(
 id TEXT PRIMARY KEY,
 player_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('monster','trader','beacon')),
 world_id TEXT NOT NULL,
 actor_id TEXT,
 actor_name TEXT,
 poi_id TEXT NOT NULL,
 poi_name TEXT NOT NULL DEFAULT '',
 lat REAL NOT NULL,
 lng REAL NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL,
 burn_id TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gold_lures_live ON gold_lures(ends_at);
CREATE INDEX IF NOT EXISTS gold_lures_actor ON gold_lures(world_id,actor_id,ends_at);
CREATE TABLE IF NOT EXISTS place_threads(
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('shout','topic')),
 author TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '',
 text TEXT NOT NULL,
 lat REAL NOT NULL,
 lng REAL NOT NULL,
 cell TEXT NOT NULL,
 place TEXT NOT NULL DEFAULT '',
 paid_until INTEGER NOT NULL,
 free_forever INTEGER NOT NULL DEFAULT 0 CHECK(free_forever IN (0,1)),
 state TEXT NOT NULL CHECK(state IN ('published','hidden','deleted','archived')),
 posts INTEGER NOT NULL DEFAULT 0,
 authors INTEGER NOT NULL DEFAULT 1,
 reads INTEGER NOT NULL DEFAULT 0,
 paid_u INTEGER NOT NULL DEFAULT 0,
 last_post_at INTEGER NOT NULL,
 last_read_at INTEGER NOT NULL,
 social_account TEXT,
 social_mutation TEXT,
 social_state TEXT NOT NULL DEFAULT 'none' CHECK(social_state IN ('none','prepared','confirmed')),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS place_threads_cell ON place_threads(cell,state,paid_until);
CREATE INDEX IF NOT EXISTS place_threads_author ON place_threads(author,state);
CREATE TABLE IF NOT EXISTS place_posts(
 id TEXT PRIMARY KEY,
 thread_id TEXT NOT NULL,
 author TEXT NOT NULL,
 text TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('published','hidden','deleted')),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS place_posts_thread ON place_posts(thread_id,created_at);
CREATE INDEX IF NOT EXISTS place_posts_author ON place_posts(author,created_at);
CREATE TABLE IF NOT EXISTS place_reads(
 thread_id TEXT NOT NULL,
 player_id TEXT NOT NULL,
 read_at INTEGER NOT NULL,
 PRIMARY KEY(thread_id,player_id)
);
CREATE TABLE IF NOT EXISTS place_follows(
 player_id TEXT NOT NULL,
 target_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,target_id)
);
CREATE TABLE IF NOT EXISTS place_reports(
 target_id TEXT NOT NULL,
 reporter_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(target_id,reporter_id)
)`,
});

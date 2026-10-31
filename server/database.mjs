import { defaultDatabasePath } from "./state-path.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import {
  preflightDatabase,
  inspectDatabaseSchema,
  recordSchemaVersions,
} from "./schema-compatibility.mjs";
import { dirname } from "node:path";
import { GOLD, id, hash, dayKey, levelFor, assert } from "./domain.mjs";

export function openDatabase(
  path = defaultDatabasePath(),
) {
  if (path !== ":memory:" && existsSync(path)) preflightDatabase(path);
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE",
    );
    db.exec(`
    CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, name TEXT NOT NULL, gold_u INTEGER NOT NULL DEFAULT 0 CHECK(gold_u>=0), xp INTEGER NOT NULL DEFAULT 0, appearance TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY, day TEXT NOT NULL, region TEXT NOT NULL, timezone TEXT NOT NULL, manifest TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS coins(id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), lat REAL NOT NULL, lng REAL NOT NULL, value_u INTEGER NOT NULL, claimant TEXT REFERENCES players(id), claimed_at INTEGER);
    CREATE TABLE IF NOT EXISTS quests(id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), title TEXT NOT NULL, description TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, tier INTEGER NOT NULL, gold_u INTEGER NOT NULL, xp INTEGER NOT NULL, kind TEXT NOT NULL, opens_at INTEGER NOT NULL, closes_at INTEGER NOT NULL, claimant TEXT REFERENCES players(id), claimed_at INTEGER);
    CREATE TABLE IF NOT EXISTS quest_claims(quest_id TEXT NOT NULL REFERENCES quests(id), player_id TEXT NOT NULL REFERENCES players(id), created_at INTEGER NOT NULL, PRIMARY KEY(quest_id,player_id));
    CREATE TABLE IF NOT EXISTS treasury(bucket TEXT PRIMARY KEY, available_u INTEGER NOT NULL CHECK(available_u>=0), reserved_u INTEGER NOT NULL DEFAULT 0 CHECK(reserved_u>=0), paid_u INTEGER NOT NULL DEFAULT 0 CHECK(paid_u>=0));
    CREATE TABLE IF NOT EXISTS treasury_events(id TEXT PRIMARY KEY, kind TEXT NOT NULL, coins_u INTEGER NOT NULL, zones_u INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), kind TEXT NOT NULL, title TEXT NOT NULL, gold_u INTEGER NOT NULL DEFAULT 0, meta TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS positions(id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), pool TEXT NOT NULL, active_u INTEGER NOT NULL CHECK(active_u>=0), contribution INTEGER NOT NULL CHECK(contribution BETWEEN 0 AND 100), matures_at INTEGER NOT NULL, accrued_u INTEGER NOT NULL DEFAULT 0, settled_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS withdrawals(id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), amount_u INTEGER NOT NULL, ready_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory(id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), kind TEXT NOT NULL, name TEXT NOT NULL, rarity TEXT NOT NULL, slot TEXT NOT NULL, color TEXT NOT NULL, equipped INTEGER NOT NULL DEFAULT 0, serial INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS editions(name TEXT PRIMARY KEY, minted INTEGER NOT NULL, max_supply INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS listings(id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES inventory(id), seller TEXT NOT NULL REFERENCES players(id), price_u INTEGER NOT NULL CHECK(price_u>0), state TEXT NOT NULL DEFAULT 'open', buyer TEXT REFERENCES players(id), created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS unique_open_listing ON listings(item_id) WHERE state='open';
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), text TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, image TEXT, author_fix TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS presence(player_id TEXT PRIMARY KEY REFERENCES players(id), lat REAL NOT NULL, lng REAL NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS presence_revocations(player_id TEXT NOT NULL REFERENCES players(id), lease_id TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(player_id,lease_id));
    CREATE INDEX IF NOT EXISTS presence_revocations_expiry ON presence_revocations(expires_at);
    CREATE TABLE IF NOT EXISTS geo_cache(region TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_challenges(id TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS wallet_links(account_id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), verified_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS external_links(address TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), data TEXT NOT NULL, verified_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bounties(id TEXT PRIMARY KEY, creator TEXT NOT NULL REFERENCES players(id), title TEXT NOT NULL, description TEXT NOT NULL, amount_u INTEGER NOT NULL CHECK(amount_u>0), lat REAL NOT NULL, lng REAL NOT NULL, deadline INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'open', winner TEXT REFERENCES players(id), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bounty_submissions(id INTEGER PRIMARY KEY AUTOINCREMENT, bounty_id TEXT NOT NULL REFERENCES bounties(id), player_id TEXT NOT NULL REFERENCES players(id), evidence TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS native_awards(item_id TEXT PRIMARY KEY REFERENCES inventory(id),claim_id TEXT UNIQUE NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),receiver_id TEXT NOT NULL,edition TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('issued','minted')),expires_at INTEGER NOT NULL,token_id TEXT,created_at INTEGER NOT NULL,confirmed_at INTEGER);
    CREATE TABLE IF NOT EXISTS world_blueprints(id TEXT PRIMARY KEY,city_id TEXT NOT NULL,day TEXT NOT NULL,source_hash TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS world_jobs(id TEXT PRIMARY KEY,city_id TEXT NOT NULL,day TEXT NOT NULL,source_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('queued','running','ready','failed')),attempts INTEGER NOT NULL DEFAULT 0,run_after INTEGER NOT NULL,lease_owner TEXT,lease_until INTEGER,last_error TEXT,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS world_job_schedule ON world_jobs(state,run_after,lease_until);
    CREATE TABLE IF NOT EXISTS daily_jobs(job_key TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  `);
    db.prepare(
      "INSERT OR IGNORE INTO treasury(bucket,available_u) VALUES (?,?)",
    ).run("coins", 50_000 * GOLD);
    db.prepare(
      "INSERT OR IGNORE INTO treasury(bucket,available_u) VALUES (?,?)",
    ).run("zones", 50_000 * GOLD);
    db.prepare("INSERT OR IGNORE INTO treasury_events VALUES (?,?,?,?,?)").run(
      "initial-demo-sponsor",
      "demo-sponsor",
      50_000 * GOLD,
      50_000 * GOLD,
      Date.now(),
    );
    if (
      !db
        .prepare("PRAGMA table_info(positions)")
        .all()
        .some((c) => c.name === "eligible_contribution")
    )
      db.exec(
        "ALTER TABLE positions ADD COLUMN eligible_contribution INTEGER NOT NULL DEFAULT 0",
      );
    if (
      !db
        .prepare("PRAGMA table_info(presence)")
        .all()
        .some((c) => c.name === "arena")
    )
      db.exec(
        "ALTER TABLE presence ADD COLUMN arena INTEGER NOT NULL DEFAULT 1",
      );
    if (
      !db
        .prepare("PRAGMA table_info(presence)")
        .all()
        .some((c) => c.name === "lease_id")
    )
      db.exec(
        "ALTER TABLE presence ADD COLUMN lease_id TEXT NOT NULL DEFAULT ''",
      );
    const playerColumns = db.prepare("PRAGMA table_info(players)").all();
    if (!playerColumns.some((c) => c.name === "native_outfit"))
      db.exec(
        "ALTER TABLE players ADD COLUMN native_outfit INTEGER NOT NULL DEFAULT 0",
      );
    if (!playerColumns.some((c) => c.name === "native_account"))
      db.exec("ALTER TABLE players ADD COLUMN native_account TEXT");
    const questColumns = db.prepare("PRAGMA table_info(quests)").all();
    if (!questColumns.some((c) => c.name === "zone_id"))
      db.exec("ALTER TABLE quests ADD COLUMN zone_id TEXT");
    if (!questColumns.some((c) => c.name === "metadata"))
      db.exec(
        "ALTER TABLE quests ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'",
      );
    db.exec(
      "CREATE TABLE IF NOT EXISTS quest_progress(quest_id TEXT NOT NULL REFERENCES quests(id),player_id TEXT NOT NULL REFERENCES players(id),checkpoint INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(quest_id,player_id))",
    );
    // Translate only application-authored catalog entries. IDs, geography, claims and user content are preserved.
    const catalog = [
      ["Zahrada tichých duchů", "Quiet Spirit Garden"],
      ["Náměstí malých zázraků", "Little Wonders Square"],
      ["Stezka světlušek", "Firefly Trail"],
      ["Poklad za rohem", "Around the Corner"],
      ["Výprava za obzor", "Beyond the Horizon"],
      ["Měsíční útočiště", "Moonlit Sanctuary"],
      ["Pozdrav zahradě", "A Garden Hello"],
      ["Najdi ukrytý příběh", "Find a Hidden Story"],
      ["Otevři cestovatelskou truhlu", "Open the Explorer Chest"],
      ["Výprava za světlem", "Follow the Light"],
      ["Tajemství staré stezky", "The Old Trail Secret"],
      ["Zlatá výprava", "The Golden Expedition"],
      ["Polární záře", "Northern Lights"],
      ["Měsíční kruh", "Moon Ring"],
      ["Zlatý prach", "Golden Dust"],
    ];
    for (const [before, after] of catalog) {
      db.prepare("UPDATE quests SET title=? WHERE title=?").run(after, before);
      db.prepare("UPDATE inventory SET name=? WHERE name=?").run(after, before);
      db.prepare("UPDATE editions SET name=? WHERE name=?").run(after, before);
    }
    for (const row of db.prepare("SELECT id,manifest FROM worlds").all()) {
      let text = row.manifest;
      for (const [a, b] of catalog) text = text.replaceAll(a, b);
      if (text !== row.manifest)
        db.prepare("UPDATE worlds SET manifest=? WHERE id=?").run(text, row.id);
    }
    db.prepare("UPDATE quests SET description=? WHERE description=?").run(
      "Reach the marked point, confirm your visit and collect your reward.",
      "Dojdi k označenému bodu. Potvrď návštěvu a získej odměnu.",
    );
    db.prepare("UPDATE quests SET description=? WHERE description=?").run(
      "Reach the treasure chest and discover a new Aura.",
      "Dojdi k truhle a objev novou Auru.",
    );
    recordSchemaVersions(db);
    db.exec("COMMIT; PRAGMA journal_mode=WAL");
    return db;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    db.close();
    throw error;
  }
}
export function atomic(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function history(db, player, kind, title, gold = 0, meta = {}) {
  db.prepare("INSERT INTO history VALUES (?,?,?,?,?,?,?)").run(
    id("event"),
    player,
    kind,
    title,
    gold,
    JSON.stringify(meta),
    Date.now(),
  );
}
export function playerView(db, playerId) {
  const player = db.prepare("SELECT * FROM players WHERE id=?").get(playerId);
  const progression = demoProgression(db, playerId, player);
  return {
    ...player,
    ...progression,
    appearance: JSON.parse(player.appearance),
    positions: db
      .prepare("SELECT * FROM positions WHERE player_id=?")
      .all(playerId),
    withdrawals: db
      .prepare(
        "SELECT * FROM withdrawals WHERE player_id=? ORDER BY created_at DESC",
      )
      .all(playerId),
    inventory: db
      .prepare(
        "SELECT i.*,a.claim_id AS native_claim_id,a.receiver_id AS native_claim_receiver,a.state AS native_claim_state,a.expires_at AS native_claim_expires_at,a.token_id AS native_token_id FROM inventory i LEFT JOIN native_awards a ON a.item_id=i.id WHERE i.player_id=? ORDER BY i.created_at",
      )
      .all(playerId),
    history: db
      .prepare(
        "SELECT * FROM history WHERE player_id=? ORDER BY created_at DESC LIMIT 80",
      )
      .all(playerId),
    wallets: db
      .prepare(
        "SELECT account_id,verified_at FROM wallet_links WHERE player_id=?",
      )
      .all(playerId),
  };
}
// Existing commitments survive publication shutdown. This read creates no creator
// tables and changes neither cumulative earned XP nor inventory/reward grants.
export function demoProgression(db, playerId, row) {
  const player =
    row || db.prepare("SELECT xp FROM players WHERE id=?").get(playerId);
  assert(player, "Player not found.", 404);
  const hasCommitments = !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_xp_commitments'",
    )
    .get();
  const lockedXp = hasCommitments
    ? db
        .prepare(
          "SELECT COALESCE(SUM(amount),0) AS n FROM creator_xp_commitments WHERE author=? AND released_at IS NULL",
        )
        .get(playerId).n
    : 0;
  const earnedXp = player.xp;
  assert(
    Number.isSafeInteger(earnedXp) &&
      Number.isSafeInteger(lockedXp) &&
      earnedXp >= lockedXp &&
      lockedXp >= 0,
    "Creator XP accounting needs reconciliation.",
    503,
    "CREATOR_XP_INVARIANT",
  );
  const availableXp = earnedXp - lockedXp;
  return { earnedXp, lockedXp, availableXp, level: levelFor(availableXp) };
}
export function createPlayer(db, name, now = Date.now()) {
  const player = id("player");
  db.prepare(
    "INSERT INTO players(id,name,gold_u,created_at) VALUES (?,?,?,?)",
  ).run(player, name, 120_000 * GOLD, now);
  history(
    db,
    player,
    "welcome",
    "Welcome to your first adventure",
    120_000 * GOLD,
    { source: "demo-faucet", network: "demo" },
  );
  db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    id("item"),
    player,
    "avatar",
    "Explorer",
    "common",
    "avatar",
    "#b8a1ed",
    1,
    null,
    now,
  );
  return player;
}

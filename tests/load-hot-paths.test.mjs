// Fixes from the 500-walker load test (npm run load:test,
// docs/PERFORMANCE-BUDGET.md "Load"): hot-path indexes, the statement cache
// and the street-find cache.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, cachePreparedStatements } from "../server/database.mjs";
import { DatabaseSync } from "node:sqlite";
import {
  ensureHotPathIndexes,
  HOT_PATH_INDEXES_SCHEMA,
} from "../server/hot-path-indexes.mjs";
import { ensureMapReadIndexes } from "../server/map-read-indexes.mjs";
import { inspectDatabaseSchema } from "../server/schema-compatibility.mjs";
import "../server/schema-catalog.mjs";
import {
  streetFindIds,
  STREET_FIND_CACHE_SIZE,
} from "../server/street-finds.mjs";

const plan = (db, sql, n) =>
  db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...Array(n).fill("x"))
    .map((r) => r.detail)
    .join(" | ");

test("hot-path indexes install twice as a module the schema check accepts", () => {
  const db = openDatabase(":memory:");
  ensureMapReadIndexes(db);
  ensureHotPathIndexes(db);
  ensureHotPathIndexes(db);
  inspectDatabaseSchema(db);
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name);
  for (const name of Object.keys(HOT_PATH_INDEXES_SCHEMA.indexes))
    assert.ok(names.includes(name), name);
  db.close();
});

test("per-request reads use an index instead of scanning every player's rows", () => {
  const db = openDatabase(":memory:");
  ensureMapReadIndexes(db);
  ensureHotPathIndexes(db);
  const reads = [
    ["SELECT COUNT(*) AS n FROM coins WHERE world_id=?", 1, /COVERING INDEX coins_world/],
    ["SELECT COUNT(*) AS n FROM coins WHERE claimant=?", 1, /COVERING INDEX coins_claimant/],
    [
      "SELECT id,lat,lng,value_u,claimant FROM coins WHERE world_id=? AND claimant IS NULL AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
      5,
      /COVERING INDEX coins_near/,
    ],
    ["SELECT * FROM history WHERE player_id=? ORDER BY created_at DESC LIMIT 80", 1, /history_player/],
    ["SELECT * FROM inventory WHERE player_id=?", 1, /inventory_player/],
    ["SELECT * FROM positions WHERE player_id=?", 1, /positions_player/],
    ["SELECT * FROM withdrawals WHERE player_id=?", 1, /withdrawals_player/],
    ["SELECT account_id FROM wallet_links WHERE player_id=?", 1, /wallet_links_player/],
    ["SELECT count(*) n FROM quest_claims WHERE player_id=?", 1, /quest_claims_player/],
  ];
  for (const [sql, n, index] of reads) {
    const detail = plan(db, sql, n);
    assert.match(detail, index, sql);
    assert.doesNotMatch(detail, /^SCAN/, sql);
  }
  db.close();
});

test("the statement cache reuses one statement per SQL text and keeps working", () => {
  const db = cachePreparedStatements(new DatabaseSync(":memory:"));
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
  const insert = db.prepare("INSERT INTO t(v) VALUES (?)");
  assert.equal(db.prepare("INSERT INTO t(v) VALUES (?)"), insert);
  insert.run("a");
  db.prepare("INSERT INTO t(v) VALUES (?)").run("b");
  assert.deepEqual(
    db.prepare("SELECT v FROM t ORDER BY id").all().map((r) => r.v),
    ["a", "b"],
  );
  // A schema change after the statement was cached: SQLite re-prepares it.
  const read = db.prepare("SELECT * FROM t WHERE id=?");
  db.exec("ALTER TABLE t ADD COLUMN w TEXT DEFAULT 'x'");
  assert.deepEqual({ ...db.prepare("SELECT * FROM t WHERE id=?").get(1) }, { id: 1, v: "a", w: "x" });
  assert.equal(db.prepare("SELECT * FROM t WHERE id=?"), read);
  db.close();
});

test("street finds stay cached per world with many worlds open", () => {
  const db = openDatabase(":memory:");
  db.prepare(
    "INSERT INTO worlds VALUES ('w-hot','2026-11-03','r','Europe/Prague','{}',0)",
  ).run();
  for (let i = 0; i < 5; i++)
    db.prepare("INSERT INTO coins(id,world_id,lat,lng,value_u) VALUES (?,?,?,?,1)").run(
      `w-hot:coin:${i}`,
      "w-hot",
      49.2 + i * 0.01,
      16.6,
    );
  const first = streetFindIds(db, "w-hot");
  // More other worlds than the old clear-at-64 cache held, the hot one
  // touched in between: it keeps its entry.
  for (let i = 0; i < 200; i++) {
    streetFindIds(db, `w-${i}`);
    if (i % 20 === 0) assert.equal(streetFindIds(db, "w-hot"), first);
  }
  assert.ok(STREET_FIND_CACHE_SIZE >= 512);
  assert.equal(streetFindIds(db, "w-hot"), first);
  assert.equal(first.size, 5);
  db.close();
});

// Performance budget for the map reads (docs/PERFORMANCE-BUDGET.md).
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import {
  NEAR_RADIUS_M,
  NEAR_COIN_LIMIT,
  nearQuery,
} from "../server/spatial/world-query.mjs";
import {
  ensureMapReadIndexes,
  MAP_READ_INDEXES_SCHEMA,
} from "../server/map-read-indexes.mjs";
import { inspectDatabaseSchema } from "../server/schema-compatibility.mjs";
import "../server/schema-catalog.mjs";
import { LIST_HORIZON_MS } from "../server/actors/service.mjs";

const now = Date.parse("2026-11-02T12:00:00Z");
const meters = (a, b) =>
  Math.hypot(
    (b.lat - a.lat) * 111320,
    (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180),
  );
// The budget, in one place. Raise a number only on purpose.
const BUDGET = { worldNearKb: 220, coinsNear: NEAR_COIN_LIMIT };

test("near mode sends only the coins around the player and keeps every zone and quest", async () => {
  const db = openDatabase(":memory:");
  const player = createPlayer(db, "Budget", now);
  const w = await ensureWorld(db, HOME, true, now);
  const full = worldView(db, w.id, player, { now });
  const here = full.coins[0];
  const near = worldView(db, w.id, player, { now, near: `${here.lat},${here.lng}` });
  assert.ok(near.coins.length > 0);
  assert.ok(near.coins.length <= BUDGET.coinsNear);
  assert.ok(near.coins.every((c) => meters(here, c) <= NEAR_RADIUS_M + 1));
  const inside = full.coins.filter((c) => meters(here, c) <= NEAR_RADIUS_M - 1);
  if (inside.length <= NEAR_COIN_LIMIT)
    assert.ok(inside.every((c) => near.coins.some((n) => n.id === c.id)));
  assert.equal(near.zones.length, full.zones.length);
  assert.equal(near.quests.length, full.quests.length);
  assert.deepEqual(near.coinsNear, { lat: here.lat, lng: here.lng, radiusM: NEAR_RADIUS_M });
  assert.ok(
    Buffer.byteLength(JSON.stringify(near)) / 1024 <= BUDGET.worldNearKb,
    "near world payload is over budget",
  );
  assert.equal(full.coinsNear, undefined);
  db.close();
});

test("near input is validated", () => {
  assert.equal(nearQuery(undefined), null);
  assert.deepEqual(nearQuery("49.2,16.6"), { lat: 49.2, lng: 16.6 });
  assert.throws(() => nearQuery("abc"), /near=lat,lng/);
  assert.throws(() => nearQuery({ lat: 99, lng: 0 }), /near=lat,lng/);
});

test("map read indexes install as a module the schema check accepts", () => {
  const db = openDatabase(":memory:");
  ensureMapReadIndexes(db);
  ensureMapReadIndexes(db);
  inspectDatabaseSchema(db);
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('coins','quests')")
    .all()
    .map((r) => r.name);
  for (const name of Object.keys(MAP_READ_INDEXES_SCHEMA.indexes))
    assert.ok(names.includes(name), name);
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM coins WHERE world_id=? AND claimant IS NULL AND lat BETWEEN ? AND ?")
    .all("w", 0, 1)
    .map((r) => r.detail)
    .join(" ");
  assert.match(plan, /coins_world_open/);
  db.close();
});

test("actor lists stay short: 20 minutes of walk per refetch", () => {
  assert.ok(LIST_HORIZON_MS <= 30 * 60_000);
});

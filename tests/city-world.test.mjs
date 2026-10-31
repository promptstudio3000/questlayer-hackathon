import test from "node:test";
import assert from "node:assert/strict";
import { booleanValid, feature } from "@turf/turf";
import {
  PLZEN,
  buildCityZones,
  polygonGap,
  contains,
} from "../server/spatial/city-pack.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { advanceRoute, claimQuest } from "../server/game.mjs";
const now = Date.parse("2026-11-02T12:00:00Z");
test("365 city manifests keep six distinct sectors and at least 250m of polygon separation", () => {
  let minimum = Infinity;
  for (let day = 0; day < 365; day++) {
    const date = new Date(Date.UTC(2026, 0, 1 + day))
        .toISOString()
        .slice(0, 10),
      zones = buildCityZones(PLZEN, date);
    assert.equal(zones.length, 6, date);
    assert.equal(new Set(zones.map((z) => z.sector)).size, 6, date);
    for (const z of zones) {
      assert.ok(booleanValid(feature(z.geometry)));
      assert.equal(z.targets.length, 3);
      for (const p of z.targets) assert.ok(contains(z.geometry, p));
    }
    for (let i = 0; i < zones.length; i++)
      for (let j = i + 1; j < zones.length; j++) {
        const gap = polygonGap(zones[i].geometry, zones[j].geometry);
        assert.ok(gap >= 250, `${date}: ${gap}`);
        minimum = Math.min(minimum, gap);
      }
  }
  assert.ok(minimum >= 250);
});
test("city selection is deterministic but rotates across dates", () => {
  const a = buildCityZones(PLZEN, "2026-10-31"),
    again = buildCityZones(PLZEN, "2026-10-31"),
    next = buildCityZones(PLZEN, "2026-11-01");
  assert.deepEqual(a, again);
  assert.notDeepEqual(a, next);
});
test("physical mode requires the canonical polygon as well as target proximity", async () => {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Physical tester");
  const w = await ensureWorld(db, HOME, false, now),
    q = worldView(db, w.id, player).quests.find(
      (q) => q.tier === 1 && q.kind === "visit",
    );
  const stored = JSON.parse(
    db.prepare("SELECT manifest FROM worlds WHERE id=?").get(w.id).manifest,
  );
  const z = stored.zones.find((z) => z.id === q.zone_id);
  z.geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
        [0, 0.001],
        [0, 0],
      ],
    ],
  };
  db.prepare("UPDATE worlds SET manifest=? WHERE id=?").run(
    JSON.stringify(stored),
    w.id,
  );
  assert.throws(
    () =>
      claimQuest(db, player, q.id, { ...q, accuracy: 5, timestamp: now }, now),
    /Enter the marked zone/,
  );
  db.close();
});
test("ordered walking checkpoints cannot be skipped replayed or completed from one place", async () => {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Route tester");
  const w = await ensureWorld(db, HOME, true, now),
    q = worldView(db, w.id, player).quests.find(
      (q) => q.tier === 1 && q.kind === "route",
    );
  const cps = JSON.parse(
    q.metadata ||
      db.prepare("SELECT metadata FROM quests WHERE id=?").get(q.id).metadata,
  ).checkpoints;
  assert.throws(() => claimQuest(db, player, q.id, q, now), /checkpoints/);
  assert.throws(
    () => advanceRoute(db, player, q.id, cps[1], 0, now),
    /destination/,
  );
  assert.equal(
    advanceRoute(db, player, q.id, cps[0], 0, now).progress.completed,
    1,
  );
  assert.throws(
    () => advanceRoute(db, player, q.id, cps[0], 0, now),
    /Refresh/,
  );
  assert.throws(
    () => advanceRoute(db, player, q.id, cps[0], 1, now),
    /destination/,
  );
  assert.equal(
    advanceRoute(db, player, q.id, cps[1], 1, now).progress.completed,
    2,
  );
  let result;
  for (let i = 2; i < cps.length; i++)
    result = advanceRoute(db, player, q.id, cps[i], i, now);
  assert.equal(result.xp, 100);
  assert.equal(result.reward, 0);
  assert.equal(
    worldView(db, w.id, player).quests.find((x) => x.id === q.id).completed,
    1,
  );
  const replay = advanceRoute(db, player, q.id, cps.at(-1), cps.length, now);
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.id, result.result.id);
  assert.equal(
    db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp,
    100,
  );
  db.close();
});
test("exhausted Aura supply is visible and never mints beyond edition caps", async () => {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Collector");
  for (const name of ["Northern Lights", "Moon Ring", "Golden Dust"])
    db.prepare("INSERT INTO editions VALUES (?,256,256)").run(name);
  const w = await ensureWorld(db, HOME, true, now),
    q = worldView(db, w.id, player).quests.find(
      (q) => q.tier === 1 && q.kind === "chest",
    );
  assert.equal(q.itemAvailable, false);
  const result = claimQuest(db, player, q.id, q, now);
  assert.equal(result.item, null);
  assert.equal(result.xp, 80);
  db.close();
});

test("city windows include four all-day zones one three-hour zone and one one-hour zone", async () => {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Window tester");
  const w = await ensureWorld(db, HOME, true, now),
    zones = worldView(db, w.id, player).zones;
  const durations = zones
    .map((z) => (z.closesAt - z.opensAt) / 3600000)
    .sort((a, b) => a - b);
  assert.deepEqual(durations, [1, 3, 24, 24, 24, 24]);
  db.close();
});

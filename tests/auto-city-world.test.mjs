// An auto city end to end: GPS inside it gets a city world with zones, the
// "unverified map" notice, no zone prize and no native publication.
// Runs in its own process because the server reads AUTO_CITIES_DIR on import.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SYNTHETIC_ROW,
  buildSyntheticRelease,
} from "./fixtures/auto-city-fixture.mjs";

const { dir } = await buildSyntheticRelease({});
process.env.AUTO_CITIES_DIR = dir;
const { openDatabase, createPlayer } = await import("../server/database.mjs");
const { ensureWorld, worldView } = await import("../server/world.mjs");
const cityPack = await import("../server/spatial/city-pack.mjs");
const { AUTO_CITY_NOTICE } = await import("../server/spatial/auto-cities.mjs");
const now = Date.parse("2026-11-02T12:00:00Z");
const brno = { lat: SYNTHETIC_ROW.lat, lng: SYNTHETIC_ROW.lng };

test("precedence: reviewed Plzeň > auto city > H3 cell", () => {
  assert.equal(cityPack.cityFor(cityPack.PLZEN.center), cityPack.PLZEN);
  assert.equal(cityPack.cityFor(brno).id, "brno");
  assert.equal(cityPack.cityStatus("brno"), "auto");
  assert.equal(cityPack.cityStatus("plzen"), "live");
  assert.equal(cityPack.cityFor({ lat: 50.08, lng: 14.43 }), null);
  // Money paths only see reviewed live cities.
  assert.deepEqual(
    cityPack.LIVE_CITIES.map((c) => c.id),
    ["plzen"],
  );
  assert.equal(cityPack.liveCityById("brno"), null);
  assert.equal(cityPack.playableCityById("brno").id, "brno");
});

test("an auto city world has zones, the unverified notice and no zone prize", async () => {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Auto tester");
  const w = await ensureWorld(db, brno, false, now);
  assert.equal(w.region, "city-brno");
  assert.equal(w.cityId, "brno");
  assert.equal(w.cityStatus, "auto");
  assert.equal(w.quality.status, "auto");
  assert.equal(w.quality.funded, false);
  assert.equal(w.quality.notice, AUTO_CITY_NOTICE);
  assert.match(w.quality.notice, /^Unverified map/);
  assert.ok(w.zones.length > 0 && w.zones.length <= 6);
  const view = worldView(db, w.id, player);
  assert.ok(view.quests.length > 0);
  assert.ok(
    view.quests.every((q) => q.gold_u === 0),
    "no zone prize in auto cities",
  );
  assert.ok(
    view.coins.length > 0,
    "street coins from the demo bucket still appear",
  );
  const zones = db
    .prepare(
      "SELECT available_u, reserved_u FROM treasury WHERE bucket='zones'",
    )
    .get();
  assert.equal(zones.reserved_u, 0);

  // Plzeň keeps its prizes.
  const plzen = await ensureWorld(db, cityPack.PLZEN.center, false, now);
  assert.equal(plzen.cityStatus, "reviewed");
  assert.ok(worldView(db, plzen.id, player).quests.some((q) => q.gold_u > 0));
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { getOrPrepareCityPlan } from "../server/world-planner.mjs";
import { nativeManifest } from "../server/native/reward-manifest.mjs";
import { nativeMapProjection } from "../server/native/map-projection.mjs";
import { nativeWorldView } from "../src/native-game-map.ts";
function fixture() {
  const db = openDatabase(":memory:");
  const plan = getOrPrepareCityPlan(db, PLZEN, "2026-10-31");
  const m = nativeManifest(plan, {
    coins: { available: "100000000000000000000000" },
    zones: { available: "100000000000000000000000" },
  });
  return { db, m };
}
test("native display geometry matches only the exact immutable published checkpoints", () => {
  const { db, m } = fixture();
  const before = JSON.stringify(m);
  assert.equal(nativeMapProjection(db, m).zones.length, 6);
  assert(
    nativeMapProjection(db, m).zones.every(
      (z) => /^#[0-9a-f]{6}$/.test(z.color) && z.geometry.type === "Polygon",
    ),
  );
  assert.equal(nativeMapProjection(db, m).status, "verified");
  const changed = structuredClone(m);
  changed.quests[0].targets[0].lat += 0.001;
  assert.equal(nativeMapProjection(db, changed).status, "unavailable");
  assert.equal(JSON.stringify(m), before);
  db.prepare("UPDATE world_blueprints SET body_hash=?").run("bad");
  assert.equal(nativeMapProjection(db, m).status, "unavailable");
  db.close();
});
test("native map never reuses demo geometry or spendable display units during loading and errors", () => {
  const empty = nativeWorldView(null, { lat: 49, lng: 13 });
  assert.equal(empty.arena, false);
  assert.deepEqual(empty.zones, []);
  assert.deepEqual(empty.coins, []);
  const { db, m } = fixture();
  const view = nativeWorldView(
    {
      day: {
        ...m,
        map: nativeMapProjection(db, m),
        quests: m.quests.map((q) => ({ ...q, checkpoint: 1 })),
        coins: [{ ...m.coins[0], index: 0, distance: 10 }],
      },
    },
    { lat: 49, lng: 13 },
  );
  assert.equal(view.zones.length, 6);
  assert.equal(view.quests[0].nextPoint.lat, m.quests[0].targets[1].lat);
  assert.equal(view.coins[0].value_u, 0);
  assert.equal(view.quests[0].gold_u, 0);
  assert.match(view.coins[0].id, /^native-coin:/);
  db.close();
});

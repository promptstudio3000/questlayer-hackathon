// Czechia keeps its street world when no prepared global day covers a spot
// (server/world.mjs); everywhere else the prepared catalog stays the only source.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { ensureWorld } from "../server/world.mjs";

const NOW = Date.parse("2026-11-09T11:00:00Z");
const BRNO = { lat: 49.19522, lng: 16.60796 };
const mapData = {
  fetcher: async () =>
    new Response(
      JSON.stringify({
        elements: [
          {
            type: "way",
            id: 1,
            tags: { highway: "footway" },
            geometry: [
              { lat: BRNO.lat, lon: BRNO.lng },
              { lat: BRNO.lat + 0.002, lon: BRNO.lng },
            ],
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    ),
};

test("a Czech spot without a prepared day falls back to its street world", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const world = await ensureWorld(db, BRNO, false, NOW, { globalActivities: true, mapData, poiSource: null });
  assert.ok(world.id.startsWith("demo:"), world.id);
  assert.equal(world.globalPreparation, undefined);
});

test("outside Czechia, or with the fallback off, a missing day stays unavailable", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  await assert.rejects(
    ensureWorld(db, { lat: 48.1374, lng: 11.5755 }, false, NOW, { globalActivities: true, mapData, poiSource: null }),
    /No prepared discoveries/,
  );
  await assert.rejects(
    ensureWorld(db, BRNO, false, NOW, { globalActivities: true, czechiaFallback: false, mapData, poiSource: null }),
    /No prepared discoveries/,
  );
});

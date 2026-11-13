// Every spot keeps its street world when no prepared global day covers it
// (server/world.mjs); GLOBAL_STREET_FALLBACK=czechia limits that to Czechia.
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

const MUNICH = { lat: 48.1374, lng: 11.5755 };
const munichData = {
  fetcher: async () =>
    new Response(
      JSON.stringify({
        elements: [
          {
            type: "way",
            id: 2,
            tags: { highway: "footway" },
            geometry: [
              { lat: MUNICH.lat, lon: MUNICH.lng },
              { lat: MUNICH.lat + 0.002, lon: MUNICH.lng },
            ],
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    ),
};

test("outside Czechia a spot without a prepared day gets its street world too", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const world = await ensureWorld(db, MUNICH, false, NOW, { globalActivities: true, mapData: munichData, poiSource: null });
  assert.ok(world.id.startsWith("demo:"), world.id);
  assert.equal(world.coverage, "street-only");
});

test("with the fallback limited to Czechia or off, a missing day stays unavailable", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  await assert.rejects(
    ensureWorld(db, MUNICH, false, NOW, { globalActivities: true, streetFallback: "czechia", mapData: munichData, poiSource: null }),
    /No prepared discoveries/,
  );
  await assert.rejects(
    ensureWorld(db, BRNO, false, NOW, { globalActivities: true, streetFallback: "off", mapData, poiSource: null }),
    /No prepared discoveries/,
  );
});

test("the fallback scope follows the environment", async () => {
  const { streetFallbackScope } = await import("../server/world.mjs");
  assert.equal(streetFallbackScope({}), "world");
  assert.equal(streetFallbackScope({ GLOBAL_STREET_FALLBACK: "czechia" }), "czechia");
  assert.equal(streetFallbackScope({ GLOBAL_STREET_FALLBACK: "off" }), "off");
  assert.equal(streetFallbackScope({ GLOBAL_CZECHIA_FALLBACK: "off" }), "off");
});

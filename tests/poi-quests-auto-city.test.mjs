// POI quests inside auto cities (W6 + W5): per H3 cell the player loads,
// XP and cosmetics only, the "unverified map" notice kept, reviewed Plzeň
// unchanged. Own process: the server reads AUTO_CITIES_DIR on import.
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell, cellToLatLng } from "h3-js";
import {
  SYNTHETIC_ROW,
  buildSyntheticRelease,
} from "./fixtures/auto-city-fixture.mjs";

const { dir } = await buildSyntheticRelease({});
process.env.AUTO_CITIES_DIR = dir;
const { openDatabase, createPlayer } = await import("../server/database.mjs");
const { ensureWorld, worldView } = await import("../server/world.mjs");
const { claimQuest } = await import("../server/game.mjs");
const cityPack = await import("../server/spatial/city-pack.mjs");
const { AUTO_CITY_NOTICE } = await import("../server/spatial/auto-cities.mjs");
const { staticPoiSource, MIN_POI_GAP_M } = await import("../server/poi-quests.mjs");
const { distance } = await import("../server/domain.mjs");

const now = Date.parse("2026-11-02T11:00:00Z");
const brno = { lat: SYNTHETIC_ROW.lat, lng: SYNTHETIC_ROW.lng };
const cellA = latLngToCell(brno.lat, brno.lng, 7);

function grid(cell, prefix) {
  const [lat0, lng0] = cellToLatLng(cell);
  const out = [];
  let n = 0;
  for (let i = -8; i <= 8; i++)
    for (let j = -8; j <= 8; j++) {
      const lat = lat0 + (i * 150) / 110540,
        lng = lng0 + (j * 150) / (111320 * Math.cos((lat0 * Math.PI) / 180));
      if (latLngToCell(lat, lng, 7) !== cell) continue;
      out.push({ id: `${prefix}${n}`, category: n % 3 ? "fountain" : "park", name: `Spot ${n}`, notability: 0, lat, lng, h3r7: cell });
      n++;
    }
  return out;
}
// A neighbouring cell that still lies inside the synthetic city.
const [alat, alng] = cellToLatLng(cellA);
const neighbour = [0.012, -0.012]
  .flatMap((d) => [{ lat: alat + d, lng: alng }, { lat: alat, lng: alng + d * 1.5 }])
  .find((p) => latLngToCell(p.lat, p.lng, 7) !== cellA && cityPack.cityFor(p)?.id === "brno");
const cellB = neighbour ? latLngToCell(neighbour.lat, neighbour.lng, 7) : null;
const POIS = [...grid(cellA, "osm:a"), ...(cellB ? grid(cellB, "osm:b") : [])];

test("an auto city gets POI quests in the player's cell, XP only, notice kept", async () => {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Auto walker", now);
  const poiSource = staticPoiSource(POIS);
  const w = await ensureWorld(db, brno, false, now, { poiSource });
  assert.equal(w.cityStatus, "auto");
  assert.equal(w.quality.notice, AUTO_CITY_NOTICE);
  const poiZones = w.zones.filter((z) => z.source === "poi");
  assert.ok(poiZones.length > 0 && poiZones.length <= 6);
  assert.deepEqual(w.poiQuests.cells, { [cellA]: poiZones.length });
  // Spaced from each other and from the city's own zones.
  const cityTargets = w.zones.filter((z) => z.source !== "poi").flatMap((z) => z.targets || [z]);
  for (const z of poiZones)
    for (const t of z.targets)
      for (const c of cityTargets) assert.ok(distance(t, c) >= MIN_POI_GAP_M);
  const rows = db.prepare("SELECT * FROM quests WHERE id LIKE '%:quest:poi-%'").all();
  assert.ok(rows.every((q) => q.gold_u === 0 && q.tier === 1));
  assert.ok(rows.every((q) => q.id.includes(`:quest:poi-${cellA}-`)));
  // Same cell again: nothing new. Parallel loads: one set.
  await Promise.all([
    ensureWorld(db, brno, false, now + 1000, { poiSource }),
    ensureWorld(db, brno, false, now + 1000, { poiSource }),
  ]);
  assert.equal(db.prepare("SELECT count(*) n FROM quests WHERE id LIKE '%:quest:poi-%'").get().n, rows.length);
  const view = worldView(db, w.id, player, { now });
  assert.equal(view.quality.notice, AUTO_CITY_NOTICE);
  const visit = view.quests.find((q) => q.zone_id.includes(":zone:poi-") && q.kind === "visit");
  const fix = { lat: visit.lat, lng: visit.lng, accuracy: 5, timestamp: now };
  const r = claimQuest(db, player, visit.id, fix, now);
  assert.equal(r.reward, 0);
  assert.ok(r.xp > 0);
  db.close();
});

test("a second cell of the same auto city gets its own set", { skip: !cellB && "fixture city has one cell" }, async () => {
  const db = openDatabase(":memory:");
  const poiSource = staticPoiSource(POIS);
  await ensureWorld(db, brno, false, now, { poiSource });
  const w = await ensureWorld(db, neighbour, false, now, { poiSource });
  assert.deepEqual(Object.keys(w.poiQuests.cells).sort(), [cellA, cellB].sort());
  const ids = db.prepare("SELECT id FROM quests WHERE id LIKE '%:quest:poi-%'").all().map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.some((id) => id.includes(`poi-${cellB}-`)));
  const slots = w.zones.filter((z) => z.source === "poi").map((z) => z.slot);
  assert.equal(new Set(slots).size, slots.length);
  db.close();
});

test("reviewed Plzeň never gets POI quests", async () => {
  const db = openDatabase(":memory:");
  const cell = latLngToCell(cityPack.PLZEN.center.lat, cityPack.PLZEN.center.lng, 7);
  const w = await ensureWorld(db, cityPack.PLZEN.center, false, now, {
    poiSource: staticPoiSource(grid(cell, "osm:p")),
  });
  assert.equal(w.cityStatus, "reviewed");
  assert.equal(w.poiQuests, undefined);
  assert.equal(db.prepare("SELECT count(*) n FROM quests WHERE id LIKE '%:quest:poi-%'").get().n, 0);
  db.close();
});

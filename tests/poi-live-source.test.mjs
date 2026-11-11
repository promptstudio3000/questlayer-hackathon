// Live OpenStreetMap places for street cells outside the POI import
// (server/poi/live-source.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell } from "h3-js";
import { openDatabase } from "../server/database.mjs";
import { combinedPoiSource, livePoiQuery, liveOverpassPoiSource, liveRowsFromElements } from "../server/poi/live-source.mjs";
import { staticPoiSource } from "../server/poi-quests.mjs";

const AT = { lat: 48.1374, lng: 11.5755 }; // Munich
const CELL = latLngToCell(AT.lat, AT.lng, 7);
const elements = [
  { type: "way", id: 10, tags: { highway: "footway" }, geometry: [{ lat: AT.lat, lon: AT.lng - 0.002 }, { lat: AT.lat, lon: AT.lng + 0.002 }] },
  { type: "node", id: 20, lat: AT.lat + 0.0001, lon: AT.lng, tags: { historic: "memorial", name: "Old Memorial" } },
  { type: "node", id: 21, lat: AT.lat - 0.0001, lon: AT.lng + 0.001, tags: { amenity: "fountain", name: "Square Fountain" } },
  { type: "node", id: 22, lat: AT.lat, lon: AT.lng + 0.0005, tags: { military: "bunker", name: "Bunker" } },
];
const reply = () =>
  new Response(JSON.stringify({ elements }), { headers: { "content-type": "application/json" } });

test("the query covers the cell with places, public paths and grounds", () => {
  const q = livePoiQuery(CELL);
  assert.match(q, /^\[out:json\]/);
  for (const part of ["nwr[tourism]", "nwr[historic]", "way[highway~", "nwr[military]"]) assert.ok(q.includes(part), part);
  assert.match(q, /out tags geom;$/);
});

test("only safe, named places with a path target in the cell become rows", () => {
  const rows = liveRowsFromElements(elements, CELL);
  const names = rows.map((r) => r.name).sort();
  assert.ok(names.includes("Old Memorial"), JSON.stringify(rows));
  assert.ok(!names.includes("Bunker"));
  for (const r of rows) {
    assert.equal(latLngToCell(r.lat, r.lng, 7), CELL);
    assert.ok(r.category);
  }
});

test("a cell is fetched once, cached for a week and served like the POI file", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let calls = 0;
  const live = liveOverpassPoiSource(db, {
    covers: () => true,
    fetcher: async () => {
      calls++;
      return reply();
    },
  });
  assert.equal(live.cellPois(CELL), null, "unknown before the first request");
  await live.prepare(CELL);
  await live.prepare(CELL);
  assert.equal(calls, 1);
  const rows = live.cellPois(CELL);
  assert.ok(Array.isArray(rows) && rows.length >= 1);
});

test("a failed request leaves the cell unknown and retries later", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let now = 1_000_000;
  const live = liveOverpassPoiSource(db, {
    clock: () => now,
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  await live.prepare(CELL);
  assert.equal(live.cellPois(CELL), null);
});

test("the combined source keeps the import for its cells and live places elsewhere", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const file = staticPoiSource([{ id: "cz-1", h3r7: "871e30d56ffffff", category: "park", name: "Park", lat: 49.67, lng: 13.5 }]);
  const live = liveOverpassPoiSource(db, { covers: (c) => c === CELL, fetcher: async () => reply() });
  const both = combinedPoiSource(file, live);
  assert.deepEqual(both.cellPois("871e30d56ffffff").map((r) => r.id), ["cz-1"]);
  await both.prepare(CELL);
  assert.ok(both.cellPois(CELL).length >= 1);
});

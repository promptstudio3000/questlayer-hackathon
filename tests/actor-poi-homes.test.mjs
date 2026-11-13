// Generic actors live at real POIs from the W3 file (server/actors/poi-file-source.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { gridDisk, latLngToCell } from "h3-js";
import { staticPoiSource } from "../server/poi-quests.mjs";
import { actorPoiCells, poiFileActorSource } from "../server/actors/poi-file-source.mjs";
import { actorPois, registerPoiSource } from "../server/actors/pois.mjs";

const center = { lat: 49.1951, lng: 16.6068 }; // Brno
const cell = latLngToCell(center.lat, center.lng, 7);
const [, neighbour] = gridDisk(cell, 1).filter((c) => c !== cell);
const far = latLngToCell(50.0755, 14.4378, 7); // Prague
const row = (id, h3r7, notability = 0) => ({ id, h3r7, lat: center.lat + id.length * 1e-4, lng: center.lng, notability, category: "park", name: id });
const rows = [row("osm:n3", cell, 5), row("osm:n1", cell, 1), row("osm:n2", neighbour, 9), row("osm:n9", far, 99)];

test("a street cell hosts actors at the POIs of that cell only, sorted by id", () => {
  const fn = poiFileActorSource({ source: staticPoiSource(rows) });
  const out = fn({ manifest: { region: cell } });
  assert.deepEqual(out.map((p) => p.id), ["osm:n1", "osm:n3"]);
  assert.ok(out.every((p) => p.kind === "poi" && Number.isFinite(p.lat) && !("notability" in p)));
});

test("an auto city uses its centre cell and the six neighbours", () => {
  assert.equal(actorPoiCells({ manifest: { cityId: "brno" }, pack: { center } }).length, 7);
  const out = poiFileActorSource({ source: staticPoiSource(rows) })({ manifest: { cityId: "brno" }, pack: { center } });
  assert.deepEqual(out.map((p) => p.id), ["osm:n1", "osm:n2", "osm:n3"]);
});

test("the limit keeps the most notable places, still sorted by id", () => {
  const out = poiFileActorSource({ source: staticPoiSource(rows), limit: 2 })({ manifest: { cityId: "brno" }, pack: { center } });
  assert.deepEqual(out.map((p) => p.id), ["osm:n2", "osm:n3"]);
});

test("no POI file or no usable world gives no POIs", () => {
  assert.deepEqual(poiFileActorSource({ source: null })({ manifest: { region: cell } }), []);
  assert.deepEqual(poiFileActorSource({ source: { available: () => false } })({ manifest: { region: cell } }), []);
  assert.deepEqual(poiFileActorSource({ source: staticPoiSource(rows) })({ manifest: { arena: true } }), []);
});

test("registered file POIs become actor homes before path junctions", () => {
  registerPoiSource(poiFileActorSource({ source: staticPoiSource(rows) }));
  const graph = { nodes: [0], adj: [[1, 2, 3, 4, 5, 6]], lat: [center.lat], lng: [center.lng] };
  const out = actorPois({ manifest: { region: cell }, graph });
  assert.deepEqual(out.map((p) => p.id), ["poi:osm:n1", "poi:osm:n3"]);
});

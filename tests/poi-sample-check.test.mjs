// Automatic field check of POI quest targets (server/poi/sample-check.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { latLngToCell } from "h3-js";
import { compareCell, pickSample, summarize } from "../server/poi/sample-check.mjs";
import { liveRowsFromElements } from "../server/poi/live-source.mjs";

const AT = { lat: 48.1374, lng: 11.5755 };
const CELL = latLngToCell(AT.lat, AT.lng, 7);
const path = { type: "way", id: 10, tags: { highway: "footway" }, geometry: [{ lat: AT.lat, lon: AT.lng - 0.002 }, { lat: AT.lat, lon: AT.lng + 0.002 }] };
const memorial = { type: "node", id: 20, lat: AT.lat + 0.0001, lon: AT.lng, tags: { historic: "memorial", name: "Old Memorial" } };
const [live] = liveRowsFromElements([path, memorial], CELL);
const row = (id, extra = {}) => ({ id, h3r7: CELL, name: "Old Memorial", lat: live.lat, lng: live.lng, ...extra });

test("a place that is still there, safe and on its path is confirmed", () => {
  assert.equal(compareCell([row("osm:n20")], [path, memorial])[0].status, "confirmed");
});

test("gone, renamed, moved and newly excluded places are reported", () => {
  const renamed = { ...memorial, tags: { ...memorial.tags, name: "New Memorial" } };
  assert.equal(compareCell([row("osm:n20")], [path])[0].status, "gone");
  const r = compareCell([row("osm:n20")], [path, renamed])[0];
  assert.equal(r.status, "renamed");
  assert.equal(r.liveName, "New Memorial");
  const far = compareCell([row("osm:n20", { lat: live.lat + 0.001 })], [path, memorial])[0];
  assert.equal(far.status, "moved");
  assert.ok(far.movedM > 30);
  const fenced = { ...memorial, tags: { ...memorial.tags, access: "private" } };
  const ex = compareCell([row("osm:n20")], [path, fenced])[0];
  assert.equal(ex.status, "now-excluded");
  assert.ok(ex.reasons.length >= 1);
});

test("the sample is seeded, OSM only, quest-ready only, and summarized", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE poi(id TEXT, h3r7 TEXT, name TEXT, safety TEXT, path_ref TEXT)");
  const ins = db.prepare("INSERT INTO poi VALUES(?,?,?,?,?)");
  const ref = JSON.stringify({ lat: AT.lat, lng: AT.lng });
  for (let i = 0; i < 20; i++) ins.run(`osm:n${i}`, CELL, `P${i}`, "ok", ref);
  ins.run("ovt:x", CELL, "Overture", "ok", ref);
  ins.run("osm:n99", CELL, "Excluded", "excluded", null);
  const a = pickSample(db, { size: 5, seed: "s" }),
    b = pickSample(db, { size: 5, seed: "s" });
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  assert.ok(a.every((r) => r.id.startsWith("osm:") && r.id !== "osm:n99"));
  assert.notDeepEqual(pickSample(db, { size: 5, seed: "other" }).map((r) => r.id), a.map((r) => r.id));
  const s = summarize([{ status: "confirmed" }, { status: "gone" }, { status: "unchecked" }, { status: "renamed" }]);
  assert.deepEqual(s, { sampled: 4, checked: 3, byStatus: { confirmed: 1, gone: 1, unchecked: 1, renamed: 1 }, okShare: 0.667 });
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { latLngToCell } from "h3-js";
import {
  DEMO_CITIES,
  GEOFABRIK_AUTO,
  clipBox,
  parseDemoCities,
} from "../scripts/poi/demo-cities.mjs";
import { selectAutoCities } from "../scripts/poi/auto-cities.mjs";
import { pickGeofabrikExtract } from "../scripts/poi/geofabrik-index.mjs";
import { staleDemoCities } from "../scripts/poi/demo-cities-stale.mjs";
import { parseRegions } from "../scripts/poi/regions.mjs";
import { openPoiFileSource } from "../server/poi-quests.mjs";
import { combinedPoiSource } from "../server/poi/live-source.mjs";
import { CITY_REGISTRY } from "../server/spatial/city-pack.mjs";

const inBox = ({ lat, lng }, [w, s, e, n]) =>
  lng > w && lng < e && lat > s && lat < n;

test("demo cities: unique ids that fit the auto city rules, clip around the centre", () => {
  const ids = DEMO_CITIES.map((c) => c.cityId);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of DEMO_CITIES) {
    assert.match(c.cityId, /^[a-z][a-z0-9-]{1,31}$/);
    assert.match(c.id, /^city-/);
    assert.ok(inBox(c.center, c.bbox), c.cityId);
    // 8 x 8 km (demo cities) or 6 x 6 km (capitals) of latitude.
    assert.ok(Math.abs(c.bbox[3] - c.bbox[1] - (2 * c.halfKm) / 110.57) < 0.001, c.cityId);
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en", { timeZone: c.timezone }));
    if (c.source !== GEOFABRIK_AUTO)
      assert.match(c.source, /^https:\/\/download\.(bbbike\.org|openstreetmap\.fr|geofabrik\.de)\/.+\.osm\.pbf$/);
    // Never inside Czechia: those cities come from the country import.
    assert.notEqual(c.country, "CZ");
  }
  assert.deepEqual(clipBox({ lat: 0, lng: 0 }, 1), [-0.009, -0.009, 0.009, 0.009]);
});

test("demo cities: every country capital and every US state capital is listed once", () => {
  const capitals = DEMO_CITIES.filter((c) => c.wave === 4);
  assert.ok(capitals.length >= 250, String(capitals.length));
  const states = DEMO_CITIES.filter((c) => c.group === "us-state-capital").length;
  // 50 states; Denver is already a demo city.
  assert.equal(states + 1, 50);
  for (const banned of ["RU", "KP", "IR", "CZ"])
    assert.equal(DEMO_CITIES.some((c) => c.country === banned), false, banned);
  for (const name of ["Washington", "Nairobi", "Canberra", "Brasília", "Sacramento", "Juneau"])
    assert.ok(DEMO_CITIES.some((c) => c.name === name), name);
});

test("geofabrik:auto picks the smallest extract that holds the whole clip", () => {
  const sq = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
  const index = {
    features: [
      { properties: { urls: { pbf: "https://download.geofabrik.de/africa-latest.osm.pbf" } }, geometry: sq(-20, -35, 50, 38) },
      { properties: { urls: { pbf: "https://download.geofabrik.de/africa/kenya-latest.osm.pbf" } }, geometry: sq(33, -5, 42, 5) },
      { properties: { urls: { pbf: "https://download.geofabrik.de/africa/edge-latest.osm.pbf" } }, geometry: sq(36.8, -1.3, 37, -1.2) },
      { properties: { urls: { pbf: "https://evil.example/x.osm.pbf" } }, geometry: sq(36, -2, 37.5, -1) },
    ],
  };
  const nairobi = clipBox({ lat: -1.2833, lng: 36.8167 }, 3);
  assert.equal(pickGeofabrikExtract(index, nairobi), "https://download.geofabrik.de/africa/kenya-latest.osm.pbf");
  assert.equal(pickGeofabrikExtract(index, [100, 10, 101, 11]), null);
});

test("demo cities: WORLD_CITIES picks all, none, waves or ids", () => {
  assert.equal(parseDemoCities().length, DEMO_CITIES.length);
  assert.equal(parseDemoCities("off").length, 0);
  assert.ok(parseDemoCities("wave1").every((c) => c.wave === 1));
  assert.ok(parseDemoCities("capitals").every((c) => c.wave === 4));
  assert.deepEqual(parseDemoCities("london,zug").map((c) => c.cityId), ["london", "zug"]);
  assert.throws(() => parseDemoCities("atlantis"), /Unknown demo city/);
  // Country regions stay a separate list.
  assert.deepEqual(parseRegions("cz").map((r) => r.id), ["cz"]);
});

test("demo cities become pinned auto cities with their own clip; a reviewed city wins", () => {
  const reviewed = CITY_REGISTRY.allCities.map((c) => ({ id: c.id, coverage: c.coverage }));
  const london = DEMO_CITIES.find((c) => c.cityId === "london");
  const fakePlzen = { ...london, cityId: "plzen-copy", center: { lat: 49.7477, lng: 13.3776 } };
  const { cities, skipped } = selectAutoCities([], {
    countries: [],
    reviewed,
    pinned: [london, fakePlzen],
  });
  assert.deepEqual(cities.map((c) => c.id), ["london"]);
  assert.deepEqual(cities[0].coverage, [...london.bbox]);
  assert.equal(cities[0].timezone, "Europe/London");
  assert.equal(skipped[0].reason, "inside-reviewed-city");
});

test("demo cities: a release missing a listed city asks for a worker run, skipped ones do not", () => {
  const wanted = parseDemoCities("london,zug,taipei");
  assert.deepEqual(staleDemoCities(null, null, wanted).length, 3);
  assert.deepEqual(
    staleDemoCities(
      { demoCities: ["london", "zug"] },
      { demoCities: { skipped: [{ id: "city-taipei" }] } },
      wanted,
    ),
    [],
  );
  assert.deepEqual(
    staleDemoCities({ demoCities: ["london"] }, null, wanted).map((c) => c.cityId),
    ["zug", "taipei"],
  );
});

test("a cell the POI file mapped abroad is answered by the file, other cells by the live source", () => {
  const dir = mkdtempSync(join(tmpdir(), "demo-cities-"));
  try {
    const path = join(dir, "poi.sqlite"),
      db = new DatabaseSync(path);
    db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES('schema','questlayer.poi/1'),('version','c1-20261113-abc');
      CREATE TABLE poi(h3r5 TEXT, id TEXT, h3r7 TEXT, category TEXT, name TEXT, notability REAL,
        path_ref TEXT, wikidata TEXT, facts TEXT, safety TEXT);
      CREATE TABLE path_cell(h3r7 TEXT PRIMARY KEY, h3r5 TEXT, paths BLOB)`);
    const mapped = latLngToCell(51.508, -0.1281, 7),
      other = latLngToCell(40.7536, -73.9832, 7);
    db.prepare("INSERT INTO path_cell VALUES(?,?,?)").run(mapped, "x", Buffer.from(""));
    db.close();
    const file = openPoiFileSource(path);
    assert.equal(file.hasCell(mapped), true);
    assert.equal(file.hasCell(other), false);
    const asked = [];
    const live = {
      covers: (cell) => !file.hasCell(cell),
      available: () => true,
      prepare: (cell) => asked.push(cell),
      cellPois: () => [{ id: "live" }],
    };
    const source = combinedPoiSource(file, live);
    source.prepare(mapped);
    source.prepare(other);
    assert.deepEqual(asked, [other]);
    assert.deepEqual(source.cellPois(other), [{ id: "live" }]);
    assert.deepEqual(source.cellPois(mapped), []);
    file.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

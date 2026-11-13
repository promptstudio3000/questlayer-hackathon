import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { latLngToCell } from "h3-js";
import {
  DEMO_CITIES,
  clipBox,
  parseDemoCities,
} from "../scripts/poi/demo-cities.mjs";
import { selectAutoCities } from "../scripts/poi/auto-cities.mjs";
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
    // 8 x 8 km: about 0.072 degrees of latitude.
    assert.ok(Math.abs(c.bbox[3] - c.bbox[1] - 0.0724) < 0.001, c.cityId);
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en", { timeZone: c.timezone }));
    assert.match(c.source, /^https:\/\/download\.(bbbike\.org|openstreetmap\.fr|geofabrik\.de)\/.+\.osm\.pbf$/);
    // Never inside Czechia: those cities come from the country import.
    assert.notEqual(c.country, "CZ");
  }
  assert.deepEqual(clipBox({ lat: 0, lng: 0 }, 1), [-0.009, -0.009, 0.009, 0.009]);
});

test("demo cities: WORLD_CITIES picks all, none, waves or ids", () => {
  assert.equal(parseDemoCities().length, DEMO_CITIES.length);
  assert.equal(parseDemoCities("off").length, 0);
  assert.ok(parseDemoCities("wave1").every((c) => c.wave === 1));
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

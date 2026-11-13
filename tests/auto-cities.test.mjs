import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import {
  citySlug,
  coverageFor,
  halfSizeKm,
  selectAutoCities,
  buildAutoCityPacks,
  featureToWay,
} from "../scripts/poi/auto-cities.mjs";
import {
  createAutoCities,
  loadAutoCities,
  autoCitiesDir,
  AUTO_CITY_INDEX_SCHEMA,
} from "../server/spatial/auto-cities.mjs";
import { buildCityZones, PLZEN } from "../server/spatial/city-pack.mjs";
import { allocationSettings } from "../server/native/allocation.mjs";
import {
  SYNTHETIC_ROW,
  buildSyntheticRelease,
  iter,
  syntheticSources,
} from "./fixtures/auto-city-fixture.mjs";

const reviewed = [{ id: "plzen", coverage: PLZEN.coverage }];
const row = (geonameid, name, lat, lng, population, extra = {}) => ({
  geonameid,
  name,
  ascii_name: name.normalize("NFKD").replace(/[̀-ͯ]/g, ""),
  lat,
  lng,
  country: "CZ",
  population,
  timezone: "Europe/Prague",
  ...extra,
});

test("a country import leaves a demo city's box to the demo city", () => {
  const at = (id, name, lat, lng, pop) =>
    row(id, name, lat, lng, pop, { country: "AT", timezone: "Europe/Vienna" });
  const rows = [
    at(2761369, "Vienna", 48.20849, 16.37208, 1691468),
    at(7, "Floridsdorf", 48.25, 16.4, 30000),
    at(2778067, "Graz", 47.06667, 15.45, 222326),
  ];
  const viennaDemo = [16.3315, 48.1814, 16.4126, 48.2356];
  const { cities, skipped } = selectAutoCities(rows, {
    countries: ["AT"],
    reservedIds: ["vienna"],
    reservedBoxes: [viennaDemo],
  });
  assert.deepEqual(cities.map((c) => c.id), ["graz"]);
  assert.deepEqual(
    skipped.map((s) => [s.name, s.reason]),
    [
      ["Vienna", "inside-demo-city"],
      ["Floridsdorf", "inside-larger-city"],
    ],
  );
});

test("city selection: Czech cities from 15k, reviewed Plzeň wins, stable ids", () => {
  const rows = [
    row(3068799, "Plzeň", 49.7475, 13.3776, 169858),
    row(3078610, "Brno", 49.1952, 16.608, 379527),
    row(3068160, "Praha", 50.088, 14.4208, 1165581),
    row(1, "Nový Jičín", 49.5944, 18.0103, 23000),
    row(2, "Nový Jičín", 49.6, 17.9, 15500),
    row(3, "Tiny", 49.9, 15.0, 14999),
    row(4, "Wien", 48.2, 16.37, 1691468, { country: "AT" }),
    row(5, "Černice", 49.72, 13.43, 20000), // inside Plzeň coverage
    row(6, "Žižkov", 50.083, 14.45, 58267), // a Prague district
  ];
  const { cities, skipped } = selectAutoCities(rows, { reviewed });
  assert.deepEqual(
    cities.map((c) => c.id),
    ["praha", "brno", "novy-jicin", "novy-jicin-2"],
  );
  assert.deepEqual(
    skipped.map((s) => [s.name, s.reason]),
    [
      ["Plzeň", "reviewed-city-wins"],
      ["Žižkov", "inside-larger-city"],
      ["Černice", "inside-reviewed-city"],
    ],
  );
  assert.equal(citySlug("Ústí nad Labem"), "usti-nad-labem");
  assert.equal(citySlug("123"), "c-123");
  // Coverage grows with population, capped.
  assert.ok(halfSizeKm(15000) < halfSizeKm(170000));
  assert.equal(halfSizeKm(5e6), 12);
  const brno = cities.find((c) => c.id === "brno");
  assert.deepEqual(brno.coverage, coverageFor(brno.center, brno.population));
  assert.ok(
    brno.coverage[0] < brno.center.lng && brno.center.lng < brno.coverage[2],
  );
});

test("osmium features become Overpass-style ways; relations get their own ids", () => {
  const rel = featureToWay({
    properties: { "@type": "relation", "@id": 7, leisure: "park" },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [0, 1],
            [0, 0],
          ],
        ],
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      ],
    },
  });
  assert.equal(rel.cid, "osm-rel-7");
  assert.equal(rel.geometry.length, 5);
  assert.equal(featureToWay({ properties: {}, geometry: null }), null);
});

test("the builder makes an auto pack with the reviewed-pack shape and zones", async () => {
  const { built, dir } = await buildSyntheticRelease({
    zonesFor: (pack, day) => buildCityZones(pack, day).length,
  });
  assert.equal(built.packs.length, 1);
  const { pack } = built.packs[0];
  assert.equal(pack.id, "brno");
  assert.equal(pack.fieldReview, "auto");
  assert.equal(pack.status, "auto");
  assert.equal(pack.funded, false);
  assert.ok(pack.candidates.every((c) => c.fieldReview === "auto"));
  assert.equal(pack.candidates.length, 6);
  assert.equal(built.report.published, 1);
  assert.ok(built.report.cities[0].zonesPerDay.every((z) => z === 6));
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  assert.equal(index.schema, AUTO_CITY_INDEX_SCHEMA);
  assert.equal(index.funded, false);
  assert.equal(index.cities[0].sha256, built.packs[0].sha256);
  // Deterministic: the same inputs give byte-identical packs.
  const again = await buildSyntheticRelease({});
  assert.equal(again.built.packs[0].sha256, built.packs[0].sha256);
});

test("targets inside exclusion polygons are removed; a city with no zones is not published", async () => {
  const ring = (w, s, e, n) => [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
  const c = SYNTHETIC_ROW;
  // A school polygon over the whole central park.
  const school = {
    properties: { "@type": "way", "@id": 1, amenity: "school" },
    geometry: {
      type: "Polygon",
      coordinates: [
        ring(c.lng - 0.004, c.lat - 0.003, c.lng + 0.004, c.lat + 0.003),
      ],
    },
  };
  const built = await buildAutoCityPacks({
    rows: [SYNTHETIC_ROW],
    sources: syntheticSources({ exclusions: [school] }),
    version: "t-a1",
    importedAt: "2026-11-02T00:00:00.000Z",
    sampleDays: 1,
    firstDay: "2026-11-02",
  });
  const { pack } = built.packs[0];
  assert.equal(pack.candidates.length, 5);
  assert.ok(!pack.candidates.some((x) => x.name === "Central Gardens"));
  assert.equal(built.report.cities[0].removedByExclusions.candidates, 1);

  const empty = await buildAutoCityPacks({
    rows: [SYNTHETIC_ROW],
    sources: { pois: iter([]), paths: iter([]), exclusions: iter([]) },
    version: "t-a1",
    importedAt: "2026-11-02T00:00:00.000Z",
    sampleDays: 1,
  });
  assert.equal(empty.packs.length, 0);
  assert.deepEqual(empty.report.notPublished, [
    { id: "brno", reason: "no-zones" },
  ]);
});

test("runtime: reviewed wins, hashes are checked, overlaps go to the nearest centre", async () => {
  const { dir, built } = await buildSyntheticRelease({});
  const auto = loadAutoCities(dir, { reviewed, log: () => {} });
  assert.equal(auto.entries.length, 1);
  const pack = auto.cityFor(SYNTHETIC_ROW);
  assert.equal(pack.id, "brno");
  assert.equal(pack.fieldReview, "auto");
  assert.equal(auto.cityFor({ lat: 50.08, lng: 14.43 }), null);

  // Same id or centre inside a reviewed city: dropped.
  const shadowed = loadAutoCities(dir, {
    reviewed: [{ id: "brno", coverage: [0, 0, 1, 1] }],
    log: () => {},
  });
  assert.equal(shadowed.entries.length, 0);
  assert.equal(shadowed.dropped[0].reason, "reviewed-city-wins");

  // A tampered pack file disables only that city.
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  const tampered = createAutoCities(index, {
    readFile: () => built.packs[0].text.replace('"auto"', '"live"'),
    log: () => {},
  });
  assert.equal(tampered.pack("brno"), null);
  assert.equal(tampered.cityFor(SYNTHETIC_ROW), null);

  // A non-auto pack with a matching hash is still refused.
  const live = JSON.stringify({
    ...built.packs[0].pack,
    fieldReview: "pending",
  });
  const { createHash } = await import("node:crypto");
  const liveIndex = {
    ...index,
    cities: [
      {
        ...index.cities[0],
        sha256: createHash("sha256").update(live).digest("hex"),
      },
    ],
  };
  assert.equal(
    createAutoCities(liveIndex, { readFile: () => live, log: () => {} }).pack(
      "brno",
    ),
    null,
  );

  // Two overlapping boxes: the nearer centre owns the point.
  const near = {
      ...index.cities[0],
      id: "near",
      center: { lat: 49.2, lng: 16.6 },
    },
    far = { ...index.cities[0], id: "far", center: { lat: 49.18, lng: 16.58 } };
  const both = createAutoCities(
    { schema: AUTO_CITY_INDEX_SCHEMA, cities: [far, near] },
    { readFile: () => "{}", log: () => {} },
  );
  assert.equal(both.entryFor({ lat: 49.201, lng: 16.601 }).id, "near");
});

test("the index directory reloads after a worker run without a restart", async () => {
  const { dir } = await buildSyntheticRelease({});
  let t = 0;
  const auto = loadAutoCities(dir, {
    log: () => {},
    clock: () => t,
    refreshMs: 1000,
  });
  assert.equal(auto.entries.length, 1);
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  writeFileSync(
    join(dir, "index.json"),
    JSON.stringify({ ...index, cities: [] }),
  );
  // Linux file systems can keep the same mtime for a write in the same tick;
  // a worker run changes it, so move it forward explicitly.
  const later = new Date(statSync(join(dir, "index.json")).mtimeMs + 2000);
  utimesSync(join(dir, "index.json"), later, later);
  assert.equal(auto.entries.length, 1, "cached within refreshMs");
  t = 5000;
  assert.equal(auto.entries.length, 0);
});

test("auto cities are opt-out and never funded", () => {
  assert.equal(
    autoCitiesDir({ AUTO_CITIES: "0", AUTO_CITIES_DIR: "/x" }),
    null,
  );
  assert.equal(autoCitiesDir({ AUTO_CITIES_DIR: "/x" }), "/x");
  assert.equal(
    autoCitiesDir({}, () => false),
    null,
  );
  assert.throws(
    () =>
      allocationSettings(
        { NATIVE_FUNDED_CITIES: "plzen:1,brno:1" },
        { isAutoCity: (id) => id === "brno" },
      ),
    /auto city brno/,
  );
  assert.deepEqual(
    allocationSettings(
      { NATIVE_FUNDED_CITIES: "plzen:1" },
      { isAutoCity: (id) => id === "brno" },
    ).fundedCities,
    [{ id: "plzen", weight: 1 }],
  );
});

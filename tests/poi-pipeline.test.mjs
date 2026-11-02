import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildPoiDatabase,
  parseGeonamesLine,
  attributionMarkdown,
} from "../scripts/poi/build.mjs";
import { parseRegions } from "../scripts/poi/regions.mjs";
import { loadW4, stubW4 } from "../scripts/poi/lib/w4.mjs";
import * as stub from "../scripts/poi/lib/w4-stub.mjs";
import {
  overtureSql,
  wikidataQuery,
  parseWikidataBindings,
  fetchWikidata,
  collectWikidataIds,
} from "../scripts/poi/fetch.mjs";
import { FILTERS } from "../scripts/poi/extract-osm.mjs";
import {
  representativePoint,
  nearestOnSegment,
} from "../scripts/poi/lib/geo.mjs";

const fx = (name) =>
  new URL(`./fixtures/poi/${name}`, import.meta.url).pathname;
const inputs = {
  osmPois: [fx("osm-pois.geojsonseq")],
  osmPaths: [fx("osm-paths.geojsonseq")],
  osmExclusions: [fx("osm-exclusions.geojsonseq")],
  overture: [{ path: fx("overture.ndjson"), country: "CZ" }],
  wikidata: [fx("wikidata.ndjson")],
  geonames: [{ path: fx("cities15000.txt"), countries: ["CZ"] }],
};

async function build(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "poi-"));
  const outPath = join(dir, "poi-test.sqlite");
  const w4 = extra.w4 || (await stubW4());
  const manifest = await buildPoiDatabase({
    inputs: { ...inputs, ...extra, w4: undefined },
    outPath,
    version: "cz-test",
    regions: ["cz"],
    w4,
  });
  const db = new DatabaseSync(outPath, { readOnly: true });
  const rows = Object.fromEntries(
    db
      .prepare("SELECT * FROM poi")
      .all()
      .map((r) => [r.id, r]),
  );
  return { manifest, db, rows, outPath };
}

test("regions come from WORLD_REGIONS and refuse unknown ids", () => {
  assert.deepEqual(
    parseRegions("cz").map((r) => r.country),
    ["CZ"],
  );
  assert.deepEqual(
    parseRegions(" CZ,cz ").map((r) => r.id),
    ["cz"],
  );
  assert.throws(() => parseRegions("cz,xx"), /Unknown region/);
});

test("W4 loader falls back to the stub with the same interface", async () => {
  const w4 = await loadW4();
  for (const fn of ["classifyOsm", "classifyOverture", "assessPoi"])
    assert.equal(typeof w4[fn], "function");
  assert.ok(w4.taxonomyVersion && w4.safetyVersion);
  if (w4.source === "stub")
    assert.equal(w4.taxonomyVersion, stub.TAXONOMY_VERSION);
});

test("build merges OSM, Overture and Wikidata with the C.2.2 rules", async () => {
  const { manifest, db, rows } = await build();
  // OSM park kept, Overture duplicate folded into it as a second source.
  const park = rows["osm:w1"];
  assert.equal(park.category, "park");
  assert.equal(park.safety, "ok");
  assert.deepEqual(
    JSON.parse(park.sources).map((s) => s.source),
    ["osm", "overture"],
  );
  assert.ok(JSON.parse(park.path_ref).distanceM <= 40);
  assert.equal(JSON.parse(park.names).en, "Test Park");
  // Wikidata names and notability.
  const statue = rows["osm:n2"];
  assert.equal(statue.category, "sculpture");
  assert.equal(statue.notability, 7);
  assert.equal(JSON.parse(statue.names).de, "Statue");
  // New named Overture place near a path is added, a far one is dropped.
  assert.equal(rows["ovt:ovt-new"].category, "museum");
  assert.equal(rows["ovt:ovt-far"], undefined);
  for (const id of ["ovt-closed", "ovt-low", "ovt-food", "ovt-at", "ovt-dup"])
    assert.equal(rows[`ovt:${id}`], undefined, id);
  // Non-quest OSM objects never enter.
  assert.equal(rows["osm:n7"], undefined);
  // Every excluded place keeps a reason code and has no target.
  assert.equal(rows["osm:n3"].safety_reason, "no_public_path");
  assert.equal(rows["osm:n4"].safety_reason, "inside_school");
  assert.equal(rows["osm:n5"].safety_reason, "private_access");
  assert.equal(rows["osm:n6"].safety_reason, "disused");
  for (const r of Object.values(rows))
    if (r.safety === "excluded")
      assert.ok(r.safety_reason && r.path_ref === null, r.id);
  // Counts and partitions.
  assert.equal(manifest.counts.overtureFolded, 1);
  assert.equal(manifest.counts.overtureAdded, 1);
  assert.equal(manifest.counts.overtureDroppedNoPath, 1);
  assert.equal(manifest.counts.cities, 1);
  assert.equal(manifest.counts.bySafety.excluded, 4);
  const parts = db.prepare("SELECT * FROM partition").all();
  assert.equal(
    parts.reduce((n, p) => n + p.pois, 0),
    Object.keys(rows).length,
  );
  for (const r of Object.values(rows)) assert.match(r.h3r5, /^85/);
  assert.equal(
    db.prepare("SELECT value FROM meta WHERE key='schema'").get().value,
    "questlayer.poi/1",
  );
  assert.equal(db.prepare("SELECT name FROM city").get().name, "Plzen");
  db.close();
});

test("the same inputs build a byte-identical file", async () => {
  const a = await build(),
    b = await build();
  a.db.close();
  b.db.close();
  assert.equal(a.manifest.sha256, b.manifest.sha256);
  assert.equal(a.manifest.bytes, readFileSync(b.outPath).length);
});

test("operator closures survive a re-import", async () => {
  const { rows, db } = await build({ closures: ["osm:w1"] });
  assert.equal(rows["osm:w1"].safety, "excluded");
  assert.equal(rows["osm:w1"].safety_reason, "operator_closure");
  db.close();
});

test("attribution names every licence", async () => {
  const { manifest, db } = await build();
  db.close();
  const md = attributionMarkdown(manifest, [
    { source: "openstreetmap:cz", url: "u", sha256: "x" },
  ]);
  for (const s of ["ODbL", "CDLA-Permissive-2.0", "CC0", "CC BY 4.0"])
    assert.ok(md.includes(s), s);
});

test("query builders refuse injected values", () => {
  const sql = overtureSql(
    "2026-10-21.0",
    [12.09, 48.55, 18.86, 51.06],
    "/var/lib/questlayer-poi/inputs/o.part",
  );
  assert.match(sql, /release\/2026-10-21\.0\/theme=places/);
  assert.throws(
    () => overtureSql("2026'; DROP", [1, 2, 3, 4], "/x"),
    /release/,
  );
  assert.throws(
    () => overtureSql("2026-10-21.0", [1, 2, 3, 4], "/x'y"),
    /path/,
  );
  assert.match(wikidataQuery(["Q1", "Q42"]), /wd:Q1 wd:Q42/);
  assert.throws(() => wikidataQuery(["Q1 }"]), /Bad Wikidata/);
});

test("wikidata fetch is batched, cached and resumable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const cachePath = join(dir, "wikidata.ndjson");
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls++;
    const ids = [...decodeURIComponent(init.body).matchAll(/wd:(Q\d+)/g)].map(
      (m) => m[1],
    );
    const bindings = ids.slice(0, -1).map((id) => ({
      item: { value: `http://www.wikidata.org/entity/${id}` },
      sitelinks: { value: "3" },
      lang: { value: "cs" },
      label: { value: `n${id}` },
    }));
    return { ok: true, json: async () => ({ results: { bindings } }) };
  };
  await fetchWikidata({
    ids: ["Q1", "Q2", "Q3"],
    cachePath,
    batch: 2,
    fetchImpl,
    pauseMs: 0,
  });
  assert.equal(calls, 2);
  const cached = readFileSync(cachePath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(cached.map((c) => c.id).sort(), ["Q1", "Q2", "Q3"]);
  await fetchWikidata({
    ids: ["Q1", "Q2", "Q3"],
    cachePath,
    batch: 2,
    fetchImpl,
    pauseMs: 0,
  });
  assert.equal(calls, 2);
  assert.deepEqual(await collectWikidataIds([fx("osm-pois.geojsonseq")]), [
    "Q123",
  ]);
  assert.equal(parseWikidataBindings({}).length, 0);
});

test("osmium filters cover the taxonomy and the exclusion list", () => {
  assert.ok(FILTERS.pois.some((f) => f.includes("tourism=artwork")));
  assert.ok(FILTERS.exclusions.some((f) => f.includes("school")));
  assert.ok(FILTERS.paths[0].includes("footway"));
  assert.equal(parseGeonamesLine("bad"), null);
});

test("geometry helpers stay on the feature", () => {
  const ring = [
    [0, 0],
    [2, 0],
    [2, 2],
    [1, 2],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  const p = representativePoint({ type: "Polygon", coordinates: [ring] });
  assert.ok(p.lat >= 0 && p.lat <= 2 && p.lng >= 0 && p.lng <= 2);
  const hit = nearestOnSegment(
    { lat: 49.7471, lng: 13.378 },
    { lat: 49.747, lng: 13.377 },
    { lat: 49.747, lng: 13.379 },
  );
  assert.ok(Math.abs(hit.distanceM - 11.1) < 0.5);
});

test("whatever W4 module is installed builds the fixtures", async () => {
  const w4 = await loadW4();
  const { rows, db } = await build({ w4 });
  db.close();
  assert.equal(rows["osm:w1"].category, "park");
  assert.equal(rows["osm:n3"].safety, "excluded");
  assert.equal(rows["osm:n4"].safety, "excluded");
  assert.match(rows["osm:n4"].safety_reason, /inside.school/);
});

test("walkable ways become offline path cells the map adapter serves", async () => {
  const { manifest, outPath, db } = await build();
  const cells = db.prepare("SELECT h3r7, ways, points FROM path_cell").all();
  db.close();
  assert.ok(cells.length >= 1);
  assert.equal(manifest.counts.pathCells, cells.length);
  const { openOfflinePaths } = await import("../server/spatial/offline-paths.mjs");
  const { publicPathSnapshot } = await import("../server/spatial/map-data.mjs");
  const { openDatabase } = await import("../server/database.mjs");
  const { latLngToCell } = await import("h3-js");
  const offline = openOfflinePaths(outPath);
  const region = latLngToCell(49.747, 13.378, 7);
  const local = offline.paths(region);
  assert.ok(local.paths.length >= 2, "footway + residential");
  // The private footway near the fountain never becomes a street path.
  const flat = local.paths.flat();
  assert.ok(!flat.some(([lng, lat]) => lat === 49.75 && lng >= 13.3799 && lng <= 13.3801));
  const app = openDatabase(":memory:");
  try {
    let calls = 0;
    const snap = await publicPathSnapshot(app, region, {
      offline,
      fetcher: async () => {
        calls++;
        throw Error("no network");
      },
    });
    assert.equal(snap.status, "fresh");
    assert.equal(snap.source, "offline");
    assert.equal(calls, 0);
    // A cell the file does not cover still uses the provider fallback.
    const elsewhere = latLngToCell(50.08, 14.42, 7);
    const miss = await publicPathSnapshot(app, elsewhere, {
      offline,
      fetcher: async () => {
        calls++;
        throw Error("no network");
      },
    });
    assert.equal(miss.status, "unavailable");
    assert.equal(calls, 1);
  } finally {
    app.close();
    offline.close();
  }
});

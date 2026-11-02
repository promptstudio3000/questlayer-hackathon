import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { latLngToCell } from "h3-js";
import {
  CELL_RULES,
  cellCapacity,
  coverageReport,
  coverageSummary,
  openPoiDb,
  poiWorldStatus,
  resetPoiWorldCache,
} from "../server/poi/coverage.mjs";
import {
  BRNO,
  VILLAGE,
  buildCzechiaFixture,
} from "./fixtures/world-coverage/czechia.mjs";
import { run } from "../scripts/world-coverage.mjs";

const ROOT = resolve(import.meta.dirname, "..");
let fixture;
test.before(async () => {
  fixture = await buildCzechiaFixture(mkdtempSync(join(tmpdir(), "coverage-")));
});
test.after(() => rmSync(fixture.dir, { recursive: true, force: true }));

// Points along a line, `step` metres apart (east-west at ~49.2° N).
const row = (i, step, extra = {}) => ({
  id: `p${String(i).padStart(2, "0")}`,
  lat: 49.2,
  lng: 16.6 + (i * step) / 72_800,
  category: "park",
  notability: 0,
  ...extra,
});

test("cell capacity keeps C.3: six at most, 250 m apart, three trails", () => {
  assert.equal(CELL_RULES.maxPerCell, 6);
  const dense = Array.from({ length: 20 }, (_, i) => row(i, 100));
  const picked = cellCapacity(dense);
  // 100 m apart: every third point clears 250 m, so 7 candidates, 6 kept.
  assert.equal(picked.length, 6);
  assert.deepEqual(
    picked.map((p) => p.id),
    ["p00", "p03", "p06", "p09", "p12", "p15"],
  );
  const trails = Array.from({ length: 8 }, (_, i) =>
    row(i, 400, { category: i < 6 ? "trailhead" : "plaza" }),
  );
  const t = cellCapacity(trails);
  assert.equal(t.filter((p) => p.category === "trailhead").length, 3);
  assert.equal(t.length, 5);
  // Notability wins the first slot, then ids break ties.
  const ranked = cellCapacity([
    row(0, 0),
    row(1, 0, { notability: 9, id: "z" }),
  ]);
  assert.deepEqual(
    ranked.map((p) => p.id),
    ["z"],
  );
  assert.deepEqual(cellCapacity([]), []);
});

test("summary counts places, cells and exclusion reasons of the fixture", () => {
  const db = openPoiDb(fixture.dbPath);
  try {
    const s = coverageSummary(db);
    assert.equal(s.version, "cz-fixture");
    assert.equal(s.schema, "questlayer.poi/1");
    assert.equal(s.pois, 19);
    assert.deepEqual(s.bySafety, { excluded: 2, ok: 17 });
    assert.deepEqual(s.byReason, { "inside-school": 1, "no-public-path": 1 });
    assert.equal(s.cellsWithPois, 7);
    assert.equal(s.cellsWithQuests, 6);
    assert.equal(s.countryCells, 15282);
    assert.equal(s.partitions, 2);
  } finally {
    db.close();
  }
});

test("report: Brno and the village have quests, the forest is truthful", () => {
  const db = openPoiDb(fixture.dbPath);
  try {
    const opts = {
      cities: 5,
      days: 10,
      sample: 20,
      spotsList: [
        { name: "Brno", ...BRNO },
        { name: "village", ...VILLAGE },
        { name: "forest", lat: 48.985, lng: 13.6 },
      ],
    };
    const r = coverageReport(db, opts);
    const [brno, village, forest] = r.places;
    assert.equal(brno.cell, latLngToCell(BRNO.lat, BRNO.lng, 7));
    assert.ok(brno.questsInCell >= 2, "Brno centre cell has POI quests");
    assert.ok(village.questsInCell >= 1, "the village cell has a POI quest");
    assert.ok(village.nearestQuestM < 100);
    assert.equal(forest.questsInCell, 0);
    assert.equal(forest.nearestQuestM, null);
    // Brno is the largest fixture city: every sector within 3 km has a place.
    const city = r.cities.list.find((c) => c.name === "Brno");
    assert.equal(city.allSixSectors, true, JSON.stringify(city.sectors));
    assert.deepEqual(
      r.cities.emptySectors.map((c) => c.name),
      ["Plzen"],
    );
    // Histogram covers every cell with places; capacity adds up.
    const hist = Object.values(r.cells.questsPerCell);
    assert.equal(
      hist.reduce((a, b) => a + b, 0),
      r.cells.withPois,
    );
    assert.equal(
      Object.entries(r.cells.questsPerCell).reduce((n, [k, v]) => n + k * v, 0),
      r.cells.dailyQuestCapacity,
    );
    // Sample: quest-ready places only, unique, with map and source links.
    assert.equal(r.questSample.length, r.cells.dailyQuestCapacity);
    assert.equal(
      new Set(r.questSample.map((q) => q.id)).size,
      r.questSample.length,
    );
    for (const q of r.questSample) {
      assert.match(q.mapLink, /^https:\/\/www\.openstreetmap\.org\/\?mlat=/);
      assert.match(
        q.sourceLink,
        /^https:\/\/www\.openstreetmap\.org\/node\/\d+$/,
      );
      assert.notEqual(q.name, "Pomník u školy");
    }
    // Rotation never invents quests and reports reuse honestly.
    assert.ok(r.rotation.cells > 0);
    assert.ok(r.rotation.quests <= r.rotation.cells * 6 * 10);
    // Same seed, same report.
    assert.deepEqual(coverageReport(db, opts), r);
    assert.equal(r.randomSpots.count, 20);
  } finally {
    db.close();
  }
});

test("world:coverage writes report.json, report.md and map.html", async () => {
  const out = mkdtempSync(join(tmpdir(), "coverage-out-"));
  try {
    const { out: dir, report } = await run(
      [
        "--poi",
        fixture.dbPath,
        "--out",
        out,
        "--days",
        "5",
        "--sample",
        "10",
        "--cities",
        "3",
      ],
      () => {},
    );
    assert.equal(dir, join(out, "cz-fixture"));
    const json = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    assert.equal(json.schema, "questlayer.world-coverage/1");
    assert.equal(json.cells.withQuests, report.cells.withQuests);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    assert.match(md, /# World coverage: cz-fixture/);
    assert.match(md, /Brno, náměstí Svobody/);
    const html = readFileSync(join(dir, "map.html"), "utf8");
    assert.match(html, /<svg viewBox/);
    assert.equal((html.match(/<path /g) || []).length, report.cells.withPois);
    assert.doesNotMatch(html, /<script/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("health block: not configured, ready, then a failed import", () => {
  const dir = mkdtempSync(join(tmpdir(), "poi-health-"));
  const env = { POI_DB_PATH: join(dir, "current.sqlite") };
  try {
    resetPoiWorldCache();
    assert.deepEqual(poiWorldStatus(env), {
      status: "not-configured",
      lastRun: null,
    });
    writeFileSync(
      join(dir, "last-run.json"),
      JSON.stringify({
        status: "failed",
        stage: "fetch",
        error: "Geofabrik 503",
      }),
    );
    assert.equal(poiWorldStatus(env).status, "import-failed");
    symlinkSync(fixture.dbPath, env.POI_DB_PATH);
    symlinkSync(
      join(fixture.dir, "current.manifest.json"),
      join(dir, "current.manifest.json"),
    );
    writeFileSync(
      join(dir, "last-run.json"),
      JSON.stringify({ status: "ok", stage: "done", version: "cz-fixture" }),
    );
    const ready = poiWorldStatus(env);
    assert.equal(ready.status, "ready");
    assert.equal(ready.version, "cz-fixture");
    assert.equal(ready.cellsWithQuests, 6);
    assert.equal(ready.builtAt, "2026-11-02T00:00:00.000Z");
    assert.equal(ready.sha256, fixture.manifest.sha256);
    assert.equal(ready.lastRun.status, "ok");
    // A later failure keeps the old release live and says so.
    writeFileSync(
      join(dir, "last-run.json"),
      JSON.stringify({ status: "failed", stage: "build", error: "disk full" }),
    );
    const stale = poiWorldStatus(env);
    assert.equal(stale.status, "ready-stale");
    assert.equal(stale.lastRun.error, "disk full");
    assert.equal(stale.version, "cz-fixture");
    // A run whose process is gone reads as interrupted.
    writeFileSync(
      join(dir, "last-run.json"),
      JSON.stringify({ status: "running", stage: "fetch", pid: 2 ** 30 }),
    );
    assert.equal(poiWorldStatus(env).lastRun.status, "interrupted");
  } finally {
    resetPoiWorldCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the POI worker records a failed run in last-run.json", () => {
  const work = mkdtempSync(join(tmpdir(), "poi-run-"));
  try {
    const r = spawnSync(
      process.execPath,
      [join(ROOT, "scripts/poi/run.mjs"), `--work=${work}`, "--regions=xx"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    const last = JSON.parse(readFileSync(join(work, "last-run.json"), "utf8"));
    assert.equal(last.status, "failed");
    assert.match(last.error, /Unknown region "xx"/);
    assert.ok(!existsSync(join(work, "run.lock")));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

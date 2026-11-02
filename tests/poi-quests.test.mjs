import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { latLngToCell, cellToLatLng, cellToParent } from "h3-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { distance } from "../server/domain.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimQuest, advanceRoute } from "../server/game.mjs";
import { DEFAULT_CITY } from "../server/spatial/city-pack.mjs";
import { zoneInBounds } from "../server/spatial/world-query.mjs";
import {
  MAX_POI_QUESTS_PER_CELL,
  MIN_POI_GAP_M,
  POI_XP,
  openPoiFileSource,
  planCellPoiQuests,
  staticPoiSource,
} from "../server/poi-quests.mjs";

const NOW = Date.parse("2026-11-02T11:00:00Z"); // 12:00 in Prague
const cell = latLngToCell(50.08, 14.42, 7);
const [clat, clng] = cellToLatLng(cell);
const CATS = ["fountain", "park", "fountain", "monument", "artwork", "fountain", "museum", "park"];

// A grid of POIs inside the cell, ~150 m apart.
function fixturePois(target = cell) {
  const [lat0, lng0] = cellToLatLng(target);
  const out = [];
  let n = 0;
  for (let i = -8; i <= 8; i++)
    for (let j = -8; j <= 8; j++) {
      const lat = lat0 + (i * 150) / 110540,
        lng = lng0 + (j * 150) / (111320 * Math.cos((lat0 * Math.PI) / 180));
      if (latLngToCell(lat, lng, 7) !== target) continue;
      out.push({
        id: `osm:node/${1000 + n}`,
        category: CATS[n % CATS.length],
        name: `Place ${n}`,
        notability: n % 11 === 0 ? 40 : 0,
        lat,
        lng,
        h3r7: target,
      });
      n++;
    }
  return out;
}
const POIS = fixturePois();

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
              { lat: clat, lon: clng },
              { lat: clat + 0.002, lon: clng },
            ],
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    ),
};

function writePoiFile(dir, rows) {
  const path = join(dir, "poi-test.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE poi(h3r5 TEXT NOT NULL, id TEXT NOT NULL, h3r7 TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
 category TEXT NOT NULL, name TEXT, names TEXT NOT NULL, wikidata TEXT, notability INTEGER NOT NULL, sources TEXT NOT NULL,
 safety TEXT NOT NULL, safety_reason TEXT, access TEXT, hours TEXT, path_ref TEXT, facts TEXT, source_hash TEXT NOT NULL,
 PRIMARY KEY (h3r5, id)) WITHOUT ROWID;`);
  db.prepare("INSERT INTO meta VALUES('schema','questlayer.poi/1')").run();
  db.prepare("INSERT INTO meta VALUES('version','cz-test')").run();
  const insert = db.prepare(
    "INSERT INTO poi VALUES(?,?,?,?,?,?,?,'{}',NULL,?,'[]',?,?,NULL,NULL,?,NULL,'h')",
  );
  for (const r of rows)
    insert.run(
      cellToParent(r.h3r7, 5),
      r.id,
      r.h3r7,
      r.lat + 0.0001,
      r.lng,
      r.category,
      r.name,
      r.notability,
      r.safety || "ok",
      r.safety === "excluded" ? "inside_school" : null,
      r.noPath ? null : JSON.stringify({ lat: r.lat, lng: r.lng, wayId: 1, distanceM: 10 }),
    );
  db.close();
  return path;
}

const fix = (p, t) => ({ lat: p.lat, lng: p.lng, accuracy: 5, timestamp: t });

test("the cell plan is deterministic, bounded and spaced", () => {
  const a = planCellPoiQuests({ cell, day: "2026-11-02", pois: POIS });
  const b = planCellPoiQuests({ cell, day: "2026-11-02", pois: [...POIS].reverse() });
  assert.deepEqual(a, b, "input order never changes the plan");
  assert.equal(a.quests.length, MAX_POI_QUESTS_PER_CELL);
  const hunts = a.quests.filter((q) => q.template === "poi-category-hunt");
  assert.ok(hunts.length >= 1 && hunts.length <= 2);
  for (const h of hunts) {
    assert.equal(h.pois.length, 3);
    assert.ok(h.pois.every((p) => p.category === h.category));
  }
  assert.equal(a.quests.filter((q) => q.chest).length, 1);
  const targets = a.quests.flatMap((q) => q.pois);
  assert.equal(new Set(targets.map((p) => p.id)).size, targets.length);
  for (let i = 0; i < targets.length; i++)
    for (let j = i + 1; j < targets.length; j++)
      assert.ok(distance(targets[i], targets[j]) >= MIN_POI_GAP_M);
  const other = planCellPoiQuests({ cell, day: "2026-11-03", pois: POIS });
  assert.notDeepEqual(other.quests, a.quests);
  assert.notEqual(other.seed, a.seed);
  const layer = planCellPoiQuests({ cell, day: "2026-11-02", pois: POIS, layerId: "punks-city" });
  assert.notEqual(layer.seed, a.seed);
});

test("POIs used in the last 72 h are skipped while alternatives exist", () => {
  const first = planCellPoiQuests({ cell, day: "2026-11-02", pois: POIS });
  const recent = new Set(first.quests.flatMap((q) => q.pois.map((p) => p.id)));
  const next = planCellPoiQuests({ cell, day: "2026-11-03", pois: POIS, recent });
  assert.ok(next.quests.flatMap((q) => q.pois).every((p) => !recent.has(p.id)));
  // Only recent POIs left: they are reused rather than leaving the cell empty.
  const only = POIS.filter((p) => recent.has(p.id));
  const reuse = planCellPoiQuests({ cell, day: "2026-11-03", pois: only, recent });
  assert.ok(reuse.quests.length > 0);
});

test("an empty cell gets no invented quest", () => {
  assert.deepEqual(planCellPoiQuests({ cell, day: "2026-11-02", pois: [] }).quests, []);
});

test("the file adapter reads only checked POIs with a path target, read-only", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "poi-q-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = writePoiFile(dir, [
    ...POIS.slice(0, 3),
    { ...POIS[3], safety: "excluded" },
    { ...POIS[4], safety: "review" },
    { ...POIS[5], noPath: true },
  ]);
  const source = openPoiFileSource(path);
  t.after(() => source.close());
  assert.equal(source.available(), true);
  assert.equal(source.version(), "cz-test");
  const rows = source.cellPois(cell);
  assert.deepEqual(rows.map((r) => r.id), POIS.slice(0, 3).map((p) => p.id).sort());
  // Coordinates are the public-path target, not the label point.
  assert.equal(rows.find((r) => r.id === POIS[0].id).lat, POIS[0].lat);
  assert.equal(openPoiFileSource(join(dir, "missing.sqlite")).available(), false);
});

test("a street cell materialises one set on first load, the same after a restart and from any position", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "poi-q-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = writePoiFile(dir, POIS);
  const db = openDatabase(join(dir, "state.sqlite"));
  const source = openPoiFileSource(path);
  // Two parallel first loads from different spots in the cell.
  const here = { lat: POIS[0].lat, lng: POIS[0].lng },
    there = { lat: POIS.at(-1).lat, lng: POIS.at(-1).lng };
  const [a, b] = await Promise.all([
    ensureWorld(db, here, false, NOW, { mapData, poiSource: source }),
    ensureWorld(db, there, false, NOW, { mapData, poiSource: source }),
  ]);
  assert.equal(a.id, b.id);
  const rows = () =>
    db
      .prepare("SELECT id,title,lat,lng,xp,gold_u,kind,zone_id FROM quests WHERE world_id=? ORDER BY id")
      .all(a.id);
  const first = rows();
  assert.equal(first.length, MAX_POI_QUESTS_PER_CELL);
  assert.ok(first.every((q) => q.gold_u === 0), "XP only, never GOLD");
  assert.ok(first.every((q) => q.zone_id.includes(":zone:poi-")));
  assert.equal(first.filter((q) => q.kind === "chest").length, 1);
  source.close();
  db.close();
  // Restart: a new process with a new handle on the same files.
  const db2 = openDatabase(join(dir, "state.sqlite"));
  t.after(() => db2.close());
  const again = await ensureWorld(db2, here, false, NOW + 60_000, {
    mapData,
    poiSource: openPoiFileSource(path),
  });
  assert.equal(again.id, a.id);
  assert.deepEqual(
    db2.prepare("SELECT id,title,lat,lng,xp,gold_u,kind,zone_id FROM quests WHERE world_id=? ORDER BY id").all(a.id),
    first,
  );
  // A fresh database planned from the same inputs picks the same POIs.
  const db3 = openDatabase(":memory:");
  t.after(() => db3.close());
  await ensureWorld(db3, there, false, NOW, { mapData, poiSource: staticPoiSource(POIS) });
  assert.deepEqual(
    db3.prepare("SELECT title,lat,lng FROM quests ORDER BY id").all().map((r) => ({ ...r })),
    first.map(({ title, lat, lng }) => ({ title, lat, lng })),
  );
  const view = worldView(db2, a.id, null);
  assert.equal(view.poiQuests.status, "ready");
  assert.equal(view.poiQuests.count, MAX_POI_QUESTS_PER_CELL);
  assert.equal(view.zones.length, MAX_POI_QUESTS_PER_CELL);
  for (const z of view.zones)
    assert.ok(zoneInBounds(z, [clng - 0.05, clat - 0.05, clng + 0.05, clat + 0.05]));
});

test("an empty cell says nothing here yet; a missing POI file changes nothing", async () => {
  const db = openDatabase(":memory:");
  try {
    const w = await ensureWorld(db, { lat: clat, lng: clng }, false, NOW, {
      mapData,
      poiSource: staticPoiSource([]),
    });
    assert.equal(w.poiQuests.status, "empty");
    assert.match(w.poiQuests.notice, /Nothing here yet/);
    assert.equal(db.prepare("SELECT count(*) n FROM quests").get().n, 0);
    const other = latLngToCell(50.2, 14.6, 7);
    const [olat, olng] = cellToLatLng(other);
    const none = await ensureWorld(db, { lat: olat, lng: olng }, false, NOW, {
      mapData,
      poiSource: openPoiFileSource("/nonexistent/poi.sqlite"),
    });
    assert.equal(none.poiQuests, undefined);
    assert.equal(none.zones.length, 0);
  } finally {
    db.close();
  }
});

test("a city cell and the arena use their own world, never POI quests", async () => {
  const db = openDatabase(":memory:");
  try {
    const cityPois = fixturePois(latLngToCell(DEFAULT_CITY.center.lat, DEFAULT_CITY.center.lng, 7));
    const city = await ensureWorld(db, DEFAULT_CITY.center, false, NOW, {
      poiSource: staticPoiSource(cityPois),
    });
    assert.ok(city.cityId);
    const arena = await ensureWorld(db, DEFAULT_CITY.center, true, NOW, {
      poiSource: staticPoiSource(cityPois),
    });
    assert.ok(arena.arena);
    assert.equal(
      db.prepare("SELECT count(*) n FROM quests WHERE id LIKE '%:quest:poi-%'").get().n,
      0,
    );
  } finally {
    db.close();
  }
});

test("POI quests pay XP once; a category hunt accepts its stops in any order", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Walker", NOW);
    const gold0 = db.prepare("SELECT gold_u FROM players WHERE id=?").get(player).gold_u;
    const w = await ensureWorld(db, { lat: clat, lng: clng }, false, NOW, {
      mapData,
      poiSource: staticPoiSource(POIS),
    });
    const view = worldView(db, w.id, player, { now: NOW });
    const visit = view.quests.find((q) => q.kind === "visit");
    assert.equal(visit.activity.templateId, "poi-visit");
    const r = claimQuest(db, player, visit.id, fix(visit, NOW), NOW);
    assert.equal(r.xp, POI_XP.visit);
    assert.equal(r.reward, 0);
    const hunt = view.quests.find((q) => q.kind === "route");
    assert.equal(hunt.activity.templateId, "poi-category-hunt");
    assert.equal(hunt.checkpointCount, 3);
    const stops = hunt.activity.steps.map((s) => s.point);
    let t = NOW + 1000;
    const step1 = advanceRoute(db, player, hunt.id, fix(stops[2], t), 0, t);
    assert.deepEqual(step1, { awaiting: true, progress: { completed: 1, total: 3 } });
    // The same stop again does not count twice: the nearest open stop is far.
    t += 1000;
    assert.throws(() => advanceRoute(db, player, hunt.id, fix(stops[2], t), 1, t), /closer/);
    const mid = worldView(db, w.id, player, { now: t }).quests.find((q) => q.id === hunt.id);
    assert.deepEqual(mid.visitedStops, [2]);
    assert.deepEqual(mid.nextPoint, stops[0]);
    t += 1000;
    advanceRoute(db, player, hunt.id, fix(stops[0], t), 1, t);
    t += 1000;
    const done = advanceRoute(db, player, hunt.id, fix(stops[1], t), 2, t);
    assert.equal(done.xp, POI_XP.hunt);
    assert.equal(done.reward, 0);
    assert.equal(db.prepare("SELECT gold_u FROM players WHERE id=?").get(player).gold_u, gold0);
  } finally {
    db.close();
  }
});

test("POI quests open only during the layer's play hours", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Night", NOW);
    const w = await ensureWorld(db, { lat: clat, lng: clng }, false, NOW, {
      mapData,
      poiSource: staticPoiSource(POIS),
    });
    const q = worldView(db, w.id, player, { now: NOW }).quests.find((x) => x.kind === "visit");
    const late = Date.parse("2026-11-02T20:30:00Z"); // 21:30 in Prague
    assert.throws(() => claimQuest(db, player, q.id, fix(q, late), late), /closed for today/);
  } finally {
    db.close();
  }
});

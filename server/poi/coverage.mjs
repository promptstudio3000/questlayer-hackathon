// World coverage (W12, docs/WORLD-COVERAGE.md): what the POI database built by
// the World worker (scripts/poi/run.mjs) gives players across a region.
// Read-only over current.sqlite; nothing here calls a map or model API.
//
// The per-cell quest capacity follows docs/WORLDS-PLAN.md C.3: per H3 res-7
// cell per day at most 6 POI quests, at least 250 m apart, at most 3 of them
// trails. It is an upper bound for what W6 can publish in a cell, not W6's
// own selection (W6 owns seeds and rotation).
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { cellToChildren, cellToLatLng, gridDisk, latLngToCell } from "h3-js";

export const COVERAGE_VERSION = "world-coverage-v1";
export const CELL_RULES = Object.freeze({
  maxPerCell: 6,
  minSpacingM: 250,
  maxTrails: 3,
  rotationHours: 72,
});
export const TRAIL_CATEGORIES = Object.freeze(
  new Set(["trailhead", "river_walk", "lake_walk", "nature_reserve"]),
);
// Average H3 res-7 cell area (km²), for "share of the country" estimates.
export const H3_R7_KM2 = 5.161;
// Land area per region id (km²), the denominator of the coverage share.
export const REGION_AREA_KM2 = Object.freeze({ cz: 78_871 });
export const DEFAULT_POI_DIR = "/var/lib/questlayer-poi";
const CITY_RADIUS_M = 3000;
const R = 6_371_000;
const RAD = Math.PI / 180;

export function distanceM(a, b) {
  const x = (b.lng - a.lng) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD),
    y = (b.lat - a.lat) * RAD;
  return Math.hypot(x, y) * R;
}

function bearing(a, b) {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * RAD),
    y = b.lat - a.lat;
  return (Math.atan2(x, y) / RAD + 360) % 360;
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function rng(seed) {
  let a = createHash("sha256").update(String(seed)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the worker publishes: POI_DB_PATH, else the VPS state dir. */
export function poiFiles(env = process.env) {
  const db = env.POI_DB_PATH || join(DEFAULT_POI_DIR, "current.sqlite");
  const dir = dirname(db);
  return {
    db,
    manifest: env.POI_MANIFEST_PATH || join(dir, "current.manifest.json"),
    lastRun: env.POI_LAST_RUN_PATH || join(dir, "last-run.json"),
  };
}

export function openPoiDb(path) {
  return new DatabaseSync(path, { readOnly: true });
}

const target = (row) => {
  try {
    const t = JSON.parse(row.path_ref);
    return Number.isFinite(t?.lat) && Number.isFinite(t?.lng)
      ? { lat: t.lat, lng: t.lng }
      : null;
  } catch {
    return null;
  }
};

/** Quest-ready rows (safety ok, check-in target on a mapped path). */
const READY_SQL =
  "safety='ok' AND path_ref IS NOT NULL AND category IS NOT NULL AND category<>''";

function readyIn(db, cells) {
  if (!cells.length) return [];
  const rows = [];
  for (let i = 0; i < cells.length; i += 400) {
    const part = cells.slice(i, i + 400);
    rows.push(
      ...db
        .prepare(
          `SELECT id,h3r7,lat,lng,category,name,notability,path_ref,wikidata FROM poi
           WHERE h3r7 IN (${part.map(() => "?").join(",")}) AND ${READY_SQL}`,
        )
        .all(...part),
    );
  }
  return rows;
}

/**
 * C.3 capacity of one cell: greedy by notability then id, 250 m apart,
 * at most 6, at most 3 trails. Pure; input rows need {id, category,
 * notability, lat, lng} (path target preferred when present).
 */
export function cellCapacity(
  rows,
  rules = CELL_RULES,
  { ordered = false } = {},
) {
  const order = ordered
    ? rows
    : [...rows].sort(
        (a, b) =>
          (b.notability || 0) - (a.notability || 0) || (a.id < b.id ? -1 : 1),
      );
  const picked = [];
  let trails = 0;
  for (const row of order) {
    if (picked.length >= rules.maxPerCell) break;
    const trail = TRAIL_CATEGORIES.has(row.category);
    if (trail && trails >= rules.maxTrails) continue;
    const at = row.target || row;
    if (picked.some((p) => distanceM(p.target || p, at) < rules.minSpacingM))
      continue;
    picked.push(row);
    if (trail) trails++;
  }
  return picked;
}

function meta(db) {
  return Object.fromEntries(
    db
      .prepare("SELECT key,value FROM meta")
      .all()
      .map((r) => [r.key, r.value]),
  );
}

function regionArea(regions) {
  const ids = String(regions || "")
    .split(/[,-]/)
    .filter(Boolean);
  const known = ids.map((id) => REGION_AREA_KM2[id]);
  return known.length && known.every(Number.isFinite)
    ? known.reduce((a, b) => a + b, 0)
    : null;
}

/** Every cell's capacity, streamed over the cell index (one pass). */
export function cellCapacities(db) {
  const out = new Map();
  let cell = null,
    rows = [];
  const flush = () => {
    if (cell) out.set(cell, cellCapacity(rows));
  };
  for (const row of db
    .prepare(
      `SELECT id,h3r7,lat,lng,category,name,notability,path_ref FROM poi
       WHERE ${READY_SQL} ORDER BY h3r7`,
    )
    .iterate()) {
    if (row.h3r7 !== cell) {
      flush();
      cell = row.h3r7;
      rows = [];
    }
    rows.push({ ...row, target: target(row) });
  }
  flush();
  return out;
}

/** Cheap totals for /api/health (SQL only, a few hundred ms on all of CZ). */
export function coverageSummary(db) {
  const m = meta(db);
  const bySafety = Object.fromEntries(
    db
      .prepare("SELECT safety,COUNT(*) n FROM poi GROUP BY safety")
      .all()
      .map((r) => [r.safety, r.n]),
  );
  const byReason = Object.fromEntries(
    db
      .prepare(
        "SELECT safety_reason r,COUNT(*) n FROM poi WHERE safety='excluded' GROUP BY r ORDER BY n DESC, r",
      )
      .all()
      .map((r) => [r.r || "unknown", r.n]),
  );
  const cells = db.prepare("SELECT COUNT(DISTINCT h3r7) n FROM poi").get().n;
  const questCells = db
    .prepare(`SELECT COUNT(DISTINCT h3r7) n FROM poi WHERE ${READY_SQL}`)
    .get().n;
  const area = regionArea(m.regions);
  const countryCells = area ? Math.round(area / H3_R7_KM2) : null;
  const pois = Object.values(bySafety).reduce((a, b) => a + b, 0);
  return {
    schema: m.schema || null,
    version: m.version || null,
    regions: m.regions || null,
    taxonomyVersion: m.taxonomyVersion || null,
    safetyVersion: m.safetyVersion || null,
    pois,
    bySafety,
    excludedShare: pois ? round((bySafety.excluded || 0) / pois, 4) : 0,
    byReason,
    partitions: db.prepare("SELECT COUNT(*) n FROM partition").get().n,
    cities: db.prepare("SELECT COUNT(*) n FROM city").get().n,
    cellsWithPois: cells,
    cellsWithQuests: questCells,
    countryCells,
    countryShare: countryCells ? round(questCells / countryCells, 4) : null,
  };
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const osmLink = (p) =>
  `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`;
function sourceLink(id) {
  const m = /^osm:([nwr])(\d+)$/.exec(id || "");
  if (!m) return null;
  const kind = { n: "node", w: "way", r: "relation" }[m[1]];
  return `https://www.openstreetmap.org/${kind}/${m[2]}`;
}

function nearestReady(db, spot, rings = 3) {
  const home = latLngToCell(spot.lat, spot.lng, 7);
  let best = null;
  for (const row of readyIn(db, gridDisk(home, rings))) {
    const t = target(row) || row;
    const d = distanceM(spot, t);
    if (!best || d < best.distanceM)
      best = { id: row.id, name: row.name, distanceM: Math.round(d) };
  }
  return best;
}

/**
 * Simulated rotation over `days` for a set of cells (C.3.4): each day a
 * seeded order with a small notability boost, skipping POIs used in the last
 * 72 h when enough alternatives remain. Reports distinct POIs and reuses.
 */
export function simulateRotation(
  rowsByCell,
  { days = 30, seed = COVERAGE_VERSION } = {},
) {
  const window = Math.round(CELL_RULES.rotationHours / 24);
  let reuses = 0,
    quests = 0,
    shortDays = 0;
  const distinct = [];
  for (const [cell, rows] of rowsByCell) {
    const k = cellCapacity(rows).length;
    if (!k) continue;
    const recent = [],
      seen = new Set();
    for (let day = 0; day < days; day++) {
      const r = rng(`${seed}:${cell}:${day}`);
      const scored = rows
        .map((row) => ({
          row,
          s: r() + Math.min(0.3, (row.notability || 0) / 100),
        }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.row);
      const blocked = new Set(recent.flat());
      const fresh = scored.filter((row) => !blocked.has(row.id));
      let pick = cellCapacity(fresh, CELL_RULES, { ordered: true });
      if (pick.length < k) {
        // Not enough alternatives: fall back to recent POIs, as C.3.4 permits.
        pick = cellCapacity(
          [...fresh, ...scored.filter((row) => blocked.has(row.id))],
          CELL_RULES,
          { ordered: true },
        );
        reuses += pick.filter((p) => blocked.has(p.id)).length;
      }
      if (pick.length < k) shortDays++;
      quests += pick.length;
      for (const p of pick) seen.add(p.id);
      recent.push(pick.map((p) => p.id));
      if (recent.length > window - 1) recent.shift();
    }
    distinct.push(seen.size);
  }
  return {
    cells: distinct.length,
    days,
    quests,
    reusesWithin72h: reuses,
    shortDays,
    distinctPerCell: distribution(distinct),
  };
}

function distribution(values) {
  if (!values.length) return { min: 0, median: 0, max: 0, mean: 0 };
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0],
    median: s[Math.floor(s.length / 2)],
    max: s.at(-1),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

/** City check (tier B preview): six 60° sectors within 3 km of the centre. */
function cityCoverage(db, city, capacities) {
  const centre = { lat: city.lat, lng: city.lng };
  const cells = gridDisk(latLngToCell(city.lat, city.lng, 7), 2);
  const ready = readyIn(db, cells)
    .map((row) => ({ ...row, target: target(row) || row }))
    .filter((row) => distanceM(centre, row.target) <= CITY_RADIUS_M);
  const sectors = Array.from({ length: 6 }, () => 0);
  for (const row of ready)
    sectors[Math.floor(bearing(centre, row.target) / 60) % 6]++;
  const names = ["N-NE", "NE-SE", "SE-S", "S-SW", "SW-NW", "NW-N"];
  return {
    geonameid: city.geonameid,
    name: city.name,
    population: city.population,
    lat: city.lat,
    lng: city.lng,
    questReadyWithin3km: ready.length,
    dailyQuestCapacity: cells.reduce(
      (n, c) => n + (capacities.get(c)?.length || 0),
      0,
    ),
    sectors: Object.fromEntries(names.map((n, i) => [n, sectors[i]])),
    allSixSectors: sectors.every((n) => n > 0),
    emptySectors: names.filter((_, i) => !sectors[i]),
    mapLink: osmLink({ lat: round(city.lat, 5), lng: round(city.lng, 5) }),
  };
}

/** Uniform random spots over the imported partitions (land in the region). */
function randomSpots(db, n, random) {
  const partitions = db
    .prepare("SELECT h3r5 FROM partition ORDER BY h3r5")
    .all()
    .map((r) => r.h3r5);
  if (!partitions.length) return [];
  const spots = [];
  for (let i = 0; i < n; i++) {
    const p = partitions[Math.floor(random() * partitions.length)];
    const kids = cellToChildren(p, 7);
    const cell = kids[Math.floor(random() * kids.length)];
    const [lat, lng] = cellToLatLng(cell);
    spots.push({ cell, lat: round(lat, 5), lng: round(lng, 5) });
  }
  return spots;
}

/**
 * Full report for `npm run world:coverage`. Options: cities (top n by
 * population), days (rotation simulation), sample (random spots and quest
 * sample size), seed.
 */
export function coverageReport(
  db,
  {
    cities = 20,
    days = 30,
    sample = 50,
    seed = COVERAGE_VERSION,
    spotsList = [],
  } = {},
) {
  const summary = coverageSummary(db);
  const capacities = cellCapacities(db);
  const hist = Array.from({ length: CELL_RULES.maxPerCell + 1 }, () => 0);
  const poiCells = db
    .prepare("SELECT DISTINCT h3r7 FROM poi ORDER BY h3r7")
    .all()
    .map((r) => r.h3r7);
  for (const cell of poiCells) hist[capacities.get(cell)?.length || 0]++;
  const totalDaily = [...capacities.values()].reduce((n, l) => n + l.length, 0);
  const byCategory = Object.fromEntries(
    db
      .prepare(
        `SELECT category c,COUNT(*) n FROM poi WHERE ${READY_SQL} GROUP BY c ORDER BY n DESC, c`,
      )
      .all()
      .map((r) => [r.c, r.n]),
  );

  const random = rng(`${seed}:spots`);
  const spots = randomSpots(db, sample, random).map((s) => {
    const cap = capacities.get(s.cell)?.length || 0;
    const nearest = nearestReady(db, s);
    return {
      ...s,
      questsInCell: cap,
      nearestQuestM: nearest?.distanceM ?? null,
      mapLink: osmLink(s),
    };
  });
  const within = (m) =>
    spots.length
      ? round(
          spots.filter((s) => s.nearestQuestM !== null && s.nearestQuestM <= m)
            .length / spots.length,
          3,
        )
      : 0;

  const topCities = db
    .prepare("SELECT * FROM city ORDER BY population DESC, geonameid LIMIT ?")
    .all(cities)
    .map((c) => cityCoverage(db, c, capacities));

  // A seeded sample of quests a player would meet, for manual review.
  const all = [...capacities.values()].flat();
  const qr = rng(`${seed}:quests`);
  const quests = [];
  const pool = [...all];
  while (quests.length < sample && pool.length) {
    const [p] = pool.splice(Math.floor(qr() * pool.length), 1);
    const t = p.target || p;
    quests.push({
      id: p.id,
      name: p.name,
      category: p.category,
      cell: p.h3r7,
      target: { lat: t.lat, lng: t.lng },
      mapLink: osmLink(t),
      sourceLink: sourceLink(p.id),
    });
  }

  // Named places a journey or an operator wants to check (e.g. Brno, a village).
  const places = spotsList.map((s) => {
    const cell = latLngToCell(s.lat, s.lng, 7);
    return {
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      cell,
      questsInCell: capacities.get(cell)?.length || 0,
      nearestQuestM: nearestReady(db, s)?.distanceM ?? null,
      mapLink: osmLink(s),
    };
  });

  const rotationCells = new Map();
  for (const c of new Set([
    ...topCities.flatMap((c) => gridDisk(latLngToCell(c.lat, c.lng, 7), 1)),
    ...spots.map((s) => s.cell),
  ]))
    rotationCells.set(
      c,
      readyIn(db, [c]).map((row) => ({ ...row, target: target(row) })),
    );

  return {
    schema: "questlayer.world-coverage/1",
    coverageVersion: COVERAGE_VERSION,
    rules: { ...CELL_RULES, trailCategories: [...TRAIL_CATEGORIES] },
    poi: summary,
    cells: {
      withPois: poiCells.length,
      withQuests: capacities.size,
      dailyQuestCapacity: totalDaily,
      questsPerCell: Object.fromEntries(hist.map((n, i) => [String(i), n])),
      countryCells: summary.countryCells,
      countryShare: summary.countryShare,
    },
    questReadyByCategory: byCategory,
    randomSpots: {
      count: spots.length,
      withQuestInCell: spots.length
        ? round(
            spots.filter((s) => s.questsInCell > 0).length / spots.length,
            3,
          )
        : 0,
      questWithin1km: within(1000),
      questWithin3km: within(3000),
      spots,
    },
    cities: {
      checked: topCities.length,
      allSixSectors: topCities.filter((c) => c.allSixSectors).length,
      emptySectors: topCities
        .filter((c) => c.emptySectors.length)
        .map((c) => ({ name: c.name, emptySectors: c.emptySectors })),
      list: topCities,
    },
    places,
    rotation: simulateRotation(rotationCells, { days, seed }),
    questSample: quests,
  };
}

// ---- /api/health -----------------------------------------------------------

let cache = { key: null, value: null };

// The worker runs as another user: EPERM still means the process exists.
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The POI world block of /api/health: database version, coverage totals and
 * the worker's last run (including its error). Cached per published file,
 * so a new release is picked up without a restart.
 */
export function poiWorldStatus(env = process.env) {
  const files = poiFiles(env);
  const lastRun = readJson(files.lastRun);
  const run = lastRun
    ? {
        status:
          lastRun.status === "running" && !alive(lastRun.pid)
            ? "interrupted"
            : lastRun.status,
        stage: lastRun.stage || null,
        startedAt: lastRun.startedAt || null,
        finishedAt: lastRun.finishedAt || null,
        version: lastRun.version || null,
        error: lastRun.error || null,
      }
    : null;
  if (!existsSync(files.db))
    return {
      status: !run
        ? "not-configured"
        : run.status === "running"
          ? "importing"
          : "import-failed",
      lastRun: run,
    };
  let key;
  try {
    const real = realpathSync(files.db);
    key = `${real}:${statSync(real).mtimeMs}`;
  } catch (error) {
    return { status: "error", error: String(error.message), lastRun: run };
  }
  if (cache.key !== key) {
    let value;
    try {
      const db = openPoiDb(files.db);
      try {
        value = { status: "ready", ...coverageSummary(db) };
      } finally {
        db.close();
      }
      const manifest = readJson(files.manifest);
      value.builtAt = manifest?.builtAt || null;
      value.sha256 = manifest?.sha256 || null;
      value.w4Source = manifest?.w4Source || null;
    } catch (error) {
      value = { status: "error", error: String(error.message) };
    }
    cache = { key, value };
  }
  const value = { ...cache.value, lastRun: run };
  if (
    value.status === "ready" &&
    ["failed", "interrupted"].includes(run?.status)
  )
    value.status = "ready-stale";
  return value;
}

export function resetPoiWorldCache() {
  cache = { key: null, value: null };
}

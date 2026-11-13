#!/usr/bin/env node
// World worker, task W5 (docs/WORLDS-PLAN.md C.3 point 7, C.6 "W5"):
// one auto CityPack per GeoNames city (default: Czechia, >= 15,000 people)
// built from the POI import's OSM extracts, in the same shape and with the
// same builder as reviewed packs (server/spatial/city-pack-builder.mjs).
//
// Inputs (all local, written by scripts/poi/run.mjs):
//   <work>/current.sqlite                     city table (GeoNames)
//   <work>/osm-<region>-pois.geojsonseq       park and garden polygons
//   <work>/osm-<region>-paths.geojsonseq      walkable ways
//   <work>/osm-<region>-exclusions.geojsonseq schools, hospitals, playgrounds...
// Output: <work>/city-packs-<version>/{<id>.json,index.json,report.json} and
// the <work>/city-packs symlink the server reads (AUTO_CITIES_DIR). Packs are
// never committed; only the index hashes may be copied into git.
//
// Rules: status "auto", fieldReview "auto", never funded; a reviewed city in
// server/data/cities.json wins (same id or centre inside its coverage, and no
// auto feature inside its coverage); no target inside an exclusion polygon;
// a city with no zone on any sample day is not published.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { booleanPointInPolygon, point, polygon } from "@turf/turf";
import { readJsonLines } from "./lib/ndjson.mjs";
import { buildCityPack } from "../../server/spatial/city-pack-builder.mjs";
import { AUTO_CITY_INDEX_SCHEMA } from "../../server/spatial/auto-cities.mjs";
import { DEMO_CITIES, DEMO_CITY_HALF_KM } from "./demo-cities.mjs";

export const AUTO_CITY_BUILDER_VERSION = 1;
export const AUTO_MIN_POPULATION = 15000;
export const AUTO_PATH_LIMIT = 3500;
// The same walkable set reviewed packs use (scripts/import-city.mjs).
export const WALK_HIGHWAYS = new Set([
  "footway",
  "pedestrian",
  "path",
  "living_street",
]);
const PARK_LEISURE = new Set(["park", "garden"]);
const CLOSED = new Set(["private", "no", "customers", "permit"]);
const SECTOR_COUNT = 6;

const round4 = (n) => Math.round(n * 1e4) / 1e4;
const inBox = ([lng, lat], [w, s, e, n]) =>
  lng >= w && lng <= e && lat >= s && lat <= n;
const boxesOverlap = (a, b) =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const kmPerDegLng = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** Half the side of the coverage box in km: ~2.7 km at 15k, ~5.4 km at 170k, 12 km cap. */
export function halfSizeKm(population) {
  return Math.min(
    12,
    Math.max(1.5, 1.5 + 3 * Math.sqrt(Math.max(0, population) / 1e5)),
  );
}

export function coverageFor(center, population) {
  const h = halfSizeKm(population),
    dLat = h / 110.57,
    dLng = h / kmPerDegLng(center.lat);
  return [
    round4(center.lng - dLng),
    round4(center.lat - dLat),
    round4(center.lng + dLng),
    round4(center.lat + dLat),
  ];
}

export function citySlug(name) {
  let s = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(s)) s = `c-${s}`;
  return s.slice(0, 31).replace(/-+$/, "");
}

/**
 * Picks the cities to build. rows: GeoNames city rows ({ geonameid, name,
 * ascii_name, lat, lng, country, population, timezone }). reviewed: [{ id,
 * coverage }]. Returns { cities, skipped } in a stable order (largest first).
 */
export function selectAutoCities(
  rows,
  {
    countries = ["CZ"],
    minPopulation = AUTO_MIN_POPULATION,
    reviewed = [],
    pinned = [],
    reservedIds = [],
  } = {},
) {
  const wanted = new Set(countries.map((c) => c.toUpperCase())),
    reviewedIds = new Set(reviewed.map((r) => r.id)),
    used = new Set([...reviewedIds, ...reservedIds]),
    cities = [],
    skipped = [];
  // Demo cities (demo-cities.mjs) come first with their own clip box; they
  // need no GeoNames row. A reviewed city still wins.
  for (const p of pinned) {
    const skip = (reason) =>
      skipped.push({ geonameid: null, name: p.name, id: p.cityId, reason });
    if (reviewedIds.has(p.cityId)) {
      skip("reviewed-city-wins");
      continue;
    }
    if (reviewed.some((c) => inBox([p.center.lng, p.center.lat], c.coverage))) {
      skip("inside-reviewed-city");
      continue;
    }
    if (used.has(p.cityId)) {
      skip("duplicate-id");
      continue;
    }
    used.add(p.cityId);
    cities.push({
      id: p.cityId,
      name: p.name,
      geonameid: null,
      population: p.population,
      timezone: p.timezone,
      center: { lat: p.center.lat, lng: p.center.lng },
      coverage: [...p.bbox],
      halfKm: DEMO_CITY_HALF_KM,
      demo: true,
      sourceKind: p.sourceKind,
    });
  }
  const sorted = rows
    .filter(
      (r) =>
        wanted.has(String(r.country).toUpperCase()) &&
        Number(r.population) >= minPopulation &&
        Number.isFinite(r.lat) &&
        Number.isFinite(r.lng),
    )
    .sort((a, b) => b.population - a.population || a.geonameid - b.geonameid);
  for (const r of sorted) {
    const center = { lat: r.lat, lng: r.lng };
    let id = citySlug(r.ascii_name || r.name);
    const skip = (reason) =>
      skipped.push({ geonameid: r.geonameid, name: r.name, id, reason });
    if (reviewedIds.has(id)) {
      skip("reviewed-city-wins");
      continue;
    }
    if (reviewed.some((c) => inBox([r.lng, r.lat], c.coverage))) {
      skip("inside-reviewed-city");
      continue;
    }
    // GeoNames lists city districts (Žižkov, Brno-střed, ...) as places of
    // their own; a centre inside a larger city's box belongs to that city.
    if (cities.some((c) => inBox([r.lng, r.lat], c.coverage))) {
      skip("inside-larger-city");
      continue;
    }
    if (!r.timezone) {
      skip("no-timezone");
      continue;
    }
    if (used.has(id)) {
      const suffix = `-${r.geonameid}`;
      id = `${id.slice(0, 31 - suffix.length).replace(/-+$/, "")}${suffix}`;
    }
    used.add(id);
    cities.push({
      id,
      name: r.name,
      geonameid: r.geonameid,
      population: r.population,
      timezone: r.timezone,
      center,
      coverage: coverageFor(center, r.population),
    });
  }
  return { cities, skipped };
}

function outerRing(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates?.[0] || null;
  if (geometry?.type === "MultiPolygon") {
    let best = null;
    for (const poly of geometry.coordinates || [])
      if (!best || (poly[0]?.length || 0) > best.length) best = poly[0];
    return best;
  }
  return null;
}

function bboxOf(coords) {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

function tagsOf(props = {}) {
  const tags = {};
  for (const [k, v] of Object.entries(props))
    if (!k.startsWith("@") && typeof v === "string") tags[k] = v;
  return tags;
}

/** GeoJSON feature from `osmium export --attributes type,id` to an Overpass-style way. */
export function featureToWay(f) {
  const props = f?.properties || {},
    type = props["@type"],
    id = Number(props["@id"]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const g = f.geometry,
    coords = g?.type === "LineString" ? g.coordinates : outerRing(g);
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return {
    type: "way",
    id,
    ...(type && type !== "way"
      ? { cid: `osm-${type === "relation" ? "rel" : type}-${id}` }
      : {}),
    tags: tagsOf(props),
    geometry: coords.map(([lon, lat]) => ({ lat, lon })),
  };
}

/** Spatial bucket index over city boxes (0.1 degree cells). */
function cityIndex(cities) {
  const grid = new Map(),
    key = (x, y) => `${x},${y}`;
  for (const c of cities) {
    const [w, s, e, n] = c.coverage;
    for (let x = Math.floor(w * 10); x <= Math.floor(e * 10); x++)
      for (let y = Math.floor(s * 10); y <= Math.floor(n * 10); y++) {
        const k = key(x, y);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
  }
  return {
    // Nearest centre among the cities whose box contains p.
    owner([lng, lat]) {
      let best = null,
        bestD = Infinity;
      for (const c of grid.get(
        key(Math.floor(lng * 10), Math.floor(lat * 10)),
      ) || []) {
        if (!inBox([lng, lat], c.coverage)) continue;
        const dx = (lng - c.center.lng) * Math.cos((lat * Math.PI) / 180),
          dy = lat - c.center.lat,
          d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    },
    // Every city whose box overlaps b.
    overlapping(b) {
      const out = new Set();
      for (let x = Math.floor(b[0] * 10); x <= Math.floor(b[2] * 10); x++)
        for (let y = Math.floor(b[1] * 10); y <= Math.floor(b[3] * 10); y++)
          for (const c of grid.get(key(x, y)) || [])
            if (boxesOverlap(c.coverage, b)) out.add(c);
      return [...out];
    },
  };
}

const centroid = (coords) => [
  coords.reduce((s, p) => s + p[0], 0) / coords.length,
  coords.reduce((s, p) => s + p[1], 0) / coords.length,
];
const distSq = (p, c) => {
  const dx = (p[0] - c.lng) * Math.cos((c.lat * Math.PI) / 180),
    dy = p[1] - c.lat;
  return dx * dx + dy * dy;
};

/** Keeps the `limit` items closest to the centre, trimming in batches. */
function boundedPush(list, item, limit) {
  list.push(item);
  if (list.length > limit * 2) {
    list.sort((a, b) => a.d - b.d || a.way.id - b.way.id);
    list.length = limit;
  }
}

/**
 * Bins streamed features into cities. sources: { pois, paths, exclusions }
 * async iterables of GeoJSON features. reviewedBoxes: features inside them
 * belong to the reviewed city and are dropped.
 */
export async function binFeatures(
  cities,
  sources,
  { reviewedBoxes = [], pathLimit = AUTO_PATH_LIMIT } = {},
) {
  const index = cityIndex(cities),
    bins = new Map(
      cities.map((c) => [
        c.id,
        {
          parks: [],
          parkBoxes: [],
          parkPaths: [],
          otherPaths: [],
          exclusions: [],
        },
      ]),
    ),
    inReviewed = (p) => reviewedBoxes.some((b) => inBox(p, b));
  for await (const f of sources.pois || []) {
    const props = f?.properties || {};
    if (!PARK_LEISURE.has(props.leisure) || CLOSED.has(props.access)) continue;
    const way = featureToWay(f);
    if (!way || way.geometry.length < 4) continue;
    const coords = way.geometry.map((g) => [g.lon, g.lat]),
      c = centroid(coords);
    if (inReviewed(c) || coords.some((p) => inReviewed(p))) continue;
    const city = index.owner(c);
    if (!city) continue;
    const bin = bins.get(city.id);
    bin.parks.push(way);
    bin.parkBoxes.push(bboxOf(coords));
  }
  for await (const f of sources.paths || []) {
    const props = f?.properties || {};
    if (
      !WALK_HIGHWAYS.has(props.highway) ||
      CLOSED.has(props.access) ||
      props.foot === "no"
    )
      continue;
    const g = f.geometry;
    if (g?.type !== "LineString" || g.coordinates.length < 2) continue;
    const mid = g.coordinates[Math.floor(g.coordinates.length / 2)];
    if (g.coordinates.some((p) => inReviewed(p))) continue;
    const city = index.owner(mid);
    if (!city) continue;
    const way = featureToWay(f);
    if (!way) continue;
    const bin = bins.get(city.id),
      box = bboxOf(g.coordinates),
      item = { way, d: distSq(mid, city.center) };
    if (bin.parkBoxes.some((b) => boxesOverlap(b, box)))
      boundedPush(bin.parkPaths, item, pathLimit);
    else boundedPush(bin.otherPaths, item, pathLimit);
  }
  for await (const f of sources.exclusions || []) {
    const ring = outerRing(f?.geometry);
    if (!ring || ring.length < 4) continue;
    const box = bboxOf(ring);
    for (const city of index.overlapping(box))
      bins.get(city.id).exclusions.push({ ring, box });
  }
  const out = new Map();
  for (const [id, bin] of bins) {
    const order = (a, b) => a.d - b.d || a.way.id - b.way.id;
    const paths = [
      ...bin.parkPaths.sort(order).slice(0, pathLimit),
      ...bin.otherPaths.sort(order),
    ]
      .slice(0, pathLimit)
      .map((x) => x.way);
    out.set(id, {
      parks: { elements: bin.parks },
      paths: { elements: paths },
      exclusions: bin.exclusions,
    });
  }
  return out;
}

/** Drops targets inside exclusion polygons and candidates centred in one. */
export function applyExclusions(pack, exclusions) {
  if (!exclusions.length)
    return { pack, removedTargets: 0, removedCandidates: 0 };
  const shapes = exclusions.map((e) => {
    let shape = null;
    try {
      const ring =
        e.ring.at(-1)[0] === e.ring[0][0] && e.ring.at(-1)[1] === e.ring[0][1]
          ? e.ring
          : [...e.ring, e.ring[0]];
      shape = polygon([ring]);
    } catch {
      shape = null;
    }
    return { box: e.box, shape };
  });
  const blocked = (p) =>
    shapes.some(
      (s) =>
        s.shape && inBox(p, s.box) && booleanPointInPolygon(point(p), s.shape),
    );
  let removedTargets = 0,
    removedCandidates = 0;
  const candidates = [];
  for (const c of pack.candidates) {
    if (blocked(centroid(c.geometry.coordinates[0]))) {
      removedCandidates++;
      continue;
    }
    const targets = c.targets.filter((t) => !blocked(t.point));
    removedTargets += c.targets.length - targets.length;
    if (!targets.length) {
      removedCandidates++;
      continue;
    }
    candidates.push(
      targets.length === c.targets.length ? c : { ...c, targets },
    );
  }
  return {
    pack: { ...pack, candidates },
    removedTargets,
    removedCandidates,
  };
}

function shiftDay(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds every auto CityPack. Returns { packs: [{ city, pack, text, sha256 }],
 * report }. zonesFor(pack, day) counts zones for the report (injected so the
 * pure part stays testable without the planner).
 */
export async function buildAutoCityPacks({
  rows,
  sources,
  reviewed = [],
  countries = ["CZ"],
  minPopulation = AUTO_MIN_POPULATION,
  version,
  importedAt,
  sampleDays = 7,
  firstDay = new Date().toISOString().slice(0, 10),
  zonesFor = null,
  pinned = [],
  reservedIds = [],
  log = () => {},
}) {
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/.test(version || ""))
    throw Error("An auto city version is required.");
  const { cities, skipped } = selectAutoCities(rows, {
    countries,
    minPopulation,
    reviewed,
    pinned,
    reservedIds,
  });
  log(`auto cities: ${cities.length} selected, ${skipped.length} skipped`);
  const bins = await binFeatures(cities, sources, {
    reviewedBoxes: reviewed.map((r) => r.coverage),
  });
  const packs = [],
    perCity = [],
    days = Array.from({ length: sampleDays }, (_, i) => shiftDay(firstDay, i));
  for (const city of cities) {
    const input = bins.get(city.id),
      half = city.halfKm ?? halfSizeKm(city.population);
    const built = buildCityPack({
      id: city.id,
      name: city.name,
      version,
      timezone: city.timezone,
      center: city.center,
      coverage: city.coverage,
      parks: input.parks,
      paths: input.paths,
      importedAt,
      pathQueryLimit: AUTO_PATH_LIMIT,
      centralRadiusM: Math.round(Math.min(1200, half * 350)),
      fieldReview: "auto",
      source: `OpenStreetMap contributors (${
        city.demo
          ? { bbbike: "BBBike", osmfr: "openstreetmap.fr", geofabrik: "Geofabrik" }[
              city.sourceKind
            ] || "OSM"
          : "Geofabrik"
      } extract, QuestLayer World worker)`,
    });
    const safe = applyExclusions(built.pack, input.exclusions);
    const pack = {
      ...safe.pack,
      status: "auto",
      funded: false,
      geonameid: city.geonameid,
      population: city.population,
      ...(city.demo ? { demoCity: true } : {}),
      builder: `questlayer-auto-city/${AUTO_CITY_BUILDER_VERSION}`,
      pathCoverage: "auto-bounded-snapshot",
    };
    const sectors = Object.fromEntries(
      ["central", "north", "east", "southeast", "southwest", "west"].map(
        (s) => [s, 0],
      ),
    );
    for (const c of pack.candidates) sectors[c.sector]++;
    const zonesPerDay = zonesFor ? days.map((d) => zonesFor(pack, d)) : [];
    const row = {
      id: city.id,
      name: city.name,
      population: city.population,
      candidates: pack.candidates.length,
      paths: pack.paths.length,
      emptySectors: Object.keys(sectors).filter((s) => !sectors[s]),
      removedByExclusions: {
        targets: safe.removedTargets,
        candidates: safe.removedCandidates,
      },
      zonesPerDay,
    };
    if (!pack.candidates.length || (zonesFor && zonesPerDay.every((z) => !z))) {
      perCity.push({ ...row, published: false, reason: "no-zones" });
      continue;
    }
    const text = JSON.stringify(pack);
    perCity.push({ ...row, published: true });
    packs.push({
      city,
      pack,
      text,
      sha256: createHash("sha256").update(text).digest("hex"),
    });
    log(
      `auto city ${city.id}: ${pack.candidates.length} candidates, zones ${zonesPerDay.join("/")}`,
    );
  }
  const published = perCity.filter((c) => c.published),
    zoneDays = published.flatMap((c) => c.zonesPerDay);
  const report = {
    schema: "questlayer.auto-city-report/1",
    version,
    builder: AUTO_CITY_BUILDER_VERSION,
    countries,
    minPopulation,
    sampleDays: days,
    selected: cities.length,
    published: published.length,
    notPublished: perCity
      .filter((c) => !c.published)
      .map((c) => ({ id: c.id, reason: c.reason })),
    skipped,
    emptySectors: published.reduce((n, c) => n + c.emptySectors.length, 0),
    sectorSlots: published.length * SECTOR_COUNT,
    zones: zoneDays.length
      ? {
          min: Math.min(...zoneDays),
          max: Math.max(...zoneDays),
          mean:
            Math.round(
              (zoneDays.reduce((a, b) => a + b, 0) / zoneDays.length) * 100,
            ) / 100,
        }
      : null,
    cities: perCity,
  };
  return { packs, report };
}

/** One { packs, report } from several builds (demo cities, then countries). */
export function combineBuilds(parts, version) {
  if (parts.length === 1) return parts[0];
  const packs = parts.flatMap((p) => p.packs),
    cities = parts.flatMap((p) => p.report.cities),
    published = cities.filter((c) => c.published),
    zoneDays = published.flatMap((c) => c.zonesPerDay),
    last = parts.at(-1)?.report || {};
  return {
    packs,
    report: {
      schema: "questlayer.auto-city-report/1",
      version,
      builder: AUTO_CITY_BUILDER_VERSION,
      countries: [...new Set(parts.flatMap((p) => p.report.countries))],
      minPopulation: last.minPopulation,
      sampleDays: last.sampleDays,
      selected: parts.reduce((n, p) => n + p.report.selected, 0),
      published: published.length,
      notPublished: parts.flatMap((p) => p.report.notPublished),
      skipped: parts.flatMap((p) => p.report.skipped),
      emptySectors: published.reduce((n, c) => n + c.emptySectors.length, 0),
      sectorSlots: published.length * SECTOR_COUNT,
      zones: zoneDays.length
        ? {
            min: Math.min(...zoneDays),
            max: Math.max(...zoneDays),
            mean:
              Math.round(
                (zoneDays.reduce((a, b) => a + b, 0) / zoneDays.length) * 100,
              ) / 100,
          }
        : null,
      cities,
    },
  };
}

export function indexFor(packs, version) {
  return {
    schema: AUTO_CITY_INDEX_SCHEMA,
    version,
    builder: AUTO_CITY_BUILDER_VERSION,
    status: "auto",
    funded: false,
    cities: packs.map(({ city, sha256 }) => ({
      id: city.id,
      name: city.name,
      pack: `${city.id}.json`,
      sha256,
      timezone: city.timezone,
      center: city.center,
      coverage: city.coverage,
      population: city.population,
      geonameid: city.geonameid,
    })),
  };
}

/** Writes a release directory and atomically repoints <work>/city-packs. */
export function publishAutoCities(
  workDir,
  { packs, report },
  version,
  { keep = 2 } = {},
) {
  const dirName = `city-packs-${version}`,
    dir = `${workDir}/${dirName}`,
    tmp = `${dir}.part`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const p of packs) writeFileSync(`${tmp}/${p.city.id}.json`, p.text);
  const index = indexFor(packs, version);
  writeFileSync(`${tmp}/index.json`, `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(`${tmp}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  const link = `${workDir}/city-packs`,
    next = `${link}.next`;
  rmSync(next, { force: true });
  symlinkSync(dirName, next);
  renameSync(next, link);
  const current = realpathSync(link);
  const old = readdirSync(workDir)
    .filter((f) => /^city-packs-.+$/.test(f) && !f.endsWith(".part"))
    .map((f) => `${workDir}/${f}`)
    .filter((p) => realpathSync(p) !== current)
    .sort();
  for (const p of old.slice(0, Math.max(0, old.length - (keep - 1))))
    rmSync(p, { recursive: true, force: true });
  return { dir, index };
}

/** Manifest suitable for git: hashes and counts only, no geometry. */
export function manifestFor(index, report) {
  return {
    schema: "questlayer.auto-city-manifest/1",
    version: index.version,
    builder: index.builder,
    status: "auto",
    funded: false,
    cities: index.cities.map(({ id, name, sha256, population }) => ({
      id,
      name,
      population,
      sha256,
    })),
    report: {
      selected: report.selected,
      published: report.published,
      emptySectors: report.emptySectors,
      sectorSlots: report.sectorSlots,
      zones: report.zones,
    },
  };
}

function readCityRows(sqlitePath, DatabaseSync) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    return db
      .prepare(
        "SELECT geonameid,name,ascii_name,lat,lng,country,population,timezone FROM city",
      )
      .all()
      .map((r) => ({ ...r }));
  } finally {
    db.close();
  }
}

/** Full worker step: reads <work>, builds, publishes. Used by run.mjs and the CLI. */
export async function runAutoCities({
  workDir,
  regions,
  countries,
  minPopulation = AUTO_MIN_POPULATION,
  sampleDays = 7,
  log = () => {},
}) {
  const { DatabaseSync } = await import("node:sqlite");
  const manifest = JSON.parse(
    readFileSync(`${workDir}/current.manifest.json`, "utf8"),
  );
  const regionIds = regions || manifest.regions || ["cz"];
  // Demo city regions ("city-<id>") are pinned; the rest are countries.
  const demoById = new Map(DEMO_CITIES.map((c) => [c.id, c])),
    pinned = regionIds.filter((r) => demoById.has(r)).map((r) => demoById.get(r)),
    countryIds = regionIds.filter((r) => !demoById.has(r));
  const rows = readCityRows(`${workDir}/current.sqlite`, DatabaseSync);
  // Reviewed cities and the zone sampler come from the server code itself.
  const { CITY_REGISTRY, buildCityZones } =
    await import("../../server/spatial/city-pack.mjs");
  const reviewed = CITY_REGISTRY.allCities.map((c) => ({
    id: c.id,
    coverage: c.coverage,
  }));
  const streamsFor = (ids) => {
    const stream = (kind) =>
      (async function* () {
        for (const r of ids)
          yield* readJsonLines(`${workDir}/osm-${r}-${kind}.geojsonseq`);
      })();
    return {
      pois: stream("pois"),
      paths: stream("paths"),
      exclusions: stream("exclusions"),
    };
  };
  const version = `${manifest.version}-a${AUTO_CITY_BUILDER_VERSION}`;
  const common = {
    reviewed,
    minPopulation,
    version,
    importedAt: manifest.builtAt || new Date().toISOString(),
    zonesFor: (pack, day) => buildCityZones(pack, day).length,
    log,
  };
  const parts = [];
  // Demo cities one at a time, each from its own clip only: memory stays at
  // one city's paths (300 cities in one bin set needed several GB). Three
  // sample days keep the report honest at a third of the planner time.
  // Only the pack text is kept between cities (the parsed pack is ~10x it).
  const slim = (part) => {
    for (const p of part.packs) delete p.pack;
    return part;
  };
  for (const city of pinned)
    parts.push(
      slim(
        await buildAutoCityPacks({
          ...common,
          rows: [],
          sources: streamsFor([city.id]),
          countries: [],
          pinned: [city],
          sampleDays: Math.min(sampleDays, 3),
        }),
      ),
    );
  const pinnedIds = pinned.map((c) => c.cityId);
  if (countryIds.length)
    parts.push(
      await buildAutoCityPacks({
        ...common,
        rows,
        sources: streamsFor(countryIds),
        countries: countries || countryIds.map((r) => r.toUpperCase()),
        reservedIds: pinnedIds,
        sampleDays,
      }),
    );
  const built = combineBuilds(parts, version);
  const { dir, index } = publishAutoCities(workDir, built, version);
  writeFileSync(
    `${dir}/manifest.json`,
    `${JSON.stringify(manifestFor(index, built.report), null, 2)}\n`,
  );
  return { dir, index, report: built.report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Map(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "1"];
    }),
  );
  const workDir = resolve(
    args.get("work") || process.env.POI_WORK_DIR || ".data/poi",
  );
  if (!existsSync(`${workDir}/current.sqlite`)) {
    console.error(
      `No POI release in ${workDir}; run scripts/poi/run.mjs first.`,
    );
    process.exit(1);
  }
  const { report, dir } = await runAutoCities({
    workDir,
    countries: args.get("country")?.split(","),
    minPopulation: Number(args.get("min-pop") || AUTO_MIN_POPULATION),
    sampleDays: Number(args.get("sample-days") || 7),
    log: (m) => console.error(`[auto-cities] ${new Date().toISOString()} ${m}`),
  });
  const { cities, ...summary } = report;
  console.log(
    JSON.stringify({ dir, ...summary, skipped: summary.skipped.length }),
  );
}

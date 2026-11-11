import { readFileSync } from "node:fs";
import {
  area,
  bbox,
  booleanIntersects,
  booleanPointInPolygon,
  booleanValid,
  circle,
  distance as geoDistance,
  feature,
  featureCollection,
  intersect,
  lineString,
  point,
  pointOnFeature,
  pointToLineDistance,
  simplify,
} from "@turf/turf";
import { seeded, distance } from "../domain.mjs";
import {
  createPedestrianRouter,
  validateExclusions,
} from "./pedestrian-graph.mjs";
import { autoCitiesDir, loadAutoCities } from "./auto-cities.mjs";
// City registry: server/data/cities.json lists every CityPack the server knows.
// "live" packs are planned daily and matched by GPS; "preview" packs load and
// validate but never reach players. Exactly one live city is the default: it
// hosts the arena and is the one city native rewards publish for. Funding is
// separate (NATIVE_FUNDED_CITIES in server/native/allocation.mjs).
const CITY_STATUSES = new Set(["live", "preview"]);
function boxesOverlap(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}
export function loadCityRegistry(
  registry,
  readPack = (file) =>
    JSON.parse(
      readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"),
    ),
) {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.cities))
    throw Error("City registry must be { version: 1, cities: [...] }.");
  const entries = registry.cities;
  if (!entries.length || entries.length > 32)
    throw Error("City registry needs 1 to 32 cities.");
  const byId = new Map();
  for (const entry of entries) {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(entry?.id || ""))
      throw Error(`Invalid city id ${JSON.stringify(entry?.id)}.`);
    if (byId.has(entry.id)) throw Error(`Duplicate city ${entry.id}.`);
    if (!CITY_STATUSES.has(entry.status))
      throw Error(`City ${entry.id} needs status live or preview.`);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.json$/.test(entry.pack || ""))
      throw Error(`City ${entry.id} needs a pack file in server/data.`);
    const pack = readPack(entry.pack);
    if (pack?.id !== entry.id)
      throw Error(
        `Pack ${entry.pack} has id ${pack?.id}, expected ${entry.id}.`,
      );
    const c = pack.coverage;
    if (
      !Array.isArray(c) ||
      c.length !== 4 ||
      !c.every(Number.isFinite) ||
      !(c[0] < c[2] && c[1] < c[3]) ||
      !(pack.center?.lng >= c[0] && pack.center.lng <= c[2]) ||
      !(pack.center?.lat >= c[1] && pack.center.lat <= c[3]) ||
      typeof pack.timezone !== "string"
    )
      throw Error(
        `Pack ${entry.id} needs a timezone and a centre inside its coverage.`,
      );
    byId.set(entry.id, { ...entry, default: entry.default === true, pack });
  }
  const live = [...byId.values()].filter((e) => e.status === "live"),
    defaults = [...byId.values()].filter((e) => e.default);
  if (defaults.length !== 1 || defaults[0].status !== "live")
    throw Error("Exactly one live city must be the default.");
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++)
      if (boxesOverlap(live[i].pack.coverage, live[j].pack.coverage))
        throw Error(`Live cities ${live[i].id} and ${live[j].id} overlap.`);
  return {
    defaultCity: defaults[0].pack,
    liveCities: live.map((e) => e.pack),
    allCities: [...byId.values()].map((e) => e.pack),
    statusOf: (id) => byId.get(id)?.status || null,
  };
}
export const CITY_REGISTRY = loadCityRegistry(
  JSON.parse(
    readFileSync(new URL("../data/cities.json", import.meta.url), "utf8"),
  ),
);
export const DEFAULT_CITY = CITY_REGISTRY.defaultCity;
export const LIVE_CITIES = CITY_REGISTRY.liveCities;
// Kept for scripts and QA that are about Plzeň specifically.
export const PLZEN = CITY_REGISTRY.allCities.find((c) => c.id === "plzen");
// Auto cities (status "auto", docs/WORLDS-PLAN.md C.3 point 7): built by the
// World worker outside git, loaded lazily, never funded. Every reviewed city
// in the registry (any status) takes precedence over them.
export const AUTO_CITIES = loadAutoCities(autoCitiesDir(), {
  reviewed: CITY_REGISTRY.allCities.map((c) => ({
    id: c.id,
    coverage: c.coverage,
  })),
});
export function cityById(id) {
  return (
    CITY_REGISTRY.allCities.find((c) => c.id === id) ||
    AUTO_CITIES.pack(id) ||
    null
  );
}
export function liveCityById(id) {
  return LIVE_CITIES.find((c) => c.id === id) || null;
}
/** A city players can be in: a live reviewed city or an auto city. */
export function playableCityById(id) {
  return liveCityById(id) || AUTO_CITIES.pack(id) || null;
}
/** "live" | "preview" | "auto" | null */
export function cityStatus(id) {
  return (
    CITY_REGISTRY.statusOf(id) || (AUTO_CITIES.has(id) ? "auto" : null)
  );
}
export function isAutoCity(city) {
  return city?.fieldReview === "auto";
}
// Precedence for one location: reviewed live city > auto city > H3 cell.
export function cityFor(p) {
  for (const city of LIVE_CITIES) {
    const [b, l, r, t] = city.coverage;
    if (p.lng >= b && p.lng <= r && p.lat >= l && p.lat <= t) return city;
  }
  return AUTO_CITIES.cityFor(p);
}
export function contains(geometry, p) {
  return (
    !!geometry &&
    booleanPointInPolygon(point([p.lng, p.lat]), feature(geometry), {
      ignoreBoundary: false,
    })
  );
}
function radius(f, c) {
  return Math.max(
    ...f.geometry.coordinates
      .flat()
      .map((p) => geoDistance(c, p, { units: "meters" })),
  );
}
export function polygonGap(a, b) {
  const fa = feature(a),
    fb = feature(b);
  if (booleanIntersects(fa, fb)) return 0;
  const ca = pointOnFeature(fa),
    cb = pointOnFeature(fb);
  const lower =
    geoDistance(ca, cb, { units: "meters" }) - radius(fa, ca) - radius(fb, cb);
  if (lower > 251) return lower;
  let gap = Infinity;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ])
    for (const ring of x.coordinates)
      for (const p of ring)
        for (const edge of y.coordinates)
          gap = Math.min(
            gap,
            pointToLineDistance(point(p), lineString(edge), {
              units: "meters",
            }),
          );
  return gap;
}
function chooseTargets(shape, entries, rng) {
  const unique = [
    ...new Map(entries.map((e) => [e.point.join(","), e.point])).values(),
  ].filter((p) => contains(shape, { lng: p[0], lat: p[1] }));
  const shuffled = unique
    .map((p) => ({ p, r: rng() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
  for (const first of shuffled.slice(0, 80))
    for (const second of shuffled.slice(0, 100)) {
      if (geoDistance(first, second, { units: "meters" }) < 55) continue;
      const third = shuffled.find(
        (p) =>
          geoDistance(first, p, { units: "meters" }) >= 55 &&
          geoDistance(second, p, { units: "meters" }) >= 55,
      );
      if (third) return [first, second, third];
    }
  return [];
}
export function buildCityZones(pack, day, { onRejected = () => {} } = {}) {
  const exclusions = validateExclusions(pack.exclusions || []);
  const router = pack.pedestrianGraph
    ? createPedestrianRouter(pack.pedestrianGraph, { exclusions })
    : null;
  if (router && router.cityId !== pack.id)
    throw Error("Pedestrian graph belongs to another city.");
  const rng = seeded(`${pack.id}:${day}:polygons-v2`),
    sectors = ["central", "north", "east", "southeast", "southwest", "west"];
  const tiers = [1, 1, 1, 2, 2, 3],
    // The compact demo layout (server/demo-zones.mjs) packs its six zones
    // around one square, so it asks for a smaller (still positive) gap.
    minGapM = Number.isFinite(pack.demoZones?.zoneGapM)
      ? Math.max(50, pack.demoZones.zoneGapM)
      : 250;
  for (let i = tiers.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
  }
  const zones = [];
  for (const [slot, sector] of sectors.entries()) {
    const reject = (c, reason) =>
      onRejected({ candidateId: c.id, sector, reason });
    for (const c of pack.candidates.filter(
      (c) =>
        c.sector === sector &&
        (!Array.isArray(c.targets) || c.targets.length < 3),
    ))
      reject(c, "insufficient-targets");
    const candidates = pack.candidates
      .filter(
        (c) =>
          c.sector === sector &&
          Array.isArray(c.targets) &&
          c.targets.length >= 3,
      )
      .map((c) => ({ c, r: rng() }))
      .sort((a, b) => a.r - b.r);
    for (const { c } of candidates) {
      try {
        let f = feature(c.geometry);
        if (exclusions.some((e) => booleanIntersects(f, feature(e.geometry)))) {
          reject(c, "excluded-area");
          continue;
        }
        if (area(f) > 120000) {
          const centers = c.targets.filter((_, i) => i % 13 === 0);
          const center = centers[Math.floor(rng() * centers.length)]?.point;
          if (!center) {
            reject(c, "missing-public-target");
            continue;
          }
          f = intersect(
            featureCollection([f, circle(center, 0.18, { steps: 10 })]),
          );
        }
        if (!f || f.geometry.type !== "Polygon") {
          reject(c, "disconnected-or-missing-footprint");
          continue;
        }
        const reduced = simplify(f, { tolerance: 0.000015, highQuality: true });
        if (booleanValid(reduced)) f = reduced;
        if (!booleanValid(f) || area(f) < 3000) {
          reject(c, "invalid-or-small-footprint");
          continue;
        }
        if (zones.some((z) => polygonGap(f.geometry, z.geometry) < minGapM)) {
          reject(c, "boundary-gap");
          continue;
        }
        const targets = chooseTargets(f.geometry, c.targets, rng);
        if (targets.length < 3) {
          reject(c, "insufficient-separated-targets");
          continue;
        }
        let walking = null;
        if (router) {
          const rawEntry = c.entry || c.entries?.[0];
          if (!rawEntry) {
            reject(c, "missing-reviewed-entry");
            continue;
          }
          const entry = rawEntry.point
            ? {
                lng: rawEntry.point[0],
                lat: rawEntry.point[1],
                pathId: rawEntry.pathId,
              }
            : rawEntry;
          const routes = targets.map((p) => {
            const target = c.targets.find(
              (t) => t.point[0] === p[0] && t.point[1] === p[1],
            );
            return router.route(entry, {
              lng: p[0],
              lat: p[1],
              pathId: target?.pathId,
            });
          });
          if (routes.some((r) => r.status !== "reachable")) {
            reject(c, "unreachable-objective");
            continue;
          }
          const transfer = zones.length
            ? router.route(zones[0].walking.entry, entry)
            : null;
          if (transfer && transfer.status !== "reachable") {
            reject(c, "disconnected-city-transfer");
            continue;
          }
          walking = {
            entry,
            routes,
            transfer,
            graphHash: router.hash,
            fieldReview: "pending",
          };
        }
        const box = bbox(f),
          ratio =
            Math.max((box[2] - box[0]) * 0.65, box[3] - box[1]) /
            Math.max(
              0.00001,
              Math.min((box[2] - box[0]) * 0.65, box[3] - box[1]),
            );
        zones.push({
          slot,
          sector,
          tier: tiers[slot],
          name: c.name,
          geometry: f.geometry,
          targets: targets.map((p) => ({ lng: p[0], lat: p[1] })),
          lat: targets[0][1],
          lng: targets[0][0],
          shapeFamily:
            ratio > 2.3 ? "green-belt" : area(f) > 25000 ? "park" : "garden",
          sourceId: c.id,
          areaM2: Math.round(area(f)),
          fieldReview: "pending",
          ...(walking ? { walking } : {}),
        });
        break;
      } catch {
        reject(c, "invalid-candidate-data");
      }
    }
  }
  return zones;
}
export function sampleCityPaths(pack, max = 6000) {
  const paths = pack.paths.map((p) => ({ id: p.id, points: p.points }));
  const points = [],
    seen = new Set();
  // Round-robin sampling covers the bounded snapshot instead of exhausting the first streets.
  for (let offset = 0; points.length < max; offset++) {
    let active = false;
    for (const path of paths) {
      if (offset >= path.points.length - 1) continue;
      active = true;
      const a = path.points[offset],
        b = path.points[offset + 1];
      const n = Math.max(
        1,
        Math.floor(
          distance({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] }) / 16,
        ),
      );
      for (let j = 0; j < n; j++) {
        const p = {
          lng: a[0] + ((b[0] - a[0]) * j) / n,
          lat: a[1] + ((b[1] - a[1]) * j) / n,
        };
        const key = `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
        if (!seen.has(key)) {
          seen.add(key);
          points.push(p);
        }
        if (points.length >= max) break;
      }
      if (points.length >= max) break;
    }
    if (!active) break;
  }
  return points;
}

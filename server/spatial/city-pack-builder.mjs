// Turns reviewed Overpass downloads (parks + walkable ways) into a CityPack in
// the same shape as server/data/plzen-v1.json. Pure and deterministic: the
// same inputs give the same pack, so a reviewer can diff two revisions.
// Second-city playbook: docs/SECOND-CITY-PLAYBOOK.md.
import { booleanPointInPolygon, point, polygon } from "@turf/turf";
import { distance } from "../domain.mjs";

export const SECTORS = [
  "central",
  "north",
  "east",
  "southeast",
  "southwest",
  "west",
];
const CLOSED_ACCESS = new Set(["private", "no"]);

// Outer sectors by compass bearing from the city centre (degrees).
export function sectorFor(center, p, centralRadiusM = 1200) {
  if (distance(center, p) <= centralRadiusM) return "central";
  const dy = p.lat - center.lat,
    dx = (p.lng - center.lng) * Math.cos((center.lat * Math.PI) / 180),
    bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  if (bearing >= 315 || bearing < 45) return "north";
  if (bearing < 120) return "east";
  if (bearing < 180) return "southeast";
  if (bearing < 240) return "southwest";
  return "west";
}

const ways = (json) =>
  (Array.isArray(json?.elements) ? json.elements : []).filter(
    (e) => e.type === "way" && Array.isArray(e.geometry),
  );
const coords = (way) =>
  way.geometry
    .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon))
    .map((g) => [Number(g.lon.toFixed(7)), Number(g.lat.toFixed(7))]);
const inside = (p, [b, l, r, t]) =>
  p[0] >= b && p[0] <= r && p[1] >= l && p[1] <= t;

export function buildCityPack({
  id,
  name,
  version,
  timezone,
  center,
  coverage,
  parks,
  paths,
  importedAt = new Date().toISOString(),
  pathQueryLimit = 3500,
  centralRadiusM = 1200,
}) {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id || ""))
    throw Error("City id must be lowercase letters, digits or dashes.");
  if (!name || !version || !timezone)
    throw Error("Name, version and timezone are required.");
  if (!Array.isArray(coverage) || coverage.length !== 4)
    throw Error("Coverage is [west, south, east, north].");
  if (!inside([center.lng, center.lat], coverage))
    throw Error("The centre must sit inside the coverage box.");
  const walkable = ways(paths)
    .filter((w) => !CLOSED_ACCESS.has(w.tags?.access) && w.tags?.foot !== "no")
    .map((w) => ({ id: `osm-way-${w.id}`, points: coords(w) }))
    .filter(
      (w) => w.points.length >= 2 && w.points.some((p) => inside(p, coverage)),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, pathQueryLimit);
  const pathPoints = walkable.flatMap((w) =>
    w.points.map((p) => ({ point: p, pathId: w.id })),
  );
  const candidates = [],
    skipped = [];
  for (const way of ways(parks).sort((a, b) => a.id - b.id)) {
    const ring = coords(way),
      cid = `osm-way-${way.id}`;
    const closed =
      ring.length >= 4 &&
      ring[0][0] === ring.at(-1)[0] &&
      ring[0][1] === ring.at(-1)[1];
    if (!closed) {
      skipped.push({ id: cid, reason: "open-ring" });
      continue;
    }
    if (CLOSED_ACCESS.has(way.tags?.access)) {
      skipped.push({ id: cid, reason: "closed-access" });
      continue;
    }
    if (!ring.every((p) => inside(p, coverage))) {
      skipped.push({ id: cid, reason: "outside-coverage" });
      continue;
    }
    let shape;
    try {
      shape = polygon([ring]);
    } catch {
      skipped.push({ id: cid, reason: "invalid-polygon" });
      continue;
    }
    const seen = new Set(),
      targets = [];
    for (const t of pathPoints) {
      const key = t.point.join(",");
      if (seen.has(key)) continue;
      if (booleanPointInPolygon(point(t.point), shape)) {
        seen.add(key);
        targets.push(t);
      }
    }
    if (!targets.length) {
      skipped.push({ id: cid, reason: "no-mapped-path-inside" });
      continue;
    }
    const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length,
      lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    candidates.push({
      id: cid,
      sector: sectorFor(center, { lat, lng }, centralRadiusM),
      name: way.tags?.name || `Park ${way.id}`,
      geometry: { type: "Polygon", coordinates: [ring] },
      access: way.tags?.access || "not-specified",
      targets,
      fieldReview: "pending",
    });
  }
  const pack = {
    id,
    name,
    version,
    timezone,
    center,
    coverage,
    boundaryKind: "data-coverage-not-administrative-boundary",
    source: "OpenStreetMap contributors / Overpass",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    license: "ODbL-1.0",
    importedAt,
    fieldReview: "pending",
    pathQueryLimit,
    pathCoverage: "partial-bounded-snapshot",
    candidates,
    paths: walkable,
  };
  const bySector = Object.fromEntries(SECTORS.map((s) => [s, 0]));
  for (const c of candidates) bySector[c.sector]++;
  return {
    pack,
    report: {
      candidates: candidates.length,
      paths: walkable.length,
      bySector,
      emptySectors: SECTORS.filter((s) => !bySector[s]),
      skipped,
    },
  };
}

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
export const PLZEN = JSON.parse(
  readFileSync(new URL("../data/plzen-v1.json", import.meta.url), "utf8"),
);
export function cityFor(p) {
  const [b, l, r, t] = PLZEN.coverage;
  return p.lng >= b && p.lng <= r && p.lat >= l && p.lat <= t ? PLZEN : null;
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
  const rng = seeded(`${pack.id}:${day}:polygons-v2`),
    sectors = ["central", "north", "east", "southeast", "southwest", "west"];
  const tiers = [1, 1, 1, 2, 2, 3];
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
        if (zones.some((z) => polygonGap(f.geometry, z.geometry) < 250)) {
          reject(c, "boundary-gap");
          continue;
        }
        const targets = chooseTargets(f.geometry, c.targets, rng);
        if (targets.length < 3) {
          reject(c, "insufficient-separated-targets");
          continue;
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

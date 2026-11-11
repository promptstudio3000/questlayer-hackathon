// Irregular zone outlines (Lubos, 11 Nov 2026: zones should not be perfect
// circles). A smooth "blob" around a point: the radius wobbles with a few
// low-frequency waves seeded by the zone id, so the same id always gives the
// same shape and the outline stays between ~0.73× and ~1.27× the radius.
import { hash } from "../domain.mjs";

const M_PER_DEG_LAT = 110540;

function waves(seed) {
  const h = hash(String(seed));
  const byte = (i) => parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
  // Three waves (2, 3 and 5 bumps) with seeded phase and strength.
  return [2, 3, 5].map((k, i) => ({
    k,
    phase: byte(i) * Math.PI * 2,
    amp: 0.04 + byte(i + 3) * 0.05,
  }));
}

/**
 * A closed GeoJSON ring around {lat,lng} with mean radius `radiusM` metres.
 * `steps` points (plus the closing one), coordinates rounded to 1e-7.
 */
export function organicRing(center, radiusM, seed, steps = 28) {
  const w = waves(seed),
    lngScale = 111320 * Math.cos((center.lat * Math.PI) / 180),
    ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((i % steps) / steps) * Math.PI * 2,
      r = radiusM * (1 + w.reduce((s, x) => s + x.amp * Math.sin(x.k * a + x.phase), 0));
    ring.push([
      Number((center.lng + (Math.cos(a) * r) / lngScale).toFixed(7)),
      Number((center.lat + (Math.sin(a) * r) / M_PER_DEG_LAT).toFixed(7)),
    ]);
  }
  return ring;
}

/** The same blob as a GeoJSON Polygon. */
export const organicPolygon = (center, radiusM, seed, steps) => ({
  type: "Polygon",
  coordinates: [organicRing(center, radiusM, seed, steps)],
});

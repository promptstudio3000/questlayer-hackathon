// Small, dependency-free geometry helpers for the POI safety filter.
// Distances use a local equirectangular projection, which is accurate to well
// under a metre at the 40 m scale the filter works at.

const R = 6_371_000;
const RAD = Math.PI / 180;

/** Metres per degree of latitude/longitude around a latitude. */
export function metresPerDegree(lat) {
  return { lat: R * RAD, lng: R * RAD * Math.cos(lat * RAD) };
}

/** Project [lng, lat] to local metres around an origin {lat, lng}. */
export function project(origin, [lng, lat]) {
  const m = metresPerDegree(origin.lat);
  return [(lng - origin.lng) * m.lng, (lat - origin.lat) * m.lat];
}

export function unproject(origin, [x, y]) {
  const m = metresPerDegree(origin.lat);
  return [origin.lng + x / m.lng, origin.lat + y / m.lat];
}

export function distanceM(a, b) {
  const [x, y] = project({ lat: a[1], lng: a[0] }, b);
  return Math.hypot(x, y);
}

/** Nearest point on segment a-b to p, all in [lng, lat]. */
export function nearestOnSegment(p, a, b) {
  const origin = { lat: p[1], lng: p[0] };
  const [ax, ay] = project(origin, a),
    [bx, by] = project(origin, b);
  const dx = bx - ax,
    dy = by - ay,
    len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  const x = ax + t * dx,
    y = ay + t * dy;
  return { point: unproject(origin, [x, y]), distanceM: Math.hypot(x, y) };
}

function ringContains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Polygons as arrays of rings ([outer, ...holes]) for Polygon/MultiPolygon. */
export function polygonsOf(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

export function containsPoint(geometry, p) {
  return polygonsOf(geometry).some(
    ([outer, ...holes]) =>
      ringContains(outer, p) && !holes.some((h) => ringContains(h, p)),
  );
}

/** Distance from p to the polygon (0 inside), in metres. */
export function distanceToArea(geometry, p) {
  if (containsPoint(geometry, p)) return 0;
  let best = Infinity;
  for (const rings of polygonsOf(geometry))
    for (const ring of rings)
      for (let i = 1; i < ring.length; i++)
        best = Math.min(
          best,
          nearestOnSegment(p, ring[i - 1], ring[i]).distanceM,
        );
  return best;
}

export function bboxOf(geometry) {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === "number") {
      w = Math.min(w, c[0]);
      e = Math.max(e, c[0]);
      s = Math.min(s, c[1]);
      n = Math.max(n, c[1]);
    } else c.forEach(visit);
  };
  visit(geometry.coordinates);
  return [w, s, e, n];
}

/** Grow a bbox by metres on every side. */
export function padBbox([w, s, e, n], metres) {
  const m = metresPerDegree((s + n) / 2);
  const dLng = metres / Math.max(m.lng, 1),
    dLat = metres / m.lat;
  return [w - dLng, s - dLat, e + dLng, n + dLat];
}

/**
 * Uniform grid over lng/lat. Items are registered by bbox; a query returns
 * each item at most once. Cells are about 110 m tall, which keeps a 40 m
 * snap query to a handful of cells.
 */
export class Grid {
  constructor(cellDeg = 0.001) {
    this.cell = cellDeg;
    this.cells = new Map();
    this.large = [];
    this.maxCells = 2500;
  }
  #range([w, s, e, n]) {
    const c = this.cell;
    return [
      Math.floor(w / c),
      Math.floor(s / c),
      Math.floor(e / c),
      Math.floor(n / c),
    ];
  }
  insert(bbox, item) {
    const [x0, y0, x1, y1] = this.#range(bbox);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.maxCells) {
      this.large.push({ bbox, item });
      return;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x}:${y}`;
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
  }
  query(bbox) {
    const [x0, y0, x1, y1] = this.#range(bbox);
    const seen = new Set();
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (const item of this.cells.get(`${x}:${y}`) || []) seen.add(item);
    const [w, s, e, n] = bbox;
    for (const { bbox: b, item } of this.large)
      if (b[0] <= e && b[2] >= w && b[1] <= n && b[3] >= s) seen.add(item);
    return [...seen];
  }
}

export function round7(p) {
  return [Number(p[0].toFixed(7)), Number(p[1].toFixed(7))];
}

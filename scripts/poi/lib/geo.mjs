// Small, dependency-free geometry helpers for the POI pipeline. Distances are
// metres on a local equirectangular projection, accurate well below 1 m at
// the 40 m scale the snapping rule needs.
const R = 6371008.8;
const RAD = Math.PI / 180;

export function distanceM(a, b) {
  const x = (b.lng - a.lng) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  const y = (b.lat - a.lat) * RAD;
  return Math.hypot(x, y) * R;
}

// Nearest point on segment a-b to p, with its distance in metres.
export function nearestOnSegment(p, a, b) {
  const k = Math.cos(p.lat * RAD);
  const ax = (a.lng - p.lng) * k,
    ay = a.lat - p.lat,
    bx = (b.lng - p.lng) * k,
    by = b.lat - p.lat;
  const dx = bx - ax,
    dy = by - ay,
    len = dx * dx + dy * dy;
  let t = len ? -(ax * dx + ay * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const point = {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
  return { point, distanceM: distanceM(p, point) };
}

// Uniform lat/lng grid; a cell of 0.001 deg is ~111 m north-south and ~70 m
// east-west in central Europe, so a 40 m query touches at most 3x3 cells.
export class Grid {
  constructor(cellDeg = 0.001) {
    this.cellDeg = cellDeg;
    this.cells = new Map();
  }
  key(lat, lng) {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lng / this.cellDeg)}`;
  }
  add(lat, lng, item) {
    const key = this.key(lat, lng);
    const list = this.cells.get(key);
    if (list) list.push(item);
    else this.cells.set(key, [item]);
  }
  addBox(minLat, minLng, maxLat, maxLng, item) {
    const d = this.cellDeg;
    for (let y = Math.floor(minLat / d); y <= Math.floor(maxLat / d); y++)
      for (let x = Math.floor(minLng / d); x <= Math.floor(maxLng / d); x++) {
        const key = `${y}:${x}`;
        const list = this.cells.get(key);
        if (list) list.push(item);
        else this.cells.set(key, [item]);
      }
  }
  // Items in every cell that intersects the box around (lat,lng) of radius m.
  *near(lat, lng, radiusM) {
    const dLat = radiusM / 111_000,
      dLng = radiusM / (111_000 * Math.max(0.1, Math.cos(lat * RAD)));
    yield* this.inBox(lat - dLat, lng - dLng, lat + dLat, lng + dLng);
  }
  *inBox(minLat, minLng, maxLat, maxLng) {
    const d = this.cellDeg,
      seen = new Set();
    for (let y = Math.floor(minLat / d); y <= Math.floor(maxLat / d); y++)
      for (let x = Math.floor(minLng / d); x <= Math.floor(maxLng / d); x++)
        for (const item of this.cells.get(`${y}:${x}`) || [])
          if (!seen.has(item)) {
            seen.add(item);
            yield item;
          }
  }
}

// Ray casting on a GeoJSON Polygon/MultiPolygon (lng,lat order).
export function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons.some((rings) => {
    if (!rings.length || !inRing(point, rings[0])) return false;
    return !rings.slice(1).some((hole) => inRing(point, hole));
  });
}

function inRing({ lat, lng }, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

export function bboxOf(geometry) {
  let minLat = Infinity,
    minLng = Infinity,
    maxLat = -Infinity,
    maxLng = -Infinity;
  walk(geometry.coordinates, ([lng, lat]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  });
  return { minLat, minLng, maxLat, maxLng };
}

function walk(coords, fn) {
  if (typeof coords[0] === "number") fn(coords);
  else for (const c of coords) walk(c, fn);
}

// A representative point that lies on the feature: the point itself, the
// middle vertex of a line, or for an area the ring centroid when it falls
// inside, otherwise the vertex nearest to it.
export function representativePoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Point")
    return { lat: geometry.coordinates[1], lng: geometry.coordinates[0] };
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const line =
      geometry.type === "LineString"
        ? geometry.coordinates
        : geometry.coordinates[0];
    const [lng, lat] = line[Math.floor(line.length / 2)];
    return { lat, lng };
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const ring =
      geometry.type === "Polygon"
        ? geometry.coordinates[0]
        : largestOuter(geometry);
    const c = ringCentroid(ring);
    if (pointInGeometry(c, geometry)) return c;
    let best = null;
    for (const [lng, lat] of ring) {
      const d = distanceM(c, { lat, lng });
      if (!best || d < best.d) best = { d, lat, lng };
    }
    return { lat: best.lat, lng: best.lng };
  }
  return null;
}

function largestOuter(geometry) {
  let best = geometry.coordinates[0][0],
    bestArea = -1;
  for (const rings of geometry.coordinates) {
    const area = Math.abs(ringArea(rings[0]));
    if (area > bestArea) {
      bestArea = area;
      best = rings[0];
    }
  }
  return best;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

function ringCentroid(ring) {
  let a = 0,
    x = 0,
    y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    x += (ring[j][0] + ring[i][0]) * f;
    y += (ring[j][1] + ring[i][1]) * f;
  }
  if (!a) return { lat: ring[0][1], lng: ring[0][0] };
  return { lat: y / (3 * a), lng: x / (3 * a) };
}

export function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

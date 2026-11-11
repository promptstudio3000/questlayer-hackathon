// Landmark buildings on the 3D base map. Ordinary buildings keep the capped
// height (BUILDING_HEIGHT_CAP) so the game pins stay readable, but churches,
// castles and monuments rise to their real (or a boosted) height so they
// stand out over the rooftops.
//
// The OpenMapTiles building layer has only heights and colours, no building
// type, and it merges look-alike buildings into one multipolygon. So the type
// comes from the poi layer: a landmark poi point inside a building polygon
// marks that one polygon (not the merged group) as a landmark.

export const BUILDING_HEIGHT_CAP = 16;

/** poi classes that can mark a landmark (filtered further by subclass). */
export const LANDMARK_POI_CLASSES = ["place_of_worship", "castle", "monument", "attraction", "historic"];

type Ring = [number, number][];
type Polygon = Ring[];

export type LandmarkPoi = {
  class?: unknown;
  subclass?: unknown;
  lng: number;
  lat: number;
};

export type BuildingShape = {
  polygons: Polygon[];
  height?: unknown;
  minHeight?: unknown;
  hide3d?: unknown;
};

/** Minimum landmark height in metres, by poi kind, or 0 when not a landmark. */
export function landmarkMinHeight(cls: unknown, subclass: unknown): number {
  const c = String(cls || ""),
    s = String(subclass || "");
  if (c === "place_of_worship") return 30;
  if (c === "castle") return 26;
  if (c === "monument" && s === "monument") return 22;
  if (/^(tower|bell_tower|clock_tower|observation_tower)$/.test(s)) return 30;
  return 0;
}

/** Landmark height: its real height, raised to the kind's minimum, kept sane. */
export function landmarkHeight(realHeight: unknown, minHeight: number): number {
  const real = Number(realHeight);
  const h = Math.max(Number.isFinite(real) ? real : 0, minHeight);
  return Math.min(Math.round(h * 10) / 10, 140);
}

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inPolygon(pt: [number, number], polygon: Polygon): boolean {
  if (!polygon.length || !inRing(pt, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => inRing(pt, hole));
}

/**
 * Grow a footprint a little around its centre so the landmark's walls sit just
 * outside the capped base building's walls instead of flickering against them.
 */
export function growPolygon(polygon: Polygon, factor = 1.03): Polygon {
  const outer = polygon[0] || [];
  if (!outer.length) return polygon;
  let cx = 0,
    cy = 0;
  for (const [x, y] of outer) {
    cx += x;
    cy += y;
  }
  cx /= outer.length;
  cy /= outer.length;
  return polygon.map((ring) =>
    ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as [number, number]),
  );
}

/** Polygons of a Polygon or MultiPolygon geometry; anything else gives none. */
export function geometryPolygons(geometry: { type: string; coordinates?: unknown } | null | undefined): Polygon[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates as Polygon];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as Polygon[];
  return [];
}

export type LandmarkFeature = {
  type: "Feature";
  properties: { height: number; base: number; kind: string };
  geometry: { type: "Polygon"; coordinates: Polygon };
};

/**
 * Landmark extrusions: for each landmark poi, the building around it, at the
 * landmark height. A church drawn as parts (nave, tower) lifts every part
 * inside its outline to its real height and the tallest part to at least the
 * landmark minimum. Buildings hidden from 3D in the tiles stay flat.
 * Duplicates (the same poi in several tiles) are dropped.
 */
export function landmarkFeatures(pois: LandmarkPoi[], buildings: BuildingShape[]): LandmarkFeature[] {
  const out: LandmarkFeature[] = [];
  const seen = new Set<string>();
  const shapes = buildings
    .filter((b) => !(b.hide3d === true || b.hide3d === "true"))
    .flatMap((b) => b.polygons.filter((pg) => pg[0]?.length > 2).map((polygon) => ({ polygon, b, area: Math.abs(ringArea(polygon[0])) })));
  for (const poi of pois) {
    const min = landmarkMinHeight(poi.class, poi.subclass);
    if (!min || !Number.isFinite(poi.lng) || !Number.isFinite(poi.lat)) continue;
    const pt: [number, number] = [poi.lng, poi.lat];
    let outline: (typeof shapes)[number] | null = null;
    for (const s of shapes) if (inPolygon(pt, s.polygon) && (!outline || s.area > outline.area)) outline = s;
    if (!outline) continue;
    const parts = shapes.filter((s) => s === outline || (s.area <= outline!.area && inPolygon(centroid(s.polygon[0]), outline!.polygon)));
    const tallest = parts.reduce((a, s) => (num(s.b.height) > num(a.b.height) ? s : a), parts[0]);
    for (const s of parts) {
      const key = ringKey(s.polygon[0]);
      if (seen.has(key)) continue;
      seen.add(key);
      const base = num(s.b.minHeight);
      const height = landmarkHeight(s.b.height, s === tallest ? min : 0);
      if (height <= BUILDING_HEIGHT_CAP && s !== tallest) continue; // the base layer already draws it
      out.push({
        type: "Feature",
        properties: { height, base: base > 0 && base < height ? base : 0, kind: String(poi.class) },
        geometry: { type: "Polygon", coordinates: growPolygon(s.polygon) },
      });
    }
  }
  return out;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function centroid(ring: Ring): [number, number] {
  let x = 0,
    y = 0;
  for (const [a, b] of ring) {
    x += a;
    y += b;
  }
  return [x / ring.length, y / ring.length];
}

function ringKey(ring: Ring): string {
  const [x, y] = centroid(ring);
  return `${x.toFixed(6)},${y.toFixed(6)},${ring.length}`;
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}

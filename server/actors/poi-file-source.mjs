// Actor homes from the W3 POI file (docs/WORLDS-PLAN.md C.6 W7, wave 2).
// Generic NPCs and monsters in auto cities and street cells live at real,
// named, safety-checked places (a castle, a park, a viewpoint) instead of a
// bare path junction. Only rows the POI quests already use are read: safety
// 'ok' with a check-in point on a mapped public path. Reviewed cities (Plzeň)
// keep their own cast and homes; this source is never asked for them.
//
// Deterministic: the list depends only on the POI file and the world (street
// cell, or the auto city's centre cell and its six neighbours).
import { getResolution, gridDisk, isValidCell, latLngToCell } from "h3-js";
import { defaultPoiSource } from "../poi-quests.mjs";

/** At most this many POIs per world reach the spawn planner. */
export const ACTOR_POI_LIMIT = 60;

/** The H3 res-7 cells whose POIs may host actors in this world. */
export function actorPoiCells({ manifest, pack } = {}) {
  const region = manifest?.region;
  if (typeof region === "string" && isValidCell(region) && getResolution(region) === 7) return [region];
  const c = pack?.center;
  if (Number.isFinite(c?.lat) && Number.isFinite(c?.lng)) return gridDisk(latLngToCell(c.lat, c.lng, 7), 1).sort();
  return [];
}

/**
 * A registerPoiSource() function over a POI quest source (default: the file
 * at POI_DB_PATH). Returns up to `limit` of the most notable places as
 * [{ id, lat, lng, kind: "poi" }], sorted by id.
 */
export function poiFileActorSource({ source = defaultPoiSource, limit = ACTOR_POI_LIMIT } = {}) {
  return ({ manifest, pack } = {}) => {
    const src = typeof source === "function" ? source() : source;
    if (!src || !src.available()) return [];
    const seen = new Set(),
      out = [];
    for (const cell of actorPoiCells({ manifest, pack }))
      for (const r of src.cellPois(cell) || []) {
        if (seen.has(r.id) || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
        seen.add(r.id);
        out.push({ id: r.id, lat: r.lat, lng: r.lng, kind: "poi", notability: Number(r.notability) || 0 });
      }
    // Most notable places first when a city has more than the limit.
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return out
      .sort((a, b) => b.notability - a.notability || byId(a, b))
      .slice(0, limit)
      .sort(byId)
      .map(({ notability, ...p }) => p);
  };
}

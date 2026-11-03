// Safe places an NPC of the generic cast can call home (docs/WORLDS-PLAN.md
// C.6 W7). Until the global POI database (W3/W4/W6) lands, POIs come only from
// data the server already holds: a CityPack's reviewed candidate parks, today's
// open zones, and the junctions of the mapped public path graph in a street
// cell. All of them sit on or next to mapped public paths, and closed places
// are dropped. A later POI source plugs in through registerPoiSource and never
// adds coordinates of its own outside the safety filter.
import { pointClosed } from "../spatial/place-safety.mjs";

const sources = [];
/** fn({ manifest, pack, graph, closed }) -> [{ id, lat, lng, kind }] */
export function registerPoiSource(fn) {
  if (typeof fn === "function" && !sources.includes(fn)) sources.push(fn);
}

function ringCenter(geometry) {
  const ring = geometry?.type === "Polygon" ? geometry.coordinates?.[0] : geometry?.type === "MultiPolygon" ? geometry.coordinates?.[0]?.[0] : null;
  if (!Array.isArray(ring) || !ring.length) return null;
  let lng = 0,
    lat = 0;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  return { lng: lng / ring.length, lat: lat / ring.length };
}

/** Path junctions (three or more mapped ways meet): natural meeting points. */
export function junctions(graph, max = 200) {
  const out = [];
  for (const i of graph.nodes) {
    if (graph.adj[i].length / 2 < 3) continue;
    out.push({ id: `junction:${graph.lng[i].toFixed(6)},${graph.lat[i].toFixed(6)}`, lat: graph.lat[i], lng: graph.lng[i], kind: "junction" });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * actorPois({ manifest, pack, graph, zones, closed }) -> POIs sorted by id.
 * Reviewed places first (parks, zones), then registered sources, then path
 * junctions as the fallback every mapped cell has.
 */
export function actorPois({ manifest = {}, pack, graph, zones = [], closed = [] }) {
  const list = [];
  for (const c of pack?.candidates || []) {
    const p = ringCenter(c.geometry);
    if (p) list.push({ id: `park:${c.id}`, ...p, kind: "park" });
  }
  for (const z of zones)
    if (z.placeStatus !== "closed" && Number.isFinite(z.lat))
      list.push({ id: `zone:${z.id}`, ...(z.walking?.entry || { lat: z.lat, lng: z.lng }), kind: "zone" });
  for (const source of sources) {
    try {
      for (const p of source({ manifest, pack, graph, closed }) || [])
        if (typeof p?.id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lng))
          list.push({ id: `poi:${p.id}`, lat: p.lat, lng: p.lng, kind: p.kind || "poi" });
    } catch {
      // A broken source must not hide the cast.
    }
  }
  if (!list.length && graph) list.push(...junctions(graph));
  const blocked = [...(pack?.exclusions || []), ...closed];
  return list
    .filter((p) => !blocked.length || !pointClosed(blocked, p))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

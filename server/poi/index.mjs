// Stable POI classification interface (docs/POI-SAFETY.md).
// W3 (POI import on the Mac) feeds bounded regions through classifyPois();
// W6 (POI quests) reads only records with safety "ok" and a target.
//
//   const { pois, paths, areas } = osmToInputs(overpassStyleElements);
//   const { records, report } = classifyPois({ pois, paths, areas, closures });
//
// No network, no model, no randomness: the same inputs give the same output.

import { latLngToCell } from "h3-js";
import {
  POI_TAXONOMY_VERSION,
  categorizeOsm,
  categorizeOverture,
  poiCategory,
} from "./taxonomy.mjs";
import {
  MAX_SNAP_M,
  MIN_OVERTURE_CONFIDENCE,
  POI_SAFETY_VERSION,
  applyClosures,
  areaRule,
  createSafetyContext,
  evaluatePoi,
  isPublicPath,
  overtureReasons,
  shapeOf,
  tagReasons,
} from "./safety.mjs";
import { round7 } from "./geo.mjs";

export {
  POI_CATEGORIES,
  POI_CATEGORY_IDS,
  POI_TAXONOMY_VERSION,
  categorizeOsm,
  categorizeOverture,
} from "./taxonomy.mjs";
export {
  MAX_SNAP_M,
  POI_CLOSURE_SCOPE,
  POI_SAFETY_VERSION,
  SAFETY_REASONS,
  applyClosures,
  changePoiPlace,
  isPublicPath,
  loadPoiClosures,
} from "./safety.mjs";

/** Recorded on every record and report so a re-import can tell policies apart. */
export const POI_POLICY = Object.freeze({
  taxonomy: POI_TAXONOMY_VERSION,
  safety: POI_SAFETY_VERSION,
  maxSnapM: MAX_SNAP_M,
});

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const coord = (g) => [g.lon ?? g.lng, g.lat];
const finite = (c) => Number.isFinite(c[0]) && Number.isFinite(c[1]);
const closedRing = (c) =>
  c.length >= 4 && c[0][0] === c.at(-1)[0] && c[0][1] === c.at(-1)[1];
const LINEAR_KEYS = ["highway", "waterway", "barrier", "railway", "man_made"];

/** Polygon or line geometry for an Overpass-style element ("out geom"). */
export function osmGeometry(e) {
  if (e.type === "node")
    return finite([e.lon, e.lat])
      ? { type: "Point", coordinates: round7([e.lon, e.lat]) }
      : null;
  if (e.type === "way" && Array.isArray(e.geometry)) {
    const c = e.geometry.map(coord).filter(finite).map(round7);
    if (c.length < 2) return null;
    const tags = e.tags || {};
    const linear =
      tags.area !== "yes" &&
      LINEAR_KEYS.some((k) => tags[k]) &&
      !tags.leisure &&
      !tags.landuse &&
      !tags.amenity &&
      tags.place !== "square" &&
      tags.natural !== "water";
    return closedRing(c) && !linear
      ? { type: "Polygon", coordinates: [c] }
      : { type: "LineString", coordinates: c };
  }
  if (e.type === "relation" && Array.isArray(e.members)) {
    const outers = e.members
      .filter((m) => m.role === "outer" && Array.isArray(m.geometry))
      .map((m) => m.geometry.map(coord).filter(finite).map(round7))
      .filter(closedRing);
    if (!outers.length) return null;
    return outers.length === 1
      ? { type: "Polygon", coordinates: [outers[0]] }
      : { type: "MultiPolygon", coordinates: outers.map((r) => [r]) };
  }
  return null;
}

export const osmId = (e) => `osm:${e.type[0]}${e.id}`;

/**
 * Split Overpass-style elements (nodes, ways and multipolygon relations with
 * geometry) into POI candidates, public paths and grounds. An element can be
 * both (a park polygon is a POI; a school polygon is grounds and a POI that
 * the filter excludes, so reports can count it).
 */
export function osmToInputs(elements = []) {
  const pois = [],
    paths = [],
    areas = [];
  for (const e of [...elements].sort(
    (a, b) => cmp(a.type, b.type) || a.id - b.id,
  )) {
    const tags = e.tags || {};
    const geometry = osmGeometry(e);
    if (!geometry) continue;
    const id = osmId(e);
    if (geometry.type === "LineString" && isPublicPath(tags))
      paths.push({ id, coordinates: geometry.coordinates });
    const isArea = geometry.type !== "Point" && geometry.type !== "LineString";
    const ground = isArea && areaRule(tags);
    if (ground) areas.push({ id, ...ground, geometry });
    const category = categorizeOsm(tags);
    const reasons = tagReasons(tags);
    if (!category && !reasons.length) continue;
    if (!category && !tags.name && geometry.type === "LineString") continue;
    pois.push({
      id,
      source: "osm",
      name: tags.name || null,
      category: category?.category || null,
      rule: category?.rule || null,
      wikidata: tags.wikidata || null,
      access: tags.access || null,
      reasons,
      geometry,
    });
  }
  return { pois, paths, areas };
}

/**
 * Overture places (GeoParquet rows read with DuckDB) to POI candidates.
 * place: { id, names: { primary }, categories: { primary, alternate }, confidence, geometry | lat/lng }
 */
export function overtureToInputs(places = []) {
  return [...places]
    .sort((a, b) => cmp(a.id, b.id))
    .map((p) => {
      const geometry =
        p.geometry?.type === "Point"
          ? { type: "Point", coordinates: round7(p.geometry.coordinates) }
          : { type: "Point", coordinates: round7([p.lng, p.lat]) };
      const category = categorizeOverture(p.categories);
      const reasons = overtureReasons(p.categories);
      if (
        Number.isFinite(p.confidence) &&
        p.confidence < MIN_OVERTURE_CONFIDENCE
      )
        reasons.push("low-confidence");
      return {
        id: `ovt:${p.id}`,
        source: "overture",
        name: p.names?.primary || null,
        category: category?.category || null,
        rule: category?.rule || null,
        wikidata: null,
        access: null,
        reasons,
        geometry,
      };
    })
    .filter((p) => p.category || p.reasons.length);
}

/**
 * Classify POI candidates for one bounded region.
 * closures: from loadPoiClosures(db) (or closedPlaces) so closures survive re-import.
 * Returns records sorted by id and a report with counts per category, safety and reason.
 */
export function classifyPois({
  pois = [],
  paths = [],
  areas = [],
  closures = [],
  maxSnapM = MAX_SNAP_M,
  h3 = true,
} = {}) {
  const ctx = createSafetyContext({ paths, areas, maxSnapM });
  const records = [];
  for (const poi of [...pois].sort((a, b) => cmp(a.id, b.id))) {
    const reasons = [...(poi.reasons || [])];
    const meta = poi.category ? poiCategory(poi.category) : null;
    if (!meta) reasons.push("uncategorised");
    else {
      if (meta.requiresName && !poi.name) reasons.push("unnamed");
      if (meta.review) reasons.push("category-review");
    }
    const result = evaluatePoi(ctx, { ...poi, reasons });
    const [lng, lat] = round7(shapeOf(poi.geometry).label);
    const at = result.target || { lat, lng };
    records.push({
      id: poi.id,
      source: poi.source,
      name: poi.name ?? null,
      category: meta ? poi.category : null,
      rule: poi.rule ?? null,
      lat,
      lng,
      h3r7: h3 ? latLngToCell(at.lat, at.lng, 7) : null,
      h3r5: h3 ? latLngToCell(at.lat, at.lng, 5) : null,
      wikidata: poi.wikidata ?? null,
      access: poi.access ?? null,
      safety: result.safety,
      reasons: result.reasons,
      target: result.target,
      policy: POI_POLICY,
    });
  }
  const closed = applyClosures(records, closures);
  return { records: closed, report: reportOf(closed) };
}

export function reportOf(records) {
  const count = (list) =>
    Object.fromEntries(
      [...list.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map())].sort(
        ([a], [b]) => cmp(a, b),
      ),
    );
  return {
    policy: POI_POLICY,
    total: records.length,
    bySafety: count(records.map((r) => r.safety)),
    byCategory: count(
      records.filter((r) => r.safety === "ok").map((r) => r.category),
    ),
    byReason: count(records.flatMap((r) => r.reasons)),
  };
}

/** Records W6 may turn into quests: categorised, safe and with a path target. */
export const questReady = (records) =>
  records.filter((r) => r.safety === "ok" && r.category && r.target);

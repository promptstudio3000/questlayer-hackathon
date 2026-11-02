// Normalisation and merge rules for the global POI file (docs/WORLDS-PLAN.md
// C.2.2): OSM is primary for geometry and access, Overture fills missing
// named places only when an OSM public path is within 40 m, Wikidata adds
// names and notability. Everything here is pure and works on small fixtures.
import { createHash } from "node:crypto";
import { latLngToCell, cellToParent } from "h3-js";
import {
  Grid,
  bboxOf,
  distanceM,
  nearestOnSegment,
  pointInGeometry,
  representativePoint,
  round6,
} from "./lib/geo.mjs";

export const SNAP_RADIUS_M = 40;
export const MIN_OVERTURE_CONFIDENCE = 0.6;
const NAME_LANGS = ["cs", "en", "de", "sk", "pl"];

const OSM_TYPES = {
  node: "n",
  way: "w",
  relation: "r",
  n: "n",
  w: "w",
  r: "r",
};

function osmIdentity(props, feature) {
  const type = props["@type"] ?? props.type ?? feature.type_hint;
  const id = props["@id"] ?? props.id ?? feature.id;
  if (typeof id === "string" && /^[nwr]\d+$/.test(id))
    return { t: id[0], n: id.slice(1) };
  const t = OSM_TYPES[type];
  if (!t || id === undefined || !/^\d+$/.test(String(id))) return null;
  return { t, n: String(id) };
}

function tagsOf(props) {
  const tags = {};
  for (const [k, v] of Object.entries(props || {}))
    if (!k.startsWith("@") && typeof v === "string") tags[k] = v;
  return tags;
}

function namesFromTags(tags) {
  const names = {};
  for (const lang of NAME_LANGS)
    if (tags[`name:${lang}`]) names[lang] = tags[`name:${lang}`];
  return names;
}

// osmium export (geojsonseq, --attributes type,id) feature -> record or null.
export function normalizeOsmFeature(feature, w4) {
  const props = feature?.properties || {};
  const identity = osmIdentity(props, feature);
  if (!identity) return null;
  const tags = tagsOf(props);
  const category = w4.classifyOsm(tags);
  if (!category) return null;
  const point = representativePoint(feature.geometry);
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng))
    return null;
  const typeName = { n: "node", w: "way", r: "relation" }[identity.t];
  return {
    id: `osm:${identity.t}${identity.n}`,
    lat: round6(point.lat),
    lng: round6(point.lng),
    category,
    name: tags.name || null,
    names: namesFromTags(tags),
    wikidata: /^Q\d+$/.test(tags.wikidata || "") ? tags.wikidata : null,
    notability: 0,
    tags,
    access: tags.access || null,
    hours: tags.opening_hours || null,
    sources: [
      {
        source: "osm",
        sourceId: `${typeName}/${identity.n}`,
        licence: "ODbL-1.0",
      },
    ],
  };
}

// One Overture places row (see fetch.mjs query) -> record or null.
export function normalizeOvertureRow(row, w4, { country } = {}) {
  if (!row || typeof row.id !== "string" || !row.name) return null;
  if (row.operating_status && row.operating_status !== "open") return null;
  if (!(Number(row.confidence) >= MIN_OVERTURE_CONFIDENCE)) return null;
  if (country && row.country && row.country !== country) return null;
  const lat = Number(row.lat),
    lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const category = w4.classifyOverture({
    category: row.category,
    basicCategory: row.basic_category,
  });
  if (!category) return null;
  return {
    id: `ovt:${row.id}`,
    lat: round6(lat),
    lng: round6(lng),
    category,
    name: String(row.name),
    names: {},
    wikidata: null,
    notability: 0,
    tags: {},
    access: null,
    hours: null,
    sources: [
      {
        source: "overture",
        sourceId: row.id,
        licence: "CDLA-Permissive-2.0",
        ...(row.dataset ? { dataset: String(row.dataset) } : {}),
      },
    ],
  };
}

const PATH_HIGHWAYS = new Set([
  "footway",
  "path",
  "pedestrian",
  "living_street",
  "track",
  "cycleway",
  "steps",
  "residential",
  "unclassified",
  "bridleway",
]);
const NO_ACCESS = new Set(["no", "private", "customers"]);

export function isPublicPath(tags = {}) {
  return (
    PATH_HIGHWAYS.has(tags.highway) &&
    !NO_ACCESS.has(tags.access) &&
    !NO_ACCESS.has(tags.foot) &&
    tags.area !== "yes"
  );
}

// Keeps, per record, the nearest public path point within SNAP_RADIUS_M.
// Memory is bounded by the number of records; paths are streamed through.
export class PathSnapper {
  constructor(records, radiusM = SNAP_RADIUS_M) {
    this.radiusM = radiusM;
    this.grid = new Grid(0.001);
    this.best = new Map();
    for (const record of records) this.grid.add(record.lat, record.lng, record);
  }
  considerFeature(feature) {
    const props = feature?.properties || {};
    if (!isPublicPath(tagsOf(props))) return;
    const identity = osmIdentity(props, feature);
    const wayId = identity ? `${identity.t}${identity.n}` : null;
    const g = feature.geometry;
    if (!g) return;
    const lines =
      g.type === "LineString"
        ? [g.coordinates]
        : g.type === "MultiLineString"
          ? g.coordinates
          : [];
    for (const line of lines) this.considerLine(line, wayId);
  }
  considerLine(line, wayId) {
    const pad = this.radiusM / 111_000;
    for (let i = 1; i < line.length; i++) {
      const a = { lng: line[i - 1][0], lat: line[i - 1][1] },
        b = { lng: line[i][0], lat: line[i][1] };
      const k = Math.max(
        0.1,
        Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)),
      );
      for (const record of this.grid.inBox(
        Math.min(a.lat, b.lat) - pad,
        Math.min(a.lng, b.lng) - pad / k,
        Math.max(a.lat, b.lat) + pad,
        Math.max(a.lng, b.lng) + pad / k,
      )) {
        const hit = nearestOnSegment(record, a, b);
        if (hit.distanceM > this.radiusM) continue;
        const prev = this.best.get(record.id);
        if (
          !prev ||
          hit.distanceM < prev.distanceM ||
          (hit.distanceM === prev.distanceM &&
            String(wayId) < String(prev.wayId))
        )
          this.best.set(record.id, {
            lat: round6(hit.point.lat),
            lng: round6(hit.point.lng),
            distanceM: Math.round(hit.distanceM * 10) / 10,
            wayId,
          });
      }
    }
  }
  nearest(id) {
    return this.best.get(id) || null;
  }
}

// Areas a quest target must never fall inside (C.2.3), keyed by reason.
export function exclusionKind(tags = {}) {
  const a = tags.amenity,
    l = tags.landuse;
  if (a === "school" || a === "college") return "school";
  if (a === "kindergarten" || a === "childcare") return "kindergarten";
  if (tags.leisure === "playground") return "playground";
  if (a === "hospital" || a === "clinic") return "hospital";
  if (a === "social_facility" || a === "nursing_home") return "care_home";
  if (a === "prison" || l === "prison") return "prison";
  if (l === "military" || tags.military) return "military";
  if (a === "police") return "police";
  if (
    a === "embassy" ||
    tags.office === "diplomatic" ||
    tags.diplomatic === "embassy"
  )
    return "embassy";
  if (l === "railway") return "railway";
  if (l === "quarry") return "quarry";
  if (l === "construction") return "construction";
  if (a === "grave_yard" || l === "cemetery") return "cemetery";
  if (tags.aeroway === "aerodrome") return "aerodrome";
  return null;
}

export class ExclusionIndex {
  constructor() {
    this.grid = new Grid(0.01);
    this.count = 0;
  }
  addFeature(feature) {
    const g = feature?.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return false;
    const props = feature.properties || {};
    const kind = exclusionKind(tagsOf(props));
    if (!kind) return false;
    const identity = osmIdentity(props, feature);
    const box = bboxOf(g);
    this.grid.addBox(box.minLat, box.minLng, box.maxLat, box.maxLng, {
      kind,
      id: identity ? `osm:${identity.t}${identity.n}` : null,
      geometry: g,
      box,
    });
    this.count++;
    return true;
  }
  find(point) {
    if (!point) return null;
    const hits = [];
    for (const zone of this.grid.inBox(
      point.lat,
      point.lng,
      point.lat,
      point.lng,
    )) {
      const { box } = zone;
      if (
        point.lat < box.minLat ||
        point.lat > box.maxLat ||
        point.lng < box.minLng ||
        point.lng > box.maxLng
      )
        continue;
      if (pointInGeometry(point, zone.geometry)) hits.push(zone);
    }
    if (!hits.length) return null;
    hits.sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id));
    return { kind: hits[0].kind, id: hits[0].id };
  }
}

export function normalizeName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarNames(a, b) {
  const x = normalizeName(a),
    y = normalizeName(b);
  if (!x || !y) return false;
  return (
    x === y ||
    (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)))
  );
}

// Overture rows that duplicate an OSM place are folded into it as a source;
// the others are kept only when an OSM public path is within 40 m.
export function mergeOverture(osmRecords, overtureRecords, snapper) {
  const grid = new Grid(0.001);
  for (const record of osmRecords) grid.add(record.lat, record.lng, record);
  const added = [];
  let folded = 0,
    droppedNoPath = 0;
  for (const ovt of overtureRecords) {
    let match = null,
      matchD = Infinity;
    for (const osm of grid.near(ovt.lat, ovt.lng, 100)) {
      const d = distanceM(osm, ovt);
      const same =
        (d <= 100 && similarNames(osm.name, ovt.name)) ||
        (d <= 30 && osm.category === ovt.category);
      if (same && (d < matchD || (d === matchD && osm.id < match.id))) {
        match = osm;
        matchD = d;
      }
    }
    if (match) {
      match.sources.push(...ovt.sources);
      if (!match.name) match.name = ovt.name;
      folded++;
      continue;
    }
    if (!snapper.nearest(ovt.id)) {
      droppedNoPath++;
      continue;
    }
    added.push(ovt);
  }
  return {
    records: [...osmRecords, ...added],
    folded,
    added: added.length,
    droppedNoPath,
  };
}

// wikidata: Map Qid -> {labels:{cs,en,...}, descriptions:{...}, sitelinks}
export function applyWikidata(records, wikidata) {
  let enriched = 0;
  for (const record of records) {
    const item = record.wikidata && wikidata.get(record.wikidata);
    if (!item) continue;
    enriched++;
    for (const [lang, label] of Object.entries(item.labels || {}))
      if (!record.names[lang]) record.names[lang] = label;
    if (!record.name) record.name = item.labels?.cs || item.labels?.en || null;
    record.notability = Math.max(0, Number(item.sitelinks) || 0);
    if (item.descriptions && Object.keys(item.descriptions).length)
      record.facts = item.descriptions;
    record.sources.push({
      source: "wikidata",
      sourceId: record.wikidata,
      licence: "CC0-1.0",
    });
  }
  return enriched;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// Final row for the SQLite file, with H3 cells and the W4 safety verdict.
export function finalizeRecord(record, { snapper, exclusions, closures, w4 }) {
  const nearestPath = snapper.nearest(record.id);
  const probe = nearestPath || record;
  const exclusion = exclusions.find({ lat: probe.lat, lng: probe.lng });
  const verdict = w4.assessPoi(record, { nearestPath, exclusion, closures });
  const h3r7 = latLngToCell(record.lat, record.lng, 7);
  const sources = [...record.sources].sort((a, b) =>
    `${a.source}:${a.sourceId}`.localeCompare(`${b.source}:${b.sourceId}`),
  );
  const row = {
    id: record.id,
    lat: record.lat,
    lng: record.lng,
    h3r7,
    h3r5: cellToParent(h3r7, 5),
    category: record.category,
    name: record.name,
    names: canonical(record.names || {}),
    wikidata: record.wikidata,
    notability: record.notability || 0,
    sources: canonical(sources),
    safety: verdict.safety,
    safety_reason: verdict.reason || null,
    access: record.access,
    hours: record.hours,
    path_ref: verdict.target
      ? canonical({
          lat: round6(verdict.target.lat),
          lng: round6(verdict.target.lng),
          wayId: nearestPath?.wayId ?? null,
          distanceM: nearestPath?.distanceM ?? null,
        })
      : null,
    facts: record.facts ? canonical(record.facts) : null,
  };
  row.source_hash = sha256(canonical({ ...row, tags: record.tags || {} }));
  return row;
}

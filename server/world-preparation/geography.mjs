import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { area, bbox, bboxClip, bboxPolygon, booleanPointInPolygon, feature, booleanIntersects } from "@turf/turf";
import { latLngToCell, cellToParent, isValidCell, getResolution } from "h3-js";
import tzLookup from "tz-lookup";
import { gunzipSync } from "node:zlib";
import { classifyPois, osmGeometry, categorizeOsm, POI_POLICY } from "../poi/index.mjs";
import { areaRule, tagReasons, isPublicPath, shapeOf } from "../poi/safety.mjs";
import { planCellPoiQuests, MIN_POI_GAP_M, MAX_POI_QUESTS_PER_CELL, POI_QUEST_POLICY } from "../poi-quests.mjs";
import { CELL_ZONE_STEPS } from "../map-rewards/policy.mjs";
import { atlasVisit } from "./atlas.mjs";
import { geographicFeature, normalizeGeographicFeatures } from "./osm-features.mjs";
import { canonical, compare, digest, requireValue, sha256 } from "./canonical.mjs";
import { utcEpoch } from "./calendar.mjs";
import { ownerCell, validateZonePolygon, inside, REGION_SCHEMA, SNAPSHOT_SCHEMA } from "./schema.mjs";
import { inputFile, readBounded, immutableFile, lockDirectory } from "./storage.mjs";
import { prepareGlobalDay, ZoneIndex } from "./worker.mjs";

export const GEOGRAPHY_SCHEMA = "questlayer.geography-catalog/1";
export const ACTIVITY_POLICY = "atlas-geographic-activities/1";
const PLZEN = JSON.parse(readFileSync(new URL("../data/plzen-v1.json", import.meta.url)));
const inBox = (p, [w, s, e, n]) => p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n;
const pointEqual = (a, b) => a[0] === b[0] && a[1] === b[1];

// Assemble split relation members without dropping inner rings. Unresolvable
// multipolygons fail the source region rather than erase a restricted island.
function rings(members) {
  const pending = members.map((m) => {
    requireValue(Array.isArray(m.geometry) && m.geometry.length >= 2, "Incomplete multipolygon member geometry.");
    return m.geometry.map((p) => [p.lon, p.lat]);
  });
  const result = [];
  while (pending.length) {
    let ring = pending.shift();
    while (!pointEqual(ring[0], ring.at(-1))) {
      const i = pending.findIndex((r) => pointEqual(ring.at(-1), r[0]) || pointEqual(ring.at(-1), r.at(-1)));
      requireValue(i >= 0, "Unclosed multipolygon relation; need a complete extract.");
      let next = pending.splice(i, 1)[0];
      if (!pointEqual(ring.at(-1), next[0])) next = next.reverse();
      ring = [...ring, ...next.slice(1)];
    }
    result.push(ring);
  }
  return result;
}

export function completeOsmGeometry(e) {
  if (e.type !== "relation") return osmGeometry(e);
  if (e.tags?.type !== "multipolygon") return null;
  requireValue((e.members || []).reduce((sum, m) => sum + (m.geometry?.length || 0), 0) <= 4096, "Multipolygon exceeds the bounded geometry validator; supply an independently validated normalized extract.");
  const outer = rings((e.members || []).filter((m) => m.role === "outer")), inner = rings((e.members || []).filter((m) => m.role === "inner"));
  requireValue(outer.length > 0, "Multipolygon has no complete outer ring.");
  const polygons = outer.map((r) => [r]);
  for (const ring of inner) {
    const owners = outer.map((r, i) => booleanPointInPolygon(ring[0], { type: "Polygon", coordinates: [r] }, { ignoreBoundary: true }) ? i : -1).filter((i) => i >= 0);
    requireValue(owners.length === 1, "Multipolygon hole has ambiguous ownership.");
    polygons[owners[0]].push(ring);
  }
  for (const coordinates of polygons) validateZonePolygon({ type: "Polygon", coordinates });
  return polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
}

export function geographyInputs(raw) {
  requireValue(!raw.remark, "Incomplete source response.");
  const geometryReport = [];
  const features = Array.isArray(raw.elements)
    ? raw.elements.map((e) => {
      const id = `osm:${e.type[0]}${e.id}`, tags = e.tags || {};
      if (!categorizeOsm(tags) && !tagReasons(tags).length && !areaRule(tags) && !isPublicPath(tags)) return { id, tags, geometry: null };
      try { return { id, geometry: completeOsmGeometry(e), tags }; }
      catch (error) {
        if (!areaRule(tags)) {
          geometryReport.push({ id, action: "reject-feature", reason: error.message });
          return { id, geometry: null, tags };
        }
        // Filling holes in complete restricted-ground shells only excludes
        // MORE land. Never use this conservative representation for a zone.
        // Missing/unclosed outer members remain a fatal source error.
        const outerMembers = (e.members || []).filter((m) => m.role === "outer");
        requireValue(outerMembers.reduce((sum, m) => sum + (m.geometry?.length || 0), 0) <= 4096, `${id}: exclusion geometry needs bounded preprocessing.`);
        const outer = rings(outerMembers);
        requireValue(outer.length > 0, `${id}: exclusion outer geometry is incomplete.`);
        for (const r of outer) validateZonePolygon({ type: "Polygon", coordinates: [r] });
        geometryReport.push({ id, action: "conservative-exclusion-shells", reason: error.message });
        return { id, tags, geometry: outer.length === 1 ? { type: "Polygon", coordinates: [outer[0]] } : { type: "MultiPolygon", coordinates: outer.map((r) => [r]) } };
      }
    })
    : raw.type === "FeatureCollection" ? normalizeGeographicFeatures(raw.features.map(geographicFeature)).features : null;
  requireValue(features, "Supply OSM elements or normalized GeoJSON features with original tags.");
  const pois = [], paths = [], areas = [], sources = new Map();
  for (const f of features.sort((a, b) => compare(a.id, b.id))) {
    if (!f.geometry) continue;
    requireValue(/^osm:[nwr]\d+$/.test(f.id), "Preserve stable OSM identities.");
    requireValue(!sources.has(f.id), "Duplicate source identity within extract.");
    sources.set(f.id, f);
    const category = categorizeOsm(f.tags), reasons = tagReasons(f.tags);
    // This first gameplay adapter opens all day. Do not reinterpret conditional
    // access or known opening hours as unrestricted access.
    const scheduled = Object.keys(f.tags).some((k) => k.includes(":conditional")) || (f.tags.opening_hours && f.tags.opening_hours !== "24/7");
    if (f.geometry.type === "LineString" && isPublicPath(f.tags) && !scheduled) paths.push({ id: f.id, coordinates: f.geometry.coordinates });
    const ground = ["Polygon", "MultiPolygon"].includes(f.geometry.type) && areaRule(f.tags);
    if (ground) areas.push({ id: f.id, ...ground, geometry: f.geometry });
    if (scheduled) geometryReport.push({ id: f.id, action: "exclude-from-all-day-activities", reason: "opening-hours-or-conditional-access-needs-window-adapter" });
    if ((category || reasons.length) && !scheduled) pois.push({ id: f.id, source: "osm", name: f.tags.name || f.tags["name:en"] || null, category: category?.category || null, rule: category?.rule || null, wikidata: f.tags.wikidata || null, access: f.tags.access || null, reasons, geometry: f.geometry });
  }
  return { pois, paths, areas, sources, geometryReport };
}

function readGeography(inputRoot, descriptor) {
  const read = (ref) => {
    const bytes = readBounded(inputFile(inputRoot, ref.file));
    requireValue(sha256(bytes) === ref.sha256, "Geographic input hash mismatch.");
    return (ref.file.endsWith(".gz") ? gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }) : bytes).toString("utf8");
  };
  if (!descriptor.inputs) return geographyInputs(JSON.parse(read(descriptor)));
  requireValue(!descriptor.file && Object.keys(descriptor.inputs).length === 3 && ["pois", "paths", "exclusions"].every((k) => descriptor.inputs[k]), "Supply all three normalized geometry sequences.");
  const datasets = ["pois", "paths", "exclusions"].map((k) => geographyInputs({ type: "FeatureCollection", features: read(descriptor.inputs[k]).split(/\r?\n/).map((s) => s.replace(/^\x1e/, "").trim()).filter(Boolean).map((s) => JSON.parse(s)) }));
  // The same OSM way may be a POI polygon and a path line. Keep each role;
  // choose the POI geometry for the source polygon, never a compressed cell.
  const merge = (key) => [...new Map(datasets.toReversed().flatMap((d) => d[key]).map((v) => [v.id, v])).values()];
  return { pois: merge("pois"), paths: merge("paths"), areas: merge("areas"), sources: new Map(datasets.toReversed().flatMap((d) => [...d.sources])), geometryReport: datasets.flatMap((d) => d.geometryReport) };
}

function boundedContext(inputs, descriptor) {
  const box = descriptor.contextBounds;
  const overlaps = (b) => b[0] <= box[2] && b[2] >= box[0] && b[1] <= box[3] && b[3] >= box[1];
  const paths = inputs.paths.flatMap((p) => {
    const line = feature({ type: "LineString", coordinates: p.coordinates });
    if (!overlaps(bbox(line))) return [];
    const clipped = bboxClip(line, box).geometry;
    const lines = clipped.type === "LineString" ? [clipped.coordinates] : clipped.coordinates;
    return lines.filter((c) => c.length >= 2).map((coordinates) => ({ id: p.id, coordinates }));
  });
  const areas = inputs.areas.filter((a) => overlaps(bbox(feature(a.geometry))) && booleanIntersects(feature(a.geometry), bboxPolygon(box))).map((a) => ({ ...a, geometry: bboxClip(feature(a.geometry), box).geometry }));
  const pois = inputs.pois.filter((p) => {
    const [lng, lat] = shapeOf(p.geometry).label;
    return inBox({ lat, lng }, descriptor.coreBounds) && ownerCell({ lat, lng }) === descriptor.id;
  });
  // Clipping only bounds the safety index. All decisions lie >=1 km inside
  // its edge, well beyond the existing snap/exclusion buffers. Original full
  // source polygons, ways and topology remain in the immutable input file.
  return { ...inputs, pois, paths, areas };
}

function sourceRef(f) {
  const kind = { n: "node", w: "way", r: "relation" }[f.id[4]];
  return { id: f.id, url: `https://www.openstreetmap.org/${kind}/${f.id.slice(5)}`, license: "ODbL-1.0", sha256: digest(f) };
}

function baseObject(record, source) {
  return {
    key: record.id, label: { lat: record.lat, lng: record.lng }, target: { lat: record.target.lat, lng: record.target.lng },
    timezone: tzLookup(record.target.lat, record.target.lng), localWindows: [[0, 1440]],
    title: record.name || "Mapped place", instructions: "Use open public paths and follow local signs.",
    source: sourceRef(source), fieldReview: "unverified", pathRef: record.target.pathId,
  };
}

function visitObject(record, source, zoneKey) {
  const prose = atlasVisit({ name: record.name || "this mapped place", sourceId: record.id });
  return { ...baseObject(record, source), key: `atlas:${record.id}`, kind: "quest", title: prose.title, instructions: prose.instructions,
    ...(zoneKey ? { zoneKey } : {}), serverRequirements: { policy: ACTIVITY_POLICY, template: "poi-visit", targets: [{ lat: record.target.lat, lng: record.target.lng }], sourceIds: [record.id] } };
}

function checkContext(d) {
  for (const box of [d.coreBounds, d.contextBounds]) requireValue(Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) && box[0] < box[2] && box[1] < box[3] && box[0] >= -180 && box[2] <= 180 && box[1] > -85 && box[3] < 85, "Supply non-wrapping extract and context bounds.");
  const [w, s, e, n] = d.coreBounds, c = d.contextBounds;
  const dx = 1000 / (110000 * Math.cos(Math.max(Math.abs(s), Math.abs(n)) * Math.PI / 180)), dy = 1000 / 110000;
  requireValue(c[0] <= w - dx && c[1] <= s - dy && c[2] >= e + dx && c[3] >= n + dy, "Geographic safety context must cover a 1 km margin.");
  requireValue(typeof d.sourceDate === "string" && Number.isFinite(Date.parse(d.sourceDate)), "Record the map source date.");
}

/** Select all activities from real geography before any player reads the day.
 *  No amount, coin, stock or item guarantee is generated by this adapter.
 */
export async function selectGeographicDay({ catalogFile, outputDir, day }) {
  const epoch = utcEpoch(day), catalog = JSON.parse(readBounded(catalogFile));
  requireValue(catalog.schema === GEOGRAPHY_SCHEMA && Array.isArray(catalog.regions) && catalog.regions.length > 0, "Invalid geographic catalog.");
  requireValue(Array.isArray(catalog.closures) && Array.isArray(catalog.recentPoiIds), "Freeze closures and recent POI use explicitly.");
  const root = resolve(outputDir), inputRoot = dirname(resolve(catalogFile)), release = lockDirectory(root);
  try {
    immutableFile(resolve(root, "geography-binding.json"), Buffer.from(canonical({ epoch, catalog, policy: ACTIVITY_POLICY, safety: POI_POLICY })));
    mkdirSync(resolve(root, "selected"), { recursive: true });
    const index = new ZoneIndex(root, MIN_POI_GAP_M), regions = [], areas = [], reports = [], owners = new Set();
    for (const d of [...catalog.regions].sort((a, b) => compare(a.id, b.id))) {
      requireValue(isValidCell(d.id) && getResolution(d.id) === 5 && !owners.has(d.id), "Each source owner must occur once."); owners.add(d.id);
      if (d.status !== "complete") { regions.push({ id: d.id, status: "incomplete", reason: d.reason || "source-incomplete" }); continue; }
      try {
        const sections = d.sections || [d], objects = [], rejected = [], sectionReports = [], selectedCells = new Set();
        requireValue(Array.isArray(sections) && sections.length > 0 && sections.length <= 49, "Supply at most 49 owned res-7 sections.");
        if (d.sections) requireValue(new Set(sections.map(s => s.cell)).size === sections.length && sections.every(s => isValidCell(s.cell) && getResolution(s.cell) === 7 && cellToParent(s.cell, 5) === d.id), "Sections must be unique children of the same owner.");
        for (const section of sections) {
          const part = { ...d, ...section, id: d.id };
          requireValue(!section.status || section.status === "complete", section.reason || "A source section is incomplete.");
          checkContext(part);
          const inputs = boundedContext(readGeography(inputRoot, part), part);
          const classified = classifyPois({ ...inputs, closures: catalog.closures, h3: false });
          const owned = classified.records.filter((p) => ownerCell(p) === d.id && inBox(p, part.coreBounds) && (!part.cell || latLngToCell(p.lat, p.lng, 7) === part.cell));
          const ready = owned.filter((p) => p.safety === "ok" && p.name?.trim() && p.target && p.target.pathId && !inBox(p, PLZEN.coverage));
          const byCell = new Map();
          for (const p of ready) { const cell = latLngToCell(p.lat, p.lng, 7); if (!byCell.has(cell)) byCell.set(cell, []); byCell.get(cell).push(p); }

          for (const [cell, pois] of [...byCell].sort(([a], [b]) => compare(a, b))) {
            const requestedZones = 1 + CELL_ZONE_STEPS.filter((n) => pois.length >= n).length;
            const accepted = [];
            const candidates = pois.filter((p) => ["park", "garden", "plaza"].includes(p.category)).sort((a, b) => compare(digest([day, cell, a.id]), digest([day, cell, b.id])));
            for (const p of candidates) {
              if (accepted.length >= requestedZones) break;
              const f = inputs.sources.get(p.id), geometry = f.geometry;
              try {
                validateZonePolygon(geometry);
                requireValue(area(feature(geometry)) >= 3000, "polygon-too-small");
                requireValue(inside(geometry, p.target), "no-safe-target-inside-polygon");
                const b = bbox(feature(geometry));
                requireValue(b[0] >= part.coreBounds[0] && b[1] >= part.coreBounds[1] && b[2] <= part.coreBounds[2] && b[3] <= part.coreBounds[3], "polygon-needs-larger-context-extract");
                requireValue(![...inputs.areas, ...catalog.closures].some((a) => booleanIntersects(feature(geometry), feature(a.geometry))), "zone-intersects-exclusion-or-closure");
                const z = { ...baseObject(p, f), kind: "zone", areaId: `cell:${cell}`, slot: accepted.length, geometry, entries: [{ lat: p.target.lat, lng: p.target.lng }], serverRequirements: { policy: ACTIVITY_POLICY, template: "zone-entry", sourceIds: [p.id], potential:pois.length } };
                const hash = digest(geometry), path = `selected/${hash}.json`;
                immutableFile(resolve(root, path), Buffer.from(canonical(geometry)));
                index.add({ ...z, id: `${day}:${p.id}` }, { path });
                accepted.push(p); objects.push(z, visitObject(p, f, z.key));
              } catch (error) { rejected.push({ id: p.id, reason: error.message }); }
            }
            requireValue(!selectedCells.has(cell), "A mapped cell cannot allocate another zone set through overlapping sections."); selectedCells.add(cell);
            areas.push({ id: `cell:${cell}`, requestedZones, ...(accepted.length < requestedZones ? { shortfallReason: "not-enough-safe-separated-polygons" } : {}) });
            const plan = planCellPoiQuests({ cell, day, pois: pois.map((p) => ({ id: p.id, name: p.name, category: p.category, lat: p.target.lat, lng: p.target.lng, notability: 0 })), recent: new Set(catalog.recentPoiIds), avoid: accepted.map((p) => p.target), nowYear: Number(day.slice(0, 4)) });
            for (const q of plan.quests.slice(0, MAX_POI_QUESTS_PER_CELL - accepted.length)) {
              const record = pois.find((p) => p.id === q.pois[0].id), f = inputs.sources.get(record.id);
              if (q.template === "poi-category-hunt") {
                const targets = q.pois.map((p) => ({ lat: p.lat, lng: p.lng }));
                objects.push({ ...baseObject(record, f), key: `atlas:hunt:${cell}:${q.category}`, kind: "quest", title: `Atlas: ${q.category.replaceAll("_", " ")} trail`, instructions: "Visit the three marked public spots in any order. Follow open public paths; skip this activity if access is blocked.", serverRequirements: { policy: ACTIVITY_POLICY, template: "poi-category-hunt", targets, sourceIds: q.pois.map((p) => p.id) } });
              } else objects.push(visitObject(record, f));
            }
          }

          sectionReports.push({ cell: part.cell || null, safety: classified.report, owned: owned.length, eligible: ready.length, unnamedOmitted: owned.filter(p => !p.name?.trim()).length, geometryReport: inputs.geometryReport, preservedPlzen: owned.filter(p => inBox(p, PLZEN.coverage)).length });
        }
        const region = { schema: REGION_SCHEMA, id: d.id, countries: d.countries, coverage: { status: "shortfall", reason: d.coverageReason || (objects.length ? "Map-derived access remains field-unverified." : "No safe mapped activities in this extract.") }, objects };
        const encoded = Buffer.from(canonical(region)), file = `${d.id}.json`;
        immutableFile(resolve(root, file), encoded);
        regions.push({ id: d.id, status: "complete", file, sha256: sha256(encoded) });
        reports.push({ id: d.id, sourceDate: d.sourceDate, safety: sectionReports.length === 1 ? sectionReports[0].safety : { sections: sectionReports.map(s => s.safety) }, sections: sectionReports, owned: sectionReports.reduce((n, s) => n + s.owned, 0), eligible: sectionReports.reduce((n, s) => n + s.eligible, 0), unnamedOmitted: sectionReports.reduce((n, s) => n + s.unnamedOmitted, 0), objects: objects.length, rejected, geometryReport: sectionReports.flatMap(s => s.geometryReport), preservedPlzen: sectionReports.reduce((n, s) => n + s.preservedPlzen, 0) });
      } catch (error) { regions.push({ id: d.id, status: "incomplete", reason: error.message }); }
    }
    const versions = Object.fromEntries(["geography", "rules", "closures", "activity", "editions"].map((key) => {
      const value = key === "geography" ? catalog : key === "rules" ? { policy: ACTIVITY_POLICY, safety: POI_POLICY, spacing: MIN_POI_GAP_M, density: CELL_ZONE_STEPS } : key === "closures" ? catalog.closures : key === "activity" ? catalog.recentPoiIds : [];
      return [key, { version: key === "editions" ? "no-item-promises" : `${catalog.version}:${key}`, sha256: digest(value) }];
    }));
    const snapshot = { schema: SNAPSHOT_SCHEMA, sourceCommit: catalog.sourceCommit, versions, zoneGapM: MIN_POI_GAP_M, areas, regions };
    immutableFile(resolve(root, "snapshot-input.json"), Buffer.from(canonical(snapshot)));
    immutableFile(resolve(root, "selection-report.json"), Buffer.from(canonical({ policy: ACTIVITY_POLICY, regions: reports })));
    return { snapshotFile: resolve(root, "snapshot-input.json"), snapshot, reports };
  } finally { release(); }
}

export async function prepareGeographicDay({ catalogFile, outputDir, day }) {
  const selected = await selectGeographicDay({ catalogFile, outputDir: resolve(outputDir, "selection", day), day });
  return prepareGlobalDay({ snapshotFile: selected.snapshotFile, outputDir: resolve(outputDir, day), day });
}

#!/usr/bin/env node
// Acceptance check for a POI release built by any worker (docs/POI-WORKER-BRIEF.md).
// Read-only. Verifies the questlayer.poi/1 contract the game readers rely on:
// tables and columns, meta keys, every poi row (ids, H3 cells, taxonomy,
// safety, path target), partition counts and hashes, path cells and cities.
//
//   npm run poi:validate -- <release.sqlite> [--manifest <file>] [--sample-paths N]
//                            [--max-errors N] [--json]
//
// Exit 0 = accepted, 1 = rejected (the first --max-errors problems are listed).
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { cellToParent, getResolution, isValidCell, latLngToCell } from "h3-js";
import { POI_CATEGORY_IDS, TAXONOMY_VERSION } from "../../server/poi/taxonomy.mjs";
import { SAFETY_REASONS, SAFETY_VERSION } from "../../server/poi/safety.mjs";

export const POI_SCHEMA = "questlayer.poi/1";
export const VERSION_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}-[0-9a-f]{8}$/;
export const ID_RE = /^(?:osm:[nwr]\d+|ovt:[A-Za-z0-9_.:-]+)$/;
export const LIMITS = Object.freeze({ snapM: 40, cellPaths: 150, cellPoints: 30000, nameLen: 300 });

export const COLUMNS = Object.freeze({
  meta: ["key", "value"],
  poi: ["h3r5", "id", "h3r7", "lat", "lng", "category", "name", "names", "wikidata", "notability", "sources",
    "safety", "safety_reason", "access", "hours", "path_ref", "facts", "source_hash"],
  partition: ["h3r5", "pois", "ok", "review", "excluded", "hash"],
  path_cell: ["h3r7", "h3r5", "paths", "ways", "points"],
  city: ["geonameid", "name", "ascii_name", "lat", "lng", "country", "admin1", "population", "timezone", "h3r5"],
});
const REQUIRED_META = ["schema", "version", "regions", "taxonomyVersion", "safetyVersion", "attribution"];
const CATEGORIES = new Set(POI_CATEGORY_IDS);
const isReason = (code) =>
  typeof code === "string" && (code in SAFETY_REASONS || (code.startsWith("inside-") && code.slice(7).replace("care_home", "care-home") in SAFETY_REASONS));

function json(text, kind) {
  if (text === null || text === undefined) return null;
  const value = JSON.parse(text);
  if (kind === "object" && (typeof value !== "object" || Array.isArray(value) || value === null))
    throw new Error("not an object");
  if (kind === "array" && !Array.isArray(value)) throw new Error("not an array");
  return value;
}

export function validateRelease(path, { manifestPath = null, samplePaths = 2000, maxErrors = 50 } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (msg) => {
    if (errors.length < maxErrors) errors.push(msg);
    else if (errors.length === maxErrors) errors.push("… more errors not shown");
  };
  const stats = { pois: 0, bySafety: { ok: 0, review: 0, excluded: 0 }, byCategory: {}, partitions: 0, pathCells: 0, cities: 0 };
  if (!existsSync(path)) return { ok: false, errors: [`${path} does not exist`], warnings, stats };
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    // 1. Tables and columns, exact order.
    for (const [table, cols] of Object.entries(COLUMNS)) {
      const got = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!got.length) fail(`table ${table} is missing`);
      else if (got.join(",") !== cols.join(",")) fail(`table ${table} columns ${got.join(",")} != ${cols.join(",")}`);
    }
    if (errors.length) return { ok: false, errors, warnings, stats };
    const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name));
    for (const name of ["poi_id", "poi_cell"]) if (!indexes.has(name)) fail(`index ${name} is missing`);

    // 2. Meta.
    const meta = Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().map((r) => [r.key, r.value]));
    for (const key of REQUIRED_META) if (!meta[key]) fail(`meta.${key} is missing`);
    if (meta.schema && meta.schema !== POI_SCHEMA) fail(`meta.schema ${meta.schema} != ${POI_SCHEMA}`);
    if (meta.version && !VERSION_RE.test(meta.version)) fail(`meta.version ${meta.version} does not match <regions>-<YYYYMMDD>-<hash8>`);
    if (meta.taxonomyVersion && meta.taxonomyVersion !== TAXONOMY_VERSION)
      fail(`meta.taxonomyVersion ${meta.taxonomyVersion} != ${TAXONOMY_VERSION} (game build)`);
    if (meta.safetyVersion && meta.safetyVersion !== SAFETY_VERSION)
      fail(`meta.safetyVersion ${meta.safetyVersion} != ${SAFETY_VERSION} (game build)`);
    if (meta.attribution && !/OpenStreetMap/.test(meta.attribution)) fail("meta.attribution must credit OpenStreetMap");

    // 3. Every poi row, in primary-key order.
    const partitions = new Map();
    let prevKey = "";
    for (const r of db.prepare("SELECT * FROM poi ORDER BY h3r5, id").iterate()) {
      stats.pois++;
      const at = r.id;
      const key = `${r.h3r5}\u0000${r.id}`;
      if (key <= prevKey) fail(`${at}: duplicate (h3r5,id)`);
      prevKey = key;
      if (!ID_RE.test(r.id)) fail(`${at}: id must be osm:<n|w|r><number> or ovt:<gers id>`);
      if (!(Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180)) { fail(`${at}: lat/lng out of range`); continue; }
      if (r.h3r7 !== latLngToCell(r.lat, r.lng, 7)) fail(`${at}: h3r7 is not the res-7 cell of (lat,lng)`);
      if (r.h3r5 !== cellToParent(r.h3r7, 5)) fail(`${at}: h3r5 is not the res-5 parent of h3r7`);
      if (!CATEGORIES.has(r.category)) fail(`${at}: category ${r.category} is not in ${TAXONOMY_VERSION}`);
      if (r.name !== null && (typeof r.name !== "string" || !r.name.trim() || r.name.length > LIMITS.nameLen))
        fail(`${at}: name must be null or 1-${LIMITS.nameLen} characters`);
      if (!Number.isInteger(r.notability) || r.notability < 0) fail(`${at}: notability must be an integer >= 0`);
      if (r.wikidata !== null && !/^Q\d+$/.test(r.wikidata)) fail(`${at}: wikidata must be Q<number> or null`);
      if (!/^[0-9a-f]{64}$/.test(r.source_hash || "")) fail(`${at}: source_hash must be 64 hex characters`);
      try {
        const names = json(r.names, "object");
        for (const [lang, value] of Object.entries(names))
          if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang) || typeof value !== "string" || !value.trim())
            fail(`${at}: names.${lang} is not a language-coded string`);
      } catch (e) { fail(`${at}: names ${e.message}`); }
      try {
        const sources = json(r.sources, "array");
        if (!sources.length) fail(`${at}: sources is empty`);
        for (const s of sources) if (!s?.source || !s?.sourceId || !s?.licence) fail(`${at}: every source needs source, sourceId, licence`);
      } catch (e) { fail(`${at}: sources ${e.message}`); }
      try { json(r.facts, "object"); } catch (e) { fail(`${at}: facts ${e.message}`); }
      // Safety contract: ok has a target and no reason; review/excluded have a known reason; excluded has no target.
      if (!(r.safety in stats.bySafety)) { fail(`${at}: safety ${r.safety}`); continue; }
      stats.bySafety[r.safety]++;
      if (r.safety === "ok" && r.safety_reason !== null) fail(`${at}: ok row carries safety_reason ${r.safety_reason}`);
      if (r.safety !== "ok" && !isReason(r.safety_reason)) fail(`${at}: unknown safety_reason ${r.safety_reason}`);
      if (r.safety === "ok" && !r.path_ref) fail(`${at}: ok row needs path_ref`);
      if (r.safety === "excluded" && r.path_ref) fail(`${at}: excluded row must not carry path_ref`);
      if (r.path_ref) {
        try {
          const t = json(r.path_ref, "object");
          if (!(Math.abs(t.lat) <= 90 && Math.abs(t.lng) <= 180)) fail(`${at}: path_ref lat/lng`);
          else if (t.distanceM !== null && t.distanceM !== undefined && !(t.distanceM <= LIMITS.snapM + 0.5))
            fail(`${at}: path_ref.distanceM ${t.distanceM} > ${LIMITS.snapM}`);
        } catch (e) { fail(`${at}: path_ref ${e.message}`); }
      }
      if (r.safety !== "excluded") stats.byCategory[r.category] = (stats.byCategory[r.category] || 0) + 1;
      let p = partitions.get(r.h3r5);
      if (!p) partitions.set(r.h3r5, (p = { pois: 0, ok: 0, review: 0, excluded: 0, hash: createHash("sha256") }));
      p.pois++;
      p[r.safety]++;
      p.hash.update(`${r.id}:${r.source_hash}\n`);
    }
    const dupIds = db.prepare("SELECT COUNT(*) n FROM (SELECT id FROM poi GROUP BY id HAVING COUNT(*)>1)").get().n;
    if (dupIds) fail(`${dupIds} ids appear in more than one h3r5 partition`);

    // 4. Partitions match the rows exactly.
    for (const row of db.prepare("SELECT * FROM partition").iterate()) {
      stats.partitions++;
      const p = partitions.get(row.h3r5);
      if (!p) { fail(`partition ${row.h3r5} has no poi rows`); continue; }
      const hash = p.hash.digest("hex");
      for (const k of ["pois", "ok", "review", "excluded"])
        if (row[k] !== p[k]) fail(`partition ${row.h3r5}.${k} ${row[k]} != ${p[k]}`);
      if (row.hash !== hash) fail(`partition ${row.h3r5} hash does not match its rows`);
      partitions.delete(row.h3r5);
    }
    for (const h3r5 of partitions.keys()) fail(`h3r5 ${h3r5} has poi rows but no partition row`);

    // 5. Path cells: every row cheap checks, a sample fully decoded.
    const total = db.prepare("SELECT COUNT(*) n FROM path_cell").get().n;
    const every = Math.max(1, Math.floor(total / Math.max(1, samplePaths)));
    let i = 0;
    for (const row of db.prepare("SELECT * FROM path_cell ORDER BY h3r7").iterate()) {
      stats.pathCells++;
      if (!isValidCell(row.h3r7) || getResolution(row.h3r7) !== 7) { fail(`path_cell ${row.h3r7}: not an H3 res-7 cell`); continue; }
      if (row.h3r5 !== cellToParent(row.h3r7, 5)) fail(`path_cell ${row.h3r7}: wrong h3r5`);
      if (!(row.ways >= 1 && row.ways <= LIMITS.cellPaths)) fail(`path_cell ${row.h3r7}: ways ${row.ways}`);
      if (!(row.points >= 2 && row.points <= LIMITS.cellPoints)) fail(`path_cell ${row.h3r7}: points ${row.points}`);
      if (i++ % every) continue;
      try {
        const paths = JSON.parse(inflateRawSync(row.paths).toString());
        if (!Array.isArray(paths) || paths.length !== row.ways) throw new Error("ways count differs");
        let points = 0;
        for (const line of paths) {
          if (!Array.isArray(line) || line.length < 2) throw new Error("a path has < 2 points");
          for (const pt of line)
            if (!Array.isArray(pt) || pt.length !== 2 || !(Math.abs(pt[0]) <= 180 && Math.abs(pt[1]) <= 90))
              throw new Error("points must be [lng, lat]");
          points += line.length;
        }
        if (points !== row.points) throw new Error("points count differs");
        // A run keeps one vertex either side of its cell, so check that each path touches the cell.
        for (const line of paths)
          if (!line.some(([lng, lat]) => latLngToCell(lat, lng, 7) === row.h3r7))
            throw new Error("a path has no point inside its cell");
      } catch (e) { fail(`path_cell ${row.h3r7}: ${e.message}`); }
    }

    // 6. Cities.
    for (const c of db.prepare("SELECT * FROM city").iterate()) {
      stats.cities++;
      if (!/^[A-Z]{2}$/.test(c.country || "")) fail(`city ${c.geonameid}: country must be ISO 3166-1 alpha-2`);
      if (!(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180)) fail(`city ${c.geonameid}: lat/lng`);
      else if (c.h3r5 !== cellToParent(latLngToCell(c.lat, c.lng, 7), 5)) fail(`city ${c.geonameid}: wrong h3r5`);
      if (!(c.population >= 0)) fail(`city ${c.geonameid}: population`);
    }
    if (!stats.cities) warnings.push("city table is empty (auto cities and coverage city checks will have nothing)");

    // 7. SQLite integrity.
    const check = db.prepare("PRAGMA quick_check").get();
    if (Object.values(check)[0] !== "ok") fail(`PRAGMA quick_check: ${Object.values(check)[0]}`);

    // 8. Manifest, when given.
    if (manifestPath) {
      const m = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (m.schema !== "questlayer.poi-manifest/1") fail(`manifest.schema ${m.schema}`);
      if (m.version !== meta.version) fail(`manifest.version ${m.version} != meta.version ${meta.version}`);
      const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (m.sha256 !== sha) fail("manifest.sha256 does not match the file");
      if (m.bytes !== statSync(path).size) fail("manifest.bytes does not match the file");
      if (m.counts?.pois !== stats.pois) fail(`manifest.counts.pois ${m.counts?.pois} != ${stats.pois}`);
      for (const k of ["ok", "review", "excluded"])
        if ((m.counts?.bySafety?.[k] || 0) !== stats.bySafety[k]) fail(`manifest.counts.bySafety.${k} differs`);
      if (!Array.isArray(m.inputs) || !m.inputs.length) fail("manifest.inputs must list every source with url, version, sha256, licence");
    }
    stats.meta = meta;
    const share = stats.pois ? stats.bySafety.excluded / stats.pois : 0;
    if (share > 0.5) warnings.push(`excluded share ${(share * 100).toFixed(1)} % is above 50 %`);
    return { ok: errors.length === 0, errors, warnings, stats };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const file = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.match(/^--(manifest|sample-paths|max-errors)$/));
  if (!file) {
    console.error("usage: npm run poi:validate -- <release.sqlite> [--manifest <file>] [--sample-paths N] [--max-errors N] [--json]");
    process.exit(2);
  }
  const result = validateRelease(file, {
    manifestPath: opt("manifest"),
    samplePaths: Number(opt("sample-paths", 2000)),
    maxErrors: Number(opt("max-errors", 50)),
  });
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    const s = result.stats;
    console.log(`${result.ok ? "ACCEPTED" : "REJECTED"} ${file}`);
    console.log(`version ${s.meta?.version ?? "?"}: ${s.pois} places (ok ${s.bySafety.ok}, review ${s.bySafety.review}, excluded ${s.bySafety.excluded}), ${s.partitions} partitions, ${s.pathCells} path cells, ${s.cities} cities`);
    for (const w of result.warnings) console.log(`warning: ${w}`);
    for (const e of result.errors) console.log(`error: ${e}`);
  }
  process.exit(result.ok ? 0 : 1);
}

// Builds poi-<version>.sqlite from the extracted inputs. Rows are clustered by
// H3 res-5 parent (WITHOUT ROWID primary key (h3r5, id)) so the server can read
// one region without scanning the rest. Output is deterministic for the same
// inputs: rows are inserted in sorted order and no wall-clock time is stored.
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  renameSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { latLngToCell, cellToParent } from "h3-js";
import { readJsonLines } from "./lib/ndjson.mjs";
import {
  ExclusionIndex,
  PathSnapper,
  CELL_LIMITS,
  applyWikidata,
  cellPieces,
  finalizeRecord,
  mergeOverture,
  normalizeOsmFeature,
  normalizeOvertureRow,
} from "./merge.mjs";

export const POI_SCHEMA = "questlayer.poi/1";
export const MANIFEST_SCHEMA = "questlayer.poi-manifest/1";

const SCHEMA_SQL = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE poi(
  h3r5 TEXT NOT NULL, id TEXT NOT NULL, h3r7 TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, category TEXT NOT NULL,
  name TEXT, names TEXT NOT NULL, wikidata TEXT, notability INTEGER NOT NULL,
  sources TEXT NOT NULL, safety TEXT NOT NULL CHECK (safety IN ('ok','review','excluded')),
  safety_reason TEXT, access TEXT, hours TEXT, path_ref TEXT, facts TEXT,
  source_hash TEXT NOT NULL,
  PRIMARY KEY (h3r5, id)) WITHOUT ROWID;
CREATE UNIQUE INDEX poi_id ON poi(id);
CREATE INDEX poi_cell ON poi(h3r7, safety, category);
CREATE TABLE partition(h3r5 TEXT PRIMARY KEY, pois INTEGER NOT NULL, ok INTEGER NOT NULL,
  review INTEGER NOT NULL, excluded INTEGER NOT NULL, hash TEXT NOT NULL) WITHOUT ROWID;
-- Offline street paths per H3 res-7 cell: deflate-raw JSON [[[lng,lat],...],...],
-- the shape server/spatial/map-data.mjs serves (<= 150 paths, <= 30000 points).
CREATE TABLE path_cell(h3r7 TEXT PRIMARY KEY, h3r5 TEXT NOT NULL, paths BLOB NOT NULL,
  ways INTEGER NOT NULL, points INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE city(geonameid INTEGER PRIMARY KEY, name TEXT NOT NULL, ascii_name TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, country TEXT NOT NULL, admin1 TEXT, population INTEGER NOT NULL,
  timezone TEXT, h3r5 TEXT NOT NULL);
`;

export function parseGeonamesLine(line) {
  const f = line.split("\t");
  if (f.length < 18 || !/^\d+$/.test(f[0])) return null;
  const lat = Number(f[4]),
    lng = Number(f[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    geonameid: Number(f[0]),
    name: f[1],
    ascii_name: f[2],
    lat,
    lng,
    country: f[8],
    admin1: f[10] || null,
    population: Number(f[14]) || 0,
    timezone: f[17] || null,
    h3r5: cellToParent(latLngToCell(lat, lng, 7), 5),
  };
}

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);

function count(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function sorted(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  );
}

// inputs: { osmPois, osmPaths, osmExclusions, overture: [{path, country}],
//   wikidata, geonames: [{path, countries}], closures: [ids] }
export async function buildPoiDatabase({
  inputs,
  outPath,
  version,
  regions,
  w4,
  log = () => {},
}) {
  const tmp = `${outPath}.tmp`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA page_size=4096;");
  db.exec(SCHEMA_SQL);
  // Way pieces are staged on disk so memory stays bounded by the place count.
  db.exec(`CREATE TABLE path_piece(h3r7 TEXT NOT NULL, priority INTEGER NOT NULL, way TEXT NOT NULL,
    run INTEGER NOT NULL, points TEXT NOT NULL)`);
  const stagePiece = db.prepare("INSERT INTO path_piece VALUES(?,?,?,?,?)");

  // 1. OSM places, keyed by id (an element can appear once per export).
  const osm = new Map();
  for (const path of list(inputs.osmPois))
    for await (const feature of readJsonLines(path)) {
      const record = normalizeOsmFeature(feature, w4);
      if (record && !osm.has(record.id)) osm.set(record.id, record);
    }
  log(`osm places: ${osm.size}`);

  // 2. Overture candidates for each region.
  const overture = new Map();
  for (const { path, country } of inputs.overture || [])
    for await (const row of readJsonLines(path)) {
      const record = normalizeOvertureRow(row, w4, { country });
      if (record && !overture.has(record.id)) overture.set(record.id, record);
    }
  log(`overture candidates: ${overture.size}`);

  // 3. Snap every candidate to public paths (streamed).
  const snapper = new PathSnapper([...osm.values(), ...overture.values()]);
  let pathFeatures = 0;
  for (const path of list(inputs.osmPaths))
    for await (const feature of readJsonLines(path)) {
      snapper.considerFeature(feature);
      if (++pathFeatures % 50000 === 1) db.exec(pathFeatures === 1 ? "BEGIN" : "COMMIT; BEGIN");
      for (const piece of cellPieces(feature))
        stagePiece.run(piece.h3r7, piece.priority, piece.wayId, piece.run, JSON.stringify(piece.points));
    }
  if (pathFeatures) db.exec("COMMIT");
  log(`path features: ${pathFeatures}, snapped: ${snapper.best.size}`);

  // 4. Exclusion areas.
  const exclusions = new ExclusionIndex();
  for (const path of list(inputs.osmExclusions))
    for await (const feature of readJsonLines(path))
      exclusions.addFeature(feature);
  log(`exclusion areas: ${exclusions.count}`);

  // 5. Merge, enrich, assess.
  const osmSorted = [...osm.values()].sort((a, b) => a.id.localeCompare(b.id));
  const ovtSorted = [...overture.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const merged = mergeOverture(osmSorted, ovtSorted, snapper);
  const wikidata = new Map();
  for (const path of list(inputs.wikidata))
    for await (const item of readJsonLines(path))
      if (item && /^Q\d+$/.test(item.id)) wikidata.set(item.id, item);
  const enriched = applyWikidata(merged.records, wikidata);
  const closures = new Set(inputs.closures || []);
  const rows = merged.records
    .map((record) =>
      finalizeRecord(record, { snapper, exclusions, closures, w4 }),
    )
    .sort((a, b) => a.h3r5.localeCompare(b.h3r5) || a.id.localeCompare(b.id));

  // 6. Cities (GeoNames) for the regions' countries.
  const cities = [];
  for (const { path, countries } of inputs.geonames || []) {
    if (!path || !existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const city = parseGeonamesLine(line);
      if (city && countries.includes(city.country)) cities.push(city);
    }
  }
  cities.sort((a, b) => a.geonameid - b.geonameid);

  // 7. Write.
  const insert =
    db.prepare(`INSERT INTO poi(h3r5,id,h3r7,lat,lng,category,name,names,wikidata,notability,
    sources,safety,safety_reason,access,hours,path_ref,facts,source_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const byCategory = {},
    bySafety = {},
    byReason = {},
    partitions = new Map();
  db.exec("BEGIN");
  for (const r of rows) {
    insert.run(
      r.h3r5,
      r.id,
      r.h3r7,
      r.lat,
      r.lng,
      r.category,
      r.name,
      r.names,
      r.wikidata,
      r.notability,
      r.sources,
      r.safety,
      r.safety_reason,
      r.access,
      r.hours,
      r.path_ref,
      r.facts,
      r.source_hash,
    );
    count(bySafety, r.safety);
    if (r.safety !== "excluded") count(byCategory, r.category);
    if (r.safety_reason) count(byReason, r.safety_reason);
    let p = partitions.get(r.h3r5);
    if (!p)
      partitions.set(
        r.h3r5,
        (p = {
          pois: 0,
          ok: 0,
          review: 0,
          excluded: 0,
          hash: createHash("sha256"),
        }),
      );
    p.pois++;
    p[r.safety]++;
    p.hash.update(`${r.id}:${r.source_hash}\n`);
  }
  const insertPartition = db.prepare(
    "INSERT INTO partition VALUES(?,?,?,?,?,?)",
  );
  for (const [h3r5, p] of [...partitions].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    insertPartition.run(
      h3r5,
      p.pois,
      p.ok,
      p.review,
      p.excluded,
      p.hash.digest("hex"),
    );
  const paths = packPathCells(db);
  log(`path cells: ${paths.cells}`);
  const insertCity = db.prepare("INSERT INTO city VALUES(?,?,?,?,?,?,?,?,?,?)");
  for (const c of cities)
    insertCity.run(
      c.geonameid,
      c.name,
      c.ascii_name,
      c.lat,
      c.lng,
      c.country,
      c.admin1,
      c.population,
      c.timezone,
      c.h3r5,
    );
  const meta = {
    schema: POI_SCHEMA,
    version,
    regions: regions.join(","),
    taxonomyVersion: w4.taxonomyVersion,
    safetyVersion: w4.safetyVersion,
    w4Source: w4.source,
    attribution: ATTRIBUTION_LINE,
  };
  const insertMeta = db.prepare("INSERT INTO meta VALUES(?,?)");
  for (const [k, v] of Object.entries(meta).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    insertMeta.run(k, String(v));
  db.exec("COMMIT");
  db.exec("VACUUM");
  db.close();
  renameSync(tmp, outPath);

  const bytes = statSync(outPath).size;
  const fileSha = createHash("sha256")
    .update(readFileSync(outPath))
    .digest("hex");
  return {
    schema: MANIFEST_SCHEMA,
    version,
    regions,
    file: outPath.split("/").pop(),
    bytes,
    sha256: fileSha,
    taxonomyVersion: w4.taxonomyVersion,
    safetyVersion: w4.safetyVersion,
    w4Source: w4.source,
    counts: {
      pois: rows.length,
      osmPlaces: osm.size,
      overtureCandidates: overture.size,
      overtureFolded: merged.folded,
      overtureAdded: merged.added,
      overtureDroppedNoPath: merged.droppedNoPath,
      wikidataEnriched: enriched,
      exclusionAreas: exclusions.count,
      partitions: partitions.size,
      cities: cities.length,
      pathCells: paths.cells,
      pathWays: paths.ways,
      pathPoints: paths.points,
      bySafety: sorted(bySafety),
      byCategory: sorted(byCategory),
      byReason: sorted(byReason),
    },
  };
}

// Packs staged pieces into one row per cell, deterministic order: priority,
// then way id, then run.
function packPathCells(db) {
  db.exec("CREATE INDEX path_piece_order ON path_piece(h3r7, priority, way, run)");
  const insert = db.prepare("INSERT INTO path_cell VALUES(?,?,?,?,?)");
  const totals = { cells: 0, ways: 0, points: 0 };
  let cell = null,
    paths = [],
    points = 0,
    last = null;
  const flush = () => {
    if (!cell || !paths.length) return;
    insert.run(cell, cellToParent(cell, 5), deflateRawSync(JSON.stringify(paths), { level: 9 }), paths.length, points);
    totals.cells++;
    totals.ways += paths.length;
    totals.points += points;
  };
  for (const piece of db.prepare("SELECT h3r7, way, run, points FROM path_piece ORDER BY h3r7, priority, way, run").iterate()) {
    if (piece.h3r7 !== cell) {
      flush();
      cell = piece.h3r7;
      paths = [];
      points = 0;
    }
    // Neighbouring region extracts overlap at borders: keep a way's run once.
    const key = `${piece.way}:${piece.run}`;
    if (key === last) continue;
    last = key;
    if (paths.length >= CELL_LIMITS.paths) continue;
    const line = JSON.parse(piece.points);
    if (points + line.length > CELL_LIMITS.points) continue;
    paths.push(line);
    points += line.length;
  }
  flush();
  db.exec("DROP TABLE path_piece");
  return totals;
}

export const ATTRIBUTION_LINE =
  "Places: © OpenStreetMap contributors (ODbL), Overture Maps Foundation (CDLA-Permissive-2.0), Wikidata (CC0), GeoNames (CC BY 4.0)";

export function attributionMarkdown(manifest, inputs = []) {
  const lines = [
    `# Attribution for ${manifest.file}`,
    "",
    "This database is derived from the sources below. It is a derivative database of",
    "OpenStreetMap and is made available under the Open Database License (ODbL 1.0),",
    "https://opendatacommons.org/licenses/odbl/1-0/. Game content produced from it is a",
    "Produced Work and carries the attribution line shown in the app.",
    "",
    "- OpenStreetMap: © OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright",
    "- Overture Maps Places: © Overture Maps Foundation, CDLA-Permissive-2.0, https://docs.overturemaps.org/attribution/",
    "- Wikidata: CC0 1.0, https://www.wikidata.org/wiki/Wikidata:Licensing",
    "- GeoNames: CC BY 4.0, https://www.geonames.org/ (cities15000)",
    "",
    "## Inputs",
    "",
    ...inputs.map(
      (i) =>
        `- ${i.source}: ${i.url || i.release || ""} ${i.version ? `(version ${i.version})` : ""} sha256 ${i.sha256 || "n/a"}`,
    ),
    "",
  ];
  return lines.join("\n");
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Builds the database in parts and merges them (demo cities, 13 Nov 2026):
 * one build over Czechia plus 300 city clips held every place in memory at
 * once and passed the worker's 3 GB limit. parts: [{ inputs, regions }], each
 * spatially separate (a country, or a chunk of far-apart city clips). The
 * merge is plain SQLite (ATTACH + INSERT), so memory stays at one part.
 */
export async function buildPoiDatabaseInParts({ parts, outPath, version, regions, w4, log = () => {} }) {
  if (parts.length === 1)
    return buildPoiDatabase({ inputs: parts[0].inputs, outPath, version, regions, w4, log });
  const files = [],
    manifests = [];
  try {
    for (const [i, part] of parts.entries()) {
      const partPath = `${outPath}.part${i}`;
      log(`building part ${i + 1}/${parts.length} (${part.regions.length} regions)`);
      manifests.push(
        await buildPoiDatabase({ inputs: part.inputs, outPath: partPath, version, regions: part.regions, w4, log }),
      );
      files.push(partPath);
    }
    const tmp = `${outPath}.tmp`;
    rmSync(tmp, { force: true });
    const db = new DatabaseSync(tmp);
    db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA page_size=4096;");
    db.exec(SCHEMA_SQL);
    for (const f of files) {
      db.prepare("ATTACH DATABASE ? AS part").run(f);
      db.exec(`BEGIN;
        INSERT OR IGNORE INTO poi SELECT * FROM part.poi;
        INSERT INTO partition SELECT * FROM part.partition WHERE true
          ON CONFLICT(h3r5) DO UPDATE SET pois=pois+excluded.pois, ok=ok+excluded.ok,
            review=review+excluded.review, excluded=partition.excluded+excluded.excluded,
            hash=partition.hash||excluded.hash;
        INSERT OR IGNORE INTO path_cell SELECT * FROM part.path_cell;
        INSERT OR IGNORE INTO city SELECT * FROM part.city;
        COMMIT;`);
      db.exec("DETACH DATABASE part");
    }
    const meta = {
      schema: POI_SCHEMA,
      version,
      regions: regions.join(","),
      taxonomyVersion: w4.taxonomyVersion,
      safetyVersion: w4.safetyVersion,
      w4Source: w4.source,
      attribution: ATTRIBUTION_LINE,
    };
    const insertMeta = db.prepare("INSERT INTO meta VALUES(?,?)");
    for (const [k, v] of Object.entries(meta).sort(([a], [b]) => a.localeCompare(b)))
      insertMeta.run(k, String(v));
    db.exec("VACUUM");
    db.close();
    renameSync(tmp, outPath);
  } finally {
    for (const f of files) rmSync(f, { force: true });
  }
  const sum = (key) => manifests.reduce((n, m) => n + (m.counts[key] || 0), 0);
  const addMaps = (key) => {
    const out = {};
    for (const m of manifests)
      for (const [k, v] of Object.entries(m.counts[key] || {})) out[k] = (out[k] || 0) + v;
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  };
  return {
    schema: MANIFEST_SCHEMA,
    version,
    regions,
    file: outPath.split("/").pop(),
    bytes: statSync(outPath).size,
    sha256: createHash("sha256").update(readFileSync(outPath)).digest("hex"),
    taxonomyVersion: w4.taxonomyVersion,
    safetyVersion: w4.safetyVersion,
    w4Source: w4.source,
    parts: parts.length,
    counts: {
      ...Object.fromEntries(
        ["pois", "osmPlaces", "overtureCandidates", "overtureFolded", "overtureAdded", "overtureDroppedNoPath",
          "wikidataEnriched", "exclusionAreas", "partitions", "cities", "pathCells", "pathWays", "pathPoints"].map((k) => [k, sum(k)]),
      ),
      bySafety: addMaps("bySafety"),
      byCategory: addMaps("byCategory"),
      byReason: addMaps("byReason"),
    },
  };
}

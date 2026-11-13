// Builds poi-<version>.sqlite from the extracted inputs. Rows are clustered by
// H3 res-5 parent (WITHOUT ROWID primary key (h3r5, id)) so the server can read
// one region without scanning the rest. Output is deterministic for the same
// inputs: rows are inserted in sorted order and no wall-clock time is stored.
import { DatabaseSync } from "node:sqlite";
import {
  createReadStream,
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
  exclusionZone,
  publicPathLines,
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

// Tiles (docs/POI-PIPELINE.md "Tiled build", 13 Nov 2026): every input is
// staged into a scratch SQLite file first, then places are processed one
// lat/lng tile at a time. Only one tile's places, paths and exclusion areas
// are in memory at once, so peak memory no longer grows with the country.
// Paths and exclusion areas are staged for every tile they reach plus a
// margin, so the snap (40 m) and the exclusion test see exactly what a
// whole-country build sees. Overture folds into an OSM place up to 100 m away,
// so a tile also reads its neighbours' places within that margin.
export const TILE_DEG = 0.25;
const SNAP_MARGIN_M = 60; // > SNAP_RADIUS_M (40 m)
const MERGE_MARGIN_M = 150; // > Overture match radius (100 m)

// Integer tile key, exact for any tile edge down to 0.0001 degree.
const OFF = 2 ** 24,
  ROW = 2 ** 25;
const tileKey = (ty, tx) => (ty + OFF) * ROW + (tx + OFF);
function tileOf(lat, lng, deg) {
  return tileKey(Math.floor(lat / deg), Math.floor(lng / deg));
}
function tileBounds(key, deg) {
  const ty = Math.floor(key / ROW) - OFF,
    tx = (key % ROW) - OFF;
  return { minLat: ty * deg, minLng: tx * deg, maxLat: (ty + 1) * deg, maxLng: (tx + 1) * deg };
}
function grow(box, marginM) {
  const dLat = marginM / 111_000;
  const maxAbs = Math.min(89, Math.max(Math.abs(box.minLat), Math.abs(box.maxLat)) + dLat);
  const dLng = marginM / (111_000 * Math.max(0.1, Math.cos((maxAbs * Math.PI) / 180)));
  return { minLat: box.minLat - dLat, minLng: box.minLng - dLng, maxLat: box.maxLat + dLat, maxLng: box.maxLng + dLng };
}
function tilesOfBox(box, deg) {
  const out = [];
  for (let y = Math.floor(box.minLat / deg); y <= Math.floor(box.maxLat / deg); y++)
    for (let x = Math.floor(box.minLng / deg); x <= Math.floor(box.maxLng / deg); x++) out.push(tileKey(y, x));
  return out;
}
function lineBox(line) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const [lng, lat] of line) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, minLng, maxLat, maxLng };
}
// Path coordinates are staged as raw float64 so a tile snaps to the very same
// numbers a whole-country build would.
const packLine = (line) => Buffer.from(new Float64Array(line.flat()).buffer);
function unpackLine(blob) {
  const f = new Float64Array(blob.buffer, blob.byteOffset, blob.byteLength / 8);
  const line = new Array(f.length / 2);
  for (let i = 0; i < line.length; i++) line[i] = [f[2 * i], f[2 * i + 1]];
  return line;
}

async function sha256Of(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const STAGE_SQL = `
CREATE TABLE osm_rec(id TEXT PRIMARY KEY, tile INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, rec TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE ovt_rec(id TEXT PRIMARY KEY, tile INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, rec TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE line(seq INTEGER PRIMARY KEY, way TEXT, coords BLOB NOT NULL);
CREATE TABLE line_tile(tile INTEGER NOT NULL, seq INTEGER NOT NULL);
CREATE TABLE zone(seq INTEGER PRIMARY KEY, zone TEXT NOT NULL);
CREATE TABLE zone_tile(tile INTEGER NOT NULL, seq INTEGER NOT NULL);
CREATE TABLE wd(id TEXT PRIMARY KEY, item TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE snap(id TEXT PRIMARY KEY, tile INTEGER NOT NULL, best TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE fold(osm_id TEXT NOT NULL, ovt_id TEXT NOT NULL, sources TEXT NOT NULL, name TEXT);
CREATE TABLE added(id TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE path_piece(h3r7 TEXT NOT NULL, priority INTEGER NOT NULL, way TEXT NOT NULL,
  run INTEGER NOT NULL, points TEXT NOT NULL);
`;

// Commits every `every` rows so the journal-less scratch file stays fast.
function batcher(db, every = 50000) {
  let n = 0;
  return {
    tick() {
      if (n++ % every === 0) db.exec(n === 1 ? "BEGIN" : "COMMIT; BEGIN");
    },
    done() {
      if (n) db.exec("COMMIT");
      n = 0;
    },
  };
}

// inputs: { osmPois, osmPaths, osmExclusions, overture: [{path, country}],
//   wikidata, geonames: [{path, countries}], closures: [ids] }
// tileDeg: tile edge in degrees (POI_TILE_DEG, default 0.25).
export async function buildPoiDatabase({
  inputs,
  outPath,
  version,
  regions,
  w4,
  log = () => {},
  tileDeg = Number(process.env.POI_TILE_DEG) || TILE_DEG,
}) {
  if (!(tileDeg >= 0.0001 && tileDeg <= 90)) throw new Error(`Bad POI tile size ${tileDeg}.`);
  const tmp = `${outPath}.tmp`,
    stagePath = `${outPath}.stage`;
  rmSync(tmp, { force: true });
  rmSync(stagePath, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA page_size=4096;");
  db.exec(SCHEMA_SQL);
  const st = new DatabaseSync(stagePath);
  st.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-65536;");
  st.exec(STAGE_SQL);
  try {
    return await buildTiled({ db, st, inputs, outPath, tmp, version, regions, w4, log, tileDeg });
  } finally {
    try {
      st.close();
    } catch {}
    rmSync(stagePath, { force: true });
  }
}

async function buildTiled({ db, st, inputs, outPath, tmp, version, regions, w4, log, tileDeg }) {
  const batch = batcher(st);

  // 1. OSM places, keyed by id (an element can appear once per export: the
  //    first one wins, as before).
  const putOsm = st.prepare("INSERT OR IGNORE INTO osm_rec VALUES(?,?,?,?,?)");
  for (const path of list(inputs.osmPois))
    for await (const feature of readJsonLines(path)) {
      const r = normalizeOsmFeature(feature, w4);
      if (!r) continue;
      batch.tick();
      putOsm.run(r.id, tileOf(r.lat, r.lng, tileDeg), r.lat, r.lng, JSON.stringify(r));
    }
  batch.done();
  const osmPlaces = st.prepare("SELECT count(*) AS n FROM osm_rec").get().n;
  log(`osm places: ${osmPlaces}`);

  // 2. Overture candidates for each region.
  const putOvt = st.prepare("INSERT OR IGNORE INTO ovt_rec VALUES(?,?,?,?,?)");
  for (const { path, country } of inputs.overture || [])
    for await (const row of readJsonLines(path)) {
      const r = normalizeOvertureRow(row, w4, { country });
      if (!r) continue;
      batch.tick();
      putOvt.run(r.id, tileOf(r.lat, r.lng, tileDeg), r.lat, r.lng, JSON.stringify(r));
    }
  batch.done();
  const overtureCandidates = st.prepare("SELECT count(*) AS n FROM ovt_rec").get().n;
  log(`overture candidates: ${overtureCandidates}`);

  // 3. Paths (streamed once): public lines for snapping, pieces for path cells.
  const putLine = st.prepare("INSERT INTO line VALUES(?,?,?)");
  const putLineTile = st.prepare("INSERT INTO line_tile VALUES(?,?)");
  const stagePiece = st.prepare("INSERT INTO path_piece VALUES(?,?,?,?,?)");
  let pathFeatures = 0,
    lineSeq = 0;
  for (const path of list(inputs.osmPaths))
    for await (const feature of readJsonLines(path)) {
      pathFeatures++;
      batch.tick();
      const pub = publicPathLines(feature);
      if (pub)
        for (const line of pub.lines) {
          const seq = ++lineSeq;
          putLine.run(seq, pub.wayId, packLine(line));
          if (line.length < 2) continue;
          for (const tile of tilesOfBox(grow(lineBox(line), SNAP_MARGIN_M), tileDeg)) putLineTile.run(tile, seq);
        }
      for (const piece of cellPieces(feature))
        stagePiece.run(piece.h3r7, piece.priority, piece.wayId, piece.run, JSON.stringify(piece.points));
    }
  batch.done();
  log(`path features: ${pathFeatures}`);

  // 4. Exclusion areas.
  const putZone = st.prepare("INSERT INTO zone VALUES(?,?)");
  const putZoneTile = st.prepare("INSERT INTO zone_tile VALUES(?,?)");
  let exclusionAreas = 0;
  for (const path of list(inputs.osmExclusions))
    for await (const feature of readJsonLines(path)) {
      const zone = exclusionZone(feature);
      if (!zone) continue;
      batch.tick();
      const seq = ++exclusionAreas;
      putZone.run(seq, JSON.stringify(zone));
      for (const tile of tilesOfBox(grow(zone.box, SNAP_MARGIN_M), tileDeg)) putZoneTile.run(tile, seq);
    }
  batch.done();
  log(`exclusion areas: ${exclusionAreas}`);

  // 5. Wikidata (the last item for an id wins, as before).
  const putWd = st.prepare("INSERT OR REPLACE INTO wd VALUES(?,?)");
  for (const path of list(inputs.wikidata))
    for await (const item of readJsonLines(path))
      if (item && /^Q\d+$/.test(item.id)) {
        batch.tick();
        putWd.run(item.id, JSON.stringify(item));
      }
  batch.done();
  st.exec(`CREATE INDEX osm_tile ON osm_rec(tile, id);
    CREATE INDEX ovt_tile ON ovt_rec(tile, id);
    CREATE INDEX line_tile_i ON line_tile(tile, seq);
    CREATE INDEX zone_tile_i ON zone_tile(tile, seq);`);

  const tiles = st
    .prepare("SELECT tile FROM osm_rec UNION SELECT tile FROM ovt_rec ORDER BY tile")
    .all()
    .map((r) => r.tile);
  log(`tiles: ${tiles.length} of ${tileDeg} deg`);
  const parse = (row) => JSON.parse(row.rec);
  const osmOfTile = st.prepare("SELECT rec FROM osm_rec WHERE tile = ? ORDER BY id");
  const ovtOfTile = st.prepare("SELECT rec FROM ovt_rec WHERE tile = ? ORDER BY id");
  const osmNear = st.prepare(
    "SELECT rec FROM osm_rec WHERE tile = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
  );
  const linesOfTile = st.prepare(
    "SELECT l.way, l.coords FROM line_tile t JOIN line l ON l.seq = t.seq WHERE t.tile = ? ORDER BY t.seq",
  );
  const putSnap = st.prepare("INSERT INTO snap VALUES(?,?,?)");
  const putFold = st.prepare("INSERT INTO fold VALUES(?,?,?,?)");
  const putAdded = st.prepare("INSERT INTO added VALUES(?)");

  // 6. Pass 1 per tile: snap to public paths, fold Overture into OSM places.
  let snapped = 0,
    folded = 0,
    added = 0,
    droppedNoPath = 0;
  for (const tile of tiles) {
    const own = osmOfTile.all(tile).map(parse);
    const ovt = ovtOfTile.all(tile).map(parse);
    const snapper = new PathSnapper([...own, ...ovt]);
    for (const row of linesOfTile.iterate(tile)) snapper.considerLine(unpackLine(row.coords), row.way);
    const area = grow(tileBounds(tile, tileDeg), MERGE_MARGIN_M);
    const near = [];
    for (const other of tilesOfBox(area, tileDeg))
      if (other !== tile)
        for (const row of osmNear.iterate(other, area.minLat, area.maxLat, area.minLng, area.maxLng))
          near.push(parse(row));
    st.exec("BEGIN");
    for (const [id, best] of snapper.best) putSnap.run(id, tile, JSON.stringify(best));
    snapped += snapper.best.size;
    const merged = mergeOverture([...own, ...near], ovt, snapper, (osm, o) =>
      putFold.run(osm.id, o.id, JSON.stringify(o.sources), o.name),
    );
    for (const o of merged.records.slice(own.length + near.length)) putAdded.run(o.id);
    st.exec("COMMIT");
    folded += merged.folded;
    added += merged.added;
    droppedNoPath += merged.droppedNoPath;
  }
  log(`snapped: ${snapped}, overture folded ${folded}, added ${added}, no path ${droppedNoPath}`);
  st.exec("CREATE INDEX fold_osm ON fold(osm_id, ovt_id)");

  // 7. Pass 2 per tile: apply folds, enrich, assess, write.
  const foldsOfTile = st.prepare(
    "SELECT f.osm_id, f.sources, f.name FROM fold f JOIN osm_rec o ON o.id = f.osm_id WHERE o.tile = ? ORDER BY f.osm_id, f.ovt_id",
  );
  const addedOfTile = st.prepare(
    "SELECT o.rec FROM ovt_rec o JOIN added a ON a.id = o.id WHERE o.tile = ? ORDER BY o.id",
  );
  const snapsOfTile = st.prepare("SELECT id, best FROM snap WHERE tile = ?");
  const zonesOfTile = st.prepare(
    "SELECT z.zone FROM zone_tile t JOIN zone z ON z.seq = t.seq WHERE t.tile = ? ORDER BY t.seq",
  );
  const wdGet = st.prepare("SELECT item FROM wd WHERE id = ?");
  const wikidata = {
    get(id) {
      const row = wdGet.get(id);
      return row ? JSON.parse(row.item) : undefined;
    },
  };
  const closures = new Set(inputs.closures || []);
  const insert =
    db.prepare(`INSERT INTO poi(h3r5,id,h3r7,lat,lng,category,name,names,wikidata,notability,
    sources,safety,safety_reason,access,hours,path_ref,facts,source_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const byCategory = {},
    bySafety = {},
    byReason = {};
  let pois = 0,
    enriched = 0;
  for (const tile of tiles) {
    const own = osmOfTile.all(tile).map(parse);
    const byId = new Map(own.map((r) => [r.id, r]));
    for (const f of foldsOfTile.iterate(tile)) {
      const r = byId.get(f.osm_id);
      r.sources.push(...JSON.parse(f.sources));
      if (!r.name) r.name = f.name;
    }
    const records = [...own, ...addedOfTile.all(tile).map(parse)];
    enriched += applyWikidata(records, wikidata);
    const best = new Map(snapsOfTile.all(tile).map((r) => [r.id, JSON.parse(r.best)]));
    const snapper = { nearest: (id) => best.get(id) || null };
    const exclusions = new ExclusionIndex();
    for (const row of zonesOfTile.iterate(tile)) exclusions.addZone(JSON.parse(row.zone));
    const rows = records
      .map((record) => finalizeRecord(record, { snapper, exclusions, closures, w4 }))
      .sort((a, b) => a.h3r5.localeCompare(b.h3r5) || a.id.localeCompare(b.id));
    db.exec("BEGIN");
    for (const r of rows) {
      insert.run(
        r.h3r5, r.id, r.h3r7, r.lat, r.lng, r.category, r.name, r.names, r.wikidata, r.notability,
        r.sources, r.safety, r.safety_reason, r.access, r.hours, r.path_ref, r.facts, r.source_hash,
      );
      count(bySafety, r.safety);
      if (r.safety !== "excluded") count(byCategory, r.category);
      if (r.safety_reason) count(byReason, r.safety_reason);
    }
    db.exec("COMMIT");
    pois += rows.length;
  }

  // 8. Partitions, streamed in (h3r5, id) order across tiles.
  const insertPartition = db.prepare("INSERT INTO partition VALUES(?,?,?,?,?,?)");
  let partitions = 0,
    p = null;
  const flushPartition = () => {
    if (!p) return;
    insertPartition.run(p.h3r5, p.pois, p.ok, p.review, p.excluded, p.hash.digest("hex"));
    partitions++;
  };
  db.exec("BEGIN");
  for (const r of db.prepare("SELECT h3r5, id, safety, source_hash FROM poi ORDER BY h3r5, id").iterate()) {
    if (r.h3r5 !== p?.h3r5) {
      flushPartition();
      p = { h3r5: r.h3r5, pois: 0, ok: 0, review: 0, excluded: 0, hash: createHash("sha256") };
    }
    p.pois++;
    p[r.safety]++;
    p.hash.update(`${r.id}:${r.source_hash}\n`);
  }
  flushPartition();
  db.exec("COMMIT");

  // 9. Cities (GeoNames) for the regions' countries.
  const cities = [];
  for (const { path, countries } of inputs.geonames || []) {
    if (!path || !existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const city = parseGeonamesLine(line);
      if (city && countries.includes(city.country)) cities.push(city);
    }
  }
  cities.sort((a, b) => a.geonameid - b.geonameid);

  db.exec("BEGIN");
  const paths = packPathCells(st, db);
  log(`path cells: ${paths.cells}`);
  const insertCity = db.prepare("INSERT INTO city VALUES(?,?,?,?,?,?,?,?,?,?)");
  for (const c of cities)
    insertCity.run(c.geonameid, c.name, c.ascii_name, c.lat, c.lng, c.country, c.admin1, c.population, c.timezone, c.h3r5);
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
  for (const [k, v] of Object.entries(meta).sort(([a], [b]) => a.localeCompare(b))) insertMeta.run(k, String(v));
  db.exec("COMMIT");
  st.close();
  db.exec("VACUUM");
  db.close();
  renameSync(tmp, outPath);

  return {
    schema: MANIFEST_SCHEMA,
    version,
    regions,
    file: outPath.split("/").pop(),
    bytes: statSync(outPath).size,
    sha256: await sha256Of(outPath),
    taxonomyVersion: w4.taxonomyVersion,
    safetyVersion: w4.safetyVersion,
    w4Source: w4.source,
    counts: {
      pois,
      osmPlaces,
      overtureCandidates,
      overtureFolded: folded,
      overtureAdded: added,
      overtureDroppedNoPath: droppedNoPath,
      wikidataEnriched: enriched,
      exclusionAreas,
      partitions,
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
function packPathCells(st, db) {
  st.exec("CREATE INDEX path_piece_order ON path_piece(h3r7, priority, way, run)");
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
  for (const piece of st.prepare("SELECT h3r7, way, run, points FROM path_piece ORDER BY h3r7, priority, way, run").iterate()) {
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
    sha256: await sha256Of(outPath),
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

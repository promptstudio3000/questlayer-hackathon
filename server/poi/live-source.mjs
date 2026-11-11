// Live POI source for cells outside the imported regions (docs/POI-PIPELINE.md,
// "Outside the import").
//
// The weekly POI import (scripts/poi/run.mjs) covers Czechia. Everywhere else
// a street cell asks OpenStreetMap (Overpass) once for its places, public
// paths and grounds, runs them through the same taxonomy and safety filter as
// the import (classifyPois), and keeps the safe places with a path target in
// geo_cache under `poi:<cell>` for a week. POI quests then read them exactly
// like rows of the imported file. A failed request is retried after a backoff;
// until then the cell simply has no POI quests yet (street coins still work).
//
// POI_LIVE=off disables it. POI_LIVE_URL overrides the Overpass endpoint.
import { cellToBoundary, getResolution, isValidCell } from "h3-js";
import { classifyPois, osmToInputs } from "./index.mjs";
import { MAP_USER_AGENT, boundedJson } from "../spatial/map-data.mjs";

export const LIVE_POI_TTL_MS = 7 * 86_400_000;
export const LIVE_POI_RETRY_MS = 10 * 60_000;
export const LIVE_POI_MAX_ROWS = 400;
export const LIVE_POI_MAX_CONCURRENT = 2;
// A dense city centre with its street geometry runs to a few megabytes.
export const LIVE_POI_MAX_BYTES = 16 * 1024 * 1024;
const PAD_DEG = 0.004; // ~400 m: paths and grounds just outside the cell count
const DEFAULT_URL = "https://overpass-api.de/api/interpreter";

/** Overpass query for one H3 res-7 cell: places, public paths and grounds. */
export function livePoiQuery(cell) {
  const b = cellToBoundary(cell),
    lats = b.map((p) => p[0]),
    lngs = b.map((p) => p[1]);
  const box = `(${(Math.min(...lats) - PAD_DEG).toFixed(5)},${(Math.min(...lngs) - PAD_DEG).toFixed(5)},${(Math.max(...lats) + PAD_DEG).toFixed(5)},${(Math.max(...lngs) + PAD_DEG).toFixed(5)})`;
  const parts = [
    `nwr[tourism]${box}`,
    `nwr[historic]${box}`,
    `nwr[heritage]${box}`,
    `nwr[leisure]${box}`,
    `nwr[artwork_type]${box}`,
    `nwr[man_made~"^(tower|lighthouse|water_tower|windmill|watermill|obelisk|cross|bridge|observatory|pier)$"]${box}`,
    `nwr[amenity~"^(fountain|place_of_worship|library|theatre|arts_centre|townhall|marketplace|clock|planetarium|community_centre|public_bookcase|school|kindergarten|childcare|hospital|clinic|prison|university|college|social_facility|nursing_home|grave_yard|police)$"]${box}`,
    `nwr[natural~"^(peak|spring|cave_entrance|rock|stone|tree|water|beach|cliff|waterfall|saddle)$"]${box}`,
    `nwr[waterway=waterfall]${box}`,
    `nwr[place=square]${box}`,
    `nwr[landuse~"^(military|construction|quarry|railway|industrial)$"]${box}`,
    `nwr[military]${box}`,
    `nwr[aeroway]${box}`,
    `nwr[healthcare]${box}`,
    `way[highway~"^(footway|pedestrian|path|living_street|steps|residential|track|cycleway|service|unclassified|tertiary|bridleway)$"]${box}`,
  ];
  return `[out:json][timeout:25];(${parts.join(";")};);out tags geom;`;
}

/** Safe places of `cell` with a path target, in the row shape of the POI file. */
export function liveRowsFromElements(elements, cell) {
  const { records } = classifyPois(osmToInputs(elements));
  return records
    .filter((r) => r.safety === "ok" && r.target && r.h3r7 === cell && r.category)
    .slice(0, LIVE_POI_MAX_ROWS)
    .map((r) => ({
      id: r.id,
      category: r.category,
      name: r.name ? String(r.name).replace(/\s+/g, " ").trim().slice(0, 80) : null,
      notability: r.wikidata ? 1 : 0,
      lat: r.target.lat,
      lng: r.target.lng,
      wikidata: /^Q\d+$/.test(r.wikidata || "") ? r.wikidata : null,
      facts: null,
    }));
}

const key = (cell) => `poi:${cell}`;
const validCell = (cell) => typeof cell === "string" && isValidCell(cell) && getResolution(cell) === 7;

/**
 * live = liveOverpassPoiSource(db, { covers, fetcher, clock })
 *   covers(cell): true for cells this source answers (outside the import);
 *   prepare(cell, { waitMs }): fetches a missing cell, waiting up to waitMs;
 *   cellPois(cell): cached rows, or null while unknown (retry later).
 */
export function liveOverpassPoiSource(
  db,
  {
    covers = () => true,
    fetcher = globalThis.fetch,
    clock = Date.now,
    url = process.env.POI_LIVE_URL || DEFAULT_URL,
    timeoutMs = 30_000,
  } = {},
) {
  const pending = new Map();
  const read = (cell) => {
    try {
      const row = db.prepare("SELECT data FROM geo_cache WHERE region=?").get(key(cell));
      return row ? JSON.parse(row.data) : null;
    } catch {
      return null;
    }
  };
  const write = (cell, entry) => {
    try {
      db.prepare("INSERT OR REPLACE INTO geo_cache VALUES(?,?,?)").run(
        key(cell),
        JSON.stringify(entry),
        entry.retryAt,
      );
    } catch {}
  };
  function fetchCell(cell) {
    if (pending.has(cell)) return pending.get(cell);
    if (pending.size >= LIVE_POI_MAX_CONCURRENT) return Promise.resolve(null);
    const controller = new AbortController();
    const stop = setTimeout(() => controller.abort(), timeoutMs);
    stop.unref?.();
    const job = (async () => {
      const now = clock();
      try {
        const response = await fetcher(`${url}?${new URLSearchParams({ data: livePoiQuery(cell) })}`, {
          signal: controller.signal,
          headers: { "User-Agent": MAP_USER_AGENT },
        });
        const json = await boundedJson(response, LIVE_POI_MAX_BYTES);
        const rows = liveRowsFromElements(Array.isArray(json?.elements) ? json.elements : [], cell);
        const entry = { version: 1, rows, observedAt: now, retryAt: now + LIVE_POI_TTL_MS };
        write(cell, entry);
        return entry;
      } catch {
        const old = read(cell);
        const entry = {
          version: 1,
          rows: old?.rows ?? null,
          observedAt: old?.observedAt ?? 0,
          retryAt: now + LIVE_POI_RETRY_MS,
        };
        write(cell, entry);
        return entry;
      } finally {
        clearTimeout(stop);
        pending.delete(cell);
      }
    })();
    pending.set(cell, job);
    return job;
  }
  return {
    kind: "live",
    covers: (cell) => validCell(cell) && covers(cell),
    available: () => process.env.POI_LIVE !== "off",
    version: () => "live-osm",
    async prepare(cell, { waitMs = 20_000 } = {}) {
      if (!validCell(cell) || !covers(cell) || process.env.POI_LIVE === "off") return;
      const entry = read(cell);
      if (entry && clock() < entry.retryAt) return;
      const job = fetchCell(cell);
      let timer;
      await Promise.race([
        job,
        new Promise((resolve) => {
          timer = setTimeout(resolve, waitMs);
          timer.unref?.();
        }),
      ]);
      clearTimeout(timer);
    },
    cellPois(cell) {
      if (!validCell(cell) || !covers(cell)) return null;
      const rows = read(cell)?.rows;
      return Array.isArray(rows) ? rows.map((r) => ({ ...r })) : null;
    },
    cluePool: () => [],
  };
}

/**
 * The imported file where it covers a cell, the live source everywhere else.
 * Both keep the POI source interface of server/poi-quests.mjs.
 */
export function combinedPoiSource(file, live) {
  const pick = (cell) => (live?.covers(cell) ? live : file);
  return {
    kind: "combined",
    available: () => !!(file?.available() || live?.available()),
    version: () => file?.version?.() || live?.version?.() || null,
    prepare: (cell, options) => (live?.covers(cell) ? live.prepare(cell, options) : undefined),
    cellPois(cell) {
      const source = pick(cell);
      return source && source.available() ? source.cellPois(cell) : null;
    },
    cluePool(cell) {
      const source = pick(cell);
      return source && typeof source.cluePool === "function" ? source.cluePool(cell) : [];
    },
  };
}

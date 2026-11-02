// Auto cities (tier B, docs/WORLDS-PLAN.md C.1 and C.3 point 7).
//
// The World worker (scripts/poi/auto-cities.mjs) builds one CityPack per
// GeoNames city from the POI import and writes them, with an index of
// SHA-256 hashes, to a directory on the VPS. Packs are never committed.
// This module reads that index at start-up and loads packs lazily, so a
// hundred-odd cities cost one small index in memory plus a few cached packs.
//
// Rules enforced here, whatever the files on disk say:
// - every pack is fieldReview "auto" and its hash matches the index;
// - a reviewed city (any status in server/data/cities.json) wins: an auto
//   entry with the same id, or whose centre lies in a reviewed coverage box,
//   is dropped (reviewed > auto > cell);
// - auto cities are never funded (server/native/allocation.mjs refuses them).
// No network and no map API: everything comes from local files.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

export const AUTO_CITY_INDEX_SCHEMA = "questlayer.auto-cities/1";
export const AUTO_CITY_STATUS = "auto";
export const DEFAULT_AUTO_CITIES_DIR = "/var/lib/questlayer-poi/city-packs";
export const MAX_AUTO_CITIES = 5000;
export const AUTO_CITY_NOTICE =
  "Unverified map. These places were generated automatically from OpenStreetMap data and nobody has checked them on foot yet. Paths, access and opening times may be wrong: follow signs and local rules, and skip anything that looks private or unsafe. Play here is practice: XP, street coins and cosmetic finds, no prize pool.";

const ID = /^[a-z][a-z0-9-]{1,31}$/;
const FILE = /^[a-z0-9][a-z0-9.-]{0,120}\.json$/;

/** Where the index lives: AUTO_CITIES=0 turns auto cities off. */
export function autoCitiesDir(env = process.env, exists = existsSync) {
  if (env.AUTO_CITIES === "0") return null;
  if (env.AUTO_CITIES_DIR) return env.AUTO_CITIES_DIR;
  return exists(join(DEFAULT_AUTO_CITIES_DIR, "index.json"))
    ? DEFAULT_AUTO_CITIES_DIR
    : null;
}

const inBox = (p, [w, s, e, n]) =>
  p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n;

function validCoverage(c, center) {
  return (
    Array.isArray(c) &&
    c.length === 4 &&
    c.every(Number.isFinite) &&
    c[0] < c[2] &&
    c[1] < c[3] &&
    Number.isFinite(center?.lat) &&
    Number.isFinite(center?.lng) &&
    inBox(center, c)
  );
}

/**
 * Validates an index object. Returns { entries, dropped } where dropped lists
 * entries refused with a reason (reviewed precedence or bad data).
 * reviewed: [{ id, coverage }] from the city registry (all statuses).
 */
export function readAutoCityIndex(index, { reviewed = [] } = {}) {
  if (
    !index ||
    index.schema !== AUTO_CITY_INDEX_SCHEMA ||
    !Array.isArray(index.cities) ||
    index.cities.length > MAX_AUTO_CITIES
  )
    throw Error(`Auto city index must be ${AUTO_CITY_INDEX_SCHEMA}.`);
  const reviewedIds = new Set(reviewed.map((c) => c.id)),
    seen = new Set(),
    entries = [],
    dropped = [];
  for (const e of index.cities) {
    const drop = (reason) => dropped.push({ id: e?.id ?? null, reason });
    if (
      !ID.test(e?.id || "") ||
      !FILE.test(e.pack || "") ||
      !/^[0-9a-f]{64}$/.test(e.sha256 || "") ||
      typeof e.name !== "string" ||
      !e.name ||
      typeof e.timezone !== "string" ||
      !validCoverage(e.coverage, e.center)
    ) {
      drop("invalid-entry");
      continue;
    }
    if (seen.has(e.id)) {
      drop("duplicate-id");
      continue;
    }
    if (reviewedIds.has(e.id)) {
      drop("reviewed-city-wins");
      continue;
    }
    if (reviewed.some((r) => r.coverage && inBox(e.center, r.coverage))) {
      drop("inside-reviewed-city");
      continue;
    }
    seen.add(e.id);
    entries.push(
      Object.freeze({
        id: e.id,
        name: e.name,
        pack: e.pack,
        sha256: e.sha256,
        timezone: e.timezone,
        center: Object.freeze({ lat: e.center.lat, lng: e.center.lng }),
        coverage: Object.freeze([...e.coverage]),
        population: Number(e.population) || 0,
        geonameid: Number(e.geonameid) || null,
      }),
    );
  }
  return { entries, dropped, version: String(index.version || "") };
}

/**
 * The runtime view of auto cities. readFile(name) returns the pack file text
 * for an index `pack` name; tests inject it.
 */
export function createAutoCities(
  index,
  { reviewed = [], readFile, cacheSize = 12, log = () => {} } = {},
) {
  const { entries, dropped, version } = index
    ? readAutoCityIndex(index, { reviewed })
    : { entries: [], dropped: [], version: "" };
  if (dropped.length)
    log(
      `auto cities: dropped ${dropped.length} (${[...new Set(dropped.map((d) => d.reason))].join(", ")})`,
    );
  const byId = new Map(entries.map((e) => [e.id, e])),
    cache = new Map(),
    failed = new Set();
  function pack(id) {
    const entry = byId.get(id);
    if (!entry || failed.has(id)) return null;
    if (cache.has(id)) {
      const hit = cache.get(id);
      cache.delete(id);
      cache.set(id, hit);
      return hit;
    }
    let loaded = null;
    try {
      const text = readFile(entry.pack);
      if (createHash("sha256").update(text).digest("hex") !== entry.sha256)
        throw Error("hash mismatch");
      const p = JSON.parse(text);
      if (
        p.id !== id ||
        p.fieldReview !== AUTO_CITY_STATUS ||
        p.timezone !== entry.timezone ||
        !validCoverage(p.coverage, p.center) ||
        !Array.isArray(p.candidates) ||
        !Array.isArray(p.paths)
      )
        throw Error("pack does not match its index entry");
      // Reviewed > auto, also where boxes only touch: a candidate with any
      // ring point or target inside a reviewed city never enters the plan.
      const boxes = reviewed.map((r) => r.coverage).filter(Boolean),
        overlaps = (c) =>
          boxes.some(
            (b) =>
              (c.geometry?.coordinates?.[0] || []).some(([lng, lat]) =>
                inBox({ lng, lat }, b),
              ) ||
              (c.targets || []).some((t) =>
                inBox({ lng: t.point?.[0], lat: t.point?.[1] }, b),
              ),
          );
      if (boxes.length && p.candidates.some(overlaps))
        p.candidates = p.candidates.filter((c) => !overlaps(c));
      loaded = Object.freeze(p);
    } catch (error) {
      // A broken file disables that city only; its area falls back to cells.
      failed.add(id);
      log(`auto city ${id} unavailable: ${error.message}`);
      return null;
    }
    cache.set(id, loaded);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
    return loaded;
  }
  /** Nearest auto city whose coverage contains p (overlaps go to the closer centre). */
  function entryFor(p) {
    let best = null,
      bestD = Infinity;
    for (const e of entries) {
      if (failed.has(e.id) || !inBox(p, e.coverage)) continue;
      const dx = (p.lng - e.center.lng) * Math.cos((p.lat * Math.PI) / 180),
        dy = p.lat - e.center.lat,
        d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }
  return {
    version,
    entries,
    dropped,
    has: (id) => byId.has(id),
    entry: (id) => byId.get(id) || null,
    pack,
    entryFor,
    cityFor: (p) => {
      const e = entryFor(p);
      return e ? pack(e.id) : null;
    },
  };
}

function readDir(dir, reviewed, log) {
  try {
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    return createAutoCities(index, {
      reviewed,
      log,
      readFile: (name) => readFileSync(join(dir, name), "utf8"),
    });
  } catch (error) {
    log(`auto cities off: ${error.message}`);
    return createAutoCities(null);
  }
}

/**
 * Loads the index from a directory; a missing or broken index means no auto
 * cities. The World worker swaps the directory (a symlink) after each import,
 * so the index is re-checked at most once per refreshMs and reloaded when its
 * target or mtime changed. No restart is needed after a worker run.
 */
export function loadAutoCities(
  dir,
  {
    reviewed = [],
    log = console.warn,
    refreshMs = 60000,
    clock = Date.now,
  } = {},
) {
  if (!dir) return createAutoCities(null);
  const stamp = () => {
    try {
      const real = realpathSync(dir);
      return `${real}:${statSync(join(real, "index.json")).mtimeMs}`;
    } catch {
      return "missing";
    }
  };
  let current = readDir(dir, reviewed, log),
    seen = stamp(),
    checkedAt = clock();
  const fresh = () => {
    const now = clock();
    if (now - checkedAt < refreshMs) return current;
    checkedAt = now;
    const next = stamp();
    if (next !== seen) {
      seen = next;
      current = readDir(dir, reviewed, log);
      log(
        `auto cities reloaded: ${current.entries.length} (${current.version})`,
      );
    }
    return current;
  };
  return {
    get version() {
      return fresh().version;
    },
    get entries() {
      return fresh().entries;
    },
    get dropped() {
      return fresh().dropped;
    },
    has: (id) => fresh().has(id),
    entry: (id) => fresh().entry(id),
    pack: (id) => fresh().pack(id),
    entryFor: (p) => fresh().entryFor(p),
    cityFor: (p) => fresh().cityFor(p),
  };
}

import { cellToBoundary, isValidCell, getResolution } from "h3-js";
import { assert, DAY, point } from "../domain.mjs";
import { sharedOfflinePaths } from "./offline-paths.mjs";

// Overpass etiquette: a contact User-Agent; without one it answers 406.
export const MAP_USER_AGENT =
  "QuestLayer/1.0 (+https://questlayer.promptstudio3000.com/how-it-works; street paths fallback)";

const pending = new WeakMap();
const providerFetches = new WeakMap();
const MAX_BYTES = 2 * 1024 * 1024;
function pathsFrom(value) {
  assert(Array.isArray(value) && value.length <= 150, "Invalid map snapshot.");
  let count = 0;
  return value.map((path) => {
    assert(
      Array.isArray(path) && path.length >= 2 && path.length <= 2048,
      "Invalid mapped path.",
    );
    return path.map((p) => {
      assert(
        Array.isArray(p) && p.length === 2 && ++count <= 30000,
        "Map snapshot exceeds its bounds.",
      );
      point({ lng: p[0], lat: p[1] });
      return p;
    });
  });
}
async function boundedJson(response) {
  assert(response.ok, "Map provider unavailable.");
  assert(
    Number(response.headers.get("content-length") || 0) <= MAX_BYTES,
    "Map snapshot too large.",
  );
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    assert(size <= MAX_BYTES, "Map snapshot too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function sourcePaths(json) {
  assert(
    Array.isArray(json.elements) && json.elements.length <= 150,
    "Invalid map response.",
  );
  const denied = new Set([
    "no",
    "private",
    "customers",
    "permit",
    "agricultural",
    "forestry",
  ]);
  return pathsFrom(
    json.elements
      .filter(
        (e) =>
          e.type === "way" &&
          e.geometry?.length >= 2 &&
          !denied.has(e.tags?.access) &&
          !denied.has(e.tags?.foot),
      )
      .map((e) => e.geometry.map((p) => [p.lon, p.lat])),
  );
}
// Fixed cell bounds, never the first visitor's precise GPS. The World
// worker's offline file answers first (no network on the request path);
// Overpass is only a fallback for cells the file does not cover. A player
// request waits at most `timeoutMs` for it, while the provider request keeps
// running up to `providerTimeoutMs` and stores its result for the next retry.
// Failed refreshes keep an explicitly stale snapshot and a durable retry deadline.
export async function publicPathSnapshot(
  db,
  region,
  {
    clock = Date.now,
    fetcher = globalThis.fetch,
    timeoutMs = 4000,
    providerTimeoutMs = 25000,
    offline = sharedOfflinePaths(),
  } = {},
) {
  assert(
    isValidCell(region) && getResolution(region) === 7,
    "Invalid map region.",
  );
  let jobs = pending.get(db);
  if (!jobs) {
    jobs = new Map();
    pending.set(db, jobs);
  }
  if (jobs.has(region)) return jobs.get(region);
  const work = (async () => {
    const now = clock();
    const local = offline?.paths(region);
    if (local) {
      try {
        return {
          status: "fresh",
          paths: pathsFrom(local.paths),
          observedAt: local.observedAt ?? now,
          retryAt: now + 7 * DAY,
          reason: null,
          source: "offline",
        };
      } catch {
        // A malformed row falls through to the cache and provider.
      }
    }
    let old = null;
    const cached = db
      .prepare("SELECT data,expires_at FROM geo_cache WHERE region=?")
      .get(region);
    try {
      assert(
        cached && Buffer.byteLength(cached.data) <= MAX_BYTES,
        "No bounded map cache.",
      );
      const parsed = JSON.parse(cached.data);
      old = Array.isArray(parsed)
        ? {
            paths: pathsFrom(parsed),
            observedAt: cached.expires_at - 7 * DAY,
            freshUntil: cached.expires_at,
            retryAt: cached.expires_at,
            attempts: 0,
          }
        : parsed;
      old.paths = pathsFrom(old.paths);
      assert(
        [old.observedAt, old.freshUntil, old.retryAt, old.attempts].every(
          Number.isSafeInteger,
        ),
        "Invalid map cache metadata.",
      );
    } catch {
      old = null;
    }
    const result = (entry, status) => ({
      status,
      paths: entry?.paths || [],
      observedAt: entry?.observedAt ?? null,
      retryAt: entry?.retryAt ?? now,
      reason:
        status === "unavailable"
          ? "map-data-unavailable"
          : status === "stale"
            ? "map-data-refresh-unavailable"
            : null,
    });
    if (old && old.retryAt > now) {
      if (old.freshUntil > now) return result(old, "cached");
      return result(
        old.observedAt > 0 && now - old.observedAt <= 14 * DAY
          ? old
          : { ...old, paths: [] },
        old.observedAt > 0 && now - old.observedAt <= 14 * DAY
          ? "stale"
          : "unavailable",
      );
    }
    const bounds = cellToBoundary(region),
      lats = bounds.map((p) => p[0]),
      lngs = bounds.map((p) => p[1]);
    const box = `(${Math.min(...lats)},${Math.min(...lngs)},${Math.max(...lats)},${Math.max(...lngs)})`;
    const query =
      "[out:json][timeout:25];(" +
      ["footway", "pedestrian", "path", "living_street", "steps", "residential"]
        .map(
          (h) =>
            `way[highway=${h}][access!=private][access!=no][foot!=no]${box};`,
        )
        .join("") +
      ");out tags geom 150;";
    let fetches = providerFetches.get(db);
    if (!fetches) {
      fetches = new Map();
      providerFetches.set(db, fetches);
    }
    let provider = fetches.get(region);
    if (!provider) {
      const controller = new AbortController();
      const stop = setTimeout(() => controller.abort(), providerTimeoutMs);
      stop.unref?.();
      provider = (async () =>
        sourcePaths(
          await boundedJson(
            await fetcher(
              "https://overpass-api.de/api/interpreter?" +
                new URLSearchParams({ data: query }),
              {
                signal: controller.signal,
                headers: { "User-Agent": MAP_USER_AGENT },
              },
            ),
          ),
        ))();
      fetches.set(region, provider);
      // A late answer still lands in the cache for the next retry.
      provider
        .then((paths) => {
          const at = clock();
          const entry = {
            version: 1,
            paths,
            observedAt: at,
            freshUntil: at + 7 * DAY,
            retryAt: at + 7 * DAY,
            attempts: 0,
          };
          try {
            db.prepare("INSERT OR REPLACE INTO geo_cache VALUES(?,?,?)").run(
              region,
              JSON.stringify(entry),
              entry.retryAt,
            );
          } catch {}
        })
        .catch(() => {})
        .finally(() => {
          clearTimeout(stop);
          if (fetches.get(region) === provider) fetches.delete(region);
        });
    }
    let timer;
    try {
      const paths = await Promise.race([
        provider,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Map request timed out.")),
            timeoutMs,
          );
        }),
      ]);
      const entry = {
        version: 1,
        paths,
        observedAt: now,
        freshUntil: now + 7 * DAY,
        retryAt: now + 7 * DAY,
        attempts: 0,
      };
      db.prepare("INSERT OR REPLACE INTO geo_cache VALUES(?,?,?)").run(
        region,
        JSON.stringify(entry),
        entry.retryAt,
      );
      return result(entry, "fresh");
    } catch {
      const attempts = Math.min((old?.attempts || 0) + 1, 10),
        retryAt = now + Math.min(300000, 5000 * 2 ** (attempts - 1));
      const usable =
        old && old.observedAt > 0 && now - old.observedAt <= 14 * DAY;
      const entry = {
        version: 1,
        paths: usable ? old.paths : [],
        observedAt: usable ? old.observedAt : 0,
        freshUntil: 0,
        retryAt,
        attempts,
      };
      db.prepare("INSERT OR REPLACE INTO geo_cache VALUES(?,?,?)").run(
        region,
        JSON.stringify(entry),
        retryAt,
      );
      return result(entry, usable ? "stale" : "unavailable");
    } finally {
      clearTimeout(timer);
    }
  })();
  jobs.set(region, work);
  try {
    return await work;
  } finally {
    if (jobs.get(region) === work) jobs.delete(region);
  }
}

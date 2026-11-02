// Offline street paths from the World worker's POI file (docs/POI-PIPELINE.md).
// Read-only, one primary-key lookup per H3 res-7 cell, no network. The file is
// a symlink swapped weekly; the reader re-opens when its target changes.
import { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export const DEFAULT_POI_DB = "/var/lib/questlayer-poi/current.sqlite";
const RECHECK_MS = 60_000;

export function openOfflinePaths(path = process.env.POI_DB_PATH || DEFAULT_POI_DB, { clock = Date.now } = {}) {
  let db = null,
    target = null,
    checkedAt = -Infinity,
    observedAt = null,
    lookup = null;
  const close = () => {
    try {
      db?.close();
    } catch {}
    db = lookup = null;
  };
  const refresh = () => {
    const now = clock();
    if (now - checkedAt < RECHECK_MS) return;
    checkedAt = now;
    try {
      if (!path || path === "off" || !existsSync(path)) return close();
      const real = realpathSync(path);
      if (db && real === target) return;
      close();
      const next = new DatabaseSync(real, { readOnly: true });
      const hasPaths = next
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='path_cell'")
        .get();
      if (!hasPaths) {
        next.close();
        return;
      }
      db = next;
      target = real;
      lookup = db.prepare("SELECT paths FROM path_cell WHERE h3r7=?");
      const version = db.prepare("SELECT value FROM meta WHERE key='version'").get()?.value || "";
      // Version is <regions>-<YYYYMMDD>-<hash>; the date is the OSM extract day.
      const day = /-(\d{4})(\d{2})(\d{2})-[0-9a-f]+$/.exec(version);
      observedAt = day ? Date.parse(`${day[1]}-${day[2]}-${day[3]}T00:00:00Z`) : null;
    } catch {
      close();
    }
  };
  return {
    // Paths for one res-7 cell, or null when the file has no row for it.
    paths(region) {
      refresh();
      if (!lookup) return null;
      try {
        const row = lookup.get(region);
        if (!row) return null;
        return { paths: JSON.parse(inflateRawSync(row.paths).toString()), observedAt };
      } catch {
        return null;
      }
    },
    close,
  };
}

let shared = null;
export function sharedOfflinePaths() {
  shared ??= openOfflinePaths();
  return shared;
}

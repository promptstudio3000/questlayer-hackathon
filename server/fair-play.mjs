// Fair play for public GPS play (hardening, 3 Nov).
//
// Two independent guards for location rewards (street coins, discoveries and
// walk stops):
//
// 1. Travel guard (GPS worlds only, never the arena): a player's last accepted
//    fix is the anchor. A new fix far from it is accepted only after the time a
//    fast trip would take (MAX_SPEED_KMH, about 15 km/h), capped at TRAVEL_COOLDOWN_MAX_MS so a
//    real train or plane ride is a wait, not a lock-out. A rejected fix never
//    moves the anchor, so hopping between two spoofed places gains nothing.
// 2. XP caps (every world): location XP per H3 res-7 cell and local day, per
//    day in total, and the number of cells a player can earn XP in per day.
//    A capped claim still succeeds (the coin or discovery is collected and its
//    GOLD paid as before); only the XP is trimmed, and the response says why.
//
// Browser coordinates are never proof of physical truth; these caps only bound
// what a spoofer can farm. All limits are env-tunable (FAIR_PLAY_*).
import { latLngToCell } from "h3-js";
import { assert, dayKey, distance, point } from "./domain.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "./schema-compatibility.mjs";

/** Default GPS travel cap, km/h (the demo arena is exempt). */
export const MAX_SPEED_KMH = 15;

export function fairPlayLimits(env = process.env) {
  const read = (name, fallback, min, max) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
  };
  return Object.freeze({
    // Outside the demo arena GPS play is on foot or by bike: about 15 km/h
    // (owner, 11 Nov 2026). FAIR_PLAY_MAX_SPEED_KMH tunes it (whole km/h).
    maxSpeedMps: read("FAIR_PLAY_MAX_SPEED_KMH", MAX_SPEED_KMH, 1, 1440) / 3.6,
    travelCooldownMaxMs: read("FAIR_PLAY_TRAVEL_COOLDOWN_MAX_MS", 2 * 3600_000, 0, 24 * 3600_000),
    cellXpPerDay: read("FAIR_PLAY_CELL_XP_PER_DAY", 600, 0, 1_000_000),
    dailyXp: read("FAIR_PLAY_DAILY_XP", 3000, 0, 10_000_000),
    xpCellsPerDay: read("FAIR_PLAY_XP_CELLS_PER_DAY", 12, 1, 10_000),
  });
}
export const FAIR_PLAY = fairPlayLimits();
export const FAIR_PLAY_CELL_RES = 7;

export const FAIR_PLAY_SCHEMA = registerModuleSchema({
  name: "fair-play",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS fair_play_anchor(player_id TEXT PRIMARY KEY REFERENCES players(id),lat REAL NOT NULL,lng REAL NOT NULL,accuracy REAL NOT NULL,fix_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fair_play_xp(player_id TEXT NOT NULL REFERENCES players(id),day TEXT NOT NULL,cell TEXT NOT NULL,xp INTEGER NOT NULL CHECK(xp>=0),updated_at INTEGER NOT NULL,PRIMARY KEY(player_id,day,cell))`,
});
const ready = new WeakSet();
/**
 * Create the tables once per connection. Outside a transaction it takes the
 * write lock first (BEGIN IMMEDIATE waits on busy_timeout), so two connections
 * making their first claim at once never race to create them.
 */
export function ensureFairPlaySchema(db) {
  if (ready.has(db)) return;
  if (db.isTransaction) return void ensureModuleVersion(db, FAIR_PLAY_SCHEMA);
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureModuleVersion(db, FAIR_PLAY_SCHEMA);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  ready.add(db);
}

export const xpCell = (p) => latLngToCell(p.lat, p.lng, FAIR_PLAY_CELL_RES);

/** Wait (ms) a trip of `meters` needs before a fix there is trusted. */
export function travelWaitMs(meters, limits = FAIR_PLAY) {
  if (meters <= 0) return 0;
  return Math.min(
    Math.ceil((meters / limits.maxSpeedMps) * 1000),
    limits.travelCooldownMaxMs,
  );
}

/**
 * Accept a validated GPS fix (inside a transaction). Throws IMPLAUSIBLE_MOVE
 * when the jump from the last accepted fix is faster than allowed; otherwise
 * moves the anchor to this fix.
 */
export function guardTravel(db, player, fix, now = Date.now(), limits = FAIR_PLAY) {
  const p = point(fix),
    at = Number.isFinite(fix.timestamp) ? Math.round(fix.timestamp) : now,
    accuracy = Number.isFinite(fix.accuracy) ? Math.max(0, fix.accuracy) : 0;
  const prev = db
    .prepare("SELECT * FROM fair_play_anchor WHERE player_id=?")
    .get(player);
  if (prev) {
    const meters = Math.max(0, distance(prev, p) - accuracy - prev.accuracy),
      elapsed = Math.max(0, at - prev.fix_at),
      wait = travelWaitMs(meters, limits);
    if (elapsed < wait) {
      const minutes = Math.max(1, Math.ceil((wait - elapsed) / 60_000));
      assert(
        false,
        `Your location jumped too far, too fast. Rewards here open in about ${minutes} min.`,
        422,
        "IMPLAUSIBLE_MOVE",
      );
    }
  }
  db.prepare(
    "INSERT INTO fair_play_anchor(player_id,lat,lng,accuracy,fix_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,fix_at=MAX(fix_at,excluded.fix_at),updated_at=excluded.updated_at",
  ).run(player, p.lat, p.lng, accuracy, at, now);
  return p;
}

/**
 * Trim location XP to the caps (inside a transaction) and record what was
 * granted. Returns { xp, cap } where cap is null, "cell", "daily" or "cells".
 */
export function capLocationXp(db, player, xp, where, now = Date.now(), limits = FAIR_PLAY) {
  if (!(xp > 0)) return { xp: 0, cap: null };
  const day = dayKey(now),
    cell = xpCell(point(where)),
    rows = db
      .prepare("SELECT cell,xp FROM fair_play_xp WHERE player_id=? AND day=?")
      .all(player, day),
    total = rows.reduce((s, r) => s + r.xp, 0),
    here = rows.find((r) => r.cell === cell);
  if (!here && rows.length >= limits.xpCellsPerDay) return { xp: 0, cap: "cells" };
  const cellLeft = Math.max(0, limits.cellXpPerDay - (here?.xp || 0)),
    dayLeft = Math.max(0, limits.dailyXp - total),
    granted = Math.max(0, Math.min(xp, cellLeft, dayLeft)),
    cap = granted < xp ? (dayLeft <= cellLeft ? "daily" : "cell") : null;
  db.prepare(
    "INSERT INTO fair_play_xp(player_id,day,cell,xp,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(player_id,day,cell) DO UPDATE SET xp=xp+excluded.xp,updated_at=excluded.updated_at",
  ).run(player, day, cell, granted, now);
  return { xp: granted, cap };
}

export const XP_CAP_NOTES = Object.freeze({
  cell: "You have found most of today's XP in this area. Explore another part of town.",
  daily: "You reached today's XP limit. Rewards keep counting; XP returns tomorrow.",
  cells: "You earned XP in many areas today. XP returns tomorrow.",
});

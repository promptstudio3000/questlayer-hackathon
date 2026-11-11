// Treasury history (docs/TREASURY-PAGE.md): one point per UTC day with the
// treasury total and its buckets (staked, liquid staking, stables, reserve),
// so /treasury can draw how the treasury grew. The live point comes from the
// treasury mix view (GET /api/treasury/mix, which also counts the staking
// vaults); days before the recorder existed come from the public records the
// Mac scripts publish (each mix run's "before" and the first stNEAR deposit).
// Read-only and public: totals only, no player data.
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";

export const TREASURY_HISTORY_SCHEMA = registerModuleSchema({
  name: "treasury-history",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS treasury_history(
 day TEXT PRIMARY KEY,
 at INTEGER NOT NULL,
 total TEXT NOT NULL,
 buckets TEXT NOT NULL
);
`,
});

export const HISTORY_BUCKETS = ["staked", "lst", "stable", "near"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** 31 Oct 2026 was a one-off pilot test; the public history starts on 1 Nov (owner, 11 Nov). */
export const HISTORY_START = "2026-11-01";
const U128 = /^(0|[1-9]\d{0,38})$/;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Bucket values of a mix view or a record row, as decimal yocto strings. */
export function bucketValues(rows) {
  const out = Object.fromEntries(HISTORY_BUCKETS.map((b) => [b, "0"]));
  for (const r of rows || []) if (HISTORY_BUCKETS.includes(r.bucket) && U128.test(String(r.current))) out[r.bucket] = String(r.current);
  return out;
}
const sum = (buckets) => HISTORY_BUCKETS.reduce((a, b) => a + BigInt(buckets[b] || "0"), 0n).toString();

/**
 * Pure: points from the published records, newest per day.
 *  mixRecord    public/treasury-mix-<network>.json (runs[].at, runs[].before, runs[].after)
 *  stnearRecord public/stnear-treasury-<network>.json (deposits[].at, deposits[].near)
 */
export function seedPoints({ mixRecord = null, stnearRecord = null } = {}) {
  const byDay = new Map();
  const put = (at, buckets) => {
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return;
    const day = utcDay(ms);
    const prev = byDay.get(day);
    if (!prev || prev.at <= ms) byDay.set(day, { day, at: ms, total: sum(buckets), buckets, source: "record" });
  };
  let lstSoFar = 0n;
  for (const d of stnearRecord?.deposits || []) {
    if (!U128.test(String(d.near))) continue;
    lstSoFar += BigInt(d.near);
    put(d.at, { ...bucketValues([]), lst: lstSoFar.toString() });
  }
  for (const r of mixRecord?.runs || []) {
    put(r.at, bucketValues(r.before));
    if (Array.isArray(r.after)) put(r.at, bucketValues(r.after));
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** SQLite-backed recorder: `note()` keeps the newest view of each UTC day. */
export function createTreasuryHistory(db, { records = () => ({}), clock = Date.now, maxDays = 365 } = {}) {
  ensureModuleVersion(db, TREASURY_HISTORY_SCHEMA);
  const upsert = db.prepare(
    `INSERT INTO treasury_history(day, at, total, buckets) VALUES(?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET at = excluded.at, total = excluded.total, buckets = excluded.buckets
     WHERE excluded.at >= treasury_history.at`,
  );
  const recent = db.prepare(`SELECT day, at, total, buckets FROM treasury_history ORDER BY day DESC LIMIT ?`);
  return {
    /** Store the live treasury mix view as today's point. */
    note(view, now = clock()) {
      if (!view || !U128.test(String(view.total)) || !Array.isArray(view.buckets)) return false;
      const buckets = bucketValues(view.buckets);
      upsert.run(utcDay(now), now, String(view.total), JSON.stringify(buckets));
      return true;
    },
    /** Points oldest first: recorded days win over the seeded ones. */
    read({ days = 90 } = {}) {
      const n = Math.max(1, Math.min(maxDays, Math.floor(days) || 90));
      const live = recent.all(n).map((r) => ({ day: r.day, at: Number(r.at), total: r.total, buckets: { ...bucketValues([]), ...JSON.parse(r.buckets) }, source: "live" }));
      const have = new Set(live.map((p) => p.day));
      const seeded = seedPoints(records() || {}).filter((p) => !have.has(p.day));
      const all = [...seeded, ...live].filter((p) => DAY.test(p.day) && p.day >= HISTORY_START).sort((a, b) => a.day.localeCompare(b.day));
      return { buckets: HISTORY_BUCKETS, points: all.slice(-n) };
    },
  };
}

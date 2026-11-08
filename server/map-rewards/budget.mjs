// The real daily map budget (docs/MAP-REWARDS.md §1, map-rewards-v2).
//
// Map coins are backed QGOLD: the day's coin budget is the map's share of the
// rewards contract's per-date cap (which grows with treasury funding), priced
// in micro-QGOLD at the vault's backing rate R. The reward worker reads both
// from chain (`recordMapBudget`); until it has, the testnet defaults apply.
// There is no practice money: the game database's `treasury` table is not
// used by map rewards.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import {
  DEFAULT_COIN_DAY_YOCTO,
  DEFAULT_QGOLD_RATE_YOCTO,
  DEFAULT_ZONE_DAY_YOCTO,
  QGOLD_UNITS,
} from "./policy.mjs";

export const MAP_BUDGET_SCHEMA = registerModuleSchema({
  name: "map-budget",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS map_budget(id TEXT PRIMARY KEY CHECK(id='latest'), coin_yocto TEXT NOT NULL, zone_yocto TEXT NOT NULL, rate_yocto TEXT NOT NULL, source TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
});
const ready = new WeakSet();
function ensure(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, MAP_BUDGET_SCHEMA);
  ready.add(db);
}

const positive = (v) => {
  try {
    const n = BigInt(v);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
};

/** micro-QGOLD for an amount of yoctoNEAR at backing rate R (yocto per QGOLD). */
export const unitsForYocto = (yocto, rate) =>
  rate > 0n ? (BigInt(yocto) * QGOLD_UNITS) / BigInt(rate) : 0n;
/** yoctoNEAR backing one micro-QGOLD at rate R. */
export const yoctoPerUnit = (rate) => BigInt(rate) / QGOLD_UNITS;

/** Store what the chain reported: today's map caps and the vault's R. */
export function recordMapBudget(
  db,
  { coinYocto, zoneYocto, rateYocto, source = "chain" },
  now = Date.now(),
) {
  ensure(db);
  const coin = positive(coinYocto),
    zone = positive(zoneYocto),
    rate = positive(rateYocto);
  if (!coin || !zone || !rate) return false;
  db.prepare(
    "INSERT INTO map_budget VALUES('latest',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET coin_yocto=excluded.coin_yocto,zone_yocto=excluded.zone_yocto,rate_yocto=excluded.rate_yocto,source=excluded.source,updated_at=excluded.updated_at",
  ).run(String(coin), String(zone), String(rate), source, now);
  return true;
}

function envYocto(env, name, fallback) {
  return positive(env[name]) ?? fallback;
}

/**
 * The day's budget in micro-QGOLD: { coinsU, zonesU, rateYocto, source }.
 * Last chain report first, then MAP_COIN_DAY_YOCTO / MAP_ZONE_DAY_YOCTO /
 * QGOLD_RATE_YOCTO, then the testnet defaults.
 */
export function mapDayBudget(db, env = process.env) {
  ensure(db);
  const row = db.prepare("SELECT * FROM map_budget WHERE id='latest'").get();
  const coin = row
      ? BigInt(row.coin_yocto)
      : envYocto(env, "MAP_COIN_DAY_YOCTO", DEFAULT_COIN_DAY_YOCTO),
    zone = row
      ? BigInt(row.zone_yocto)
      : envYocto(env, "MAP_ZONE_DAY_YOCTO", DEFAULT_ZONE_DAY_YOCTO),
    rate = row
      ? BigInt(row.rate_yocto)
      : envYocto(env, "QGOLD_RATE_YOCTO", DEFAULT_QGOLD_RATE_YOCTO);
  const cap = BigInt(Number.MAX_SAFE_INTEGER);
  const clamp = (n) => Number(n > cap ? cap : n);
  return {
    coinsU: clamp(unitsForYocto(coin, rate)),
    zonesU: clamp(unitsForYocto(zone, rate)),
    coinYocto: String(coin),
    zoneYocto: String(zone),
    rateYocto: String(rate),
    source: row ? row.source : "default",
  };
}

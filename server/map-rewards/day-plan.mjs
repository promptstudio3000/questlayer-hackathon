// The daily Czechia-wide reward plan (docs/MAP-REWARDS.md, map-rewards-v2).
//
// Once per local day (Europe/Prague) the server takes the day's real budget
// (budget.mjs: the map's share of the rewards contract's per-date cap, in
// micro-QGOLD) and lays it over every res-7 cell of Czechia:
//
// Coins: every coin on the map is backed and worth the same. Each cell holds
//   CELL_COINS shares (a pioneer cell, nobody there for 30 days, twice that),
//   one coin = coin budget / all shares. Cells with fewer paths place fewer
//   coins; their shares stay in the treasury.
// Zones: the zone budget follows the formula
//   votes     up to 50 %  (stream 7; unused share goes to the others)
//   demand        20 %    distinct players who collected there, last 7 days
//   random        15 %    3 % of cells, picked from the day seed
//   potential     10 %    1 + sqrt(checked public places in the cell)
//   stake          5 %    distinct stakers who collected there, last 30 days
//   with at most 1 % per cell and 25 % per res-5 area.
//
// The result is one leaf per cell and one Merkle root per day. A cell's coins
// are derived from its leaf (value, seed) when the first player opens it, so
// the root fixes the whole day's map money before anyone plays.
import { cellToParent, latLngToCell } from "h3-js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { atomic } from "../database.mjs";
import { dayKey, hash } from "../domain.mjs";
import { merkle, sha256Hex } from "../chain-ledger/merkle.mjs";
import { shiftDate } from "../spatial/calendar.mjs";
import { czechiaCells } from "./czechia.mjs";
import { ensureMapRewardsSchema } from "./schema.mjs";
import { mapDayBudget } from "./budget.mjs";
import {
  AREA_CAP_BPS,
  CELL_CAP_BPS,
  CELL_COINS,
  CELL_ZONE_STEPS,
  DEMAND_DAYS,
  FORMULA,
  MAP_REWARDS_POLICY,
  MAX_CELL_ZONES,
  PIONEER_DAYS,
  PIONEER_MULT,
  RANDOM_CELLS_BPS,
  STAKE_DAYS,
} from "./policy.mjs";
import { unit } from "./placement.mjs";

export const MAP_TIMEZONE = "Europe/Prague";
const bps = (n, b) => Math.floor((n * b) / 10000);

/** Leaf of one funded cell: what the day's root commits to. */
export function cellLeaf({ day, cell, coinsU, zonesU, zones, pioneer, seed }) {
  return sha256Hex(
    [
      "qlmap1",
      MAP_REWARDS_POLICY,
      day,
      cell,
      coinsU,
      zonesU,
      zones,
      pioneer ? 1 : 0,
      seed,
    ].join("|"),
  );
}

/** Seed of a cell on a day, derived from the day seed. */
export const cellSeed = (daySeed, cell) => hash(`${daySeed}|${cell}`);

export function zonesForPotential(pois = 0) {
  let n = 1;
  for (const step of CELL_ZONE_STEPS) if (pois >= step) n++;
  return Math.min(MAX_CELL_ZONES, n);
}

/**
 * One coin's value: the coin budget split into equal shares, CELL_COINS per
 * cell and twice that for a pioneer cell. Integer micro-QGOLD, rounded down.
 */
export function coinValue(coinsU, cellCount, pioneerCount) {
  const shares = CELL_COINS * (cellCount + pioneerCount * (PIONEER_MULT - 1));
  return shares > 0 ? Math.floor(Math.max(0, coinsU) / shares) : 0;
}

/**
 * Cap cells at cellCap and res-5 areas at areaCap, offering what a capped
 * cell cannot take to the uncapped ones (a few rounds). Returns integer budgets.
 */
function capped(weights, pool, cellCap, areaCap) {
  const out = new Map();
  let open = new Map(weights),
    left = pool;
  const areaUsed = new Map();
  for (let round = 0; round < 6 && left > 0 && open.size; round++) {
    const total = [...open.values()].reduce((n, w) => n + w, 0);
    if (total <= 0) break;
    const next = new Map();
    let spent = 0;
    for (const [cell, w] of open) {
      const area = cellToParent(cell, 5),
        have = out.get(cell) || 0,
        roomCell = cellCap - have,
        roomArea = areaCap - (areaUsed.get(area) || 0),
        want = Math.floor((left * w) / total),
        take = Math.max(0, Math.min(want, roomCell, roomArea));
      if (take > 0) {
        out.set(cell, have + take);
        areaUsed.set(area, (areaUsed.get(area) || 0) + take);
        spent += take;
      }
      if (take === want && roomCell - take > 0 && roomArea - take > 0)
        next.set(cell, w);
    }
    left -= spent;
    if (!spent) break;
    open = next;
  }
  return out;
}

export function zoneAllocationWeights({ seed, cells, demand=new Map(), stake=new Map(), potential=new Map(), votes=new Map() }) {
  const random = new Set(
    cells.filter((c) => unit(seed, `random:${c}`) * 10000 < RANDOM_CELLS_BPS),
  );
  const scores = {
    votes: (c) => votes.get(c) || 0,
    demand: (c) => demand.get(c) || 0,
    random: (c) => (random.has(c) ? 1 : 0),
    potential: (c) => 1 + Math.sqrt(potential.get(c) || 0),
    stake: (c) => stake.get(c) || 0,
  };
  const sums = Object.fromEntries(
    Object.entries(scores).map(([k, f]) => [
      k,
      cells.reduce((n, c) => n + f(c), 0),
    ]),
  );
  // Components nobody fed today give their share to the others.
  const used = Object.keys(FORMULA).filter((k) => sums[k] > 0);
  const share = used.reduce((n, k) => n + FORMULA[k], 0);
  const weights = new Map();
  for (const c of cells) {
    let w = 0;
    for (const k of used) w += (FORMULA[k] / share) * (scores[k](c) / sums[k]);
    if (w > 0) weights.set(c, w);
  }
  return {random,used,share,weights};
}

/**
 * Pure plan of one day. `demand`, `stake` and `potential` map cell -> score
 * (players or place counts); `pioneers` is the set of cells nobody visited for
 * PIONEER_DAYS. Returns totals, per-cell rows and the Merkle root.
 */
export function buildDayPlan({
  day,
  seed,
  cells = czechiaCells(),
  coinsU,
  zonesU,
  demand = new Map(),
  stake = new Map(),
  potential = new Map(),
  votes = new Map(),
  pioneers = new Set(),
}) {
  const pioneerCount = cells.filter((c) => pioneers.has(c)).length;
  const valueU = coinValue(coinsU, cells.length, pioneerCount),
    cellCoinsU = CELL_COINS * valueU;
  const {random,used,share,weights}=zoneAllocationWeights({seed,cells,demand,stake,potential,votes});
  const zones = capped(
    weights,
    zonesU,
    bps(zonesU, CELL_CAP_BPS),
    bps(zonesU, AREA_CAP_BPS),
  );
  const rows = [];
  for (const cell of cells) {
    const c = cellCoinsU,
      z = zones.get(cell) || 0,
      pioneer = pioneers.has(cell);
    if (!c && !z && !pioneer) continue;
    const zoneCount = zonesForPotential(potential.get(cell) || 0);
    const row = {
      cell,
      coinsU: c,
      zonesU: z,
      zones: zoneCount,
      coins: c > 0 ? CELL_COINS : 0,
      pioneer,
    };
    row.leaf = cellLeaf({
      day,
      cell,
      coinsU: c,
      zonesU: z,
      zones: zoneCount,
      pioneer,
      seed: cellSeed(seed, cell),
    });
    rows.push(row);
  }
  const { root } = merkle(rows.map((r) => r.leaf));
  const spentCoins = rows.reduce((n, r) => n + r.coinsU, 0),
    spentZones = rows.reduce((n, r) => n + r.zonesU, 0),
    // A pioneer cell's coins are worth double: the contract pays such a cell
    // up to twice its leaf, so the day reserves that extra share too.
    pioneerU = rows.reduce(
      (n, r) => n + (r.pioneer ? r.coinsU * (PIONEER_MULT - 1) : 0),
      0,
    );
  return {
    day,
    policy: MAP_REWARDS_POLICY,
    seed,
    root,
    coinsU: spentCoins,
    zonesU: spentZones,
    pioneerU,
    rows,
    summary: {
      cells: cells.length,
      funded: rows.filter((r) => r.coinsU > 0).length,
      pioneers: rows.filter((r) => r.pioneer).length,
      random: random.size,
      components: Object.fromEntries(
        Object.keys(FORMULA).map((k) => [
          k,
          used.includes(k) ? Math.round((FORMULA[k] / share) * 10000) : 0,
        ]),
      ),
      budget: { coinsU, zonesU },
      coinValueU: valueU,
      coinsPerCell: CELL_COINS,
      unplacedU: {
        coins: coinsU - spentCoins - pioneerU,
        zones: zonesU - spentZones,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Inputs from the database.

function safeAll(db, sql, ...args) {
  try {
    return db.prepare(sql).all(...args);
  } catch {
    return [];
  }
}

/** Distinct players per cell from coin and quest claims since `since`. */
export function claimersByCell(db, since, { stakersOnly = false } = {}) {
  const stakers = stakersOnly
    ? new Set(
        safeAll(
          db,
          "SELECT player_id FROM staker_status WHERE tier>1 OR matured NOT IN ('0','')",
        ).map((r) => r.player_id),
      )
    : null;
  const seen = new Map();
  const add = (cell, player) => {
    if (
      !player ||
      String(player).startsWith("seed-") ||
      (stakers && !stakers.has(player))
    )
      return;
    if (!seen.has(cell)) seen.set(cell, new Set());
    seen.get(cell).add(player);
  };
  for (const r of safeAll(
    db,
    "SELECT lat,lng,claimant FROM coins WHERE claimant IS NOT NULL AND claimed_at>=?",
    since,
  ))
    add(latLngToCell(r.lat, r.lng, 7), r.claimant);
  for (const r of safeAll(
    db,
    "SELECT q.lat,q.lng,c.player_id FROM quest_claims c JOIN quests q ON q.id=c.quest_id WHERE c.created_at>=?",
    since,
  ))
    add(latLngToCell(r.lat, r.lng, 7), r.player_id);
  return new Map([...seen].map(([c, s]) => [c, s.size]));
}

/** Cells visited in the last PIONEER_DAYS days. */
function recentlyVisited(db, day) {
  const since = shiftDate(day, -PIONEER_DAYS);
  return new Set(
    safeAll(
      db,
      "SELECT cell FROM map_cell_visits WHERE last_day>=?",
      since,
    ).map((r) => r.cell),
  );
}

/** POI counts per res-7 cell from the W3 file (read-only), cached per file version. */
let poiCountCache = { key: null, counts: new Map() };
export function poiCellCounts(
  path = process.env.POI_DB_PATH || "/var/lib/questlayer-poi/current.sqlite",
  open,
) {
  try {
    const handle = open ? open(path) : null;
    if (!handle) return poiCountCache.counts;
    try {
      const version =
        handle.prepare("SELECT value FROM meta WHERE key='version'").get()
          ?.value || "?";
      if (poiCountCache.key === `${path}:${version}`)
        return poiCountCache.counts;
      const counts = new Map(
        handle
          .prepare(
            "SELECT h3r7 cell,COUNT(*) n FROM poi WHERE safety='ok' GROUP BY h3r7",
          )
          .all()
          .map((r) => [r.cell, r.n]),
      );
      poiCountCache = { key: `${path}:${version}`, counts };
      return counts;
    } finally {
      handle.close();
    }
  } catch {
    return poiCountCache.counts;
  }
}

export function mapDaySeed(
  day,
  secret = process.env.MAP_REWARDS_SEED || "questlayer",
) {
  return createHash("sha256")
    .update(`${secret}|${MAP_REWARDS_POLICY}|${day}`)
    .digest("hex");
}

/**
 * Today's stored plan, built once from the day's real budget and the claims
 * of the previous days. `potential` (cell -> POI count) defaults to the POI file.
 */
export function ensureDayPlan(
  db,
  now = Date.now(),
  { potential, day = dayKey(now, MAP_TIMEZONE) } = {},
) {
  ensureMapRewardsSchema(db);
  const found = readDay(db, day);
  if (found) return found;
  const start = Date.parse(`${day}T00:00:00Z`);
  const visited = recentlyVisited(db, day);
  const budget = mapDayBudget(db);
  const plan = buildDayPlan({
    day,
    seed: mapDaySeed(day),
    coinsU: budget.coinsU,
    zonesU: budget.zonesU,
    demand: claimersByCell(db, start - DEMAND_DAYS * 86400000),
    stake: claimersByCell(db, start - STAKE_DAYS * 86400000, {
      stakersOnly: true,
    }),
    potential: potential || defaultPotential(),
    pioneers: new Set(czechiaCells().filter((c) => !visited.has(c))),
  });
  plan.summary.budget = {
    ...plan.summary.budget,
    coinYocto: budget.coinYocto,
    zoneYocto: budget.zoneYocto,
    rateYocto: budget.rateYocto,
    source: budget.source,
  };
  return atomic(db, () => {
    const again = readDay(db, day);
    if (again) return again;
    db.prepare("INSERT INTO map_reward_days VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      day,
      plan.policy,
      plan.seed,
      plan.root,
      plan.coinsU,
      plan.zonesU,
      plan.pioneerU,
      plan.pioneerU,
      JSON.stringify(plan.summary),
      now,
    );
    const insert = db.prepare(
      "INSERT INTO map_reward_cells VALUES(?,?,?,?,?,?,?,?)",
    );
    for (const r of plan.rows)
      insert.run(
        day,
        r.cell,
        r.coinsU,
        r.zonesU,
        r.zones,
        r.coins,
        r.pioneer ? 1 : 0,
        r.leaf,
      );
    return readDay(db, day);
  });
}

let potentialSource = null;
/** Operator/test hook: where the POI counts come from (cell -> count). */
export function setPotentialSource(fn) {
  potentialSource = fn;
}
function defaultPotential() {
  if (potentialSource) return potentialSource();
  return poiCellCounts(undefined, (path) =>
    existsSync(path) ? new DatabaseSync(path, { readOnly: true }) : null,
  );
}

export function readDay(db, day) {
  ensureMapRewardsSchema(db);
  const row = db.prepare("SELECT * FROM map_reward_days WHERE day=?").get(day);
  if (!row) return null;
  return {
    day: row.day,
    policy: row.policy,
    seed: row.seed,
    root: row.root,
    coinsU: row.coins_u,
    zonesU: row.zones_u,
    pioneerU: row.pioneer_u,
    pioneerLeftU: row.pioneer_left_u,
    summary: JSON.parse(row.summary),
    createdAt: row.created_at,
  };
}

export function readCell(db, day, cell) {
  ensureMapRewardsSchema(db);
  const r = db
    .prepare("SELECT * FROM map_reward_cells WHERE day=? AND cell=?")
    .get(day, cell);
  return r
    ? {
        cell: r.cell,
        coinsU: r.coins_u,
        zonesU: r.zones_u,
        zones: r.zones,
        coins: r.coins,
        pioneer: !!r.pioneer,
        leaf: r.leaf,
      }
    : null;
}

const proofCache = new Map();
/** Merkle proof of one cell's leaf against the day's root. */
export function cellProof(db, day, cell) {
  ensureMapRewardsSchema(db);
  let tree = proofCache.get(day);
  if (!tree) {
    const rows = db
      .prepare(
        "SELECT cell,leaf FROM map_reward_cells WHERE day=? ORDER BY cell",
      )
      .all(day);
    const { root, proofs } = merkle(rows.map((r) => r.leaf));
    tree = {
      root,
      index: new Map(rows.map((r, i) => [r.cell, i])),
      leaves: rows.map((r) => r.leaf),
      proofs,
    };
    proofCache.clear();
    proofCache.set(day, tree);
  }
  const i = tree.index.get(cell);
  if (i === undefined) return null;
  return {
    day,
    cell,
    leaf: tree.leaves[i],
    index: i,
    proof: tree.proofs[i],
    root: tree.root,
  };
}

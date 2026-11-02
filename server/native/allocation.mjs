// Daily reward allocation from the one global treasury, and the realized-yield
// backing for days that claim to be paid from staking yield.
//
// Rules (docs/GLOBAL-TREASURY.md; docs/CONTINUATION-PLAN.md "Zones everywhere,
// money only where it is verified"):
//   - There is one treasury and one daily budget for the whole game. Cities
//     never own money; they only decide where today's rewards appear.
//   - Each bucket's daily budget is the smaller of the per-day cap and a fixed
//     share (basis points) of what the global treasury has available.
//   - That budget is placed on the map by player demand (default): each city's
//     weight is 1 + the distinct players who claimed there in the last seven
//     local days, so money follows players instead of idling in empty cities.
//     NATIVE_BUDGET_SPLIT=weights keeps the fixed operator weights instead.
//     Integer division rounds down; the remainder stays in the global
//     treasury, so the split never exceeds the budget. Coins nobody collects
//     return to the same global treasury when the day closes.
//   - A yield-backed day may additionally spend no more than the realized yield
//     that vaults have actually paid to the treasury (vault `game_paid`) minus
//     what earlier yield-backed days already committed.
// Pure functions only: the caller supplies chain reads and stored manifests.
import { assert } from "../domain.mjs";
import { shiftDate } from "../spatial/calendar.mjs";

export const DAILY_BUCKET_CAP = 6n * 10n ** 21n;
const MAX_CITIES = 16;
const MAX_WEIGHT = 1000;
export const DEMAND_WINDOW_DAYS = 7;
export const BUDGET_SPLITS = Object.freeze(["demand", "weights"]);
const yocto = (value, label) => {
  const text = typeof value === "bigint" ? value.toString() : value;
  assert(
    typeof text === "string" && /^\d{1,40}$/.test(text),
    `Invalid ${label} amount.`,
    503,
  );
  return BigInt(text);
};
const min = (a, b) => (a < b ? a : b);

/** Validates and normalises the funded-city list; disabled cities are dropped. */
export function fundedCities(cities) {
  assert(
    Array.isArray(cities) && cities.length > 0 && cities.length <= MAX_CITIES,
    "Supply between one and sixteen funded cities.",
    503,
  );
  const seen = new Set();
  const enabled = [];
  for (const c of cities) {
    assert(
      c &&
        typeof c.id === "string" &&
        /^[a-z][a-z0-9-]{0,24}$/.test(c.id) &&
        !seen.has(c.id),
      "Funded city ids must be unique native city ids.",
      503,
    );
    seen.add(c.id);
    const weight = c.weight ?? 1;
    assert(
      Number.isInteger(weight) && weight >= 1 && weight <= MAX_WEIGHT,
      "City weights must be whole numbers from 1 to 1000.",
      503,
    );
    if (c.enabled !== false) enabled.push({ id: c.id, weight });
  }
  assert(enabled.length > 0, "No funded city is enabled.", 503);
  return enabled.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Demand weights for the global budget: 1 + recent distinct players, capped.
 * The floor of 1 keeps a new city on the map; it is not a city budget.
 * @param {{id:string,enabled?:boolean}[]} cities
 * @param {Record<string, number>} players distinct recent players per city id
 */
export function demandWeights(cities, players = {}) {
  return fundedCities(cities).map((c) => {
    const n = Number(players?.[c.id] ?? 0);
    const recent = Number.isInteger(n) && n > 0 ? n : 0;
    return { id: c.id, weight: Math.min(MAX_WEIGHT, 1 + recent) };
  });
}

/**
 * Distinct players with a native claim in each city over the local dates
 * before `date` (the window ends the day before, so one date's split cannot
 * move while it is being played). Day ids are `<city>-YYYY-MM-DD-v<n>`.
 * @returns {Record<string, number>}
 */
export function recentCityPlayers(db, date, days = DEMAND_WINDOW_DAYS) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), "Invalid local date.", 503);
  const dates = new Set();
  for (let k = 1; k <= days; k++) dates.add(shiftDate(date, -k));
  const accounts = new Map();
  let rows = [];
  try {
    rows = db
      .prepare("SELECT DISTINCT day_id, account_id FROM native_reward_claims")
      .all();
  } catch (error) {
    // A host without native claims yet has no demand: every city weighs 1.
    if (!/no such table/.test(String(error?.message))) throw error;
  }
  for (const { day_id, account_id } of rows) {
    const m = /^([a-z][a-z0-9-]{0,24})-(\d{4}-\d{2}-\d{2})-v\d+$/.exec(day_id);
    if (!m || !dates.has(m[2])) continue;
    if (!accounts.has(m[1])) accounts.set(m[1], new Set());
    accounts.get(m[1]).add(account_id);
  }
  return Object.fromEntries([...accounts].map(([id, set]) => [id, set.size]));
}

/**
 * Splits one day's global budget per bucket between the cities where it
 * appears on the map.
 * @returns {{shareBps:number, cap:string, budget:{coins:string,zones:string},
 *   cities:{id:string,weight:number,coins:string,zones:string}[],
 *   unallocated:{coins:string,zones:string}}}
 */
export function allocateDailyBudget({
  available,
  cities,
  shareBps = 10000,
  cap = DAILY_BUCKET_CAP,
  limit = null,
}) {
  assert(
    Number.isInteger(shareBps) && shareBps >= 1 && shareBps <= 10000,
    "Daily share must be 1 to 10000 basis points.",
    503,
  );
  const capValue = yocto(cap, "cap");
  const list = fundedCities(cities);
  const totalWeight = BigInt(list.reduce((n, c) => n + c.weight, 0));
  const budget = {};
  for (const bucket of ["coins", "zones"]) {
    let value = min(
      capValue,
      (yocto(available?.[bucket], bucket) * BigInt(shareBps)) / 10000n,
    );
    if (limit) value = min(value, yocto(limit[bucket], `${bucket} limit`));
    budget[bucket] = value;
  }
  const split = list.map((c) => ({
    id: c.id,
    weight: c.weight,
    coins: ((budget.coins * BigInt(c.weight)) / totalWeight).toString(),
    zones: ((budget.zones * BigInt(c.weight)) / totalWeight).toString(),
  }));
  const spent = (bucket) => split.reduce((n, c) => n + BigInt(c[bucket]), 0n);
  return {
    shareBps,
    cap: capValue.toString(),
    budget: { coins: budget.coins.toString(), zones: budget.zones.toString() },
    cities: split,
    unallocated: {
      coins: (budget.coins - spent("coins")).toString(),
      zones: (budget.zones - spent("zones")).toString(),
    },
  };
}

/** Cost of a stored manifest as the contract books it. */
export function manifestCost(manifest) {
  const coins =
    yocto(manifest.coinUnit, "coin unit") * BigInt(manifest.coins.length);
  const zones = manifest.quests.reduce(
    (n, q) => n + yocto(q.reward, "quest reward"),
    0n,
  );
  return { coins, zones, total: coins + zones };
}

/**
 * How much realized yield is still free to back a new day.
 * `vaultStates` are `get_state` views of approved vaults that pay this rewards
 * contract; `yieldDays` are stored manifests already marked
 * `funding: "realized_yield"`. The treasury funds every receipt 50/50 into
 * coins and zones, so the free yield is split the same way.
 */
export function realizedYieldBacking({ vaultStates, yieldDays, rewardsId }) {
  assert(Array.isArray(vaultStates), "Vault states are required.", 503);
  let paid = 0n;
  const vaults = [];
  for (const s of vaultStates) {
    assert(
      s && s.rewards === rewardsId,
      "Realized yield must come from vaults that pay this rewards contract.",
      503,
    );
    const p = yocto(s.game_paid, "game paid");
    paid += p;
    vaults.push({ gamePaid: p.toString() });
  }
  let committed = 0n;
  for (const m of yieldDays || []) {
    assert(m.funding === "realized_yield", "Not a yield-backed day.", 503);
    committed += manifestCost(m).total;
  }
  const free = paid > committed ? paid - committed : 0n;
  const coins = free / 2n;
  return {
    paid: paid.toString(),
    committed: committed.toString(),
    free: free.toString(),
    limit: { coins: coins.toString(), zones: (free - coins).toString() },
    covered: committed <= paid,
  };
}

/**
 * Reads the publisher's allocation settings from the environment:
 * NATIVE_FUNDED_CITIES="plzen:1,brno:1" (where the global budget may appear;
 *   default every live city; weights default to 1 and apply only to
 *   NATIVE_BUDGET_SPLIT=weights),
 * NATIVE_BUDGET_SPLIT=demand|weights (default demand: players decide where
 *   the global budget appears; weights: the fixed NATIVE_FUNDED_CITIES weights),
 * NATIVE_DAILY_SHARE_BPS (1..10000, default 10000),
 * NATIVE_YIELD_BACKED_DAYS=1 (publish only what realized yield covers),
 * NATIVE_MANIFEST_V2_FROM=YYYY-MM-DD|off (first new date prepared as v2).
 */
export function allocationSettings(env = process.env) {
  const settings = {};
  if (env.NATIVE_FUNDED_CITIES) {
    settings.fundedCities = fundedCities(
      env.NATIVE_FUNDED_CITIES.split(",").map((part) => {
        const [id, weight] = part.trim().split(":");
        return {
          id,
          weight: weight === undefined ? 1 : Number(weight),
        };
      }),
    );
  }
  const split = (env.NATIVE_BUDGET_SPLIT || "demand").trim();
  assert(
    BUDGET_SPLITS.includes(split),
    "NATIVE_BUDGET_SPLIT must be demand or weights.",
    503,
  );
  settings.budgetSplit = split;
  if (env.NATIVE_DAILY_SHARE_BPS) {
    const bps = Number(env.NATIVE_DAILY_SHARE_BPS);
    assert(
      Number.isInteger(bps) && bps >= 1 && bps <= 10000,
      "NATIVE_DAILY_SHARE_BPS must be 1 to 10000.",
      503,
    );
    settings.dailyShareBps = bps;
  }
  settings.yieldBackedDays = env.NATIVE_YIELD_BACKED_DAYS === "1";
  if (env.NATIVE_MANIFEST_V2_FROM) {
    const from = env.NATIVE_MANIFEST_V2_FROM.trim();
    assert(
      from === "off" || /^\d{4}-\d{2}-\d{2}$/.test(from),
      "NATIVE_MANIFEST_V2_FROM must be YYYY-MM-DD or off.",
      503,
    );
    settings.manifestV2From = from;
  }
  return settings;
}

// Map rewards in a world (docs/MAP-REWARDS.md): when the first player opens
// an H3 cell on a day, its coins, zone prizes and pioneer bonus are drawn
// from the day plan and written once. Every coin is backed QGOLD of the same
// value (pioneer coins count twice). The city demo pays the same backed
// coins, and cells outside the plan (outside Czechia) get no coins.
import { mapChainEnabled, mapChainStatus } from "./chain.mjs";
import {
  latLngToCell,
  cellToLatLng,
  cellToParent,
  isValidCell,
  getResolution,
  cellToBoundary,
} from "h3-js";
import { poiQuestActivity } from "../quest-templates.mjs";
import { shiftDate } from "../spatial/calendar.mjs";
import { atomic } from "../database.mjs";
import { distance } from "../domain.mjs";
import { isCzechiaCell } from "./czechia.mjs";
import { payoutsEnabled } from "../payouts/worker.mjs";
import {
  cellSeed,
  ensureDayPlan,
  readCell,
  MAP_TIMEZONE,
  cellProof,
  readDay,
} from "./day-plan.mjs";
import { placeCellCoins, unit, waveTimes } from "./placement.mjs";
import {
  ARENA_COINS,
  ARENA_COIN_SPACING_M,
  ARENA_REFILL_MS,
  CELL_COINS,
  COIN_TIER,
  MAP_REWARDS_POLICY,
  PIONEER_COIN_TIER,
  PIONEER_MULT,
  WAVES,
} from "./policy.mjs";
import { ensureMapRewardsSchema } from "./schema.mjs";
import { organicRing } from "../spatial/organic-shape.mjs";

export const PIONEER_CHEST_XP = 80;

export function mapRewardsEnabled(env = process.env) {
  return env.MAP_REWARDS !== "off";
}
export function waveCount(env = process.env) {
  if (env.MAP_COIN_WAVES === "off") return 1;
  const n = Number(env.MAP_COIN_WAVES);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : WAVES.count;
}

const cellOf = (p) => latLngToCell(p.lat, p.lng, 7);

// Cell zones and pioneer chests are irregular blobs, not circles (Lubos,
// 11 Nov 2026); the spot seeds the shape, so it is the same on every read.
const circle = (p, radius, steps = 20) =>
  organicRing(p, radius, `${p.lat},${p.lng}:${radius}`, steps);

/** Promote 1-3 of the cell's POI quests to funded cell zones. Returns zone ids. */
function promoteCellZones(db, world, cell, count, zonesU, seed, firstToday = true) {
  if (count < 1) return [];
  const reviewed = !!world.cityId && world.cityStatus !== "auto";
  if (reviewed) return fundReviewedZones(db, world, cell, count, zonesU, seed, firstToday);
  const candidates = (world.zones || [])
    .filter(
      (z) =>
        z.source === "poi" &&
        !z.cellZone &&
        // A Tier 3 place stays locked; its prize would sit out of reach.
        (z.tier || 1) === 1 &&
        Number.isFinite(z.lat) &&
        cellOf(z) === cell,
    )
    .sort((a, b) => unit(seed, `zone:${a.id}`) - unit(seed, `zone:${b.id}`))
    .slice(0, count);
  if (!candidates.length) return [];
  const prize = Math.floor(Math.max(0, zonesU) / candidates.length);
  for (const z of candidates) {
    z.cellZone = true;
    z.kind = "expedition";
    z.color = "#c29222";
    z.geometry =
      z.geometry?.type === "Polygon"
        ? { type: "Polygon", coordinates: [circle(z, 70)] }
        : z.geometry;
    const q = db
      .prepare(
        "SELECT id,metadata,kind FROM quests WHERE zone_id=? AND claimant IS NULL",
      )
      .get(z.id);
    if (!q || prize <= 0) continue;
    const meta = JSON.parse(q.metadata || "{}");
    if (meta.activity)
      meta.activity.rewardConstraint = `Personal XP for everyone who finishes; the first explorer also takes ${prize.toLocaleString("en-US")} QGOLD from this area's daily budget.`;
    meta.cellZone = { policy: MAP_REWARDS_POLICY, cell, prizeU: prize };
    db.prepare("UPDATE quests SET gold_u=?,metadata=? WHERE id=?").run(
      prize,
      JSON.stringify(meta),
      q.id,
    );
    z.prizeU = prize;
  }
  return candidates.map((z) => z.id);
}

/**
 * Plzeň keeps its six reviewed city zones (no POI cell zones there), and
 * their prizes come from the same daily zone budget as every cell zone
 * (owner, 13 Nov 2026: every prize the game shows is paid out on chain).
 * The cell's zone budget is split over up to `count` reviewed zones in the
 * cell, Tier 3 first; only the first world that opens the cell today funds
 * them, so the GPS city and the demo never spend the same budget twice.
 */
function fundReviewedZones(db, world, cell, count, zonesU, seed, firstToday) {
  if (!firstToday || zonesU <= 0) return [];
  const candidates = (world.zones || [])
    .filter((z) => z.source !== "poi" && z.source !== "pioneer" && !z.cellZone && Number.isFinite(z.lat) && cellOf(z) === cell)
    .sort((a, b) => (b.tier || 1) - (a.tier || 1) || unit(seed, `zone:${a.id}`) - unit(seed, `zone:${b.id}`))
    .slice(0, count);
  if (!candidates.length) return [];
  const prize = Math.floor(zonesU / candidates.length);
  if (prize <= 0) return [];
  const funded = [];
  for (const z of candidates) {
    const q = db
      .prepare("SELECT id,metadata FROM quests WHERE zone_id=? AND claimant IS NULL ORDER BY id LIMIT 1")
      .get(z.id);
    if (!q) continue;
    const meta = JSON.parse(q.metadata || "{}");
    if (meta.activity)
      meta.activity.rewardConstraint = `Personal XP for everyone who finishes; the first explorer also takes ${prize.toLocaleString("en-US")} QGOLD from this area's daily budget.`;
    meta.cellZone = { policy: MAP_REWARDS_POLICY, cell, prizeU: prize, reviewed: true };
    db.prepare("UPDATE quests SET gold_u=?,metadata=? WHERE id=?").run(prize, JSON.stringify(meta), q.id);
    z.prizeU = prize;
    funded.push(z.id);
  }
  return funded;
}

function chestActivity(spot) {
  const activity = poiQuestActivity(
    "cosmetic-chest",
    [{ lat: spot.lat, lng: spot.lng }],
    {
      objective: "Reach the pioneer chest and open it.",
      policy: MAP_REWARDS_POLICY,
    },
  );
  activity.rewardConstraint =
    "Personal XP once and a cosmetic Aura. Coins in this area are worth double today.";
  return activity;
}

/** A pioneer chest on the path spot farthest from today's other targets. */
function pioneerChest(db, world, cell, samples, now, seed) {
  if (!samples.length) return null;
  const others = (world.zones || []).filter((z) => Number.isFinite(z.lat));
  const spot = [...samples]
    .map((p, i) => ({
      p,
      d: Math.min(...others.map((z) => distance(z, p)), 1e9),
      k: unit(seed, `chest:${i}`),
    }))
    .sort((a, b) => b.d - a.d || a.k - b.k)[0].p;
  const zoneId = `${world.id}:zone:pioneer-${cell}`,
    questId = `${world.id}:quest:pioneer-${cell}:0`;
  const zone = {
    id: zoneId,
    slot: 900 + Object.keys(world.mapRewards?.cells || {}).length,
    name: "Pioneer chest",
    tier: 1,
    lat: spot.lat,
    lng: spot.lng,
    radius: 0,
    geometry: { type: "Polygon", coordinates: [circle(spot, 40)] },
    targets: [{ lat: spot.lat, lng: spot.lng }],
    kind: "discovery",
    sector: null,
    source: "pioneer",
    sourceId: `pioneer:${cell}`,
    opensAt: now,
    closesAt: world.endsAt,
    color: "#e0b43a",
  };
  db.prepare(
    "INSERT OR IGNORE INTO quests(id,world_id,title,description,lat,lng,tier,gold_u,xp,kind,opens_at,closes_at,zone_id,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    questId,
    world.id,
    "Pioneer chest",
    "Nobody has explored this area for a month. Reach the chest first and open it: XP for every pioneer today and a cosmetic Aura.",
    spot.lat,
    spot.lng,
    1,
    0,
    PIONEER_CHEST_XP,
    "chest",
    now,
    world.endsAt,
    zoneId,
    JSON.stringify({
      zoneId,
      checkpoints: [],
      pioneer: { policy: MAP_REWARDS_POLICY, cell },
      activity: chestActivity(spot),
    }),
  );
  return zone;
}

/**
 * Drop the cell's rewards into a world once. `samples` is an async function
 * returning path points of the cell (or null when the map is unavailable,
 * which leaves the cell for a later load). Returns the updated manifest.
 */
export async function materializeCellRewards(
  db,
  world,
  { cell, samples, now = Date.now() } = {},
) {
  if (!world?.mapRewards || !mapRewardsEnabled() || now >= world.endsAt)
    return world;
  if (!cell || !isValidCell(cell) || getResolution(cell) !== 7) return world;
  ensureMapRewardsSchema(db);
  if (world.mapRewards.cells?.[cell]) return world;
  if (
    db
      .prepare("SELECT 1 FROM daily_jobs WHERE job_key=?")
      .get(`expire:${world.id}`)
  )
    return world;
  if (
    db
      .prepare("SELECT 1 FROM map_cell_drops WHERE world_id=? AND cell=?")
      .get(world.id, cell)
  ) {
    const row = db
      .prepare("SELECT manifest FROM worlds WHERE id=?")
      .get(world.id);
    return row ? JSON.parse(row.manifest) : world;
  }
  const inPlan = isCzechiaCell(cell);
  // A street cell outside the Czech day plan draws backed coins from the
  // day's unplaced coin budget (worldCoinCount); it needs payouts to be paid.
  const abroad = !inPlan && !world.arena && worldCoinsEnabled();
  const plan = inPlan || abroad ? ensureDayPlan(db, now) : null;
  const points = await samples();
  if (!Array.isArray(points)) return world;
  const inCell = points.filter((p) => cellOf(p) === cell);
  return atomic(db, () => {
    const row = db
      .prepare("SELECT manifest FROM worlds WHERE id=?")
      .get(world.id);
    if (!row) return world;
    const current = JSON.parse(row.manifest);
    if (
      current.mapRewards?.cells?.[cell] ||
      db
        .prepare("SELECT 1 FROM map_cell_drops WHERE world_id=? AND cell=?")
        .get(world.id, cell) ||
      db
        .prepare("SELECT 1 FROM daily_jobs WHERE job_key=?")
        .get(`expire:${current.id}`)
    )
      return current;
    const day = plan?.day || current.day;
    const leaf = plan && inPlan ? readCell(db, plan.day, cell) : null;
    const seed = plan
      ? cellSeed(plan.seed, cell)
      : cellSeed(`outside|${current.day}`, cell);
    // The first world to open a pioneer cell today doubles its coins.
    const firstToday = !db
      .prepare("SELECT 1 FROM map_cell_drops WHERE day=? AND cell=?")
      .get(day, cell);
    const pioneer = !!leaf?.pioneer && firstToday && !current.arena;
    // Backed coins only: a cell outside the plan gets none. The city demo
    // behaves like the real map (only movement differs): its coins carry the
    // same backed value and are paid in QGOLD, at a fixed count per cell.
    const worldCoins = abroad && plan ? worldCoinCount(db, plan) : 0;
    const valueU =
      leaf || worldCoins || (current.arena && plan)
        ? (plan.summary.coinValueU || 0) * (pioneer ? PIONEER_MULT : 1)
        : 0;
    // CELL_COINS per opened street cell, ARENA_COINS in the Plzeň city demo,
    // and never more than the day's coin budget still unplaced (coinRoom).
    const want = current.arena ? ARENA_COINS : leaf?.coins || worldCoins;
    const count =
      valueU > 0 ? Math.min(want, coinRoom(db, plan, valueU)) : current.arena ? want : 0;
    // Zones first, so coins gather around them.
    const zoneIds = promoteCellZones(
      db,
      current,
      cell,
      leaf?.zones ?? 0,
      leaf?.zonesU || 0,
      seed,
      firstToday,
    );
    const extra = [];
    if (pioneer) {
      const chest = pioneerChest(db, current, cell, inCell, now, seed);
      if (chest) extra.push(chest);
    }
    const zones = [...(current.zones || []), ...extra].filter(
      (z) =>
        Number.isFinite(z.lat) &&
        cellOf(z) === cell &&
        (z.cellZone || z.source !== "poi" || z.kind === "expedition"),
    );
    const waves = current.arena ? 1 : waveCount(),
      times = waveTimes(current.day, current.timezone || MAP_TIMEZONE, seed, {
        count: waves,
      });
    // The city demo fills its coins outwards from the start (arenaStart),
    // 60-100 m apart, so a new explorer finds them round the square.
    const { coins, spentU } = placeCellCoins({
      samples: inCell,
      zones,
      seed,
      count,
      valueU,
      tier: pioneer ? PIONEER_COIN_TIER : COIN_TIER,
      waves,
      ...(current.arena
        ? { spacing: ARENA_COIN_SPACING_M, origin: arenaStart(current) }
        : {}),
    });
    const pioneerU = pioneer ? spentU - spentU / PIONEER_MULT : 0;
    const base = db
      .prepare("SELECT COUNT(*) n FROM coins WHERE world_id=?")
      .get(current.id).n;
    const insertCoin = db.prepare(
        "INSERT INTO coins(id,world_id,lat,lng,value_u) VALUES(?,?,?,?,?)",
      ),
      insertMeta = db.prepare("INSERT INTO map_coin_meta VALUES(?,?,?,?,?,?)");
    for (const c of coins) {
      const id = `${current.id}:coin:${base + c.i}`;
      insertCoin.run(id, current.id, c.lat, c.lng, c.valueU);
      insertMeta.run(
        id,
        current.id,
        cell,
        c.tier,
        c.wave,
        times[c.wave] ?? times[0],
      );
    }
    db.prepare("INSERT INTO map_cell_drops VALUES(?,?,?,?,?,?,?,?,?)").run(
      current.id,
      cell,
      day,
      coins.length,
      spentU,
      zoneIds.length ? leaf?.zonesU || 0 : 0,
      pioneerU,
      pioneer ? 1 : 0,
      now,
    );
    if (!current.arena)
      db.prepare(
        "INSERT INTO map_cell_visits VALUES(?,?,?,1) ON CONFLICT(cell) DO UPDATE SET last_day=excluded.last_day,visits=visits+1",
      ).run(cell, day, day);
    current.zones = [...(current.zones || []), ...extra];
    current.mapRewards = {
      ...current.mapRewards,
      cells: {
        ...(current.mapRewards.cells || {}),
        [cell]: {
          coins: coins.length,
          valueU: spentU,
          pioneer,
          zones: zoneIds.length,
          waves: times,
        },
      },
    };
    db.prepare("UPDATE worlds SET manifest=? WHERE id=?").run(
      JSON.stringify(current),
      current.id,
    );
    return current;
  });
}

/** Where a city demo explorer starts: the compact demo centre, else the city centre. */
export function arenaStart(world) {
  const start = world?.demoZones?.center || world?.center;
  return Number.isFinite(start?.lat) && Number.isFinite(start?.lng) ? start : null;
}

const round7 = (x) => Number(x.toFixed(7));
const spotKey = (p) => `${p.lat},${p.lng}`;
const refillCheckedAt = new WeakMap();

/**
 * City demo refill (docs/MAP-REWARDS.md "City demo"): ARENA_REFILL_MS after a
 * coin is picked up, a fresh coin of the same value appears at its spot while
 * the day's coin budget has room (coinRoom). The new coin is a new row with a
 * new id, nudged 1e-7 degrees north so it is a spot of its own for
 * coin-spots.mjs; the claimed row keeps its claimant, because payouts use the
 * coin id. Its value is added to the cell's drop, so the day budget holds.
 * Checks a world at most once a minute. Returns the number of new coins.
 */
export function refillArenaCoins(db, world, now = Date.now()) {
  if (!world?.arena || !world.mapRewards || !mapRewardsEnabled()) return 0;
  if (!(now < world.endsAt)) return 0;
  let seen = refillCheckedAt.get(db);
  if (!seen) refillCheckedAt.set(db, (seen = new Map()));
  if (Math.abs(now - (seen.get(world.id) ?? -Infinity)) < 60_000) return 0;
  seen.set(world.id, now);
  ensureMapRewardsSchema(db);
  return atomic(db, () => {
    const due = db
      .prepare(
        `SELECT c.id,c.lat,c.lng,c.value_u,m.cell,m.tier,d.day FROM coins c
         JOIN map_coin_meta m ON m.coin_id=c.id
         JOIN map_cell_drops d ON d.world_id=m.world_id AND d.cell=m.cell
         WHERE c.world_id=? AND c.claimant IS NOT NULL AND c.claimed_at<=? AND c.value_u>0
         ORDER BY c.claimed_at,c.id`,
      )
      .all(world.id, now - ARENA_REFILL_MS);
    if (!due.length) return 0;
    const spots = new Set(
      db
        .prepare("SELECT lat,lng FROM coins WHERE world_id=?")
        .all(world.id)
        .map(spotKey),
    );
    const plans = new Map(),
      planOf = (day) => {
        if (!plans.has(day)) plans.set(day, readDay(db, day));
        return plans.get(day);
      };
    let next = db
      .prepare("SELECT COUNT(*) n FROM coins WHERE world_id=?")
      .get(world.id).n;
    const insertCoin = db.prepare(
        "INSERT INTO coins(id,world_id,lat,lng,value_u) VALUES(?,?,?,?,?)",
      ),
      insertMeta = db.prepare("INSERT INTO map_coin_meta VALUES(?,?,?,?,?,?)"),
      addToDrop = db.prepare(
        "UPDATE map_cell_drops SET coins=coins+1,coins_u=coins_u+? WHERE world_id=? AND cell=?",
      );
    let added = 0;
    for (const c of due) {
      const spot = { lat: round7(c.lat + 1e-7), lng: c.lng };
      if (spots.has(spotKey(spot))) continue; // already refilled
      if (coinRoom(db, planOf(c.day), c.value_u) < 1) continue;
      const id = `${world.id}:coin:${next++}`;
      insertCoin.run(id, world.id, spot.lat, spot.lng, c.value_u);
      insertMeta.run(id, world.id, c.cell, c.tier, 0, now);
      addToDrop.run(c.value_u, world.id, c.cell);
      spots.add(spotKey(spot));
      added++;
    }
    return added;
  });
}

/**
 * Backed coins outside the Czech day plan (docs/MAP-REWARDS.md, "Outside
 * Czechia"): every street cell elsewhere gets up to CELL_COINS coins of the
 * day's coin value from the same day budget as Czech cells, until that
 * budget is placed. MAP_WORLD_COINS=off turns it off; it needs MAP_PAYOUTS.
 */
export function worldCoinsEnabled(env = process.env) {
  return env.MAP_WORLD_COINS !== "off" && payoutsEnabled(env);
}
export function worldCoinCount(db, plan) {
  const valueU = plan?.summary?.coinValueU || 0;
  return valueU > 0 ? Math.min(CELL_COINS, coinRoom(db, plan, valueU)) : 0;
}

/**
 * Coins of `valueU` that still fit in the day's coin budget: the budget
 * (summary.unplacedU.coins) minus every coin already placed today in any
 * world, the city demo and pioneer doubles included. Runs inside the
 * placement transaction, so two worlds cannot place the same budget.
 */
export function coinRoom(db, plan, valueU) {
  const budgetU = plan?.summary?.unplacedU?.coins || 0;
  if (valueU <= 0 || budgetU <= 0) return 0;
  const placedU =
    db
      .prepare("SELECT COALESCE(SUM(coins_u),0) n FROM map_cell_drops WHERE day=?")
      .get(plan.day)?.n || 0;
  return Math.max(0, Math.floor((budgetU - placedU) / valueU));
}

/** Coin ids of a world whose wave has not opened yet at `now`. */
export function hiddenCoinIds(db, worldId, now) {
  try {
    return new Set(
      db
        .prepare(
          "SELECT coin_id FROM map_coin_meta WHERE world_id=? AND opens_at>?",
        )
        .all(worldId, now)
        .map((r) => r.coin_id),
    );
  } catch {
    return new Set();
  }
}
export function coinMeta(db, coinId) {
  try {
    return (
      db
        .prepare(
          "SELECT tier,wave,opens_at opensAt,cell FROM map_coin_meta WHERE coin_id=?",
        )
        .get(coinId) || null
    );
  } catch {
    return null;
  }
}
export function coinTiers(db, worldId) {
  try {
    return new Map(
      db
        .prepare("SELECT coin_id,tier FROM map_coin_meta WHERE world_id=?")
        .all(worldId)
        .map((r) => [r.coin_id, r.tier]),
    );
  } catch {
    return new Map();
  }
}

/** Next wave opening time of a world after `now`, or null. */
export function nextWave(world, now) {
  const times = Object.values(world?.mapRewards?.cells || {}).flatMap(
    (c) => c.waves || [],
  );
  const next = times.filter((t) => t > now).sort((a, b) => a - b)[0];
  return next ?? null;
}

// ---------------------------------------------------------------------------
// Public read model: coin counts and value per area, heatmap.

const MAX_CELLS = 900;
// A day's planned cells never change once stored: keep one day in memory.
const planned = new WeakMap();
function dayCells(db, day) {
  const hit = planned.get(db);
  if (hit?.day === day) return hit.rows;
  const rows = db
    .prepare("SELECT * FROM map_reward_cells WHERE day=?")
    .all(day);
  planned.set(db, { day, rows });
  return rows;
}
const centers = new Map();
const center = (cell) => {
  let c = centers.get(cell);
  if (!c) centers.set(cell, (c = cellToLatLng(cell)));
  return c;
};

/**
 * Cells in a bounding box with today's planned and live numbers. At low zoom
 * (res 5 / 4) the cells are summed into their parents for a heatmap.
 */
export function mapRewardsView(db, { bounds, res = 7, now = Date.now() } = {}) {
  ensureMapRewardsSchema(db);
  const plan = ensureDayPlan(db, now);
  const [w, s, e, n] = bounds;
  const rows = dayCells(db, plan.day).filter((r) => {
    const [lat, lng] = center(r.cell);
    return lat >= s && lat <= n && lng >= w && lng <= e;
  });
  const drops = new Map(
    db
      .prepare(
        "SELECT cell,SUM(coins) coins,SUM(coins_u) coins_u,MAX(pioneer) pioneer FROM map_cell_drops WHERE day=? GROUP BY cell",
      )
      .all(plan.day)
      .map((r) => [r.cell, r]),
  );
  const left = new Map(
    db
      .prepare(
        "SELECT m.cell,COUNT(*) n,SUM(c.value_u) v FROM map_coin_meta m JOIN coins c ON c.id=m.coin_id JOIN map_cell_drops d ON d.world_id=m.world_id AND d.cell=m.cell WHERE d.day=? AND c.claimant IS NULL GROUP BY m.cell",
      )
      .all(plan.day)
      .map((r) => [r.cell, r]),
  );
  const visited = new Set(
    db
      .prepare("SELECT cell FROM map_cell_visits WHERE last_day>=?")
      .all(shiftDate(plan.day, -30))
      .map((r) => r.cell),
  );
  let cells = rows.map((r) => {
    const d = drops.get(r.cell),
      l = left.get(r.cell);
    return {
      cell: r.cell,
      coins: d ? l?.n || 0 : r.coins,
      valueU: d ? l?.v || 0 : r.coins_u,
      zones: r.zones,
      zoneValueU: r.zones_u,
      pioneer: !!r.pioneer && !visited.has(r.cell),
      opened: !!d,
    };
  });
  if (res < 7) {
    const parents = new Map();
    for (const c of cells) {
      const p = cellToParent(c.cell, res);
      const agg = parents.get(p) || {
        cell: p,
        coins: 0,
        valueU: 0,
        zones: 0,
        zoneValueU: 0,
        pioneer: 0,
        opened: 0,
        cells: 0,
      };
      agg.coins += c.coins;
      agg.valueU += c.valueU;
      agg.zones += c.zones;
      agg.zoneValueU += c.zoneValueU;
      agg.pioneer += c.pioneer ? 1 : 0;
      agg.opened += c.opened ? 1 : 0;
      agg.cells++;
      parents.set(p, agg);
    }
    cells = [...parents.values()];
  }
  cells = cells.sort((a, b) => b.valueU - a.valueU).slice(0, MAX_CELLS);
  return {
    policy: MAP_REWARDS_POLICY,
    day: plan.day,
    root: plan.root,
    res,
    currency: "qgold",
    coinValueU: plan.summary.coinValueU || 0,
    totals: {
      coinsU: plan.coinsU,
      zonesU: plan.zonesU,
      pioneerU: plan.pioneerU,
      pioneerLeftU: plan.pioneerLeftU,
    },
    components: plan.summary.components,
    cells: cells.map((c) => {
      const [lat, lng] = cellToLatLng(c.cell);
      return {
        ...c,
        center: [Number(lng.toFixed(5)), Number(lat.toFixed(5))],
        boundary: cellToBoundary(c.cell, true),
      };
    }),
  };
}

export function mapRewardsDay(db, now = Date.now()) {
  const plan = ensureDayPlan(db, now);
  return {
    ...plan,
    policy: MAP_REWARDS_POLICY,
    chain: mapChainEnabled() ? mapChainStatus(db, plan.day) : null,
  };
}
export { cellProof, readDay };

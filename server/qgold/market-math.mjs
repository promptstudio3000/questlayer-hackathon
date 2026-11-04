// QGOLD market math (docs/QGOLD-MARKET.md). Pure BigInt functions only: no IO,
// no floats on amounts. Units:
//   - NEAR amounts are yoctoNEAR (10^24 per NEAR),
//   - QGOLD amounts are base units (10^6 per QGOLD, decimals = 6),
//   - prices and the backing rate R are yoctoNEAR per one whole QGOLD.
import { createHash } from "node:crypto";

export const YOCTO = 10n ** 24n;
export const QGOLD_DECIMALS = 6;
export const QGOLD_ONE = 10n ** 6n;
/** Initial backing rate: 0.001 NEAR per QGOLD (1 NEAR = 1,000 GOLD). */
export const INITIAL_RATE = 10n ** 21n;
const BPS = 10000n;

export const POLICY = Object.freeze({
  depositFeeBps: 100, // buy at R + 1 %
  redeemFeeBps: 100, // sell at R − 1 %
  ladderBps: [11000, 12000, 13000], // Intents asks at 1.1 / 1.2 / 1.3 R
  ladderRungSupplyBps: 50, // each rung offers 0.5 % of supply
  salesPerDay: 12,
  saleFloorBps: 11000, // never sell below 1.1 R
  maxDailySaleSupplyBps: 200, // all sales together ≤ 2 % of supply a day
  buybackFeeBps: 2000, // 20 % of fees fund buyback-and-burn
  inverseDailyPoolBps: 500, // inverse buys spend ≤ 5 % of the pool's NEAR a day
  minPoolNear: 500n * YOCTO, // keeper is off below ~500 NEAR of pool liquidity
  poolFeeBps: 30,
});

const big = (v) => {
  try {
    const b = BigInt(String(v ?? "0"));
    return b < 0n ? 0n : b;
  } catch {
    return 0n;
  }
};
const min = (...xs) => xs.reduce((a, b) => (b < a ? b : a));
const max = (...xs) => xs.reduce((a, b) => (b > a ? b : a));

/** Integer square root (floor) of a non-negative BigInt. */
export function isqrt(n) {
  if (n < 0n) throw RangeError("negative");
  if (n < 2n) return n;
  // Newton's method from a power-of-two start above the root.
  let x = 1n << (BigInt(n.toString(2).length + 1) >> 1n);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

/** R = backing NEAR / supply, as yocto per whole QGOLD. Empty supply → initial R. */
export function backingRate({ backing, supply }) {
  const s = big(supply);
  if (s === 0n) return INITIAL_RATE;
  return (big(backing) * QGOLD_ONE) / s;
}

/** Buying from the vault: price R + 1 %. Rounds in the vault's favour. */
export function depositQuote(nearIn, rate, feeBps = POLICY.depositFeeBps) {
  const near = big(nearIn),
    r = big(rate);
  if (near === 0n || r === 0n) return { qgold: "0", fee: "0", backing: "0", price: r.toString() };
  const price = (r * (BPS + BigInt(feeBps))) / BPS;
  const qgold = (near * QGOLD_ONE) / price;
  const backing = (qgold * r) / QGOLD_ONE;
  return {
    qgold: qgold.toString(),
    backing: backing.toString(),
    fee: (near - backing).toString(),
    price: price.toString(),
  };
}

/** Selling to the vault: R − 1 %. */
export function redeemQuote(qgoldIn, rate, feeBps = POLICY.redeemFeeBps) {
  const q = big(qgoldIn),
    r = big(rate);
  const gross = (q * r) / QGOLD_ONE;
  const fee = (gross * BigInt(feeBps) + BPS - 1n) / BPS;
  return { near: (gross - fee).toString(), fee: fee.toString(), gross: gross.toString() };
}

/** Spot price of a constant-product pool, yocto per whole QGOLD. */
export function poolPrice({ near, qgold }) {
  const x = big(near),
    y = big(qgold);
  return y === 0n ? 0n : (x * QGOLD_ONE) / y;
}

/** QGOLD out for NEAR in (Rhea simple pool, fee in bps of the input). */
export function swapNearIn(pool, nearIn, feeBps = POLICY.poolFeeBps) {
  const x = big(pool.near),
    y = big(pool.qgold),
    dx = (big(nearIn) * (BPS - BigInt(feeBps))) / BPS;
  if (x === 0n || y === 0n || dx === 0n) return 0n;
  return (y * dx) / (x + dx);
}

/** NEAR out for QGOLD in. */
export function swapQgoldIn(pool, qgoldIn, feeBps = POLICY.poolFeeBps) {
  const x = big(pool.near),
    y = big(pool.qgold),
    dy = (big(qgoldIn) * (BPS - BigInt(feeBps))) / BPS;
  if (x === 0n || y === 0n || dy === 0n) return 0n;
  return (x * dy) / (y + dy);
}

/** QGOLD to sell into the pool so its spot price falls to `target` (fee ignored). */
export function qgoldToReachPrice(pool, target) {
  const x = big(pool.near),
    y = big(pool.qgold),
    p = big(target);
  if (x === 0n || y === 0n || p === 0n || poolPrice(pool) <= p) return 0n;
  // P' = x'·ONE / y' with x'·y' = k  ⇒  y' = sqrt(k·ONE / P')
  const yNew = isqrt((x * y * QGOLD_ONE) / p);
  return yNew > y ? yNew - y : 0n;
}

/** NEAR to buy with so the pool's spot price rises to `target` (fee ignored). */
export function nearToReachPrice(pool, target) {
  const x = big(pool.near),
    y = big(pool.qgold),
    p = big(target);
  if (x === 0n || y === 0n || p === 0n || poolPrice(pool) >= p) return 0n;
  // x' = sqrt(k·P' / ONE)
  const xNew = isqrt((x * y * p) / QGOLD_ONE);
  return xNew > x ? xNew - x : 0n;
}

/** Intents ask ladder: one sell order per rung, each a slice of supply. */
export function askLadder({ rate, supply, soldToday = 0n, policy = POLICY }) {
  const r = big(rate),
    s = big(supply);
  let left = (s * BigInt(policy.maxDailySaleSupplyBps)) / BPS - big(soldToday);
  const rung = (s * BigInt(policy.ladderRungSupplyBps)) / BPS;
  return policy.ladderBps.map((bps) => {
    const amount = left > 0n ? min(rung, left) : 0n;
    left -= amount;
    return {
      multiple: Number(bps) / 10000,
      price: ((r * BigInt(bps)) / BPS).toString(),
      amount: amount.toString(),
    };
  });
}

/**
 * One scheduled sale. "Each sale sells 1/12 of half the gap above 1.1 R":
 * the reference price is the lower of spot and the 24 h average (so a short
 * pump does not trigger a big sale), the gap is ref − 1.1 R, and the sale
 * pushes spot down by gap / (2 · salesPerDay), never below 1.1 R, within the
 * daily 2 % of supply.
 */
export function saleAmount({ pool, rate, supply, avgPrice24h, soldToday = 0n, policy = POLICY }) {
  const r = big(rate),
    spot = poolPrice(pool);
  const ref = min(spot, big(avgPrice24h) || spot);
  const floor = (r * BigInt(policy.saleFloorBps)) / BPS;
  if (ref <= floor) return { amount: 0n, reason: "price-at-or-below-1.1R", target: spot };
  const gap = ref - floor;
  const target = max(floor, spot - gap / (2n * BigInt(policy.salesPerDay)));
  const allowance = (big(supply) * BigInt(policy.maxDailySaleSupplyBps)) / BPS - big(soldToday);
  if (allowance <= 0n) return { amount: 0n, reason: "daily-cap-reached", target };
  const amount = min(qgoldToReachPrice(pool, target), allowance);
  return { amount, reason: amount > 0n ? "sell-gap" : "gap-too-small", target };
}

/** Inverse buy when P < R: NEAR to bring spot back to R, within today's budget. */
export function inverseBuy({ pool, rate, spentToday = 0n, budget, policy = POLICY }) {
  const r = big(rate);
  if (poolPrice(pool) >= r) return { near: 0n, reason: "price-at-or-above-R" };
  const daily = (big(pool.near) * BigInt(policy.inverseDailyPoolBps)) / BPS - big(spentToday);
  const cap = min(max(daily, 0n), big(budget));
  const near = min(nearToReachPrice(pool, r), cap);
  return { near, reason: near > 0n ? "buy-below-R" : "inverse-budget-empty" };
}

/** Buyback budget: 20 % of fees received, minus what buybacks already spent. */
export function buybackBudget({ feesTotal, spent, policy = POLICY }) {
  const b = (big(feesTotal) * BigInt(policy.buybackFeeBps)) / BPS - big(spent);
  return b > 0n ? b : 0n;
}

// ---- Commit-reveal of the 12 sale times -------------------------------------

const DAY_MS = 86_400_000;
const sha = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? Buffer.from(p) : p);
  return h.digest();
};

/** Public commitment for a day; the salt stays secret until the day is over. */
export function scheduleCommitment(day, saltHex) {
  assertDay(day);
  return sha("qgold-keeper-v1|", day, "|", Buffer.from(saltHex, "hex")).toString("hex");
}

/**
 * Sale times for a UTC day: one per 2 h slot (12 slots), at an offset from
 * sha256(salt ‖ NEAR block random seed ‖ day ‖ i). The keeper commits to the
 * salt before the seed block exists, so it cannot pick its times, and nobody
 * else knows them until they happen.
 */
export function saleTimes(day, saltHex, seed, count = POLICY.salesPerDay) {
  assertDay(day);
  const start = Date.parse(`${day}T00:00:00Z`),
    slot = DAY_MS / count;
  const salt = Buffer.from(saltHex, "hex");
  const seedBytes = Buffer.from(String(seed));
  return Array.from({ length: count }, (_, i) => {
    const h = sha(salt, seedBytes, day, String(i));
    const offset = Number(h.readBigUInt64BE(0) % BigInt(slot));
    return start + i * slot + offset;
  });
}

export function verifySchedule({ day, commitment, salt, seed, times }) {
  if (scheduleCommitment(day, salt) !== commitment) return false;
  const again = saleTimes(day, salt, seed, times.length);
  return again.every((t, i) => t === times[i]);
}

function assertDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Expected a YYYY-MM-DD day.");
}

/** Time-weighted average of price samples [{at, price}] over the last 24 h. */
export function average24h(samples, now) {
  const from = now - DAY_MS;
  const xs = samples.filter((s) => s.at >= from && s.at <= now).sort((a, b) => a.at - b.at);
  if (!xs.length) return 0n;
  if (xs.length === 1) return big(xs[0].price);
  let area = 0n,
    span = 0n;
  for (let i = 0; i < xs.length; i++) {
    const end = i + 1 < xs.length ? xs[i + 1].at : now;
    const dt = BigInt(Math.max(0, end - xs[i].at));
    area += big(xs[i].price) * dt;
    span += dt;
  }
  return span > 0n ? area / span : big(xs.at(-1).price);
}

/**
 * Keeper plan for one tick. Returns the actions it would take, in order, with
 * a reason for each one it skips. Pure: the runner decides whether to execute.
 */
export function keeperPlan({
  pool,
  rate,
  supply,
  avgPrice24h,
  soldToday = 0n,
  inverseSpentToday = 0n,
  inverseBudget = 0n,
  buyback = 0n,
  saleDue = false,
  policy = POLICY,
}) {
  const actions = [];
  const poolNear = big(pool?.near);
  if (!pool || poolNear < big(policy.minPoolNear))
    return {
      active: false,
      reason: "pool-below-minimum",
      actions,
      spot: pool ? poolPrice(pool).toString() : null,
    };
  const r = big(rate),
    spot = poolPrice(pool);
  if (spot < r) {
    const inv = inverseBuy({ pool, rate: r, spentToday: inverseSpentToday, budget: inverseBudget, policy });
    if (inv.near > 0n) actions.push({ kind: "inverse-buy-burn", near: inv.near.toString(), reason: inv.reason });
  }
  // Buyback and burn only while the pool is under the 1.1 R sale floor, so the
  // keeper never buys and sells on the same day.
  const floor = (r * BigInt(policy.saleFloorBps)) / BPS;
  const bb = big(buyback);
  if (bb > 0n && spot < floor) {
    const needed = nearToReachPrice(pool, floor);
    const near = needed > 0n ? min(bb, needed) : 0n;
    if (near > 0n) actions.push({ kind: "buyback-burn", near: near.toString(), reason: "fees-20pct" });
  }
  if (saleDue) {
    const sale = saleAmount({ pool, rate: r, supply, avgPrice24h, soldToday, policy });
    actions.push(
      sale.amount > 0n
        ? { kind: "sale", qgold: sale.amount.toString(), target: sale.target.toString(), reason: sale.reason }
        : { kind: "sale-skipped", reason: sale.reason },
    );
  }
  return { active: true, reason: null, actions, spot: spot.toString() };
}

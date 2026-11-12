// NPC trader pricing (N3, docs/NPC-PLAN.md §2.2). Pure and deterministic: no
// clock, database or chain access, so every rule is unit-tested.
//
// Owner decision (1 Nov 2026): each trader starts with a 2 test NEAR float that
// must grow, and every trade favours the game treasury.
//   - Margin floor: never sell below cost basis × 1.10, and only pay a buy
//     premium when the expected resale value still leaves ≥ 10 % margin.
//   - Self-funding premiums: the daily premium budget is 50 % of realized
//     profit over the last 7 days, plus 0.1 test NEAR/day during the first
//     week. A trader with a 7-day loss pays no premiums and only sells.
//   - Sweep: credit above float + buffer goes to rewards fund_rewards("sponsor").
// All amounts are yoctoNEAR as BigInt.
import { hash } from "../domain.mjs";
import { AURA_CATALOG, AURA_CHAIN_CAPPED } from "../aura-catalog.mjs";

export const NPC_TRADER_POLICY = "npc-trader-v1";
export const YOCTO = 10n ** 24n;
export const MILLI = 10n ** 21n; // 0.001 NEAR, the market's minimum price
export const FLOAT = 2n * YOCTO;
export const SWEEP_BUFFER = YOCTO / 4n; // keep 0.25 NEAR above the float
export const SEED_PER_DAY = YOCTO / 10n;
export const SEED_DAYS = 7;
export const PROFIT_SHARE_BPS = 5000n; // 50 % of 7-day realized profit
export const MARGIN_BPS = 11000n; // cost × 1.10
export const PREMIUM_BPS = 11500n; // floor × 1.15
export const DISCOUNT_BPS = 9000n; // floor × 0.90
export const QUICK_SALE_BPS = 8000n; // what a quick local sale fetches without an order book
export const TRADEUP_COMMONS = 3;
export const MAX_TRADES_PER_PLAYER_DAY = 3; // per trader; the 4th is refused
export const MAX_TRADES_PER_TRADER_DAY = 24;
export const BUY_TTL_MS = 10 * 60_000;
export const SELL_TTL_MS = 3 * 60_000;
export const WANTED_PER_DAY = 2;
export const LEDGER_TRADES_FOR_AURA = 10; // Merchant's Ledger edition

// Patron trader rates (docs/GAME-LOOPS.md P1-5, owner decision 1 Nov 2026):
// gated by stake tier only (Tier 2+), never by level. Every patron rate still
// sits inside the margin floor, so the float keeps growing:
//   - sales from stock at market × 0.85 instead of × 0.90, never below cost × 1.10;
//   - premium buys at market × 1.20 instead of × 1.15, never above resale / 1.10;
//   - a rare→epic trade-up table (3 rares for 1 epic, epic edition from game supply);
//   - the premium budget prefers patrons: non-patrons may spend only the first
//     half of a day's budget, the rest is held for patrons.
export const PATRON_TIER = 2;
export const PATRON_DISCOUNT_BPS = 8500n;
export const PATRON_PREMIUM_BPS = 12000n;
export const PATRON_BUDGET_RESERVE_BPS = 5000n; // share of the day's budget held for patrons
export const isPatron = (tier) => Number.isInteger(tier) && tier >= PATRON_TIER;
/** Trade-up tables: [given rarity, received rarity]; the epic table is patron-only. */
export const TRADEUP_TABLES = Object.freeze([
  Object.freeze({ give: "common", get: "rare", patron: false }),
  Object.freeze({ give: "rare", get: "epic", patron: true }),
]);

// Reference resale values per rarity (test NEAR). The trader can move stock to
// other places and days, so it values an Aura at least at this reference even
// when the local order book is thin.
export const REFERENCE = Object.freeze({
  common: 20n * MILLI,
  rare: 50n * MILLI,
  epic: 120n * MILLI,
  legendary: 300n * MILLI,
});

const bps = (value, points) => (value * points) / 10000n;
const roundDown = (v) => (v / MILLI) * MILLI; // whole 0.001 NEAR
const roundUp = (v) => ((v + MILLI - 1n) / MILLI) * MILLI;

/** Chest editions the trader deals in (NPC/monster editions are claim-only). */
export const TRADABLE = Object.freeze(
  AURA_CATALOG.filter((e) => e.native && e.source === "chest").map((e) => e.id),
);
export const editionOf = (tokenId) => /^aura:([a-z0-9-]{1,24}):\d{1,6}$/.exec(String(tokenId))?.[1] || null;
export const rarityOf = (edition) => AURA_CATALOG.find((e) => e.id === edition)?.rarity || null;
export const referenceValue = (edition) => REFERENCE[rarityOf(edition)] ?? null;

/**
 * Editions the keeper mints as starting stock: rare and epic chest editions,
 * because a common's reference (0.02) leaves no 10 % margin over the
 * ~0.02 NEAR it costs to mint and escrow one. The margin floor still applies
 * at sale time with the real measured cost.
 */
export const STOCK_EDITIONS = Object.freeze(TRADABLE.filter((e) => ["rare", "epic"].includes(rarityOf(e))));
export const STOCK_TARGET = 3; // Auras the trader keeps on its shelf in the verifier
export const STOCK_MINTS_PER_DAY = 3;
export const STOCK_DEPOSIT = 50n * MILLI; // attached to redeem_aura; the unused part is refunded
export const STOCK_COST_ESTIMATE = 25n * MILLI; // mint storage + gas + escrow gas, checked before minting
export const STOCK_RESERVE = YOCTO / 10n; // liquid NEAR a sweep leaves behind for restocking
// Never take a capped (old-build) edition past 200 of its 256 on-chain copies.
export const STOCK_EDITION_HEADROOM = AURA_CHAIN_CAPPED ? 200 : Infinity;

/** Least-stocked stock edition; ties rotate with the day's mint count. */
export function pickStockEdition(heldEditions, n = 0, editions = STOCK_EDITIONS) {
  const count = (e) => heldEditions.filter((x) => x === e).length;
  const order = editions.map((e, i) => ({ e, c: count(e), r: (i - n + editions.length * 8) % editions.length }));
  order.sort((a, b) => a.c - b.c || a.r - b.r);
  return order.find((o) => discountSellPrice(o.e, STOCK_COST_ESTIMATE))?.e || null;
}

/** 1–2 "wanted" editions per trader and day, derived from the day seed. */
export function wantedEditions(traderId, dayId, editions = TRADABLE) {
  return [...editions]
    .filter((e) => rarityOf(e) !== "legendary")
    .sort((a, b) => hash(`${traderId}|${dayId}|${a}`).localeCompare(hash(`${traderId}|${dayId}|${b}`)))
    .slice(0, WANTED_PER_DAY);
}

/** What the trader expects to resell an edition for: max(reference, local floor). */
export function resaleValue(edition, floor = null) {
  const ref = referenceValue(edition);
  if (ref == null) return null;
  return floor != null && floor > ref ? floor : ref;
}

/**
 * Premium buy price for a wanted edition, or null when the trader may not buy.
 * price = min(floor × 1.15, resale / 1.10), and it must be at least the local
 * floor (otherwise it is no premium) and the market minimum.
 */
export function premiumBuyPrice(edition, floor = null, { patron = false } = {}) {
  const resale = resaleValue(edition, floor);
  if (resale == null) return null;
  // Without local sell orders a player can only get a quick-sale price.
  const market = floor ?? bps(referenceValue(edition), QUICK_SALE_BPS);
  const cap = roundDown((resale * 10000n) / MARGIN_BPS);
  const offer = roundDown(bps(market, patron ? PATRON_PREMIUM_BPS : PREMIUM_BPS));
  const price = offer < cap ? offer : cap;
  if (price < MILLI || price < market) return null;
  return { price, premium: price - market, market, resale, patron: !!patron };
}

/**
 * Sell price for a lot: max(market × 0.90, cost × 1.10). Returned only when it
 * is at most the market price (never worse for the player than the open book)
 * and never below the margin floor. `discount` says whether it beats the book.
 */
export function discountSellPrice(edition, costBasis, floor = null, { patron = false } = {}) {
  const market = floor ?? referenceValue(edition);
  if (market == null) return null;
  const marginFloor = roundUp(bps(BigInt(costBasis), MARGIN_BPS));
  const discount = roundDown(bps(market, patron ? PATRON_DISCOUNT_BPS : DISCOUNT_BPS));
  const price = discount > marginFloor ? discount : marginFloor;
  if (price < MILLI || price > market) return null;
  return { price, market, marginFloor, discount: price < market, patron: !!patron };
}

/**
 * Premium budget a player may still use today. Patrons may use all of what is
 * left; others only what is left of the first (1 − reserve) share, so a
 * premium for a patron is still there late in the day.
 */
export function budgetLeftFor({ budget, spent }, { patron = false } = {}) {
  const b = BigInt(budget),
    s = BigInt(spent);
  const cap = patron ? b : b - bps(b, PATRON_BUDGET_RESERVE_BPS);
  return cap > s ? cap - s : 0n;
}

/** Daily premium budget from realized 7-day profit and the first-week seed. */
export function premiumBudget({ profit7d, daysActive }) {
  const p = BigInt(profit7d);
  if (p < 0n) return 0n;
  const seed = daysActive < SEED_DAYS ? SEED_PER_DAY : 0n;
  return bps(p, PROFIT_SHARE_BPS) + seed;
}

/** Credit above float + buffer that may be swept to the rewards contract. */
export function sweepableSurplus(credit, { float = FLOAT, buffer = SWEEP_BUFFER, reserved = 0n } = {}) {
  const free = BigInt(credit) - BigInt(reserved) - float - buffer;
  return free > MILLI ? roundDown(free) : 0n;
}

/** Profit of one closed lot (sale proceeds − cost basis). */
export const lotProfit = (lot) => BigInt(lot.sold_price ?? 0) - BigInt(lot.cost ?? 0);

export const formatNear = (yocto) => {
  const v = BigInt(yocto),
    sign = v < 0n ? "-" : "",
    a = v < 0n ? -v : v;
  return `${sign}${a / YOCTO}.${String((a % YOCTO) / MILLI).padStart(3, "0")}`;
};

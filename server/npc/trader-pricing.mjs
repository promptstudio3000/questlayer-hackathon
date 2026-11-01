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
import { AURA_CATALOG } from "../aura-catalog.mjs";

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
export function premiumBuyPrice(edition, floor = null) {
  const resale = resaleValue(edition, floor);
  if (resale == null) return null;
  // Without local sell orders a player can only get a quick-sale price.
  const market = floor ?? bps(referenceValue(edition), QUICK_SALE_BPS);
  const cap = roundDown((resale * 10000n) / MARGIN_BPS);
  const price = roundDown(bps(market, PREMIUM_BPS)) < cap ? roundDown(bps(market, PREMIUM_BPS)) : cap;
  if (price < MILLI || price < market) return null;
  return { price, premium: price - market, market, resale };
}

/**
 * Sell price for a lot: max(market × 0.90, cost × 1.10). Returned only when it
 * is at most the market price (never worse for the player than the open book)
 * and never below the margin floor. `discount` says whether it beats the book.
 */
export function discountSellPrice(edition, costBasis, floor = null) {
  const market = floor ?? referenceValue(edition);
  if (market == null) return null;
  const marginFloor = roundUp(bps(BigInt(costBasis), MARGIN_BPS));
  const discount = roundDown(bps(market, DISCOUNT_BPS));
  const price = discount > marginFloor ? discount : marginFloor;
  if (price < MILLI || price > market) return null;
  return { price, market, marginFloor, discount: price < market };
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

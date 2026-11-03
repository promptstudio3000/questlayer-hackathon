// Game treasury held in stNEAR (docs/STNEAR-TREASURY.md).
//
// The sponsor treasury (the operator wallet that funds reward days) keeps its
// capital as stNEAR from Meta Pool instead of plain NEAR. stNEAR grows against
// NEAR every epoch. Once a day the Mac worker sells only that growth with
// liquid_unstake and funds the rewards contract with it as a sponsor receipt
// labelled `stnear-yield-<date>`. The principal (NEAR deposited, in NEAR) is
// never sold, so the treasury cannot shrink below what was put in, apart
// from a price drop, which then simply means no harvest until it recovers.
//
// This module is pure planning plus read-only chain views. It never signs.
import { assert } from "../domain.mjs";

export const YOCTO = 10n ** 24n;
// Rewards contract charges this on every sponsor receipt (contracts/rewards).
export const SPONSOR_STORAGE_FEE = 5n * 10n ** 21n;
export const RECEIPT_PREFIX = "stnear-yield-";

export const TREASURY_TOKENS = {
  testnet: {
    contract: "meta-v2.pool.testnet",
    label: "stNEAR (Meta Pool testnet)",
    // The yield vault the operator also parks stNEAR in
    // (public/native-yield-vault-testnet.json). That stNEAR is still treasury
    // principal: without counting it the harvest sees a loss and never runs.
    vault: "questlayer-yield-20261102.testnet",
  },
  mainnet: { contract: "meta-pool.near", label: "stNEAR (Meta Pool)" },
};

const U128 = /^(0|[1-9]\d{0,38})$/;
const u128 = (v, what) => {
  assert(typeof v === "string" && U128.test(v), `Invalid ${what}.`, 503);
  return BigInt(v);
};

export function treasurySettings(env = process.env, network = "testnet") {
  const token = TREASURY_TOKENS[network];
  const near = (v, fallback) => {
    const n = Number(v);
    return (
      BigInt(Math.round((Number.isFinite(n) && n > 0 ? n : fallback) * 1e6)) *
      10n ** 18n
    );
  };
  return {
    network,
    contract: env.STNEAR_TREASURY_CONTRACT || token?.contract || null,
    account: env.STNEAR_TREASURY_ACCOUNT || null,
    // "off" disables counting stNEAR held in the yield vault.
    vault:
      env.STNEAR_TREASURY_VAULT === "off"
        ? null
        : env.STNEAR_TREASURY_VAULT || token?.vault || null,
    // Below this, growth waits for another day: the sponsor storage fee and
    // gas would otherwise eat a visible share of it.
    minHarvest: near(env.STNEAR_MIN_HARVEST_NEAR, 0.01),
    // Never sell growth when the instant-exit pool charges more than this.
    maxFeeBps: Math.min(
      500,
      Math.max(0, Number(env.STNEAR_MAX_FEE_BPS ?? 100) | 0),
    ),
    // A guard against a broken principal record: never sell more than this
    // share of the treasury in one harvest.
    maxHarvestBps: Math.min(
      1000,
      Math.max(1, Number(env.STNEAR_MAX_HARVEST_BPS ?? 200) | 0),
    ),
  };
}

/** NEAR value of a stNEAR balance at the protocol price (yocto per 1 stNEAR). */
export const valueOf = (balance, price) => (balance * price) / YOCTO;

/** stNEAR needed to be worth `near` at `price`, rounded down so we never oversell. */
export const sharesFor = (near, price) => (near * YOCTO) / price;

export function harvestReceiptId(date) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), "Harvest date must be YYYY-MM-DD.");
  return RECEIPT_PREFIX + date;
}

/**
 * Pure: decide today's harvest.
 *  balance    stNEAR held (yocto stNEAR)
 *  price      yocto NEAR per 1 stNEAR
 *  principal  NEAR put in and not yet taken out (yocto)
 *  parked     NEAR value of treasury stNEAR held in the yield vault (yocto).
 *             It counts toward value, but only wallet stNEAR can be sold.
 *  quote      (shares) => yocto NEAR the pool would pay right now, or null
 *             when the plan only needs the gross figures
 */
export function planHarvest({
  balance,
  price,
  principal,
  parked = 0n,
  quote = null,
  settings,
  harvested = [],
  date,
}) {
  for (const [k, v] of Object.entries({ balance, price, principal, parked }))
    assert(typeof v === "bigint" && v >= 0n, `Invalid ${k}.`);
  assert(price > 0n, "Invalid price.");
  const receiptId = harvestReceiptId(date);
  const value = valueOf(balance, price) + parked;
  const growth = value > principal ? value - principal : 0n;
  const base = { receiptId, value, principal, growth, price, balance, parked };
  if (harvested.includes(receiptId))
    return { ...base, action: "skip", reason: "already-harvested" };
  if (principal === 0n)
    return { ...base, action: "skip", reason: "no-principal" };
  if (growth < settings.minHarvest)
    return { ...base, action: "skip", reason: "growth-below-minimum" };
  if (growth * 10_000n > value * BigInt(settings.maxHarvestBps))
    return { ...base, action: "skip", reason: "growth-implausible" };
  const sell = sharesFor(growth, price);
  if (sell === 0n)
    return { ...base, action: "skip", reason: "growth-below-minimum" };
  if (sell > balance)
    return { ...base, action: "skip", reason: "growth-not-in-wallet", sell };
  if (quote == null) return { ...base, action: "harvest", sell };
  assert(typeof quote === "bigint" && quote >= 0n, "Invalid quote.");
  const gross = valueOf(sell, price);
  const feeBps =
    gross > 0n
      ? Number(((gross - (quote < gross ? quote : gross)) * 10_000n) / gross)
      : 0;
  if (feeBps > settings.maxFeeBps)
    return {
      ...base,
      action: "skip",
      reason: "exit-fee-too-high",
      sell,
      quote,
      feeBps,
    };
  // Accept up to 0.5 % slippage between the quote and execution.
  const minExpected = (quote * 9_950n) / 10_000n;
  if (minExpected < settings.minHarvest / 2n)
    return {
      ...base,
      action: "skip",
      reason: "growth-below-minimum",
      sell,
      quote,
      feeBps,
    };
  return { ...base, action: "harvest", sell, quote, feeBps, minExpected };
}

/** Attached deposit for fund_rewards: the yield plus the sponsor storage fee. */
export const fundingAttachment = (received) => received + SPONSOR_STORAGE_FEE;

async function view(provider, contract, method, args = {}) {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

/**
 * NEAR value of the account's stNEAR position in the yield vault. The vault
 * pays the NEAR value back in stNEAR and sends LST growth to its treasury,
 * so the position's `withdrawable` (yoctoNEAR) is what the treasury owns there.
 */
export async function readParked(provider, { contract, account, vault }) {
  if (!vault) return 0n;
  // A failed read counts nothing: that can only make the harvest skip, never oversell.
  const rows = await view(provider, vault, "get_position", {
    account_id: account,
  }).catch(() => null);
  const row = Array.isArray(rows)
    ? rows.find((r) => r?.token_id === contract && r?.kind === "lst")
    : null;
  return row ? u128(String(row.withdrawable ?? "0"), "vault position") : 0n;
}

/** Live read of the treasury position (wallet stNEAR plus any parked in the vault). */
export async function readTreasury(
  provider,
  { contract, account, vault = null },
) {
  assert(contract && account, "Treasury is not configured.", 503);
  const [balance, price, parked] = await Promise.all([
    view(provider, contract, "ft_balance_of", { account_id: account }),
    view(provider, contract, "get_st_near_price"),
    readParked(provider, { contract, account, vault }),
  ]);
  const b = u128(balance, "stNEAR balance"),
    p = u128(price, "stNEAR price");
  return {
    contract,
    account,
    vault,
    balance: b,
    price: p,
    parked,
    value: valueOf(b, p) + parked,
  };
}

/** What the pool pays now for selling `shares` stNEAR instantly. */
export async function quoteSell(provider, contract, shares) {
  return u128(
    await view(provider, contract, "get_near_amount_sell_stnear", {
      stnear_to_sell: shares.toString(),
    }),
    "sell quote",
  );
}

const s = (v) => (typeof v === "bigint" ? v.toString() : v);

/**
 * Public view for GET /api/treasury/stnear: live balance plus the public
 * record the Mac worker writes (deposits and harvests, never keys).
 */
export function createTreasuryView({
  provider,
  record,
  clock = Date.now,
  cacheMs = 5 * 60_000,
}) {
  let hit = null;
  return async function read() {
    if (hit && clock() - hit.at < cacheMs) return hit.value;
    const r = record();
    assert(
      r?.account && r?.contract,
      "The treasury is not in stNEAR yet.",
      503,
      "TREASURY_NOT_STAKED",
    );
    const live = await readTreasury(provider, {
      contract: r.contract,
      account: r.account,
      vault: r.vault ?? TREASURY_TOKENS[r.network]?.vault ?? null,
    });
    const principal = BigInt(r.principal || "0");
    // Honest yield status: has stNEAR gained against NEAR since the first
    // deposit? (Testnet Meta Pool has kept one price for days, so there is
    // nothing to harvest there however long we wait.)
    const first = (r.deposits || []).find(
      (d) => BigInt(d.stnear || "0") > 0n && BigInt(d.near || "0") > 0n,
    );
    const depositPrice = first
      ? (BigInt(first.near) * YOCTO) / BigInt(first.stnear)
      : null;
    const sinceMs = first ? clock() - Date.parse(first.at) : 0;
    const priceGrowing =
      depositPrice == null ? null : live.price > depositPrice;
    const yieldStatus =
      depositPrice == null
        ? "no-deposit"
        : priceGrowing
          ? "growing"
          : sinceMs > 24 * 3600_000
            ? "price-flat"
            : "waiting";
    const value = {
      network: r.network,
      account: r.account,
      contract: r.contract,
      balance: s(live.balance),
      parked: s(live.parked),
      vault: live.vault,
      price: s(live.price),
      value: s(live.value),
      principal: s(principal),
      growth: s(live.value > principal ? live.value - principal : 0n),
      depositPrice: depositPrice == null ? null : s(depositPrice),
      yieldStatus,
      harvested: s(
        (r.harvests || []).reduce((a, h) => a + BigInt(h.received || "0"), 0n),
      ),
      harvests: (r.harvests || []).slice(-14),
      deposits: (r.deposits || []).slice(-14),
      observedAt: clock(),
    };
    hit = { at: clock(), value };
    return value;
  };
}

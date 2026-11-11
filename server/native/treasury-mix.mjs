// Treasury mix: 50 % liquid staking, 40 % stablecoins on Rhea Lend, 10 % NEAR
// (docs/TREASURY-MIX.md, QGOLD build plan stream 8).
//
// The sponsor treasury (the operator wallet that funds reward days) used to be
// stNEAR only, so all of its yield came from NEAR staking and all of its value
// moved with the NEAR price. This module values every treasury holding in NEAR,
// compares the mix with the target and plans the moves that bring it back:
//
//   lst     stNEAR (Meta Pool) and LiNEAR, held in the wallet or the yield vault
//   stable  USDC / USDT deposited in our yield vault, which supplies them to
//           Rhea Lend while the market is under 95 % utilization
//   near    wNEAR in the wallet: a reserve that is separate from the gas NEAR
//
// Hard limits (Lubos, 4 Nov 2026): at most 40 % of the treasury with any one
// protocol, never supply to a market at or above 95 % utilization, approved
// assets only. Caps win over targets: what cannot go where it should waits in
// the NEAR reserve. A run moves at most 25 % of the treasury, so the mix
// shifts over days instead of in one block.
//
// The QGOLD backing is a different pot and stays in LSTs only.
//
// Pure planning plus read-only chain views. It never signs.
import { assert } from "../domain.mjs";
import { readRheaMarkets, rheaSettings } from "./rhea-markets.mjs";

export const YOCTO = 10n ** 24n;
const E8 = 10n ** 8n;

// Pyth price feeds as Rhea Lend itself lists them (get_all_token_pyth_infos).
const PYTH = {
  near: "27e867f0f4f61076456d1a73b14c7edc1cf5cef4f4d6193a33424288f11bd0f4",
  usdc: "41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722",
  usdt: "1fc18861232290221461220bd4e2acd1dcdfbc89c84092c93c18bdc7756c1588",
};

export const MIX_NETWORKS = {
  testnet: {
    vault: "questlayer-yield-20261102.testnet",
    pyth: "pyth-oracle.testnet",
    ref: "ref-finance-101.testnet",
    assets: [
      { id: "stnear", label: "stNEAR", token: "meta-v2.pool.testnet", bucket: "lst", protocol: "Meta Pool", decimals: 24, priceMethod: "get_st_near_price", minStake: YOCTO },
      { id: "linear", label: "LiNEAR", token: "linear-protocol.testnet", bucket: "lst", protocol: "LiNEAR", decimals: 24, priceMethod: "ft_price", minStake: YOCTO },
      { id: "usdc", label: "USDC", token: "usdc.fakes.testnet", bucket: "stable", protocol: "Rhea Lend", decimals: 6, feed: PYTH.usdc },
      { id: "usdt", label: "USDT", token: "usdt.fakes.testnet", bucket: "stable", protocol: "Rhea Lend", decimals: 6, feed: PYTH.usdt },
      { id: "wnear", label: "wNEAR", token: "wrap.testnet", bucket: "near", protocol: "NEAR", decimals: 24 },
    ],
  },
  // Mainnet needs its own allowlist, a review and Lubos's go.
};

// Ceilings in code: settings may only tighten them.
export const HARD_LIMITS = Object.freeze({ maxProtocolBps: 4000, maxUtilBps: 9500, maxMoveBps: 5000 });
export const BUCKETS = ["lst", "stable", "near"];

const U128 = /^(0|[1-9]\d{0,38})$/;
const u128 = (v, what) => {
  assert(typeof v === "string" && U128.test(v), `Invalid ${what}.`, 503);
  return BigInt(v);
};
const bpsOf = (part, whole) => (whole > 0n ? Number((part * 10_000n) / whole) : 0);
const min = (a, b) => (a < b ? a : b);
const share = (total, bps) => (total * BigInt(bps)) / 10_000n;

export function mixSettings(env = process.env, network = "testnet") {
  const net = MIX_NETWORKS[network] || null;
  const bps = (v, fallback) => {
    const n = Number(v);
    return v != null && v !== "" && Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : fallback;
  };
  let target = {
    lst: bps(env.TREASURY_MIX_LST_BPS, 5000),
    stable: bps(env.TREASURY_MIX_STABLE_BPS, 4000),
    near: bps(env.TREASURY_MIX_NEAR_BPS, 1000),
  };
  const policyError = target.lst + target.stable + target.near !== 10_000;
  if (policyError) target = { lst: 5000, stable: 4000, near: 1000 };
  const nearAmount = (v, fallback) => {
    const n = Number(v);
    return BigInt(Math.round((Number.isFinite(n) && n > 0 ? n : fallback) * 1e6)) * 10n ** 18n;
  };
  return {
    network,
    enabled: env.TREASURY_MIX_ENABLED !== "0" && !!net,
    account: env.TREASURY_MIX_ACCOUNT || null,
    vault: env.TREASURY_MIX_VAULT === "off" ? null : env.TREASURY_MIX_VAULT || net?.vault || null,
    pyth: net?.pyth || null,
    ref: net?.ref || null,
    assets: net?.assets || [],
    target,
    policyError,
    maxProtocolBps: Math.min(HARD_LIMITS.maxProtocolBps, bps(env.TREASURY_MIX_MAX_PROTOCOL_BPS, 4000)),
    maxUtilBps: Math.min(HARD_LIMITS.maxUtilBps, bps(env.TREASURY_MIX_MAX_UTIL_BPS, 9500)),
    // Do nothing while every bucket is within this of its target.
    driftBps: bps(env.TREASURY_MIX_DRIFT_BPS, 300),
    // Most of the treasury one run may move.
    maxMoveBps: Math.min(HARD_LIMITS.maxMoveBps, bps(env.TREASURY_MIX_MAX_MOVE_BPS, 2500)),
    minMove: nearAmount(env.TREASURY_MIX_MIN_MOVE_NEAR, 0.1),
    // Testnet Pyth feeds are months old; mainnet must refuse a stale price.
    maxPriceAgeSec: Number(env.TREASURY_MIX_MAX_PRICE_AGE_SEC) > 0 ? Number(env.TREASURY_MIX_MAX_PRICE_AGE_SEC) : 300,
    allowStalePrices: network === "testnet",
    cacheMs: 5 * 60_000,
  };
}

/** Pyth price as an integer in 1e-8 USD. */
export function pythE8(p) {
  assert(p && typeof p.price === "string" && /^\d+$/.test(p.price) && Number.isInteger(p.expo), "Invalid Pyth price.", 503);
  const shift = 8 + p.expo;
  const v = shift >= 0 ? BigInt(p.price) * 10n ** BigInt(shift) : BigInt(p.price) / 10n ** BigInt(-shift);
  assert(v > 0n, "Pyth price is zero.", 503);
  return v;
}

/** NEAR value (yocto) of `amount` token units at the given prices. */
export function valueIn(asset, amount, prices) {
  if (amount === 0n) return 0n;
  if (asset.bucket === "near") return amount;
  if (asset.bucket === "lst") {
    const p = prices.lst?.[asset.id];
    assert(typeof p === "bigint" && p > 0n, `No ${asset.label} price.`, 503);
    return (amount * p) / YOCTO;
  }
  const usd = prices.usd?.[asset.id],
    near = prices.usd?.near;
  assert(typeof usd === "bigint" && typeof near === "bigint" && near > 0n, `No ${asset.label} price.`, 503);
  return (amount * 10n ** BigInt(24 - asset.decimals) * usd) / near;
}

/** Token units of `asset` worth `value` yoctoNEAR, rounded down. */
export function unitsFor(asset, value, prices) {
  if (asset.bucket === "near") return value;
  if (asset.bucket === "lst") return (value * YOCTO) / prices.lst[asset.id];
  return (value * prices.usd.near) / (10n ** BigInt(24 - asset.decimals) * prices.usd[asset.id]);
}

/**
 * Pure: value the holdings. `rows` per asset: { wallet, vault, vaultFree } in
 * token units (LST vault rows are already yoctoNEAR value, as the vault keeps
 * them). `pending` = stable yield harvested to the wallet that still waits to
 * go to the prize pool; it is not treasury capital.
 */
export function valueHoldings({ assets, rows, prices, pending = {} }) {
  return assets.map((a) => {
    const r = rows[a.id] || {};
    const pend = pending[a.id] || 0n;
    const walletRaw = r.wallet || 0n;
    const wallet = walletRaw > pend ? walletRaw - pend : 0n;
    const walletValue = valueIn(a, wallet, prices);
    const vaultValue = a.bucket === "lst" ? r.vault || 0n : valueIn(a, r.vault || 0n, prices);
    const vaultFreeValue = a.bucket === "lst" ? r.vaultFree || 0n : valueIn(a, r.vaultFree || 0n, prices);
    return {
      id: a.id,
      label: a.label,
      token: a.token,
      bucket: a.bucket,
      protocol: a.protocol,
      decimals: a.decimals,
      minStake: a.minStake || 0n,
      wallet,
      vault: r.vault || 0n,
      pending: pend,
      walletValue,
      vaultValue,
      vaultFreeValue,
      value: walletValue + vaultValue,
    };
  });
}

// Water-fill `want` across rows, each up to its own cap; returns what is left.
function fill(want, rows, room, target) {
  let left = want,
    open = rows.slice();
  while (left > 0n && open.length) {
    const each = left / BigInt(open.length);
    if (each === 0n) break;
    let used = 0n;
    const next = [];
    for (const r of open) {
      const free = room(r) - target.get(r.id);
      const add = free > 0n ? min(each, free) : 0n;
      target.set(r.id, target.get(r.id) + add);
      used += add;
      if (add === each) next.push(r);
    }
    left -= used;
    if (used === 0n) break;
    open = next;
  }
  return left;
}

/**
 * Pure: target per asset and the moves of one run.
 *  holdings  from valueHoldings
 *  markets   { [token]: { utilizationBps, offered } } from Rhea Lend
 *  settings  from mixSettings
 *
 * Steps (amounts in yoctoNEAR value; the executor converts to token units):
 *   sell-lst        liquid-unstake wallet LST into NEAR
 *   withdraw-vault  take a vault position back to the wallet (lock and queue apply)
 *   sell-stable     swap wallet stablecoins into NEAR
 *   unwrap          wNEAR reserve above target into NEAR
 *   buy-stable      swap NEAR into a stablecoin, then deposit-vault
 *   stake-lst       stake NEAR into an LST
 *   wrap            NEAR into the wNEAR reserve
 * Sinks are funded only from what this run's sources free, so money never
 * comes out of the operator's gas NEAR.
 */
export function planMix({ holdings, markets = {}, settings }) {
  const total = holdings.reduce((a, h) => a + h.value, 0n);
  const target = new Map(holdings.map((h) => [h.id, 0n]));
  const notes = [];
  const result = (extra) => ({
    total,
    targets: Object.fromEntries([...target].map(([k, v]) => [k, v])),
    buckets: bucketRows(holdings, target, total, settings),
    notes,
    steps: [],
    ...extra,
  });
  if (total === 0n) return result({ action: "skip", reason: "empty-treasury" });
  const cap = share(total, settings.maxProtocolBps);

  // LSTs: each provider is its own protocol, capped at 40 %. A provider we do
  // not hold yet only counts when its share reaches the provider's minimum stake.
  const lsts = holdings.filter((h) => h.bucket === "lst");
  const lstWant = share(total, settings.target.lst);
  let eligible = lsts.filter((h) => h.value > 0n || lstWant / BigInt(Math.max(1, lsts.length)) >= h.minStake);
  if (!eligible.length && lsts.length) eligible = [lsts[0]];
  for (const h of lsts.filter((x) => !eligible.includes(x)))
    notes.push(`${h.label}: its share is below the ${h.minStake / YOCTO} NEAR minimum stake, so it waits in NEAR.`);
  const lstLeft = fill(lstWant, eligible, () => cap, target);
  if (lstLeft > 0n) notes.push("Liquid staking is below its target: the 40 % cap per protocol keeps the rest in NEAR.");

  // Stablecoins: all on Rhea Lend, so the protocol cap covers their sum.
  const stables = holdings.filter((h) => h.bucket === "stable");
  const ok = (h) => {
    const m = markets[h.token];
    return !!m && m.offered && m.utilizationBps < settings.maxUtilBps;
  };
  const byProtocol = new Map();
  for (const h of stables) byProtocol.set(h.protocol, [...(byProtocol.get(h.protocol) || []), h]);
  let stableWant = share(total, settings.target.stable);
  // Allowlist order is the preference (USDC first); a closed or full market is skipped.
  const open = stables.filter(ok);
  for (const h of stables.filter((x) => !ok(x)))
    notes.push(`${h.label}: the Rhea market is not open or is at least ${settings.maxUtilBps / 100} % lent out, so nothing new goes there.`);
  const protocolRoom = new Map([...byProtocol].map(([p]) => [p, cap]));
  // Keep what already sits in healthy markets (no churn between USDC and USDT),
  // then add the rest to the first healthy market.
  for (const h of open) {
    const room = min(protocolRoom.get(h.protocol), stableWant);
    const keep = min(h.value, room);
    target.set(h.id, keep);
    stableWant -= keep;
    protocolRoom.set(h.protocol, protocolRoom.get(h.protocol) - keep);
  }
  for (const h of open) {
    const add = min(protocolRoom.get(h.protocol), stableWant);
    if (add <= 0n) continue;
    target.set(h.id, target.get(h.id) + add);
    stableWant -= add;
    protocolRoom.set(h.protocol, protocolRoom.get(h.protocol) - add);
  }
  if (stableWant > 0n)
    notes.push(open.length ? "Stablecoins are below their target: the 40 % cap on Rhea Lend keeps the rest in NEAR." : "No stablecoin market is open: the stablecoin share waits in NEAR.");

  // NEAR reserve takes everything the caps left over.
  const placed = [...target.values()].reduce((a, v) => a + v, 0n);
  const reserve = holdings.find((h) => h.bucket === "near");
  if (reserve) target.set(reserve.id, total - placed);

  const buckets = bucketRows(holdings, target, total, settings);
  const drift = Math.max(...buckets.map((b) => Math.abs(b.currentBps - b.targetBps)));
  const assetDrift = holdings.some((h) => {
    const t = target.get(h.id);
    return (h.value > t ? h.value - t : t - h.value) > share(total, settings.driftBps);
  });
  if (drift <= settings.driftBps && !assetDrift) return result({ action: "hold", reason: "within-drift", drift });

  // Sources: over-target assets, worst market first, then LSTs, stables, reserve.
  let budget = share(total, settings.maxMoveBps);
  let cash = 0n;
  const steps = [];
  const rank = (h) => (h.bucket === "stable" && !ok(h) ? 0 : h.bucket === "lst" ? 1 : h.bucket === "stable" ? 2 : 3);
  const over = holdings.filter((h) => h.value > target.get(h.id)).sort((a, b) => rank(a) - rank(b));
  for (const h of over) {
    if (budget < settings.minMove) break;
    let amount = min(h.value - target.get(h.id), budget);
    if (amount < settings.minMove) continue;
    if (h.bucket === "near") {
      const take = min(amount, h.walletValue);
      if (take >= settings.minMove) {
        steps.push({ op: "unwrap", asset: h.id, value: take });
        cash += take;
        budget -= take;
      }
      continue;
    }
    const fromWallet = min(amount, h.walletValue);
    if (fromWallet >= settings.minMove) {
      steps.push({ op: h.bucket === "lst" ? "sell-lst" : "sell-stable", asset: h.id, value: fromWallet });
      cash += fromWallet;
      budget -= fromWallet;
      amount -= fromWallet;
    }
    // The rest sits in the vault: bring it to the wallet now, sell it next run.
    const fromVault = min(amount, h.vaultFreeValue);
    if (fromVault >= settings.minMove) {
      steps.push({ op: "withdraw-vault", asset: h.id, value: fromVault });
      budget -= fromVault;
    }
  }

  // Sinks: stablecoins first (the point of this change), then LSTs, then the reserve.
  const sinkRank = { stable: 0, lst: 1, near: 2 };
  const under = holdings
    .filter((h) => h.value < target.get(h.id))
    .sort((a, b) => sinkRank[a.bucket] - sinkRank[b.bucket]);
  for (const h of under) {
    if (cash < settings.minMove) break;
    let amount = min(target.get(h.id) - h.value, cash);
    if (amount < settings.minMove) continue;
    if (h.bucket === "stable") {
      steps.push({ op: "buy-stable", asset: h.id, value: amount }, { op: "deposit-vault", asset: h.id, value: amount });
    } else if (h.bucket === "lst") {
      if (amount < h.minStake) {
        notes.push(`${h.label}: ${amount} yocto is below the minimum stake; it waits in NEAR.`);
        continue;
      }
      steps.push({ op: "stake-lst", asset: h.id, value: amount });
    } else {
      steps.push({ op: "wrap", asset: h.id, value: amount });
    }
    cash -= amount;
  }
  // Whatever a source freed and no sink took goes to the reserve, never to the gas wallet.
  if (cash > 0n && reserve) {
    const last = steps.findLast((s) => s.op === "wrap");
    if (last) last.value += cash;
    else steps.push({ op: "wrap", asset: reserve.id, value: cash });
    cash = 0n;
  }
  if (!steps.length) return result({ action: "hold", reason: "nothing-movable", drift });
  return result({ action: "rebalance", drift, steps });
}

function bucketRows(holdings, target, total, settings) {
  return BUCKETS.map((b) => {
    const rows = holdings.filter((h) => h.bucket === b);
    const current = rows.reduce((a, h) => a + h.value, 0n);
    const goal = rows.reduce((a, h) => a + (target.get(h.id) || 0n), 0n);
    return {
      bucket: b,
      current,
      target: goal,
      currentBps: bpsOf(current, total),
      targetBps: bpsOf(goal, total),
      policyBps: settings.target[b],
    };
  });
}

/** Protocol exposure check (shown on /economy). */
export function protocolExposure(holdings, settings) {
  const total = holdings.reduce((a, h) => a + h.value, 0n);
  const map = new Map();
  for (const h of holdings) if (h.bucket !== "near") map.set(h.protocol, (map.get(h.protocol) || 0n) + h.value);
  return [...map].map(([protocol, value]) => ({
    protocol,
    value,
    bps: bpsOf(value, total),
    overCap: bpsOf(value, total) > settings.maxProtocolBps,
  }));
}

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

/** Live prices: LSTs from their protocols, USD from Pyth (as Rhea Lend uses). */
export async function readPrices(provider, settings, { now = Date.now() } = {}) {
  const lst = {},
    usd = {},
    stale = [];
  const feeds = [["near", PYTH.near], ...settings.assets.filter((a) => a.feed).map((a) => [a.id, a.feed])];
  await Promise.all([
    ...settings.assets
      .filter((a) => a.bucket === "lst")
      .map(async (a) => {
        lst[a.id] = u128(String(await view(provider, a.token, a.priceMethod)), `${a.label} price`);
      }),
    ...feeds.map(async ([id, feed]) => {
      const p = await view(provider, settings.pyth, "get_price_unsafe", { price_identifier: feed });
      assert(p, `No Pyth price for ${id}.`, 503);
      const age = Math.max(0, Math.floor(now / 1000) - Number(p.publish_time));
      if (age > settings.maxPriceAgeSec) {
        assert(settings.allowStalePrices, `The ${id} price is ${age} s old.`, 503, "STALE_PRICE");
        stale.push({ id, ageSec: age });
      }
      usd[id] = pythE8(p);
    }),
  ]);
  return { lst, usd, stale };
}

/** Live read of wallet balances and vault positions for the treasury account. */
export async function readRows(provider, settings, account) {
  const rows = {};
  const positions = settings.vault
    ? await view(provider, settings.vault, "get_position", { account_id: account })
    : [];
  assert(Array.isArray(positions), "Unexpected vault position.", 503);
  await Promise.all(
    settings.assets.map(async (a) => {
      const bal = await view(provider, a.token, "ft_balance_of", { account_id: account });
      const pos = positions.find((p) => p?.token_id === a.token);
      rows[a.id] = {
        wallet: u128(String(bal ?? "0"), `${a.label} balance`),
        // principal = what the vault owes us; withdrawable = what may leave now.
        vault: pos ? u128(String(pos.principal ?? "0"), "vault principal") : 0n,
        vaultFree: pos ? u128(String(pos.withdrawable ?? "0"), "vault withdrawable") : 0n,
      };
    }),
  );
  return rows;
}

/** Rhea Lend markets keyed by token, with utilization in basis points. */
export async function readMarkets(provider, settings, network) {
  const rs = rheaSettings({ RHEA_MAX_UTILIZATION: String(settings.maxUtilBps / 100) }, network);
  const view = await readRheaMarkets(provider, rs);
  return Object.fromEntries(
    view.markets.map((m) => [
      m.token,
      {
        utilizationBps: Math.round(m.utilizationPercent * 100),
        offered: m.offered,
        supplyAprPercent: m.supplyAprPercent,
        reason: m.reason,
      },
    ]),
  );
}

/** Stable yield harvested to the wallet and not yet sent to the prize pool. */
export function pendingYield(record) {
  const out = {};
  for (const y of record?.stableYield || [])
    if (!y.fundTransaction) out[y.asset] = (out[y.asset] || 0n) + BigInt(y.amount || "0");
  return out;
}

/** One live snapshot: prices, holdings, markets and the plan for the next run. */
export async function readMix(provider, settings, { account, record = null, now = Date.now() } = {}) {
  assert(settings.enabled, "The treasury mix is not configured on this network.", 503, "TREASURY_MIX_DISABLED");
  assert(account, "The treasury account is not known.", 503);
  const [prices, rows, markets] = await Promise.all([
    readPrices(provider, settings, { now }),
    readRows(provider, settings, account),
    readMarkets(provider, settings, settings.network),
  ]);
  const holdings = valueHoldings({ assets: settings.assets, rows, prices, pending: pendingYield(record) });
  const plan = planMix({ holdings, markets, settings });
  return { prices, rows, markets, holdings, plan, exposure: protocolExposure(holdings, settings) };
}

const s = (v) =>
  typeof v === "bigint"
    ? v.toString()
    : Array.isArray(v)
      ? v.map(s)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, s(x)]))
        : v;

/** Public view for GET /api/treasury/mix (no keys, read-only). */
export function createTreasuryMixView({ provider, settings: base, record, account, target = null, clock = Date.now }) {
  let hit = null;
  return async function read() {
    if (hit && clock() - hit.at < base.cacheMs) return hit.value;
    // The treasury DAO's adopted mix (docs/TREASURY-DAO.md) replaces the configured target.
    const adopted = target ? await target().catch(() => null) : null;
    const settings = adopted ? { ...base, target: adopted, governedBy: "dao" } : base;
    const r = record();
    const who = settings.account || account() || r?.account || null;
    const live = await readMix(provider, settings, { account: who, record: r, now: clock() });
    const value = s({
      network: settings.network,
      account: who,
      vault: settings.vault,
      policy: {
        target: settings.target,
        governedBy: settings.governedBy || "settings",
        maxProtocolBps: settings.maxProtocolBps,
        maxUtilBps: settings.maxUtilBps,
        driftBps: settings.driftBps,
        maxMoveBps: settings.maxMoveBps,
      },
      total: live.plan.total,
      buckets: live.plan.buckets,
      exposure: live.exposure,
      holdings: live.holdings.map((h) => ({
        id: h.id,
        label: h.label,
        token: h.token,
        bucket: h.bucket,
        protocol: h.protocol,
        decimals: h.decimals,
        wallet: h.wallet,
        vault: h.vault,
        pending: h.pending,
        value: h.value,
        market: h.bucket === "stable" ? live.markets[h.token] || null : null,
      })),
      prices: {
        nearUsdE8: live.prices.usd.near,
        lst: live.prices.lst,
        stale: live.prices.stale,
      },
      next: { action: live.plan.action, reason: live.plan.reason || null, steps: live.plan.steps, notes: live.plan.notes },
      runs: (r?.runs || []).slice(-10),
      stableYield: (r?.stableYield || []).slice(-14),
      observedAt: clock(),
    });
    hit = { at: clock(), value };
    return value;
  };
}

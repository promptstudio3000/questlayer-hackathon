import test from "node:test";
import assert from "node:assert/strict";
import {
  mixSettings,
  valueHoldings,
  planMix,
  pythE8,
  valueIn,
  unitsFor,
  protocolExposure,
  pendingYield,
  createTreasuryMixView,
  HARD_LIMITS,
  YOCTO,
  stakedHolding,
  normalTargets,
} from "../server/native/treasury-mix.mjs";

const settings = mixSettings({}, "testnet");
const A = Object.fromEntries(settings.assets.map((a) => [a.id, a]));
const N = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
// stNEAR 3.2 NEAR, LiNEAR 2.28 NEAR, 1 NEAR = 2 USD, stables at 1 USD.
const prices = {
  lst: { stnear: N(3.2), linear: N(2.28) },
  usd: { near: 200_000_000n, usdc: 100_000_000n, usdt: 100_000_000n },
  stale: [],
};
const healthy = {
  "usdc.fakes.testnet": { utilizationBps: 3000, offered: true },
  "usdt.fakes.testnet": { utilizationBps: 1000, offered: true },
};
const holdingsOf = (rows, pending) => valueHoldings({ assets: settings.assets, rows, prices, pending });
const usd = (n) => BigInt(Math.round(n * 1e6));

test("settings: 50/40/10 by default, limits only tighten, broken targets fall back", () => {
  assert.deepEqual(settings.target, { staked: 0, lst: 5000, stable: 4000, near: 1000 });
  assert.equal(settings.maxProtocolBps, 4000);
  assert.equal(settings.maxUtilBps, 9500);
  const loose = mixSettings({ TREASURY_MIX_MAX_PROTOCOL_BPS: "9000", TREASURY_MIX_MAX_UTIL_BPS: "9900", TREASURY_MIX_MAX_MOVE_BPS: "10000" }, "testnet");
  assert.equal(loose.maxProtocolBps, HARD_LIMITS.maxProtocolBps);
  assert.equal(loose.maxUtilBps, HARD_LIMITS.maxUtilBps);
  assert.equal(loose.maxMoveBps, HARD_LIMITS.maxMoveBps);
  assert.equal(mixSettings({ TREASURY_MIX_MAX_PROTOCOL_BPS: "3000" }, "testnet").maxProtocolBps, 3000);
  const broken = mixSettings({ TREASURY_MIX_LST_BPS: "9000" }, "testnet");
  assert.equal(broken.policyError, true);
  assert.deepEqual(broken.target, { staked: 0, lst: 5000, stable: 4000, near: 1000 });
  assert.deepEqual(mixSettings({ TREASURY_MIX_STAKED_BPS: "9000", TREASURY_MIX_LST_BPS: "0", TREASURY_MIX_STABLE_BPS: "1000", TREASURY_MIX_NEAR_BPS: "0" }, "testnet").target, { staked: 9000, lst: 0, stable: 1000, near: 0 });
  assert.ok(settings.stakeVaults.length >= 1, "testnet lists the treasury staking vaults");
  assert.deepEqual(mixSettings({ TREASURY_MIX_STAKE_VAULTS: "off" }, "testnet").stakeVaults, []);
  assert.equal(mixSettings({}, "mainnet").enabled, false, "mainnet has no allowlist yet");
  assert.equal(mixSettings({ TREASURY_MIX_ENABLED: "0" }, "testnet").enabled, false);
});

test("valuation: Pyth exponents, LST prices, stablecoins through the NEAR/USD price", () => {
  assert.equal(pythE8({ price: "188705142", expo: -8 }), 188705142n);
  assert.equal(pythE8({ price: "1887", expo: -3 }), 188700000n);
  assert.throws(() => pythE8({ price: "0", expo: -8 }));
  assert.equal(valueIn(A.stnear, YOCTO, prices), N(3.2));
  assert.equal(valueIn(A.usdc, usd(10), prices), N(5), "10 USDC at 2 USD per NEAR is 5 NEAR");
  assert.equal(valueIn(A.wnear, N(1), prices), N(1));
  assert.equal(unitsFor(A.usdc, N(5), prices), usd(10));
  assert.equal(unitsFor(A.stnear, N(3.2), prices), YOCTO);
});

test("today's treasury (2 NEAR, all stNEAR): sells a quarter into USDC, LiNEAR waits for its minimum", () => {
  const h = holdingsOf({ stnear: { wallet: N(0.425), vault: N(0.64), vaultFree: N(0.64) } });
  const total = h.reduce((a, x) => a + x.value, 0n);
  const plan = planMix({ holdings: h, markets: healthy, settings });
  assert.equal(plan.action, "rebalance");
  // stNEAR is capped at 40 % (one protocol), LiNEAR's 0.5 NEAR share is under 1 NEAR.
  assert.equal(plan.targets.stnear, (total * 4000n) / 10_000n);
  assert.equal(plan.targets.linear, 0n);
  assert.equal(plan.targets.usdc + plan.targets.usdt, (total * 4000n) / 10_000n);
  assert.ok(plan.targets.usdc - plan.targets.usdt <= 1n, "the stable share is split evenly over USDC and USDT");
  assert.equal(plan.targets.wnear, total - plan.targets.stnear - plan.targets.usdc - plan.targets.usdt);
  assert.ok(plan.notes.some((n) => /LiNEAR/.test(n)));
  assert.deepEqual(plan.steps.map((s) => s.op), ["sell-lst", "buy-stable", "deposit-vault", "buy-stable", "deposit-vault"]);
  const moved = plan.steps[0].value;
  assert.equal(moved, (total * 2500n) / 10_000n, "at most 25 % per run");
  assert.ok(moved <= h[0].walletValue, "sells only wallet stNEAR");
  assert.equal(plan.steps[1].value + plan.steps[3].value, moved);
});

test("a big treasury reaches 50/40/10 with LiNEAR next to stNEAR, each at or under 40 %", () => {
  const settingsAllAtOnce = { ...settings, maxMoveBps: 10_000 };
  const h = holdingsOf({ stnear: { wallet: N(100 / 3.2) } });
  const plan = planMix({ holdings: h, markets: healthy, settings: settingsAllAtOnce });
  assert.equal(plan.targets.stnear, N(25));
  assert.equal(plan.targets.linear, N(25));
  assert.equal(plan.targets.usdc, N(20));
  assert.equal(plan.targets.usdt, N(20));
  assert.equal(plan.targets.wnear, N(10));
  const ops = plan.steps.map((s) => `${s.op}:${s.asset}`);
  assert.deepEqual(ops, ["sell-lst:stnear", "buy-stable:usdc", "deposit-vault:usdc", "buy-stable:usdt", "deposit-vault:usdt", "stake-lst:linear", "wrap:wnear"]);
  assert.equal(plan.steps.find((s) => s.op === "stake-lst").value, N(25));
  assert.equal(plan.steps.find((s) => s.op === "wrap").value, N(10));
});

test("within 3 points of target: hold", () => {
  const h = holdingsOf({
    stnear: { wallet: N(25 / 3.2) },
    linear: { wallet: (N(25) * YOCTO) / N(2.28) },
    usdc: { vault: usd(40), vaultFree: usd(40) },
    usdt: { vault: usd(40), vaultFree: usd(40) },
    wnear: { wallet: N(10) },
  });
  const plan = planMix({ holdings: h, markets: healthy, settings });
  assert.equal(plan.action, "hold");
  assert.equal(plan.reason, "within-drift");
});

test("a market at 95 % utilization gets nothing new; a full market is drained first", () => {
  const full = { ...healthy, "usdc.fakes.testnet": { utilizationBps: 9500, offered: true } };
  const h = holdingsOf({ stnear: { wallet: N(100 / 3.2) } });
  const plan = planMix({ holdings: h, markets: full, settings: { ...settings, maxMoveBps: 10_000 } });
  assert.equal(plan.targets.usdc, 0n);
  assert.equal(plan.targets.usdt, N(40), "falls through to the next healthy market");
  const none = planMix({ holdings: h, markets: {}, settings });
  assert.equal(none.targets.usdc + none.targets.usdt, 0n, "no market read: stablecoins wait in NEAR");
  assert.ok(none.notes.some((n) => /No stablecoin market/.test(n)));
  // Holding USDC in a market that turned full: its vault position is withdrawn first.
  const stuck = holdingsOf({ stnear: { wallet: N(50 / 3.2) }, usdc: { vault: usd(100), vaultFree: usd(100) } });
  const out = planMix({ holdings: stuck, markets: full, settings });
  assert.equal(out.steps[0].op, "withdraw-vault");
  assert.equal(out.steps[0].asset, "usdc");
});

test("the 40 % protocol cap covers USDC and USDT together", () => {
  const h = holdingsOf({ usdc: { vault: usd(60), vaultFree: usd(60) }, usdt: { vault: usd(60), vaultFree: usd(60) }, wnear: { wallet: N(40) } });
  const plan = planMix({ holdings: h, markets: healthy, settings: { ...settings, target: { lst: 0, stable: 10_000, near: 0 } } });
  assert.equal(plan.targets.usdc + plan.targets.usdt, N(40), "100 NEAR total, Rhea Lend capped at 40");
  const exposure = protocolExposure(h, settings);
  assert.equal(exposure.find((e) => e.protocol === "Rhea Lend").overCap, true);
});

test("sinks never spend more than this run freed, and leftovers go to the reserve", () => {
  const h = holdingsOf({ stnear: { wallet: N(100 / 3.2) } });
  for (const maxMoveBps of [500, 1000, 2500, 5000]) {
    const plan = planMix({ holdings: h, markets: healthy, settings: { ...settings, maxMoveBps } });
    const freed = plan.steps.filter((s) => ["sell-lst", "sell-stable", "unwrap"].includes(s.op)).reduce((a, s) => a + s.value, 0n);
    const spent = plan.steps.filter((s) => ["buy-stable", "stake-lst", "wrap"].includes(s.op)).reduce((a, s) => a + s.value, 0n);
    assert.equal(spent, freed, `maxMoveBps ${maxMoveBps}`);
  }
});

test("pending stable yield is not counted as treasury capital", () => {
  const record = { stableYield: [{ asset: "usdc", amount: "2000000", fundTransaction: null }, { asset: "usdc", amount: "5", fundTransaction: "x" }] };
  assert.deepEqual(pendingYield(record), { usdc: 2_000_000n });
  const h = holdingsOf({ usdc: { wallet: usd(3) } }, pendingYield(record));
  assert.equal(h.find((x) => x.id === "usdc").wallet, usd(1));
});

test("empty treasury plans nothing", () => {
  const plan = planMix({ holdings: holdingsOf({}), markets: healthy, settings });
  assert.equal(plan.action, "skip");
  assert.equal(plan.reason, "empty-treasury");
});

test("public view reads chain once per five minutes and returns strings", async () => {
  let reads = 0;
  const enc = (v) => ({ result: [...Buffer.from(JSON.stringify(v))], block_height: 1 });
  const provider = {
    async query({ account_id, method_name }) {
      reads++;
      if (method_name === "get_st_near_price") return enc(N(3.2).toString());
      if (method_name === "ft_price") return enc(N(2.28).toString());
      if (method_name === "get_price_unsafe") return enc({ price: "200000000", expo: -8, publish_time: 0 });
      if (method_name === "get_position") return enc([]);
      if (method_name === "get_assets_paged_detailed")
        return enc([{ token_id: "usdc.fakes.testnet", supplied: { balance: "100" }, borrowed: { balance: "10" }, supply_apr: "0.05", config: { can_deposit: true } }]);
      if (method_name === "ft_balance_of") return enc(account_id === "meta-v2.pool.testnet" ? N(10 / 3.2).toString() : "0");
      throw new Error(`unexpected ${account_id}.${method_name}`);
    },
  };
  let now = 1_000_000;
  const read = createTreasuryMixView({ provider, settings, record: () => null, account: () => "ops.testnet", clock: () => now });
  const v = await read();
  assert.equal(v.account, "ops.testnet");
  assert.equal(typeof v.total, "string");
  assert.equal(v.next.action, "rebalance");
  assert.equal(v.prices.stale.length, 3, "testnet allows the stale Pyth feeds and says so");
  const first = reads;
  await read();
  assert.equal(reads, first);
  now += 5 * 60_000 + 1;
  await read();
  assert.ok(reads > first);
  // Mainnet-style settings refuse a stale price.
  const strict = createTreasuryMixView({ provider, settings: { ...settings, allowStalePrices: false }, record: () => null, account: () => "ops.testnet", clock: () => now });
  await assert.rejects(strict(), /old/);
});

test("90 / 5 / 5: staking vaults count as staked NEAR and are never moved", () => {
  const target = { staked: 9000, lst: 0, stable: 1000, near: 0 };
  const vault = stakedHolding({ id: "stake-a.testnet", pool: "stakely_v2.pool.f863973.m0", value: N(93) });
  assert.equal(vault.bucket, "staked");
  assert.equal(vault.protocol, "Validator stakely_v2");
  const h = [vault, ...holdingsOf({ stnear: { wallet: N(1 / 3.2) }, wnear: { wallet: N(1) } })];
  const plan = planMix({ holdings: h, markets: healthy, settings: { ...settings, target, maxMoveBps: 10_000 } });
  assert.equal(plan.total, N(95));
  assert.equal(plan.targets["stake-a.testnet"], N(93), "staked positions keep their value");
  assert.ok(plan.steps.every((s) => s.asset !== "stake-a.testnet"), "the planner never moves staked NEAR");
  // Only 2 NEAR are liquid: all of it goes to stables, split evenly, nothing left in LSTs or the reserve.
  assert.equal(plan.targets.usdc + plan.targets.usdt, N(2));
  assert.equal(plan.targets.usdc, plan.targets.usdt);
  assert.equal(plan.targets.stnear, 0n);
  assert.equal(plan.targets.wnear, 0n);
  const b = Object.fromEntries(plan.buckets.map((x) => [x.bucket, x]));
  assert.equal(b.staked.policyBps, 9000);
  assert.ok(b.staked.currentBps > 9000);
  assert.ok(plan.notes.some((n) => /above the 40 % cap per validator/.test(n)), "one validator over the cap is flagged");
  const exposure = protocolExposure(h, settings);
  assert.equal(exposure.find((e) => e.protocol === "Validator stakely_v2").overCap, true);
  // Old adopted mixes without the staked key still plan.
  assert.deepEqual(normalTargets({ lst: 5000, stable: 4000, near: 1000 }), { staked: 0, lst: 5000, stable: 4000, near: 1000 });
});

test("staked below target: the shortfall waits in NEAR with a note", () => {
  const target = { staked: 9000, lst: 0, stable: 1000, near: 0 };
  const vault = stakedHolding({ id: "stake-a.testnet", pool: "aurora.pool.f863973.m0", value: N(30) });
  const h = [vault, ...holdingsOf({ wnear: { wallet: N(70) } })];
  const plan = planMix({ holdings: h, markets: healthy, settings: { ...settings, target } });
  assert.equal(plan.targets.usdc + plan.targets.usdt, N(10));
  assert.equal(plan.targets.wnear, N(60));
  assert.ok(plan.notes.some((n) => /Staked NEAR is below its target/.test(n)));
});

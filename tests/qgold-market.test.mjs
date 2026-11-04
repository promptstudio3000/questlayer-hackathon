import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import {
  INITIAL_RATE,
  POLICY,
  QGOLD_ONE,
  YOCTO,
  askLadder,
  average24h,
  backingRate,
  buybackBudget,
  depositQuote,
  inverseBuy,
  isqrt,
  keeperPlan,
  nearToReachPrice,
  poolPrice,
  qgoldToReachPrice,
  redeemQuote,
  saleAmount,
  saleTimes,
  scheduleCommitment,
  verifySchedule,
} from "../server/qgold/market-math.mjs";
import { QgoldKeeper, keeperSettings, poolReserves, vaultState } from "../server/qgold/keeper.mjs";
import { createQgoldPage, exitPaths } from "../server/qgold/token-page.mjs";

const R = INITIAL_RATE; // 0.001 NEAR per QGOLD
const Q = (n) => BigInt(n) * QGOLD_ONE;
const N = (n) => BigInt(n) * YOCTO;
// A pool priced at `mult` × R with `near` NEAR on the NEAR side.
const poolAt = (near, mult) => ({ near: N(near), qgold: (N(near) * QGOLD_ONE * 1000n) / ((R * BigInt(Math.round(mult * 1000))) ) });

test("isqrt is exact floor", () => {
  for (const n of [0n, 1n, 2n, 15n, 16n, 17n, 10n ** 40n + 7n]) {
    const r = isqrt(n);
    assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n);
  }
});

test("backing rate, deposit at R+1 % and redeem at R−1 %", () => {
  assert.equal(backingRate({ backing: 0, supply: 0 }), INITIAL_RATE);
  assert.equal(backingRate({ backing: N(2), supply: Q(1000) }), N(2) / 1000n);
  const buy = depositQuote(N(1), R);
  // 1 NEAR at 0.00101 NEAR → 990.099 QGOLD; fee is what is not backing.
  assert.equal(buy.qgold, "990099009");
  assert.equal(BigInt(buy.backing) + BigInt(buy.fee), N(1));
  assert.ok(BigInt(buy.fee) >= N(1) / 101n - 1n);
  const sell = redeemQuote(Q(1000), R);
  assert.equal(sell.gross, N(1).toString());
  assert.equal(sell.near, ((N(1) * 99n) / 100n).toString());
  assert.equal(BigInt(sell.near) + BigInt(sell.fee), N(1));
});

test("pool targets move the spot price to the target", () => {
  const pool = poolAt(1000, 1.5);
  const target = (R * 12n) / 10n;
  const dy = qgoldToReachPrice(pool, target);
  const after = { near: (pool.near * pool.qgold) / (pool.qgold + dy), qgold: pool.qgold + dy };
  const p = poolPrice(after);
  assert.ok(p <= target + target / 1000n && p >= target - target / 1000n, `${p} vs ${target}`);
  const low = poolAt(1000, 0.8);
  const dx = nearToReachPrice(low, R);
  const after2 = { near: low.near + dx, qgold: (low.near * low.qgold) / (low.near + dx) };
  const p2 = poolPrice(after2);
  assert.ok(p2 >= R - R / 1000n && p2 <= R + R / 1000n);
  assert.equal(qgoldToReachPrice(low, R), 0n);
  assert.equal(nearToReachPrice(pool, R), 0n);
});

test("ask ladder at 1.1/1.2/1.3 R within the daily 2 % cap", () => {
  const ladder = askLadder({ rate: R, supply: Q(100000) });
  assert.deepEqual(ladder.map((l) => l.multiple), [1.1, 1.2, 1.3]);
  assert.equal(ladder[0].price, ((R * 11n) / 10n).toString());
  assert.equal(ladder[0].amount, Q(500).toString()); // 0.5 % of supply
  const late = askLadder({ rate: R, supply: Q(100000), soldToday: Q(1700) });
  assert.deepEqual(late.map((l) => l.amount), [Q(300).toString(), "0", "0"]);
});

test("sale: 1/12 of half the gap, vs the lower of spot and 24 h average, never below 1.1 R", () => {
  const pool = poolAt(1000, 1.5);
  const s = saleAmount({ pool, rate: R, supply: Q(10_000_000), avgPrice24h: poolPrice(pool) });
  const spot = poolPrice(pool),
    floor = (R * 11n) / 10n;
  const expected = spot - (spot - floor) / 24n;
  assert.equal(s.target, expected);
  assert.ok(s.amount > 0n);
  // A short pump: the 24 h average at 1.2 R limits the sale.
  const pumped = saleAmount({ pool, rate: R, supply: Q(10_000_000), avgPrice24h: (R * 12n) / 10n });
  assert.ok(pumped.amount < s.amount);
  // At or below 1.1 R: no sale.
  assert.equal(saleAmount({ pool: poolAt(1000, 1.1), rate: R, supply: Q(1e6), avgPrice24h: 0n }).amount, 0n);
  // Daily cap: 2 % of supply.
  const capped = saleAmount({ pool, rate: R, supply: Q(1000), avgPrice24h: 0n });
  assert.equal(capped.amount, Q(20));
  assert.equal(saleAmount({ pool, rate: R, supply: Q(1000), soldToday: Q(20) }).reason, "daily-cap-reached");
});

test("inverse buy below R is capped by budget and 5 % of pool NEAR a day", () => {
  const low = poolAt(1000, 0.7);
  const free = inverseBuy({ pool: low, rate: R, budget: N(1_000_000) });
  assert.equal(free.near, N(50)); // 5 % of 1,000 NEAR
  const small = inverseBuy({ pool: low, rate: R, budget: N(3) });
  assert.equal(small.near, N(3));
  assert.equal(inverseBuy({ pool: poolAt(1000, 1.2), rate: R, budget: N(5) }).near, 0n);
  assert.equal(buybackBudget({ feesTotal: N(10), spent: N(1) }), N(1));
});

test("keeper plan is off under the pool minimum and orders inverse, buyback, sale", () => {
  const off = keeperPlan({ pool: poolAt(100, 0.5), rate: R, supply: Q(1e6), saleDue: true });
  assert.equal(off.active, false);
  assert.equal(off.reason, "pool-below-minimum");
  const below = keeperPlan({ pool: poolAt(1000, 0.9), rate: R, supply: Q(1e6), inverseBudget: N(10), buyback: N(2), saleDue: true });
  assert.deepEqual(below.actions.map((a) => a.kind), ["inverse-buy-burn", "buyback-burn", "sale-skipped"]);
  const above = keeperPlan({ pool: poolAt(1000, 1.4), rate: R, supply: Q(1e7), buyback: N(2), saleDue: true });
  assert.deepEqual(above.actions.map((a) => a.kind), ["sale"]);
});

test("schedule commitment and reveal: 12 times, one per 2 h slot, verifiable", () => {
  const salt = "11".repeat(32),
    day = "2026-11-05";
  const commitment = scheduleCommitment(day, salt);
  const times = saleTimes(day, salt, "SeedFromBlock111");
  assert.equal(times.length, 12);
  const start = Date.parse(`${day}T00:00:00Z`);
  times.forEach((t, i) => assert.ok(t >= start + i * 7_200_000 && t < start + (i + 1) * 7_200_000));
  assert.ok(verifySchedule({ day, commitment, salt, seed: "SeedFromBlock111", times }));
  assert.ok(!verifySchedule({ day, commitment, salt: "22".repeat(32), seed: "SeedFromBlock111", times }));
  assert.notDeepEqual(saleTimes(day, salt, "OtherSeed"), times);
});

test("24 h average is time weighted", () => {
  const now = 10 * 3_600_000 + 86_400_000;
  const samples = [
    { at: now - 4 * 3_600_000, price: "100" },
    { at: now - 1 * 3_600_000, price: "200" },
  ];
  assert.equal(average24h(samples, now), 125n);
  assert.equal(average24h([], now), 0n);
});

test("vault state and pool orientation", () => {
  const s = vaultState({ supply: "2000000", backing: N(1).toString().slice(0, -3), exit: { instant_cap_24h: "5" }, lsts: [] });
  assert.equal(s.rate, backingRate({ backing: s.backing, supply: s.supply }));
  assert.equal(s.exit.instantCap24h, 5n);
  const p = poolReserves({ token_account_ids: ["q.testnet", "wrap.testnet"], amounts: ["7", "9"], total_fee: 30 }, { wnear: "wrap.testnet", qgold: "q.testnet" });
  assert.deepEqual(p, { near: 9n, qgold: 7n, feeBps: 30 });
  assert.equal(poolReserves({ token_account_ids: ["a", "b"], amounts: ["1", "1"] }, { wnear: "wrap.testnet", qgold: "q" }), null);
  const paths = exitPaths(s);
  assert.equal(paths.find((x) => x.id === "lst").available, false);
  assert.equal(paths.find((x) => x.id === "near_queue").available, true);
});

function fakeKeeper(now, { poolMult = 1.5, poolNear = 1000, execute = false } = {}) {
  const db = openDatabase(":memory:");
  const pool = poolAt(poolNear, poolMult);
  let height = 100;
  const vault = {
    contractId: "qgold-vault.testnet",
    async view(m) {
      if (m === "get_state") return { supply: Q(10_000_000).toString(), backing: (Q(10_000_000) * R / QGOLD_ONE).toString(), fees_total: N(10).toString(), burned_total: "0", exit: {} };
      throw Error(m);
    },
  };
  const rhea = {
    contractId: "ref-finance-101.testnet",
    async view() {
      return { token_account_ids: ["wrap.testnet", "qgold-vault.testnet"], amounts: [pool.near.toString(), pool.qgold.toString()], total_fee: 30 };
    },
  };
  const provider = { async viewBlock() { height += 1; return { header: { height, random_value: `seed${height}` } }; } };
  const settings = { ...keeperSettings({}), execute };
  return new QgoldKeeper(db, { vault, rhea, poolId: 7, wnear: "wrap.testnet", provider, settings, clock: () => now });
}

test("keeper commits, seeds, then acts only at committed times and records dry runs", async () => {
  const day0 = Date.parse("2026-11-05T00:00:00Z");
  const k = fakeKeeper(day0 - 3_600_000); // commits for 11-04 and 11-05 the hour before
  await k.tick(day0 - 3_600_000);
  await k.tick(day0 - 3_000_000); // seeds fixed from a later block
  const row = k.db.prepare("SELECT * FROM qgold_keeper_days WHERE day='2026-11-05'").get();
  assert.ok(row.seed && row.times);
  const times = JSON.parse(row.times);
  assert.equal(await k.tick(times[0] - 1000), null); // nothing due yet
  const plan = await k.tick(times[0] + 1000);
  assert.ok(plan.active);
  const actions = k.db.prepare("SELECT * FROM qgold_keeper_actions WHERE day='2026-11-05'").all();
  assert.ok(actions.some((a) => a.kind === "sale" && a.state === "simulated" && BigInt(a.qgold) > 0n));
  // The same slot never runs twice.
  assert.equal(await k.tick(times[0] + 2000), null);
  // Public view hides today's times and salt; reveals ended days.
  const view = k.publicView(times[0] + 2000, { rate: R, supply: Q(10_000_000) });
  const today = view.schedule.find((d) => d.day === "2026-11-05");
  assert.equal(today.salt, null);
  assert.equal(today.times, null);
  assert.equal(today.done, 1);
  const later = k.publicView(day0 + 86_400_000 + 1000, {});
  const revealed = later.schedule.find((d) => d.day === "2026-11-05");
  assert.ok(verifySchedule({ day: revealed.day, commitment: revealed.commitment, salt: revealed.salt, seed: revealed.seed, times: revealed.times.map((t) => Date.parse(t)) }));
});

test("keeper skips while the pool is under the minimum and marks stale slots missed", async () => {
  const day0 = Date.parse("2026-11-05T00:00:00Z");
  const k = fakeKeeper(day0 - 3_600_000, { poolNear: 100 });
  await k.tick(day0 - 3_600_000);
  await k.tick(day0 - 3_000_000);
  const times = JSON.parse(k.db.prepare("SELECT times FROM qgold_keeper_days WHERE day='2026-11-05'").get().times);
  await k.tick(times[2] + 1000);
  const rows = k.db.prepare("SELECT slot,state,reason FROM qgold_keeper_actions WHERE day='2026-11-05' ORDER BY slot").all();
  assert.deepEqual(rows.map((r) => r.state), ["missed", "missed", "skipped"]);
  assert.equal(rows[2].reason, "pool-below-minimum");
});

test("token page answers before the vault exists, without invented numbers", async () => {
  const page = createQgoldPage({});
  const out = await page();
  assert.equal(out.status, "vault-pending");
  assert.equal(out.vault, null);
  assert.equal(out.pool.status, "none");
  assert.equal(out.fees.find((f) => f.id === "p2p").bps, 200);
  assert.equal(out.rules.salesPerDay, POLICY.salesPerDay);
});

test("token page with a vault, pool and keeper", async () => {
  const now = Date.parse("2026-11-05T10:00:00Z");
  const k = fakeKeeper(now);
  await k.tick(now);
  const page = createQgoldPage({
    vaultManifest: { vaultContract: "qgold-vault.testnet", tokenContract: "qgold-vault.testnet" },
    poolManifest: { poolId: 7, wnear: "wrap.testnet" },
    vault: k.vault,
    rhea: k.rhea,
    keeper: k,
    clock: () => now,
  });
  const out = await page();
  assert.equal(out.status, "live");
  assert.equal(out.vault.rate, R.toString());
  assert.equal(out.vault.buyPrice, ((R * 101n) / 100n).toString());
  assert.equal(out.pool.status, "live");
  assert.ok(out.pool.premiumBps >= 4990 && out.pool.premiumBps <= 5010);
  assert.equal(out.pool.keeperActive, true);
  assert.equal(out.keeper.ladder.length, 3);
  assert.equal(out.chart.length, 1);
});

test("token page copy stays on the public-page rules", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../src/economy/QgoldSection.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /hackathon|judge|demo day|presentation|pitch/i);
  assert.doesNotMatch(page, /lottery|jackpot|guaranteed return|profit/i);
  assert.match(page, /not an investment/);
});

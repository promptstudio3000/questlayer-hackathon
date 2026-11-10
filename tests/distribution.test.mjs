// Treasury distribution audit against a stateful fake rewards contract.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { NativeRewards } from "../server/native/rewards.mjs";
import {
  nativeManifest,
  publicationArgs,
} from "../server/native/reward-manifest.mjs";
import {
  auditDistribution,
  auditSummary,
  STORAGE_PRICE_PER_BYTE,
} from "../server/native/distribution.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { ACCOUNT_SUFFIX } from "../server/native/network.mjs";
import { ensureMapChainSchema } from "../server/map-rewards/chain.mjs";
import { ensurePayoutSchema } from "../server/payouts/worker.mjs";
import { scaledBucketCap } from "../server/native/allocation.mjs";

const NEAR = 10n ** 24n;
const CONTRACT = `rewards${ACCOUNT_SUFFIX}`;
// A minimal rewards contract: buckets, open days and their reservations.
function chain({ funded = NEAR / 5n } = {}) {
  const c = {
    coins: { available: funded / 2n, reserved: 0n, awarded: 0n },
    zones: { available: funded / 2n, reserved: 0n, awarded: 0n },
    funded,
    owed: 0n,
    pending: 0n,
    withdrawn: 0n,
    days: new Map(),
    mapDays: new Map(),
    payoutDays: new Map(),
    dateTotals: new Map(),
    balance: funded + 3n * NEAR, // liquidity plus storage stake
    storageUsage: 200000, // bytes → 2 NEAR locked for storage
  };
  c.publish = (m) => {
    const args = publicationArgs(m);
    const coinCost = BigInt(args.coin_unit) * BigInt(args.coin_count);
    const zoneCost = args.quests.reduce((n, q) => n + BigInt(q.reward), 0n);
    c.coins.available -= coinCost;
    c.coins.reserved += coinCost;
    c.zones.available -= zoneCost;
    c.zones.reserved += zoneCost;
    const date = args.day_id.match(/(\d{4}-\d{2}-\d{2})-v\d+$/)[1];
    const total = c.dateTotals.get(date) ?? { coins: 0n, zones: 0n };
    c.dateTotals.set(date, {
      coins: total.coins + coinCost,
      zones: total.zones + zoneCost,
    });
    c.days.set(args.day_id, {
      manifest_hash: args.manifest_hash,
      starts_at: args.starts_at,
      ends_at: args.ends_at,
      coin_count: args.coin_count,
      coin_unit: args.coin_unit,
      remaining: coinCost.toString(),
      quests: args.quests,
      winners: args.quests.map(() => null),
      closed: false,
      claims_accepted: 0,
      claims_limit: 256,
      storage_reserved: true,
    });
  };
  c.view = async (method, args = {}) => {
    const b = (x) => ({
      available: x.available.toString(),
      reserved: x.reserved.toString(),
      awarded: x.awarded.toString(),
    });
    if (method === "get_treasury")
      return {
        coins: b(c.coins),
        zones: b(c.zones),
        funded: c.funded.toString(),
        owed: c.owed.toString(),
        pending: c.pending.toString(),
        withdrawn: c.withdrawn.toString(),
        policy: "50/50-v1",
      };
    if (method === "get_day") return c.days.get(args.day_id) ?? null;
    if (method === "get_map_day") return c.mapDays.get(args.day_id) ?? null;
    if (method === "get_payout_day") return c.payoutDays.get(args.day_id) ?? null;
    if (method === "get_date_totals") {
      const t = c.dateTotals.get(args.date) ?? { coins: 0n, zones: 0n };
      return {
        date: args.date,
        coins: t.coins.toString(),
        zones: t.zones.toString(),
        cap: (NEAR / 10n).toString(),
      };
    }
    throw Error(method);
  };
  c.provider = {
    query: async () => ({
      amount: c.balance.toString(),
      storage_usage: c.storageUsage,
      code_hash: "x",
    }),
  };
  return c;
}
function fixture(opts) {
  const db = openDatabase(":memory:");
  const c = chain(opts);
  const native = new NativeRewards(
    db,
    c.provider,
    { contractId: CONTRACT, codeHash: "x", vaults: [] },
    { publicKey: "k", sign: () => "" },
  );
  native.view = c.view;
  const publish = async (day) => {
    const m = nativeManifest(
      buildCityPlan(PLZEN, day),
      await c.view("get_treasury"),
    );
    db.prepare(
      "INSERT INTO native_days(id,day,body,hash,state,updated_at) VALUES(?,?,?,?,'published',0)",
    ).run(m.id, m.day, JSON.stringify(m), m.hash);
    c.publish(m);
    return m;
  };
  return { db, c, native, publish };
}

test("two published days fully explain the reservations and the account covers every liability", async () => {
  const f = fixture();
  await f.publish("2026-11-01");
  await f.publish("2026-11-02");
  const a = await auditDistribution(f.native, { clock: () => 1 });
  assert.equal(a.status, "verified", JSON.stringify(a.checks));
  assert.deepEqual(a.failed, []);
  assert.equal(a.days.length, 2);
  assert.ok(a.days.every((d) => d.chain === "open" && d.manifestMatches));
  const liquidity = a.checks.find(
    (c) => c.name === "account-covers-liabilities",
  );
  assert.equal(
    BigInt(liquidity.liquid),
    f.c.balance - BigInt(f.c.storageUsage) * STORAGE_PRICE_PER_BYTE,
  );
  assert.equal(liquidity.liabilities, f.c.funded.toString());
  assert.deepEqual(auditSummary(a), {
    status: "verified",
    observedAt: 1,
    failed: [],
    reconciling: [],
    reason: undefined,
  });
});

test("chain acceptances missing locally after a restore are reconciling, not drift", async () => {
  const f = fixture();
  const m = await f.publish("2026-11-01");
  f.c.days.get(m.id).claims_accepted = 2;
  const a = await auditDistribution(f.native, { clock: () => 1 });
  assert.equal(a.status, "verified", JSON.stringify(a.failed));
  assert.deepEqual(a.reconciling, [{ id: m.id, unknownChainClaims: 2 }]);
  assert.deepEqual(auditSummary(a).reconciling, [m.id]);
});

test("a reservation no known day explains is drift", async () => {
  const f = fixture();
  await f.publish("2026-11-01");
  f.c.coins.available -= 1000n;
  f.c.coins.reserved += 1000n; // e.g. a day published by someone this server does not know
  const a = await auditDistribution(f.native);
  assert.equal(a.status, "drift");
  assert.deepEqual(a.failed, ["coin-reservations-explained"]);
});

test("a closed chain day no longer counts, and its release keeps the books balanced", async () => {
  const f = fixture();
  const m = await f.publish("2026-11-01");
  const day = f.c.days.get(m.id);
  // Close on chain: unclaimed coin budget and unwon prizes return to available.
  f.c.coins.reserved -= BigInt(day.remaining);
  f.c.coins.available += BigInt(day.remaining);
  const prizes = day.quests.reduce((n, q) => n + BigInt(q.reward), 0n);
  f.c.zones.reserved -= prizes;
  f.c.zones.available += prizes;
  day.closed = true;
  const a = await auditDistribution(f.native);
  assert.equal(a.status, "verified", JSON.stringify(a.checks));
  assert.equal(a.days[0].chain, "closed");
});

test("an account that cannot pay what it owes is drift even when the ledger balances", async () => {
  const f = fixture();
  await f.publish("2026-11-01");
  f.c.balance =
    BigInt(f.c.storageUsage) * STORAGE_PRICE_PER_BYTE + f.c.funded - 1n;
  const a = await auditDistribution(f.native);
  assert.deepEqual(a.failed, ["account-covers-liabilities"]);
  assert.equal(
    a.checks.find((c) => c.name === "account-covers-liabilities").headroom,
    "-1",
  );
});

test("a chain day whose terms differ from the durable manifest is drift", async () => {
  const f = fixture();
  const m = await f.publish("2026-11-01");
  f.c.days.get(m.id).coin_unit = "1";
  const a = await auditDistribution(f.native);
  assert.ok(a.failed.includes("open-days-match-manifests"));
});

test("more local confirmations than chain-accepted claims is drift", async () => {
  const f = fixture();
  const m = await f.publish("2026-11-01");
  f.db
    .prepare(
      "INSERT INTO native_reward_claims(id,day_id,kind,item_index,account_id,player_id,body,signature,state,run_after,created_at) VALUES('r1',?,'coin',0,'a'||?,'p','{}','s','confirmed',0,0)",
    )
    .run(m.id, ACCOUNT_SUFFIX);
  const a = await auditDistribution(f.native);
  assert.deepEqual(a.failed, ["receipts-within-chain-claims"]);
});

test("unreadable or malformed chain data is unavailable, never verified", async () => {
  const f = fixture();
  f.native.view = async () => ({ coins: {} });
  assert.equal((await auditDistribution(f.native)).status, "unavailable");
  const g = fixture();
  g.c.provider.query = async () => {
    throw Error("fetch failed");
  };
  const a = await auditDistribution(g.native);
  assert.equal(a.status, "unavailable");
  assert.match(a.reason, /fetch failed/);
});

test("a commitment on a date that this server did not publish is drift", async () => {
  const f = fixture();
  await f.publish("2026-11-01");
  const date = "2026-11-01";
  const total = f.c.dateTotals.get(date);
  f.c.dateTotals.set(date, { coins: total.coins + 5n, zones: total.zones });
  const a = await auditDistribution(f.native);
  assert.deepEqual(a.failed, ["date-totals-match-publications"]);
  const row = a.checks.find((c) => c.name === "date-totals-match-publications")
    .dates[0];
  assert.equal(row.date, date);
  assert.equal(BigInt(row.chainCoins) - BigInt(row.ourCoins), 5n);
});

test("a published map day explains its reservations and its date total", async () => {
  const f = fixture();
  await f.publish("2026-11-04");
  ensureMapChainSchema(f.db);
  const coins = 5n * 10n ** 22n,
    zones = 17n * 10n ** 21n;
  f.c.coins.available -= coins;
  f.c.coins.reserved += coins;
  f.c.zones.available -= zones;
  f.c.zones.reserved += zones;
  const t = f.c.dateTotals.get("2026-11-04");
  f.c.dateTotals.set("2026-11-04", { coins: t.coins + coins, zones: t.zones + zones });
  // One claim paid 1000 yocto from the coin reservation.
  f.c.coins.reserved -= 1000n;
  f.c.coins.awarded += 1000n;
  f.c.owed += 1000n;
  f.c.mapDays.set("map-2026-11-04-v1", {
    date: "2026-11-04",
    coins_reserved: coins.toString(),
    zones_reserved: zones.toString(),
    coins_left: (coins - 1000n).toString(),
    zones_left: zones.toString(),
    claims: 1,
    closed: false,
  });
  const before = await auditDistribution(f.native);
  assert.equal(before.status, "drift", "a map day this server does not know is drift");
  f.db
    .prepare("INSERT INTO map_chain_days VALUES(?,?,?,'published','tx',NULL,NULL,0)")
    .run("map-2026-11-04-v1", "2026-11-04", "{}");
  const a = await auditDistribution(f.native);
  assert.equal(a.status, "verified", JSON.stringify(a.failed));
  assert.ok(a.days.some((d) => d.kind === "map" && d.chain === "open"));
});

test("a published payout round explains its reservations and its date total", async () => {
  const f = fixture();
  await f.publish("2026-11-04");
  ensurePayoutSchema(f.db);
  const coins = 2380868n * 10n ** 15n;
  f.c.coins.available -= coins;
  f.c.coins.reserved += coins;
  const t = f.c.dateTotals.get("2026-11-04");
  f.c.dateTotals.set("2026-11-04", { coins: t.coins + coins, zones: t.zones });
  // Its one leaf is already minted: the reservation moved to awarded.
  f.c.coins.reserved -= coins;
  f.c.coins.awarded += coins;
  f.c.owed += coins;
  f.c.payoutDays.set("payout-2026-11-04-v1", {
    coins_reserved: coins.toString(),
    zones_reserved: "0",
    coins_left: "0",
    zones_left: "0",
    paid_leaves: 1,
    closed: false,
  });
  const before = await auditDistribution(f.native);
  assert.equal(before.status, "drift", "a payout round this server does not know is drift");
  f.db
    .prepare("INSERT INTO payout_days VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?)")
    .run("payout-2026-11-04-v1", "2026-11-04T13:45", "root", "{}", coins.toString(), 1, "published", 1, 1);
  const a = await auditDistribution(f.native);
  assert.equal(a.status, "verified", JSON.stringify(a.failed));
  assert.ok(a.days.some((d) => d.kind === "payout" && d.chain === "open"));
});

test("city day caps grow with funding and keep 0.006 NEAR on a small treasury", () => {
  assert.equal(scaledBucketCap(String(NEAR / 5n)), 6n * 10n ** 21n);
  assert.equal(scaledBucketCap(String(1000n * NEAR)), 20n * NEAR);
});

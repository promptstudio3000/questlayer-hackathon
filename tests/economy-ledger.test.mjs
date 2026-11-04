// Public prize pool ledger (/api/economy/ledger and the /economy page).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDatabase } from "../server/database.mjs";
import { NativeRewards } from "../server/native/rewards.mjs";
import { nativeManifest } from "../server/native/reward-manifest.mjs";
import { manifestCost } from "../server/native/allocation.mjs";
import {
  auraRoyalties,
  budgetByDate,
  confirmedPayouts,
  createPublicLedger,
  publishedDays,
  tradeFees,
  yieldCycle,
} from "../server/native/public-ledger.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { ACCOUNT_SUFFIX, EXPLORER_BASE } from "../server/native/network.mjs";
import { exactNear, shortNear } from "../src/economy/format.ts";

const NEAR = 10n ** 24n;
const CONTRACT = `rewards${ACCOUNT_SUFFIX}`;
const HASH = "CYsidYQZVycRWzL6WaAxbEjqCXsUf4G1spTBk1cndLue";
const treasury = {
  coins: { available: (NEAR / 10n).toString(), reserved: "0", awarded: "0" },
  zones: { available: (NEAR / 10n).toString(), reserved: "0", awarded: "0" },
  funded: (NEAR / 5n).toString(),
  owed: "0",
  pending: "0",
  withdrawn: "0",
};

function fixture() {
  const db = openDatabase(":memory:");
  const native = new NativeRewards(
    db,
    {},
    { contractId: CONTRACT, codeHash: "x", vaults: [] },
    { publicKey: "k", sign: () => "" },
  );
  const publish = (day, tx = null) => {
    const m = nativeManifest(buildCityPlan(PLZEN, day), treasury);
    db.prepare(
      "INSERT INTO native_days(id,day,body,hash,state,transaction_hash,updated_at) VALUES(?,?,?,?,'published',?,0)",
    ).run(m.id, m.day, JSON.stringify(m), m.hash, tx);
    return m;
  };
  let seq = 0;
  const claim = (state, amount, tx) =>
    db
      .prepare(
        "INSERT INTO native_reward_claims(id,day_id,kind,item_index,account_id,player_id,body,signature,state,run_after,transaction_hash,amount,created_at,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,0,?)",
      )
      .run(`c${++seq}`, "d", "coin", seq, `p${seq}${ACCOUNT_SUFFIX}`, "secret-player", "{}", "sig", state, tx, amount, 1000 + seq);
  return { db, native, publish, claim };
}

test("published days carry their exact budget and an explorer link", () => {
  const f = fixture();
  const m1 = f.publish("2026-11-01", HASH);
  f.publish("2026-11-02");
  const days = publishedDays(f.db);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, "2026-11-02", "newest first");
  const d1 = days.find((d) => d.id === m1.id);
  assert.equal(d1.total, manifestCost(m1).total.toString());
  assert.equal(d1.explorerUrl, `${EXPLORER_BASE}/txns/${HASH}`);
  assert.equal(days.find((d) => d.id !== m1.id).explorerUrl, null);
  const budget = budgetByDate(days);
  assert.equal(budget.length, 2);
  assert.equal(budget.find((b) => b.date === "2026-11-01").total, d1.total);
});

test("payouts list only confirmed claims, sum exactly and never expose player ids", () => {
  const f = fixture();
  f.claim("confirmed", "1000000000000000000001", HASH);
  f.claim("confirmed", "2", null);
  f.claim("queued", "999", null);
  const p = confirmedPayouts(f.db);
  assert.equal(p.count, 2);
  assert.equal(p.total, "1000000000000000000003");
  assert.equal(p.recent.length, 2);
  assert.equal(p.recent.find((r) => r.transactionHash === HASH).explorerUrl, `${EXPLORER_BASE}/txns/${HASH}`);
  assert.doesNotMatch(JSON.stringify(p), /secret-player|sig/);
});

test("ledger composes audit, yield, stNEAR and proof, and survives a failing source", async () => {
  const f = fixture();
  f.publish("2026-11-03", HASH);
  f.native.lastAudit = {
    status: "verified",
    observedAt: 5,
    failed: [],
    checks: [
      { name: "ledger-conservation", ok: true, funded: "1" },
      { name: "account-covers-liabilities", ok: true, liquid: "77" },
    ],
    totals: { funded: "200", liabilities: "150", awarded: "50", withdrawn: "0" },
    scope: "Reward treasury.",
  };
  const proof = JSON.parse(readFileSync(new URL("../public/native-yield-cycle-proof.json", import.meta.url), "utf8"));
  let calls = 0;
  const read = createPublicLedger({
    native: f.native,
    treasury: async () => {
      throw new Error("RPC down");
    },
    yieldBacking: async () => {
      calls++;
      return { paid: "3550000000000000000", committed: "0", free: "3550000000000000000", vaults: [{ accountId: `v1${ACCOUNT_SUFFIX}`, gamePaid: "3550000000000000000" }] };
    },
    cycleProof: () => proof,
    clock: () => 10,
  });
  const l = await read();
  assert.equal(l.unit, "yoctoNEAR");
  assert.equal(l.treasury.funded, "200");
  assert.equal(l.treasury.liquid, "77");
  assert.equal(l.audit.status, "verified");
  assert.deepEqual(l.audit.checks.map((c) => Object.keys(c).sort()), [["name", "ok"], ["name", "ok"]]);
  assert.equal(l.realizedYield.paid, "3550000000000000000");
  assert.equal(l.stnear.status, "unavailable");
  assert.match(l.stnear.reason, /RPC down/);
  assert.equal(l.days.length, 1);
  assert.equal(l.yieldCycle.realizedYieldYocto, proof.realizedYieldYocto);
  assert.equal(l.yieldCycle.flushes.length, 3);
  assert.ok(l.yieldCycle.flushes.every((x) => x.explorerUrl.startsWith(`${EXPLORER_BASE}/txns/`)));
  await read();
  assert.equal(calls, 1, "cached");
});

test("ledger answers on a host without native rewards", async () => {
  const l = await createPublicLedger({})();
  assert.equal(l.treasury.status, "not-configured");
  assert.equal(l.audit.status, "not-configured");
  assert.deepEqual(l.days, []);
  assert.equal(l.yieldCycle, null);
  assert.equal(l.tradeFees, null);
  assert.equal(l.auraRoyalties, null);
});

test("trade fees count only sweeps that reached the prize pool", () => {
  const hash = (c) => c.repeat(44);
  const t = tradeFees({
    verifier: "intents.questlayer-dev-20261101.testnet",
    feePips: 20000,
    collector: "questlayer-dev-20261101.testnet",
    rewardsContract: "questlayer-rewards-20261101b.testnet",
    sweeps: [
      { receiptId: "intents-fees-2026-11-05", amount: "30000000000000000000000", withdrawTransaction: hash("A"), unwrapTransaction: hash("B"), fundTransaction: hash("C"), finishedAt: "2026-11-05T05:31:00Z" },
      { receiptId: "intents-fees-2026-11-06", amount: "20000000000000000000000", withdrawTransaction: hash("D"), startedAt: "2026-11-06T05:30:00Z" },
    ],
  });
  assert.equal(t.feePips, 20000);
  assert.equal(t.swept, "30000000000000000000000");
  assert.deepEqual(t.sweeps.map((s) => s.funded), [true, false]);
  assert.equal(t.sweeps[0].fundUrl, `${EXPLORER_BASE}/txns/${hash("C")}`);
  assert.equal(t.sweeps[1].fundUrl, null);
  assert.equal(tradeFees(null), null);
});

test("Aura royalties count only funded sweeps and show the Mintbase proof sale", () => {
  const hash = (c) => c.repeat(44);
  const r = auraRoyalties({
    network: "testnet",
    contract: "nfts.questlayer-dev-20261101.testnet",
    royalty: { account_id: "royalties.questlayer-dev-20261101.testnet", bps: 200 },
    sweeps: [
      { receiptId: "aura-royalties-2026-11-05", amount: "15000000000000000000000", fundTransaction: hash("E"), finishedAt: "2026-11-05T05:40:00Z" },
      { receiptId: "aura-royalties-2026-11-06", amount: "12000000000000000000000", startedAt: "2026-11-06T05:40:00Z" },
    ],
    mintbaseProof: {
      market: "market-v2-beta.mintspace2.testnet",
      tokenId: "aura:polar:9",
      price: "100000000000000000000000",
      royaltyReceived: "1980000000000000000000",
      transactions: [{ label: "Mint a proof Aura to the operator", transaction: hash("F") }, { label: "Buy aura:polar:9 on Mintbase", transaction: hash("G") }],
    },
  });
  assert.equal(r.bps, 200);
  assert.equal(r.payee, "royalties.questlayer-dev-20261101.testnet");
  assert.equal(r.swept, "15000000000000000000000");
  assert.deepEqual(r.sweeps.map((s) => s.funded), [true, false]);
  assert.equal(r.mintbaseProof.buyUrl, `${EXPLORER_BASE}/txns/${hash("G")}`);
  // No royalty set yet: nothing to show.
  assert.equal(auraRoyalties({ contract: "nfts.x.testnet", royalty: null, sweeps: [] }), null);
  assert.equal(auraRoyalties(null), null);
});

test("the cycle proof flushes add up to the realized yield it claims", () => {
  const proof = JSON.parse(readFileSync(new URL("../public/native-yield-cycle-proof.json", import.meta.url), "utf8"));
  const c = yieldCycle(proof);
  const sum = c.flushes.reduce((a, f) => a + BigInt(f.gamePaidYocto), 0n);
  assert.equal(sum.toString(), c.realizedYieldYocto);
  assert.equal(BigInt(c.fundedAfter) - BigInt(c.fundedBefore), sum);
});

test("yocto formatting is exact and never rounds small yield to zero", () => {
  assert.equal(exactNear("3550000000000000000"), "0.00000355");
  assert.equal(shortNear("3550000000000000000"), "0.00000355");
  assert.equal(exactNear("264475212477481805278"), "0.000264475212477481805278");
  assert.equal(shortNear("264475212477481805278", 6), "0.000264");
  assert.equal(shortNear("200264475212477481805278"), "0.2002");
  assert.equal(exactNear("2000000000000000000000000"), "2");
  assert.equal(exactNear("0"), "0");
  assert.equal(exactNear(null), "—");
});

test("economy page copy stays neutral", () => {
  const page = readFileSync(new URL("../src/economy/EconomyPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /hackathon|judge|demo day|presentation|pitch/i);
  assert.doesNotMatch(page, /city pot|city share/i);
});

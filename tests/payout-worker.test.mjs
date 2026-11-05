import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { setPotentialSource } from "../server/map-rewards/day-plan.mjs";
import { recordMapBudget } from "../server/map-rewards/budget.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";
import {
  pendingPayout,
  preparePayoutDay,
  runPayoutWorker,
  unpaidRewards,
} from "../server/payouts/worker.mjs";
import { verifyPayoutClaim, PAYOUT_MIN_YOCTO } from "../server/payouts/payout-tree.mjs";

const NOW = Date.parse("2026-11-05T20:30:00Z"); // 21:30 in Prague: every wave is open
const NEXT = Date.parse("2026-11-06T01:00:00Z"); // 02:00 the next local day
const PLZEN = { lat: 49.7477, lng: 13.3776 };
const fix = (p, t) => ({ ...p, accuracy: 5, timestamp: t });

async function setup() {
  setPotentialSource(() => new Map());
  const db = openDatabase(":memory:");
  // 100 NEAR a day for coins at R = 0.001: a coin is worth well over one QGOLD unit.
  recordMapBudget(db, {
    coinYocto: (10n ** 26n).toString(),
    zoneYocto: (10n ** 25n).toString(),
    rateYocto: (10n ** 21n).toString(),
  });
  const walker = createPlayer(db, "Walker", NOW),
    guest = createPlayer(db, "Guest", NOW);
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run("walker.testnet", walker, NOW);
  const w = await ensureWorld(db, PLZEN, false, NOW);
  const coins = worldView(db, w.id, walker, { now: NOW }).coins;
  return { db, walker, guest, w, coins };
}

test("the nightly payout pays each account once, from one root, and never twice", async () => {
  const { db, walker, guest, coins } = await setup();
  try {
    let t = NOW;
    const mine = [coins[0], coins.find((c) => Math.hypot(c.lat - coins[0].lat, c.lng - coins[0].lng) < 0.003 && c.id !== coins[0].id)];
    for (const c of mine.filter(Boolean)) {
      claimCoin(db, walker, c.id, fix(c, t), t);
      t += 120_000;
    }
    // A guest without a NEAR account: the coin waits for a later payout.
    const other = coins.find((c) => !mine.includes(c));
    claimCoin(db, guest, other.id, fix(other, NOW + 3_600_000), NOW + 3_600_000);

    // The guest's coin shows as pending QGOLD that waits for an account.
    const guestPending = pendingPayout(db, guest);
    assert.equal(guestPending.yocto, "0");
    assert.equal(guestPending.awaitingAccount, 1);
    assert.ok(guestPending.units > 0);

    const waiting = unpaidRewards(db, NEXT);
    assert.ok(waiting.length >= 1 && waiting.every((i) => i.accountId === "walker.testnet"));
    const pending = pendingPayout(db, walker);
    assert.ok(BigInt(pending.yocto) >= PAYOUT_MIN_YOCTO);
    assert.ok(pending.units > 0 && pending.awaitingAccount === 0);

    // Before midnight nothing is built for today.
    assert.equal(preparePayoutDay(db, NOW)?.date, "2026-11-04");

    const calls = [];
    const call = async (method, args) => {
      calls.push({ method, args });
      return `tx-${calls.length}`;
    };
    const r = await runPayoutWorker(db, { call, now: NEXT });
    assert.equal(r.prepared, "payout-2026-11-05-v1");
    const publish = calls.find((c) => c.method === "publish_payout_day").args;
    assert.equal(publish.leaves, 1);
    assert.equal(BigInt(publish.coins_yocto) + BigInt(publish.zones_yocto), BigInt(pending.yocto));
    const claim = calls.find((c) => c.method === "claim_payout").args;
    assert.equal(claim.claims.length, 1);
    assert.equal(claim.claims[0].account_id, "walker.testnet");
    assert.ok(verifyPayoutClaim(claim.day_id, publish.root, claim.claims[0]));
    assert.equal(r.sent, 1);
    assert.equal(pendingPayout(db, walker).yocto, "0");

    // A second pass the same night sends nothing new.
    const again = await runPayoutWorker(db, { call, now: NEXT + 60_000 });
    assert.equal(again.prepared, null);
    assert.equal(calls.filter((c) => c.method === "claim_payout").length, 1);

    // The guest gets an account: their coin joins the next night's payout.
    db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run("guest.testnet", guest, NEXT);
    const later = await runPayoutWorker(db, { call, now: NEXT + 86_400_000 });
    assert.equal(later.prepared, "payout-2026-11-06-v1");
    const last = calls.filter((c) => c.method === "claim_payout").at(-1).args;
    assert.deepEqual(last.claims.map((c) => c.account_id), ["guest.testnet"]);

    // After the grace period the days are closed.
    const end = await runPayoutWorker(db, { call, now: NEXT + 5 * 86_400_000 });
    assert.ok(end.closed >= 2);
  } finally {
    setPotentialSource(null);
    db.close();
  }
});

test("a failed claim batch retries later and a refused publish stays pending", async () => {
  const { db, walker, coins } = await setup();
  try {
    claimCoin(db, walker, coins[0].id, fix(coins[0], NOW), NOW);
    let fail = "publish";
    const call = async (method) => {
      if (fail === "publish" && method === "publish_payout_day") throw new Error("Insufficient liquid funding");
      if (fail === "claim" && method === "claim_payout") throw new Error("RPC timeout");
      return "tx";
    };
    const first = await runPayoutWorker(db, { call, now: NEXT });
    assert.equal(first.published, 0);
    assert.equal(db.prepare("SELECT state FROM payout_days").get().state, "pending");
    fail = "claim";
    const second = await runPayoutWorker(db, { call, now: NEXT + 60_000 });
    assert.equal(second.published, 1);
    assert.equal(second.failed, 1);
    assert.equal(db.prepare("SELECT state FROM payout_claims").get().state, "queued");
    fail = null;
    const third = await runPayoutWorker(db, { call, now: NEXT + 3_600_000 });
    assert.equal(third.sent, 1);
  } finally {
    setPotentialSource(null);
    db.close();
  }
});

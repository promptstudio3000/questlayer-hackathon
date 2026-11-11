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
import {
  verifyPayoutClaim,
  PAYOUT_MIN_YOCTO,
} from "../server/payouts/payout-tree.mjs";

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
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    "walker.testnet",
    walker,
    NOW,
  );
  const w = await ensureWorld(db, PLZEN, false, NOW);
  const coins = worldView(db, w.id, walker, { now: NOW }).coins;
  return { db, walker, guest, w, coins };
}

// Immediate, independently observable mint completion for the ordinary game flow.
// Failure/restart/interleaving cases use delayed callbacks in payout-recovery.test.
function paidChain() {
  const days = new Map(),
    paid = new Map(),
    calls = [];
  return {
    calls,
    async view(method, args) {
      if (method === "get_payout_config") return { settlement_status: true };
      const d = days.get(args.day_id);
      if (method === "get_payout_day") return d || null;
      if (method === "get_payout_progress")
        return (
          d && {
            root: d.root,
            leaves: d.leaves,
            closed: d.closed,
            paid_leaves: paid.get(args.day_id).size,
            pending_leaves: 0,
            statuses: args.indexes.map((i) =>
              paid.get(args.day_id).has(i) ? "paid" : "unclaimed",
            ),
          }
        );
      throw Error(`Unexpected view ${method}`);
    },
    async call(method, args) {
      calls.push({ method, args });
      if (method === "publish_payout_day") {
        days.set(args.day_id, {
          ...args,
          coins_reserved: args.coins_yocto,
          zones_reserved: args.zones_yocto,
          published_at: NEXT,
          closed: false,
        });
        paid.set(args.day_id, new Set());
      } else if (method === "claim_payout") {
        for (const c of args.claims) paid.get(args.day_id).add(c.index);
      } else if (method === "close_payout_day") {
        assert.equal(paid.get(args.day_id).size, days.get(args.day_id).leaves);
        days.get(args.day_id).closed = true;
      }
      return `tx-${calls.length}`;
    },
  };
}

test("the nightly payout pays each account once, from one root, and never twice", async () => {
  const { db, walker, guest, coins } = await setup();
  try {
    let t = NOW;
    const mine = [
      coins[0],
      coins.find(
        (c) =>
          Math.hypot(c.lat - coins[0].lat, c.lng - coins[0].lng) < 0.003 &&
          c.id !== coins[0].id,
      ),
    ];
    for (const c of mine.filter(Boolean)) {
      claimCoin(db, walker, c.id, fix(c, t), t);
      t += 120_000;
    }
    // A guest without a NEAR account: the coin waits for a later payout.
    const other = coins.find((c) => !mine.includes(c));
    claimCoin(
      db,
      guest,
      other.id,
      fix(other, NOW + 3_600_000),
      NOW + 3_600_000,
    );

    // The guest's coin shows as pending QGOLD that waits for an account.
    const guestPending = pendingPayout(db, guest);
    assert.equal(guestPending.yocto, "0");
    assert.equal(guestPending.awaitingAccount, 1);
    assert.ok(guestPending.units > 0);

    const waiting = unpaidRewards(db, NEXT);
    assert.ok(
      waiting.length >= 1 &&
        waiting.every((i) => i.accountId === "walker.testnet"),
    );
    const pending = pendingPayout(db, walker);
    assert.ok(BigInt(pending.yocto) >= PAYOUT_MIN_YOCTO);
    assert.ok(pending.units > 0 && pending.awaitingAccount === 0);

    // Before midnight nothing is built for today.
    assert.equal(preparePayoutDay(db, NOW)?.date, "2026-11-04");

    const chain = paidChain(),
      { calls } = chain;
    const r = await runPayoutWorker(db, { ...chain, now: NEXT });
    assert.equal(r.prepared, "payout-2026-11-05-v1");
    const publish = calls.find((c) => c.method === "publish_payout_day").args;
    assert.equal(publish.leaves, 1);
    assert.equal(
      BigInt(publish.coins_yocto) + BigInt(publish.zones_yocto),
      BigInt(pending.yocto),
    );
    const claim = calls.find((c) => c.method === "claim_payout").args;
    assert.equal(claim.claims.length, 1);
    assert.equal(claim.claims[0].account_id, "walker.testnet");
    assert.ok(verifyPayoutClaim(claim.day_id, publish.root, claim.claims[0]));
    assert.equal(r.sent, 1);
    assert.equal(pendingPayout(db, walker).yocto, pending.yocto);

    // A second pass the same night sends nothing new.
    const again = await runPayoutWorker(db, { ...chain, now: NEXT + 60_000 });
    assert.equal(again.prepared, null);
    assert.equal(pendingPayout(db, walker).yocto, "0");
    assert.equal(calls.filter((c) => c.method === "claim_payout").length, 1);

    // The guest gets an account: their coin joins the next night's payout.
    db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
      "guest.testnet",
      guest,
      NEXT,
    );
    const later = await runPayoutWorker(db, {
      ...chain,
      now: NEXT + 86_400_000,
    });
    assert.equal(later.prepared, "payout-2026-11-06-v1");
    const last = calls.filter((c) => c.method === "claim_payout").at(-1).args;
    assert.deepEqual(
      last.claims.map((c) => c.account_id),
      ["guest.testnet"],
    );

    // After the grace period the days are closed.
    const end = await runPayoutWorker(db, {
      ...chain,
      now: NEXT + 5 * 86_400_000,
    });
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
    const chain = paidChain();
    const call = async (method, args) => {
      if (fail === "publish" && method === "publish_payout_day")
        throw new Error("Insufficient liquid funding");
      if (fail === "claim" && method === "claim_payout")
        throw new Error("RPC timeout");
      return chain.call(method, args);
    };
    const first = await runPayoutWorker(db, {
      view: chain.view,
      call,
      now: NEXT,
    });
    assert.equal(first.published, 0);
    assert.equal(
      db.prepare("SELECT state FROM payout_days").get().state,
      "pending",
    );
    fail = "claim";
    const second = await runPayoutWorker(db, {
      view: chain.view,
      call,
      now: NEXT + 60_000,
    });
    assert.equal(second.published, 1);
    assert.equal(second.failed, 1);
    assert.equal(
      db.prepare("SELECT state FROM payout_claims").get().state,
      "sent",
    ); // outcome unknown until reconciled
    fail = null;
    const third = await runPayoutWorker(db, {
      view: chain.view,
      call,
      now: NEXT + 3_600_000,
    });
    assert.equal(third.sent, 1);
  } finally {
    setPotentialSource(null);
    db.close();
  }
});

test("dust remains visible across nights and follows its eventual confirmed leaf", async () => {
  const { db, walker, coins } = await setup();
  try {
    db.prepare("UPDATE coins SET value_u=9 WHERE id=?").run(coins[0].id);
    claimCoin(db, walker, coins[0].id, fix(coins[0], NOW), NOW);
    const before = pendingPayout(db, walker);
    assert.ok(BigInt(before.yocto) < PAYOUT_MIN_YOCTO);
    assert.equal(preparePayoutDay(db, NEXT).state, "empty");
    assert.equal(pendingPayout(db, walker).yocto, before.yocto);
    const later = NEXT + 20 * 3_600_000;
    const world = await ensureWorld(db, PLZEN, false, later);
    const coin = worldView(db, world.id, walker, { now: later }).coins[0];
    db.prepare("UPDATE coins SET value_u=2 WHERE id=?").run(coin.id);
    claimCoin(db, walker, coin.id, fix(coin, later), later);
    const total = pendingPayout(db, walker).yocto;
    assert.ok(BigInt(total) >= PAYOUT_MIN_YOCTO);
    const chain = paidChain();
    await runPayoutWorker(db, { ...chain, now: NEXT + 86_400_000 });
    const publish = chain.calls.find(
      (c) => c.method === "publish_payout_day",
    ).args;
    assert.equal(publish.coins_yocto, total);
    assert.equal(publish.zones_yocto, "0");
    assert.equal(pendingPayout(db, walker).yocto, total);
    assert.equal(
      db.prepare("SELECT COUNT(DISTINCT day_id) n FROM payout_items").get().n,
      1,
    );
    await runPayoutWorker(db, { ...chain, now: NEXT + 86_400_000 + 60_000 });
    assert.equal(pendingPayout(db, walker).yocto, "0");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_items").get().n, 2);
  } finally {
    setPotentialSource(null);
    db.close();
  }
});

test("payout rounds mint within minutes, and the city demo pays like the map", async () => {
  const { db, walker, coins } = await setup();
  try {
    // The city demo (arena) carries the same backed coins as the real map.
    const demo = await ensureWorld(db, PLZEN, true, NOW);
    const demoCoins = worldView(db, demo.id, walker, { now: NOW }).coins;
    assert.ok(demoCoins.length > 0);
    // Same value as a plain map coin (the first GPS world here is a pioneer, x2).
    assert.ok(demoCoins.every((c) => c.value_u > 0 && c.value_u * 2 === coins[0].value_u));
    claimCoin(db, walker, demoCoins[0].id, fix(demoCoins[0], NOW), NOW);
    assert.equal(unpaidRewards(db, NOW + 1).length, 1);

    const chain = paidChain(),
      { calls } = chain,
      roundMs = 5 * 60_000;
    // The first round after the pickup (one minute of lag) pays it.
    const r = await runPayoutWorker(db, { ...chain, now: NOW + 2 * 60_000, roundMs });
    assert.equal(r.prepared, "payout-2026-11-05-v1");
    assert.equal(r.sent, 1);
    assert.equal(
      db.prepare("SELECT date FROM payout_days WHERE day_id=?").get(r.prepared).date,
      "2026-11-05T21:31",
    );

    // Within the round interval nothing new is built.
    // (Not the demo coin's twin: one spot pays once, in either world.)
    const c = coins.find((x) => x.lat !== demoCoins[0].lat || x.lng !== demoCoins[0].lng);
    claimCoin(db, walker, c.id, fix(c, NOW + 3 * 60_000), NOW + 3 * 60_000);
    const quiet = await runPayoutWorker(db, { ...chain, now: NOW + 4 * 60_000, roundMs });
    assert.equal(quiet.prepared, null);
    assert.equal(quiet.paid, 1, "the first round's leaf is confirmed paid");

    // The next round pays the new coin under the next contract id.
    const next = await runPayoutWorker(db, { ...chain, now: NOW + 8 * 60_000, roundMs });
    assert.equal(next.prepared, "payout-2026-11-05-v2");
    assert.equal(calls.filter((x) => x.method === "claim_payout").length, 2);

    // A round with nothing to pay writes nothing.
    const empty = await runPayoutWorker(db, { ...chain, now: NOW + 20 * 60_000, roundMs });
    assert.equal(empty.prepared, null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_days").get().n, 2);

    // The nightly mode picks the next free version for its date.
    const nightly = await runPayoutWorker(db, { ...chain, now: NEXT });
    assert.equal(nightly.prepared, "payout-2026-11-05-v3");
  } finally {
    setPotentialSource(null);
    db.close();
  }
});

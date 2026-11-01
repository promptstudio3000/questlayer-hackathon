import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeInteger,
  readStakingPool,
  quoteNetYield,
  weightedAccess,
  YOCTO,
} from "../server/native/staking-pool.mjs";
import { ExitScheduler } from "../server/native/exit-scheduler.mjs";
import { TreasuryModel } from "../server/native/treasury-model.mjs";
import {
  NETWORK,
  ACCOUNT_SUFFIX as SUFFIX,
  NETWORK_LABEL,
} from "../server/native/network.mjs";
const OTHER_NETWORK = NETWORK === "mainnet" ? "testnet" : "mainnet";

test("native math rejects floating and overflowing balances and never spends unrealized profit or loss recovery", () => {
  for (const input of [1, -1n, "01", "1e24", "1.1", 2n ** 128n])
    assert.throws(() => nativeInteger(input));
  assert.equal(nativeInteger((2n ** 128n - 1n).toString()), 2n ** 128n - 1n);
  const profit = quoteNetYield({
    value: 110n * YOCTO,
    flowAdjustedHighWater: 100n * YOCTO,
    contributionBps: 5000,
  });
  assert.equal(profit.gameEstimate, 5n * YOCTO);
  assert.equal(profit.retainedEstimate, 5n * YOCTO);
  assert.equal(profit.spendable, 0n);
  const recovery = quoteNetYield({
    value: 99n * YOCTO,
    flowAdjustedHighWater: 100n * YOCTO,
    contributionBps: 10000,
  });
  assert.equal(recovery.gameEstimate, 0n);
  assert.equal(recovery.lossToRecover, YOCTO);
  assert.equal(
    quoteNetYield({
      value: 100n * YOCTO,
      flowAdjustedHighWater: 100n * YOCTO,
      contributionBps: 10000,
    }).gain,
    0n,
  );
  for (const bps of [0, 1, 3333, 5000, 9999, 10000]) {
    const q = quoteNetYield({
      value: 101n,
      flowAdjustedHighWater: 13n,
      contributionBps: bps,
    });
    assert.equal(q.gameEstimate + q.retainedEstimate, 88n);
  }
});

test("E+2 tranche and contribution maturity preserves older access through top-ups and staged increases", () => {
  const old = { activeValue: 100n * YOCTO, confirmedEpoch: 10 },
    topup = { activeValue: YOCTO, confirmedEpoch: 12 };
  const view = (epoch, history = [{ epoch: 10, bps: 10000 }]) =>
    weightedAccess({
      tranches: [old, ...(epoch >= 12 ? [topup] : [])],
      epoch,
      contributionHistory: history,
    });
  assert.equal(view(11).tier, 1);
  assert.equal(view(12).tier, 3);
  assert.equal(view(12).maturedActiveValue, 100n * YOCTO);
  assert.equal(view(14).maturedActiveValue, 101n * YOCTO);
  const history = [
    { epoch: 10, bps: 5000 },
    { epoch: 12, bps: 7500 },
    { epoch: 13, bps: 10000 },
  ];
  assert.equal(view(13, history).eligibleBps, 5000);
  assert.equal(view(14, history).eligibleBps, 7500);
  assert.equal(view(15, history).eligibleBps, 10000);
  const decrease = [
    ...history,
    { epoch: 15, bps: 0 },
    { epoch: 15, bps: 10000 },
  ];
  assert.equal(view(15, decrease).weighted, 0n);
  assert.equal(view(17, decrease).tier, 3);
  assert.equal(
    weightedAccess({
      tranches: [{ ...old, activeValue: 49n * YOCTO }],
      epoch: 20,
      contributionHistory: [{ epoch: 10, bps: 10000 }],
    }).tier,
    1,
  );
});

const ticket = (id, kind = "principal", amount = "100") => ({
  id,
  owner: `alice${SUFFIX}`,
  kind,
  amount,
});
test("new exits and daily game harvests cannot reset a sealed account's older unlock", () => {
  let queue = new ExitScheduler();
  queue.enqueue(ticket("first"));
  const first = queue.seal(10);
  queue.acknowledgeUnstake(first.id, { success: true, confirmedEpoch: 11 });
  queue.enqueue(ticket("second"));
  queue.enqueue(ticket("yield", "game_yield", "9"));
  const snapshot = queue.snapshot();
  assert.throws(() => queue.seal(12), /older batch/);
  assert.deepEqual(queue.snapshot(), snapshot);
  assert.equal(snapshot.batch.unlockEpoch, 15);
  queue = new ExitScheduler(JSON.parse(JSON.stringify(snapshot)));
  assert.throws(() =>
    queue.beginWithdraw(first.id, { epoch: 14, poolCanWithdraw: true }),
  );
  assert.throws(() =>
    queue.beginWithdraw(first.id, { epoch: 15, poolCanWithdraw: false }),
  );
  queue.beginWithdraw(first.id, { epoch: 15, poolCanWithdraw: true });
  const pending = queue.snapshot();
  assert.throws(() =>
    queue.acknowledgeWithdraw(first.id, {
      success: true,
      receiptId: "partial",
      received: "99",
    }),
  );
  assert.deepEqual(queue.snapshot(), pending);
  const settled = queue.acknowledgeWithdraw(first.id, {
    success: true,
    receiptId: "received-1",
    received: "101",
  });
  assert.equal(settled.unclassifiedSurplus, "1");
  assert.deepEqual(
    queue.acknowledgeWithdraw(first.id, {
      success: true,
      receiptId: "received-1",
      received: "101",
    }),
    settled,
  );
  assert.throws(() =>
    queue.acknowledgeWithdraw(first.id, {
      success: true,
      receiptId: "received-1",
      received: "102",
    }),
  );
  const second = queue.seal(15);
  assert.equal(second.amount, "109");
  queue.acknowledgeUnstake(second.id, { success: true, confirmedEpoch: 15 });
  assert.equal(queue.snapshot().batch.unlockEpoch, 19);
  assert.equal(queue.snapshot().closed[0].unlockEpoch, 15);
});

test("failed asynchronous pool actions retain obligations and original ordering without fake receipts", () => {
  const queue = new ExitScheduler();
  queue.enqueue(ticket("first"));
  const first = queue.seal(1);
  queue.enqueue(ticket("later"));
  queue.acknowledgeUnstake(first.id, { success: false, confirmedEpoch: 1 });
  assert.deepEqual(
    queue.snapshot().queued.map((t) => t.id),
    ["first", "later"],
  );
  const retry = queue.seal(2);
  assert.notEqual(first.id, retry.id);
  assert.throws(() =>
    queue.acknowledgeUnstake(first.id, { success: true, confirmedEpoch: 2 }),
  );
  queue.acknowledgeUnstake(retry.id, { success: true, confirmedEpoch: 2 });
  queue.beginWithdraw(retry.id, { epoch: 6, poolCanWithdraw: true });
  queue.acknowledgeWithdraw(retry.id, { success: false });
  assert.equal(queue.snapshot().batch.unlockEpoch, 6);
  assert.equal(queue.snapshot().batch.stage, "unlocking");
  assert.equal(queue.snapshot().closed.length, 0);
  queue.beginWithdraw(retry.id, { epoch: 7, poolCanWithdraw: true });
  queue.acknowledgeWithdraw(retry.id, {
    success: true,
    receiptId: "received",
    received: "200",
  });
  assert.equal(queue.snapshot().closed.length, 1);
  assert.deepEqual(queue.enqueue(ticket("first")), ticket("first"));
  assert.equal(queue.snapshot().queued.length, 0);
  assert.throws(() => queue.enqueue(ticket("first", "principal", "101")));
});

const receipt = (id, amount) => ({
  id,
  amount,
  kind: "realized_game_yield",
  proofHash: "a".repeat(64),
});
test("restored native model state rejects changed policy allocations and duplicate cash receipts", () => {
  const treasury = new TreasuryModel();
  treasury.receive(receipt("one", "100"));
  const corrupt = treasury.snapshot();
  corrupt.receipts[0].allocation.coins = "40";
  corrupt.receipts[0].allocation.zones = "60";
  corrupt.available.coins = "40";
  corrupt.available.zones = "60";
  assert.throws(() => new TreasuryModel(corrupt), /policy/);
  const queue = new ExitScheduler();
  queue.enqueue(ticket("one"));
  const batch = queue.seal(1);
  queue.acknowledgeUnstake(batch.id, { success: true, confirmedEpoch: 1 });
  queue.beginWithdraw(batch.id, { epoch: 5, poolCanWithdraw: true });
  queue.acknowledgeWithdraw(batch.id, {
    success: true,
    receiptId: "cash",
    received: "100",
  });
  const state = queue.snapshot();
  state.closed[0].received = "101";
  assert.throws(() => new ExitScheduler(state), /reconcile/);
});
test("liquid receipt policy is replay-safe, versioned and never recycles principal, rollover or awarded backing", () => {
  let treasury = new TreasuryModel();
  treasury.receive(receipt("old", "101"));
  assert.deepEqual(treasury.snapshot().available, {
    creator: "0",
    coins: "50",
    zones: "51",
  });
  treasury.reserve({ id: "street", bucket: "coins", amount: "40" });
  treasury.reserve({ id: "quest", bucket: "zones", amount: "50" });
  treasury.setPolicy(2, 1000);
  treasury.receive(receipt("new", "1000"));
  assert.deepEqual(treasury.snapshot().available, {
    creator: "100",
    coins: "460",
    zones: "451",
  });
  const beforeReplay = treasury.snapshot();
  assert.equal(treasury.receive(receipt("old", "101")).policy.version, 1);
  assert.deepEqual(treasury.snapshot(), beforeReplay);
  for (const kind of [
    "principal",
    "retained_yield",
    "loss_recovery",
    "refund",
    "rollover",
    "operating",
  ])
    assert.throws(() => treasury.receive({ ...receipt(kind, "10"), kind }));
  treasury.award("quest", `alice${SUFFIX}`);
  treasury.award("quest", `alice${SUFFIX}`);
  assert.throws(() => treasury.award("quest", `bob${SUFFIX}`));
  assert.throws(() => treasury.expire("quest"));
  treasury.expire("street");
  treasury.expire("street");
  assert.equal(treasury.snapshot().available.coins, "500");
  assert.throws(() => treasury.award("street", `alice${SUFFIX}`));
  assert.throws(() =>
    treasury.reserve({ id: "overfund", bucket: "coins", amount: "501" }),
  );
  assert.throws(() => treasury.receive(receipt("old", "102")));
  treasury = new TreasuryModel(JSON.parse(JSON.stringify(treasury.snapshot())));
  assert.equal(treasury.snapshot().available.zones, "451");
  assert.equal(treasury.snapshot().receipts.length, 2);
});

test("integer treasury conservation holds across many policies, city reservations, expiries and winners", () => {
  const treasury = new TreasuryModel();
  for (let i = 1; i <= 80; i++) {
    if (i % 17 === 0) treasury.setPolicy(i + 1, i % 3 === 0 ? 10000 : 1000);
    treasury.receive(receipt(`r${i}`, BigInt(i * 19 + 1).toString()));
    for (const bucket of ["creator", "coins", "zones"]) {
      const available = BigInt(treasury.snapshot().available[bucket]);
      if (!available) continue;
      const id = `${bucket}-${i}`;
      treasury.reserve({
        id,
        bucket,
        amount: ((available + 1n) / 2n).toString(),
      });
      if (i % 3 === 0) treasury.expire(id);
      else if (i % 3 === 1) treasury.award(id, `alice${SUFFIX}`);
    }
  }
  const state = treasury.snapshot();
  const received = state.receipts.reduce(
    (sum, r) => sum + BigInt(r.amount),
    0n,
  );
  const available = Object.values(state.available).reduce(
    (sum, a) => sum + BigInt(a),
    0n,
  );
  const obligations = state.rewards
    .filter((r) => r.state !== "expired")
    .reduce((sum, r) => sum + BigInt(r.amount), 0n);
  assert.equal(received, available + obligations);
  assert.equal(state.receipts.length, 80);
});

test("pool adapter pins every view, exposes no invented APY and accepts legitimate non-.testnet validator IDs", async () => {
  const block = { header: { hash: "final-hash", height: 123 } },
    calls = [];
  const provider = {
    async viewNodeStatus() {
      return { chain_id: NETWORK, sync_info: { syncing: false } };
    },
    async query(request) {
      calls.push(request);
      assert.equal(request.block_id, "final-hash");
      const values = {
        get_total_staked_balance: "100000000000000000000000001",
        get_reward_fee_fraction: { numerator: 3, denominator: 100 },
        is_staking_paused: false,
        get_owner_id: `owner${SUFFIX}`,
        get_account: {
          account_id: `alice${SUFFIX}`,
          staked_balance: "10",
          unstaked_balance: "3",
          can_withdraw: false,
        },
      };
      const result =
        request.request_type === "view_account"
          ? { code_hash: "code-hash" }
          : request.request_type === "view_access_key_list"
            ? { keys: [] }
            : {
                result: [
                  ...Buffer.from(JSON.stringify(values[request.method_name])),
                ],
              };
      return { ...result, block_hash: "final-hash", block_height: 123 };
    },
  };
  const result = await readStakingPool(
    provider,
    {
      accountId: "example.pool.f863973.m0",
      observerId: `alice${SUFFIX}`,
      expectedCodeHash: "code-hash",
    },
    block,
  );
  assert.equal(calls.length, 7);
  assert.equal(result.rewardFeeBps, 300);
  assert.equal(result.apy, null);
  assert.equal(result.depositsEnabled, false);
  assert.equal(result.fingerprintMatches, true);
  assert.equal(result.keyless, true);
  assert.equal(result.observer.unstaked, "3");
  const wrongAnchor = {
    ...provider,
    query: async (r) => ({ ...(await provider.query(r)), block_hash: "other" }),
  };
  await assert.rejects(
    readStakingPool(wrongAnchor, { accountId: `example${SUFFIX}` }, block),
    /anchor/,
  );
  await assert.rejects(
    readStakingPool(
      {
        ...provider,
        viewNodeStatus: async () => ({ chain_id: OTHER_NETWORK }),
      },
      { accountId: `example${SUFFIX}` },
      block,
    ),
    new RegExp(`not connected to ${NETWORK_LABEL}\\.`),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_STAKE_YOCTO,
  V3_RECOVERY_POLICY,
  childAccountId,
  nearToYocto,
  ownPosition,
  serverListingProblems,
  smokeAccountId,
  smokeFunding,
  summarizeCreateOutcome,
  v3StateProblems,
  yoctoToNear,
} from "../scripts/lib/vault-smoke.mjs";

const NEAR = 10n ** 24n;
const factoryId = "questlayer-vaults-20261101b.testnet";
const rewardsId = "questlayer-rewards-20261101b.testnet";
const smoke = "vault-smoke-v3.questlayer-dev-20261101.testnet";
const pool = "aurora.pool.f863973.m0";

test("smoke account is a testnet sub-account of the operator", () => {
  assert.equal(smokeAccountId("questlayer-dev-20261101.testnet"), smoke);
  assert.throws(() => smokeAccountId("questlayer.near"));
  assert.throws(() => smokeAccountId("questlayer-dev-20261101.testnet", "Bad_Label"));
  assert.throws(() => smokeAccountId("questlayer-dev-20261101.testnet", "x".repeat(40)));
});

test("NEAR amounts parse without floats", () => {
  assert.equal(nearToYocto("0.001"), MIN_STAKE_YOCTO);
  assert.equal(nearToYocto("3.52"), 352n * 10n ** 22n);
  assert.equal(nearToYocto("1"), NEAR);
  assert.throws(() => nearToYocto("1e3"));
  assert.throws(() => nearToYocto("-1"));
  assert.equal(yoctoToNear(3_621_000_000_000_000_000_000_000n), "3.621");
  assert.equal(yoctoToNear(0n), "0");
});

test("funding: setup deposit + stake + margin, top-up only what is missing", () => {
  const setupDeposit = "3520000000000000000000000";
  const f = smokeFunding({ setupDeposit });
  assert.equal(f.fund, nearToYocto("3.621"));
  assert.equal(f.topUp, f.fund);
  assert.equal(smokeFunding({ setupDeposit, balance: nearToYocto("5") }).topUp, 0n);
  assert.equal(smokeFunding({ setupDeposit, balance: nearToYocto("3.6") }).topUp, nearToYocto("0.021"));
  // A resumed run with the position already created needs no new setup deposit.
  assert.equal(smokeFunding({ setupDeposit, positionExists: true, balance: nearToYocto("0.2") }).topUp, 0n);
});

test("own position: one live position, failed ones ignored, several refused", () => {
  const p = (id, state, beneficiary = smoke) => ({ id, account_id: childAccountId(id, factoryId), beneficiary, pool, contribution_bps: 5000, state });
  assert.equal(ownPosition([], smoke), null);
  assert.equal(ownPosition([p("0", "failed"), p("1", "ready")], smoke).id, "1");
  assert.equal(ownPosition([p("0", "ready", "other.testnet")], smoke), null);
  assert.throws(() => ownPosition([p("0", "ready"), p("1", "created")], smoke));
  assert.equal(childAccountId(3, factoryId), "v3.questlayer-vaults-20261101b.testnet");
});

const receipt = (executor, gas, status = { SuccessValue: "" }) => ({ outcome: { executor_id: executor, gas_burnt: gas, status } });

test("create outcome: new() on the child and registration on rewards", () => {
  const child = childAccountId(0, factoryId);
  const outcome = {
    status: { SuccessValue: "dHJ1ZQ==" },
    transaction_outcome: { outcome: { gas_burnt: 2_400_000_000_000 } },
    receipts_outcome: [
      receipt(factoryId, 8_000_000_000_000, { SuccessReceiptId: "a" }),
      receipt(child, 12_345_000_000_000),
      receipt(factoryId, 4_000_000_000_000, { SuccessReceiptId: "b" }),
      receipt(rewardsId, 3_100_000_000_000),
      receipt(factoryId, 2_000_000_000_000),
    ],
  };
  const s = summarizeCreateOutcome(outcome, { childId: child, factoryId, rewardsId });
  assert.equal(s.transactionFailed, false);
  assert.deepEqual(s.failures, []);
  assert.deepEqual(s.child, { receipts: 1, ok: true, gasBurntTgas: [12.345] });
  assert.equal(s.registered.ok, true);
  assert.equal(s.factoryCallbacks, 3);
  assert.equal(s.totalGasBurntTgas, 31.845);
  const failed = structuredClone(outcome);
  failed.receipts_outcome[1].outcome.status = { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Exceeded the prepaid gas." } } } } };
  const f = summarizeCreateOutcome(failed, { childId: child, factoryId, rewardsId });
  assert.equal(f.child.ok, false);
  assert.equal(f.failures[0].executor, child);
  assert.equal(summarizeCreateOutcome({}, { childId: child, factoryId, rewardsId }).child, null);
});

const v3 = (over = {}) => ({
  version: 2,
  network: "testnet",
  beneficiary: smoke,
  pool,
  rewards: rewardsId,
  contribution_bps: 5000,
  stage: "idle",
  exit_requested: false,
  principal: "0",
  staked: "0",
  busy_since: "0",
  recoverable_at_epoch: null,
  min_harvest: "1000000000000000000000",
  next_harvest_epoch: "0",
  recovery_policy: V3_RECOVERY_POLICY,
  ...over,
});
const expect = { beneficiary: smoke, pool, rewards: rewardsId, contributionBps: 5000 };

test("get_state: v3 fields, identity and stake", () => {
  assert.deepEqual(v3StateProblems(v3(), expect), []);
  assert.deepEqual(v3StateProblems(v3({ principal: "1000000000000000000000", staked: "1000000000000000000000" }), { ...expect, stake: MIN_STAKE_YOCTO }), []);
  const v2 = v3();
  delete v2.busy_since;
  delete v2.recovery_policy;
  assert.deepEqual(v3StateProblems(v2, expect), ["missing v3 field busy_since", "missing v3 field recovery_policy"]);
  assert.match(v3StateProblems(v3({ beneficiary: "x.testnet" }), expect)[0], /beneficiary/);
  assert.match(v3StateProblems(v3({ stage: "depositing" }), expect)[0], /stage/);
  assert.match(v3StateProblems(v3({ recovery_policy: "old" }), expect)[0], /recovery_policy/);
  assert.equal(v3StateProblems(v3(), { ...expect, stake: MIN_STAKE_YOCTO }).length, 2);
  assert.deepEqual(v3StateProblems(null, expect), ["get_state returned nothing"]);
});

test("server listing must show the child ready with its state", () => {
  const child = childAccountId(0, factoryId);
  const listing = { factoryId, positions: [{ account_id: child, state: "ready", position: v3() }] };
  assert.deepEqual(serverListingProblems(listing, { childId: child, factoryId }), []);
  assert.match(serverListingProblems({ factoryId, positions: [{ account_id: child, state: "created", position: null }] }, { childId: child, factoryId })[0], /created/);
  assert.match(serverListingProblems({ factoryId, positions: [] }, { childId: child, factoryId })[0], /does not list/);
  assert.deepEqual(serverListingProblems({ status: "not-configured" }, { childId: child, factoryId }), ["server: vaults not configured"]);
});

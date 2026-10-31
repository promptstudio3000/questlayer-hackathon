import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  NativeTasks,
  TASK_CONTRACT,
  TASK_POLICY,
  TASK_STORAGE,
} from "../server/native/tasks.mjs";
const NOW = Date.parse("2026-10-31T16:00:00Z"),
  HOUR = 3600000;
function fixture() {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Task Explorer", NOW);
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    "alice.testnet",
    player,
    NOW,
  );
  const manifest = {
    schema: 1,
    network: "testnet",
    contractId: TASK_CONTRACT,
    codeHash: "reviewed-code-hash",
    policy: TASK_POLICY,
    arbiterId: "arbiter.testnet",
    keyless: true,
  };
  const state = {
    now: NOW,
    network: "testnet",
    hash: manifest.codeHash,
    keys: [],
    fail: false,
    mismatch: false,
    hook: null,
    calls: [],
    config: {
      policy_version: TASK_POLICY,
      network: "testnet",
      arbiter_id: manifest.arbiterId,
      max_tasks: 128,
      max_submissions: 32,
      max_reward_yocto: "1000000000000000000000000",
      task_storage_yocto: TASK_STORAGE,
      submission_storage_yocto: TASK_STORAGE,
      min_due_delay_ms: HOUR,
      max_due_delay_ms: 14 * 24 * HOUR,
      review_period_ms: 48 * HOUR,
      appeal_period_ms: 24 * HOUR,
      appeal_cutoff_ms: 72 * HOUR,
      resolution_cutoff_ms: 120 * HOUR,
    },
    tasks: [
      {
        task_id: 1,
        client_id: "sample",
        sponsor_id: "sponsor.testnet",
        title: "Read a public bridge plaque",
        description: "Report its displayed year from the public path.",
        area: "Plzeň · city centre",
        reference: "",
        content_hash: "a".repeat(64),
        reward_yocto: "100000000000000000000000",
        created_at_ms: NOW - HOUR,
        due_at_ms: NOW + HOUR,
        review_ends_at_ms: NOW + 49 * HOUR,
        appeal_ends_at_ms: NOW + 73 * HOUR,
        resolve_ends_at_ms: NOW + 121 * HOUR,
        status: "open",
        cancelled: false,
        submission_count: 0,
        review_cursor: 0,
        candidate_id: null,
        winner_id: null,
        settled_at_ms: null,
      },
    ],
    submissions: [],
    account: {
      account_id: "alice.testnet",
      credit_yocto: "0",
      pending_withdrawal: null,
    },
    totals: {
      reward_deposits_yocto: "100000000000000000000000",
      open_escrow_yocto: "100000000000000000000000",
      credits_yocto: "0",
      pending_withdrawals_yocto: "0",
      withdrawn_yocto: "0",
      awarded_yocto: "0",
      refunded_yocto: "0",
      storage_funding_yocto: TASK_STORAGE,
      operating_funding_yocto: "100",
      task_count: 1,
      conserved: true,
    },
  };
  const provider = {
    viewNodeStatus: async () => ({
      chain_id: state.network,
      sync_info: { syncing: false },
    }),
    viewBlock: async () => ({
      header: {
        hash: "final-block",
        height: 123,
        timestamp_nanosec: String(BigInt(state.now) * 1000000n),
      },
    }),
    query: async (q) => {
      state.calls.push(q);
      if (state.fail) throw Error("private internal failure");
      if (state.hook) state.hook(q);
      const base = {
        block_hash: state.mismatch ? "other-block" : "final-block",
        block_height: 123,
      };
      if (q.request_type === "view_account")
        return { ...base, code_hash: state.hash };
      if (q.request_type === "view_access_key_list")
        return { ...base, keys: state.keys };
      const args = JSON.parse(Buffer.from(q.args_base64, "base64").toString());
      const views = {
        get_config: state.config,
        get_totals: state.totals,
        get_tasks: state.tasks.slice(
          (args.from_index || 1) - 1,
          (args.from_index || 1) - 1 + (args.limit || 50),
        ),
        get_submissions: state.submissions,
        get_account: state.account,
      };
      assert.ok(q.method_name in views, q.method_name);
      return {
        ...base,
        result: [...Buffer.from(JSON.stringify(views[q.method_name]))],
      };
    },
  };
  const native = new NativeTasks(db, provider, manifest, {
    clock: () => state.now,
    cacheMs: 10,
    timeoutMs: 100,
  });
  const request = (action, patch = {}) => ({
    accountId: "alice.testnet",
    action,
    codeHash: manifest.codeHash,
    policy: TASK_POLICY,
    taskId: 1,
    ...patch,
  });
  const evidence = () => ({
    text: "The public plaque reads 1913.",
    reference: "",
    contentHash: "b".repeat(64),
  });
  function submission(patch = {}) {
    const s = {
      submission_id: 0,
      claimant_id: "alice.testnet",
      submitted_at_ms: NOW,
      status: "pending",
      evidence: { text: "1913", reference: "", content_hash: "b".repeat(64) },
      reviewed_at_ms: null,
      review_reason: null,
      appeal_until_ms: null,
      appeal: null,
      resolved_at_ms: null,
      resolution_reason: null,
      ...patch,
    };
    state.submissions.push(s);
    state.tasks[0].submission_count++;
    return s;
  }
  return {
    db,
    player,
    manifest,
    state,
    provider,
    native,
    request,
    evidence,
    submission,
  };
}
test("task read model pins one finalized block, keyless code, policy, bounded ordered receipts and exact conservation", async () => {
  const f = fixture(),
    s = await f.native.snapshot(f.player, "alice.testnet", false, 1);
  assert.equal(s.status, "available");
  assert.equal(s.actions.submit, true);
  assert.equal(s.totals.reward_deposits_yocto, "100000000000000000000000");
  assert.ok(
    f.state.calls.every((q) => q.block_id === "final-block" && !q.finality),
  );
  const count = f.state.calls.length;
  await f.native.snapshot(f.player, "alice.testnet", false, 1);
  assert.equal(f.state.calls.length, count);
  const q = await f.native.prepare(f.player, f.request("submit", f.evidence()));
  assert.ok(f.state.calls.length > count);
  assert.equal(q.deposit, TASK_STORAGE);
  assert.equal(q.methodName, "submit_evidence");
  assert.equal(q.signerId, "alice.testnet");
  assert.equal(q.args.task_id, 1);
});
test("missing deployment never shows a fake live escrow; failed refresh is stale with no action capabilities", async () => {
  const f = fixture();
  f.native.manifest = null;
  const absent = await f.native.snapshot(f.player, "alice.testnet", true, 1);
  assert.equal(absent.status, "unavailable");
  assert.deepEqual(absent.tasks, []);
  await assert.rejects(
    () => f.native.prepare(f.player, f.request("submit", f.evidence())),
    /not configured/,
  );
  f.native.manifest = f.manifest;
  await f.native.snapshot(f.player, "alice.testnet", true, 1);
  f.state.fail = true;
  const stale = await f.native.snapshot(f.player, "alice.testnet", true, 1);
  assert.equal(stale.status, "stale");
  assert.equal(stale.actions, null);
  assert.equal(
    (await f.native.snapshot(f.player, "alice.testnet", false, 1)).status,
    "stale",
  );
  assert.doesNotMatch(JSON.stringify(stale), /private internal/);
  await assert.rejects(() =>
    f.native.prepare(f.player, f.request("submit", f.evidence())),
  );
});
test("fresh quotes reject changed network, deployment policy, access keys, mixed anchors or malformed accounting", async () => {
  const changes = [
    (f) => (f.state.network = "mainnet"),
    (f) => (f.state.hash = "changed"),
    (f) => (f.state.keys = [{}]),
    (f) => (f.state.config.arbiter_id = "attacker.testnet"),
    (f) => (f.state.config.task_storage_yocto = "1"),
    (f) => (f.state.mismatch = true),
    (f) => (f.state.totals.open_escrow_yocto = "0"),
    (f) => (f.state.totals.reward_deposits_yocto = 1),
    (f) => (f.state.tasks[0].reward_yocto = "1e24"),
    (f) => f.state.tasks[0].review_ends_at_ms++,
    (f) => f.state.tasks.push(f.state.tasks[0]),
    (f) => (f.state.tasks[0].task_id = 3),
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.equal(
      (await f.native.snapshot(f.player, "alice.testnet", true, 1)).status,
      "unavailable",
    );
    await assert.rejects(() =>
      f.native.prepare(f.player, f.request("submit", f.evidence())),
    );
  }
});
test("linked actor is checked before and after asynchronous reads, including cached snapshots", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.native.snapshot("other-player", "alice.testnet", true, 1),
    /Link/,
  );
  await f.native.snapshot(f.player, "alice.testnet", true, 1);
  f.db
    .prepare("DELETE FROM wallet_links WHERE account_id=?")
    .run("alice.testnet");
  await assert.rejects(
    () => f.native.snapshot(f.player, "alice.testnet", false, 1),
    /Link/,
  );
  f.db
    .prepare("INSERT INTO wallet_links VALUES(?,?,?)")
    .run("alice.testnet", f.player, NOW);
  f.state.hook = () =>
    f.db
      .prepare("DELETE FROM wallet_links WHERE account_id=?")
      .run("alice.testnet");
  await assert.rejects(
    () => f.native.prepare(f.player, f.request("submit", f.evidence())),
    /Link/,
  );
});
test("create quote attaches only exact independent reward plus fixed nonrefundable storage; stable id prevents another publication", async () => {
  const f = fixture(),
    r = f.request("create", {
      clientId: "new-task",
      title: "Public plaque",
      description: "Read its year",
      area: "Plzeň",
      reference: "",
      contentHash: "c".repeat(64),
      rewardYocto: "100000000000000000000001",
      dueAtMs: NOW + 2 * HOUR,
    });
  const q = await f.native.prepare(f.player, r);
  assert.equal(q.deposit, "150000000000000000000001");
  assert.equal(q.args.reward_yocto, r.rewardYocto);
  for (const patch of [
    { rewardYocto: "1000000000000000000000001" },
    { dueAtMs: NOW + 100 },
    { title: "é".repeat(49) },
    { reference: "https://private.test/secret" },
    { reference: "ipfs://bafy" },
    { contentHash: "bad" },
    { clientId: "bad/id" },
  ])
    await assert.rejects(() => f.native.prepare(f.player, { ...r, ...patch }));
  f.state.tasks[0].sponsor_id = "alice.testnet";
  await assert.rejects(
    () => f.native.prepare(f.player, { ...r, clientId: "sample" }),
    /already exists/,
  );
});
test("sponsor decision follows receipt order, cannot skip or review after a candidate, and has exact no-deposit binding", async () => {
  const f = fixture();
  f.state.tasks[0].sponsor_id = "alice.testnet";
  f.submission({ claimant_id: "first.testnet" });
  f.submission({ submission_id: 1, claimant_id: "second.testnet" });
  await assert.rejects(
    () => f.native.prepare(f.player, f.request("submit", f.evidence())),
    /cannot submit/,
  );
  await assert.rejects(
    () =>
      f.native.prepare(
        f.player,
        f.request("review", {
          submissionId: 1,
          approved: true,
          reason: "Correct",
        }),
      ),
    /authorized reviewer/,
  );
  const q = await f.native.prepare(
    f.player,
    f.request("review", {
      submissionId: 0,
      approved: true,
      reason: "Year checked",
    }),
  );
  assert.equal(q.deposit, "0");
  assert.deepEqual(q.args, {
    task_id: 1,
    submission_id: 0,
    approved: true,
    reason: "Year checked",
  });
  f.state.tasks[0].candidate_id = 0;
  await assert.rejects(
    () =>
      f.native.prepare(
        f.player,
        f.request("review", {
          submissionId: 0,
          approved: true,
          reason: "Correct",
        }),
      ),
    /authorized reviewer/,
  );
});
test("appeal and arbitration use claimant, immutable arbiter, exclusive deadline and public evidence", async () => {
  const f = fixture();
  f.submission({
    status: "rejected",
    reviewed_at_ms: NOW,
    review_reason: "Incomplete",
    appeal_until_ms: NOW + 24 * HOUR,
  });
  const r = f.request("appeal", { submissionId: 0, ...f.evidence() }),
    q = await f.native.prepare(f.player, r);
  assert.equal(q.methodName, "appeal_submission");
  assert.equal(q.deposit, "0");
  f.state.now = NOW + 24 * HOUR;
  await assert.rejects(() => f.native.prepare(f.player, r), /not open/);
  f.state.now = NOW;
  f.state.submissions[0].status = "appealed";
  f.state.submissions[0].appeal = {
    text: "Please reconsider",
    reference: "",
    content_hash: "d".repeat(64),
  };
  await assert.rejects(
    () =>
      f.native.prepare(
        f.player,
        f.request("resolve", {
          submissionId: 0,
          approved: true,
          reason: "Checked",
        }),
      ),
    /authorized reviewer/,
  );
  f.manifest.arbiterId = "alice.testnet";
  f.state.config.arbiter_id = "alice.testnet";
  assert.equal(
    (
      await f.native.prepare(
        f.player,
        f.request("resolve", {
          submissionId: 0,
          approved: true,
          reason: "Checked",
        }),
      )
    ).methodName,
    "resolve_appeal",
  );
});
test("withdraw quotes only own available credit and never an arbitrary receiver; pending withdrawal cannot duplicate", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.native.prepare(f.player, f.request("withdraw")),
    /No task credit/,
  );
  f.state.account.credit_yocto = "1";
  f.state.totals.credits_yocto = "1";
  f.state.totals.reward_deposits_yocto = "100000000000000000000001";
  f.state.totals.awarded_yocto = "1";
  const q = await f.native.prepare(
    f.player,
    f.request("withdraw", { receiverId: "attacker.testnet" }),
  );
  assert.deepEqual(q.args, {});
  assert.equal(q.deposit, "1");
  assert.equal(q.receiverId, TASK_CONTRACT);
  f.state.account.pending_withdrawal = { withdrawal_id: 1, amount_yocto: "1" };
  f.state.account.credit_yocto = "0";
  f.state.totals.credits_yocto = "0";
  f.state.totals.pending_withdrawals_yocto = "1";
  await assert.rejects(
    () => f.native.prepare(f.player, f.request("withdraw")),
    /No task credit/,
  );
});
test("an arbiter rejection cannot reopen an already resolved appeal", async () => {
  const f = fixture();
  f.submission({
    status: "rejected",
    reviewed_at_ms: NOW,
    review_reason: "Incomplete",
    appeal_until_ms: NOW + 24 * HOUR,
    resolved_at_ms: NOW,
    resolution_reason: "Dismissed",
  });
  const s = await f.native.snapshot(f.player, "alice.testnet", true, 1);
  assert.equal(s.actions.appealSubmissionId, null);
  await assert.rejects(
    () =>
      f.native.prepare(
        f.player,
        f.request("appeal", { submissionId: 0, ...f.evidence() }),
      ),
    /not open/,
  );
});
test("bounded singleflight read model shares a refresh and fails closed on an RPC deadline", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    f.native.snapshot(f.player, "alice.testnet", true, 1),
    f.native.snapshot(f.player, "alice.testnet", true, 1),
  ]);
  assert.equal(a.blockHash, b.blockHash);
  assert.equal(
    f.state.calls.filter((q) => q.method_name === "get_config").length,
    1,
  );
  f.provider.viewNodeStatus = () => new Promise(() => {});
  f.native.timeoutMs = 5;
  const s = await f.native.snapshot(f.player, "alice.testnet", true, 1);
  assert.equal(s.status, "stale");
});

function confirmationFixture() {
  const f = fixture(),
    transactionHash = "BGBsVpX6x7SZ3nRRv1HnoWPeUK4DZzAkrh4cm92eBxLb";
  const quote = {
    network: "testnet",
    signerId: "alice.testnet",
    receiverId: TASK_CONTRACT,
    contractId: TASK_CONTRACT,
    codeHash: f.manifest.codeHash,
    policy: TASK_POLICY,
    methodName: "withdraw",
    args: {},
    deposit: "1",
    gas: "100000000000000",
    expiresAt: NOW - 60000,
  };
  const receipt = {
    final_execution_status: "FINAL",
    transaction: {
      hash: transactionHash,
      signer_id: "alice.testnet",
      receiver_id: TASK_CONTRACT,
      actions: [
        {
          FunctionCall: {
            method_name: "withdraw",
            args: Buffer.from("{}").toString("base64"),
            deposit: "1",
            gas: 100000000000000,
          },
        },
      ],
    },
    status: { SuccessValue: Buffer.from("true").toString("base64") },
    transaction_outcome: {
      outcome: { status: { SuccessReceiptId: "receipt-id" } },
    },
    receipts_outcome: [
      {
        outcome: {
          status: { SuccessValue: Buffer.from("true").toString("base64") },
        },
      },
    ],
  };
  f.provider.viewTransactionStatus = async (args) => {
    f.state.confirmArgs = args;
    return receipt;
  };
  return {
    ...f,
    quote,
    receipt,
    transactionHash,
    input: { accountId: "alice.testnet", quote, transactionHash },
  };
}
test("task confirmation asks the installed provider for FINAL and accepts an expired original quote without preparing another action", async () => {
  const f = confirmationFixture();
  await f.native.snapshot(f.player, "alice.testnet", false, 1);
  assert.equal(f.native.cache.size, 1);
  const result = await f.native.confirm(f.player, f.input);
  assert.deepEqual(f.state.confirmArgs, {
    txHash: f.transactionHash,
    accountId: "alice.testnet",
    waitUntil: "FINAL",
  });
  assert.deepEqual(result, {
    confirmed: true,
    network: "testnet",
    contractId: TASK_CONTRACT,
    accountId: "alice.testnet",
    transactionHash: f.transactionHash,
  });
  assert.equal(f.native.cache.size, 0);
  assert.equal(f.native.cacheGeneration, 1);
  // Credit is already zero, so re-running prepare(withdraw) would wrongly reject.
  assert.equal(f.state.account.credit_yocto, "0");
});
test("confirmation rejects substituted quote network, actor, contract, code, policy, gas, deposit and unsupported method", async () => {
  for (const patch of [
    { network: "mainnet" },
    { signerId: "other.testnet" },
    { receiverId: "other.testnet" },
    { contractId: "other.testnet" },
    { codeHash: "changed-code" },
    { policy: "changed" },
    { gas: "300000000000000" },
    { deposit: "1e0" },
    { methodName: "transfer" },
    { args: [] },
  ]) {
    const f = confirmationFixture();
    await assert.rejects(
      () =>
        f.native.confirm(f.player, {
          ...f.input,
          quote: { ...f.quote, ...patch },
        }),
      /confirmation context/,
    );
    assert.equal(f.state.confirmArgs, undefined);
  }
});
test("finalized receipt must match the exact transaction hash, actor, receiver and sole FunctionCall", async () => {
  const patches = [
    (r) => (r.transaction.hash = "another-hash"),
    (r) => (r.transaction.signer_id = "other.testnet"),
    (r) => (r.transaction.receiver_id = "other.testnet"),
    (r) => r.transaction.actions.push(r.transaction.actions[0]),
    (r) => (r.transaction.actions = [{ Transfer: { deposit: "1" } }]),
    (r) =>
      (r.transaction.actions[0].FunctionCall.method_name = "finalize_task"),
    (r) => (r.transaction.actions[0].FunctionCall.deposit = "2"),
    (r) => (r.transaction.actions[0].FunctionCall.gas = 100000000000001),
    (r) =>
      (r.transaction.actions[0].FunctionCall.args = Buffer.from(
        '{"receiver":"other.testnet"}',
      ).toString("base64")),
    (r) => (r.transaction.actions[0].FunctionCall.args = "%%%bad%%%"),
  ];
  for (const patch of patches) {
    const f = confirmationFixture();
    patch(f.receipt);
    await assert.rejects(() => f.native.confirm(f.player, f.input));
    assert.equal(f.native.cacheGeneration, 0);
  }
});
test("optimistic execution, a top-level failure or a failed receipt is never confirmed as success", async () => {
  for (const finality of [
    "EXECUTED_OPTIMISTIC",
    "EXECUTED",
    "INCLUDED_FINAL",
    undefined,
  ]) {
    const f = confirmationFixture();
    f.receipt.final_execution_status = finality;
    await assert.rejects(
      () => f.native.confirm(f.player, f.input),
      /not final yet/,
    );
  }
  const top = confirmationFixture();
  top.receipt.status = { Failure: { ActionError: "failed" } };
  await assert.rejects(
    () => top.native.confirm(top.player, top.input),
    /transaction failed/,
  );
  const receipt = confirmationFixture();
  receipt.receipt.receipts_outcome[0].outcome.status = {
    Failure: { ActionError: "failed" },
  };
  await assert.rejects(
    () => receipt.native.confirm(receipt.player, receipt.input),
    /receipt failed/,
  );
});
test("withdrawal confirmation requires a final true callback result; restored credit is not called paid", async () => {
  for (const value of [false, null, "true", 0, {}]) {
    const f = confirmationFixture();
    f.receipt.status.SuccessValue = Buffer.from(JSON.stringify(value)).toString(
      "base64",
    );
    await assert.rejects(
      () => f.native.confirm(f.player, f.input),
      value === false ? /credit was restored/ : /callback result is invalid/,
    );
  }
  const f = confirmationFixture();
  f.receipt.status.SuccessValue = "malformed";
  await assert.rejects(
    () => f.native.confirm(f.player, f.input),
    /invalid encoded/,
  );
  const other = confirmationFixture();
  other.quote.methodName = "finalize_task";
  other.quote.args = { task_id: 1 };
  other.quote.deposit = "0";
  Object.assign(other.receipt.transaction.actions[0].FunctionCall, {
    method_name: "finalize_task",
    args: Buffer.from('{"task_id":1}').toString("base64"),
    deposit: "0",
  });
  other.receipt.status.SuccessValue = Buffer.from(
    '{"status":"closing"}',
  ).toString("base64");
  assert.equal(
    (await other.native.confirm(other.player, other.input)).confirmed,
    true,
  );
});
test("confirmation rechecks linked ownership after RPC and cannot read another player's receipt as their own", async () => {
  const f = confirmationFixture();
  await assert.rejects(() => f.native.confirm("other-player", f.input), /Link/);
  assert.equal(f.state.confirmArgs, undefined);
  f.provider.viewTransactionStatus = async () => {
    f.db
      .prepare("DELETE FROM wallet_links WHERE account_id=?")
      .run("alice.testnet");
    return f.receipt;
  };
  await assert.rejects(() => f.native.confirm(f.player, f.input), /Link/);
  assert.equal(f.native.cacheGeneration, 0);
});
test("confirmation still pins current finalized network/code/keyless policy and bounds the final receipt RPC", async () => {
  for (const patch of [
    (f) => (f.state.network = "mainnet"),
    (f) => (f.state.hash = "changed"),
    (f) => (f.state.keys = [{}]),
    (f) => (f.state.config.arbiter_id = "other.testnet"),
  ]) {
    const f = confirmationFixture();
    patch(f);
    await assert.rejects(() => f.native.confirm(f.player, f.input));
    assert.equal(f.state.confirmArgs, undefined);
  }
  const f = confirmationFixture();
  f.native.timeoutMs = 5;
  f.provider.viewTransactionStatus = () => new Promise(() => {});
  await assert.rejects(() => f.native.confirm(f.player, f.input), /timeout/);
});

test("shared recovery confirms task terms and rejects changed receipt arguments", async () => {
  const f = confirmationFixture();
  delete f.input.quote.contractId;
  delete f.input.quote.codeHash;
  delete f.input.quote.policy;
  assert.equal(
    (await f.native.confirmTransaction(f.player, f.input)).confirmed,
    true,
  );
  f.input.quote.args = { changed: true };
  await assert.rejects(
    () => f.native.confirmTransaction(f.player, f.input),
    /arguments differ/,
  );
});
test("shared recovery only marks explicit final failures as clearable", async () => {
  const f = confirmationFixture();
  f.receipt.status = { Failure: { ActionError: "failed" } };
  await assert.rejects(
    () => f.native.confirmTransaction(f.player, f.input),
    (e) => e.code === "NATIVE_TRANSACTION_FAILED",
  );
  for (const status of [
    null,
    {},
    { Unknown: "" },
    { SuccessValue: "", Failure: {} },
  ]) {
    f.receipt.status = status;
    await assert.rejects(
      () => f.native.confirmTransaction(f.player, f.input),
      (e) => !e.code?.startsWith("NATIVE_"),
    );
  }
});
test("shared recovery rejects a restored task withdrawal and checks ownership first", async () => {
  const f = confirmationFixture();
  f.receipt.status = { SuccessValue: Buffer.from("false").toString("base64") };
  await assert.rejects(
    () => f.native.confirmTransaction(f.player, f.input),
    (e) => e.code === "NATIVE_OPERATION_NOT_COMPLETED",
  );
  await assert.rejects(
    () => f.native.confirmTransaction("other-player", f.input),
    /Link/,
  );
});

test("task recovery also rejects an older identical receipt before handling terminal failure", async () => {
  const f = confirmationFixture(),
    original = f.provider.viewBlock;
  try {
    const hash = "B".repeat(44);
    f.receipt.transaction_outcome.block_hash = hash;
    f.provider.viewBlock = async (q) =>
      q.blockId ? { header: { hash, height: 1001 } } : original(q);
    f.input.afterBlock = 1000;
    assert.equal(
      (await f.native.confirmTransaction(f.player, f.input)).confirmed,
      true,
    );
    f.input.afterBlock = 1001;
    await assert.rejects(
      () => f.native.confirmTransaction(f.player, f.input),
      (e) => e.code === "NATIVE_RECEIPT_BEFORE_REQUEST",
    );
    f.receipt.status = { Failure: { ActionError: "old" } };
    await assert.rejects(
      () => f.native.confirmTransaction(f.player, f.input),
      (e) => e.code === "NATIVE_RECEIPT_BEFORE_REQUEST",
    );
  } finally {
    f.db.close();
  }
});

test("malformed task outcomes cannot be cleared as known failure", async () => {
  const f = confirmationFixture();
  try {
    for (const value of [null, false, {}, []]) {
      f.receipt.status = { Failure: value };
      await assert.rejects(
        () => f.native.confirmTransaction(f.player, f.input),
        (e) => !e.code?.startsWith("NATIVE_"),
      );
    }
    for (const value of [null, "true", 0, {}]) {
      f.receipt.status = {
        SuccessValue: Buffer.from(JSON.stringify(value)).toString("base64"),
      };
      await assert.rejects(
        () => f.native.confirmTransaction(f.player, f.input),
        (e) => !e.code?.startsWith("NATIVE_"),
      );
    }
    f.receipt.status = { SuccessValue: Buffer.from("true").toString("base64") };
    f.receipt.receipts_outcome = [];
    await assert.rejects(
      () => f.native.confirmTransaction(f.player, f.input),
      (e) => !e.code?.startsWith("NATIVE_"),
    );
  } finally {
    f.db.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTaskQuote,
  taskTransaction,
  parseTaskReward,
  exactTaskNear,
  exactTaskGold,
  NATIVE_TASK_CONTRACT,
  TASK_POLICY,
  TASK_STORAGE,
  TASK_GAS,
} from "../src/native-task-quote.ts";
const NOW = Date.parse("2026-10-31T16:00:00Z");
const base = {
  accountId: "alice.testnet",
  codeHash: "pinned-contract-code",
  policy: TASK_POLICY,
};
const quote = (r) => ({
  ...taskTransaction(r),
  network: "testnet",
  signerId: r.accountId,
  receiverId: NATIVE_TASK_CONTRACT,
  contractId: NATIVE_TASK_CONTRACT,
  codeHash: r.codeHash,
  policy: TASK_POLICY,
  gas: TASK_GAS,
  expiresAt: NOW + 60000,
  blockHash: "final-block",
  blockHeight: 123,
});
test("task amount parsing and GOLD display never pass through floating point", () => {
  assert.equal(
    parseTaskReward("0.100000000000000000000001"),
    "100000000000000000000001",
  );
  assert.equal(
    exactTaskNear("100000000000000000000001"),
    "0.100000000000000000000001",
  );
  assert.equal(
    exactTaskGold("100000000000000000000001"),
    "100.000000000000000000001",
  );
  for (const value of [
    "0",
    "0.0001",
    "1.0001",
    "1e0",
    "-1",
    " 1",
    "01",
    "0.1234567890123456789012345",
  ])
    assert.throws(() => parseTaskReward(value));
});
test("all native task quotes bind exact actor, contract, reviewed code, network, policy, method, arguments, fees and expiry", () => {
  const requests = [
    {
      ...base,
      action: "create",
      clientId: "first",
      title: "Bridge",
      description: "Read year",
      area: "Plzeň",
      reference: "",
      contentHash: "a".repeat(64),
      rewardYocto: parseTaskReward("0.1"),
      dueAtMs: NOW + 86400000,
    },
    {
      ...base,
      action: "submit",
      taskId: 1,
      text: "1913",
      reference: "",
      contentHash: "b".repeat(64),
    },
    {
      ...base,
      action: "review",
      taskId: 1,
      submissionId: 0,
      approved: true,
      reason: "Verified",
    },
    {
      ...base,
      action: "appeal",
      taskId: 1,
      submissionId: 0,
      text: "Clarification",
      reference: "",
      contentHash: "b".repeat(64),
    },
    {
      ...base,
      action: "resolve",
      taskId: 1,
      submissionId: 0,
      approved: false,
      reason: "Insufficient",
    },
    { ...base, action: "cancel", taskId: 1 },
    { ...base, action: "finalize", taskId: 1 },
    { ...base, action: "withdraw" },
  ];
  for (const r of requests) {
    const q = quote(r);
    assert.doesNotThrow(() => assertTaskQuote(q, r, NOW));
    for (const patch of [
      { network: "mainnet" },
      { signerId: "other.testnet" },
      { receiverId: "other.testnet" },
      { contractId: "other.testnet" },
      { policy: "changed" },
      { codeHash: "changed" },
      { methodName: "transfer" },
      { deposit: String(BigInt(q.deposit) + 1n) },
      { gas: "300000000000000" },
      { args: { ...q.args, receiver: "other.testnet" } },
      { expiresAt: NOW },
      { expiresAt: NOW + 120001 },
      { blockHash: "" },
      { blockHeight: 0 },
    ])
      assert.throws(() => assertTaskQuote({ ...q, ...patch }, r, NOW));
  }
  assert.equal(quote(requests[0]).deposit, "150000000000000000000000");
  assert.equal(quote(requests[1]).deposit, TASK_STORAGE);
});
test("a decision cannot silently change subject, evidence, approval or the chosen content hash", () => {
  const r = {
      ...base,
      action: "review",
      taskId: 2,
      submissionId: 0,
      approved: false,
      reason: "Needs evidence",
    },
    q = quote(r);
  for (const args of [
    { ...q.args, task_id: 3 },
    { ...q.args, submission_id: 1 },
    { ...q.args, approved: true },
    { ...q.args, reason: "Different" },
  ])
    assert.throws(() => assertTaskQuote({ ...q, args }, r, NOW));
  const e = {
    ...base,
    action: "submit",
    taskId: 2,
    text: "Original",
    reference: "",
    contentHash: "b".repeat(64),
  };
  assert.throws(() =>
    assertTaskQuote(
      { ...quote(e), args: { ...quote(e).args, content_hash: "c".repeat(64) } },
      e,
      NOW,
    ),
  );
  assert.throws(() => taskTransaction({ ...base, action: "create" }));
});

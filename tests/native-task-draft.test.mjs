import test from "node:test";
import assert from "node:assert/strict";
import {
  reviewedTaskClientId,
  matchingPublishedTask,
  taskReviewBinding,
} from "../src/native-task-draft.ts";
import { NATIVE_TASK_CONTRACT, TASK_POLICY } from "../src/native-task-quote.ts";
const scope = {
  playerId: "explorer-a",
  accountId: "sponsor.testnet",
  network: "testnet",
  contractId: NATIVE_TASK_CONTRACT,
  codeHash: "verified-code",
  policy: TASK_POLICY,
};
const request = {
  action: "create",
  title: "Find the bridge plaque",
  description: "Read its year from the public path.",
  area: "Plzeň riverfront",
  reference: "",
  contentHash: "a".repeat(64),
  rewardYocto: "100000000000000000000000",
  dueAtMs: 1793520000000,
};

test("identical reviewed terms retain the same opaque operation ID after reload, unknown outcomes and concurrent prepares", async () => {
  const ids = await Promise.all(
    Array.from({ length: 8 }, () =>
      reviewedTaskClientId(structuredClone(scope), structuredClone(request)),
    ),
  );
  assert.equal(new Set(ids).size, 1);
  assert.match(ids[0], /^[a-f0-9]{64}$/);
  assert.equal(ids[0].length, 64);
  assert.equal(
    await reviewedTaskClientId(
      { ...scope },
      { ...request, clientId: "an-irrelevant-old-id" },
    ),
    ids[0],
  );
});

test("every reviewed financial/content and actor/code term binds the creation identity", async () => {
  const baseline = await reviewedTaskClientId(scope, request);
  for (const change of [
    { title: "A different title" },
    { description: "Different public requirement" },
    { area: "Another area" },
    { reference: "ipfs://public-reference" },
    { contentHash: "b".repeat(64) },
    { rewardYocto: "200000000000000000000000" },
    { dueAtMs: request.dueAtMs + 60000 },
  ])
    assert.notEqual(
      await reviewedTaskClientId(scope, { ...request, ...change }),
      baseline,
    );
  for (const change of [
    { playerId: "explorer-b" },
    { accountId: "other.testnet" },
    { codeHash: "different-reviewed-code" },
  ])
    assert.notEqual(
      await reviewedTaskClientId({ ...scope, ...change }, request),
      baseline,
    );
});

test("unverified network/contract/policy and malformed creation terms fail before an ID can authorize review", async () => {
  for (const change of [
    { network: "mainnet" },
    { contractId: "other.testnet" },
    { policy: "future-unreviewed-policy" },
    { accountId: "" },
    { codeHash: "" },
  ])
    await assert.rejects(
      reviewedTaskClientId({ ...scope, ...change }, request),
      /Refresh and review/,
    );
  for (const change of [
    { action: "submit" },
    { contentHash: "not-a-hash" },
    { rewardYocto: "0" },
    { dueAtMs: NaN },
    { title: undefined },
  ])
    await assert.rejects(
      reviewedTaskClientId(scope, { ...request, ...change }),
      /Refresh and review/,
    );
});

test("fresh matching existing publication is recognized by exact terms, not just a local saved ID", async () => {
  const clientId = await reviewedTaskClientId(scope, request);
  const expected = { ...request, clientId };
  const task = {
    client_id: clientId,
    sponsor_id: scope.accountId,
    title: request.title,
    description: request.description,
    area: request.area,
    reference: request.reference,
    content_hash: request.contentHash,
    reward_yocto: request.rewardYocto,
    due_at_ms: request.dueAtMs,
  };
  assert.equal(matchingPublishedTask(expected, scope.accountId, task), true);
  for (const change of [
    { sponsor_id: "other.testnet" },
    { client_id: "other-operation" },
    { reward_yocto: "1" },
    { due_at_ms: request.dueAtMs + 1 },
    { description: "Different terms" },
  ])
    assert.equal(
      matchingPublishedTask(expected, scope.accountId, { ...task, ...change }),
      false,
    );
});

test("funding and public acknowledgement context changes with actor, account, code and policy", () => {
  const baseline = taskReviewBinding(scope);
  for (const change of [
    { playerId: "explorer-b" },
    { accountId: "other.testnet" },
    { network: "mainnet" },
    { contractId: "other.testnet" },
    { codeHash: "changed" },
    { policy: "changed" },
  ])
    assert.notEqual(taskReviewBinding({ ...scope, ...change }), baseline);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createReadEpoch } from "../src/read-epoch.ts";

test("a slower earlier world read cannot replace a newer result for the same owner", async () => {
  const reads = createReadEpoch(),
    context = JSON.stringify(["player-a", "arena", "world-1"]),
    results = [];
  let finishFirst;
  const first = reads.begin(context);
  const pending = new Promise((resolve) => {
    finishFirst = resolve;
  }).then((value) => {
    if (reads.isCurrent(first, context)) results.push(value);
  });
  const second = reads.begin(context);
  if (reads.isCurrent(second, context)) results.push("fresh world");
  finishFirst("stale world");
  await pending;
  assert.deepEqual(results, ["fresh world"]);
});

test("player, realm and world changes fence even the newest read before its effect cleanup", () => {
  const reads = createReadEpoch(),
    context = JSON.stringify(["player-a", "arena", "world-1"]),
    token = reads.begin(context);
  assert.equal(reads.isCurrent(token, context), true);
  for (const next of [
    ["player-b", "arena", "world-1"],
    ["player-a", "gps", "world-1"],
    ["player-a", "arena", "world-2"],
    [null, "arena", "world-1"],
  ])
    assert.equal(reads.isCurrent(token, JSON.stringify(next)), false);
});

test("A to B to A cannot revive an old request and invalidation fences logout or unmount", () => {
  const reads = createReadEpoch(),
    first = reads.begin("A");
  reads.begin("B");
  const returned = reads.begin("A");
  assert.equal(reads.isCurrent(first, "A"), false);
  assert.equal(reads.isCurrent(returned, "A"), true);
  reads.invalidate();
  assert.equal(reads.isCurrent(returned, "A"), false);
  const next = reads.begin("A");
  assert.equal(reads.isCurrent(next, "A"), true);
  assert.equal(reads.isCurrent(returned, "A"), false);
});

test("tokens cannot be forged, mutated or reused across independent read streams", () => {
  const a = createReadEpoch(),
    b = createReadEpoch(),
    token = a.begin("owner");
  b.begin("owner");
  assert.equal(b.isCurrent(token, "owner"), false);
  assert.equal(a.isCurrent(structuredClone(token), "owner"), false);
  assert.equal(a.isCurrent({ context: "owner" }, "owner"), false);
  assert.equal(Object.isFrozen(token), true);
  assert.throws(() => {
    token.context = "another owner";
  }, TypeError);
});

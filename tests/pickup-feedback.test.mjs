import test from "node:test";
import assert from "node:assert/strict";
import {
  createPickupFeedback,
  demoPickupScope,
} from "../src/pickup-feedback.ts";

const scope = demoPickupScope("alice", "world-a", true);
const coin = (coinId, value = 10_000, xp = 2) => ({ coinId, value, xp });

test("confirmed bursts coalesce exact server amounts and suppress duplicate replies", () => {
  const model = createPickupFeedback(scope, { delay: 1500 });
  assert.equal(model.confirm(scope, coin("one"), 100), true);
  assert.equal(model.confirm(scope, coin("two", 35_000, 7), 300), true);
  assert.equal(model.confirm(scope, coin("one"), 400), false);
  assert.equal(model.flush(1599, true), null);
  assert.deepEqual(model.flush(1600, true), {
    count: 2,
    amount: 45_000,
    xp: 9,
    capped: false,
  });
  assert.equal(model.flush(1700, true), null);
  assert.deepEqual(model.snapshot(), {
    count: 2,
    amount: 45_000,
    xp: 9,
    capped: false,
  });
});

test("failed, old, foreign, replayed and malformed claims cannot create feedback", () => {
  const model = createPickupFeedback(scope);
  for (const invalid of [
    { ...coin("old"), alreadyClaimed: true },
    { ...coin("bad"), alreadyClaimed: "false" },
    coin("negative", -1),
    coin("fractional", 0.5),
    coin("xp", 1, NaN),
    { ...coin("unknown-xp"), xp: undefined },
    coin("", 1),
    coin("x".repeat(257)),
  ])
    assert.equal(model.confirm(scope, invalid, 0), false);
  for (const other of [
    demoPickupScope("bob", "world-a", true),
    demoPickupScope("alice", "world-b", true),
    demoPickupScope("alice", "world-a", false),
    "",
  ])
    assert.equal(model.confirm(other, coin("foreign"), 0), false);
  assert.equal(model.snapshot().count, 0);
});

test("errors, hidden views and reconnect do not replay a suppressed celebration", () => {
  const model = createPickupFeedback(scope, { delay: 1500 });
  model.confirm(scope, coin("during-error"), 0);
  assert.equal(model.flush(1500, false), null);
  assert.equal(model.flush(3000, true), null);
  assert.equal(model.snapshot().count, 1);
  model.confirm(scope, coin("before-hide"), 3000);
  model.quiet();
  assert.equal(model.flush(6000, true), null);
  model.confirm(scope, coin("new"), 7000);
  assert.equal(model.flush(8500, true).count, 1);
  assert.equal(model.snapshot().count, 3);
});

test("bounded session memory never forgets an old receipt to count it again", () => {
  const model = createPickupFeedback(scope, { capacity: 2 });
  model.confirm(scope, coin("one"), 0);
  model.confirm(scope, coin("two"), 0);
  assert.equal(model.confirm(scope, coin("three"), 0), false);
  assert.equal(model.confirm(scope, coin("one"), 0), false);
  assert.deepEqual(model.snapshot(), {
    count: 2,
    amount: 20_000,
    xp: 4,
    capped: true,
  });
  assert.equal(model.confirm(scope, coin("four"), 0), false);
});

test("session reset does not restore old totals; accounting overflow fails closed", () => {
  const first = createPickupFeedback(scope);
  first.confirm(scope, coin("one"), 0);
  assert.equal(createPickupFeedback(scope).snapshot().count, 0);
  const model = createPickupFeedback(scope);
  model.confirm(scope, coin("large", Number.MAX_SAFE_INTEGER), 0);
  assert.equal(model.confirm(scope, coin("overflow", 1), 0), false);
  assert.equal(model.snapshot().amount, Number.MAX_SAFE_INTEGER);
  assert.equal(model.snapshot().capped, true);
  assert.equal(demoPickupScope(undefined, "world-a"), "");
});

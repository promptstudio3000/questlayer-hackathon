import test from "node:test";
import assert from "node:assert/strict";
import { publicDistribution } from "../server/public-distribution.mjs";
test("concurrent public refreshes share work, preserve a newer worker audit, and hide provider errors", async () => {
  let now = 1_000,
    calls = 0,
    finish;
  const native = { lastAudit: null };
  const read = publicDistribution(
    native,
    async () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    () => now,
  );
  const pending = Promise.all(Array.from({ length: 25 }, () => read(true)));
  assert.equal(calls, 1);
  finish({ observedAt: now, status: "unavailable", reason: "private-fixture" });
  for (const result of await pending)
    assert.ok(!JSON.stringify(result).includes("private-fixture"));
  now += 29_999;
  await read(true);
  assert.equal(calls, 1);
  now++;
  const refresh = read(true);
  assert.equal(calls, 2);
  native.lastAudit = { observedAt: now + 1, status: "ready" };
  finish({ observedAt: now, status: "older" });
  assert.equal((await refresh).status, "ready");
});

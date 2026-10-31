import test from "node:test";
import assert from "node:assert/strict";
import { createNativeRefreshQueue } from "../src/native-refresh-queue.ts";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture() {
  const reads = [];
  let concurrency = 0,
    maximum = 0;
  const queue = createNativeRefreshQueue(async (context, fresh) => {
    const completion = deferred();
    const read = { context, fresh, ...completion };
    reads.push(read);
    maximum = Math.max(maximum, ++concurrency);
    try {
      await completion.promise;
    } finally {
      concurrency--;
    }
  });
  return { queue, reads, maximum: () => maximum };
}

test("ordinary polling shares a single active read", async () => {
  const { queue, reads, maximum } = fixture();
  const first = queue.request("1:alice");
  const second = queue.request("1:alice");
  assert.equal(first, second);
  assert.equal(reads.length, 1);
  reads[0].resolve();
  await Promise.all([first, second]);
  assert.equal(maximum(), 1);
});

test("fresh post-visit refresh awaits one fresh follow-up instead of the older poll", async () => {
  const { queue, reads, maximum } = fixture();
  const poll = queue.request("1:alice");
  const refresh = queue.request("1:alice", true);
  const repeated = queue.request("1:alice", true);
  let refreshed = false;
  void refresh.then(() => {
    refreshed = true;
  });
  assert.equal(refresh, repeated);
  reads[0].resolve();
  await poll;
  assert.equal(refreshed, false);
  assert.equal(reads.length, 2);
  assert.equal(reads[1].fresh, true);
  reads[1].resolve();
  await refresh;
  assert.equal(refreshed, true);
  assert.equal(maximum(), 1);
});

test("account switches immediately follow the active read and supersede intermediate accounts", async () => {
  const { queue, reads, maximum } = fixture();
  const old = queue.request("1:alice");
  const intermediate = queue.request("2:bob", true);
  const current = queue.request("3:carol");
  await intermediate;
  assert.equal(reads.length, 1);
  reads[0].resolve();
  await old;
  assert.deepEqual(
    reads.map((read) => read.context),
    ["1:alice", "3:carol"],
  );
  reads[1].resolve();
  await current;
  assert.equal(maximum(), 1);
});

test("disable or unmount cancels queued reads while allowing an active read to settle", async () => {
  const { queue, reads } = fixture();
  const active = queue.request("1:alice");
  const pending = queue.request("1:alice", true);
  queue.cancelPending();
  await pending;
  reads[0].resolve();
  await active;
  assert.equal(reads.length, 1);
  const resumed = queue.request("4:alice");
  assert.equal(reads[1].context, "4:alice");
  reads[1].resolve();
  await resumed;
});

test("failed active reads do not prevent a queued fresh read", async () => {
  const { queue, reads, maximum } = fixture();
  const active = queue.request("1:alice");
  const result = assert.rejects(active, /RPC unavailable/);
  const pending = queue.request("1:alice", true);
  reads[0].reject(new Error("RPC unavailable"));
  await result;
  assert.equal(reads.length, 2);
  reads[1].resolve();
  await pending;
  assert.equal(maximum(), 1);
});

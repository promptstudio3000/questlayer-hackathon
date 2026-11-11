import test from "node:test";
import assert from "node:assert/strict";
import { cachedNearProvider, createNearProvider, isRateLimited } from "../server/near-provider.mjs";

function fakeProvider() {
  const calls = [];
  let n = 0;
  return {
    calls,
    fail: null,
    async query(params) {
      calls.push(["query", params]);
      if (this.fail) throw this.fail;
      await new Promise((r) => setTimeout(r, 5));
      return { n: ++n, params };
    },
    async viewNodeStatus() {
      calls.push(["status"]);
      return { chain_id: "testnet" };
    },
    async viewBlock(q) {
      calls.push(["block", q]);
      return { header: { hash: "h" + ++n } };
    },
    async sendTransactionUntil() {
      calls.push(["send"]);
      return { ok: true };
    },
    other() {
      return this === undefined ? "lost" : "bound";
    },
  };
}
const view = (method, account = "a.testnet") => ({
  request_type: "call_function",
  account_id: account,
  method_name: method,
  args_base64: "e30=",
  finality: "final",
});
const opts = { rps: 0, concurrency: 0, ttlMs: 1000, staleMs: 30_000, maxEntries: 100, env: {} };

test("equal reads in flight are merged and reused for the TTL", async () => {
  const base = fakeProvider(),
    p = cachedNearProvider(base, opts);
  const [a, b] = await Promise.all([p.query(view("get")), p.query(view("get"))]);
  assert.equal(a, b);
  assert.equal((await p.query(view("get"))).n, a.n);
  assert.notEqual((await p.query(view("other"))).n, a.n);
  assert.equal(base.calls.filter((c) => c[0] === "query").length, 2);
  assert.equal(p.rpcCache.stats().hits, 1);
});

test("nonce reads and legacy query calls are never cached", async () => {
  const base = fakeProvider(),
    p = cachedNearProvider(base, opts);
  const key = { request_type: "view_access_key", account_id: "a.testnet", public_key: "ed25519:x", finality: "final" };
  await p.query(key);
  await p.query(key);
  await p.query("call/a.testnet/get", "");
  await p.query("call/a.testnet/get", "");
  assert.equal(base.calls.length, 4);
});

test("a transaction drops cached reads", async () => {
  const base = fakeProvider(),
    p = cachedNearProvider(base, opts);
  const first = await p.query(view("get"));
  await p.sendTransactionUntil({});
  const second = await p.query(view("get"));
  assert.notEqual(first.n, second.n);
  assert.equal(p.other(), "bound");
});

test("a failing RPC serves a recent value and 429 pauses reads", async () => {
  let t = 0;
  const base = fakeProvider(),
    p = cachedNearProvider(base, { ...opts, ttlMs: 10, clock: () => t, cooldownMs: 50 });
  const first = await p.query(view("get"));
  t = 100;
  base.fail = Object.assign(new Error("Too Many Requests"), { cause: 429 });
  assert.equal((await p.query(view("get"))).n, first.n);
  assert.equal(p.rpcCache.stats().stale, 1);
  assert.equal(p.rpcCache.stats().rateLimited, 1);
  t = 100_000;
  await assert.rejects(p.query(view("get")), /Too Many/);
  assert.ok(isRateLimited(base.fail));
});

test("node status is shared and reads are paced", async () => {
  const base = fakeProvider(),
    p = cachedNearProvider(base, { ...opts, rps: 20, burst: 2, concurrency: 2 });
  await Promise.all([p.viewNodeStatus(), p.viewNodeStatus()]);
  await p.viewNodeStatus();
  assert.equal(base.calls.filter((c) => c[0] === "status").length, 1);
  const started = Date.now();
  await Promise.all([1, 2, 3, 4, 5, 6].map((i) => p.query(view("m" + i))));
  // 2 burst tokens, then 20/s: four more reads need about 200 ms.
  assert.ok(Date.now() - started >= 150, "reads were not paced");
});

test("the server provider has three testnet endpoints behind the cache", () => {
  const p = createNearProvider();
  assert.ok(p.rpcCache);
  assert.equal(p.providers.length, 3);
  assert.equal(createNearProvider(undefined, { cache: false }).rpcCache, undefined);
});

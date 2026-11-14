import test from "node:test";
import assert from "node:assert/strict";
import { createWorldTreasuryMirror } from "../server/native/world-treasury-mirror.mjs";

test("world treasury mirror: marks the source, caches, refuses other paths and plain http", async () => {
  let calls = 0,
    t = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.equal(String(url), "https://world.example/api/treasury/mix");
    return { ok: true, json: async () => ({ total: "1", network: "testnet" }) };
  };
  const m = createWorldTreasuryMirror({ origin: "https://world.example", fetchImpl, now: () => t });
  assert.deepEqual(await m.read("/api/treasury/mix"), { total: "1", network: "testnet", mirroredFrom: "https://world.example" });
  t = 30_000;
  await m.read("/api/treasury/mix");
  assert.equal(calls, 1);
  await assert.rejects(() => m.read("/api/players"), /Not a mirrored path/);
  assert.equal(createWorldTreasuryMirror({ origin: "http://world.example" }), null);
  assert.equal(createWorldTreasuryMirror({ origin: "" }), null);
});

test("world treasury mirror: keeps a recent copy when World is down, null without one", async () => {
  let t = 0,
    up = true;
  const fetchImpl = async () => (up ? { ok: true, json: async () => ({ a: 1 }) } : { ok: false, status: 502 });
  const m = createWorldTreasuryMirror({ origin: "https://w.example", fetchImpl, now: () => t });
  await m.read("/api/treasury/dao");
  up = false;
  t = 120_000;
  assert.equal((await m.read("/api/treasury/dao")).a, 1);
  assert.equal(await m.read("/api/treasury/history"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { UPSTREAM_MODELS, UPSTREAM_SOURCE, UpstreamModels } from "../server/upstream-models.mjs";

const response = (bytes, ok = true) => ({
  ok,
  headers: { get: () => String(bytes.length) },
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
});

test("every pinned model uses the fixed source and a full digest", () => {
  assert.match(UPSTREAM_SOURCE.commit, /^[0-9a-f]{40}$/);
  assert.ok(UPSTREAM_SOURCE.base.startsWith(`https://raw.githubusercontent.com/${UPSTREAM_SOURCE.repository}/${UPSTREAM_SOURCE.commit}/`));
  for (const [key, entry] of Object.entries(UPSTREAM_MODELS)) {
    assert.match(key, /^[a-z-]{3,32}$/);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(entry.bytes > 0 && entry.bytes <= 2 * 1024 * 1024);
    assert.ok(entry.path.endsWith(".fbx"));
  }
});

test("serves only bytes that match the recorded size and digest, and caches them", async () => {
  const bytes = Buffer.from("fake fbx bytes for the test");
  const good = { path: "Assets/Some Dir/Model.fbx", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const calls = [];
  const fetcher = async (url, init) => (calls.push({ url, init }), response(bytes));
  const models = new UpstreamModels({ fetcher, table: { good, bad: { ...good, sha256: "0".repeat(64) } } });
  const first = await models.get("good");
  assert.equal(first.sha256, good.sha256);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].url, UPSTREAM_SOURCE.base + "Assets/Some%20Dir/Model.fbx");
  await models.get("good");
  assert.equal(calls.length, 1, "second read comes from the cache");
  await assert.rejects(models.get("bad"), (e) => e.status === 502 && /changed/.test(e.message));
});

test("refuses unknown keys and upstream failures", async () => {
  const models = new UpstreamModels({ fetcher: async () => response(Buffer.alloc(0), false) });
  await assert.rejects(models.get("../etc/passwd"), (e) => e.status === 404);
  await assert.rejects(models.get("lick-soldier"), (e) => e.status === 502);
  const offline = new UpstreamModels({ fetcher: async () => { throw Error("offline"); } });
  await assert.rejects(offline.get("great-portal"), /unavailable/);
});

// Test Layer vs QuestLayer World (docs/TEST-LAYER.md).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const probe = (env) =>
  spawnSync(
    process.execPath,
    ["--input-type=module", "-e", 'const n = await import("./server/native/network.mjs"); console.log(JSON.stringify({ layer: n.LAYER, set: n.MANIFEST_SET, name: n.manifestName("native-market"), ttl: n.SESSION_TTL_MS }));'],
    { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" },
  );

test("World reads the network's manifests and keeps 30-day sessions", () => {
  const r = probe({ NEAR_NETWORK: "testnet" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { layer: "world", set: "testnet", name: "native-market-testnet.json", ttl: 30 * 24 * 3600 * 1000 });
});

test("the Test Layer reads its own contract set and has 4-hour explorers", () => {
  const r = probe({ NEAR_NETWORK: "testnet", QL_LAYER: "test" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { layer: "test", set: "testlayer", name: "native-market-testlayer.json", ttl: 4 * 3600 * 1000 });
});

test("mainnet refuses the Test Layer and unknown layers are refused", () => {
  const main = probe({ NEAR_NETWORK: "mainnet", QL_LAYER: "test" });
  assert.notEqual(main.status, 0);
  assert.match(main.stderr, /testnet only/);
  const odd = probe({ NEAR_NETWORK: "testnet", QL_LAYER: "demo" });
  assert.notEqual(odd.status, 0);
  assert.match(odd.stderr, /QL_LAYER must be/);
});

test("the Test Layer unit is testnet, its own state and keeps the test-only switches", () => {
  const unit = readFileSync("deploy/questlayer-testlayer.service", "utf8");
  for (const line of ["QL_LAYER=test", "NEAR_NETWORK=testnet", "PORT=7093", "TEST_SEED=1", "DEMO_ZONES=plzen-compact", "StateDirectory=questlayer-testlayer", "APP_ORIGIN=https://questlayer-test.promptstudio3000.com"])
    assert.ok(unit.includes(line), line);
  assert.ok(!readFileSync("deploy/questlayer-mainnet.service", "utf8").includes("QL_LAYER=test"));
});

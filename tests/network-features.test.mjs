// Mainnet feature flags (docs/MAINNET-PLAN.md §3 step 7). This file runs in
// both `npm test` (testnet) and `npm run test:mainnet`.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  FEATURES,
  NETWORK,
  ENABLED_FEATURES,
  featureEnabled,
  parseFeatures,
} from "../server/native/network.mjs";

test("testnet keeps every slice on and ignores MAINNET_FEATURES", () => {
  assert.deepEqual(parseFeatures("testnet", ""), FEATURES);
  assert.deepEqual(parseFeatures("testnet", "collectibles"), FEATURES);
});

test("mainnet enables only the listed slices, in a fixed order", () => {
  assert.deepEqual(parseFeatures("mainnet", "social, collectibles,relayer"), [
    "collectibles",
    "relayer",
    "social",
  ]);
  assert.throws(() => parseFeatures("mainnet", ""), /include "collectibles"/);
  assert.throws(
    () => parseFeatures("mainnet", "collectibles,yield-credit"),
    /unknown slice "yield-credit"/,
  );
  assert.throws(
    () => parseFeatures("mainnet", "collectibles,vaults"),
    /"vaults" requires "rewards"/,
  );
  assert.throws(() => featureEnabled("nope"), /Unknown feature/);
});

test("the running process reflects its configured network", () => {
  if (NETWORK === "testnet") assert.deepEqual(ENABLED_FEATURES, FEATURES);
  else {
    assert.ok(featureEnabled("collectibles"));
    for (const f of FEATURES)
      assert.equal(
        featureEnabled(f),
        (process.env.MAINNET_FEATURES || "").split(",").includes(f),
      );
  }
});

test("a mainnet process without the collectibles slice refuses to load", () => {
  const run = (env) =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'const m = await import("./server/native/network.mjs"); console.log(JSON.stringify([m.NETWORK, m.ENABLED_FEATURES]))',
      ],
      { env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe" },
    );
  assert.deepEqual(
    JSON.parse(
      run({ NEAR_NETWORK: "mainnet", MAINNET_FEATURES: "collectibles,social" }),
    ),
    ["mainnet", ["collectibles", "social"]],
  );
  assert.throws(() => run({ NEAR_NETWORK: "mainnet", MAINNET_FEATURES: "" }));
});

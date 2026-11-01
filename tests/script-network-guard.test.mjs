import test from "node:test";
import assert from "node:assert/strict";
import {
  scriptNetwork,
  requestedNetwork,
  assertChain,
} from "../scripts/lib/network-guard.mjs";

const testnetOperator = { network: "testnet", accountId: "ops.testnet" };
const mainnetOperator = { network: "mainnet", accountId: "questlayer.near" };
const mainnetArgs = ["--network", "mainnet"];
const mainnetEnv = {
  NEAR_NETWORK: "mainnet",
  NEAR_MAINNET_CONFIRM: "questlayer.near",
};

test("testnet stays the default and needs no confirmation", () => {
  assert.equal(requestedNetwork([]), "testnet");
  assert.deepEqual(
    scriptNetwork({ operator: testnetOperator, argv: [], env: {} }),
    {
      network: "testnet",
      accountSuffix: ".testnet",
      rpcUrl: "https://test.rpc.fastnear.com",
    },
  );
  assert.equal(requestedNetwork(["--network=mainnet"]), "mainnet");
  assert.throws(() => requestedNetwork(["--network", "devnet"]), /must be/);
});

test("mainnet needs the script's opt-in, both switches and the confirmation", () => {
  const ok = scriptNetwork({
    operator: mainnetOperator,
    allowMainnet: true,
    argv: mainnetArgs,
    env: mainnetEnv,
  });
  assert.equal(ok.network, "mainnet");
  assert.equal(ok.accountSuffix, ".near");
  const refused = [
    { allowMainnet: false },
    { argv: [] },
    { env: { ...mainnetEnv, NEAR_NETWORK: undefined } },
    { env: { ...mainnetEnv, NEAR_MAINNET_CONFIRM: undefined } },
    { env: { ...mainnetEnv, NEAR_MAINNET_CONFIRM: "someone.near" } },
    { operator: testnetOperator },
    { operator: { network: "mainnet", accountId: "ops.testnet" } },
    { operator: undefined },
  ];
  for (const change of refused)
    assert.throws(
      () =>
        scriptNetwork({
          operator: mainnetOperator,
          allowMainnet: true,
          argv: mainnetArgs,
          env: mainnetEnv,
          ...change,
        }),
      (error) => error.code === "NETWORK_GUARD",
      JSON.stringify(change),
    );
});

test("a testnet run refuses a stray NEAR_NETWORK=mainnet or a mainnet key", () => {
  assert.throws(
    () =>
      scriptNetwork({
        operator: testnetOperator,
        argv: [],
        env: { NEAR_NETWORK: "mainnet" },
      }),
    /does not match/,
  );
  assert.throws(
    () => scriptNetwork({ operator: mainnetOperator, argv: [], env: {} }),
    /not a testnet account/,
  );
});

test("the RPC chain must match the selected network", async () => {
  const node = (chain_id) => ({ viewNodeStatus: async () => ({ chain_id }) });
  await assertChain(node("testnet"), "testnet");
  await assert.rejects(
    assertChain(node("testnet"), "mainnet"),
    /serves testnet/,
  );
});

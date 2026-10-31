import test from "node:test";
import assert from "node:assert/strict";
import { parseNearPrice, formatNativeNear } from "../src/native-amounts.ts";
import { NativeMarket } from "../server/native/market.mjs";
test("native prices preserve yoctoNEAR precision and reject unsupported representations", () => {
  assert.equal(parseNearPrice("10"), "10000000000000000000000000");
  assert.equal(
    parseNearPrice("0.001000000000000000000001"),
    "1000000000000000000001",
  );
  assert.equal(
    formatNativeNear(parseNearPrice("10.123456789012345678901234")),
    "10.123456789012345678901234",
  );
  for (const value of [
    "0",
    "0.0009",
    "1000.01",
    "1e2",
    "-1",
    "1,5",
    "1.0000000000000000000000001",
  ])
    assert.throws(() => parseNearPrice(value));
});
test("native market enables only active offers with a currently escrowed NFT", async () => {
  const marketId = "market.project.testnet",
    nfts = {
      contractId: "nfts.project.testnet",
      view: async (_m, a) => ({
        token_id: a.token_id,
        owner_id: a.token_id.endsWith(":1") ? marketId : "buyer.testnet",
        metadata: { title: "Native Aura" },
      }),
    };
  const reader = new NativeMarket(
    { viewNodeStatus: async () => ({ chain_id: "testnet" }) },
    marketId,
    nfts,
  );
  reader.view = async (method) =>
    method === "get_stats"
      ? {
          version: 1,
          network: "testnet",
          nft_contract: nfts.contractId,
          listing_count: 3,
        }
      : [
          { id: 1, token_id: "aura:polar:1", state: "active", price: "1000" },
          { id: 2, token_id: "aura:moon:2", state: "active", price: "1000" },
          { id: 3, token_id: "aura:gold:3", state: "buying", price: "1000" },
        ];
  const state = await reader.snapshot({ verifyTokenId: "aura:moon:2" });
  assert.deepEqual(
    state.listings.map((l) => l.available),
    [true, false, false],
  );
  assert.equal(state.token.ownerId, "buyer.testnet");
  reader.view = async () => ({
    version: 1,
    network: "testnet",
    nft_contract: "other.testnet",
  });
  await assert.rejects(reader.snapshot(), /does not match/);
});

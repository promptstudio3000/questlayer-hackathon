import test from "node:test";
import assert from "node:assert/strict";
import * as client from "../src/near-network.ts";
import * as server from "../server/native/network.mjs";

test("client and server agree on the default network and its constants", () => {
  assert.equal(client.NEAR_NETWORK, "testnet");
  assert.equal(client.NEAR_NETWORK, server.NETWORK);
  assert.equal(client.ACCOUNT_SUFFIX, server.ACCOUNT_SUFFIX);
  assert.equal(client.NETWORK_LABEL, server.NETWORK_LABEL);
  assert.equal(client.SOCIAL_CONTRACT_ID, server.SOCIAL_CONTRACT_ID);
  assert.equal(client.EXPLORER_BASE, server.EXPLORER_BASE);
});

test("client account checks follow the bundle network", () => {
  assert.equal(client.onNearNetwork("game.questlayer.testnet"), true);
  assert.equal(client.onNearNetwork("game.questlayer.near"), false);
  assert.equal(client.onNearNetwork(undefined), false);
});

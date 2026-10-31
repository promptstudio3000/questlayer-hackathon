import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeviceKey,
  bindAccount,
  loadDeviceKey,
  memoryKeyStore,
  signDelegate,
} from "../src/player-key.ts";
import {
  decodeSignedDelegate,
  verifySignedDelegate,
} from "../server/relayer/delegate.mjs";

test("a device key is created once, bound to one account and signs delegates the relayer can decode", async () => {
  const store = memoryKeyStore();
  const key = await createDeviceKey(store, 1);
  assert.match(key.publicKey, /^ed25519:/);
  assert.equal(await createDeviceKey(store, 2), key, "second call reuses the key");
  await bindAccount(store, "mira-7f3k.play.testnet");
  assert.equal((await loadDeviceKey(store))?.accountId, "mira-7f3k.play.testnet");
  await assert.rejects(bindAccount(store, "other.play.testnet"), /another explorer/);
  const signed = await signDelegate(key, {
    senderId: "mira-7f3k.play.testnet",
    receiverId: "nfts.questlayer.testnet",
    call: {
      methodName: "equip_aura",
      args: { token_id: "aura:polar:1" },
      gas: "30000000000000",
      deposit: "0",
    },
    nonce: "7",
    maxBlockHeight: "100",
  });
  const decoded = decodeSignedDelegate(signed.signedDelegateBase64);
  assert.equal(decoded.delegateHash, signed.delegateHash);
  assert.equal(decoded.publicKey, key.publicKey);
  assert.equal(decoded.delegateAction.senderId, "mira-7f3k.play.testnet");
  assert.equal(decoded.delegateAction.nonce, 7n);
  assert.equal(verifySignedDelegate(decoded), true);
});

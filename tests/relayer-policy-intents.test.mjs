import test from "node:test";
import assert from "node:assert/strict";
import {
  KeyPair,
  KeyPairSigner,
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
} from "near-api-js";
import { decodeSignedDelegate } from "../server/relayer/delegate.mjs";
import { RelayPolicyError, validateDelegate } from "../server/relayer/policy.mjs";

const CONTRACTS = {
  collectibles: "nfts.questlayer-dev-20261101.testnet",
  market: "questlayer-market-20261101b.testnet",
  intents: "questlayer-intents-20261104.testnet",
  wnear: "wrap.testnet",
};
const SENDER = "alice.players.questlayer.testnet",
  GAS = 100_000_000_000_000n;
const device = KeyPair.fromRandom("ed25519"),
  signer = new KeyPairSigner(device),
  deviceKey = device.getPublicKey().toString();
const ctx = (contracts = CONTRACTS) => ({
  accountId: SENDER,
  keys: [deviceKey],
  nonce: 100n,
  blockHeight: 5000,
  blockTtl: 120,
  contracts,
});
async function delegate(receiverId, method, args, deposit) {
  const delegateAction = buildDelegateAction({
    senderId: SENDER,
    receiverId,
    actions: [actions.functionCall(method, args, GAS, deposit)],
    nonce: 101n,
    maxBlockHeight: 5100n,
    publicKey: await signer.getPublicKey(),
  });
  const { signedDelegate } = await signer.signDelegateAction(delegateAction);
  return decodeSignedDelegate(Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64"));
}
async function rejects(input, code, context = ctx()) {
  await assert.rejects(
    async () => validateDelegate(await input, context),
    (e) => e instanceof RelayPolicyError && e.code === code,
    `expected ${code}`,
  );
}

test("intents key registration and own deposits are sponsored", async () => {
  const key = validateDelegate(
    await delegate(CONTRACTS.intents, "add_public_key", { public_key: deviceKey }, 1n),
    ctx(),
  );
  assert.equal(key.methodName, "add_public_key");
  const aura = validateDelegate(
    await delegate(CONTRACTS.collectibles, "nft_transfer_call", { receiver_id: CONTRACTS.intents, token_id: "aura:polar:1", approval_id: null, memo: null, msg: "" }, 1n),
    ctx(),
  );
  assert.equal(aura.args.receiver_id, CONTRACTS.intents);
  const wnear = validateDelegate(
    await delegate(CONTRACTS.wnear, "ft_transfer_call", { receiver_id: CONTRACTS.intents, amount: "10000000000000000000000", msg: "" }, 1n),
    ctx(),
  );
  assert.equal(wnear.methodName, "ft_transfer_call");
});

test("deposits for someone else, other methods and missing manifest are refused", async () => {
  await rejects(
    delegate(CONTRACTS.collectibles, "nft_transfer_call", { receiver_id: CONTRACTS.intents, token_id: "aura:polar:1", msg: "eve.testnet" }, 1n),
    "RELAY_TRANSFER_TARGET",
  );
  await rejects(
    delegate(CONTRACTS.wnear, "ft_transfer_call", { receiver_id: CONTRACTS.intents, amount: "1", msg: "eve.testnet" }, 1n),
    "RELAY_ARGS",
  );
  await rejects(delegate(CONTRACTS.wnear, "near_deposit", {}, 1n), "RELAY_METHOD");
  await rejects(delegate(CONTRACTS.intents, "execute_intents", { signed: [] }, 0n), "RELAY_METHOD");
  await rejects(delegate(CONTRACTS.intents, "add_public_key", { public_key: deviceKey }, 0n), "RELAY_DEPOSIT");
  const { intents, wnear, ...withoutIntents } = CONTRACTS;
  await rejects(
    delegate(CONTRACTS.collectibles, "nft_transfer_call", { receiver_id: intents, token_id: "aura:polar:1", msg: "" }, 1n),
    "RELAY_TRANSFER_TARGET",
    ctx(withoutIntents),
  );
  await rejects(delegate(wnear, "ft_transfer_call", { receiver_id: intents, amount: "1", msg: "" }, 1n), "RELAY_RECEIVER", ctx(withoutIntents));
});

test("a linked Ethereum wallet's secp256k1 key can be registered for ERC-191 intents", async () => {
  // 64-byte uncompressed point, base58, as the verifier prints secp256k1 keys.
  const evmKey = `secp256k1:${"2".repeat(87)}`;
  const key = validateDelegate(
    await delegate(CONTRACTS.intents, "add_public_key", { public_key: evmKey }, 1n),
    ctx(),
  );
  assert.equal(key.args.public_key, evmKey);
  await rejects(delegate(CONTRACTS.intents, "add_public_key", { public_key: "secp256k1:abc" }, 1n), "RELAY_ARGS");
  await rejects(delegate(CONTRACTS.intents, "add_public_key", { public_key: evmKey, extra: 1 }, 1n), "RELAY_ARGS");
});

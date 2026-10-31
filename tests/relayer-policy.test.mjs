import test from "node:test";
import assert from "node:assert/strict";
import {
  KeyPair,
  KeyPairSigner,
  PublicKey,
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
} from "near-api-js";
import { decodeSignedDelegate } from "../server/relayer/delegate.mjs";
import {
  RelayPolicyError,
  STORAGE_DEPOSIT,
  validateDelegate,
} from "../server/relayer/policy.mjs";

const CONTRACTS = {
  collectibles: "nfts.auratrail-dev-20261030.testnet",
  market: "questlayer-market-20261031.testnet",
  rewards: "questlayer-rewards-20261031.testnet",
  social: "v1.social08.testnet",
};
const SENDER = "alice.players.questlayer.testnet",
  WALLET = "alice-main.testnet",
  GAS = 100_000_000_000_000n;
const device = KeyPair.fromRandom("ed25519"),
  signer = new KeyPairSigner(device),
  deviceKey = device.getPublicKey().toString(),
  pendingKey = KeyPair.fromRandom("ed25519").getPublicKey().toString(),
  strangerKey = KeyPair.fromRandom("ed25519").getPublicKey().toString();
const ctx = () => ({
  accountId: SENDER,
  keys: [deviceKey],
  pendingKeys: [pendingKey],
  linkedWallets: [WALLET],
  nonce: 100n,
  blockHeight: 5000,
  blockTtl: 120,
  maxGas: 300_000_000_000_000n,
  maxBuyDeposit: 5n * 10n ** 24n,
  contracts: CONTRACTS,
});
async function decoded({
  receiverId = CONTRACTS.collectibles,
  action = actions.functionCall("mint_avatar", {}, GAS, STORAGE_DEPOSIT),
  list = [action],
  senderId = SENDER,
  nonce = 101n,
  maxBlockHeight = 5100n,
  key = signer,
} = {}) {
  const delegateAction = buildDelegateAction({
    senderId,
    receiverId,
    actions: list,
    nonce,
    maxBlockHeight,
    publicKey: await key.getPublicKey(),
  });
  const { signedDelegate } = await key.signDelegateAction(delegateAction);
  return decodeSignedDelegate(
    Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64"),
  );
}
const call = (method, args, deposit, gas = GAS) =>
  actions.functionCall(method, args, gas, deposit);
async function rejects(input, code, context = ctx()) {
  await assert.rejects(
    async () => validateDelegate(await input, context),
    (error) => error instanceof RelayPolicyError && error.code === code,
    `expected ${code}`,
  );
}

test("allowlisted calls normalize to a sponsored call with string amounts", async () => {
  const mint = validateDelegate(await decoded(), ctx());
  assert.deepEqual(mint, {
    senderId: SENDER,
    receiverId: CONTRACTS.collectibles,
    publicKey: deviceKey,
    nonce: "101",
    maxBlockHeight: "5100",
    kind: "call",
    methodName: "mint_avatar",
    args: {},
    gas: GAS.toString(),
    deposit: STORAGE_DEPOSIT.toString(),
    sponsorDeposit: true,
  });
  const matrix = [
    [
      CONTRACTS.collectibles,
      call(
        "redeem_aura",
        {
          claim_id: "earned:1",
          edition: "polar",
          receiver_id: SENDER,
          expires_at_ms: 1,
          signature: "x",
        },
        STORAGE_DEPOSIT,
      ),
      true,
    ],
    [
      CONTRACTS.collectibles,
      call("equip_aura", { token_id: "aura:polar:1", slot: "above" }, 0n),
      true,
    ],
    [CONTRACTS.collectibles, call("unequip_aura", { slot: "above" }, 0n), true],
    [
      CONTRACTS.collectibles,
      call(
        "nft_transfer_call",
        {
          receiver_id: CONTRACTS.market,
          token_id: "aura:polar:1",
          approval_id: null,
          memo: null,
          msg: '{"price":"1"}',
        },
        1n,
      ),
      true,
    ],
    [
      CONTRACTS.collectibles,
      call(
        "nft_transfer",
        { receiver_id: WALLET, token_id: "aura:polar:1" },
        1n,
      ),
      true,
    ],
    [
      CONTRACTS.market,
      call("buy", { token_id: "aura:polar:1", listing_id: 1 }, 10n ** 24n),
      false,
    ],
    [
      CONTRACTS.market,
      call("cancel", { token_id: "aura:polar:1", listing_id: 1 }, 1n),
      true,
    ],
    [CONTRACTS.market, call("withdraw", {}, 1n), true],
    [CONTRACTS.rewards, call("withdraw", {}, 1n), true],
    [
      CONTRACTS.social,
      call("set", { data: { [SENDER]: { questlayer: { profile: {} } } } }, 1n),
      true,
    ],
    [
      CONTRACTS.social,
      call("set", { data: { [SENDER]: {} } }, STORAGE_DEPOSIT),
      true,
    ],
  ];
  for (const [receiverId, action, sponsorDeposit] of matrix) {
    const result = validateDelegate(
      await decoded({ receiverId, action }),
      ctx(),
    );
    assert.equal(result.kind, "call", action.functionCall.methodName);
    assert.equal(result.receiverId, receiverId);
    assert.equal(
      result.sponsorDeposit,
      sponsorDeposit,
      action.functionCall.methodName,
    );
    assert.equal(result.deposit, action.functionCall.deposit.toString());
  }
});

test("deposit, target and method rules reject every off-list variant", async () => {
  const c = CONTRACTS.collectibles;
  await rejects(
    decoded({ action: call("mint_avatar", {}, STORAGE_DEPOSIT - 1n) }),
    "RELAY_DEPOSIT",
  );
  await rejects(
    decoded({ action: call("mint_avatar", { extra: 1 }, STORAGE_DEPOSIT) }),
    "RELAY_ARGS",
  );
  await rejects(
    decoded({
      action: call(
        "redeem_aura",
        { claim_id: "earned:1", receiver_id: "bob.testnet" },
        STORAGE_DEPOSIT,
      ),
    }),
    "RELAY_ARGS",
  );
  await rejects(
    decoded({
      action: call(
        "equip_aura",
        { token_id: "aura:polar:1", slot: "above" },
        1n,
      ),
    }),
    "RELAY_DEPOSIT",
  );
  await rejects(
    decoded({
      action: call(
        "nft_transfer_call",
        {
          receiver_id: "other-market.testnet",
          token_id: "aura:polar:1",
          msg: "{}",
        },
        1n,
      ),
    }),
    "RELAY_TRANSFER_TARGET",
  );
  await rejects(
    decoded({
      action: call(
        "nft_transfer",
        { receiver_id: "stranger.testnet", token_id: "aura:polar:1" },
        1n,
      ),
    }),
    "RELAY_TRANSFER_TARGET",
  );
  await rejects(
    decoded({
      action: call(
        "nft_transfer",
        { receiver_id: WALLET, token_id: "aura:polar:1" },
        0n,
      ),
    }),
    "RELAY_DEPOSIT",
  );
  await rejects(
    decoded({
      action: call(
        "nft_approve",
        { token_id: "aura:polar:1", account_id: WALLET },
        1n,
      ),
    }),
    "RELAY_METHOD",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.market,
      action: call("buy", { listing_id: 1 }, 0n),
    }),
    "RELAY_DEPOSIT",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.market,
      action: call("buy", { listing_id: 1 }, 5n * 10n ** 24n + 1n),
    }),
    "RELAY_DEPOSIT",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.market,
      action: call("cancel", { listing_id: 1 }, 2n),
    }),
    "RELAY_DEPOSIT",
  );
  await rejects(
    decoded({ receiverId: CONTRACTS.market, action: call("list", {}, 1n) }),
    "RELAY_METHOD",
  );
  await rejects(
    decoded({ receiverId: CONTRACTS.rewards, action: call("claim", {}, 0n) }),
    "RELAY_METHOD",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.rewards,
      action: call("withdraw", {}, 0n),
    }),
    "RELAY_DEPOSIT",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.social,
      action: call("set", { data: { "bob.testnet": {} } }, 1n),
    }),
    "RELAY_ARGS",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.social,
      action: call("set", { data: { [SENDER]: {} } }, 2n),
    }),
    "RELAY_DEPOSIT",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.social,
      action: call("get", { keys: [] }, 0n),
    }),
    "RELAY_METHOD",
  );
  await rejects(
    decoded({ receiverId: "evil.testnet", action: call("withdraw", {}, 1n) }),
    "RELAY_RECEIVER",
  );
  await rejects(
    decoded({
      receiverId: SENDER,
      action: call("mint_avatar", {}, STORAGE_DEPOSIT),
    }),
    "RELAY_RECEIVER",
  );
  assert.equal(c, CONTRACTS.collectibles);
});

test("shape, identity, nonce, expiry, gas and argument bounds", async () => {
  const mint = call("mint_avatar", {}, STORAGE_DEPOSIT);
  await rejects(decoded({ list: [mint, mint] }), "RELAY_SHAPE");
  await rejects(decoded({ list: [] }), "RELAY_SHAPE");
  const inner = await decoded();
  // near-api-js cannot even borsh-encode a delegate inside a delegate; a hand-built
  // decoded shape proves the policy rejects it independently of the decoder.
  await rejects(
    Promise.resolve({
      ...inner,
      delegateAction: {
        ...inner.delegateAction,
        receiverId: SENDER,
        actions: [{ signedDelegate: inner.signedDelegate }],
      },
    }),
    "RELAY_SHAPE",
  );
  await rejects(decoded({ list: [actions.transfer(1n)] }), "RELAY_SHAPE");
  await rejects(
    decoded({ senderId: "bob.players.questlayer.testnet" }),
    "RELAY_SENDER",
  );
  await rejects(
    decoded({ key: new KeyPairSigner(KeyPair.fromRandom("ed25519")) }),
    "RELAY_KEY",
  );
  await rejects(decoded({ nonce: 100n }), "RELAY_NONCE");
  await rejects(decoded({ nonce: 102n }), "RELAY_NONCE");
  await rejects(decoded({ maxBlockHeight: 5000n }), "RELAY_EXPIRY");
  await rejects(decoded({ maxBlockHeight: 5121n }), "RELAY_EXPIRY");
  assert.equal(
    validateDelegate(await decoded({ maxBlockHeight: 5120n }), ctx())
      .maxBlockHeight,
    "5120",
  );
  await rejects(
    decoded({
      action: call("mint_avatar", {}, STORAGE_DEPOSIT, 300_000_000_000_001n),
    }),
    "RELAY_GAS",
  );
  await rejects(
    decoded({ action: call("mint_avatar", {}, STORAGE_DEPOSIT, 0n) }),
    "RELAY_GAS",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.social,
      action: call(
        "set",
        { data: { [SENDER]: { pad: "x".repeat(8200) } } },
        1n,
      ),
    }),
    "RELAY_ARGS",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.market,
      action: call("withdraw", [1], 1n),
    }),
    "RELAY_ARGS",
  );
  await rejects(
    decoded({
      receiverId: CONTRACTS.market,
      action: call("withdraw", new Uint8Array([0x7b]), 1n),
    }),
    "RELAY_ARGS",
  );
  assert.throws(
    () => validateDelegate(inner, { ...ctx(), contracts: {} }),
    /unavailable/,
  );
});

test("key changes are sponsored only for registered keys on the sender itself", async () => {
  const add = actions.addFullAccessKey(PublicKey.fromString(pendingKey));
  const added = validateDelegate(
    await decoded({ receiverId: SENDER, action: add }),
    ctx(),
  );
  assert.equal(added.kind, "addKey");
  assert.deepEqual(added.args, { publicKey: pendingKey });
  assert.equal(added.methodName, null);
  assert.equal(added.sponsorDeposit, true);
  const removed = validateDelegate(
    await decoded({
      receiverId: SENDER,
      action: actions.deleteKey(PublicKey.fromString(pendingKey)),
    }),
    ctx(),
  );
  assert.equal(removed.kind, "deleteKey");
  await rejects(
    decoded({ receiverId: CONTRACTS.collectibles, action: add }),
    "RELAY_RECEIVER",
  );
  await rejects(
    decoded({
      receiverId: SENDER,
      action: actions.addFullAccessKey(PublicKey.fromString(strangerKey)),
    }),
    "RELAY_KEY_TARGET",
  );
  await rejects(
    decoded({
      receiverId: SENDER,
      action: actions.addFunctionCallAccessKey(
        PublicKey.fromString(pendingKey),
        CONTRACTS.collectibles,
        ["mint_avatar"],
      ),
    }),
    "RELAY_KEY_TARGET",
  );
  await rejects(
    decoded({
      receiverId: SENDER,
      action: actions.deleteKey(PublicKey.fromString(strangerKey)),
    }),
    "RELAY_KEY_TARGET",
  );
  await rejects(
    decoded({
      receiverId: SENDER,
      action: actions.deleteKey(PublicKey.fromString(deviceKey)),
    }),
    "RELAY_KEY_TARGET",
    { ...ctx(), pendingKeys: [deviceKey] },
  );
});

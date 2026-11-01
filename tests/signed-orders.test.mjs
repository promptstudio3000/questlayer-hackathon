import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  intentsTokenDiffSketch,
  nep413Digest,
  orderTerms,
  verifySignedOrderLocally,
} from "../server/native/signed-orders.mjs";
import { NETWORK } from "../server/native/network.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/signed-aura-order.json", import.meta.url)),
);
const env = { market: "market.testnet", nftContract: "nfts.testnet", nowMs: 1_793_000_000_000 };

test("Node verifies the shared NEP-413 order fixture that the contract verifies", () => {
  const terms = verifySignedOrderLocally(fixture, env);
  assert.equal(terms.kind, "sell");
  assert.equal(terms.price, "10000000000000000000000000");
  assert.equal(terms.token_id, "aura:polar:1");
});

test("NEP-413 digest encodes tag, nonce, recipient and optional callback", () => {
  const base = { message: "m", nonce: Buffer.alloc(32, 7), recipient: "market.testnet" };
  assert.notDeepEqual(nep413Digest(base), nep413Digest({ ...base, callbackUrl: "https://x" }));
  assert.notDeepEqual(nep413Digest(base), nep413Digest({ ...base, recipient: "intents.near" }));
  assert.throws(() => nep413Digest({ ...base, nonce: Buffer.alloc(31) }), /32 bytes/);
});

test("tampered price, wrong recipient, expiry and long deadlines are rejected", () => {
  const tampered = { ...fixture, message: fixture.message.replace("10000000000000000000000000", "1000000000000000000000000") };
  assert.throws(() => verifySignedOrderLocally(tampered, env), /Invalid signature/);
  assert.throws(() => verifySignedOrderLocally(fixture, { ...env, market: "other.testnet" }), /another recipient/);
  assert.throws(() => verifySignedOrderLocally(fixture, { ...env, nowMs: 1_793_003_600_000 }), /expired/);
  assert.throws(() => verifySignedOrderLocally(fixture, { ...env, nowMs: 1_793_003_600_000 - 31 * 86_400_000 }), /30 days/);
});

test("non-canonical terms are refused so the wallet text equals the contract terms", () => {
  const spaced = { ...fixture, message: fixture.message.replace('"kind":"sell"', '"kind": "sell"') };
  assert.throws(() => verifySignedOrderLocally(spaced, env), /canonical/);
});

test("order terms validate price range, token and network", () => {
  const ok = { kind: "buy", market: "m.testnet", nftContract: "n.testnet", maker: "b.testnet", tokenId: "aura:moon:3", price: 10n ** 22n, deadlineMs: 1 };
  assert.equal(orderTerms(ok).price, "10000000000000000000000");
  assert.throws(() => orderTerms({ ...ok, price: 1n }), /between/);
  assert.throws(() => orderTerms({ ...ok, tokenId: "avatar:1" }), /Aura/);
  assert.throws(() => orderTerms({ ...ok, network: "mainnet" }), /testnet-only/);
});

test("the Intents sketch is labelled unverified and mirrors the exact swap", () => {
  const sketch = intentsTokenDiffSketch(JSON.parse(fixture.message));
  assert.equal(sketch.status, "unverified-sketch");
  assert.deepEqual(sketch.intents[0].diff, {
    "nep171:nfts.testnet:aura:polar:1": "-1",
    "nep141:wrap.testnet": "10000000000000000000000000",
  });
});

// Signed orders are a testnet-only market feature; the mainnet pass skips the relay.
test("the order relay indexes only orders the market contract accepts", { skip: NETWORK !== "testnet" }, async () => {
  const { NativeMarket } = await import("../server/native/market.mjs");
  const nfts = { contractId: "nfts.testnet", view: async () => null };
  const reader = new NativeMarket({}, "market.testnet", nfts);
  let valid = true;
  reader.view = async (method) =>
    method === "get_stats"
      ? { version: 2 }
      : { valid, reason: valid ? null : "Order nonce already used", fillable: valid };
  const r = await reader.submitOrder(fixture, env.nowMs);
  assert.equal(r.terms.maker, "seller.testnet");
  assert.equal((await reader.signedOrders({}, env.nowMs)).orders.length, 1);
  valid = false;
  assert.equal((await reader.signedOrders({}, env.nowMs)).orders.length, 0);
  await assert.rejects(reader.submitOrder(fixture, env.nowMs), /nonce already used/);
  reader.view = async () => ({ version: 1 });
  await assert.rejects(reader.submitOrder(fixture, env.nowMs), /version 2/);
});

test("the browser device-key signer produces the exact bytes the contract verifies", async () => {
  const { KeyPairEd25519, baseEncode } = await import("near-api-js");
  const { orderTerms: browserTerms, signOrder, statusFromCheck } = await import("../src/signed-order.ts");
  const seed = new Uint8Array(32).fill(1);
  const { createPrivateKey, createPublicKey } = await import("node:crypto");
  const pub = createPublicKey(
    createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" }),
  ).export({ type: "spki", format: "der" }).subarray(-32);
  const secretKey = `ed25519:${baseEncode(Buffer.concat([seed, pub]))}`;
  assert.equal(new KeyPairEd25519(baseEncode(Buffer.concat([seed, pub]))).getPublicKey().toString(), fixture.public_key);
  const terms = browserTerms({
    kind: "sell", market: "market.testnet", nftContract: "nfts.testnet", maker: "seller.testnet",
    tokenId: "aura:polar:1", price: "10000000000000000000000000", deadlineMs: 1_793_003_600_000, epoch: 0,
  });
  const order = await signOrder(
    { publicKey: fixture.public_key, secretKey, accountId: "seller.testnet", origin: "device", createdAt: 0 },
    terms,
    new Uint8Array(32).fill(7),
  );
  assert.deepEqual(order, fixture);
  assert.equal(statusFromCheck({ valid: false, reason: "Order nonce already used" }, true), "cancelled");
  assert.equal(statusFromCheck({ valid: false, reason: "Order expired" }), "expired");
  assert.equal(statusFromCheck({ valid: true }), "open");
});

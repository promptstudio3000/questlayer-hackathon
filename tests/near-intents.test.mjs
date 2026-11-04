import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import {
  PIPS_MAX,
  TREASURY_FEE_PIPS,
  auraOrderTerms,
  auraTokenDiff,
  auraTransferPair,
  checkWithdrawal,
  feeForGross,
  grossForNet,
  intentMessage,
  matches,
  netDeltas,
  netForGross,
  parseNonce,
  signIntentWithKeyPair,
  verifierInitArgs,
  verifyIntentLocally,
  versionedNonce,
} from "../server/native/intents.mjs";

const verifier = "questlayer-intents-20261104.testnet",
  nftContract = "nfts.questlayer-dev-20261101.testnet",
  wnear = "wrap.testnet",
  tokenId = "aura:polar:1",
  price = (10n ** 22n).toString(),
  now = Date.parse("2026-11-04T03:00:00Z");
const seller = KeyPair.fromRandom("ed25519"),
  buyer = KeyPair.fromRandom("ed25519");

function sign(keyPair, signerId, intents, { deadlineMs = now + 3600_000, salt = "a1b2c3d4" } = {}) {
  const message = intentMessage({ signerId, deadlineMs, intents });
  const nonce = versionedNonce({ salt, deadlineMs });
  return signIntentWithKeyPair(keyPair, { message, nonce, recipient: verifier });
}

test("versioned nonce layout matches the verifier's V1 borsh layout", () => {
  const deadlineMs = Date.parse("2026-11-05T00:00:00Z");
  const n = versionedNonce({ salt: "0badf00d", deadlineMs, random: Buffer.alloc(15, 7) });
  assert.equal(n.length, 32);
  assert.equal(n.subarray(0, 5).toString("hex"), "5628f6c600");
  assert.equal(n.subarray(5, 9).toString("hex"), "0badf00d");
  assert.equal(n.readBigInt64LE(9), BigInt(deadlineMs) * 1_000_000n);
  assert.deepEqual(parseNonce(n), { version: 1, salt: "0badf00d", deadlineMs });
  assert.equal(parseNonce(Buffer.alloc(32, 1)), null);
});

test("intent message uses the verifier's field order and RFC 3339 deadline", () => {
  const m = intentMessage({ signerId: "alice.testnet", deadlineMs: now, intents: [{ intent: "token_diff", diff: { a: "1" } }] });
  assert.equal(m, '{"signer_id":"alice.testnet","deadline":"2026-11-04T03:00:00.000Z","intents":[{"intent":"token_diff","diff":{"a":"1"}}]}');
});

test("a signed sell token_diff verifies and reads back as an Aura order", () => {
  const intent = auraTokenDiff({ side: "sell", nftContract, tokenId, price, wnear });
  assert.deepEqual(intent.diff, {
    "nep171:nfts.questlayer-dev-20261101.testnet:aura:polar:1": "-1",
    "nep141:wrap.testnet": price,
  });
  const signed = sign(seller, "alice.testnet", [intent]);
  assert.equal(signed.standard, "nep413");
  assert.match(signed.signature, /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
  const body = verifyIntentLocally(signed, { verifier, nowMs: now });
  assert.equal(body.signerId, "alice.testnet");
  assert.equal(body.salt, "a1b2c3d4");
  const terms = auraOrderTerms(body.intents, { nftContract, wnear });
  assert.equal(terms.side, "sell");
  assert.equal(terms.price, price);
  assert.equal(terms.tokenId, tokenId);
});

test("tampered, misaddressed, expired and legacy-nonce intents are refused", () => {
  const intent = auraTokenDiff({ side: "sell", nftContract, tokenId, price, wnear });
  const signed = sign(seller, "alice.testnet", [intent]);
  const tampered = structuredClone(signed);
  tampered.payload.message = tampered.payload.message.replace(price, "1" + price);
  assert.throws(() => verifyIntentLocally(tampered, { verifier, nowMs: now }), /signature/);
  assert.throws(() => verifyIntentLocally(signed, { verifier: "intents.near", nowMs: now }), /another verifier/);
  assert.throws(() => verifyIntentLocally(signed, { verifier, nowMs: now + 2 * 3600_000 }), /expired/);
  const legacy = structuredClone(signed);
  legacy.payload.nonce = Buffer.alloc(32, 9).toString("base64");
  assert.throws(() => verifyIntentLocally(legacy, { verifier, nowMs: now }), /versioned nonce|signature/);
});

test("opposite token_diffs match and net to zero; same-side orders do not", () => {
  const sell = auraTokenDiff({ side: "sell", nftContract, tokenId, price, wnear }),
    buy = auraTokenDiff({ side: "buy", nftContract, tokenId, price, wnear });
  const a = auraOrderTerms([sell], { nftContract, wnear }),
    b = auraOrderTerms([buy], { nftContract, wnear });
  assert.ok(matches(a, b));
  assert.ok(!matches(a, a));
  assert.deepEqual(
    netDeltas([
      { signerId: "alice.testnet", intents: [sell] },
      { signerId: "bob.testnet", intents: [buy] },
    ]),
    {},
  );
  const cheaper = auraTokenDiff({ side: "buy", nftContract, tokenId, price: (10n ** 21n).toString(), wnear });
  assert.ok(!matches(a, auraOrderTerms([cheaper], { nftContract, wnear })));
  assert.deepEqual(
    netDeltas([
      { signerId: "alice.testnet", intents: [sell] },
      { signerId: "bob.testnet", intents: [cheaper] },
    ]),
    { "nep141:wrap.testnet": (9n * 10n ** 21n).toString() },
  );
});

test("the treasury fee follows the verifier's rounding: the seller gets the price exactly", () => {
  assert.equal(TREASURY_FEE_PIPS, 20_000);
  assert.equal(PIPS_MAX, 1_000_000n);
  for (const p of [10n ** 22n, 10n ** 24n + 7n, 123_456_789_012_345_678_901n, 5n * 10n ** 25n]) {
    const gross = grossForNet(p, TREASURY_FEE_PIPS);
    // The verifier keeps ceil(gross * fee / 1e6) and passes the rest on.
    const verifierFee = (gross * 20_000n + PIPS_MAX - 1n) / PIPS_MAX;
    assert.equal(gross - verifierFee, p);
    assert.equal(netForGross(gross, TREASURY_FEE_PIPS), p);
    assert.equal(feeForGross(gross, TREASURY_FEE_PIPS), verifierFee);
    // One yocto less would short the seller.
    assert.ok(netForGross(gross - 1n, TREASURY_FEE_PIPS) < p);
    assert.equal(grossForNet(p, 0), p);
  }
  // 2 % of what the buyer gives: 0.01 NEAR to the seller costs ~0.0102 NEAR.
  assert.equal(grossForNet(10n ** 22n, TREASURY_FEE_PIPS), 10_204_081_632_653_061_224_490n);
  assert.throws(() => grossForNet(1n, 1_000_000), /fee/);
  assert.throws(() => netForGross(1n, -1), /fee/);
});

test("with the fee on, a fee-paying buy matches a sell and the batch nets to zero", () => {
  const feePips = TREASURY_FEE_PIPS,
    opts = { nftContract, wnear, feePips };
  const sell = auraTokenDiff({ side: "sell", nftContract, tokenId, price, wnear }),
    buy = auraTokenDiff({ side: "buy", nftContract, tokenId, price, wnear, feePips });
  assert.equal(buy.diff["nep141:wrap.testnet"], `-${grossForNet(price, feePips)}`);
  const a = auraOrderTerms([sell], opts),
    b = auraOrderTerms([buy], opts);
  assert.equal(b.price, price);
  assert.equal(b.gross, grossForNet(price, feePips).toString());
  assert.ok(matches(a, b));
  const bodies = [
    { signerId: "alice.testnet", intents: [sell] },
    { signerId: "bob.testnet", intents: [buy] },
  ];
  assert.deepEqual(netDeltas(bodies, feePips), {});
  // Without the fee the buyer's extra shows up as an unmatched delta.
  assert.ok(Object.keys(netDeltas(bodies)).length);
  // A buy signed before the fee went on no longer covers the seller's price.
  const old = auraTokenDiff({ side: "buy", nftContract, tokenId, price, wnear });
  assert.ok(!matches(a, auraOrderTerms([old], opts)));
});

test("fallback transfer pair names both parties and moves exactly one Aura", () => {
  const pair = auraTransferPair({ seller: "alice.testnet", buyer: "bob.testnet", nftContract, tokenId, price, wnear });
  assert.deepEqual(pair.seller, {
    intent: "transfer",
    receiver_id: "bob.testnet",
    tokens: { "nep171:nfts.questlayer-dev-20261101.testnet:aura:polar:1": "1" },
  });
  assert.deepEqual(pair.buyer.tokens, { "nep141:wrap.testnet": price });
  assert.throws(() => auraTransferPair({ seller: "a.testnet", buyer: "a.testnet", nftContract, tokenId, price, wnear }));
});

test("orders outside the price band or with foreign NFTs are refused", () => {
  assert.throws(() => auraTokenDiff({ side: "sell", nftContract, tokenId, price: "1", wnear }), /Price/);
  assert.throws(
    () => auraOrderTerms([{ intent: "token_diff", diff: { "nep171:other.testnet:aura:x:1": "-1", "nep141:wrap.testnet": price } }], { nftContract, wnear }),
    /this game/,
  );
  assert.throws(
    () => auraOrderTerms([{ intent: "token_diff", diff: { [`nep171:${nftContract}:${tokenId}`]: "-1", "nep141:wrap.testnet": `-${price}` } }], { nftContract, wnear }),
    /oppose/,
  );
});

test("withdrawals may only return the signer's own Auras or wNEAR", () => {
  const ok = { signerId: "alice.testnet", intents: [{ intent: "nft_withdraw", token: nftContract, token_id: tokenId, receiver_id: "alice.testnet" }, { intent: "native_withdraw", receiver_id: "alice.testnet", amount: price }] };
  assert.equal(checkWithdrawal(ok, { nftContract, wnear }).length, 2);
  assert.throws(() => checkWithdrawal({ signerId: "alice.testnet", intents: [{ intent: "nft_withdraw", token: nftContract, token_id: tokenId, receiver_id: "eve.testnet" }] }, { nftContract, wnear }), /own account/);
  assert.throws(() => checkWithdrawal({ signerId: "alice.testnet", intents: [{ intent: "transfer", receiver_id: "alice.testnet", tokens: {} }] }, { nftContract, wnear }), /Only withdrawals/);
  assert.throws(() => checkWithdrawal({ signerId: "alice.testnet", intents: [{ intent: "ft_withdraw", token: wnear, amount: "1", receiver_id: "alice.testnet", msg: "x" }] }, { nftContract, wnear }), /other contracts/);
});

test("verifier init args are testnet-only with a zero fee", () => {
  const args = verifierInitArgs({ owner: "questlayer-dev-20261101.testnet", wnear });
  assert.equal(args.config.fees.fee, 0);
  assert.equal(args.config.wnear_id, "wrap.testnet");
  assert.deepEqual(args.config.roles.super_admins, ["questlayer-dev-20261101.testnet"]);
  assert.throws(() => verifierInitArgs({ owner: "questlayer.near", wnear: "wrap.near" }), /testnet-only/);
});

test("browser builders produce the same bytes as the server helpers", async () => {
  const web = await import("../src/intents-order.ts");
  const deadlineMs = Date.parse("2026-11-05T00:00:00Z"),
    random = new Uint8Array(15).fill(3);
  assert.deepEqual(
    Buffer.from(web.versionedNonce("0badf00d", deadlineMs, random)),
    versionedNonce({ salt: "0badf00d", deadlineMs, random: Buffer.from(random) }),
  );
  const intents = [web.auraTokenDiff("buy", nftContract, tokenId, price, wnear)];
  assert.deepEqual(intents[0], auraTokenDiff({ side: "buy", nftContract, tokenId, price, wnear }));
  assert.equal(web.intentMessage("bob.testnet", deadlineMs, intents), intentMessage({ signerId: "bob.testnet", deadlineMs, intents }));
  assert.deepEqual(
    web.auraTokenDiff("buy", nftContract, tokenId, price, wnear, TREASURY_FEE_PIPS),
    auraTokenDiff({ side: "buy", nftContract, tokenId, price, wnear, feePips: TREASURY_FEE_PIPS }),
  );
  for (const p of ["10000000000000000000000", "123456789012345678901", "1"])
    assert.equal(web.grossForNet(p, TREASURY_FEE_PIPS), grossForNet(p, TREASURY_FEE_PIPS).toString());
});

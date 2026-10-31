import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deserialize, serialize } from "borsh";
import {
  KeyPair,
  KeyPairSigner,
  PublicKey,
  SCHEMA,
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
} from "near-api-js";
import {
  DELEGATE_ACTION_PREFIX,
  decodeSignedDelegate,
  verifySignedDelegate,
} from "../server/relayer/delegate.mjs";

async function signed(extra = {}) {
  const key = KeyPair.fromRandom("ed25519"),
    signer = new KeyPairSigner(key),
    publicKey = await signer.getPublicKey();
  const delegateAction = buildDelegateAction({
    senderId: "alice.players.testnet",
    receiverId: "nfts.auratrail-dev-20261030.testnet",
    actions: [
      actions.functionCall(
        "mint_avatar",
        {},
        100_000_000_000_000n,
        50_000_000_000_000_000_000_000n,
      ),
    ],
    nonce: 43n,
    maxBlockHeight: 1_000_200n,
    publicKey,
    ...extra,
  });
  const { delegateHash, signedDelegate } =
    await signer.signDelegateAction(delegateAction);
  const bytes = encodeSignedDelegate(signedDelegate);
  return {
    key,
    publicKey,
    delegateAction,
    delegateHash,
    signedDelegate,
    bytes,
  };
}

test("a random KeyPairSigner delegate round-trips through base64/borsh and verifies locally with the NEP-461 prefix", async () => {
  const s = await signed();
  const base64 = Buffer.from(s.bytes).toString("base64");
  const plain = deserialize(
    SCHEMA.SignedDelegate,
    Buffer.from(base64, "base64"),
  );
  assert.equal(plain.delegateAction.senderId, "alice.players.testnet");
  assert.equal(plain.delegateAction.nonce, 43n);
  assert.equal(plain.delegateAction.maxBlockHeight, 1_000_200n);
  assert.equal(plain.delegateAction.actions.length, 1);
  const call = plain.delegateAction.actions[0].functionCall;
  assert.equal(call.methodName, "mint_avatar");
  assert.equal(Buffer.from(call.args).toString(), "{}");
  assert.equal(call.gas, 100_000_000_000_000n);
  assert.equal(call.deposit, 50_000_000_000_000_000_000_000n);
  assert.equal(
    PublicKey.from(plain.delegateAction.publicKey).toString(),
    s.publicKey.toString(),
  );
  // The library signs sha256(u32le(2^30+366) || borsh(DelegateAction)).
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(DELEGATE_ACTION_PREFIX);
  const expected = createHash("sha256")
    .update(prefix)
    .update(serialize(SCHEMA.DelegateAction, plain.delegateAction))
    .digest();
  assert.deepEqual(Buffer.from(s.delegateHash), expected);
  const signature = Uint8Array.from(plain.signature.ed25519Signature.data);
  assert.equal(signature.length, 64);
  assert.equal(s.publicKey.verify(new Uint8Array(expected), signature), true);
  assert.equal(
    s.publicKey.verify(
      new Uint8Array(
        createHash("sha256")
          .update(serialize(SCHEMA.DelegateAction, plain.delegateAction))
          .digest(),
      ),
      signature,
    ),
    false,
    "an unprefixed hash must not verify",
  );
  // Our decoder reproduces the same identity and verdict.
  const decoded = decodeSignedDelegate(base64);
  assert.equal(decoded.delegateHash, expected.toString("hex"));
  assert.equal(decoded.publicKey, s.publicKey.toString());
  assert.equal(verifySignedDelegate(decoded), true);
  assert.deepEqual(
    Buffer.from(serialize(SCHEMA.SignedDelegate, decoded.signedDelegate)),
    Buffer.from(s.bytes),
  );
});

test("tampered bytes, foreign keys and non-canonical input are rejected", async () => {
  const s = await signed();
  const base64 = Buffer.from(s.bytes).toString("base64");
  const tampered = Buffer.from(s.bytes);
  tampered[tampered.length - 1] ^= 1;
  assert.equal(
    verifySignedDelegate(decodeSignedDelegate(tampered.toString("base64"))),
    false,
  );
  const other = KeyPair.fromRandom("ed25519");
  const swapped = deserialize(SCHEMA.SignedDelegate, s.bytes);
  swapped.delegateAction.publicKey = other.getPublicKey();
  const swappedBytes = Buffer.from(
    serialize(SCHEMA.SignedDelegate, swapped),
  ).toString("base64");
  assert.equal(verifySignedDelegate(decodeSignedDelegate(swappedBytes)), false);
  assert.throws(
    () => decodeSignedDelegate(base64 + "AAAA"),
    /decoded|canonical/,
  );
  assert.throws(() => decodeSignedDelegate("not base64!"), /encoding/);
  assert.throws(
    () => decodeSignedDelegate(Buffer.from([1, 2, 3]).toString("base64")),
    /decoded/,
  );
});

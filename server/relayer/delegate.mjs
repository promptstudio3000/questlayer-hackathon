import { createHash } from "node:crypto";
import { deserialize, serialize } from "borsh";
import { PublicKey, SCHEMA } from "near-api-js";
import { assert } from "../domain.mjs";

// NEP-366 meta transactions sign sha256(prefix || borsh(DelegateAction)) where the
// prefix is the NEP-461 actionable-message discriminant 2^30 + 366 as little-endian u32.
export const DELEGATE_ACTION_PREFIX = 2 ** 30 + 366;
export const MAX_SIGNED_DELEGATE_BYTES = 16384;

export function delegateActionHash(delegateAction) {
  return createHash("sha256")
    .update(
      serialize(SCHEMA.DelegateActionPrefix, {
        prefix: DELEGATE_ACTION_PREFIX,
      }),
    )
    .update(serialize(SCHEMA.DelegateAction, delegateAction))
    .digest();
}
export function publicKeyString(value) {
  return PublicKey.from(value).toString();
}
export function signatureBytes(signature) {
  const inner =
    signature?.ed25519Signature ||
    signature?.secp256k1Signature ||
    signature?.mlDsa65Signature;
  assert(
    inner && inner.data,
    "Invalid delegate signature.",
    400,
    "RELAY_DECODE",
  );
  return Uint8Array.from(inner.data);
}
// Decodes a base64 SignedDelegate. The decoded form must re-serialize to the
// identical bytes, so one signed action has exactly one durable identity.
export function decodeSignedDelegate(base64) {
  assert(
    typeof base64 === "string" &&
      base64.length > 0 &&
      base64.length <= Math.ceil(MAX_SIGNED_DELEGATE_BYTES / 3) * 4 &&
      base64.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(base64),
    "Invalid signed delegate encoding.",
    400,
    "RELAY_DECODE",
  );
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  assert(
    Buffer.from(bytes).toString("base64") === base64,
    "Invalid signed delegate encoding.",
    400,
    "RELAY_DECODE",
  );
  let signedDelegate;
  try {
    signedDelegate = deserialize(SCHEMA.SignedDelegate, bytes);
  } catch {
    assert(
      false,
      "The signed delegate could not be decoded.",
      400,
      "RELAY_DECODE",
    );
  }
  assert(
    Buffer.from(serialize(SCHEMA.SignedDelegate, signedDelegate)).equals(
      Buffer.from(bytes),
    ),
    "The signed delegate is not canonical.",
    400,
    "RELAY_DECODE",
  );
  const delegateAction = signedDelegate.delegateAction;
  let publicKey;
  try {
    publicKey = publicKeyString(delegateAction.publicKey);
  } catch {
    assert(false, "Unsupported delegate key.", 400, "RELAY_DECODE");
  }
  return {
    bytes,
    signedDelegate,
    delegateAction,
    publicKey,
    delegateHash: delegateActionHash(delegateAction).toString("hex"),
  };
}
// Local signature check; the chain verifies again, this only rejects garbage early.
export function verifySignedDelegate(decoded) {
  const { delegateAction, signature } = decoded.signedDelegate;
  try {
    return PublicKey.from(delegateAction.publicKey).verify(
      new Uint8Array(delegateActionHash(delegateAction)),
      signatureBytes(signature),
    );
  } catch {
    return false;
  }
}

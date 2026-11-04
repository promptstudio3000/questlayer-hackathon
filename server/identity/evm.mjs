// Ethereum wallet sign-in (MetaMask, Rabby and other EIP-1193 wallets).
//
// Sign-In with Ethereum (EIP-4361) message, signed with personal_sign
// (EIP-191). The server rebuilds the exact message it issued, recovers the
// signer and its public key, and never stores a signature or any key that
// can move funds. The recovered secp256k1 public key is what the NEAR
// Intents verifier recovers from an "erc191" signed intent, so the same
// wallet can later sign intents for the explorer's NEAR account once that
// key is registered with the verifier (add_public_key).
//
// Only externally owned accounts are supported: smart-contract wallets
// (EIP-1271) cannot sign NEAR Intents, which recover the key with ecrecover.
import { baseEncode } from "near-api-js";
import { hashMessage, recoverPublicKey, getAddress, keccak256 } from "viem";
import { createSiweMessage } from "viem/siwe";
import { assert } from "../domain.mjs";

export const EVM_STATEMENT =
  "Sign in to QuestLayer. Authentication only: no transaction, no approval and no funds transfer.";
const MAX_CHAIN_ID = 2 ** 31;

export function evmAddress(value) {
  assert(
    typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
    "Enter a valid Ethereum address.",
  );
  return value.toLowerCase();
}

export function evmChainId(value) {
  const n = Number(value ?? 1);
  assert(
    Number.isSafeInteger(n) && n > 0 && n < MAX_CHAIN_ID,
    "The wallet reported an invalid chain.",
  );
  return n;
}

/** Hex nonce text is alphanumeric, as EIP-4361 requires. */
export function siweNonce(bytes) {
  const hex = Buffer.from(bytes).toString("hex");
  assert(hex.length >= 16, "Nonce too short.");
  return hex;
}

/** The exact EIP-4361 text the wallet shows and signs. */
export function signInMessage({ origin, address, chainId, nonce, issuedAt, expiresAt }) {
  const url = new URL(origin);
  return createSiweMessage({
    domain: url.host,
    uri: url.origin,
    address: getAddress(address),
    chainId,
    nonce,
    statement: EVM_STATEMENT,
    version: "1",
    issuedAt: new Date(issuedAt),
    expirationTime: new Date(expiresAt),
  });
}

/** Uncompressed key (65 bytes with 0x04) -> address and intents key text. */
export function evmKeyInfo(uncompressedHex) {
  const bytes = Buffer.from(String(uncompressedHex).replace(/^0x/, ""), "hex");
  assert(bytes.length === 65 && bytes[0] === 4, "Unexpected public key.");
  const raw = bytes.subarray(1);
  const address = `0x${keccak256(raw).slice(-40)}`;
  return { address, intentsPublicKey: `secp256k1:${baseEncode(raw)}` };
}

/** 65-byte personal_sign signature (v = 27/28 or 0/1). */
export function evmSignatureBytes(signature) {
  assert(
    typeof signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(signature),
    "The wallet returned an invalid signature.",
  );
  const bytes = Buffer.from(signature.slice(2), "hex");
  const v = bytes[64];
  assert([0, 1, 27, 28].includes(v), "The wallet returned an invalid signature.");
  return bytes;
}

/**
 * Recovers the signer of a personal_sign message and checks it is the
 * expected address. Returns the address and the NEAR Intents public key.
 */
export async function verifyEvmSignature({ message, signature, address }) {
  const expected = evmAddress(address);
  const bytes = evmSignatureBytes(signature);
  let key;
  try {
    key = await recoverPublicKey({
      hash: hashMessage(message),
      signature: `0x${bytes.toString("hex")}`,
    });
  } catch {
    assert(false, "The wallet returned an invalid signature.", 401);
  }
  const info = evmKeyInfo(key);
  assert(info.address === expected, "The signature does not match this address.", 401);
  return info;
}

/** Wallet name a browser reported (EIP-6963), for display only. */
export function walletLabel(value) {
  const text = String(value ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 32);
  return text || null;
}

// NEAR Intents (Verifier contract from github.com/near/intents, v0.4.5) for
// Aura <-> wNEAR trades. Pure helpers shared by the server, the Mac proof
// script and the tests: token ids, versioned salted nonces, the NEP-413
// intent envelope (MultiPayload "nep413"), the Ethereum wallet envelope
// (MultiPayload "erc191"), trade intents and local checks.
//
// Formats were read from the pinned verifier source (see INTENTS_SOURCE):
//   - token ids: "nep171:<nft contract>:<token id>", "nep141:<ft contract>"
//     (crates/primitives/token-id); token_diff takes no fee on NFTs.
//   - NEP-413 message: {"signer_id","deadline" (RFC 3339),"intents":[...]},
//     recipient = the verifier account (contracts/defuse/core/src/payload).
//   - versioned nonce: 5628f6c6 ++ borsh(V1{salt[4], deadline i64 ns, [15]})
//     (contracts/defuse/core/src/nonce). The salt comes from current_salt().
//   - signed payload: {"standard":"nep413","payload":{message,nonce,recipient},
//     "public_key":"ed25519:<b58>","signature":"ed25519:<b58>"}.
//
// Nothing here signs for a player: signing helpers take a key the caller
// already controls (the device key in the browser, dev keys in scripts).
import {
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import { baseDecode, baseEncode } from "near-api-js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { assert } from "../domain.mjs";
import { nep413Digest, ed25519KeyBytes } from "./signed-orders.mjs";

export const INTENTS_SOURCE = Object.freeze({
  repository: "https://github.com/near/intents",
  tag: "defuse/v0.4.5",
  commit: "16d04f6ec4401263f8914638710260da50bb46b0",
  crate: "contracts/defuse",
  features: "contract",
  // From contracts/defuse/Cargo.toml [package.metadata.near.reproducible_build]
  image: "sourcescan/cargo-near:0.22.0-rust-1.97.1",
  imageDigest:
    "sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234",
});
export const NONCE_MAGIC = Buffer.from("5628f6c6", "hex");
export const MAX_INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PRICE = 10n ** 21n; // 0.001 wNEAR
export const MAX_PRICE = 1000n * 10n ** 24n;
const ACCOUNT =
  /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const AURA = /^aura:[a-z0-9-]{1,24}:\d{1,6}$/;
const SALT = /^[0-9a-f]{8}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const account = (id, label = "account") => {
  assert(ACCOUNT.test(String(id)), `Invalid NEAR ${label}.`);
  return String(id);
};
export const nep171 = (contract, tokenId) =>
  `nep171:${account(contract, "NFT contract")}:${tokenId}`;
export const nep141 = (contract) => `nep141:${account(contract, "token")}`;

/**
 * 32-byte versioned nonce (V1): magic(4) ++ 0x00 ++ salt(4) ++ deadline as
 * little-endian i64 nanoseconds ++ 15 random bytes. The verifier rejects it
 * once the deadline passes or the salt is rotated out, so stale orders die
 * on their own and their nonces can be garbage-collected.
 */
export function versionedNonce({ salt, deadlineMs, random = randomBytes(15) }) {
  assert(SALT.test(String(salt)), "Invalid verifier salt.");
  assert(Number.isSafeInteger(deadlineMs) && deadlineMs > 0, "Invalid deadline.");
  const tail = Buffer.from(random);
  assert(tail.length === 15, "The nonce tail must be 15 bytes.");
  const deadline = Buffer.alloc(8);
  deadline.writeBigInt64LE(BigInt(deadlineMs) * 1_000_000n);
  return Buffer.concat([
    NONCE_MAGIC,
    Buffer.from([0]),
    Buffer.from(salt, "hex"),
    deadline,
    tail,
  ]);
}

/** Reads a versioned nonce back; null for a legacy (random) nonce. */
export function parseNonce(nonce) {
  const n = Buffer.from(nonce);
  assert(n.length === 32, "Nonce must be 32 bytes.");
  if (!n.subarray(0, 4).equals(NONCE_MAGIC) || n[4] !== 0) return null;
  return {
    version: 1,
    salt: n.subarray(5, 9).toString("hex"),
    deadlineMs: Number(n.readBigInt64LE(9) / 1_000_000n),
  };
}

/** The NEP-413 `message` the signer signs: exact key order, no whitespace. */
export function intentMessage({ signerId, deadlineMs, intents }) {
  account(signerId, "signer");
  assert(Array.isArray(intents) && intents.length > 0, "No intents to sign.");
  return JSON.stringify({
    signer_id: signerId,
    deadline: new Date(deadlineMs).toISOString(),
    intents,
  });
}

const price = (value) => {
  const p = BigInt(value);
  assert(
    p >= MIN_PRICE && p <= MAX_PRICE,
    "Price must be between 0.001 and 1000 wNEAR.",
  );
  return p;
};

/** token_diff for one side of an Aura <-> wNEAR swap (no counterparty named). */
export function auraTokenDiff({ side, nftContract, tokenId, price: p, wnear, memo }) {
  assert(side === "sell" || side === "buy", "Side must be sell or buy.");
  assert(AURA.test(String(tokenId)), "Choose a native Aura.");
  const amount = price(p).toString(),
    nft = nep171(nftContract, tokenId),
    ft = nep141(wnear);
  return {
    intent: "token_diff",
    diff:
      side === "sell"
        ? { [nft]: "-1", [ft]: amount }
        : { [nft]: "1", [ft]: `-${amount}` },
    ...(memo ? { memo: String(memo).slice(0, 64) } : {}),
  };
}

/**
 * Fallback shape: two `transfer` intents (seller -> buyer Aura, buyer ->
 * seller wNEAR) executed in the same execute_intents call, so the swap stays
 * atomic. It needs both parties known in advance (a direct deal or the NPC
 * trader), while token_diff orders can be taken by anyone.
 */
export function auraTransferPair({ seller, buyer, nftContract, tokenId, price: p, wnear }) {
  assert(account(seller) !== account(buyer), "Seller and buyer must differ.");
  assert(AURA.test(String(tokenId)), "Choose a native Aura.");
  return {
    seller: {
      intent: "transfer",
      receiver_id: buyer,
      tokens: { [nep171(nftContract, tokenId)]: "1" },
    },
    buyer: {
      intent: "transfer",
      receiver_id: seller,
      tokens: { [nep141(wnear)]: price(p).toString() },
    },
  };
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

/** MultiPayload {standard:"nep413"} from a signature the signer produced. */
export function signedIntent({ message, nonce, recipient, publicKey, signature }) {
  const sig = Buffer.from(
    typeof signature === "string" && !signature.startsWith("ed25519:")
      ? Buffer.from(signature, "base64")
      : typeof signature === "string"
        ? baseDecode(signature.slice(8))
        : signature,
  );
  assert(sig.length === 64, "Signature must be 64 bytes.");
  ed25519KeyBytes(publicKey);
  return {
    standard: "nep413",
    payload: { message, nonce: b64(nonce), recipient },
    public_key: publicKey,
    signature: `ed25519:${baseEncode(sig)}`,
  };
}

/** Developer/test signer: signs the NEP-413 digest with a near-api-js KeyPair. */
export function signIntentWithKeyPair(keyPair, { message, nonce, recipient }) {
  const { signature } = keyPair.sign(nep413Digest({ message, nonce, recipient }));
  return signedIntent({
    message,
    nonce,
    recipient,
    publicKey: keyPair.getPublicKey().toString(),
    signature,
  });
}

/** The signed message an envelope carries: {nonce (base64), body JSON text}. */
export function intentEnvelope(signed) {
  if (signed?.standard === "erc191") {
    let body;
    try {
      body = JSON.parse(signed.payload);
    } catch {
      assert(false, "Malformed intent message.");
    }
    return { nonce: String(body?.nonce || ""), message: signed.payload, body };
  }
  const p = signed?.payload || {};
  return { nonce: String(p.nonce || ""), message: p.message, body: null };
}

/** The intents a stored signed payload carries (either standard). */
export function intentsOf(signed) {
  const { message, body } = intentEnvelope(signed);
  return (body || JSON.parse(message)).intents;
}

function checkBody(body, nonce, nowMs) {
  account(body.signer_id, "signer");
  const deadlineMs = Date.parse(body.deadline);
  assert(Number.isFinite(deadlineMs) && deadlineMs > nowMs, "The intent has expired.");
  assert(deadlineMs <= nowMs + MAX_INTENT_TTL_MS, "The intent deadline is too far away.");
  const versioned = parseNonce(nonce);
  assert(versioned, "Use a versioned nonce from the verifier salt.");
  assert(deadlineMs <= versioned.deadlineMs, "The intent outlives its nonce.");
  return { deadlineMs, salt: versioned.salt };
}

/**
 * Stateless checks mirroring the verifier: standard, recipient, signature,
 * deadline vs. nonce deadline. Registered keys, used nonces, balances and
 * the current salt are verifier state: confirm them with its views
 * (has_public_key, is_nonce_used, mt_balance_of, is_valid_salt) or with
 * simulate_intents before relying on a payload.
 *
 * Two standards are accepted: "nep413" (the device key) and "erc191"
 * (an Ethereum wallet's personal_sign; the verifier recovers the secp256k1
 * key, see crates/signatures/erc191 and core/src/payload/erc191.rs).
 */
export function verifyIntentLocally(signed, { verifier, nowMs = Date.now() }) {
  if (signed?.standard === "erc191") return verifyErc191Locally(signed, { verifier, nowMs });
  assert(signed && signed.standard === "nep413", "Only NEP-413 and ERC-191 intents are accepted.");
  const p = signed.payload || {};
  assert(typeof p.message === "string" && p.message.length <= 4096, "Malformed intent.");
  assert(p.recipient === verifier, "The intent was signed for another verifier.");
  assert(p.callbackUrl == null && p.callback_url == null, "Callback URLs are not accepted.");
  const nonce = Buffer.from(String(p.nonce || ""), "base64");
  assert(nonce.length === 32, "Nonce must be 32 bytes.");
  assert(
    typeof signed.signature === "string" &&
      signed.signature.startsWith("ed25519:") &&
      B58.test(signed.signature.slice(8)),
    "Invalid signature format.",
  );
  const sig = Buffer.from(baseDecode(signed.signature.slice(8)));
  assert(sig.length === 64, "Signature must be 64 bytes.");
  let body;
  try {
    body = JSON.parse(p.message);
  } catch {
    assert(false, "Malformed intent message.");
  }
  assert(
    body && Object.keys(body).join(",") === "signer_id,deadline,intents",
    "Unexpected intent message fields.",
  );
  const { deadlineMs, salt } = checkBody(body, nonce, nowMs);
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, ed25519KeyBytes(signed.public_key)]),
    format: "der",
    type: "spki",
  });
  const digest = nep413Digest({ message: p.message, nonce, recipient: p.recipient });
  assert(verifySignature(null, digest, key, sig), "Invalid intent signature.");
  return {
    signerId: body.signer_id,
    deadlineMs,
    intents: body.intents,
    nonce: p.nonce,
    salt,
    publicKey: signed.public_key,
  };
}

/** ERC-191 payload text: exact key order, no whitespace (what the wallet shows). */
export function erc191Payload({ signerId, verifier, deadlineMs, nonce, intents }) {
  account(signerId, "signer");
  account(verifier, "verifier");
  assert(Array.isArray(intents) && intents.length > 0, "No intents to sign.");
  return JSON.stringify({
    signer_id: signerId,
    verifying_contract: verifier,
    deadline: new Date(deadlineMs).toISOString(),
    nonce: b64(nonce),
    intents,
  });
}

/** MultiPayload {standard:"erc191"} from a personal_sign signature (0x… 65 bytes). */
export function signedErc191Intent({ payload, signature }) {
  assert(typeof signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(signature), "Signature must be 65 bytes.");
  const sig = Buffer.from(signature.slice(2), "hex");
  if (sig[64] >= 27) sig[64] -= 27;
  assert(sig[64] <= 1, "Invalid signature recovery id.");
  return { standard: "erc191", payload, signature: `secp256k1:${baseEncode(sig)}` };
}

function verifyErc191Locally(signed, { verifier, nowMs }) {
  assert(typeof signed.payload === "string" && signed.payload.length <= 4096, "Malformed intent.");
  assert(
    Object.keys(signed).sort().join(",") === "payload,signature,standard",
    "Unexpected intent fields.",
  );
  assert(
    typeof signed.signature === "string" &&
      signed.signature.startsWith("secp256k1:") &&
      B58.test(signed.signature.slice(10)),
    "Invalid signature format.",
  );
  const sig = Buffer.from(baseDecode(signed.signature.slice(10)));
  assert(sig.length === 65 && sig[64] <= 1, "Signature must be 65 bytes with recovery id 0 or 1.");
  let body;
  try {
    body = JSON.parse(signed.payload);
  } catch {
    assert(false, "Malformed intent message.");
  }
  assert(
    body &&
      Object.keys(body).sort().join(",") === "deadline,intents,nonce,signer_id,verifying_contract",
    "Unexpected intent message fields.",
  );
  assert(body.verifying_contract === verifier, "The intent was signed for another verifier.");
  const nonce = Buffer.from(String(body.nonce || ""), "base64");
  assert(nonce.length === 32, "Nonce must be 32 bytes.");
  assert(Array.isArray(body.intents) && body.intents.length > 0, "No intents.");
  const { deadlineMs, salt } = checkBody(body, nonce, nowMs);
  let point;
  try {
    point = secp256k1.Signature.fromBytes(sig.subarray(0, 64), "compact")
      .addRecoveryBit(sig[64])
      .recoverPublicKey(erc191Prehash(signed.payload));
  } catch {
    assert(false, "Invalid intent signature.");
  }
  const raw = Buffer.from(point.toBytes(false)).subarray(1);
  return {
    signerId: body.signer_id,
    deadlineMs,
    intents: body.intents,
    nonce: body.nonce,
    salt,
    publicKey: `secp256k1:${baseEncode(raw)}`,
  };
}

/** keccak256("\x19Ethereum Signed Message:\n" + len + message), as the verifier hashes it. */
export function erc191Prehash(message) {
  const bytes = Buffer.from(message, "utf8");
  return keccak_256(
    Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`, "utf8"), bytes]),
  );
}

/**
 * Reads a one-intent Aura order: exactly one token_diff with one Aura of
 * `nftContract` and wNEAR, in opposite directions. Returns its terms.
 */
export function auraOrderTerms(intents, { nftContract, wnear }) {
  assert(Array.isArray(intents) && intents.length === 1, "An order holds exactly one intent.");
  const [intent] = intents;
  assert(intent.intent === "token_diff", "Orders use token_diff.");
  const entries = Object.entries(intent.diff || {});
  assert(entries.length === 2, "An order swaps one Aura for wNEAR.");
  const prefix = `nep171:${nftContract}:`,
    ft = nep141(wnear);
  const nft = entries.find(([id]) => id.startsWith(prefix)),
    money = entries.find(([id]) => id === ft);
  assert(nft && money, "An order swaps one Aura of this game for wNEAR.");
  const tokenId = nft[0].slice(prefix.length);
  assert(AURA.test(tokenId), "Choose a native Aura.");
  assert(nft[1] === "1" || nft[1] === "-1", "An order moves exactly one Aura.");
  const side = nft[1] === "-1" ? "sell" : "buy";
  const amount = BigInt(money[1]);
  assert((side === "sell") === amount > 0n, "The wNEAR leg must oppose the Aura leg.");
  const abs = amount < 0n ? -amount : amount;
  price(abs);
  return { side, tokenId, price: abs.toString(), nftTokenId: nft[0], wnearTokenId: ft };
}

/** True when the second order is the exact opposite of the first. */
export function matches(a, b) {
  return (
    a.side !== b.side &&
    a.nftTokenId === b.nftTokenId &&
    a.wnearTokenId === b.wnearTokenId &&
    a.price === b.price
  );
}

/**
 * Net token deltas across a batch of signed intent bodies. With the
 * self-deployed verifier's fee of 0, a valid swap batch nets to zero for
 * every token (the verifier's own invariant).
 */
export function netDeltas(bodies) {
  const net = new Map();
  const add = (id, v) => net.set(id, (net.get(id) || 0n) + v);
  for (const { signerId, intents } of bodies)
    for (const intent of intents) {
      if (intent.intent === "token_diff")
        for (const [id, v] of Object.entries(intent.diff)) add(id, BigInt(v));
      else if (intent.intent === "transfer") {
        assert(intent.receiver_id !== signerId, "Self-transfers are not trades.");
        // A transfer moves balance between two accounts: supply is unchanged.
        for (const id of Object.keys(intent.tokens)) add(id, 0n);
      }
    }
  return Object.fromEntries([...net].filter(([, v]) => v !== 0n).map(([k, v]) => [k, v.toString()]));
}

/**
 * Withdrawals the solver may submit for a player: only back to the signer's
 * own account, only Auras of this game or wNEAR (as wNEAR or native NEAR).
 */
export function checkWithdrawal(body, { nftContract, wnear }) {
  assert(body.intents.length >= 1 && body.intents.length <= 4, "Withdraw one to four items at a time.");
  for (const i of body.intents) {
    assert(i.receiver_id === body.signerId, "Withdrawals go back to your own account.");
    assert(!i.msg && !i.storage_deposit, "Withdrawals cannot call other contracts.");
    if (i.intent === "nft_withdraw")
      assert(i.token === nftContract && AURA.test(String(i.token_id)), "Only Auras can be withdrawn here.");
    else if (i.intent === "ft_withdraw")
      assert(i.token === wnear && /^\d+$/.test(String(i.amount)), "Only wNEAR can be withdrawn here.");
    else if (i.intent === "native_withdraw")
      assert(/^\d+$/.test(String(i.amount)), "Invalid amount.");
    else assert(false, "Only withdrawals can be sent this way.");
  }
  return body.intents;
}

/** Init args for a self-deployed testnet verifier: fee 0, operator roles. */
export function verifierInitArgs({ owner, wnear }) {
  account(owner, "owner");
  assert(String(owner).endsWith(".testnet"), "The self-deployed verifier is testnet-only.");
  return {
    config: {
      wnear_id: account(wnear, "wNEAR contract"),
      fees: { fee: 0, fee_collector: owner },
      roles: {
        super_admins: [owner],
        admins: {},
        grantees: {
          DAO: [owner],
          PauseManager: [owner],
          UnpauseManager: [owner],
          Upgrader: [owner],
          SaltManager: [owner],
          GarbageCollector: [owner],
        },
      },
    },
  };
}

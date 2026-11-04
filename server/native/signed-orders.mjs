// NEP-413 signed Aura orders for the version 2 QuestLayer market contract.
// The wallet signs the order terms with `signMessage`; the contract checks the
// same digest, the maker's registered key, the nonce, epoch and deadline.
// Nothing here signs on behalf of a player.
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { baseDecode } from "near-api-js";
import { assert } from "../domain.mjs";

export const ORDER_STANDARD = "questlayer_aura_order";
export const NEP413_TAG = 2147484061; // 2^31 + 413
export const MIN_PRICE = 10n ** 21n;
export const MAX_PRICE = 1000n * 10n ** 24n;
export const MAX_ORDER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN = /^aura:[a-z0-9-]{1,24}:\d{1,6}$/;
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Canonical order terms; key order matches the contract's struct. */
export function orderTerms({
  kind,
  market,
  nftContract,
  maker,
  tokenId,
  price,
  deadlineMs,
  epoch = 0,
  network = "testnet",
}) {
  assert(kind === "sell" || kind === "buy", "Order kind must be sell or buy.");
  assert(network === "testnet", "Signed orders are testnet-only.");
  for (const id of [market, nftContract, maker])
    assert(ACCOUNT.test(String(id)), "Invalid NEAR account.");
  assert(TOKEN.test(String(tokenId)), "Choose a native Aura.");
  const yocto = BigInt(price);
  assert(
    yocto >= MIN_PRICE && yocto <= MAX_PRICE,
    "Price must be between 0.001 and 1000 test NEAR.",
  );
  assert(
    Number.isSafeInteger(deadlineMs) && deadlineMs > 0,
    "Invalid deadline.",
  );
  assert(Number.isInteger(epoch) && epoch >= 0, "Invalid order epoch.");
  return {
    standard: ORDER_STANDARD,
    version: 1,
    kind,
    network,
    market,
    nft_contract: nftContract,
    maker,
    token_id: tokenId,
    price: yocto.toString(),
    deadline_ms: String(deadlineMs),
    epoch,
  };
}

export const orderMessage = (terms) => JSON.stringify(terms);

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const borshString = (s) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u32(b.length), b]);
};

/** sha256(borsh(tag) ++ borsh({message, nonce[32], recipient, callbackUrl?})). */
export function nep413Digest({ message, nonce, recipient, callbackUrl = null }) {
  const n = Buffer.from(nonce);
  assert(n.length === 32, "Nonce must be 32 bytes.");
  return createHash("sha256")
    .update(
      Buffer.concat([
        u32(NEP413_TAG),
        borshString(message),
        n,
        borshString(recipient),
        callbackUrl == null
          ? Buffer.from([0])
          : Buffer.concat([Buffer.from([1]), borshString(callbackUrl)]),
      ]),
    )
    .digest();
}

export function ed25519KeyBytes(publicKey) {
  const [curve, data] = String(publicKey).split(":");
  assert(curve === "ed25519" && data, "Only ed25519 keys are supported.");
  const bytes = Buffer.from(baseDecode(data));
  assert(bytes.length === 32, "Invalid ed25519 public key.");
  return bytes;
}

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Contract argument from a wallet `signMessage` result. Wallets return the
 * signature as base64 and the key as `ed25519:<base58>`.
 */
export function signedOrder({ message, nonce, recipient, callbackUrl = null, publicKey, signature }) {
  return {
    message,
    nonce: Buffer.from(nonce).toString("base64"),
    recipient,
    callback_url: callbackUrl,
    public_key: publicKey,
    signature: Buffer.isBuffer(signature) || signature instanceof Uint8Array
      ? Buffer.from(signature).toString("base64")
      : signature,
  };
}

/**
 * Local (off-chain) verification mirroring the contract's stateless checks.
 * Registered keys, epoch and nonce use are on-chain state: confirm them with
 * the contract's `check_order` view before showing an order as fillable.
 */
export function verifySignedOrderLocally(order, { market, nftContract, nowMs = Date.now() }) {
  assert(order && typeof order.message === "string", "Missing order.");
  assert(order.message.length <= 1024, "Order message too large.");
  assert(order.recipient === market, "Order was signed for another recipient.");
  const nonce = Buffer.from(order.nonce, "base64");
  const signature = Buffer.from(order.signature, "base64");
  assert(nonce.length === 32, "Nonce must be 32 bytes.");
  assert(signature.length === 64, "Signature must be 64 bytes.");
  let terms;
  try {
    terms = JSON.parse(order.message);
  } catch {
    assert(false, "Malformed order terms.");
  }
  const canonical = orderTerms({
    kind: terms.kind,
    market: terms.market,
    nftContract: terms.nft_contract,
    maker: terms.maker,
    tokenId: terms.token_id,
    price: terms.price,
    deadlineMs: Number(terms.deadline_ms),
    epoch: terms.epoch,
    network: terms.network,
  });
  assert(
    orderMessage(canonical) === order.message,
    "Order terms are not in canonical form.",
  );
  assert(terms.market === market, "Order names another market.");
  assert(terms.nft_contract === nftContract, "Order names another NFT contract.");
  assert(Number(terms.deadline_ms) > nowMs, "Order expired.");
  assert(
    Number(terms.deadline_ms) <= nowMs + MAX_ORDER_TTL_MS,
    "Order deadline is more than 30 days away.",
  );
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, ed25519KeyBytes(order.public_key)]),
    format: "der",
    type: "spki",
  });
  const digest = nep413Digest({
    message: order.message,
    nonce,
    recipient: order.recipient,
    callbackUrl: order.callback_url ?? null,
  });
  assert(verifySignature(null, digest, key, signature), "Invalid signature.");
  return canonical;
}

/**
 * The equivalent NEAR Intents `token_diff` for documentation and future
 * mainnet work. It is NOT accepted by this market and has not been executed
 * by any Intents verifier; see docs/SIGNED-AURA-ORDERS.md.
 */
export function intentsTokenDiffSketch(terms, { wrapNear = "wrap.testnet" } = {}) {
  const nft = `nep171:${terms.nft_contract}:${terms.token_id}`,
    wnear = `nep141:${wrapNear}`,
    sell = terms.kind === "sell";
  return {
    status: "unverified-sketch",
    signer_id: terms.maker,
    deadline: new Date(Number(terms.deadline_ms)).toISOString(),
    intents: [
      {
        intent: "token_diff",
        diff: sell
          ? { [nft]: "-1", [wnear]: terms.price }
          : { [nft]: "1", [wnear]: `-${terms.price}` },
      },
    ],
  };
}

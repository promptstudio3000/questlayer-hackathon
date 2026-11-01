// Signed Aura orders for market version 2, signed silently by the explorer's
// own device key with NEP-413 (the same standard wallets use for signMessage).
// The terms match server/native/signed-orders.mjs and the market contract
// byte for byte; the contract re-verifies every order before it moves assets.
import { signerFor, type PlayerKeyRecord } from "./player-key.ts";

export const ORDER_STANDARD = "questlayer_aura_order";
export const ORDER_TTL_CHOICES = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "1 day", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

export type OrderKind = "sell" | "buy";
export type OrderTerms = {
  standard: typeof ORDER_STANDARD;
  version: 1;
  kind: OrderKind;
  network: "testnet";
  market: string;
  nft_contract: string;
  maker: string;
  token_id: string;
  price: string;
  deadline_ms: string;
  epoch: number;
};
export type SignedOrder = {
  message: string;
  nonce: string;
  recipient: string;
  callback_url: string | null;
  public_key: string;
  signature: string;
};
/** Status of one of my orders as the market contract sees it. */
export type OrderStatus =
  | "pending"
  | "open"
  | "filled"
  | "cancelled"
  | "expired"
  | "rejected";

export function orderTerms(input: {
  kind: OrderKind;
  market: string;
  nftContract: string;
  maker: string;
  tokenId: string;
  price: string;
  deadlineMs: number;
  epoch: number;
}): OrderTerms {
  if (!/^\d+$/.test(input.price)) throw Error("Choose a valid price.");
  if (!/^aura:/.test(input.tokenId)) throw Error("Choose a native Aura.");
  return {
    standard: ORDER_STANDARD,
    version: 1,
    kind: input.kind,
    network: "testnet",
    market: input.market,
    nft_contract: input.nftContract,
    maker: input.maker,
    token_id: input.tokenId,
    price: input.price,
    deadline_ms: String(input.deadlineMs),
    epoch: input.epoch,
  };
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Signs without any popup: the device key never leaves this browser. */
export async function signOrder(
  record: PlayerKeyRecord,
  terms: OrderTerms,
  nonce: Uint8Array = crypto.getRandomValues(new Uint8Array(32)),
): Promise<SignedOrder> {
  if (!record.accountId || record.accountId !== terms.maker)
    throw Error("This device key cannot sign for that account.");
  const message = JSON.stringify(terms);
  const signed = await signerFor(record).signNep413Message(terms.maker, {
    message,
    recipient: terms.market,
    nonce,
  });
  return {
    message,
    nonce: toBase64(nonce),
    recipient: terms.market,
    callback_url: null,
    public_key: signed.publicKey.toString(),
    signature: toBase64(signed.signature),
  };
}

/** Maps the contract's check_order reason to a player-facing state. */
export function statusFromCheck(
  check: { valid: boolean; reason?: string | null },
  locallyCancelled = false,
): OrderStatus {
  if (check.valid) return "open";
  const reason = check.reason || "";
  if (/nonce already used/i.test(reason))
    return locallyCancelled ? "cancelled" : "filled";
  if (/cancelled by the maker|not registered by the maker/i.test(reason))
    return "cancelled";
  if (/expired/i.test(reason)) return "expired";
  return "rejected";
}

export const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  pending: "Confirming with the market",
  open: "Open: anyone can accept it until it expires",
  filled: "Accepted on chain. Check your collection and market balance.",
  cancelled: "Cancelled on chain: it can no longer be accepted",
  expired: "Expired: it can no longer be accepted",
  rejected: "Not accepted by the market",
};

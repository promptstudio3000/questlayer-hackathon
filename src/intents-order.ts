// NEAR Intents (experimental, self-deployed testnet verifier): builds and signs
// token_diff and withdrawal intents with the explorer's device key, silently,
// with NEP-413. The bytes match server/native/intents.mjs and the verifier
// (near/intents v0.4.5); the verifier re-checks everything before it settles.
import { signerFor, type PlayerKeyRecord } from "./player-key.ts";
import { loadNearApi } from "./near-api.ts";

export type SignedIntent = {
  standard: "nep413";
  payload: { message: string; nonce: string; recipient: string };
  public_key: string;
  signature: string;
};
export type IntentsConfig = {
  enabled: boolean;
  experimental?: boolean;
  verifier: string;
  nftContract: string;
  wnear: string;
  salt: string;
  solver: string | null;
  orders: IntentOrder[];
  settlements: { transactionHash: string; kind: string; accounts: string[] }[];
};
export type IntentOrder = {
  id: string;
  maker: string;
  side: "sell" | "buy";
  tokenId: string;
  price: string;
  deadlineMs: number;
  state: string;
  settlementTx: string | null;
};
export type IntentsAccount = {
  accountId: string;
  keyRegistered: boolean | null;
  wnear: string;
  auras: string[];
  orders: IntentOrder[];
};

const NONCE_MAGIC = [0x56, 0x28, 0xf6, 0xc6];
export const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Versioned V1 nonce: magic ++ 0 ++ salt ++ deadline (i64 ns, LE) ++ 15 random bytes. */
export function versionedNonce(salt: string, deadlineMs: number, random?: Uint8Array) {
  if (!/^[0-9a-f]{8}$/.test(salt)) throw Error("The verifier salt is unavailable.");
  const out = new Uint8Array(32);
  out.set(NONCE_MAGIC, 0);
  out[4] = 0;
  for (let i = 0; i < 4; i++) out[5 + i] = parseInt(salt.slice(i * 2, i * 2 + 2), 16);
  new DataView(out.buffer).setBigInt64(9, BigInt(deadlineMs) * 1_000_000n, true);
  out.set(random ?? crypto.getRandomValues(new Uint8Array(15)), 17);
  return out;
}

export function intentMessage(signerId: string, deadlineMs: number, intents: unknown[]) {
  return JSON.stringify({ signer_id: signerId, deadline: new Date(deadlineMs).toISOString(), intents });
}

export function auraTokenDiff(side: "sell" | "buy", nftContract: string, tokenId: string, price: string, wnear: string) {
  const nft = `nep171:${nftContract}:${tokenId}`,
    ft = `nep141:${wnear}`;
  return {
    intent: "token_diff",
    diff: side === "sell" ? { [nft]: "-1", [ft]: price } : { [nft]: "1", [ft]: `-${price}` },
  };
}

/** Signs intents for the device key's own account, no popup. */
export async function signIntents(
  record: PlayerKeyRecord,
  config: Pick<IntentsConfig, "verifier" | "salt">,
  intents: unknown[],
  ttlMs = INTENT_TTL_MS,
): Promise<SignedIntent> {
  if (!record.accountId) throw Error("This device key has no explorer account yet.");
  const deadlineMs = Date.now() + ttlMs;
  const message = intentMessage(record.accountId, deadlineMs, intents);
  const nonce = versionedNonce(config.salt, deadlineMs);
  const [signed, { baseEncode }] = await Promise.all([
    (await signerFor(record)).signNep413Message(record.accountId, { message, recipient: config.verifier, nonce }),
    loadNearApi(),
  ]);
  return {
    standard: "nep413",
    payload: { message, nonce: toBase64(nonce), recipient: config.verifier },
    public_key: signed.publicKey.toString(),
    signature: `ed25519:${baseEncode(signed.signature)}`,
  };
}

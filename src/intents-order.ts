// NEAR Intents (experimental, self-deployed testnet verifier): builds and signs
// token_diff and withdrawal intents with the explorer's device key, silently,
// with NEP-413. The bytes match server/native/intents.mjs and the verifier
// (near/intents v0.4.5); the verifier re-checks everything before it settles.
import { signerFor, type PlayerKeyRecord } from "./player-key.ts";
import { loadNearApi } from "./near-api.ts";
import { api } from "./api.ts";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type IntentsSigner = {
  accountId: string;
  key?: PlayerKeyRecord;
  knownPublicKey(): string | null;
  call(c: { receiverId: string; methodName: string; args: Record<string, unknown>; deposit: string; gas: string }): Promise<string | null>;
};

/**
 * Sell a secured Aura through NEAR Intents, the game's default market: turn
 * on the device key at the verifier, deposit the Aura (relayed), then sign a
 * sell token_diff for the order book. Resolves "off" while no verifier is
 * deployed on this host, so the caller can use the market contract instead.
 */
export async function sellAuraOnIntents(signer: IntentsSigner, tokenId: string, priceYocto: string): Promise<"listed" | "off"> {
  const config = await api<IntentsConfig>("/native/intents").catch(() => null);
  if (!config?.enabled || !signer.key) return "off";
  const publicKey = signer.knownPublicKey() || "";
  const account = () =>
    api<IntentsAccount>(`/native/intents/account?account=${encodeURIComponent(signer.accountId)}&publicKey=${encodeURIComponent(publicKey)}`);
  let state = await account();
  if (!state.keyRegistered)
    await signer.call({ receiverId: config.verifier, methodName: "add_public_key", args: { public_key: publicKey }, deposit: "1", gas: "100000000000000" });
  if (!state.auras.includes(tokenId)) {
    await signer.call({
      receiverId: config.nftContract,
      methodName: "nft_transfer_call",
      args: { receiver_id: config.verifier, token_id: tokenId, approval_id: null, memo: null, msg: "" },
      deposit: "1",
      gas: "200000000000000",
    });
    for (let i = 0; i < 8 && !state.auras.includes(tokenId); i++) {
      await sleep(1000);
      state = await account();
    }
    if (!state.auras.includes(tokenId)) throw Error("The verifier has not confirmed the Aura yet. Try listing it again in a moment.");
  }
  const signed = await signIntents(signer.key, config, [auraTokenDiff("sell", config.nftContract, tokenId, priceYocto, config.wnear)]);
  await api("/native/intents/orders", { signed });
  return "listed";
}

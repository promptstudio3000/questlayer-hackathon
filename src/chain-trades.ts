// On-chain steps of NPC trades (server/npc/trader.mjs), sent from the NPC
// sheet. App registers who signs: the explorer's device key (relayed or
// self-paid, no popup) or a linked wallet. Trade-up hand-overs are NEAR
// transactions whose hash goes back to the server; buys and sales settle on
// NEAR Intents, where the device key signs the player's side.
import { api } from "./api";
import { EXPLORER_BASE } from "./near-network";
import type { NpcTrade } from "./npc-client";
import type { PlayerKeyRecord } from "./player-key";
import type { IntentsAccount, IntentsConfig } from "./intents-order";

export type ChainCall = {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  deposit: string;
  gas: string;
};
type Sender = (accountId: string, call: ChainCall) => Promise<string | null>;
let sender: Sender | null = null;
let secure: ((itemId: string) => Promise<boolean>) | null = null;
let intentsKey: (() => PlayerKeyRecord | null) | null = null;

export function registerChainTrades(
  next: { send: Sender; secureItem: (itemId: string) => Promise<boolean>; intentsKey?: () => PlayerKeyRecord | null } | null,
) {
  sender = next?.send ?? null;
  secure = next?.secureItem ?? null;
  intentsKey = next?.intentsKey ?? null;
}
export const chainTradesReady = () => !!sender;
export const explorerTxUrl = (hash: string) => `${EXPLORER_BASE}/txns/${encodeURIComponent(hash)}`;

const GAS = "200000000000000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(accountId: string, call: ChainCall) {
  if (!sender) throw Error("Your NEAR account is not ready yet.");
  return sender(accountId, call);
}
/** Tell the server about a hand-over; it reads the final receipt itself. */
async function report(trade: NpcTrade, hash: string | null) {
  if (!hash) return null;
  return api<NpcTrade>("/npc/trades/tx", { tradeId: trade.tradeId, transactionHash: hash }).catch(() => null);
}

/** Trade-up: each of the three Auras goes to the trader account on chain. */
export async function handOverOnChain(trade: NpcTrade, onStep?: (done: number) => void) {
  const hashes: string[] = [];
  const tokens = trade.tokens || [];
  for (const [i, tokenId] of tokens.entries()) {
    if (trade.handovers?.[tokenId]) continue;
    const hash = await send(trade.accountId!, {
      receiverId: trade.nftContract!,
      methodName: "nft_transfer",
      args: { receiver_id: trade.receiver, token_id: tokenId, approval_id: null, memo: `questlayer trade-up ${trade.tradeId}` },
      deposit: "1",
      gas: "30000000000000",
    });
    if (hash) hashes.push(hash);
    onStep?.(i + 1);
  }
  // Wallet-signed hand-overs come back without a hash from the wallet flow;
  // relayed ones are already known to the server.
  for (const h of hashes) await report(trade, h);
  return hashes;
}

/**
 * Settle an accepted buy or sale on NEAR Intents right from the NPC sheet.
 * The player's side goes into the verifier first (wNEAR for the price plus the
 * fee, or the Aura), then the device key signs one token_diff and the server
 * settles it against the trader's opposite intent. After a sale the NEAR goes
 * straight back to the player's account.
 */
export async function fillOnChain(trade: NpcTrade) {
  const terms = trade.intents;
  if (!terms) throw Error("This trade cannot settle on NEAR Intents.");
  const key = intentsKey?.();
  if (!key?.accountId) throw Error("Trades with characters use your explorer account on this device.");
  const accountId = key.accountId;
  if (terms.side === "sell" && trade.accountId && trade.accountId !== accountId)
    throw Error(`This Aura is in ${trade.accountId}. Move it to your explorer account to sell it here.`);
  const { auraTokenDiff, grossForNet, signIntents } = await import("./intents-order");
  const config = await api<IntentsConfig>("/native/intents");
  if (!config.enabled) throw Error("NEAR Intents are not open here yet.");
  const call = (c: ChainCall) => send(accountId, c);
  const account = () =>
    api<IntentsAccount>(`/native/intents/account?account=${encodeURIComponent(accountId)}&publicKey=${encodeURIComponent(key.publicKey)}`);
  let state = await account();
  if (!state.keyRegistered)
    await call({ receiverId: config.verifier, methodName: "add_public_key", args: { public_key: key.publicKey }, deposit: "1", gas: "100000000000000" });
  if (terms.side === "buy") {
    // The buyer gives the price plus the verifier fee (to the treasury).
    let missing = BigInt(grossForNet(terms.price, terms.feePips)) - BigInt(state.wnear || "0");
    // A 0.05 NEAR deposit looks like a storage deposit to the relayer; wrap 1 yocto more.
    if (missing === 50000000000000000000000n) missing += 1n;
    if (missing > 0n) {
      await call({ receiverId: config.wnear, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "1250000000000000000000", gas: "30000000000000" });
      await call({ receiverId: config.wnear, methodName: "near_deposit", args: {}, deposit: missing.toString(), gas: "30000000000000" });
      await call({ receiverId: config.wnear, methodName: "ft_transfer_call", args: { receiver_id: config.verifier, amount: missing.toString(), msg: "" }, deposit: "1", gas: "100000000000000" });
    }
  } else if (!state.auras.includes(trade.tokenId)) {
    await call({
      receiverId: config.nftContract,
      methodName: "nft_transfer_call",
      args: { receiver_id: config.verifier, token_id: trade.tokenId, approval_id: null, memo: null, msg: "" },
      deposit: "1",
      gas: GAS,
    });
    for (let i = 0; i < 8 && !state.auras.includes(trade.tokenId); i++) {
      await sleep(1000);
      state = await account();
    }
    if (!state.auras.includes(trade.tokenId)) throw Error("The verifier has not confirmed the Aura yet. Try again in a moment.");
  }
  const signed = await signIntents(key, config, [auraTokenDiff(terms.side, config.nftContract, trade.tokenId, terms.price, config.wnear, terms.feePips)]);
  const filled = await api<NpcTrade>("/npc/trades/fill", { tradeId: trade.tradeId, signed });
  if (terms.side === "sell" && !filled.replay) {
    // The sale's NEAR goes back to the player's account (solver-paid, no popup).
    const out = await signIntents(key, config, [{ intent: "native_withdraw", receiver_id: accountId, amount: terms.price }]);
    await api("/native/intents/withdraw", { signed: out }).catch(() => null);
  }
  return filled;
}

/** Secure the Aura a trade-up paid out (award claim → NFT on the player's account). */
export const secureTradeAura = (itemId: string) => (secure ? secure(itemId) : Promise.resolve(false));

// On-chain steps of NPC trades (server/npc/trader.mjs), sent from the NPC
// sheet. App registers who signs: the explorer's device key (relayed or
// self-paid, no popup) or a linked wallet. Every step is a real NEAR
// transaction; its hash goes back to the server, which checks it on chain.
import { api } from "./api";
import { EXPLORER_BASE } from "./near-network";
import type { NpcTrade } from "./npc-client";

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

export function registerChainTrades(next: { send: Sender; secureItem: (itemId: string) => Promise<boolean> } | null) {
  sender = next?.send ?? null;
  secure = next?.secureItem ?? null;
}
export const chainTradesReady = () => !!sender;
export const explorerTxUrl = (hash: string) => `${EXPLORER_BASE}/txns/${encodeURIComponent(hash)}`;

const GAS = "200000000000000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(accountId: string, call: ChainCall) {
  if (!sender) throw Error("Your NEAR account is not ready yet.");
  return sender(accountId, call);
}
/** Tell the server about a step; it reads the final receipt itself. */
async function report(trade: NpcTrade, hash: string | null) {
  if (!hash) return null;
  if (trade.market)
    void api("/native/market/orders/events", { transactionHash: hash, accountId: trade.accountId }).catch(() => {});
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

/** Fill the trader's signed order right from the NPC sheet. */
export async function fillOnChain(trade: NpcTrade, { escrowed = false }: { escrowed?: boolean } = {}) {
  const sell = trade.kind === "trade_sell";
  if (!sell && !escrowed) {
    // A buy order names an Aura in the player's wallet: hand it to the market first.
    await send(trade.accountId!, {
      receiverId: trade.nftContract!,
      methodName: "nft_transfer_call",
      args: { receiver_id: trade.market, token_id: trade.tokenId, approval_id: null, memo: null, msg: JSON.stringify({ deposit: true }) },
      deposit: "1",
      gas: GAS,
    });
    await sleep(1500);
  }
  const hash = await send(trade.accountId!, {
    receiverId: trade.market!,
    methodName: sell ? "fill_sell_order" : "fill_buy_order",
    args: { order: trade.order },
    deposit: sell ? trade.price : "1",
    gas: GAS,
  });
  return (await report(trade, hash)) || { ...trade, txHash: hash, txHashes: hash ? [hash] : [] };
}

/** Secure the Aura a trade-up paid out (award claim → NFT on the player's account). */
export const secureTradeAura = (itemId: string) => (secure ? secure(itemId) : Promise.resolve(false));

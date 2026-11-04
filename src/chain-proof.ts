// Chain proof for one game action: what ChainLink renders. Every screen that
// knows about a NEAR transaction (or a record that becomes one in a second or
// two) passes one of these. All fields are optional:
//   id       record to poll while pending ("relay:…", "aura:…", "roll:…",
//            "reward:…", "badge:…", "latest:<kind>:<since ms>" are read
//            from /api/chain/items; any other
//            id from the coin/XP record route /api/chain/actions/:id)
//   status   queued | sent | retrying | pending | issued → pending,
//            confirmed | minted | settled → confirmed, failed → failed,
//            no-account | off → nothing is shown
//   tx       transaction hash, explorer the full explorer URL
//   account  NEAR account shown when there is no transaction to link
//   token    NFT { contract, id } shown when there is no transaction
//   poll     "feed" forces /api/chain/items, "none" disables polling
import { EXPLORER_BASE } from "./near-network.ts";

export type ChainRef = {
  id?: string | null;
  status?: string | null;
  tx?: string | null;
  explorer?: string | null;
  account?: string | null;
  token?: { contract: string; id: string } | null;
  poll?: string | null;
};
export type ChainState = "pending" | "confirmed" | "failed" | "hidden";

const TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;
const FEED_ID = /^(relay|aura|roll|reward|badge|history|latest):/;

export function chainState(ref: ChainRef | null | undefined): ChainState {
  if (!ref) return "hidden";
  const s = String(ref.status || "").toLowerCase();
  if (s === "no-account" || s === "off") return "hidden";
  if (s === "failed") return "failed";
  if (s === "confirmed" || s === "minted" || s === "settled") return "confirmed";
  if (s) return "pending";
  // No status: a transaction or an account alone is already final.
  if (ref.tx || ref.explorer || ref.token || ref.account) return "confirmed";
  return ref.id ? "pending" : "hidden";
}

const trusted = (url: string | null | undefined) =>
  typeof url === "string" && url.startsWith(`${EXPLORER_BASE}/`) ? url : null;

/**
 * The finer stage the one icon shows (its colour and motion):
 * sending  queued at the game server, no transaction yet (grey, pulsing)
 * received the transaction is on NEAR and executing (blue, spinning ring)
 * final    executed and final on NEAR (green)
 * failed   (red)
 */
export type ChainStage = "sending" | "received" | "final" | "failed" | "hidden";
export function chainStage(ref: ChainRef | null | undefined): ChainStage {
  const state = chainState(ref);
  if (state === "confirmed") return "final";
  if (state !== "pending") return state;
  const s = String(ref?.status || "").toLowerCase();
  return (ref?.tx && TX.test(ref.tx)) || s === "sent" ? "received" : "sending";
}

/** Where the icon links: the transaction, else the NFT, else the account. */
export function chainHref(ref: ChainRef | null | undefined): string | null {
  if (!ref) return null;
  if (ref.tx && TX.test(ref.tx)) return `${EXPLORER_BASE}/txns/${ref.tx}`;
  const given = trusted(ref.explorer);
  if (given) return given;
  if (ref.token?.contract && ref.token.id && ACCOUNT.test(ref.token.contract))
    return `${EXPLORER_BASE}/nft-token/${ref.token.contract}/${encodeURIComponent(ref.token.id)}`;
  if (ref.account && ACCOUNT.test(ref.account))
    return `${EXPLORER_BASE}/address/${ref.account}`;
  return null;
}

/** The read that refreshes a pending proof, or null when it cannot change. */
export function pollPath(ref: ChainRef | null | undefined): string | null {
  if (!ref?.id || ref.poll === "none") return null;
  if (ref.poll === "feed" || FEED_ID.test(ref.id))
    return `/chain/items?ids=${encodeURIComponent(ref.id)}`;
  return `/chain/actions/${encodeURIComponent(ref.id)}`;
}

/** Reads one poll answer (either route) back into a ChainRef. */
export function fromPoll(
  ref: ChainRef,
  answer: unknown,
): ChainRef | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as Record<string, unknown>;
  const item = Array.isArray(a.items)
    ? (a.items as Record<string, unknown>[]).find(
        (i) => i.id === ref.id || i.ref === ref.id,
      ) ?? (a.items.length === 1 ? (a.items[0] as Record<string, unknown>) : null)
    : a;
  if (!item) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    ...ref,
    status: str(item.status) ?? ref.status,
    tx: str(item.tx) ?? ref.tx,
    explorer: str(item.explorer) ?? ref.explorer,
    account: str(item.account) ?? ref.account,
  };
}

/** Delays between polls of a pending proof; it stops after the last one. */
export const POLL_DELAYS_MS = [
  800, 1200, 1500, 2000, 2500, 3000, 4000, 4000, 5000, 5000, 6000, 8000, 10000,
  10000, 12000, 15000,
];

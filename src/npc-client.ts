// Client for NPC talk and quest lines (server/npc/routes.mjs). Every call
// carries the encounter token from POST /api/actors/:id/encounter.
import { api } from "./api";
import type { ActorOffer } from "./actor-types";
import type { StakeCard } from "./StakeToday";

export interface NpcStep { questId: string; title: string; kind: string; zone: string | null; done?: boolean }
export interface NpcActiveLine {
  offerId: string;
  kind: string;
  label: string;
  steps: NpcStep[];
  xp: number;
  aura: boolean;
  /** Errand: finish the place's quest, then meet the NPC again to report. */
  errand?: { returnRequired: boolean; clueBonusXp: number };
  /** Patron line (Tier 2 stakers): its step on the Patron's Path. */
  patron?: { pathLine: number; pathOf: number };
}
export interface NpcReply {
  say: string;
  emote: "wave" | "think" | "laugh" | "shrug" | "none";
  offer?: ActorOffer | null;
  menu: ActorOffer[];
  /** Stakers-only content this player cannot take yet (never acceptable). */
  locked?: NpcLockedOffer[];
  active: NpcActiveLine[];
  source: string;
  attested?: boolean;
  /** NEAR AI Cloud reply: chat id to re-check at the Verification Center. */
  verification?: { provider: "near-ai"; model: string; chatId: string; status: string; url: string };
  note?: string;
  npc?: { id: string; name: string; title: string | null; archetype: string };
}
export interface NpcLockedOffer {
  id: string;
  kind: string;
  label: string;
  perk?: string;
  locked: { tier: number; step?: string; level?: number; missing?: string[]; stakeNear?: string };
}
export interface NpcTurnIn {
  offerId: string;
  state: string;
  xp?: number;
  aura?: { id: string; name: string; rarity: string } | null;
  /** NPC-only edition earned with this turn-in (once per player). */
  edition?: { id: string; name: string; rarity: string } | null;
  /** Patron line turn-in: Patron's Path step and the story chapter it reveals. */
  patron?: {
    pathLine: number;
    pathOf: number;
    story: { title: string; text: string };
    edition: { id: string; name: string; rarity: string } | null;
  };
  note?: string;
  /** Errand turn-in: the part of the XP earned by a right landmark answer. */
  errand?: { clueBonusXp: number };
  replay?: boolean;
}

const base = (actorId: string) => `/actors/${encodeURIComponent(actorId)}`;
export const npcGreet = (actorId: string, encounter: string) => api<NpcReply>(`${base(actorId)}/greet`, { encounter });
export const npcTalk = (actorId: string, encounter: string, message: string) =>
  api<NpcReply>(`${base(actorId)}/talk`, { encounter, message });
export const npcAccept = (actorId: string, encounter: string, offerId: string) =>
  api<{ offerId: string; state: string }>(`${base(actorId)}/offers/${offerId}/accept`, { encounter });
export const npcTurnIn = (actorId: string, encounter: string, offerId: string) =>
  api<NpcTurnIn>(`${base(actorId)}/offers/${offerId}/complete`, { encounter });

// NPC traders and the vault keeper (server/npc/trader-routes.mjs).
export interface NpcTrade {
  tradeId: string;
  kind: "trade_buy" | "trade_sell" | "trade_up";
  state: string;
  tokenId: string;
  price: string;
  deadlineMs: number;
  /** Buy or sale on NEAR Intents: the side the player signs (server/npc/trader.mjs). */
  intents?: {
    verifier: string;
    nftContract: string;
    wnear: string;
    side: "buy" | "sell";
    /** What the seller receives. */
    price: string;
    feePips: number;
    /** What the buyer gives: the price plus the verifier fee (to the treasury). */
    buyerPays: string;
  };
  nftContract?: string;
  tokens?: string[];
  receiver?: string;
  edition?: string;
  aura?: { id: string; name: string; rarity: string } | null;
  ledgerAura?: { id: string; name: string; rarity: string } | null;
  replay?: boolean;
  /** NEAR account that trades (the explorer account or a linked wallet). */
  accountId?: string;
  /** On-chain proof: the fill, or the trade-up hand-overs. */
  txHash?: string | null;
  txHashes?: string[];
  handovers?: Record<string, string>;
  /** Trade-up payout to secure on NEAR right away. */
  secureItemId?: string;
}
export interface KeeperView {
  accounts: { accountId: string }[];
  lines: string[];
  // Keeper's inner vault (server/npc/keeper-vault.mjs); absent when it is off.
  stake?: StakeCard;
}
export const tradeAccept = (actorId: string, encounter: string, offerId: string) =>
  api<NpcTrade>(`${base(actorId)}/offers/${offerId}/accept`, { encounter });
export const tradeUpComplete = (actorId: string, encounter: string, offerId: string) =>
  api<NpcTrade>(`${base(actorId)}/offers/${offerId}/complete`, { encounter });
export const keeperView = (actorId: string, encounter: string) =>
  api<KeeperView>(`${base(actorId)}/keeper`, { encounter });

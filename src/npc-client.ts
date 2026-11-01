// Client for NPC talk and quest lines (server/npc/routes.mjs). Every call
// carries the encounter token from POST /api/actors/:id/encounter.
import { api } from "./api";
import type { ActorOffer } from "./actor-types";

export interface NpcStep { questId: string; title: string; kind: string; zone: string | null; done?: boolean }
export interface NpcActiveLine { offerId: string; kind: string; label: string; steps: NpcStep[]; xp: number; aura: boolean }
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
  note?: string;
  npc?: { id: string; name: string; title: string | null; archetype: string };
}
export interface NpcLockedOffer {
  id: string;
  kind: string;
  label: string;
  perk?: string;
  locked: { tier: number };
}
export interface NpcTurnIn {
  offerId: string;
  state: string;
  xp?: number;
  aura?: { id: string; name: string; rarity: string } | null;
  note?: string;
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
  order?: unknown;
  market?: string;
  nftContract?: string;
  tokens?: string[];
  receiver?: string;
  edition?: string;
  aura?: { id: string; name: string; rarity: string } | null;
  ledgerAura?: { id: string; name: string; rarity: string } | null;
  replay?: boolean;
}
export interface KeeperView {
  accounts: { accountId: string }[];
  lines: string[];
}
export const tradeAccept = (actorId: string, encounter: string, offerId: string) =>
  api<NpcTrade>(`${base(actorId)}/offers/${offerId}/accept`, { encounter });
export const tradeUpComplete = (actorId: string, encounter: string, offerId: string) =>
  api<NpcTrade>(`${base(actorId)}/offers/${offerId}/complete`, { encounter });
export const keeperView = (actorId: string, encounter: string) =>
  api<KeeperView>(`${base(actorId)}/keeper`, { encounter });

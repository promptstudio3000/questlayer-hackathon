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
  active: NpcActiveLine[];
  source: string;
  attested?: boolean;
  note?: string;
  npc?: { id: string; name: string; title: string | null; archetype: string };
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

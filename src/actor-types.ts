// Shared client types for roaming NPCs and monsters (docs/NPC-PLAN.md §14).
// The server is the source of truth: server/actors/*.mjs.
export type ActorKind = "npc" | "monster";
export type NpcArchetype =
  | "storyteller"
  | "trader"
  | "keeper"
  | "quest_giver"
  | "wandering_rare";
export type MonsterArchetype = "roamer" | "guardian" | "lurker" | "boss";
export type Archetype = NpcArchetype | MonsterArchetype;
export type ActorElement = "ember" | "frost" | "storm" | "void";

/** One leg of an actor's day: [lng, lat] path walked between from and to (ms epoch). */
export interface ActorSegment {
  from: number;
  to: number;
  path: [number, number][];
  dwell?: boolean;
}

export interface ActorView {
  id: string;
  kind: ActorKind;
  archetype: Archetype;
  name: string;
  title?: string;
  model: string;
  element?: ActorElement;
  /** Today's segments in the area, at most the next 2 h. */
  segments: ActorSegment[];
  /** Only visible within this distance; omitted means always visible. */
  revealRadiusM?: number;
  guards?: { zoneId?: string; questId?: string };
  state?: "active" | "defeated" | "cooldown";
  cooldownUntil?: number;
}

export interface ActorsResponse {
  enabled: boolean;
  worldId: string | null;
  dayId: string | null;
  /** Server time when the list was computed, to correct client clock skew. */
  now: number;
  actors: ActorView[];
}

export type ActorOfferKind =
  | "quest"
  | "chapter"
  | "trade_buy"
  | "trade_sell"
  | "trade_up"
  | "challenge"
  | "roll";

export interface ActorOffer {
  id: string;
  kind: ActorOfferKind;
  label: string;
  terms: Record<string, unknown>;
  expiresAt: number;
}

export interface ActorEncounter {
  encounter: string;
  expiresAt: number;
  actor: ActorView;
  menu: ActorOffer[];
  distanceM: number;
}

// Client for GOLD spending and place messages (server/gold-spend/routes.mjs).
import { api } from "./api";
import { withQgoldBurn } from "./qgold-burn";

export type ShopEmote = { id: string; price: number; owned: boolean; free: boolean };
export type ShopCosmetic = { id: string; slot: string; price: number; owned: boolean; equipped: boolean };
export type GearItem = { id: string; name: string; rarity: string; slot: string; price: number; left: number | null };
export type LureView = {
  id: string;
  kind: "monster" | "trader" | "beacon";
  actorId: string | null;
  actorName: string | null;
  place: string;
  lat: number;
  lng: number;
  startsAt: number;
  endsAt: number;
  secondsLeft: number;
  mine: boolean;
};
export type Shop = {
  version: string;
  realm: "practice" | "qgold";
  balanceU: number;
  /** QGOLD realm: false when the NEAR account could not be read just now. */
  balanceKnown?: boolean;
  /** QGOLD realm: collected on the map, minted by the next payout. */
  pendingU?: number;
  /** QGOLD realm: the player has a linked NEAR account. */
  hasAccount?: boolean;
  emotes: ShopEmote[];
  cosmetics: ShopCosmetic[];
  gear: { perDay: number; boughtToday: number; items: GearItem[] };
  lures: { prices: Record<string, number>; minutes: number; hours: [string, string]; active: LureView | null };
  look: { frame: string | null; emote: string | null; emoteUntil: number } | null;
};
export type LureOption = {
  kind: "monster" | "trader" | "beacon";
  actorId: string | null;
  name: string | null;
  archetype: string | null;
  distanceM: number | null;
  price: number | null;
  reason?: string;
};
export type LureQuote = {
  place: { id: string; name: string; lat: number; lng: number };
  minutes: number;
  blocked: string | null;
  options: LureOption[];
  balanceU: number;
};
export type Fix = { lat: number; lng: number; accuracy: number; timestamp: number };

export type PlaceAuthor = { id: string; name: string; following?: boolean };
export type PlaceThread = {
  id: string;
  kind: "shout" | "topic";
  title: string;
  text: string;
  author: PlaceAuthor;
  mine: boolean;
  lat: number;
  lng: number;
  place: string;
  state: "live" | "lapsed" | "hidden" | "deleted" | "archived";
  paidUntil: number;
  freeForever: boolean;
  posts: number;
  authors: number;
  reads: number;
  createdAt: number;
  lastPostAt: number;
  distanceM?: number;
  social: { state: "none" | "prepared" | "confirmed"; account: string | null };
  replies?: { id: string; text: string; author: PlaceAuthor; mine: boolean; createdAt: number }[];
};
export type PlaceSort = "latest" | "following" | "popular" | "recommended";
export type PlaceFeed = {
  radiusKm: number;
  sort: PlaceSort;
  prices: { shoutPerDay: number; topicPerDay: number; maxDays: number; freeAuthors: number; postLevel: number };
  items: PlaceThread[];
};
export type PlacePin = {
  id: string;
  kind: "shout" | "topic";
  title: string;
  text: string;
  lat: number;
  lng: number;
  posts: number;
  mine: boolean;
  freeForever: boolean;
  paidUntil: number;
};
export type GoldMap = { lures: LureView[]; places: PlacePin[]; now: number };

async function send<T>(path: string, method: string, data?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Could not connect to the game.");
  return result as T;
}

export const goldShop = () => api<Shop>("/gold/shop");
/** The one honest balance: QGOLD on the NEAR account plus what is on its way. */
export type WalletBalance = Pick<Shop, "realm" | "balanceU" | "balanceKnown" | "pendingU" | "hasAccount">;
export const goldBalance = () => api<WalletBalance>("/gold/balance");
export const goldBuy = (sku: string) =>
  withQgoldBurn<{ sku: string; balanceU: number | null }>("/gold/buy", { sku });
export const goldEquip = (frame: string | null) => api("/gold/equip", { frame });
export const goldEmote = (emote: string) => api<{ emote: string; until: number }>("/gold/emote", { emote });
export const goldGear = (actorId: string, encounter: string, edition: string) =>
  withQgoldBurn<{ item: { id: string; name: string }; balanceU: number | null }>("/gold/gear", { actorId, encounter, edition });
export const lureQuote = (worldId: string, fix: Fix) => api<LureQuote>("/gold/lure/quote", { worldId, fix });
export const setLure = (worldId: string, fix: Fix, kind: string, actorId: string | null) =>
  withQgoldBurn<{ lure: LureView; balanceU: number | null }>("/gold/lure", { worldId, fix, kind, actorId });
export const goldMap = (lat: number, lng: number) => api<GoldMap>(`/gold/map?lat=${lat}&lng=${lng}`);

export const placeFeed = (lat: number, lng: number, radiusKm: number, sort: PlaceSort) =>
  api<PlaceFeed>(`/places?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}&sort=${sort}`);
export const placeOpen = (id: string) => api<{ thread: PlaceThread }>(`/places/${id}`);
export const placeCreate = (input: {
  kind: "shout" | "topic";
  title?: string;
  text: string;
  days: number;
  lat: number;
  lng: number;
  arena: boolean;
  fix?: Fix | null;
  publicConsent: true;
}) => withQgoldBurn<{ thread: PlaceThread; balanceU: number | null }>("/places", input);
export const placeExtend = (id: string, days: number) =>
  withQgoldBurn<{ thread: PlaceThread }>(`/places/${id}/extend`, { days });
export const placePost = (id: string, text: string) =>
  api<{ thread: PlaceThread; becameFree: boolean }>(`/places/${id}/posts`, { text });
export const placeReport = (id: string, reason: string) => api(`/places/${id}/report`, { reason });
export const placeRemove = (id: string) => send(`/places/${id}`, "DELETE");
export const placeFollow = (playerId: string, on: boolean) => api("/places/follow", { playerId, on });

// Community places (server/community-places.mjs): spots explorers recommend.
import type { Fix } from "./types";

export type PlaceKind = "view" | "nature" | "history" | "art" | "food" | "hidden" | "play";
export type CommunityPlace = {
  id: string;
  name: string;
  note: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  author: { id: string; name: string };
  mine: boolean;
  distanceM: number | null;
  createdAt: number;
  updatedAt: number;
};

async function send<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const value = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(value.error || "Could not connect to the game.");
  return value as T;
}

export const communityPlaces = (lat: number, lng: number, arena: boolean) =>
  send<{ places: CommunityPlace[] }>(`/community-places?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&arena=${arena ? 1 : 0}`);
export const addCommunityPlace = (input: {
  name: string;
  note: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  arena: boolean;
  fix: Fix | null;
}) => send<{ place: CommunityPlace }>("/community-places", "POST", { ...input, publicConsent: true });
export const editCommunityPlace = (id: string, input: { name?: string; note?: string; kind?: PlaceKind }) =>
  send<{ place: CommunityPlace }>(`/community-places/${encodeURIComponent(id)}`, "PATCH", input);
export const removeCommunityPlace = (id: string) => send(`/community-places/${encodeURIComponent(id)}`, "DELETE", {});
export const reportCommunityPlace = (id: string, reason = "spam") =>
  send(`/community-places/${encodeURIComponent(id)}/report`, "POST", { reason });

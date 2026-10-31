import type { Quest, World, Zone } from "./types";

// This is a navigation bookmark, never a reward receipt or location proof.
export type AdventureSelection = {
  version: 1;
  playerId: string;
  realm: "arena" | "gps";
  worldId: string;
  zoneId: string;
  questId: string | null;
};

export function adventureStorageKey(playerId: string, arena: boolean) {
  return `questlayer.adventure.v1:${encodeURIComponent(playerId)}:${arena ? "arena" : "gps"}`;
}

export function parseAdventureSelection(
  raw: string | null,
  playerId: string,
  arena: boolean,
): AdventureSelection | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const value = JSON.parse(raw);
    const identifier = (v: unknown): v is string =>
      typeof v === "string" && v.length > 0 && v.length <= 512;
    if (
      !value ||
      value.version !== 1 ||
      value.playerId !== playerId ||
      value.realm !== (arena ? "arena" : "gps") ||
      !identifier(value.playerId) ||
      !identifier(value.worldId) ||
      !identifier(value.zoneId) ||
      (value.questId !== null && !identifier(value.questId))
    )
      return null;
    // Reconstruct the allowed fields; stored coordinates or rewards are ignored.
    return {
      version: 1,
      playerId,
      realm: arena ? "arena" : "gps",
      worldId: value.worldId,
      zoneId: value.zoneId,
      questId: value.questId,
    };
  } catch {
    return null;
  }
}

export function resolveAdventureSelection(
  reference: AdventureSelection | null,
  world: World | null,
  playerId: string,
  arena: boolean,
  now: number,
): {
  status: "empty" | "waiting" | "unavailable" | "ready";
  zone: Zone | null;
  quest: Quest | null;
} {
  const empty = { zone: null, quest: null };
  if (!reference) return { status: "empty", ...empty };
  if (
    reference.playerId !== playerId ||
    reference.realm !== (arena ? "arena" : "gps")
  )
    return { status: "unavailable", ...empty };
  // A pending/failed world request is not proof that a saved quest disappeared.
  if (!world || world.arena !== arena) return { status: "waiting", ...empty };
  if (world.id !== reference.worldId || world.endsAt <= now)
    return { status: "unavailable", ...empty };
  const zone = world.zones.find(
    (z) => z.id === reference.zoneId && z.closesAt > now,
  );
  if (!zone) return { status: "unavailable", ...empty };
  const quest =
    reference.questId === null
      ? null
      : world.quests.find(
          (q) =>
            q.id === reference.questId &&
            (q.zone_id === zone.id ||
              q.id === zone.id.replace(":zone:", ":quest:")) &&
            q.closes_at > now,
        );
  if (reference.questId !== null && !quest)
    return { status: "unavailable", ...empty };
  // Completed and shared-claimed activities retain the current server state.
  return { status: "ready", zone, quest: quest || null };
}

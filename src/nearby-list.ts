// Explore · Nearby: one list of everything on the map around the explorer
// (places, their activities, NPCs and monsters, community content), filtered
// by type and sorted by distance, XP or reward. Pure helpers, no UI.
import { meters } from "./api.ts";
import type { Point } from "./types";

export type NearbyFilter = "all" | "zones" | "quests" | "npcs" | "community";
export type NearbySort = "distance" | "xp" | "reward";
export const NEARBY_FILTERS: readonly NearbyFilter[] = ["all", "zones", "quests", "npcs", "community"];
export const NEARBY_SORTS: readonly NearbySort[] = ["distance", "xp", "reward"];

/** One row. `ref` is the id of the zone, quest, actor or community item. */
export type NearbyEntry = {
  key: string;
  kind: "zone" | "quest" | "npc" | "community";
  ref: string;
  distanceM: number;
  /** XP the row can earn (0 when it earns none). */
  xp: number;
  /** GOLD units the row can pay out (0 when it pays none). */
  reward: number;
  /** Locked for this explorer (tier, opening time): sinks below open rows. */
  locked?: boolean;
  /** In "All", a quest its place row already shows. */
  shownByZone?: boolean;
};

export function nearbyFilterOf(value: string | null | undefined): NearbyFilter {
  return NEARBY_FILTERS.includes(value as NearbyFilter) ? (value as NearbyFilter) : "all";
}
export function nearbySortOf(value: string | null | undefined): NearbySort {
  return NEARBY_SORTS.includes(value as NearbySort) ? (value as NearbySort) : "distance";
}

const FILTER_KIND: Record<Exclude<NearbyFilter, "all">, NearbyEntry["kind"]> = {
  zones: "zone",
  quests: "quest",
  npcs: "npc",
  community: "community",
};

/** Rows for one filter, in the chosen order. Open rows come before locked ones. */
export function nearbyRows(entries: readonly NearbyEntry[], filter: NearbyFilter, sort: NearbySort): NearbyEntry[] {
  const kept = entries.filter((e) =>
    filter === "all" ? !e.shownByZone : e.kind === FILTER_KIND[filter],
  );
  const dist = (e: NearbyEntry) => (Number.isFinite(e.distanceM) ? e.distanceM : Infinity);
  return kept.sort(
    (a, b) =>
      Number(!!a.locked) - Number(!!b.locked) ||
      (sort === "xp" ? b.xp - a.xp : sort === "reward" ? b.reward - a.reward : 0) ||
      dist(a) - dist(b) ||
      a.key.localeCompare(b.key),
  );
}

/** How many rows each filter chip would show. */
export function nearbyCounts(entries: readonly NearbyEntry[]): Record<NearbyFilter, number> {
  const counts: Record<NearbyFilter, number> = { all: 0, zones: 0, quests: 0, npcs: 0, community: 0 };
  for (const e of entries) {
    if (!e.shownByZone) counts.all++;
    counts[e.kind === "zone" ? "zones" : e.kind === "quest" ? "quests" : e.kind === "npc" ? "npcs" : "community"]++;
  }
  return counts;
}

export const distanceTo = (from: Point, to: Point | null | undefined) =>
  to && Number.isFinite(to.lat) && Number.isFinite(to.lng) ? meters(from, to) : Infinity;

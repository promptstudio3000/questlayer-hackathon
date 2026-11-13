import { meters } from "./api.ts";
import type { Coin, Point, Quest, Zone } from "./types.ts";

export type NearestDiscovery =
  | { kind: "quest"; quest: Quest; zone: Zone; point: Point; distance: number }
  | { kind: "find"; coin: Coin; point: Point; distance: number };

// Recommends the closest thing a player can actually do right now: an open,
// tier-eligible zone activity or an unclaimed street find. Distance wins; no
// reward type is pinned to the top any more.
export function nearestDiscovery({
  position,
  quests,
  zones,
  coins,
  tier,
  now,
  questPoint = (q) => q.nextPoint || q,
}: {
  position: Point;
  quests: Quest[];
  zones: Zone[];
  coins: Coin[];
  tier: number;
  now: number;
  questPoint?: (q: Quest) => Point;
}): NearestDiscovery | null {
  let best: NearestDiscovery | null = null;
  const consider = (candidate: NearestDiscovery) => {
    if (!Number.isFinite(candidate.distance)) return;
    if (!best || candidate.distance < best.distance) best = candidate;
  };
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  for (const quest of quests) {
    const zone = quest.zone_id ? zoneById.get(quest.zone_id) : undefined;
    if (
      !zone ||
      zone.closesAt <= now ||
      zone.placeStatus === "closed" ||
      quest.placeStatus === "closed" ||
      quest.tier > tier ||
      quest.completed ||
      quest.opens_at > now ||
      quest.closes_at <= now
    )
      continue;
    const point = questPoint(quest);
    consider({
      kind: "quest",
      quest,
      zone,
      point,
      distance: meters(position, point),
    });
  }
  for (const coin of coins) {
    if (!coin.find || coin.claimant) continue;
    consider({
      kind: "find",
      coin,
      point: { lat: coin.lat, lng: coin.lng },
      distance: meters(position, coin),
    });
  }
  return best;
}

export type NearestQuest = {
  quest: Quest;
  zone: Zone;
  point: Point;
  distance: number;
};

export type QuestOutlook =
  | { state: "open"; nearest: NearestQuest }
  /** Quests exist here today but none is open yet (before play hours). */
  | { state: "later"; opensAt: number }
  /** Nothing checked for quests here today (empty POI cell). */
  | { state: "empty" }
  /** Quests here today closed before the explorer did any of them. */
  | { state: "closed" }
  /** Everything here is done (or closed after some were done) for today. */
  | { state: "none" };

// First session outside the reviewed city: the coach and the map point at
// the closest open POI quest (W6 zones carry source "poi"), so a newcomer in
// Brno or a village has one clear "go here" even before the chest step.
export function poiQuestOutlook({
  position,
  quests,
  zones,
  tier,
  now,
  emptyCell = false,
  questPoint = (q) => q.nextPoint || q,
}: {
  position: Point;
  quests: Quest[];
  zones: Zone[];
  tier: number;
  now: number;
  emptyCell?: boolean;
  questPoint?: (q: Quest) => Point;
}): QuestOutlook {
  const zoneById = new Map(
    zones.filter((z) => z.source === "poi").map((z) => [z.id, z]),
  );
  let best: NearestQuest | null = null;
  let opensAt = Infinity,
    done = false;
  for (const quest of quests) {
    const zone = quest.zone_id ? zoneById.get(quest.zone_id) : undefined;
    if (zone && quest.completed) done = true;
    if (
      !zone ||
      quest.completed ||
      quest.tier > tier ||
      zone.placeStatus === "closed" ||
      quest.placeStatus === "closed" ||
      quest.closes_at <= now ||
      zone.closesAt <= now
    )
      continue;
    if (quest.opens_at > now) {
      opensAt = Math.min(opensAt, quest.opens_at);
      continue;
    }
    const point = questPoint(quest);
    const distance = meters(position, point);
    if (!Number.isFinite(distance)) continue;
    if (!best || distance < best.distance)
      best = { quest, zone, point, distance };
  }
  if (best) return { state: "open", nearest: best };
  if (Number.isFinite(opensAt)) return { state: "later", opensAt };
  if (emptyCell || !zoneById.size) return { state: "empty" };
  return done ? { state: "none" } : { state: "closed" };
}

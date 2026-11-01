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

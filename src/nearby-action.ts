import type { ActorView } from "./actor-types";
import type { Coin, Point, Quest, World, Zone } from "./types";
import { metersBetween } from "./map-motion.ts";
import { questTarget } from "./quest-route.ts";

export type NearbyActor = { actor: ActorView; distanceM: number; stationary: boolean };
export type NearbyAction =
  | { kind: "actor"; id: string; distanceM: number; actor: ActorView }
  | { kind: "quest"; id: string; distanceM: number; quest: Quest; zone: Zone }
  | { kind: "find"; id: string; distanceM: number; coin: Coin };

/** These cues open information, never grant a pickup or bypass server checks. */
export function nearbyAction({ world, position, tier, now, actors, preferredQuestId }: {
  world: World | null; position: Point; tier: number; now: number;
  actors: NearbyActor[]; preferredQuestId?: string | null;
}): NearbyAction | null {
  if (!world) return null;
  const options: NearbyAction[] = actors.flatMap(({ actor, distanceM, stationary }) =>
    Number.isFinite(distanceM) && distanceM <= (stationary ? 50 : 35) && distanceM >= 0 &&
    actor.state !== "defeated" && actor.state !== "cooldown" &&
    (actor.revealRadiusM === undefined || distanceM <= actor.revealRadiusM)
      ? [{ kind: "actor" as const, id: actor.id, distanceM, actor }] : []);
  for (const quest of world.quests) {
    const zone = world.zones.find(z => z.id === quest.zone_id);
    if (!zone || quest.completed || quest.tier > tier || quest.placeStatus === "closed" ||
      zone.placeStatus === "closed" || zone.operatorPause || quest.opens_at > now || quest.closes_at <= now) continue;
    const distanceM = metersBetween(position, questTarget(quest, position));
    if (distanceM <= 25) options.push({ kind: "quest", id: quest.id, distanceM, quest, zone });
  }
  for (const coin of world.coins) {
    if (!coin.find || coin.claimant) continue;
    const distanceM = metersBetween(position, coin);
    // A preview can open before automatic collection; this is not a claim radius.
    if (distanceM <= 60) options.push({ kind: "find", id: coin.id, distanceM, coin });
  }
  return options.sort((a, b) =>
    Number(b.kind === "quest" && b.id === preferredQuestId) - Number(a.kind === "quest" && a.id === preferredQuestId) ||
    a.distanceM - b.distanceM || a.id.localeCompare(b.id))[0] || null;
}

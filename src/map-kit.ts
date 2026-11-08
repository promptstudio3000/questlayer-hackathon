// Map-only artwork. Static URLs keep it out of the welcome bundle and leave
// the canonical character, wearable and item renderers untouched.
import type { Point, Quest, Zone } from "./types";
import type { QuestRoute } from "./quest-route";
import { representativeZoneQuest } from "./game-object-art-data.ts";

export const mapKitUrl = (path: string) => `/art/map-kit/${path}`;
export type AltarFamily =
  "discovery" | "trail" | "return" | "chest" | "task" | "guardian" | "landmark";
export function questPinKind(q?: Quest): string {
  if (!q) return "visit";
  if (q.clue) return "clue";
  if (q.activity?.icon === "return") return "return";
  if (q.kind === "route" || q.activity?.icon === "trail") return "trail";
  return ["chest", "task", "guardian", "community"].includes(q.kind)
    ? q.kind
    : "visit";
}
export function altarFamily(q?: Quest): AltarFamily {
  const kind = questPinKind(q);
  return kind === "visit"
    ? "discovery"
    : kind === "clue"
      ? "landmark"
      : kind === "community"
        ? "task"
        : (kind as AltarFamily);
}
export function altarModelId(
  zone: Zone,
  quests: readonly Quest[],
  now: number,
  playerTier?: number,
  selectedQuestId?: string | null,
) {
  const q =
    quests.find((q) => q.id === selectedQuestId && q.zone_id === zone.id) ||
    representativeZoneQuest(zone, quests, { now, playerTier });
  const tier = zone.tier === 2 || zone.tier === 3 ? zone.tier : 1;
  return `${altarFamily(q)}-tier-${tier}`;
}
export function questPinMarkup(kind: string, state = "ready") {
  // Only authored, allowlisted file names ever enter marker HTML.
  const safe = [
    "visit",
    "trail",
    "return",
    "chest",
    "task",
    "clue",
    "guardian",
    "community",
  ].includes(kind)
    ? kind
    : "visit";
  const safeState = ["ready", "open", "completed", "locked"].includes(state)
    ? state
    : "ready";
  return `<img class="map-kit-pin-art" src="${mapKitUrl(`quests/${safe}.png`)}" alt="" aria-hidden="true" draggable="false" data-map-kit="${safe}" data-state="${safeState}"/>`;
}
export function servicePin(archetype: string): string | null {
  const kinds: Record<string, string> = {
    trader: "merchant",
    keeper: "keeper",
    storyteller: "storyteller",
    quest_giver: "quest-giver",
    boss: "event",
  };
  return kinds[archetype] ? mapKitUrl(`pins/${kinds[archetype]}.png`) : null;
}
/** Ordered objective guidance only: these segments are never a walking route. */
export function mapGuidePoints({
  position,
  route,
  target,
  zone,
  quests,
  now,
  playerTier,
  selectedQuestId,
}: {
  position: Point;
  route?: QuestRoute | null;
  target?: Point | null;
  zone?: Zone | null;
  quests: readonly Quest[];
  now: number;
  playerTier?: number;
  selectedQuestId?: string | null;
}): Point[] {
  const finite = (p: Point) =>
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180;
  if (!finite(position)) return [];
  let points: Point[];
  if (
    route?.points.length &&
    !target &&
    (!selectedQuestId || selectedQuestId === route.questId)
  )
    points = route.points;
  else {
    const zoneOpen = zone && zone.opensAt <= now && zone.closesAt > now;
    const q =
      zoneOpen &&
      (quests.find((q) => q.id === selectedQuestId && q.zone_id === zone.id) ||
        representativeZoneQuest(zone, quests, { now, playerTier }));
    const goal =
      target ||
      (q &&
      !q.completed &&
      q.opens_at <= now &&
      q.closes_at > now &&
      (playerTier === undefined || q.tier <= playerTier)
        ? q.nextPoint || q
        : null);
    points = goal ? [position, goal] : [];
  }
  // Reject the entire malformed guide rather than silently bridging a missing stop.
  if (points.some((p) => !finite(p))) return [];
  return points
    .filter(
      (p, i) =>
        !i || p.lat !== points[i - 1].lat || p.lng !== points[i - 1].lng,
    )
    .map(({ lat, lng }) => ({ lat, lng }));
}

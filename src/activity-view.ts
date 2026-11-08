import { tr } from "./i18n.ts";
import { questTarget, remainingQuestStops } from "./quest-route.ts";
import { zoneInteriorMargin } from "./zone-presence.ts";
import { metersBetween } from "./map-motion.ts";
import type { Fix, Point, Quest, Zone } from "./types";

/** Player-facing categories describe existing requirements, never new mechanics. */
export function activityKind(quest: Quest) {
  if (quest.kind === "chest") return "chest";
  if (quest.clue) return "clue";
  if (quest.visitedStops !== undefined || quest.activity?.templateId === "poi-category-hunt") return "hunt";
  if (quest.activity?.templateId === "return-trail") return "return";
  return quest.kind === "route" ? "trail" : "visit";
}

export function activityLabel(quest: Quest): string {
  switch (activityKind(quest)) {
    case "chest": return tr("Chest");
    case "clue": return tr("Landmark clue");
    case "hunt": return tr("Place hunt");
    case "return": return tr("There and back");
    case "trail": return tr("Trail");
    default: return tr("Visit");
  }
}

export function questsInZone(quests: Quest[], zone: Zone | null | undefined) {
  return zone ? quests.filter(q => q.zone_id === zone.id || q.id === zone.id.replace(":zone:", ":quest:")) : [];
}

/** Step numbers and completion always come from the current server view. */
export function activityProgress(quest: Quest, position: Point): string {
  if (quest.completed) return tr("Completed");
  if (quest.kind !== "route") return activityLabel(quest);
  const total = quest.checkpointCount || quest.activity?.steps.length || 1;
  if ((quest.checkpoint || 0) >= total) return tr("Finish walk");
  if (activityKind(quest) === "hunt") return `${tr("Any order")} · ${quest.checkpoint || 0}/${total}`;
  const target = questTarget(quest, position);
  const next = remainingQuestStops(quest).find(p => p.lat === target.lat && p.lng === target.lng)?.number || (quest.checkpoint || 0) + 1;
  return tr("Stop {0} of {1}", { 0: next, 1: total });
}

/** Permanent UI explanation, independent of teaching preferences. The server verifies completion. */
export function activityRequirement(quest: Quest, zone: Zone, position: Point, now: number, arena: boolean, fix: Fix | null, online: boolean): string | null {
  if (quest.completed) return null;
  if (!online) return tr("You're offline");
  if (zone.operatorPause) return tr("Not open now");
  if (zone.placeStatus === "closed" || quest.placeStatus === "closed" || zone.closesAt <= now || quest.closes_at <= now) return tr("Closed for today");
  if (zone.opensAt > now || quest.opens_at > now) return tr("Not open now");
  if (!arena && (!fix || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 35 || !Number.isFinite(fix.timestamp) || now - fix.timestamp > 15000 || fix.timestamp > now + 2000)) return tr("Needs a fresh, accurate GPS fix.");
  if (metersBetween(position, questTarget(quest, position)) > 25) return tr("Be within {0} m of the pinned place to complete it.", { 0: 25 });
  if (zone.geometry && zoneInteriorMargin(zone, position) === null) return tr("Step inside the place first, then confirm your visit.");
  return null;
}

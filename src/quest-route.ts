import type { Point, Quest } from "./types";

/** A multi-stop walk the map should draw from the explorer onward. */
export type QuestRoute = {
  questId: string;
  /** The explorer first, then the stops still ahead in walking order. */
  points: Point[];
};

function span(a: Point, b: Point) {
  const r = Math.PI / 180,
    x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) * r) / 2),
    y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
}

function multiStop(q: Quest, now: number) {
  return (
    !q.completed &&
    (q.stops?.length || 0) > 0 &&
    (q.checkpointCount || 0) > 1 &&
    q.closes_at > now
  );
}

function started(q: Quest) {
  return (q.checkpoint || 0) > 0 || (q.stops?.length || 0) < (q.checkpointCount || 0);
}

/**
 * The walk to draw: the one the explorer was pointed at, else a walk in the
 * selected place, else the nearest walk already started. Ordered walks keep
 * their order; a hunt (any order) is drawn nearest stop first.
 */
export function activeQuestRoute(
  quests: Quest[],
  {
    position,
    now,
    questId,
    zoneId,
  }: { position: Point; now: number; questId?: string | null; zoneId?: string | null },
): QuestRoute | null {
  const open = quests.filter((q) => multiStop(q, now));
  const quest =
    open.find((q) => q.id === questId) ||
    (zoneId ? open.find((q) => q.zone_id === zoneId) : undefined) ||
    open
      .filter(started)
      .sort((a, b) => span(position, a.nextPoint || a) - span(position, b.nextPoint || b))[0];
  if (!quest?.stops?.length) return null;
  const stops = quest.stops.map((p) => ({ lat: p.lat, lng: p.lng }));
  const unordered = !!quest.visitedStops;
  const ordered: Point[] = [];
  if (unordered) {
    let from = position;
    const left = [...stops];
    while (left.length) {
      let best = 0;
      left.forEach((p, i) => {
        if (span(from, p) < span(from, left[best])) best = i;
      });
      from = left.splice(best, 1)[0];
      ordered.push(from);
    }
  } else ordered.push(...stops);
  return { questId: quest.id, points: [{ lat: position.lat, lng: position.lng }, ...ordered] };
}

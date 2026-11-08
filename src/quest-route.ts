import type { Point, Quest } from "./types";

/** A multi-stop walk the map should draw from the explorer onward. */
export type QuestRoute = {
  questId: string;
  total: number;
  unordered: boolean;
  stops: (Point & { number: number })[];
  /** The explorer first, then the stops still ahead in walking order. */
  points: Point[];
};

/** Published remaining stops retain their original numbers, including returns. */
export function remainingQuestStops(q: Quest) {
  const visited = new Set(q.visitedStops || []);
  const indices = q.visitedStops
    ? Array.from({ length: q.checkpointCount || 0 }, (_, i) => i).filter(i => !visited.has(i))
    : (q.stops || []).map((_, i) => (q.checkpoint || 0) + i);
  return (q.stops || []).map((p, i) => ({ ...p, number: (indices[i] ?? i) + 1 }));
}

/** Ordered walks use the server's next point; hunts permit any remaining stop. */
export function questTarget(q: Quest, position: Point): Point {
  return q.visitedStops && q.stops?.length
    ? [...q.stops].sort((a, b) => span(position, a) - span(position, b))[0]
    : q.nextPoint || q;
}

/** Co-located return steps share a marker so a future number cannot cover the next. */
export function questStopMarkers(route: QuestRoute) {
  const groups: { point: Point; numbers: number[]; next: boolean }[] = [];
  route.stops.forEach((stop, i) => {
    const group = groups.find(g => span(g.point, stop) < 0.5);
    if (group) { group.numbers.push(stop.number); group.next ||= i === 0; }
    else groups.push({ point: stop, numbers: [stop.number], next: i === 0 });
  });
  // Next is rendered last, above overlapping nearby markers.
  return groups.sort((a, b) => Number(a.next) - Number(b.next));
}

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
  if (questId && quests.some(q => q.id === questId) && !open.some(q => q.id === questId)) return null;
  const quest =
    open.find((q) => q.id === questId) ||
    (zoneId ? open.find((q) => q.zone_id === zoneId) : undefined) ||
    open
      .filter(started)
      .sort((a, b) => span(position, questTarget(a, position)) - span(position, questTarget(b, position)))[0];
  if (!quest?.stops?.length) return null;
  const stops = remainingQuestStops(quest);
  const unordered = !!quest.visitedStops;
  const ordered: typeof stops = [];
  if (unordered) {
    let from = position;
    const left = [...stops];
    while (left.length) {
      let best = 0;
      left.forEach((p, i) => {
        if (span(from, p) < span(from, left[best])) best = i;
      });
      const next = left.splice(best, 1)[0];
      from = next;
      ordered.push(next);
    }
  } else ordered.push(...stops);
  return { questId: quest.id, total: quest.checkpointCount || stops.length, unordered, stops: ordered, points: [{ lat: position.lat, lng: position.lng }, ...ordered.map(({lat,lng})=>({lat,lng}))] };
}

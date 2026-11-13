// Where an NPC or monster is at a given time, from its day segments.
// Kept apart from the map layer so lists can use it without MapLibre.
import type { ActorSegment } from "./actor-types";
import { meters } from "./api";

type LngLat = { lng: number; lat: number };

/** Same interpolation as server/actors/schedule.mjs positionAt. */
export function actorPositionAt(
  segments: ActorSegment[],
  t: number,
): (LngLat & { dwell: boolean; heading: number | null }) | null {
  const s = segments.find((x) => t >= x.from && t < x.to);
  if (!s) return null;
  if (s.dwell || s.path.length === 1)
    return { lng: s.path[0][0], lat: s.path[0][1], dwell: true, heading: null };
  const pt = (p: [number, number]) => ({ lng: p[0], lat: p[1] });
  const lengths = [0];
  for (let i = 1; i < s.path.length; i++)
    lengths.push(lengths[i - 1] + meters(pt(s.path[i - 1]), pt(s.path[i])));
  const total = lengths[lengths.length - 1],
    want = (total * (t - s.from)) / (s.to - s.from);
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < want) i++;
  const span = lengths[i] - lengths[i - 1] || 1,
    f = Math.max(0, Math.min(1, (want - lengths[i - 1]) / span)),
    [a, b] = [s.path[i - 1], s.path[i]];
  return {
    lng: a[0] + (b[0] - a[0]) * f,
    lat: a[1] + (b[1] - a[1]) * f,
    dwell: false,
    heading: b[0] >= a[0] ? 1 : -1,
  };
}

import { metersBetween } from "./map-motion.ts";
import type { Fix, Point, World, Zone } from "./types.ts";

function ringContains(ring: number[][], p: Point) {
  if (ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [a, b] = ring[j];
    if ((y > p.lat) !== (b > p.lat) && p.lng < (a - x) * (p.lat - y) / (b - y) + x) inside = !inside;
  }
  return inside;
}
function boundaryDistance(ring: number[][], p: Point) {
  const lngScale = 111320 * Math.cos(p.lat * Math.PI / 180);
  let distance = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - p.lng) * lngScale, ay = (ring[i - 1][1] - p.lat) * 111320;
    const bx = (ring[i][0] - p.lng) * lngScale, by = (ring[i][1] - p.lat) * 111320;
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    distance = Math.min(distance, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return distance;
}
/** Distance to the nearest footprint edge while inside, never a reward/presence attestation. */
export function zoneInteriorMargin(zone: Zone, point: Point): number | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  if (!zone.geometry) {
    const margin = zone.radius - metersBetween(zone, point);
    return Number.isFinite(margin) && margin > 0 ? margin : null;
  }
  const polygons = zone.geometry.type === "Polygon" ? [zone.geometry.coordinates] : zone.geometry.coordinates;
  for (const rings of polygons) {
    if (!rings.length || !ringContains(rings[0], point) || rings.slice(1).some(r => ringContains(r, point))) continue;
    return Math.min(...rings.map(r => boundaryDistance(r, point)));
  }
  return null;
}
export type ZonePresence = { zone: Zone; state: "ready" | "locked" | "closed" | "cleared" | "uncertain"; count: number; questId?: string };
/** A map hint only. Availability still comes from current data and all existing server checks remain. */
export function currentZone(world: World | null, point: Point, fix: Fix | null, arena: boolean, tier: number, now: number): ZonePresence | null {
  if (!world || !Number.isFinite(now) || world.endsAt <= now || world.arena !== arena) return null;
  if (!arena && (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.timestamp) || now - fix.timestamp > 15000 || fix.timestamp > now + 2000 || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || metersBetween(point, fix) > 2)) return null;
  for (const zone of world.zones) {
    const margin = zoneInteriorMargin(zone, point);
    if (margin === null) continue;
    const quests = world.quests.filter(q => q.zone_id === zone.id);
    const available = quests.filter(q => !q.completed && q.tier <= tier && q.opens_at <= now && q.closes_at > now && q.placeStatus !== "closed");
    const uncertain = !arena && (fix!.accuracy > 35 || margin <= fix!.accuracy);
    const state = uncertain ? "uncertain" : zone.operatorPause || zone.placeStatus === "closed" || zone.opensAt > now || zone.closesAt <= now ? "closed" : zone.tier > tier ? "locked" : quests.length && quests.every(q => q.completed) ? "cleared" : "ready";
    return { zone, state, count: state === "ready" ? available.length : 0, questId: state === "ready" ? available[0]?.id : undefined };
  }
  return null;
}

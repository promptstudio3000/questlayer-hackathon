import type { Fix } from "./types";
import { headingTo, metersBetween, normalizeHeading } from "./map-motion.ts";

export type GpsFacing = {
  anchor: Fix | null;
  heading: number | null;
  lastFixAt: number | null;
  lastMovementAt: number | null;
};
export const initialGpsFacing = (): GpsFacing => ({ anchor: null, heading: null, lastFixAt: null, lastMovementAt: null });

/** Visual course only. Never changes a fix, presence evidence or claim validation. */
export function advanceGpsFacing(previous: GpsFacing, fix: Fix & { heading?: number | null; speed?: number | null }, now: number) {
  const unchanged = { state: previous, resumed: false };
  if (!Number.isFinite(now) || !Number.isFinite(fix.lat) || Math.abs(fix.lat) > 90 || !Number.isFinite(fix.lng) || Math.abs(fix.lng) > 180 ||
    !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 35 || !Number.isFinite(fix.timestamp) ||
    fix.timestamp > now + 2000 || now - fix.timestamp > 15000 || (previous.lastFixAt !== null && fix.timestamp <= previous.lastFixAt)) return unchanged;
  const distance = previous.anchor ? metersBetween(previous.anchor, fix) : 0;
  const threshold = Math.max(2, Math.min(8, Math.max(previous.anchor?.accuracy ?? 0, fix.accuracy) / 2));
  const speedKnown = typeof fix.speed === "number" && Number.isFinite(fix.speed) && fix.speed >= 0;
  const stationary = speedKnown && fix.speed! < 0.2;
  const course = typeof fix.heading === "number" && Number.isFinite(fix.heading) ? normalizeHeading(fix.heading) : null;
  let heading: number | null = null;
  // Do not infer a direction from a teleport, stationary jitter or the animated marker.
  if (!stationary && distance <= 80) {
    if (course !== null && speedKnown && fix.speed! >= 0.7) heading = course;
    else if (previous.anchor && distance >= threshold) heading = course ?? headingTo(previous.anchor, fix);
  }
  return {
    resumed: heading !== null && (previous.lastMovementAt === null || now - previous.lastMovementAt > 3500),
    state: {
      anchor: heading !== null || stationary || distance > 80 || !previous.anchor ? fix : previous.anchor,
      heading: heading ?? previous.heading,
      lastFixAt: fix.timestamp,
      lastMovementAt: heading !== null ? fix.timestamp : previous.lastMovementAt,
    },
  };
}

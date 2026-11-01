import type { Point } from "./types";
type Marker = {
  getLngLat: () => Point;
  setLngLat: (point: [number, number]) => unknown;
};
type Options = {
  reducedMotion: boolean;
  now?: () => number;
  requestFrame?: (callback: (at: number) => void) => number;
  cancelFrame?: (id: number) => void;
};
// Visual interpolation only. Quest and coin validation keep the actual location fix.
export function moveMapMarker(
  marker: Marker,
  target: Point,
  {
    reducedMotion,
    now = () => performance.now(),
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (id) => cancelAnimationFrame(id),
  }: Options,
) {
  const start = marker.getLngLat(),
    dy = ((target.lat - start.lat) * Math.PI) / 180,
    dx =
      (((target.lng - start.lng) * Math.PI) / 180) *
      Math.cos(((target.lat + start.lat) * Math.PI) / 360),
    distance = Math.hypot(dx, dy) * 6371000;
  if (!Number.isFinite(distance)) return () => {};
  const place = () => marker.setLngLat([target.lng, target.lat]);
  if (
    reducedMotion ||
    distance < 0.4 ||
    distance > 80 ||
    Math.abs(target.lng - start.lng) > 180
  ) {
    place();
    return () => {};
  }
  const began = now();
  let frame = 0,
    cancelled = false;
  const tick = (at: number) => {
    if (cancelled) return;
    const progress = Math.max(0, Math.min(1, (at - began) / 450)),
      eased = progress * progress * (3 - 2 * progress);
    marker.setLngLat([
      start.lng + (target.lng - start.lng) * eased,
      start.lat + (target.lat - start.lat) * eased,
    ]);
    if (progress < 1) frame = requestFrame(tick);
    else place();
  };
  frame = requestFrame(tick);
  return () => {
    cancelled = true;
    cancelFrame(frame);
  };
}

// City-demo "Walk there" moves the explorer at most this far per tap, so the
// arena still asks players to cross the map instead of teleporting to a prize.
export const WALK_CAP_M = 250;
export const WALK_STEP_M = 6;
export const WALK_STEP_MS = 80;
function span(a: Point, b: Point) {
  const dy = ((b.lat - a.lat) * Math.PI) / 180,
    dx =
      (((b.lng - a.lng) * Math.PI) / 180) *
      Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  return Math.hypot(dx, dy) * 6371000;
}
export function cappedWalkTarget(from: Point, to: Point, cap = WALK_CAP_M) {
  const distance = span(from, to);
  if (!Number.isFinite(distance) || distance <= cap)
    return { point: { lat: to.lat, lng: to.lng }, distance, capped: false };
  const f = cap / distance;
  return {
    point: {
      lat: from.lat + (to.lat - from.lat) * f,
      lng: from.lng + (to.lng - from.lng) * f,
    },
    distance: cap,
    capped: true,
  };
}
// Intermediate positions (ending exactly at `to`) for an animated walk.
export function walkSteps(from: Point, to: Point, step = WALK_STEP_M) {
  const distance = span(from, to);
  if (!Number.isFinite(distance) || distance <= step)
    return [{ lat: to.lat, lng: to.lng }];
  const n = Math.ceil(distance / step);
  return Array.from({ length: n }, (_, i) => {
    const f = (i + 1) / n;
    return i === n - 1
      ? { lat: to.lat, lng: to.lng }
      : {
          lat: from.lat + (to.lat - from.lat) * f,
          lng: from.lng + (to.lng - from.lng) * f,
        };
  });
}

import type { Point } from "./types";
type Marker = {
  getLngLat: () => Point;
  setLngLat: (point: [number, number]) => unknown;
};
type Options = {
  reducedMotion: boolean;
  /** Glide length; the demo pad uses one tick so steps join up. */
  duration?: number;
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
    duration = 450,
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
    const progress = Math.max(0, Math.min(1, (at - began) / duration)),
      eased =
        duration < 300 ? progress : progress * progress * (3 - 2 * progress);
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

// City demo movement. Real play moves only with the device GPS; the demo
// walks the explorer with the on-screen pad or arrows / WASD. Forward and back
// follow the way the character faces, and left / right turn it.
export const DEMO_TICK_MS = 100;
export const DEMO_WALK_MPS = 5;
// The demo arena is exempt from the GPS travel cap (about 15 km/h).
export const DEMO_RUN_MPS = 14;
export const DEMO_BACK_FACTOR = 0.6;
export const DEMO_TURN_DPS = 150;
// Facing the camera at the starting map bearing (-14°), so the face shows.
export const DEMO_START_HEADING = 166;
export function normalizeHeading(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}
function span(a: Point, b: Point) {
  const dy = ((b.lat - a.lat) * Math.PI) / 180,
    dx =
      (((b.lng - a.lng) * Math.PI) / 180) *
      Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  return Math.hypot(dx, dy) * 6371000;
}
export const metersBetween = span;
/** Compass heading (0 = north, 90 = east) from one point to another. */
export function headingTo(from: Point, to: Point) {
  const north = to.lat - from.lat,
    east = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180);
  if (!north && !east) return null;
  return normalizeHeading((Math.atan2(east, north) * 180) / Math.PI);
}
/** The point `meters` away along a compass heading (negative = backwards). */
export function stepFrom(from: Point, heading: number, meters: number): Point {
  const rad = (heading * Math.PI) / 180,
    north = Math.cos(rad) * meters,
    east = Math.sin(rad) * meters;
  return {
    lat: from.lat + (north / 6371000) * (180 / Math.PI),
    lng:
      from.lng +
      (east / (6371000 * Math.cos((from.lat * Math.PI) / 180))) *
        (180 / Math.PI),
  };
}
export type DemoInput = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  /** Joystick: -1 (left) to 1 (right), added to the arrow keys' turn. */
  turn?: number;
  /** Joystick: -1 (back) to 1 (forward), added to the arrow keys' walk. */
  walk?: number;
};
/** One movement tick: turn first, then walk along the new facing. */
export function demoTick(
  from: Point,
  heading: number,
  input: DemoInput,
  seconds: number,
) {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const stickWalk = input.walk ?? 0;
  const turn = clamp((input.right ? 1 : 0) - (input.left ? 1 : 0) + (input.turn ?? 0)),
    walk = clamp(
      (input.forward ? 1 : 0) -
        (input.back ? DEMO_BACK_FACTOR : 0) +
        (stickWalk < 0 ? stickWalk * DEMO_BACK_FACTOR : stickWalk),
    ),
    next = normalizeHeading(heading + turn * DEMO_TURN_DPS * seconds),
    meters = walk * (input.run ? DEMO_RUN_MPS : DEMO_WALK_MPS) * seconds;
  return {
    heading: next,
    position: meters ? stepFrom(from, next, meters) : from,
    moved: meters !== 0,
  };
}
/**
 * Yaw (degrees) for the map character camera. The model faces +Z; the camera
 * sits screen-south of it, so a character heading `heading` on a map rotated to
 * `bearing` must show its side that points at the bottom of the screen.
 */
export function characterYaw(bearing: number, heading: number) {
  return normalizeHeading(heading - bearing - 180);
}

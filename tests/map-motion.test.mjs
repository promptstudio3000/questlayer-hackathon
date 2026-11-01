import test from "node:test";
import assert from "node:assert/strict";
import { moveMapMarker } from "../src/map-motion.ts";
function fixture() {
  let position = { lng: 13.3774, lat: 49.74745 },
    sequence = 0;
  const frames = new Map(),
    updates = [],
    marker = {
      getLngLat: () => position,
      setLngLat: ([lng, lat]) => {
        position = { lng, lat };
        updates.push(position);
      },
    },
    options = {
      reducedMotion: false,
      now: () => 0,
      requestFrame: (callback) => {
        const id = ++sequence;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id) => frames.delete(id),
    };
  const advance = (at) => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(at);
  };
  return {
    marker,
    options,
    frames,
    updates,
    advance,
    get position() {
      return position;
    },
  };
}
test("short walking updates interpolate and stop at the exact target without idle frames", () => {
  const f = fixture(),
    start = { ...f.position },
    target = { lng: start.lng + 0.0001, lat: start.lat + 0.0001 };
  moveMapMarker(f.marker, target, f.options);
  assert.equal(f.frames.size, 1);
  f.advance(225);
  assert.ok(f.position.lat > start.lat && f.position.lat < target.lat);
  assert.ok(f.position.lng > start.lng && f.position.lng < target.lng);
  f.advance(450);
  assert.deepEqual(f.position, target);
  assert.equal(f.frames.size, 0);
});
test("reduced motion, long jumps and tiny fixes do not schedule an animation", () => {
  for (const [delta, reduced] of [
    [0.01, false],
    [0.000001, false],
    [0.0001, true],
  ]) {
    const f = fixture(),
      target = { lng: f.position.lng + delta, lat: f.position.lat };
    moveMapMarker(f.marker, target, { ...f.options, reducedMotion: reduced });
    assert.deepEqual(f.position, target);
    assert.equal(f.frames.size, 0);
  }
});
test("cancelled movement cannot overwrite a newer location even if a queued callback arrives late", () => {
  const f = fixture(),
    stop = moveMapMarker(
      f.marker,
      { lng: f.position.lng + 0.0001, lat: f.position.lat },
      f.options,
    ),
    late = [...f.frames.values()][0];
  stop();
  const target = { lng: f.position.lng + 0.01, lat: f.position.lat };
  moveMapMarker(f.marker, target, f.options);
  late(450);
  assert.deepEqual(f.position, target);
  assert.equal(f.frames.size, 0);
});

test("walk there is capped and stepped", async () => {
  const { cappedWalkTarget, walkSteps, WALK_CAP_M } = await import(
    "../src/map-motion.ts"
  );
  const from = { lat: 49.74, lng: 13.37 },
    far = { lat: 49.75, lng: 13.37 }; // ~1.1 km
  const capped = cappedWalkTarget(from, far);
  assert.equal(capped.capped, true);
  assert.equal(capped.distance, WALK_CAP_M);
  assert.ok(capped.point.lat > from.lat && capped.point.lat < far.lat);
  const near = { lat: 49.7405, lng: 13.37 };
  assert.deepEqual(cappedWalkTarget(from, near).point, near);
  const steps = walkSteps(from, capped.point);
  assert.ok(steps.length >= 40);
  assert.deepEqual(steps.at(-1), capped.point);
});

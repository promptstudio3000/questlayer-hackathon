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

test("demo pad walks the way the explorer faces", async () => {
  const { demoTick, stepFrom, headingTo, metersBetween, DEMO_WALK_MPS, DEMO_RUN_MPS } =
    await import("../src/map-motion.ts");
  const from = { lat: 49.74, lng: 13.37 };
  const idle = { forward: false, back: false, left: false, right: false, run: false };
  // Facing east, forward goes east (not along a fixed map axis).
  const east = demoTick(from, 90, { ...idle, forward: true }, 1);
  assert.ok(east.position.lng > from.lng);
  assert.ok(Math.abs(east.position.lat - from.lat) < 1e-9);
  assert.ok(Math.abs(metersBetween(from, east.position) - DEMO_WALK_MPS) < 0.05);
  // Shift / Run is faster.
  const ran = demoTick(from, 90, { ...idle, forward: true, run: true }, 1);
  assert.ok(Math.abs(metersBetween(from, ran.position) - DEMO_RUN_MPS) < 0.1);
  // Back steps away from the facing, without turning around.
  const back = demoTick(from, 0, { ...idle, back: true }, 1);
  assert.ok(back.position.lat < from.lat);
  assert.equal(back.heading, 0);
  // Left / right turn in place.
  const turned = demoTick(from, 10, { ...idle, left: true }, 0.1);
  assert.deepEqual(turned.position, from);
  assert.equal(turned.moved, false);
  assert.ok(turned.heading > 340);
  // Facing a target and walking forward reaches it.
  const target = stepFrom(from, 233, 40);
  assert.ok(Math.abs(headingTo(from, target) - 233) < 0.5);
  let p = from;
  for (let i = 0; i < 80; i++)
    p = demoTick(p, headingTo(from, target), { ...idle, forward: true }, 0.1).position;
  assert.ok(metersBetween(p, target) < 0.5);
});

test("map character shows the side that faces the screen bottom", async () => {
  const { characterYaw } = await import("../src/map-motion.ts");
  // Facing the screen bottom: camera sees the face (yaw 0).
  assert.equal(characterYaw(0, 180), 0);
  // Walking east on a north-up map: camera sits on the character's right
  // side (-X for a model facing +Z), so it looks to the right on screen.
  assert.equal(characterYaw(0, 90), 270);
  // Rotating the map by the same amount as the heading changes nothing.
  assert.equal(characterYaw(90, 180), characterYaw(0, 90));
  assert.equal(characterYaw(-14, 166), 0);
});

test("demo joystick: up walks ahead, sideways turns, down steps back slower", async () => {
  const { demoTick, DEMO_TURN_DPS, DEMO_BACK_FACTOR } = await import("../src/map-motion.ts");
  const at = { lat: 49.74745, lng: 13.3774 };
  const none = { forward: false, back: false, left: false, right: false, run: false };
  const ahead = demoTick(at, 0, { ...none, walk: 1, turn: 0 }, 1);
  assert.equal(ahead.heading, 0);
  assert.ok(ahead.moved && ahead.position.lat > at.lat, "full push up walks north when facing north");
  const turn = demoTick(at, 0, { ...none, walk: 0, turn: 1 }, 0.5);
  assert.equal(turn.moved, false);
  assert.equal(turn.heading, DEMO_TURN_DPS * 0.5);
  const back = demoTick(at, 0, { ...none, walk: -1 }, 1);
  const metres = (p) => Math.abs(p.lat - at.lat) * 111320;
  assert.ok(back.position.lat < at.lat, "pull down steps back");
  assert.ok(Math.abs(metres(back.position) - metres(ahead.position) * DEMO_BACK_FACTOR) < 0.01);
  // Keys and stick together never exceed a full push.
  const both = demoTick(at, 0, { ...none, forward: true, walk: 1 }, 1);
  assert.ok(Math.abs(metres(both.position) - metres(ahead.position)) < 0.01);
});

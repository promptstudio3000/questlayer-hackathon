import test from "node:test";
import assert from "node:assert/strict";
import { beginLearning, readLearning, finishLearningIntro, acknowledgeTopic, setLearningEnabled, learningKey } from "../src/learning-store.ts";

const values = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
} });

test("session restoration alone never opens onboarding or enables automatic help", () => {
  const state = readLearning("returning-explorer");
  assert.equal(state.intro, "done");
  assert.equal(state.enabled, false);
  assert.equal(values.has(learningKey("returning-explorer")), false);
});

test("restoring an interrupted introduction stays quiet without opting into tips", async () => {
  beginLearning("interrupted-explorer");
  assert.equal(readLearning("interrupted-explorer").intro, "new");
  const restored = await import("../src/learning-store.ts?restore-interrupted");
  assert.deepEqual(restored.readLearning("interrupted-explorer"), { version:1, intro:"done", enabled:false, seen:{} });
  finishLearningIntro("interrupted-explorer", true);
  const continued = await import("../src/learning-store.ts?restore-continued");
  assert.equal(continued.readLearning("interrupted-explorer").enabled, true);
});

test("a new explorer can skip onboarding without losing access to manual help", async () => {
  beginLearning("skip-explorer");
  assert.equal(readLearning("skip-explorer").intro, "new");
  finishLearningIntro("skip-explorer", false);
  const restored = await import("../src/learning-store.ts?restore-skip");
  assert.deepEqual(restored.readLearning("skip-explorer"), { version:1, intro:"skipped", enabled:false, seen:{} });
  setLearningEnabled("skip-explorer", true);
  assert.equal(readLearning("skip-explorer").enabled, true);
  assert.equal(readLearning("skip-explorer").intro, "skipped");
});

test("learned topics survive reload and remain scoped to the explorer and movement mode", async () => {
  beginLearning("learning-explorer"); finishLearningIntro("learning-explorer", true);
  acknowledgeTopic("learning-explorer", "movement-arena");
  acknowledgeTopic("learning-explorer", "trail");
  const restored = await import("../src/learning-store.ts?restore-progress");
  const state = restored.readLearning("learning-explorer");
  assert.equal(state.seen.trail, true);
  assert.equal(state.seen["movement-arena"], true);
  assert.equal(state.seen["movement-gps"], undefined);
  assert.deepEqual(readLearning("another-explorer").seen, {});
  setLearningEnabled("learning-explorer", false);
  setLearningEnabled("learning-explorer", true);
  assert.equal(readLearning("learning-explorer").seen.trail, true, "Re-enabling tips does not reset learned topics");
});

test("stored teaching data cannot add an unknown topic or other player's game progress", () => {
  values.set(learningKey("malformed-explorer"), JSON.stringify({ version:1, intro:"done", enabled:true, seen:{ trail:true, forgedReward:true }, xp:999999 }));
  assert.deepEqual(readLearning("malformed-explorer"), { version:1, intro:"done", enabled:true, seen:{trail:true} });
  values.set(learningKey("broken-explorer"), "{broken");
  assert.equal(readLearning("broken-explorer").enabled, false);
});

test("blocked storage still allows the current new-explorer flow to finish", () => {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable:true, value:{ getItem(){throw Error("blocked");}, setItem(){throw Error("blocked");} } });
  try {
    beginLearning("private-explorer");
    assert.equal(readLearning("private-explorer").intro, "new");
    finishLearningIntro("private-explorer", false);
    assert.equal(readLearning("private-explorer").intro, "skipped");
  } finally { Object.defineProperty(globalThis, "localStorage", { configurable:true, value:original }); }
});

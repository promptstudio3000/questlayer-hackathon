import test from "node:test";
import assert from "node:assert/strict";
import { canContinueDemoCollection } from "../src/demo-collection.ts";
const current = {
  playerId: "alice",
  worldId: "arena-a",
  arena: true,
  worldArena: true,
  endsAt: 10000,
  nativePlay: false,
  loading: false,
  visible: true,
  online: true,
};
test("a confirmed ready context permits the next client send", () => {
  assert.equal(canContinueDemoCollection(current, { ...current }, 1000), true);
});
test("owner, world, realm, replacement and foreground changes stop the next send", () => {
  for (const change of [
    { playerId: "bob" },
    { playerId: undefined },
    { worldId: "arena-b" },
    { worldId: undefined },
    { arena: false },
    { worldArena: false },
    { loading: true },
    { nativePlay: true },
    { visible: false },
    { online: false },
    { endsAt: 1000 },
    { endsAt: NaN },
  ])
    assert.equal(
      canContinueDemoCollection(current, { ...current, ...change }, 1000),
      false,
      JSON.stringify(change),
    );
  assert.equal(canContinueDemoCollection(current, current, NaN), false);
});

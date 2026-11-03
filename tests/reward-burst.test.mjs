import test from "node:test";
import assert from "node:assert/strict";
import { pushBurst, MAX_BURSTS } from "../src/reward-burst.ts";

test("coin chips merge, bigger rewards stack, old bursts expire", () => {
  let list = pushBurst([], { tone: "coin", title: "+2 XP" }, 0);
  list = pushBurst(list, { tone: "coin", title: "+4 XP" }, 100);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "+4 XP");
  list = pushBurst(list, { tone: "quest", title: "Quest complete!" }, 200);
  list = pushBurst(list, { tone: "level", title: "Level 2!" }, 300);
  assert.deepEqual(list.map((b) => b.tone), ["coin", "quest", "level"]);
  assert.equal(pushBurst(list, { tone: "find", title: "Street find!" }, 10_000).length, 1, "expired ones drop");
  for (let i = 0; i < 6; i++) list = pushBurst(list, { tone: "find", title: `${i}` }, 400);
  assert.equal(list.length, MAX_BURSTS);
  assert.ok(!list.some((b) => b.tone === "coin"), "coin chips give way first");
});

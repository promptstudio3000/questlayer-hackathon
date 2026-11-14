import test from "node:test";
import assert from "node:assert/strict";
import { pushBurst, MAX_BURSTS, compactXp } from "../src/reward-burst.ts";

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

test("XP chips add up into one +N XP chip next to the coin chip", () => {
  let list = pushBurst([], { tone: "coin", title: "+0.01 QGOLD" }, 0);
  list = pushBurst(list, { tone: "xp", amount: 5, title: "+5 XP" }, 10);
  list = pushBurst(list, { tone: "xp", amount: 20, title: "+20 XP" }, 500);
  assert.deepEqual(list.map((b) => b.tone), ["coin", "xp"]);
  assert.equal(list[1].amount, 25);
  assert.equal(list[1].title, "+25 XP");
  assert.equal(pushBurst(list, { tone: "xp", amount: 1, title: "+1 XP" }, 10_000)[0].title, "+1 XP", "expired chips start over");
});

test("HUD XP counter stays short on phones", () => {
  assert.deepEqual([0, 980, 1000, 1250, 9999, 12_400, 999_999, 1_500_000].map(compactXp),
    ["0", "980", "1k", "1.2k", "9.9k", "12k", "999k", "1.5M"]);
});

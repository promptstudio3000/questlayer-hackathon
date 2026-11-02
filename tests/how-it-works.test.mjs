import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import levelTable from "../server/data/level-table.json" with { type: "json" };
import stakerGates from "../server/data/staker-gates.json" with { type: "json" };
import placeBadges from "../server/data/place-badges.json" with { type: "json" };
import {
  CHAPTERS,
  LEVEL_LADDER,
  MAX_LEVEL,
  PLACE_BADGE_COUNT,
  SAMPLE_PLACES,
  STAKER_LADDER,
  STAKER_MIN_NEAR,
} from "../src/how-it-works/content.ts";

const page = readFileSync(new URL("../src/how-it-works/HowItWorks.tsx", import.meta.url), "utf8");

test("every chapter has a unique deep-link id and is rendered", () => {
  const ids = CHAPTERS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], "start");
  assert.equal(ids.at(-1), "join");
  for (const id of ids) assert.ok(page.includes(`id="${id}"`), `chapter ${id} is rendered`);
});

test("level ladder follows the level table", () => {
  assert.equal(MAX_LEVEL, levelTable.maxLevel);
  assert.equal(LEVEL_LADDER.length, levelTable.levels.length);
  for (const [i, rung] of LEVEL_LADDER.entries()) {
    assert.equal(rung.level, i + 1);
    assert.equal(rung.xp, 100 * i ** 2);
    assert.equal(rung.unlock, levelTable.levels[i].unlock.title);
  }
});

test("staker ladder covers every gate in step-then-level order", () => {
  assert.equal(STAKER_MIN_NEAR, Number(stakerGates.stakerMinNear));
  const labels = STAKER_LADDER.flatMap((r) => r.unlocks).sort();
  assert.deepEqual(labels, Object.values(stakerGates.gates).map((g) => g.label).sort());
  const steps = ["staker", "tier2", "tier3"];
  for (let i = 1; i < STAKER_LADDER.length; i++) {
    const a = STAKER_LADDER[i - 1], b = STAKER_LADDER[i];
    const order = steps.indexOf(a.step) - steps.indexOf(b.step) || a.level - b.level;
    assert.ok(order < 0, `${a.key} comes before ${b.key}`);
  }
  assert.deepEqual(STAKER_LADDER[0], STAKER_LADDER.find((r) => r.step === "staker" && r.level === 2));
});

test("badge scene uses real curated places", () => {
  assert.equal(PLACE_BADGE_COUNT, placeBadges.badges.length);
  assert.equal(SAMPLE_PLACES.length, 4);
  for (const p of SAMPLE_PLACES) assert.ok(placeBadges.badges.some((b) => b.id === p.id));
});

test("page copy never mentions events or presentations", () => {
  const content = readFileSync(new URL("../src/how-it-works/content.ts", import.meta.url), "utf8");
  for (const text of [page, content]) assert.doesNotMatch(text, /hackathon|judge|demo day|presentation|pitch/i);
});

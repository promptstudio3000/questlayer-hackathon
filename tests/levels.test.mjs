import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { levelFor } from "../server/domain.mjs";
import {
  loadLevelTable,
  normalizeLevelTable,
  levelProgress,
  altarOfferingsPerDay,
  extraQuestLines,
  levelTitle,
  levelItemMilestones,
  publicLevelTable,
  setLevelTable,
} from "../server/levels.mjs";
import { nativeLevelMilestones, NATIVE_LEVEL_MILESTONES } from "../server/native/progression.mjs";
import { AURA_CATALOG } from "../server/aura-catalog.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";
import { ACTORS_SCHEMA } from "../server/actors/schema.mjs";
import { createHuntRewards, CRAFTS_PER_DAY } from "../server/actors/hunt/rewards.mjs";
import { ensureWorld, HOME, worldView } from "../server/world.mjs";
import { buildMenu, MAX_LINES_PER_DAY } from "../server/npc/offers.mjs";
import { personaFor } from "../server/npc/personas.mjs";

const RAW = JSON.parse(readFileSync(new URL("../server/data/level-table.json", import.meta.url), "utf8"));

test("the level table runs L1-L10 on the levelFor curve with one unlock each", () => {
  const table = loadLevelTable({});
  assert.equal(table.maxLevel, 10);
  const ids = new Set();
  for (const e of table.levels) {
    assert.equal(levelFor(e.requiredXp), e.level, `L${e.level}`);
    assert.ok(e.unlock.title && !ids.has(e.unlock.id));
    ids.add(e.unlock.id);
    assert.equal(e.item, null, "items stay off without LEVEL_ITEM_EDITIONS");
  }
  // Lures are things to do or wear: no unlock mentions odds or payouts.
  assert.ok(table.levels.every((e) => !/odds|multiplier|payout|damage|\bGOLD\b/.test(e.unlock.title)));
});

test("bad tables are refused", () => {
  const bad = structuredClone(RAW);
  bad.levels[4].requiredXp = 1500;
  assert.throws(() => normalizeLevelTable(bad), /1600/);
  const gap = structuredClone(RAW);
  gap.levels.splice(3, 1);
  assert.throws(() => normalizeLevelTable(gap), /gaps/);
  const kind = structuredClone(RAW);
  kind.levels[2].unlock.kind = "odds";
  assert.throws(() => normalizeLevelTable(kind), /kind/);
});

test("progress gives the HUD bar numbers and the next unlock", () => {
  const p = levelProgress(1100);
  assert.equal(p.level, 4);
  assert.equal(p.levelStartXp, 900);
  assert.equal(p.nextLevelXp, 1600);
  assert.equal(p.percent, 28);
  assert.equal(p.next.level, 5);
  assert.equal(levelProgress(0).level, 1);
  assert.equal(levelProgress(8100).maxed, true);
  assert.equal(levelProgress(9000).next, null);
});

test("unlock values follow level and the table", () => {
  assert.equal(altarOfferingsPerDay(5, 1), 1);
  assert.equal(altarOfferingsPerDay(6, 1), 2);
  assert.equal(extraQuestLines(6), 0);
  assert.equal(extraQuestLines(7), 1);
  assert.equal(levelTitle(8), null);
  assert.equal(levelTitle(9), "Pathfinder");
  const custom = structuredClone(RAW);
  custom.levels[6].unlock.value = 2;
  custom.levels[8].unlock.value = "Wayfinder";
  const t = normalizeLevelTable(custom);
  assert.equal(extraQuestLines(7, t), 2);
  assert.equal(levelTitle(10, t), "Wayfinder");
  const coming = structuredClone(RAW);
  coming.levels[5].unlock.status = "coming";
  assert.equal(altarOfferingsPerDay(6, 1, normalizeLevelTable(coming)), 1, "coming unlocks do nothing yet");
});

test("level-item editions only appear behind LEVEL_ITEM_EDITIONS=1", () => {
  assert.deepEqual(levelItemMilestones(loadLevelTable({})), []);
  assert.equal(publicLevelTable(loadLevelTable({})).levels.some((e) => e.item), false);
  const on = loadLevelTable({ LEVEL_ITEM_EDITIONS: "1" });
  const items = levelItemMilestones(on);
  assert.deepEqual(items.map((m) => m.level), [10]);
  for (const m of items) {
    const e = AURA_CATALOG.find((x) => x.id === m.edition);
    assert.ok(e?.native && e.source === "chest", "a mintable, non claim-only edition");
  }
  assert.equal(nativeLevelMilestones(), NATIVE_LEVEL_MILESTONES);
  const previous = setLevelTable(on);
  try {
    assert.deepEqual(nativeLevelMilestones().map((m) => m.level), [2, 3, 4, 10]);
  } finally {
    setLevelTable(previous);
  }
});

test("L6 opens a second altar offering per day", () => {
  const db = openDatabase(":memory:");
  ensureModuleVersion(db, ACTORS_SCHEMA);
  const rewards = createHuntRewards(db);
  const p = createPlayer(db, "Crafter");
  assert.equal(rewards.summary(p, "2026-11-02").craft.perDay, CRAFTS_PER_DAY);
  db.prepare("UPDATE players SET xp=2500 WHERE id=?").run(p);
  assert.equal(rewards.summary(p, "2026-11-02").craft.perDay, 2);
});

test("L7 adds one quest line per NPC and day", async (t) => {
  const NOW = Date.parse("2026-11-02T12:00:00Z");
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Walker", NOW);
  const world = await ensureWorld(db, HOME, true, NOW);
  const RADA = { id: "rada", kind: "npc", archetype: "quest_giver", name: "Poutnice Ráda", persona: "poutnice-rada" };
  const args = { actor: RADA, persona: personaFor(RADA), world: worldView(db, world.id, player, { now: NOW }), now: NOW, linesToday: MAX_LINES_PER_DAY };
  assert.equal(buildMenu({ ...args, level: 6 }).length, 0);
  assert.ok(buildMenu({ ...args, level: 7 }).length >= 1);
});

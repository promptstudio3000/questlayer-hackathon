import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  CREATOR_XP,
  awardCompletionXp,
  awardPublishXp,
  creatorQuestKind,
  creatorXpEarned,
  publishXp,
} from "../server/creators/creator-xp.mjs";

const point = { lat: 49.7, lng: 13.3 };

test("creator XP follows the quest type and trail size, and beats world quests", () => {
  assert.equal(creatorQuestKind(undefined), "story");
  assert.equal(creatorQuestKind({ template: "chest", points: [point] }), "chest");
  assert.equal(publishXp(null), CREATOR_XP.publish.story);
  assert.equal(publishXp({ template: "visit", points: [point] }), CREATOR_XP.publish.visit);
  assert.equal(
    publishXp({ template: "trail", points: [point, point, point, point] }),
    CREATOR_XP.publish.trail + 2 * CREATOR_XP.trailStopBonus,
  );
  // World quests give 50-100 XP; building a quest is worth more.
  assert.ok(Math.min(...Object.values(CREATOR_XP.publish)) >= 100);
});

test("publication pays once; completions pay per other explorer up to the daily cap", () => {
  const db = openDatabase(":memory:");
  try {
    const author = createPlayer(db, "Author");
    const xp = () => db.prepare("SELECT xp FROM players WHERE id=?").get(author).xp;
    const start = xp();
    const place = { template: "visit", points: [point] };
    assert.equal(awardPublishXp(db, { questId: "q1", author, place, title: "Q1" }), CREATOR_XP.publish.visit);
    assert.equal(awardPublishXp(db, { questId: "q1", author, place, title: "Q1" }), 0);
    assert.equal(xp(), start + CREATOR_XP.publish.visit);
    // Own completion earns nothing.
    assert.equal(awardCompletionXp(db, { questId: "q1", author, participant: author }), 0);
    let paid = 0;
    for (let i = 0; i < CREATOR_XP.completionsPerDay + 3; i++) {
      const walker = createPlayer(db, `Walker ${i}`);
      paid += awardCompletionXp(db, { questId: "q1", author, participant: walker, title: "Q1" });
      // The same explorer never pays twice for one quest.
      assert.equal(awardCompletionXp(db, { questId: "q1", author, participant: walker }), 0);
    }
    assert.equal(paid, CREATOR_XP.completion * CREATOR_XP.completionsPerDay);
    assert.equal(creatorXpEarned(db, author), CREATOR_XP.publish.visit + paid);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM history WHERE player_id=? AND kind='creator'").get(author).n, 1 + CREATOR_XP.completionsPerDay);
  } finally {
    db.close();
  }
});

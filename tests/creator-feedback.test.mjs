import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import { QUEST_PHOTO, questFeedbackSummary } from "../server/creators/feedback.mjs";

const NOW = Date.parse("2026-11-12T09:00:00Z");
const POLICY = { version: "test-only-200xp", xpCommitment: 200 };

function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const author = createPlayer(db, "Author", NOW);
  const viewer = createPlayer(db, "Viewer", NOW);
  const other = createPlayer(db, "Other", NOW);
  db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author);
  const services = createCreatorServices(db, {
    policy: POLICY,
    clock: () => NOW,
    isModerator: (id) => id === "reviewer",
    isCompletionAuthority: (id) => id === "validator",
  });
  const { lifecycle: life, community, feedback } = services;
  let n = 0;
  const op = () => `feedback-op-${++n}`;
  community.saveProfile({
    actor: author,
    operationId: op(),
    expectedVersion: 0,
    profile: { displayName: "Riverkeeper", bio: "", public: true },
    publicConsent: true,
  });
  function publish(questId, draft) {
    life.createDraft({ actor: author, operationId: op(), questId, draft });
    life.submit({ actor: author, operationId: op(), questId, expectedVersion: 1, expectedPolicyVersion: POLICY.version });
    life.review({ actor: "reviewer", operationId: op(), questId, expectedVersion: 2, decision: "approve", reason: "ok" });
  }
  const start = (actor, questId = "river") => life.start({ actor, operationId: op(), questId });
  return { db, author, viewer, other, life, community, feedback, op, publish, start };
}

test("only explorers who started a quest rate it, once, and the list shows the average", (t) => {
  const f = fixture(t);
  f.publish("river", { title: "River Ghosts", description: "Find the ghost." });
  assert.deepEqual(f.community.publicQuest(f.viewer, "river").rating, { average: null, count: 0, comments: 0 });
  assert.equal(f.feedback.read(f.viewer, "river").rating.canRate, false);
  assert.throws(
    () => f.feedback.rate({ actor: f.viewer, operationId: f.op(), questId: "river", stars: 5 }),
    { code: "CREATOR_NOT_STARTED" },
  );
  f.start(f.viewer);
  f.start(f.other);
  assert.equal(f.feedback.read(f.viewer, "river").rating.canRate, true);
  f.feedback.rate({ actor: f.viewer, operationId: f.op(), questId: "river", stars: 5 });
  f.feedback.rate({ actor: f.other, operationId: f.op(), questId: "river", stars: 2 });
  // Changing a rating replaces it instead of counting twice.
  const changed = f.feedback.rate({ actor: f.other, operationId: f.op(), questId: "river", stars: 4 });
  assert.deepEqual(changed.rating, { average: 4.5, count: 2, comments: 0 });
  assert.equal(f.feedback.read(f.other, "river").rating.mine, 4);
  assert.deepEqual(f.community.listQuests(f.viewer).items[0].rating, { average: 4.5, count: 2, comments: 0 });
  for (const stars of [0, 6, 2.5, "5"])
    assert.throws(
      () => f.feedback.rate({ actor: f.viewer, operationId: f.op(), questId: "river", stars }),
      { code: "CREATOR_INPUT" },
    );
  assert.throws(
    () => f.feedback.rate({ actor: f.author, operationId: f.op(), questId: "river", stars: 5 }),
    { code: "CREATOR_INPUT" },
  );
});

test("a retried rating with the same operation id is applied once", (t) => {
  const f = fixture(t);
  f.publish("river", { title: "River Ghosts", description: "Find the ghost." });
  f.start(f.viewer);
  const operationId = f.op();
  const first = f.feedback.rate({ actor: f.viewer, operationId, questId: "river", stars: 3 });
  const again = f.feedback.rate({ actor: f.viewer, operationId, questId: "river", stars: 3 });
  assert.deepEqual(again, first);
  assert.equal(questFeedbackSummary(f.db, "river").count, 1);
});

test("discussion: anyone who sees the quest writes; the writer or the creator removes; blocks hide", (t) => {
  const f = fixture(t);
  f.publish("river", { title: "River Ghosts", description: "Find the ghost." });
  const { commentId } = f.feedback.comment({ actor: f.viewer, operationId: f.op(), questId: "river", body: "  Nice walk.  " });
  f.feedback.comment({ actor: f.author, operationId: f.op(), questId: "river", body: "Thanks!" });
  const seen = f.feedback.read(f.other, "river");
  assert.deepEqual(seen.comments.map((c) => c.body).sort(), ["Nice walk.", "Thanks!"]);
  assert.equal(seen.comments.find((c) => c.body === "Thanks!").author.creator, true);
  assert.equal(seen.comments.every((c) => c.canRemove === false), true);
  assert.equal(seen.rating.comments, 2);
  assert.throws(
    () => f.feedback.removeComment({ actor: f.other, operationId: f.op(), questId: "river", commentId }),
    { code: "CREATOR_FORBIDDEN" },
  );
  // The quest creator can clean up their own discussion.
  f.feedback.removeComment({ actor: f.author, operationId: f.op(), questId: "river", commentId });
  assert.deepEqual(f.feedback.read(f.other, "river").comments.map((c) => c.body), ["Thanks!"]);
  assert.throws(
    () => f.feedback.comment({ actor: f.viewer, operationId: f.op(), questId: "river", body: "   " }),
    { code: "CREATOR_INPUT" },
  );
  assert.throws(
    () => f.feedback.comment({ actor: f.viewer, operationId: f.op(), questId: "river", body: "x".repeat(501) }),
    { code: "CREATOR_INPUT" },
  );
  // A block in either direction hides the quest, and with it the discussion.
  f.db.prepare("INSERT INTO social_blocks VALUES (?,?,?)").run(f.other, f.author, NOW);
  assert.throws(() => f.feedback.read(f.other, "river"), { code: "CREATOR_NOT_FOUND" });
  assert.throws(
    () => f.feedback.comment({ actor: f.other, operationId: f.op(), questId: "river", body: "Hi" }),
    { code: "CREATOR_NOT_FOUND" },
  );
});

test("a quest draft carries only an uploaded header photo", (t) => {
  const f = fixture(t);
  const photo = "/api/creator-photos/quest_0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
  assert.match(photo, QUEST_PHOTO);
  f.publish("gate", { title: "Gate", description: "Look up.", photo });
  assert.equal(f.community.publicQuest(f.viewer, "gate").photo, photo);
  f.publish("plain", { title: "Plain", description: "No photo." });
  assert.equal("photo" in f.community.publicQuest(f.viewer, "plain"), false);
  for (const bad of ["https://example.com/a.jpg", "/api/media/image_0f8fad5b-d9cb-469f-a165-70867728950e.jpg", "/api/creator-photos/../x.jpg", 5])
    assert.throws(
      () => f.life.createDraft({ actor: f.author, operationId: f.op(), questId: "bad", draft: { title: "Bad", description: "x", photo: bad } }),
      { code: "CREATOR_INPUT" },
    );
});

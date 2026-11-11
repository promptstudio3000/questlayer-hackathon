import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import { createCreatorCommunity } from "../server/creators/community.mjs";

const NOW = Date.parse("2026-10-31T13:00:00Z");
const POLICY = { version: "test-only-200xp", xpCommitment: 200 };
const DRAFT = {
  title: "River Ghosts",
  description: "The approved public clue.",
};
function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const author = createPlayer(db, "Private account name", NOW);
  const viewer = createPlayer(db, "Private viewer name", NOW);
  const other = createPlayer(db, "Other private name", NOW);
  db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author);
  const { lifecycle: life, community } = createCreatorServices(db, {
    policy: POLICY,
    clock: () => NOW,
    isModerator: (id) => id === "reviewer",
    isCompletionAuthority: (id) => id === "validator",
  });
  let n = 0;
  const op = () => `community-op-${++n}`;
  function profile(
    actor = author,
    profile = {
      displayName: "Riverkeeper",
      bio: "Public local stories.",
      public: true,
    },
  ) {
    return community.saveProfile({
      actor,
      operationId: op(),
      expectedVersion: community.myProfile(actor).version,
      profile,
      publicConsent: profile.public,
    });
  }
  function publish(questId = "river", draft = DRAFT) {
    life.createDraft({ actor: author, operationId: op(), questId, draft });
    life.submit({
      actor: author,
      operationId: op(),
      questId,
      expectedVersion: 1,
      expectedPolicyVersion: POLICY.version,
    });
    return life.review({
      actor: "reviewer",
      operationId: op(),
      questId,
      expectedVersion: 2,
      decision: "approve",
      reason: "Private review note.",
    });
  }
  function block(first, second) {
    db.prepare("INSERT INTO social_blocks VALUES (?,?,?)").run(
      first,
      second,
      NOW,
    );
  }
  function follow(following = true) {
    return community.setFollowing({
      actor: viewer,
      operationId: op(),
      creatorId: author,
      following,
    });
  }
  return {
    db,
    author,
    viewer,
    other,
    life,
    community,
    op,
    profile,
    publish,
    block,
    follow,
  };
}
function code(action, expected) {
  assert.throws(action, (e) => e.code === expected);
}

test("profiles publish only with explicit consent and never borrow the private account name", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.community.listCreators(f.viewer).items, []);
  assert.equal(f.community.myProfile(f.author).displayName, "");
  code(
    () =>
      f.community.saveProfile({
        actor: f.author,
        operationId: f.op(),
        expectedVersion: 0,
        profile: { displayName: "Public name", bio: "", public: true },
        publicConsent: false,
      }),
    "CREATOR_CONSENT",
  );
  f.profile();
  const value = f.community.profile(f.viewer, f.author);
  assert.deepEqual(Object.keys(value).sort(), [
    "bio",
    "displayName",
    "domain",
    "following",
    "id",
    "look",
    "stats",
  ]);
  assert.equal(value.displayName, "Riverkeeper");
  assert.ok(!JSON.stringify(value).includes("Private account name"));
});

test("free follows produce a useful feed and never change XP, balances, presence or history", (t) => {
  const f = fixture(t);
  f.profile();
  f.publish();
  const tables = [
    "players",
    "treasury",
    "treasury_events",
    "history",
    "inventory",
    "presence",
  ];
  const snapshot = () =>
    tables.map((name) => f.db.prepare(`SELECT * FROM ${name}`).all());
  const before = snapshot();
  assert.equal(
    f.community.listQuests(f.viewer, { followingOnly: true }).items.length,
    0,
  );
  f.follow();
  assert.equal(
    f.community.listQuests(f.viewer, { followingOnly: true }).items[0].title,
    DRAFT.title,
  );
  assert.equal(f.community.profile(f.viewer, f.author).following, true);
  f.follow(false);
  assert.equal(
    f.community.listQuests(f.viewer, { followingOnly: true }).items.length,
    0,
  );
  assert.deepEqual(snapshot(), before);
});

test("public quest projections exclude pending edits, commitments, participants and moderation reasons", (t) => {
  const f = fixture(t);
  f.profile();
  f.publish();
  f.life.revise({
    actor: f.author,
    operationId: f.op(),
    questId: "river",
    expectedVersion: 3,
    draft: {
      title: "Secret unapproved title",
      description: "Secret draft content.",
    },
  });
  const publicQuest = f.community.publicQuest(f.viewer, "river");
  assert.equal(publicQuest.title, DRAFT.title);
  assert.equal(publicQuest.rewardStatus, "not-configured");
  const serialized = JSON.stringify(f.community.listQuests(f.viewer));
  for (const secret of [
    "Secret",
    "Private review note",
    "commitment",
    "lockedXp",
    "participant",
    "policy_version",
    "resolution_reference",
  ])
    assert.ok(!serialized.includes(secret), secret);
  assert.equal(
    f.community.myCreations(f.author).items[0].draft.title,
    "Secret unapproved title",
  );
  assert.equal(f.community.myCreations(f.viewer).items.length, 0);
});

test("hidden profiles, pending quests and closing quests do not enter public discovery", (t) => {
  const f = fixture(t);
  f.publish();
  code(() => f.community.publicQuest(f.viewer, "river"), "CREATOR_NOT_FOUND");
  code(
    () =>
      f.life.start({ actor: f.viewer, operationId: f.op(), questId: "river" }),
    "CREATOR_NOT_FOUND",
  );
  f.profile();
  assert.equal(f.community.listQuests(f.viewer).items.length, 1);
  f.life.createDraft({
    actor: f.author,
    operationId: f.op(),
    questId: "pending",
    draft: DRAFT,
  });
  f.life.submit({
    actor: f.author,
    operationId: f.op(),
    questId: "pending",
    expectedVersion: 1,
    expectedPolicyVersion: POLICY.version,
  });
  assert.equal(f.community.listQuests(f.viewer).items.length, 1);
  f.life.close({
    actor: f.author,
    operationId: f.op(),
    questId: "river",
    expectedVersion: 3,
  });
  assert.equal(f.community.listQuests(f.viewer).items.length, 0);
});

for (const direction of ["viewer", "author"])
  test(`bilateral block (${direction}) hides profiles and feeds and prevents new admissions`, (t) => {
    const f = fixture(t);
    f.profile();
    f.publish();
    f.follow();
    f.block(
      direction === "viewer" ? f.viewer : f.author,
      direction === "viewer" ? f.author : f.viewer,
    );
    code(() => f.community.profile(f.viewer, f.author), "CREATOR_NOT_FOUND");
    code(() => f.follow(), "CREATOR_NOT_FOUND");
    assert.equal(f.community.listCreators(f.viewer).items.length, 0);
    assert.equal(f.community.listQuests(f.viewer).items.length, 0);
    assert.equal(
      f.community.listQuests(f.viewer, { followingOnly: true }).items.length,
      0,
    );
    code(
      () =>
        f.life.start({
          actor: f.viewer,
          operationId: f.op(),
          questId: "river",
        }),
      "CREATOR_NOT_FOUND",
    );
    f.follow(false);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM creator_follows").get().n,
      0,
    );
  });

test("existing personal content remains accessible after edits, hiding, blocks and closure", (t) => {
  const f = fixture(t);
  f.profile();
  f.publish();
  f.life.start({ actor: f.viewer, operationId: f.op(), questId: "river" });
  f.life.revise({
    actor: f.author,
    operationId: f.op(),
    questId: "river",
    expectedVersion: 3,
    draft: { title: "New clue", description: "New approved text." },
  });
  f.life.submit({
    actor: f.author,
    operationId: f.op(),
    questId: "river",
    expectedVersion: 4,
    expectedPolicyVersion: POLICY.version,
  });
  f.life.review({
    actor: "reviewer",
    operationId: f.op(),
    questId: "river",
    expectedVersion: 5,
    decision: "approve",
    reason: "Approved.",
  });
  f.profile(f.author, { displayName: "Hidden now", bio: "", public: false });
  f.block(f.author, f.viewer);
  f.life.close({
    actor: f.author,
    operationId: f.op(),
    questId: "river",
    expectedVersion: 6,
  });
  assert.deepEqual(
    f.community.myParticipation(f.viewer, "river").content,
    DRAFT,
  );
  assert.equal(f.community.myParticipation(f.viewer, "river").revision, 1);
  code(
    () => f.community.myParticipation(f.other, "river"),
    "CREATOR_NOT_FOUND",
  );
  f.life.resolve({
    actor: "validator",
    operationId: f.op(),
    questId: "river",
    participant: f.viewer,
    resolutionReference: "durable-settlement",
  });
  f.life.finalize({
    actor: f.author,
    operationId: f.op(),
    questId: "river",
    expectedVersion: 7,
  });
  assert.equal(
    f.community.myParticipation(f.viewer, "river").questState,
    "closed",
  );
});

test("profile/follow/lifecycle mutations share one idempotency namespace", (t) => {
  const f = fixture(t);
  f.profile();
  const input = {
    actor: f.viewer,
    operationId: "once",
    creatorId: f.author,
    following: true,
  };
  const receipt = f.community.setFollowing(input);
  assert.deepEqual(f.community.setFollowing(input), receipt);
  code(
    () => f.community.setFollowing({ ...input, following: false }),
    "CREATOR_OPERATION_REUSED",
  );
  code(
    () =>
      f.life.createDraft({
        actor: f.viewer,
        operationId: "once",
        questId: "collision",
        draft: DRAFT,
      }),
    "CREATOR_OPERATION_REUSED",
  );
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM creator_follows").get().n,
    1,
  );
});

test("stale profile saves and receipt failures cannot overwrite or partially publish a profile", (t) => {
  const f = fixture(t);
  f.profile();
  const input = {
    actor: f.author,
    operationId: f.op(),
    expectedVersion: 0,
    profile: { displayName: "Stale name", bio: "", public: true },
    publicConsent: true,
  };
  code(() => f.community.saveProfile(input), "CREATOR_STALE");
  f.db.exec(
    "CREATE TRIGGER fail_profile_receipt BEFORE INSERT ON creator_operations WHEN NEW.command='saveProfile' BEGIN SELECT RAISE(ABORT,'injected profile failure'); END",
  );
  assert.throws(
    () =>
      f.community.saveProfile({
        ...input,
        operationId: f.op(),
        expectedVersion: 1,
      }),
    /injected profile failure/,
  );
  assert.equal(
    f.community.profile(f.viewer, f.author).displayName,
    "Riverkeeper",
  );
});

test("keyset pagination stays bounded and filtered in discovery and My creations", (t) => {
  const f = fixture(t);
  f.profile();
  f.profile(f.other, { displayName: "Second creator", bio: "", public: true });
  for (const questId of ["a", "b", "c"]) f.publish(questId);
  const first = f.community.listQuests(f.viewer, { limit: 2 });
  assert.deepEqual(
    first.items.map((q) => q.id),
    ["a", "b"],
  );
  assert.equal(first.nextCursor, "b");
  const second = f.community.listQuests(f.viewer, {
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(
    second.items.map((q) => q.id),
    ["c"],
  );
  assert.equal(second.nextCursor, null);
  assert.equal(
    f.community.listQuests(f.viewer, { creatorId: f.other }).items.length,
    0,
  );
  assert.equal(f.community.myCreations(f.author, { limit: 1 }).nextCursor, "a");
  const creators = f.community.listCreators(f.viewer, { limit: 1 });
  assert.equal(creators.items.length, 1);
  assert.ok(creators.nextCursor);
  assert.equal(
    f.community.listCreators(f.viewer, {
      limit: 1,
      cursor: creators.nextCursor,
    }).nextCursor,
    null,
  );
  for (const options of [
    { limit: 51 },
    { limit: 0 },
    { limit: 1.5 },
    { cursor: "../" },
    { followingOnly: "true" },
  ])
    code(() => f.community.listQuests(f.viewer, options), "CREATOR_INPUT");
});

test("a changed publication quote cannot silently become an accepted XP commitment", (t) => {
  const f = fixture(t);
  f.life.createDraft({
    actor: f.author,
    operationId: f.op(),
    questId: "quote",
    draft: DRAFT,
  });
  assert.equal(f.life.publicationQuote(f.author, "quote").xpCommitment, 200);
  code(() => f.life.publicationQuote(f.viewer, "quote"), "CREATOR_FORBIDDEN");
  code(
    () =>
      f.life.submit({
        actor: f.author,
        operationId: f.op(),
        questId: "quote",
        expectedVersion: 1,
        expectedPolicyVersion: "unaccepted-policy",
      }),
    "CREATOR_POLICY_CHANGED",
  );
  assert.equal(f.life.readQuest("quote").state, "draft");
  assert.equal(f.life.progression(f.author).lockedXp, 0);
});

test("Community initialization and reads require the actual existing player boundary", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  code(() => createCreatorCommunity(db), "CREATOR_STORAGE");
  const f = fixture(t);
  code(() => f.community.listCreators("missing-player"), "CREATOR_AUTH");
  code(
    () =>
      f.community.setFollowing({
        actor: f.author,
        operationId: f.op(),
        creatorId: f.author,
        following: true,
      }),
    "CREATOR_INPUT",
  );
  code(
    () =>
      f.community.saveProfile({
        actor: f.author,
        operationId: f.op(),
        expectedVersion: 0,
        profile: { displayName: "a", bio: "", public: true, gps: {} },
        publicConsent: true,
      }),
    "CREATOR_INPUT",
  );
});

test("a pinned template place is public with the approved quest", (t) => {
  const f = fixture(t);
  f.profile();
  const place = {
    template: "trail",
    points: [
      { lat: 49.74745, lng: 13.3774 },
      { lat: 49.7484, lng: 13.3784 },
    ],
  };
  f.publish("river-trail", { ...DRAFT, place });
  const [quest] = f.community.listQuests(f.viewer).items;
  assert.deepEqual(quest.place, place);
  assert.deepEqual(
    f.community.publicQuest(f.viewer, "river-trail").place,
    place,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorLifecycle } from "../server/creators/lifecycle.mjs";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const POLICY = { version: "test-only-200xp", xpCommitment: 200 };
const DRAFT = {
  title: "River Ghosts",
  description: "Find the carved face beside the public riverside path.",
};
function fixture(t, { path = ":memory:", xp = 1000 } = {}) {
  const db = openDatabase(path);
  t.after(() => {
    if (db.isOpen) db.close();
  });
  const author = createPlayer(db, "Riverkeeper", NOW);
  const walker = createPlayer(db, "Solo Explorer", NOW);
  const second = createPlayer(db, "Another Explorer", NOW);
  db.prepare("UPDATE players SET xp=? WHERE id=?").run(xp, author);
  const options = {
    policy: POLICY,
    isModerator: (actor) => actor === "reviewer",
    isCompletionAuthority: (actor) => actor === "validator",
    clock: () => NOW,
  };
  const service = createCreatorLifecycle(db, options);
  let counter = 0;
  const op = () => `operation-${++counter}`;
  function call(command, input = {}) {
    const actor =
      command === "review"
        ? "reviewer"
        : command === "start"
          ? walker
          : command === "resolve"
            ? "validator"
            : author;
    const questId = input.questId ?? "river-ghosts";
    const expectedVersion =
      command === "createDraft"
        ? undefined
        : service.readQuest(questId).version;
    return service[command]({
      actor,
      operationId: op(),
      questId,
      expectedVersion,
      expectedPolicyVersion: POLICY.version,
      draft: DRAFT,
      decision: "approve",
      reason: "Reviewed public content.",
      participant: walker,
      resolutionReference: "validated-receipt-1",
      ...input,
    });
  }
  function publish(questId = "river-ghosts") {
    call("createDraft", { questId });
    call("submit", { questId });
    return call("review", { questId });
  }
  return { db, author, walker, second, options, service, call, publish, op };
}
function rejectsCode(action, code) {
  assert.throws(action, (error) => error.code === code);
}
function legacySnapshot(db) {
  return Object.fromEntries(
    [
      "players",
      "inventory",
      "history",
      "treasury",
      "treasury_events",
      "native_awards",
      "worlds",
    ].map((name) => [
      name,
      db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ]),
  );
}

test("draft/review hold no XP; approval locks available XP and lowers current level", (t) => {
  const f = fixture(t);
  assert.equal(f.service.progression(f.author).level, 4);
  f.call("createDraft");
  f.call("submit");
  assert.equal(f.service.progression(f.author).lockedXp, 0);
  const { progression, quest } = f.call("review");
  assert.deepEqual(progression, {
    domain: "demo",
    earnedXp: 1000,
    lockedXp: 200,
    availableXp: 800,
    level: 3,
  });
  assert.equal(quest.state, "published");
  assert.equal(quest.commitment.policy_version, POLICY.version);
});

test("a solo participant survives closing; independent resolution permits exact XP release", (t) => {
  const f = fixture(t);
  const before = legacySnapshot(f.db);
  f.publish();
  f.call("start");
  const closing = f.call("close");
  assert.equal(closing.quest.state, "closing");
  assert.equal(closing.progression.lockedXp, 200);
  rejectsCode(() => f.call("finalize"), "CREATOR_OBLIGATIONS_OPEN");
  rejectsCode(() => f.call("start", { actor: f.second }), "CREATOR_CONFLICT");
  f.call("resolve");
  const input = {
    actor: f.author,
    operationId: f.op(),
    questId: "river-ghosts",
    expectedVersion: f.service.readQuest("river-ghosts").version,
  };
  const receipt = f.service.finalize(input);
  assert.equal(receipt.quest.state, "closed");
  assert.deepEqual(receipt.progression, {
    domain: "demo",
    earnedXp: 1000,
    lockedXp: 0,
    availableXp: 1000,
    level: 4,
  });
  assert.deepEqual(f.service.finalize(input), receipt);
  assert.deepEqual(
    legacySnapshot(f.db),
    before,
    "No XP mint, grant, inventory, history or financial mutation occurs",
  );
  rejectsCode(() => f.call("finalize"), "CREATOR_CONFLICT");
});

test("all action receipts replay across later state changes and reject changed terms", (t) => {
  const f = fixture(t);
  const input = {
    actor: f.author,
    operationId: "stable-draft",
    questId: "river-ghosts",
    draft: DRAFT,
  };
  const first = f.service.createDraft(input);
  f.call("submit");
  f.call("review");
  assert.deepEqual(
    f.service.createDraft({
      ...input,
      draft: { description: DRAFT.description, title: DRAFT.title },
    }),
    first,
  );
  rejectsCode(
    () =>
      f.service.createDraft({
        ...input,
        draft: { ...DRAFT, title: "Changed" },
      }),
    "CREATOR_OPERATION_REUSED",
  );
  rejectsCode(
    () => f.service.close({ ...input, expectedVersion: 3 }),
    "CREATOR_OPERATION_REUSED",
  );
  rejectsCode(
    () => f.service.createDraft({ ...input, questId: "other" }),
    "CREATOR_OPERATION_REUSED",
  );
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM creator_xp_commitments").get().n,
    1,
  );
});

test("rejection and review withdrawal do not strand XP; corrected revisions retain stable identity", (t) => {
  const f = fixture(t);
  f.call("createDraft");
  f.call("submit");
  f.call("review", {
    decision: "reject",
    reason: "The description needs a clear requirement.",
  });
  assert.equal(f.service.readQuest("river-ghosts").state, "rejected");
  assert.equal(f.service.progression(f.author).lockedXp, 0);
  f.call("revise");
  f.call("submit");
  f.call("withdrawReview");
  assert.equal(f.service.readQuest("river-ghosts").latest.state, "withdrawn");
  f.call("revise");
  f.call("submit");
  f.call("review");
  assert.equal(f.service.readQuest("river-ghosts").published_revision, 3);
  assert.equal(f.service.progression(f.author).lockedXp, 200);
});

test("admissions pin immutable revisions; approving an edit does not relock XP", (t) => {
  const f = fixture(t);
  f.publish();
  f.call("start");
  f.call("revise", {
    draft: {
      title: "River Ghosts, revised",
      description: "Use the updated public clue.",
    },
  });
  assert.deepEqual(
    f.service.readQuest("river-ghosts").published.content,
    DRAFT,
  );
  f.call("submit");
  rejectsCode(() => f.call("revise"), "CREATOR_CONFLICT");
  f.call("review");
  f.call("start", { actor: f.second });
  assert.equal(f.service.participation("river-ghosts", f.walker).revision, 1);
  assert.equal(f.service.participation("river-ghosts", f.second).revision, 2);
  assert.equal(f.service.progression(f.author).lockedXp, 200);
  rejectsCode(() => f.call("start"), "CREATOR_ALREADY_STARTED");
});

test("rejecting an edit preserves existing published content and participant rights", (t) => {
  const f = fixture(t);
  f.publish();
  f.call("start");
  f.call("revise");
  f.call("submit");
  f.call("review", { decision: "reject" });
  assert.equal(f.service.readQuest("river-ghosts").state, "published");
  assert.equal(f.service.readQuest("river-ghosts").published_revision, 1);
  assert.equal(f.service.readQuest("river-ghosts").latest.state, "rejected");
  assert.equal(f.service.readQuest("river-ghosts").openParticipations, 1);
});

test("policy amounts are explicit, immutable and pinned through restart and new policies", (t) => {
  const f = fixture(t);
  rejectsCode(() => createCreatorLifecycle(f.db), "CREATOR_POLICY");
  rejectsCode(
    () =>
      createCreatorLifecycle(f.db, {
        ...f.options,
        policy: { ...POLICY, xpCommitment: 201 },
      }),
    "CREATOR_POLICY",
  );
  f.call("createDraft");
  f.call("submit");
  const next = createCreatorLifecycle(f.db, {
    ...f.options,
    policy: { version: "test-only-300xp", xpCommitment: 300 },
  });
  next.review({
    actor: "reviewer",
    operationId: f.op(),
    questId: "river-ghosts",
    expectedVersion: 2,
    decision: "approve",
    reason: "Original quote honored.",
  });
  assert.equal(next.progression(f.author).lockedXp, 200);
  next.revise({
    actor: f.author,
    operationId: f.op(),
    questId: "river-ghosts",
    expectedVersion: 3,
    draft: DRAFT,
  });
  next.submit({
    actor: f.author,
    operationId: f.op(),
    questId: "river-ghosts",
    expectedVersion: 4,
    expectedPolicyVersion: POLICY.version,
  });
  assert.equal(
    next.readQuest("river-ghosts").latest.policy_version,
    POLICY.version,
  );
});

test("failed approval leaves review pending and can retry after authoritative XP is earned", (t) => {
  const f = fixture(t, { xp: 199 });
  f.call("createDraft");
  f.call("submit");
  const input = {
    actor: "reviewer",
    operationId: "recoverable-review",
    questId: "river-ghosts",
    expectedVersion: 2,
    decision: "approve",
    reason: "Reviewed.",
  };
  rejectsCode(() => f.service.review(input), "CREATOR_INSUFFICIENT_XP");
  assert.equal(f.service.readQuest("river-ghosts").state, "pending_review");
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM creator_xp_commitments").get().n,
    0,
  );
  f.db.prepare("UPDATE players SET xp=200 WHERE id=?").run(f.author);
  assert.equal(f.service.review(input).progression.availableXp, 0);
});

test("stale author/moderator requests cannot publish or overwrite another revision", (t) => {
  const f = fixture(t);
  f.call("createDraft");
  f.call("revise");
  rejectsCode(() => f.call("submit", { expectedVersion: 1 }), "CREATOR_STALE");
  f.call("submit");
  rejectsCode(() => f.call("review", { expectedVersion: 2 }), "CREATOR_STALE");
  assert.equal(f.service.progression(f.author).lockedXp, 0);
});

test("server authority is required; author and participant cannot self-approve or resolve", (t) => {
  const f = fixture(t);
  f.call("createDraft");
  f.call("submit");
  for (const actor of [f.author, f.walker, "unknown"])
    rejectsCode(() => f.call("review", { actor }), "CREATOR_FORBIDDEN");
  rejectsCode(() => f.call("close", { actor: f.walker }), "CREATOR_FORBIDDEN");
  f.call("review");
  f.call("start");
  for (const actor of [f.author, f.walker, "unknown"])
    rejectsCode(() => f.call("resolve", { actor }), "CREATOR_FORBIDDEN");
  rejectsCode(() => f.call("start", { actor: f.author }), "CREATOR_FORBIDDEN");
  const untrusted = createCreatorLifecycle(f.db, {
    ...f.options,
    isCompletionAuthority: async () => true,
  });
  rejectsCode(
    () =>
      untrusted.resolve({
        actor: "async-authority",
        operationId: f.op(),
        questId: "river-ghosts",
        participant: f.walker,
        resolutionReference: "receipt",
      }),
    "CREATOR_FORBIDDEN",
  );
});

test("closing a pending draft prevents delayed approval without any XP release", (t) => {
  const f = fixture(t);
  f.call("createDraft");
  f.call("submit");
  assert.equal(f.call("close").quest.state, "closed");
  rejectsCode(() => f.call("review"), "CREATOR_CONFLICT");
  assert.equal(f.service.progression(f.author).lockedXp, 0);
});

test("closing withdraws a pending edit but still permits old participation settlement", (t) => {
  const f = fixture(t);
  f.publish();
  f.call("start");
  f.call("revise");
  f.call("submit");
  f.call("close");
  assert.equal(f.service.readQuest("river-ghosts").latest.state, "withdrawn");
  rejectsCode(() => f.call("review"), "CREATOR_CONFLICT");
  f.call("resolve");
  f.call("finalize");
  assert.equal(f.service.readQuest("river-ghosts").published_revision, 1);
});

test("injected receipt-storage failure rolls publication and its XP lock back together", (t) => {
  const f = fixture(t);
  f.call("createDraft");
  f.call("submit");
  f.db
    .exec(`CREATE TRIGGER fail_creator_receipt BEFORE INSERT ON creator_operations
    WHEN NEW.command='review' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END`);
  assert.throws(() => f.call("review"), /injected receipt failure/);
  assert.equal(f.service.readQuest("river-ghosts").state, "pending_review");
  assert.equal(f.service.progression(f.author).lockedXp, 0);
  f.db.exec("DROP TRIGGER fail_creator_receipt");
  f.call("review");
  f.call("close");
  f.db
    .exec(`CREATE TRIGGER fail_creator_release BEFORE INSERT ON creator_operations
    WHEN NEW.command='finalize' BEGIN SELECT RAISE(ABORT,'injected release failure'); END`);
  assert.throws(() => f.call("finalize"), /injected release failure/);
  assert.equal(f.service.readQuest("river-ghosts").state, "closing");
  assert.equal(f.service.progression(f.author).lockedXp, 200);
  f.db.exec("DROP TRIGGER fail_creator_release");
  f.call("finalize");
  assert.equal(f.service.progression(f.author).lockedXp, 0);
});

test("malformed values, floating XP and unsupported payment/reward fields fail closed", (t) => {
  const f = fixture(t);
  for (const policy of [
    { version: "v", xpCommitment: 0 },
    { version: "v", xpCommitment: 1.5 },
    { version: "v", xpCommitment: Number.MAX_SAFE_INTEGER + 1 },
  ])
    rejectsCode(
      () => createCreatorLifecycle(f.db, { policy }),
      "CREATOR_INPUT",
    );
  for (const draft of [
    { ...DRAFT, rewardXp: 9000 },
    { ...DRAFT, price: 100 },
    { title: "", description: "x" },
    { title: "x".repeat(101), description: "x" },
  ])
    rejectsCode(() => f.call("createDraft", { draft }), "CREATOR_INPUT");
  rejectsCode(
    () => f.call("createDraft", { questId: "../escape" }),
    "CREATOR_INPUT",
  );
  f.db.prepare("UPDATE players SET xp=0.5 WHERE id=?").run(f.author);
  rejectsCode(() => f.call("createDraft"), "CREATOR_INPUT");
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM creator_quests").get().n,
    0,
  );
});

test("reconciliation errors cannot be hidden by negative available XP", (t) => {
  const f = fixture(t);
  f.publish();
  f.db.prepare("UPDATE players SET xp=1 WHERE id=?").run(f.author);
  rejectsCode(() => f.service.progression(f.author), "CREATOR_XP_INVARIANT");
});

test("restart replays durable receipts and daily world deletion preserves creator rights", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-creator-restart-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = fixture(t, { path: join(dir, "state.sqlite") });
  f.publish();
  const input = {
    actor: f.walker,
    operationId: "durable-start",
    questId: "river-ghosts",
  };
  const receipt = f.service.start(input);
  f.db
    .prepare("INSERT INTO worlds VALUES (?,?,?,?,?,?)")
    .run(
      "daily-system-world",
      "2026-10-31",
      "plzen",
      "Europe/Prague",
      "{}",
      NOW,
    );
  f.db.exec("DELETE FROM worlds");
  f.db.close();
  const reopened = openDatabase(join(dir, "state.sqlite"));
  try {
    const service = createCreatorLifecycle(reopened, f.options);
    assert.deepEqual(service.start(input), receipt);
    assert.equal(service.progression(f.author).lockedXp, 200);
    assert.equal(service.participation("river-ghosts", f.walker).revision, 1);
  } finally {
    reopened.close();
  }
});

async function race(path, commands) {
  const workers = commands.map(
    (command) =>
      new Worker(
        `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { DatabaseSync } = require('node:sqlite');
      const { createCreatorLifecycle } = await import(workerData.module);
      const db = new DatabaseSync(workerData.path);
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const service = createCreatorLifecycle(db, {
        policy: workerData.policy, isModerator: (id) => id === 'reviewer',
        clock: () => workerData.now
      });
      parentPort.once('message', () => {
        try { parentPort.postMessage({ result: service[workerData.command.name](workerData.command.input) }); }
        catch (e) { parentPort.postMessage({ error: e.code ?? e.message }); }
        finally { db.close(); parentPort.close(); }
      });
      parentPort.postMessage('ready');
    })().catch((e) => { throw e; });
  `,
        {
          eval: true,
          workerData: {
            module: new URL("../server/creators/lifecycle.mjs", import.meta.url)
              .href,
            path,
            policy: POLICY,
            now: NOW,
            command,
          },
        },
      ),
  );
  try {
    await Promise.all(
      workers.map(
        (w) =>
          new Promise((resolve, reject) => {
            w.once("message", resolve);
            w.once("error", reject);
          }),
      ),
    );
    const results = workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.once("message", resolve);
          w.once("error", reject);
        }),
    );
    workers.forEach((w) => w.postMessage("go"));
    return await Promise.all(results);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

test(
  "two real SQLite connections cannot overcommit one author's XP",
  { timeout: 15000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "questlayer-creator-race-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "state.sqlite");
    const f = fixture(t, { path, xp: 300 });
    for (const questId of ["one", "two"]) {
      f.call("createDraft", { questId });
      f.call("submit", { questId });
    }
    const results = await race(
      path,
      ["one", "two"].map((questId) => ({
        name: "review",
        input: {
          actor: "reviewer",
          operationId: `race-${questId}`,
          questId,
          expectedVersion: 2,
          decision: "approve",
          reason: "Reviewed.",
        },
      })),
    );
    assert.equal(results.filter((r) => r.result).length, 1);
    assert.equal(
      results.filter((r) => r.error === "CREATOR_INSUFFICIENT_XP").length,
      1,
    );
    assert.equal(f.service.progression(f.author).lockedXp, 200);
  },
);

test(
  "start versus cancellation race either preserves the admitted player or rejects the start",
  { timeout: 15000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "questlayer-creator-close-race-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "state.sqlite");
    const f = fixture(t, { path });
    f.publish();
    const results = await race(path, [
      {
        name: "start",
        input: {
          actor: f.walker,
          operationId: "race-start",
          questId: "river-ghosts",
        },
      },
      {
        name: "close",
        input: {
          actor: f.author,
          operationId: "race-close",
          questId: "river-ghosts",
          expectedVersion: 3,
        },
      },
    ]);
    assert.ok(results[1].result);
    const admitted = !!results[0].result;
    assert.equal(f.service.readQuest("river-ghosts").state, "closing");
    assert.equal(
      f.service.readQuest("river-ghosts").openParticipations,
      admitted ? 1 : 0,
    );
    if (admitted)
      rejectsCode(() => f.call("finalize"), "CREATOR_OBLIGATIONS_OPEN");
    else {
      assert.equal(results[0].error, "CREATOR_CONFLICT");
      f.call("finalize");
    }
  },
);

test("releasing one of several commitments cannot release another quest's XP", (t) => {
  const f = fixture(t);
  f.publish("one");
  f.publish("two");
  assert.equal(f.service.progression(f.author).lockedXp, 400);
  f.call("close", { questId: "one" });
  f.call("finalize", { questId: "one" });
  assert.equal(f.service.progression(f.author).lockedXp, 200);
  assert.equal(f.service.readQuest("two").commitment.released_at, null);
  assert.equal(f.service.readQuest("two").state, "published");
});

test("a new policy affects new submissions while the existing quote is immutable", (t) => {
  const f = fixture(t);
  const next = createCreatorLifecycle(f.db, {
    ...f.options,
    policy: { version: "test-only-300xp", xpCommitment: 300 },
  });
  f.call("createDraft");
  next.submit({
    actor: f.author,
    operationId: f.op(),
    questId: "river-ghosts",
    expectedVersion: 1,
    expectedPolicyVersion: "test-only-300xp",
  });
  const receipt = next.review({
    actor: "reviewer",
    operationId: f.op(),
    questId: "river-ghosts",
    expectedVersion: 2,
    decision: "approve",
    reason: "Reviewed.",
  });
  assert.equal(receipt.progression.lockedXp, 300);
});

test("resolution is durable and deduplicated; edited quests cannot reopen eligibility", (t) => {
  const f = fixture(t);
  f.publish();
  f.call("start");
  const input = {
    actor: "validator",
    operationId: "resolve-once",
    questId: "river-ghosts",
    participant: f.walker,
    resolutionReference: "receipt-original",
  };
  const receipt = f.service.resolve(input);
  assert.deepEqual(f.service.resolve(input), receipt);
  rejectsCode(
    () => f.service.resolve({ ...input, resolutionReference: "other-receipt" }),
    "CREATOR_OPERATION_REUSED",
  );
  f.call("revise");
  f.call("submit");
  f.call("review");
  rejectsCode(() => f.call("start"), "CREATOR_ALREADY_STARTED");
  assert.equal(f.service.participation("river-ghosts", f.walker).revision, 1);
});

test(
  "simultaneous identical approvals recover one durable receipt and one XP lock",
  { timeout: 15000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "questlayer-creator-replay-race-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "state.sqlite");
    const f = fixture(t, { path });
    f.call("createDraft");
    f.call("submit");
    const command = {
      name: "review",
      input: {
        actor: "reviewer",
        operationId: "same-review",
        questId: "river-ghosts",
        expectedVersion: 2,
        decision: "approve",
        reason: "Reviewed.",
      },
    };
    const results = await race(path, [command, command]);
    assert.ok(results.every((r) => r.result));
    assert.deepEqual(results[0].result, results[1].result);
    assert.equal(f.service.progression(f.author).lockedXp, 200);
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM creator_xp_commitments").get().n,
      1,
    );
  },
);

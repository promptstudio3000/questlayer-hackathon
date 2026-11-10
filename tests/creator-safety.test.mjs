import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import {
  openDatabase,
  createPlayer,
  demoProgression,
} from "../server/database.mjs";
import { SocialContent } from "../server/social-content.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import { createCreatorLifecycle } from "../server/creators/lifecycle.mjs";
import { createCreatorCommunity } from "../server/creators/community.mjs";
import { createCreatorRuntime } from "../server/creators/runtime.mjs";
import { createNodeCreatorHandler } from "../server/creators/node-handler.mjs";
import { creatorAudit, creatorOperator } from "../server/creators/operator.mjs";

const NOW = Date.parse("2026-10-31T18:00:00Z");
const POLICY = { version: "qa-only-safety-v1", xpCommitment: 200 };
const DRAFT = {
  title: "Reviewed public path",
  description: "Observe the public park entrance without leaving the footpath.",
};
const plain = (v) => JSON.parse(JSON.stringify(v));
const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code);
function rows(db, names) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      plain(db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()),
    ]),
  );
}
function snapshot(db) {
  return rows(
    db,
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name),
  );
}
function fixture(t, { path = ":memory:", old = false } = {}) {
  const db = openDatabase(path);
  t.after(() => {
    if (db.isOpen) db.close();
  });
  let now = NOW,
    n = 0;
  const author = createPlayer(db, "Private author", NOW),
    walker = createPlayer(db, "Private walker", NOW),
    stranger = createPlayer(db, "Secret stranger", NOW);
  db.prepare("UPDATE players SET xp=100000 WHERE id=?").run(author);
  const roles = new Set(["reviewer", "second-reviewer"]);
  const options = {
    policy: POLICY,
    isModerator: (a) => roles.has(a),
    isCompletionAuthority: (a) => a === "validator",
    clock: () => now,
  };
  const social = new SocialContent(db, { clock: () => now });
  const services = old
    ? {
        lifecycle: createCreatorLifecycle(db, options),
        community: createCreatorCommunity(db, options),
      }
    : createCreatorServices(db, options);
  const { lifecycle: l, community: c, safety: s } = services;
  const op = () => `safety-${++n}`;
  const profile = (actor, visible = true, expectedVersion = 0) =>
    c.saveProfile({
      actor,
      operationId: op(),
      expectedVersion,
      profile: {
        displayName: actor === author ? "Riverkeeper" : "Public walker",
        bio: "Public creator bio.",
        public: visible,
      },
      publicConsent: visible,
    });
  profile(author);
  profile(walker);
  const draft = (questId = "park") =>
    l.createDraft({ actor: author, operationId: op(), questId, draft: DRAFT });
  function publish(questId = "park") {
    draft(questId);
    l.submit({
      actor: author,
      operationId: op(),
      questId,
      expectedVersion: 1,
      expectedPolicyVersion: POLICY.version,
    });
    return l.review({
      actor: "reviewer",
      operationId: op(),
      questId,
      expectedVersion: 2,
      decision: "approve",
      reason: "QA fixture review.",
    });
  }
  const report = (patch = {}) =>
    s.report({
      actor: walker,
      operationId: op(),
      questId: "park",
      revision: 1,
      reason: "unsafe-place",
      detail: "The described entrance needs a safety check.",
      ...patch,
    });
  const block = (actor = walker, creatorId = author, blocked = true) =>
    s.setBlocked({ actor, operationId: op(), creatorId, blocked });
  const suspend = (patch = {}) =>
    creatorOperator(services, "suspend", {
      actor: "reviewer",
      operationId: op(),
      questId: "park",
      expectedVersion: l.readQuest("park").version,
      reason: "QA safety stop; retain admitted rights.",
      ...patch,
    });
  return {
    db,
    path,
    author,
    walker,
    stranger,
    services,
    l,
    c,
    s,
    social,
    options,
    roles,
    op,
    profile,
    draft,
    publish,
    report,
    block,
    suspend,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("creator blocks share bilateral visibility/admission rules while retaining accepted instructions and follows", (t) => {
  const f = fixture(t);
  f.publish();
  f.c.setFollowing({
    actor: f.walker,
    operationId: f.op(),
    creatorId: f.author,
    following: true,
  });
  f.l.start({ actor: f.walker, operationId: f.op(), questId: "park" });
  assert.deepEqual(f.c.myParticipation(f.walker, "park").creator, {
    id: f.author,
    displayName: "Riverkeeper",
  });
  const backing = rows(f.db, [
    "players",
    "inventory",
    "history",
    "treasury",
    "native_awards",
  ]);
  const receipt = f.block();
  assert.equal(receipt.command, "setCreatorBlocked");
  assert.equal(
    f.c.listQuests(f.walker, { followingOnly: true }).items.length,
    0,
  );
  rejects(() => f.c.profile(f.walker, f.author), "CREATOR_NOT_FOUND");
  rejects(() => f.c.profile(f.author, f.walker), "CREATOR_NOT_FOUND");
  assert.equal(f.c.myParticipation(f.walker, "park").revision, 1);
  assert.deepEqual(f.c.myParticipation(f.walker, "park").creator, {
    id: f.author,
    displayName: null,
  });
  assert.deepEqual(f.c.myParticipations(f.walker).items[0].creator, {
    id: f.author,
    displayName: null,
  });
  assert.deepEqual(plain(f.s.myBlocks(f.walker).items), [
    { id: f.author, displayName: "Riverkeeper" },
  ]);
  assert.equal(f.s.myBlocks(f.author).items.length, 0);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM creator_follows").get().n,
    1,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT count(*) n FROM social_audit WHERE action='player-blocked'",
      )
      .get().n,
    1,
  );
  f.block(f.walker, f.author, false);
  assert.equal(
    f.c.listQuests(f.walker, { followingOnly: true }).items.length,
    1,
  );
  f.block(f.author, f.walker, true);
  rejects(
    () => f.l.start({ actor: f.walker, operationId: f.op(), questId: "park" }),
    "CREATOR_NOT_FOUND",
  );
  f.block(f.walker, f.author, true); // Accepted rights permit an owned reverse block.
  assert.equal(f.s.myBlocks(f.walker).items[0].displayName, null);
  f.block(f.walker, f.author, false);
  rejects(() => f.c.profile(f.walker, f.author), "CREATOR_NOT_FOUND");
  assert.equal(
    f.c.myParticipation(f.walker, "park").content.description,
    DRAFT.description,
  );
  assert.deepEqual(rows(f.db, Object.keys(backing)), backing);
});

test("owned block pagination never borrows private names and unblock remains available after hiding", (t) => {
  const f = fixture(t);
  f.block();
  f.profile(f.author, false, 1);
  assert.equal(f.s.myBlocks(f.walker).items[0].displayName, null);
  assert(!JSON.stringify(f.s.myBlocks(f.walker)).includes("Private author"));
  rejects(() => f.block(f.walker, f.walker), "CREATOR_INPUT");
  rejects(() => f.block(f.walker, f.stranger), "CREATOR_NOT_FOUND");
  rejects(() => f.block(f.walker, "unknown-player"), "CREATOR_NOT_FOUND");
  assert.equal(f.block(f.walker, "unknown-player", false).blocked, false);
  assert.equal(f.block(f.walker, f.author, false).blocked, false);
  f.profile(f.author, true, 2);
  f.block();
  const other = createPlayer(f.db, "Never expose this account name", NOW);
  f.profile(other);
  f.block(f.walker, other);
  const first = f.s.myBlocks(f.walker, { limit: 1 });
  assert.equal(first.items.length, 1);
  assert(first.nextCursor);
  const second = f.s.myBlocks(f.walker, { limit: 1, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  assert.notEqual(first.items[0].id, second.items[0].id);
  rejects(() => f.s.myBlocks(f.walker, { limit: 51 }), "CREATOR_INPUT");
  assert.equal(f.s.myBlocks(f.stranger).items.length, 0);
});

test("report admission binds only the currently visible approved or own accepted immutable revision", (t) => {
  const f = fixture(t);
  f.publish();
  f.l.start({ actor: f.walker, operationId: f.op(), questId: "park" });
  f.l.revise({
    actor: f.author,
    operationId: f.op(),
    questId: "park",
    expectedVersion: 3,
    draft: { title: "Unapproved secret", description: "Must not be probed." },
  });
  rejects(
    () => f.report({ actor: f.stranger, revision: 2 }),
    "CREATOR_NOT_FOUND",
  );
  rejects(
    () => f.report({ actor: f.author, revision: 2 }),
    "CREATOR_NOT_FOUND",
  );
  f.l.submit({
    actor: f.author,
    operationId: f.op(),
    questId: "park",
    expectedVersion: 4,
    expectedPolicyVersion: POLICY.version,
  });
  f.l.review({
    actor: "reviewer",
    operationId: f.op(),
    questId: "park",
    expectedVersion: 5,
    decision: "approve",
    reason: "Reviewed revision two.",
  });
  rejects(
    () => f.report({ actor: f.stranger, revision: 1 }),
    "CREATOR_NOT_FOUND",
  );
  assert.equal(
    f.report({ actor: f.stranger, revision: 2, reason: "other", detail: "" })
      .report.revision,
    2,
  );
  f.draft("private-quest");
  rejects(
    () => f.report({ actor: f.stranger, questId: "private-quest" }),
    "CREATOR_NOT_FOUND",
  );
  rejects(
    () => f.report({ actor: f.stranger, questId: "nonexistent-quest" }),
    "CREATOR_NOT_FOUND",
  );
  f.profile(f.author, false, 1);
  f.block();
  f.suspend();
  const receipt = f.report();
  assert.equal(receipt.report.revision, 1);
  assert.equal(receipt.report.status, "open");
  assert.deepEqual(Object.keys(receipt.report).sort(), [
    "questId",
    "reason",
    "reportedAt",
    "revision",
    "status",
  ]);
  assert(!JSON.stringify(receipt).includes("The described entrance"));
  assert.equal(
    f.c.myParticipation(f.walker, "park").content.title,
    DRAFT.title,
  );
  rejects(() => f.report({ actor: f.stranger }), "CREATOR_NOT_FOUND");
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM creator_reports").get().n,
    2,
  );
});

test("reports use one actor-scoped durable identity and duplicate new intents cannot flood the queue", (t) => {
  const f = fixture(t);
  f.publish();
  const input = {
    actor: f.walker,
    operationId: "unknown-outcome",
    questId: "park",
    revision: 1,
    reason: "abuse",
    detail: "Private report detail.",
  };
  const receipt = f.s.report(input),
    before = snapshot(f.db);
  assert.deepEqual(f.s.report(input), receipt);
  assert.deepEqual(snapshot(f.db), before);
  rejects(
    () => f.s.report({ ...input, detail: "Different terms." }),
    "CREATOR_OPERATION_REUSED",
  );
  rejects(
    () => f.s.report({ ...input, operationId: "new-report" }),
    "CREATOR_ALREADY_REPORTED",
  );
  rejects(
    () =>
      f.s.setBlocked({
        actor: f.walker,
        operationId: input.operationId,
        creatorId: f.author,
        blocked: true,
      }),
    "CREATOR_OPERATION_REUSED",
  );
  assert.deepEqual(snapshot(f.db), before);
  const audit = creatorAudit(f.db);
  assert.equal(audit.openReports.length, 1);
  assert.equal(audit.openReports[0].detail, input.detail);
  assert.equal(audit.openReports[0].reporter, f.walker);
  assert.deepEqual(audit.openReports[0].content, DRAFT);
  assert(!JSON.stringify(f.c.listQuests(f.stranger)).includes(input.detail));
  assert(!JSON.stringify(f.c.myCreations(f.author)).includes(input.detail));
  for (const bad of [
    { reason: "spam" },
    { detail: "x".repeat(1001) },
    { revision: 0 },
    { detail: "\u0000" },
  ])
    rejects(() => f.report(bad), "CREATOR_INPUT");
});

test("operator report review is independent, versioned, receipt-safe and does not automatically stop or release", (t) => {
  const f = fixture(t);
  f.publish();
  f.report();
  const queued = creatorAudit(f.db).openReports[0];
  const input = {
    actor: "second-reviewer",
    operationId: "review-report",
    reportId: queued.id,
    expectedVersion: 1,
    decision: "confirmed",
    reason: "Review confirms the safety concern.",
  };
  f.roles.add(f.author);
  f.roles.add(f.walker);
  rejects(
    () =>
      creatorOperator(f.services, "review-report", {
        ...input,
        actor: f.author,
      }),
    "CREATOR_FORBIDDEN",
  );
  rejects(
    () =>
      creatorOperator(f.services, "review-report", {
        ...input,
        actor: f.walker,
      }),
    "CREATOR_FORBIDDEN",
  );
  rejects(
    () =>
      creatorOperator(f.services, "review-report", {
        ...input,
        actor: f.stranger,
      }),
    "CREATOR_FORBIDDEN",
  );
  rejects(
    () =>
      creatorOperator(f.services, "review-report", {
        ...input,
        expectedVersion: 2,
      }),
    "CREATOR_STALE",
  );
  const receipt = creatorOperator(f.services, "review-report", input);
  assert.equal(receipt.report.status, "reviewed");
  assert.equal(f.l.readQuest("park").state, "published");
  assert.equal(f.l.progression(f.author).lockedXp, 200);
  const before = snapshot(f.db);
  assert.deepEqual(
    creatorOperator(f.services, "review-report", input),
    receipt,
  );
  assert.deepEqual(snapshot(f.db), before);
  assert.equal(creatorAudit(f.db).openReports.length, 0);
  assert.equal(creatorAudit(f.db).safetyActions.length, 1);
  rejects(
    () =>
      creatorOperator(f.services, "review-report", {
        ...input,
        operationId: "second-review",
      }),
    "CREATOR_STALE",
  );
});

test("unsafe-publication suspension withdraws pending edits but preserves admitted content, locks and exact release obligations", (t) => {
  const f = fixture(t);
  f.publish();
  f.publish("unrelated");
  f.l.start({ actor: f.walker, operationId: f.op(), questId: "park" });
  f.l.revise({
    actor: f.author,
    operationId: f.op(),
    questId: "park",
    expectedVersion: 3,
    draft: { title: "Private pending edit", description: "Do not leak this." },
  });
  f.l.submit({
    actor: f.author,
    operationId: f.op(),
    questId: "park",
    expectedVersion: 4,
    expectedPolicyVersion: POLICY.version,
  });
  const backing = rows(f.db, [
    "players",
    "inventory",
    "history",
    "treasury",
    "treasury_events",
    "native_awards",
  ]);
  f.roles.add(f.author);
  rejects(() => f.suspend({ actor: f.author }), "CREATOR_FORBIDDEN");
  rejects(() => f.suspend({ expectedVersion: 4 }), "CREATOR_STALE");
  const receipt = f.suspend({ operationId: "suspend-safety" }),
    q = f.l.readQuest("park");
  assert.equal(receipt.suspension.previousVersion, 5);
  assert.equal(q.state, "closing");
  assert.equal(q.version, 6);
  assert.equal(q.latest.state, "withdrawn");
  assert.equal(q.published.revision, 1);
  assert.equal(q.openParticipations, 1);
  assert.equal(f.l.progression(f.author).lockedXp, 400);
  assert.equal(
    f.c.myParticipation(f.walker, "park").content.title,
    DRAFT.title,
  );
  assert.deepEqual(
    f.c.listQuests(f.stranger).items.map((q) => q.id),
    ["unrelated"],
  );
  for (const action of [
    () =>
      f.l.revise({
        actor: f.author,
        operationId: f.op(),
        questId: "park",
        expectedVersion: 6,
        draft: DRAFT,
      }),
    () =>
      f.l.submit({
        actor: f.author,
        operationId: f.op(),
        questId: "park",
        expectedVersion: 6,
        expectedPolicyVersion: POLICY.version,
      }),
    () =>
      f.l.review({
        actor: "reviewer",
        operationId: f.op(),
        questId: "park",
        expectedVersion: 6,
        decision: "approve",
        reason: "Cannot bypass.",
      }),
    () =>
      f.l.start({ actor: f.stranger, operationId: f.op(), questId: "park" }),
  ])
    rejects(action, "CREATOR_CONFLICT");
  rejects(
    () =>
      f.l.finalize({
        actor: f.author,
        operationId: f.op(),
        questId: "park",
        expectedVersion: 6,
      }),
    "CREATOR_OBLIGATIONS_OPEN",
  );
  assert.deepEqual(rows(f.db, Object.keys(backing)), backing);
  const audit = creatorAudit(f.db);
  assert.equal(
    audit.safetyActions[0].receipt.suspension.reason,
    receipt.suspension.reason,
  );
  f.l.resolve({
    actor: "validator",
    operationId: f.op(),
    questId: "park",
    participant: f.walker,
    resolutionReference: "qa-actual-independent-review",
  });
  f.l.finalize({
    actor: f.author,
    operationId: f.op(),
    questId: "park",
    expectedVersion: 6,
  });
  const after = snapshot(f.db);
  assert.deepEqual(
    f.l.suspend({
      actor: "reviewer",
      operationId: "suspend-safety",
      questId: "park",
      expectedVersion: 5,
      reason: "QA safety stop; retain admitted rights.",
    }),
    receipt,
  );
  assert.deepEqual(snapshot(f.db), after);
  assert.equal(f.l.progression(f.author).lockedXp, 200);
  assert.deepEqual(rows(f.db, Object.keys(backing)), backing);
});

test("suspending an unpublished review closes it without allocating or releasing any XP", (t) => {
  const f = fixture(t);
  f.draft();
  f.l.submit({
    actor: f.author,
    operationId: f.op(),
    questId: "park",
    expectedVersion: 1,
    expectedPolicyVersion: POLICY.version,
  });
  const before = rows(f.db, [
    "players",
    "inventory",
    "history",
    "treasury",
    "native_awards",
  ]);
  f.suspend();
  assert.equal(f.l.readQuest("park").state, "closed");
  assert.equal(f.l.readQuest("park").latest.state, "withdrawn");
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM creator_xp_commitments").get().n,
    0,
  );
  rejects(
    () =>
      f.l.review({
        actor: "reviewer",
        operationId: f.op(),
        questId: "park",
        expectedVersion: 3,
        decision: "approve",
        reason: "Stale candidate.",
      }),
    "CREATOR_CONFLICT",
  );
  rejects(
    () =>
      f.l.finalize({
        actor: f.author,
        operationId: f.op(),
        questId: "park",
        expectedVersion: 3,
      }),
    "CREATOR_CONFLICT",
  );
  assert.deepEqual(rows(f.db, Object.keys(before)), before);
});

test("report writes are daily bounded while duplicate receipt recovery stays available", (t) => {
  const f = fixture(t);
  const receipts = [];
  for (let i = 0; i < 21; i++) {
    const questId = `quest-${i}`;
    f.publish(questId);
    if (i < 20)
      receipts.push(f.report({ questId, operationId: `report-${i}` }));
  }
  rejects(() => f.report({ questId: "quest-20" }), "CREATOR_RATE_LIMIT");
  assert.deepEqual(
    f.report({ questId: "quest-0", operationId: "report-0" }),
    receipts[0],
  );
  assert.equal(creatorAudit(f.db, { limit: 5 }).openReports.length, 5);
  f.advance(86400001);
  f.report({ questId: "quest-20" });
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM creator_reports").get().n,
    21,
  );
});

test("creator and existing social block paths respect common change caps and bounded owned lists", (t) => {
  const f = fixture(t);
  const first = f.block();
  for (let i = 0; i < 99; i++) f.block(f.walker, "nonexistent-unblock", false);
  rejects(() => f.block(f.walker, f.author, false), "CREATOR_RATE_LIMIT");
  assert.deepEqual(
    f.s.setBlocked({
      actor: f.walker,
      operationId: first.operationId,
      creatorId: f.author,
      blocked: true,
    }),
    first,
  );
  f.advance(3600001);
  f.block(f.walker, f.author, false);
  for (let i = 0; i < 99; i++)
    f.social.setBlock(f.walker, f.author, i % 2 === 0);
  rejects(() => f.block(f.walker, f.author, false), "CREATOR_RATE_LIMIT");
  f.advance(3600001);
  f.block(f.walker, f.author, false);
  for (let i = 0; i < 200; i++) {
    const target = createPlayer(f.db, `Private ${i}`, NOW);
    f.db
      .prepare("INSERT INTO social_blocks VALUES(?,?,?)")
      .run(f.walker, target, NOW);
  }
  rejects(() => f.block(), "CREATOR_BLOCK_LIMIT");
  assert.equal(f.s.myBlocks(f.walker, { limit: 50 }).items.length, 50);
});

test("receipt storage failure rolls back report, shared block audit, suspension and report review together", (t) => {
  const f = fixture(t);
  f.publish();
  f.db.exec(
    "CREATE TEMP TRIGGER fail_safety_receipt BEFORE INSERT ON creator_operations WHEN NEW.operation_id='fail-receipt' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;",
  );
  for (const action of [
    () => f.report({ operationId: "fail-receipt" }),
    () =>
      f.s.setBlocked({
        actor: f.walker,
        operationId: "fail-receipt",
        creatorId: f.author,
        blocked: true,
      }),
    () => f.suspend({ operationId: "fail-receipt" }),
  ]) {
    const before = snapshot(f.db);
    assert.throws(action);
    assert.deepEqual(snapshot(f.db), before);
  }
  f.report();
  const report = creatorAudit(f.db).openReports[0],
    before = snapshot(f.db);
  assert.throws(() =>
    creatorOperator(f.services, "review-report", {
      actor: "second-reviewer",
      operationId: "fail-receipt",
      reportId: report.id,
      expectedVersion: 1,
      decision: "dismissed",
      reason: "Test rollback.",
    }),
  );
  assert.deepEqual(snapshot(f.db), before);
});

async function race(path, commands) {
  const workers = commands.map(
    (command) =>
      new Worker(
        `const {parentPort,workerData}=require('node:worker_threads'); (async()=>{
 const {DatabaseSync}=require('node:sqlite'); const {createCreatorServices}=await import(workerData.module);
 const db=new DatabaseSync(workerData.path);db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;');
 const s=createCreatorServices(db,{policy:workerData.policy,isModerator:a=>a==='reviewer',clock:()=>workerData.now});
 parentPort.once('message',()=>{try{parentPort.postMessage({result:s[workerData.command.service][workerData.command.method](workerData.command.input)});}catch(e){parentPort.postMessage({error:e.code||e.message});}finally{db.close();parentPort.close();}});parentPort.postMessage('ready');})().catch(e=>{throw e});`,
        {
          eval: true,
          workerData: {
            path,
            policy: POLICY,
            now: NOW,
            module: new URL("../server/creators/services.mjs", import.meta.url)
              .href,
            command,
          },
        },
      ),
  );
  try {
    await Promise.all(
      workers.map(
        (w) =>
          new Promise((ok, fail) => {
            w.once("message", ok);
            w.once("error", fail);
          }),
      ),
    );
    const pending = workers.map(
      (w) =>
        new Promise((ok, fail) => {
          w.once("message", ok);
          w.once("error", fail);
        }),
    );
    workers.forEach((w) => w.postMessage("go"));
    return await Promise.all(pending);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}
for (const mode of ["block", "suspend"])
  test(`real SQLite start versus ${mode} race either rejects admission or preserves its accepted rights`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "questlayer-safety-race-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const f = fixture(t, { path: join(dir, "state.sqlite") });
    f.publish();
    const guard =
      mode === "block"
        ? {
            service: "safety",
            method: "setBlocked",
            input: {
              actor: f.author,
              operationId: "race-block",
              creatorId: f.walker,
              blocked: true,
            },
          }
        : {
            service: "lifecycle",
            method: "suspend",
            input: {
              actor: "reviewer",
              operationId: "race-suspend",
              questId: "park",
              expectedVersion: 3,
              reason: "QA safety race stop.",
            },
          };
    const result = await race(f.path, [
      {
        service: "lifecycle",
        method: "start",
        input: { actor: f.walker, operationId: "race-start", questId: "park" },
      },
      guard,
    ]);
    assert(result[1].result);
    const admitted = !!result[0].result;
    assert.equal(f.l.readQuest("park").openParticipations, admitted ? 1 : 0);
    if (admitted)
      assert.equal(f.c.myParticipation(f.walker, "park").revision, 1);
    else
      assert(
        ["CREATOR_NOT_FOUND", "CREATOR_CONFLICT"].includes(result[0].error),
      );
    assert.equal(f.l.progression(f.author).lockedXp, 200);
    rejects(
      () =>
        f.l.start({
          actor: f.walker,
          operationId: "late-start",
          questId: "park",
        }),
      mode === "block" ? "CREATOR_NOT_FOUND" : "CREATOR_CONFLICT",
    );
  });

test("actual HTTP safety routes enforce session/origin/input privacy and recover a deliberately lost report acknowledgement", async (t) => {
  const f = fixture(t);
  f.publish();
  let handler;
  const server = createServer(async (req, res) => {
    if (req.headers["x-drop-response"] === "1")
      res.end = () => {
        res.destroy();
        return res;
      };
    try {
      if (await handler(req, res)) return;
      res.writeHead(404);
      res.end();
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(done);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createNodeCreatorHandler({
    ...f.services,
    origin,
    enabled: true,
    authenticate: (req) =>
      req.headers.cookie === "session=walker"
        ? f.walker
        : req.headers.cookie === "session=author"
          ? f.author
          : null,
  });
  async function send(path, { method = "GET", body, headers = {} } = {}) {
    const r = await fetch(origin + "/api/creator-community" + path, {
      method,
      headers: {
        cookie: "session=walker",
        ...(body === undefined
          ? {}
          : { origin, "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, headers: r.headers, body: await r.json() };
  }
  assert.equal(
    (await send("/me/blocks", { headers: { cookie: "" } })).status,
    401,
  );
  assert.equal(
    (
      await send(`/creators/${f.author}/block`, {
        method: "PUT",
        body: { operationId: "wrong-origin", blocked: true },
        headers: { origin: "https://wrong.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send(`/creators/${f.author}/block`, {
        method: "PUT",
        body: { operationId: "spoof", blocked: true, actor: f.author },
      })
    ).status,
    400,
  );
  assert.equal((await send("/me/blocks?actor=someone")).status, 400);
  const input = {
    operationId: "lost-report-http",
    revision: 1,
    reason: "misleading",
    detail: "Private HTTP report detail.",
  };
  assert.equal(
    (
      await send("/quests/park/reports", {
        method: "POST",
        body: input,
        headers: { cookie: "" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await send("/quests/park/reports", {
        method: "POST",
        body: input,
        headers: { origin: "" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send("/quests/park/reports", {
        method: "POST",
        body: { ...input, reporter: f.author },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await send("/quests/park/reports", {
        method: "POST",
        body: { ...input, revision: 99 },
      })
    ).status,
    404,
  );
  await assert.rejects(
    send("/quests/park/reports", {
      method: "POST",
      body: input,
      headers: { "x-drop-response": "1" },
    }),
  );
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM creator_reports").get().n,
    1,
  );
  const recovered = await send("/quests/park/reports", {
    method: "POST",
    body: input,
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.operationId, input.operationId);
  assert.match(recovered.headers.get("cache-control"), /no-store/);
  assert(!JSON.stringify(recovered.body).includes(input.detail));
  assert.deepEqual(
    (await send("/quests/park/reports", { method: "POST", body: input })).body,
    recovered.body,
  );
  assert.equal(
    (
      await send("/quests/park/reports", {
        method: "POST",
        body: { ...input, operationId: "new-http-report" },
      })
    ).status,
    409,
  );
  assert.equal((await send("/quests/park/reports")).status, 404);
  for (const path of [
    "/quests/park/suspend",
    "/quests/park/review-report",
    "/reports",
  ])
    assert.equal((await send(path, { method: "POST", body: {} })).status, 404);
  const blocked = await send(`/creators/${f.author}/block`, {
    method: "PUT",
    body: { operationId: "http-block", blocked: true },
  });
  assert.equal(blocked.status, 200);
  assert.equal((await send("/quests")).body.items.length, 0);
  assert.equal((await send("/me/blocks")).body.items.length, 1);
  assert.equal(
    (await send("/me/blocks", { headers: { cookie: "session=author" } })).body
      .items.length,
    0,
  );
  assert.equal(
    (
      await send(`/creators/${f.author}/block`, {
        method: "PUT",
        body: { operationId: "http-unblock", blocked: false },
      })
    ).status,
    200,
  );
  const disabled = createNodeCreatorHandler({
    ...f.services,
    origin,
    enabled: false,
    authenticate: () => f.walker,
  });
  handler = disabled;
  assert.equal((await send("/me/blocks")).status, 404);
  assert.equal(
    (await send("/quests/park/reports", { method: "POST", body: input }))
      .status,
    404,
  );
});

test("enabled-only additive safety initialization and private backup restore preserve old rows, reports, audit and locks", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-safety-restore-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const empty = openDatabase(join(dir, "disabled.sqlite"));
  createCreatorRuntime(empty, {
    env: {},
    origin: "http://localhost",
    authenticate: () => null,
  });
  assert.deepEqual(
    empty
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'creator_%'")
      .all(),
    [],
  );
  empty.close();
  const state = join(dir, "state");
  mkdirSync(state);
  const f = fixture(t, { path: join(state, "auratrail.sqlite"), old: true });
  f.publish();
  f.l.start({ actor: f.walker, operationId: f.op(), questId: "park" });
  const before = snapshot(f.db);
  assert.equal(creatorAudit(f.db).openReports.length, 0);
  const services = createCreatorServices(f.db, f.options);
  // Adopting explicit module versions intentionally appends metadata; existing
  // business rows must remain byte-for-byte equivalent as projected below.
  for (const [name, content] of Object.entries(before)) {
    if (name === "questlayer_schema_modules") continue;
    assert.deepEqual(
      plain(f.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()),
      content,
    );
  }
  assert.deepEqual(
    plain(
      f.db
        .prepare(
          "SELECT name,version FROM questlayer_schema_modules ORDER BY name",
        )
        .all(),
    ),
    [
      "core",
      "creator-community",
      "creator-completion",
      "creator-lifecycle",
      "creator-safety",
      "social-blocks",
      "social-content",
      "social-note-expiry",
    ].map((name) => ({ name, version: 1 })),
  );
  for (const row of f.db
    .prepare("SELECT fingerprint FROM questlayer_schema_modules")
    .all())
    assert.match(row.fingerprint, /^[a-f0-9]{64}$/);
  const reportInput = {
    actor: f.walker,
    operationId: "restored-report",
    questId: "park",
    revision: 1,
    reason: "unsafe-place",
    detail: "Private restoration report.",
  };
  const reportReceipt = services.safety.report(reportInput);
  const blockInput = {
    actor: f.walker,
    operationId: "restored-block",
    creatorId: f.author,
    blocked: true,
  };
  const blockReceipt = services.safety.setBlocked(blockInput);
  const suspendInput = {
    actor: "reviewer",
    operationId: "restored-suspend",
    questId: "park",
    expectedVersion: 3,
    reason: "QA safety stop retained on restore.",
  };
  const suspendReceipt = creatorOperator(services, "suspend", suspendInput);
  const queued = creatorAudit(f.db).openReports[0],
    reviewInput = {
      actor: "second-reviewer",
      operationId: "restored-review",
      reportId: queued.id,
      expectedVersion: 1,
      decision: "confirmed",
      reason: "Independent QA review.",
    };
  const reviewedReceipt = creatorOperator(
      services,
      "review-report",
      reviewInput,
    ),
    all = snapshot(f.db);
  const output = JSON.parse(
    execFileSync(
      "python3",
      [
        resolve("deploy/backup-state.py"),
        "--state",
        state,
        "--destination",
        join(dir, "backups"),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const restoredPath = join(dir, "restored.sqlite");
  copyFileSync(
    join(dir, "backups", output.snapshotId, "database.sqlite"),
    restoredPath,
  );
  const restored = openDatabase(restoredPath);
  t.after(() => restored.close());
  createCreatorRuntime(restored, {
    env: {},
    origin: "http://localhost",
    authenticate: () => null,
  });
  assert.deepEqual(snapshot(restored), all);
  const reopened = createCreatorServices(restored, f.options);
  assert.deepEqual(reopened.safety.report(reportInput), reportReceipt);
  assert.deepEqual(reopened.safety.setBlocked(blockInput), blockReceipt);
  assert.deepEqual(
    creatorOperator(reopened, "suspend", suspendInput),
    suspendReceipt,
  );
  assert.deepEqual(
    creatorOperator(reopened, "review-report", reviewInput),
    reviewedReceipt,
  );
  assert.deepEqual(snapshot(restored), all);
  assert.equal(demoProgression(restored, f.author).lockedXp, 200);
  assert.equal(
    reopened.community.myParticipation(f.walker, "park").revision,
    1,
  );
  assert.equal(reopened.lifecycle.readQuest("park").openParticipations, 1);
  rejects(
    () =>
      reopened.lifecycle.finalize({
        actor: f.author,
        operationId: "forbidden-release",
        questId: "park",
        expectedVersion: 4,
      }),
    "CREATOR_OBLIGATIONS_OPEN",
  );
  // Exercise both new commands through the actual local operator executable.
  const env = {
    ...process.env,
    CREATOR_COMMUNITY_ENABLED: "1",
    CREATOR_POLICY_VERSION: POLICY.version,
    CREATOR_XP_COMMITMENT: "200",
    CREATOR_MODERATORS: "reviewer,second-reviewer",
    CREATOR_COMPLETION_AUTHORITIES: "validator",
  };
  for (const [command, input, receipt] of [
    ["suspend", suspendInput, suspendReceipt],
    ["review-report", reviewInput, reviewedReceipt],
  ]) {
    const inputFile = join(dir, command + ".json");
    writeFileSync(inputFile, JSON.stringify(input), { mode: 0o600 });
    assert.deepEqual(
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            resolve("scripts/creator-operator.mjs"),
            command,
            "--database",
            restoredPath,
            "--input",
            inputFile,
          ],
          {
            cwd: dir,
            env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      ),
      receipt,
    );
  }
  assert.deepEqual(snapshot(restored), all);
});

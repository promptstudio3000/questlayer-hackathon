import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import { createCreatorApi } from "../server/creators/api.mjs";
import { createNodeCreatorHandler } from "../server/creators/node-handler.mjs";
import { creatorAudit, creatorOperator } from "../server/creators/operator.mjs";
import { createCreatorClient } from "../src/creator-community-client.ts";

const req = {
  template: "observation-v1",
  policyVersion: "creator-observation-v1",
  prompt:
    "Describe two contrasting shapes in the provided scene; no travel is required.",
};
function fixture(t, { path = ":memory:", structured = true } = {}) {
  const db = openDatabase(path);
  t.after(() => {
    if (db.isOpen) db.close();
  });
  const author = createPlayer(db, "Private author", Date.now()),
    walker = createPlayer(db, "Private walker", Date.now()),
    other = createPlayer(db, "Private other", Date.now());
  db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author);
  const options = {
    policy: { version: "test-only-completion-200", xpCommitment: 200 },
    isModerator: (a) => a === "moderator",
    isCompletionAuthority: (a) => ["validator", author, walker].includes(a),
  };
  const s = createCreatorServices(db, options);
  let n = 0;
  const op = () => `completion-test-${++n}`;
  s.community.saveProfile({
    actor: author,
    operationId: op(),
    expectedVersion: 0,
    profile: {
      displayName: "Scene keeper",
      bio: "Public observations",
      public: true,
    },
    publicConsent: true,
  });
  s.lifecycle.createDraft({
    actor: author,
    operationId: op(),
    questId: "scene",
    draft: {
      title: "Notice two shapes",
      description: "A solo observation from a described scene.",
      ...(structured ? { requirement: req } : {}),
    },
  });
  function approve(version = 1) {
    s.lifecycle.submit({
      actor: author,
      operationId: op(),
      questId: "scene",
      expectedVersion: version,
      expectedPolicyVersion: options.policy.version,
    });
    return s.lifecycle.review({
      actor: "moderator",
      operationId: op(),
      questId: "scene",
      expectedVersion: version + 1,
      decision: "approve",
      reason: "Reviewed declared requirement and operational policy.",
    });
  }
  approve();
  s.lifecycle.start({ actor: walker, operationId: op(), questId: "scene" });
  const submit = (patch = {}) =>
    s.completion.submit({
      actor: walker,
      operationId: op(),
      questId: "scene",
      revision: 1,
      evidence: "The circular canopy contrasts with a rectangular railing.",
      privateConsent: true,
      ...patch,
    });
  const review = (input, patch = {}) =>
    creatorOperator(s, "review-completion", {
      actor: "validator",
      operationId: op(),
      submissionId: input.completion.attempts.at(-1).id,
      expectedVersion: 1,
      decision: "accept",
      reason: "The private text addresses both declared shapes.",
      ...patch,
    });
  return { db, s, author, walker, other, op, submit, review, approve, options };
}
const rejected = (fn, code) => assert.throws(fn, (e) => e.code === code);
const economicRows = (db) =>
  JSON.stringify(
    Object.fromEntries(
      ["players", "inventory", "history", "treasury", "native_awards"].map(
        (name) => [
          name,
          db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
        ],
      ),
    ),
  );
test("independent acceptance records one zero-reward receipt and resolves atomically; closure releases only original commitment", (t) => {
  const f = fixture(t),
    before = economicRows(f.db),
    input = f.submit(),
    reviewOp = f.op();
  const receipt = f.review(input, { operationId: reviewOp });
  assert.equal(receipt.completion.state, "completed");
  assert.equal(receipt.completion.receipt.rewardStatus, "not-configured");
  assert.deepEqual(receipt.completion.receipt.reward, {
    xp: 0,
    gold: 0,
    item: null,
  });
  assert.equal(
    f.s.lifecycle.participation("scene", f.walker).state,
    "resolved",
  );
  assert.equal(economicRows(f.db), before);
  assert.deepEqual(f.review(input, { operationId: reviewOp }), receipt);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM creator_completion_receipts").get().n,
    1,
  );
  assert.equal(f.s.lifecycle.progression(f.author).lockedXp, 200);
  f.s.lifecycle.close({
    actor: f.author,
    operationId: f.op(),
    questId: "scene",
    expectedVersion: 3,
  });
  f.s.lifecycle.finalize({
    actor: f.author,
    operationId: f.op(),
    questId: "scene",
    expectedVersion: 4,
  });
  assert.equal(f.s.lifecycle.progression(f.author).availableXp, 1000);
  assert.equal(economicRows(f.db), before);
});
test("independence, consent, stale revision and legacy resolver cannot bypass declared review", (t) => {
  const f = fixture(t);
  rejected(() => f.submit({ privateConsent: false }), "CREATOR_INPUT");
  rejected(() => f.submit({ revision: 2 }), "CREATOR_STALE_REVISION");
  const submitted = f.submit();
  for (const actor of [f.author, f.walker, "moderator", f.other])
    rejected(() => f.review(submitted, { actor }), "CREATOR_FORBIDDEN");
  rejected(
    () =>
      f.s.lifecycle.resolve({
        actor: "validator",
        operationId: f.op(),
        questId: "scene",
        participant: f.walker,
        resolutionReference: "pretend-reviewed",
      }),
    "CREATOR_COMPLETION_REQUIRED",
  );
  rejected(
    () => f.review(submitted, { expectedVersion: 2 }),
    "CREATOR_STALE_VERSION",
  );
  assert.equal(f.s.completion.read(f.walker, "scene").state, "pending");
});
test("rejection feedback is private, one pending submission, third independent rejection resolves NOT completed without losing history", (t) => {
  const f = fixture(t),
    before = economicRows(f.db);
  for (let i = 1; i <= 3; i++) {
    const input = f.submit({
      evidence: `Observation attempt ${i}: circles and rectangles.`,
    });
    rejected(() => f.submit(), "CREATOR_COMPLETION_STATE");
    if (i === 3)
      rejected(
        () =>
          f.review(input, { decision: "reject", reason: "Final correction." }),
        "CREATOR_TERMINAL_CONFIRMATION",
      );
    const reviewed = f.review(input, {
      decision: "reject",
      ...(i === 3 ? { acknowledgeNotCompleted: true } : {}),
      reason: `Private correction ${i}: describe both shapes clearly.`,
    });
    assert.equal(reviewed.completion.attempts.length, i);
    assert.equal(
      reviewed.completion.state,
      i === 3 ? "rejected-final" : "rejected",
    );
  }
  const state = f.s.completion.read(f.walker, "scene");
  assert.equal(state.receipt, null);
  assert.equal(state.canSubmit, false);
  assert.equal(
    f.s.lifecycle.participation("scene", f.walker).state,
    "resolved",
  );
  assert.equal(state.attempts.length, 3);
  assert.equal(economicRows(f.db), before);
  assert.equal(f.s.lifecycle.progression(f.author).lockedXp, 200);
});
test("accepted requirements, submission and private feedback survive newer revisions, block, hide, suspension, daily resets and reopen", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "creator-completion-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, "game.sqlite"),
    f = fixture(t, { path });
  f.s.lifecycle.revise({
    actor: f.author,
    operationId: f.op(),
    questId: "scene",
    expectedVersion: 3,
    draft: {
      title: "Changed later",
      description: "New description",
      requirement: { ...req, prompt: "A different later prompt." },
    },
  });
  f.approve(4);
  f.s.safety.setBlocked({
    actor: f.walker,
    operationId: f.op(),
    creatorId: f.author,
    blocked: true,
  });
  f.s.lifecycle.suspend({
    actor: "moderator",
    operationId: f.op(),
    questId: "scene",
    expectedVersion: 6,
    reason: "Synthetic unsafe-publication stop.",
  });
  const input = f.submit();
  f.review(input, {
    decision: "reject",
    reason: "Private retained correction.",
  });
  f.db.exec("DELETE FROM worlds");
  const state = f.s.completion.read(f.walker, "scene");
  assert.equal(state.requirement.prompt, req.prompt);
  assert.equal(state.revision, 1);
  f.db.close();
  const reopened = openDatabase(path);
  t.after(() => reopened.close());
  const again = createCreatorServices(reopened, f.options);
  assert.deepEqual(again.completion.read(f.walker, "scene"), state);
  assert.equal(
    again.community.myParticipation(f.walker, "scene").content.requirement
      .prompt,
    req.prompt,
  );
});
test("old plain admissions stay legacy after structured republication and remain independently resolvable", (t) => {
  const f = fixture(t, { structured: false });
  f.s.lifecycle.revise({
    actor: f.author,
    operationId: f.op(),
    questId: "scene",
    expectedVersion: 3,
    draft: {
      title: "Structured later",
      description: "New declared requirement",
      requirement: req,
    },
  });
  f.approve(4);
  assert.equal(f.s.completion.read(f.walker, "scene").legacy, true);
  rejected(() => f.submit(), "CREATOR_COMPLETION_LEGACY");
  f.s.lifecycle.resolve({
    actor: "validator",
    operationId: f.op(),
    questId: "scene",
    participant: f.walker,
    resolutionReference: "legacy-independent-review",
  });
  assert.equal(f.s.completion.read(f.walker, "scene").state, "legacy-resolved");
});
test("failed receipt journal rolls back review, resolution and completion receipt together", (t) => {
  const f = fixture(t),
    input = f.submit(),
    before = economicRows(f.db);
  f.db.exec(
    "CREATE TEMP TRIGGER fail_completion_journal BEFORE INSERT ON creator_operations WHEN NEW.command='reviewCreatorCompletion' BEGIN SELECT RAISE(ABORT,'journal unavailable'); END",
  );
  assert.throws(() => f.review(input), /journal unavailable/);
  assert.equal(f.s.completion.read(f.walker, "scene").state, "pending");
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM creator_completion_receipts").get().n,
    0,
  );
  assert.equal(f.s.lifecycle.participation("scene", f.walker).state, "open");
  assert.equal(economicRows(f.db), before);
  f.db.exec("DROP TRIGGER fail_completion_journal");
  f.review(input);
  assert.equal(f.s.completion.read(f.walker, "scene").state, "completed");
});
test("public/author/stranger APIs never expose private evidence or privileged review routes", async (t) => {
  const f = fixture(t);
  f.submit({ evidence: "Private evidence phrase never public." });
  let actor = f.author;
  const api = createCreatorApi({
    ...f.s,
    origin: "https://qa.example",
    enabled: true,
    authenticate: () => actor,
  });
  const read = async (path) => {
    const r = await api(
      new Request("https://qa.example/api/creator-community" + path),
    );
    return { status: r.status, body: await r.json() };
  };
  assert(
    !JSON.stringify((await read("/quests/scene")).body).includes(
      "Private evidence phrase",
    ),
  );
  for (actor of [f.author, f.other])
    assert.equal((await read("/quests/scene/completion")).status, 404);
  actor = f.walker;
  assert.equal(
    (await read("/quests/scene/completion")).body.attempts[0].evidence,
    "Private evidence phrase never public.",
  );
  const r = await api(
    new Request(
      "https://qa.example/api/creator-community/quests/scene/review-completion",
      {
        method: "POST",
        headers: {
          origin: "https://qa.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ actor: "validator" }),
      },
    ),
  );
  assert.equal(r.status, 404);
  assert.equal(creatorAudit(f.db).pendingCompletions.length, 1);
});
test("actual HTTP lost reply and concurrent duplicate submit recover one actor-bound operation and attempt", async (t) => {
  const f = fixture(t);
  let bridge,
    lose = true;
  const server = createServer((req, res) => {
    if (req.method === "POST" && lose) {
      const end = res.end;
      res.end = function (...args) {
        lose = false;
        res.end = end;
        res.destroy();
        return res;
      };
    }
    void bridge(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  bridge = createNodeCreatorHandler({
    ...f.s,
    origin,
    enabled: true,
    authenticate: (req) => (req.headers.cookie === "walker" ? f.walker : null),
  });
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k) || null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    },
    calls = [];
  const fetcher = async (path, init) => {
    if (init?.body) calls.push(JSON.parse(init.body).operationId);
    return fetch(origin + path, {
      ...init,
      headers: { ...init?.headers, origin, cookie: "walker" },
    });
  };
  const body = {
    revision: 1,
    evidence: "The circular canopy contrasts with a rectangular railing.",
    privateConsent: true,
  };
  let client = createCreatorClient({ playerId: f.walker, storage, fetcher });
  await assert.rejects(client.mutate("/quests/scene/completion", "POST", body));
  assert.equal(f.s.completion.read(f.walker, "scene").attempts.length, 1);
  client = createCreatorClient({ playerId: f.walker, storage, fetcher });
  const receipt = await client.mutate("/quests/scene/completion", "POST", body);
  assert.equal(calls[0], calls[1]);
  assert.equal(receipt.completion.state, "pending");
  assert(![...data.values()].join().includes(body.evidence));
  const api = createCreatorApi({
    ...f.s,
    origin,
    enabled: true,
    authenticate: () => f.walker,
  });
  const send = (op) =>
    api(
      new Request(origin + "/api/creator-community/quests/scene/completion", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ ...body, operationId: op }),
      }),
    );
  const statuses = await Promise.all([
    send("simultaneous-a"),
    send("simultaneous-b"),
  ]);
  assert.deepEqual(
    statuses.map((r) => r.status),
    [409, 409],
  );
  assert.equal(f.s.completion.read(f.walker, "scene").attempts.length, 1);
});
test("two SQLite connections admit one pending attempt and one completion under competing authenticated requests", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "creator-completion-race-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "game.sqlite"),
    f = fixture(t, { path });
  const second = openDatabase(path);
  t.after(() => second.close());
  const s2 = createCreatorServices(second, f.options),
    origin = "https://race.example";
  const apis = [f.s, s2].map((s) =>
    createCreatorApi({
      ...s,
      origin,
      enabled: true,
      authenticate: () => f.walker,
    }),
  );
  const send = (api, id) =>
    api(
      new Request(origin + "/api/creator-community/quests/scene/completion", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          operationId: id,
          revision: 1,
          evidence: "Two independently described contrasting shapes.",
          privateConsent: true,
        }),
      }),
    );
  const results = await Promise.all(
    apis.map((api, i) => send(api, `racing-submit-${i}`)),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const state = f.s.completion.read(f.walker, "scene");
  assert.equal(state.attempts.length, 1);
  const submissionId = state.attempts[0].id;
  const review = {
    actor: "validator",
    submissionId,
    expectedVersion: 1,
    decision: "accept",
    reason: "Addresses the accepted prompt.",
  };
  f.s.completion.review({ ...review, operationId: "racing-review-1" });
  rejected(
    () => s2.completion.review({ ...review, operationId: "racing-review-2" }),
    "CREATOR_STALE_VERSION",
  );
  assert.equal(
    second.prepare("SELECT count(*) n FROM creator_completion_receipts").get()
      .n,
    1,
  );
});

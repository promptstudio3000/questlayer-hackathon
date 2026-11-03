import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, createPlayer, playerView } from "../server/database.mjs";
import {
  creatorConfiguration,
  createCreatorRuntime,
} from "../server/creators/runtime.mjs";
import { creatorAudit, creatorOperator } from "../server/creators/operator.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const ENV = {
  CREATOR_COMMUNITY_ENABLED: "1",
  CREATOR_POLICY_VERSION: "qa-only-runtime-v1",
  CREATOR_XP_COMMITMENT: "200",
  CREATOR_MODERATORS: "qa-reviewer",
  CREATOR_COMPLETION_AUTHORITIES: "qa-validator",
};
const tables = (db) =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'creator_%'",
    )
    .all();

test("creator runtime defaults off without creating storage and explicit configuration has no balancing default", () => {
  const db = openDatabase(":memory:");
  try {
    const runtime = createCreatorRuntime(db, {
      env: {},
      origin: "http://localhost",
      authenticate: () => "player",
    });
    assert.equal(runtime.status.enabled, false);
    assert.equal(runtime.status.policy, null);
    assert.equal(runtime.services, null);
    assert.deepEqual(tables(db), []);
    assert.equal(creatorAudit(db).initialized, false);
    for (const env of [
      { ...ENV, CREATOR_COMMUNITY_ENABLED: "true" },
      { ...ENV, CREATOR_XP_COMMITMENT: "" },
      { ...ENV, CREATOR_XP_COMMITMENT: "200.5" },
      { ...ENV, CREATOR_POLICY_VERSION: "" },
      { ...ENV, CREATOR_MODERATORS: "" },
      { ...ENV, CREATOR_COMPLETION_AUTHORITIES: "" },
    ])
      assert.throws(() =>
        createCreatorRuntime(db, {
          env,
          origin: "http://localhost",
          authenticate: () => "player",
        }),
      );
    assert.deepEqual(tables(db), []);
    assert.equal(creatorConfiguration(ENV).policy.xpCommitment, 200);
  } finally {
    db.close();
  }
});

test("application progression counts durable locks even with creator publication disabled, never earning or burning XP", () => {
  const db = openDatabase(":memory:");
  try {
    const author = createPlayer(db, "QA author"),
      walker = createPlayer(db, "QA walker");
    db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author);
    const runtime = createCreatorRuntime(db, {
      env: ENV,
      origin: "http://localhost",
      authenticate: () => author,
    });
    const l = runtime.services.lifecycle;
    l.createDraft({
      actor: author,
      operationId: "draft",
      questId: "qa",
      draft: {
        title: "QA quest",
        description: "Read-only fixture instructions.",
      },
    });
    l.submit({
      actor: author,
      operationId: "submit",
      questId: "qa",
      expectedVersion: 1,
      expectedPolicyVersion: ENV.CREATOR_POLICY_VERSION,
    });
    creatorOperator(runtime.services, "review", {
      actor: "qa-reviewer",
      operationId: "review",
      questId: "qa",
      expectedVersion: 2,
      decision: "approve",
      reason: "QA fixture review.",
    });
    const held = playerView(db, author);
    assert.deepEqual(
      [held.xp, held.earnedXp, held.lockedXp, held.availableXp, held.level],
      [1000, 1000, 200, 800, 3],
    );
    createCreatorRuntime(db, {
      env: {},
      origin: "http://localhost",
      authenticate: () => author,
    });
    assert.equal(playerView(db, author).availableXp, 800);
    assert.equal(creatorAudit(db).activeCommitments.length, 1);
    assert.throws(
      () =>
        creatorOperator(runtime.services, "review", {
          actor: author,
          operationId: "self-review",
          questId: "qa",
          expectedVersion: 3,
          decision: "approve",
          reason: "No.",
        }),
      (e) => e.code === "CREATOR_FORBIDDEN",
    );
    assert.equal(playerView(db, walker).xp, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM inventory").get().n, 2);
  } finally {
    db.close();
  }
});

test("private joined pagination retains accepted revisions through edits, hiding, bilateral blocks and closure", () => {
  const db = openDatabase(":memory:");
  try {
    const author = createPlayer(db, "QA author"),
      walker = createPlayer(db, "QA walker"),
      stranger = createPlayer(db, "QA stranger");
    db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author);
    const {
      services: { lifecycle: l, community: c },
    } = createCreatorRuntime(db, {
      env: ENV,
      origin: "http://localhost",
      authenticate: () => author,
    });
    c.saveProfile({
      actor: author,
      operationId: "profile",
      expectedVersion: 0,
      profile: { displayName: "QA creator", bio: "QA", public: true },
      publicConsent: true,
    });
    for (const questId of ["qa-a", "qa-b", "qa-c"]) {
      l.createDraft({
        actor: author,
        operationId: `draft:${questId}`,
        questId,
        draft: { title: questId, description: "Original accepted content" },
      });
      l.submit({
        actor: author,
        operationId: `submit:${questId}`,
        questId,
        expectedVersion: 1,
        expectedPolicyVersion: ENV.CREATOR_POLICY_VERSION,
      });
      l.review({
        actor: "qa-reviewer",
        operationId: `review:${questId}`,
        questId,
        expectedVersion: 2,
        decision: "approve",
        reason: "QA",
      });
      l.start({ actor: walker, operationId: `start:${questId}`, questId });
    }
    l.revise({
      actor: author,
      operationId: "edit",
      questId: "qa-a",
      expectedVersion: 3,
      draft: {
        title: "Unapproved private edit",
        description: "Never expose to prior participant",
      },
    });
    assert.equal(c.myCreation(author, "qa-a").latestState, "draft");
    assert.throws(
      () => c.myCreation(walker, "qa-a"),
      (e) => e.code === "CREATOR_NOT_FOUND",
    );
    c.saveProfile({
      actor: author,
      operationId: "hide",
      expectedVersion: 1,
      profile: { displayName: "QA creator", bio: "QA", public: false },
      publicConsent: false,
    });
    db.prepare("INSERT INTO social_blocks VALUES (?,?,?)").run(
      author,
      walker,
      Date.now(),
    );
    l.close({
      actor: author,
      operationId: "close",
      questId: "qa-b",
      expectedVersion: 3,
    });
    const first = c.myParticipations(walker, { limit: 1 });
    const second = c.myParticipations(walker, {
      limit: 1,
      cursor: first.nextCursor,
    });
    const last = c.myParticipations(walker, {
      limit: 1,
      cursor: second.nextCursor,
    });
    assert.deepEqual(
      [first.items[0].questId, second.items[0].questId, last.items[0].questId],
      ["qa-a", "qa-b", "qa-c"],
    );
    assert.equal(first.items[0].content.title, "qa-a");
    assert.equal(first.items[0].revision, 1);
    assert.equal(second.items[0].questState, "closing");
    assert.equal(last.nextCursor, null);
    assert.equal(c.myParticipations(stranger).items.length, 0);
    assert.equal(c.listQuests(walker).items.length, 0);
    l.createDraft({
      actor: author,
      operationId: "rejected-draft",
      questId: "qa-rejected",
      draft: {
        title: "Needs correction",
        description: "A draft needing a clearer public-path instruction.",
      },
    });
    l.submit({
      actor: author,
      operationId: "rejected-submit",
      questId: "qa-rejected",
      expectedVersion: 1,
      expectedPolicyVersion: ENV.CREATOR_POLICY_VERSION,
    });
    l.review({
      actor: "qa-reviewer",
      operationId: "rejected-review",
      questId: "qa-rejected",
      expectedVersion: 2,
      decision: "reject",
      reason: "Clarify the safe public-path requirement.",
    });
    assert.equal(
      c.myCreation(author, "qa-rejected").latestReviewReason,
      "Clarify the safe public-path requirement.",
    );
    assert.throws(
      () => c.myCreation(walker, "qa-rejected"),
      (e) => e.code === "CREATOR_NOT_FOUND",
    );
    assert(
      !JSON.stringify(c.myParticipations(walker)).includes(
        "Clarify the safe public-path requirement.",
      ),
    );
    assert.throws(() => c.myParticipations(walker, { limit: 51 }));
  } finally {
    db.close();
  }
});

async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) =>
    server.once("error", fail).listen(0, "127.0.0.1", ok),
  );
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}
async function host(t, enabled) {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-creator-host-"));
  const port = await freePort(),
    base = `http://127.0.0.1:${port}`,
    database = join(directory, "game.sqlite");
  const env = {
    ...process.env,
    ...ENV,
    PORT: String(port),
    HOST: "127.0.0.1",
    APP_ORIGIN: base,
    DATABASE_PATH: database,
    CREATOR_COMMUNITY_ENABLED: enabled ? "1" : "0",
    DISABLE_BACKGROUND_WORKERS: "1",
    DISABLE_NATIVE_ATTESTATIONS: "1",
    REWARD_ATTESTOR_PATH: "",
    REWARD_WORKER_KEY_PATH: "",
    AWARD_SIGNER_PATH: join(directory, "must-not-exist.pem"),
    NEAR_RPC_URL: "http://127.0.0.1:9",
  };
  const child = spawn(process.execPath, [join(ROOT, "server/index.mjs")], {
    cwd: directory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (c) => (logs += c));
  child.stderr.on("data", (c) => (logs += c));
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((ok) => child.once("exit", ok));
    }
    rmSync(directory, { recursive: true, force: true });
  });
  // Up to 15 s: a cold host on a busy CI runner (clean-clone job) can need
  // more than the 3 s this loop used to allow.
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw Error(`QA host failed: ${logs}`);
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 25));
    if (i === 599) throw Error(`QA host did not start: ${logs}`);
  }
  assert.equal(existsSync(env.AWARD_SIGNER_PATH), false);
  const request = async (
    path,
    { method = "GET", body, cookie, headers = {} } = {},
  ) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined
          ? {}
          : { origin: base, "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  async function session(name) {
    const r = await request("/api/session", { method: "POST", body: { name } });
    assert.equal(r.status, 201);
    return {
      id: r.body.player.id,
      cookie: r.headers.get("set-cookie").split(";")[0],
    };
  }
  async function operate(command, input) {
    const path = join(directory, `${command}.json`);
    writeFileSync(path, JSON.stringify(input), { mode: 0o600 });
    const process = spawn(
      globalThis.process.execPath,
      [
        join(ROOT, "scripts/creator-operator.mjs"),
        command,
        "--database",
        database,
        "--input",
        path,
      ],
      { cwd: directory, env },
    );
    let output = "",
      error = "";
    process.stdout.on("data", (c) => (output += c));
    process.stderr.on("data", (c) => (error += c));
    const code = await new Promise((ok) => process.once("exit", ok));
    assert.equal(code, 0, error);
    return JSON.parse(output);
  }
  return { directory, database, request, session, operate };
}

test("real host exposes authenticated disabled capability without creator tables or attestor generation", async (t) => {
  const h = await host(t, false);
  const user = await h.session("QA player");
  assert.equal((await h.request("/api/creator-community/status")).status, 401);
  const status = await h.request("/api/creator-community/status", {
    cookie: user.cookie,
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.enabled, false);
  assert.match(status.headers.get("cache-control"), /no-store/);
  assert.equal(
    (await h.request("/api/creator-community/me", { cookie: user.cookie }))
      .status,
    404,
  );
  assert.equal((await h.request("/api/native/claim-signer")).status, 503);
  const db = new DatabaseSync(h.database, { readOnly: true });
  try {
    assert.deepEqual(tables(db), []);
  } finally {
    db.close();
  }
});

test("actual host and operator CLI complete profile, publication, following, protected participation and once-only XP release", async (t) => {
  const h = await host(t, true),
    author = await h.session("QA author"),
    walker = await h.session("QA walker");
  const db = openDatabase(h.database);
  t.after(() => db.close());
  db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author.id);
  const call = async (actor, path, body, method = "POST") =>
    h.request("/api/creator-community" + path, {
      cookie: actor.cookie,
      method: body === undefined ? "GET" : method,
      body,
    });
  const status = await call(author, "/status");
  assert.equal(status.body.rewards, "not-configured");
  assert.equal(status.body.policy.version, ENV.CREATOR_POLICY_VERSION);
  assert.equal(
    (
      await call(
        author,
        "/profile",
        {
          operationId: "profile",
          expectedVersion: 0,
          profile: {
            displayName: "Riverkeeper",
            bio: "QA-only stories",
            public: true,
          },
          publicConsent: true,
        },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(author, "/quests", {
        operationId: "draft",
        questId: "qa-river",
        draft: {
          title: "River ghosts",
          description: "A reviewed public text activity.",
        },
      })
    ).status,
    200,
  );
  assert.equal((await call(walker, "/me/quests/qa-river")).status, 404);
  assert.equal(
    (await call(author, "/me/quests/qa-river")).body.latestState,
    "draft",
  );
  const quote = (await call(author, "/quests/qa-river/publication-quote")).body;
  assert.equal(quote.xpCommitment, 200);
  assert.equal(
    (
      await call(author, "/quests/qa-river/submit", {
        operationId: "submit",
        expectedVersion: quote.expectedVersion,
        expectedPolicyVersion: quote.policyVersion,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(author, "/quests/qa-river/review", { actor: "qa-reviewer" }))
      .status,
    404,
  );
  const review = {
    actor: "qa-reviewer",
    operationId: "review",
    questId: "qa-river",
    expectedVersion: 2,
    decision: "approve",
    reason: "Independently reviewed QA text fixture.",
  };
  const approved = await h.operate("review", review);
  assert.equal(approved.quest.state, "published");
  const held = (await h.request("/api/me", { cookie: author.cookie })).body
    .player;
  assert.deepEqual(
    [held.xp, held.earnedXp, held.lockedXp, held.availableXp, held.level],
    [1000, 1000, 200, 800, 3],
  );
  assert.equal(
    (
      await call(
        walker,
        `/creators/${author.id}/follow`,
        { operationId: "follow", following: true },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (await call(walker, "/quests?following=true")).body.items[0].id,
    "qa-river",
  );
  assert.equal(
    (
      await call(walker, "/quests/qa-river/participation", {
        operationId: "start",
      })
    ).status,
    200,
  );
  const owned = (await call(author, "/me/quests/qa-river")).body;
  assert.equal(owned.latestState, "approved");
  assert.equal(
    (
      await call(
        author,
        "/profile",
        {
          operationId: "hide",
          expectedVersion: 1,
          profile: {
            displayName: "Riverkeeper",
            bio: "QA-only stories",
            public: false,
          },
          publicConsent: false,
        },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal((await call(walker, "/quests")).body.items.length, 0);
  const joined = (await call(walker, "/me/participations?limit=1")).body;
  assert.equal(joined.items[0].content.title, "River ghosts");
  assert.equal(joined.items[0].revision, 1);
  assert.equal(joined.nextCursor, null);
  assert.equal((await call(author, "/me/participations")).body.items.length, 0);
  assert.equal(
    (
      await call(author, "/quests/qa-river/close", {
        operationId: "close",
        expectedVersion: owned.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(author, "/quests/qa-river/finalize", {
        operationId: "finish",
        expectedVersion: 4,
      })
    ).status,
    409,
  );
  await h.operate("resolve", {
    actor: "qa-validator",
    operationId: "resolve",
    questId: "qa-river",
    participant: walker.id,
    resolutionReference: "qa-independent-completion-review-1",
  });
  const finalized = await call(author, "/quests/qa-river/finalize", {
    operationId: "finish",
    expectedVersion: 4,
  });
  assert.equal(finalized.status, 200);
  assert.equal(finalized.body.progression.availableXp, 1000);
  assert.deepEqual(
    (
      await call(author, "/quests/qa-river/finalize", {
        operationId: "finish",
        expectedVersion: 4,
      })
    ).body,
    finalized.body,
  );
  assert.equal((await h.operate("review", review)).quest.state, "published");
  const released = (await h.request("/api/me", { cookie: author.cookie })).body
    .player;
  assert.deepEqual(
    [
      released.earnedXp,
      released.lockedXp,
      released.availableXp,
      released.level,
    ],
    [1000, 0, 1000, 4],
  );
  assert.equal(
    (await call(walker, "/me/participations")).body.items[0].state,
    "resolved",
  );
  assert.equal(playerView(db, walker.id).xp, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM inventory").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM history").get().n, 2);
  assert.equal(
    db.prepare("SELECT SUM(available_u) n FROM treasury").get().n,
    100000000000,
  );
});

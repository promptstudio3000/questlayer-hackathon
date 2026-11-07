import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import { createCreatorApi } from "../server/creators/api.mjs";
import { GameError } from "../server/domain.mjs";

const ORIGIN = "https://questlayer.example";
const ROOT = ORIGIN + "/api/creator-community";
const POLICY = { version: "test-only-200xp", xpCommitment: 200 };
const NOW = Date.parse("2026-10-31T14:00:00Z");
const DRAFT = {
  title: "River Ghosts",
  description: "Follow the approved public clue.",
};
function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const author = createPlayer(db, "Private author", NOW),
    viewer = createPlayer(db, "Private walker", NOW);
  db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author);
  const services = createCreatorServices(db, {
    policy: POLICY,
    clock: () => NOW,
    isModerator: (id) => id === "reviewer",
    isCompletionAuthority: (id) => id === "validator",
  });
  const authenticate = (request) =>
    ({ "session=author": author, "session=viewer": viewer })[
      request.headers.get("cookie")
    ] ?? null;
  const options = { ...services, origin: ORIGIN, authenticate, enabled: true };
  const api = createCreatorApi(options);
  let n = 0;
  const op = () => `api-${++n}`;
  async function request(
    path,
    {
      method = "GET",
      body,
      actor = "author",
      headers = {},
      target = ROOT,
    } = {},
  ) {
    const result = await api(
      new Request(target + path, {
        method,
        headers: {
          cookie: `session=${actor}`,
          ...(method === "GET"
            ? {}
            : { origin: ORIGIN, "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
    );
    return result === null
      ? null
      : {
          status: result.status,
          headers: result.headers,
          body: await result.json(),
        };
  }
  function profile() {
    return services.community.saveProfile({
      actor: author,
      operationId: op(),
      expectedVersion: 0,
      profile: {
        displayName: "Riverkeeper",
        bio: "Public stories.",
        public: true,
      },
      publicConsent: true,
    });
  }
  function publish() {
    profile();
    services.lifecycle.createDraft({
      actor: author,
      operationId: op(),
      questId: "river",
      draft: DRAFT,
    });
    services.lifecycle.submit({
      actor: author,
      operationId: op(),
      questId: "river",
      expectedVersion: 1,
      expectedPolicyVersion: POLICY.version,
    });
    services.lifecycle.review({
      actor: "reviewer",
      operationId: op(),
      questId: "river",
      expectedVersion: 2,
      decision: "approve",
      reason: "Private moderation explanation.",
    });
  }
  return {
    db,
    author,
    viewer,
    ...services,
    options,
    api,
    request,
    op,
    profile,
    publish,
  };
}

test("the player route journey creates, quotes, submits, follows, starts and safely closes", async (t) => {
  const f = fixture(t);
  assert.equal(
    (
      await f.request("/profile", {
        method: "PUT",
        body: {
          operationId: f.op(),
          expectedVersion: 0,
          profile: {
            displayName: "Riverkeeper",
            bio: "Public stories.",
            public: true,
          },
          publicConsent: true,
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request("/quests", {
        method: "POST",
        body: { operationId: f.op(), questId: "river", draft: DRAFT },
      })
    ).status,
    200,
  );
  const quote = await f.request("/quests/river/publication-quote");
  assert.equal(quote.body.xpCommitment, 200);
  assert.equal(quote.body.progression.availableXp, 1000);
  assert.equal(
    (
      await f.request("/quests/river/submit", {
        method: "POST",
        body: {
          operationId: f.op(),
          expectedVersion: 1,
          expectedPolicyVersion: quote.body.policyVersion,
        },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await f.request("/quests", { actor: "viewer" })).body.items,
    [],
  );
  f.lifecycle.review({
    actor: "reviewer",
    operationId: f.op(),
    questId: "river",
    expectedVersion: 2,
    decision: "approve",
    reason: "Reviewed.",
  });
  assert.equal(
    (
      await f.request(`/creators/${f.author}/follow`, {
        actor: "viewer",
        method: "PUT",
        body: { operationId: f.op(), following: true },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request("/quests?following=true", { actor: "viewer" })).body
      .items[0].title,
    DRAFT.title,
  );
  // The host's paid-access gate runs before a start and its refusal is relayed.
  const gated = [];
  const lockedApi = createCreatorApi({
    ...f.options,
    authenticate: () => f.viewer,
    async admitStart(actor, questId, quest) {
      gated.push([actor, questId, quest.title]);
      throw new GameError(
        "Unlock this quest before starting it.",
        402,
        "CREATOR_ACCESS_REQUIRED",
      );
    },
  });
  const locked = await lockedApi(
    new Request(ROOT + "/quests/river/participation", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ operationId: f.op() }),
    }),
  );
  assert.equal(locked.status, 402);
  assert.equal((await locked.json()).code, "CREATOR_ACCESS_REQUIRED");
  assert.deepEqual(gated, [[f.viewer, "river", DRAFT.title]]);
  const start = { operationId: f.op() };
  const receipt = await f.request("/quests/river/participation", {
    method: "POST",
    actor: "viewer",
    body: start,
  });
  assert.equal(receipt.status, 200);
  assert.deepEqual(
    (
      await f.request("/quests/river/participation", {
        method: "POST",
        actor: "viewer",
        body: start,
      })
    ).body,
    receipt.body,
  );
  assert.equal(
    (
      await f.request("/quests/river/close", {
        method: "POST",
        body: { operationId: f.op(), expectedVersion: 3 },
      })
    ).body.quest.state,
    "closing",
  );
  assert.equal(
    (
      await f.request("/quests/river/finalize", {
        method: "POST",
        body: { operationId: f.op(), expectedVersion: 4 },
      })
    ).body.code,
    "CREATOR_OBLIGATIONS_OPEN",
  );
  assert.equal(
    (await f.request("/quests/river/participation", { actor: "viewer" })).body
      .revision,
    1,
  );
  f.lifecycle.resolve({
    actor: "validator",
    operationId: f.op(),
    questId: "river",
    participant: f.viewer,
    resolutionReference: "durable-result",
  });
  assert.equal(
    (
      await f.request("/quests/river/finalize", {
        method: "POST",
        body: { operationId: f.op(), expectedVersion: 4 },
      })
    ).body.progression.lockedXp,
    0,
  );
});

test("authentication comes from the server session, not actor/role payloads or queries", async (t) => {
  const f = fixture(t);
  f.publish();
  assert.equal((await f.request("/me", { actor: "unknown" })).status, 401);
  assert.equal(
    (await f.request("/me?actor=" + f.author, { actor: "viewer" })).status,
    400,
  );
  assert.equal(
    (
      await f.request("/quests/river/close", {
        method: "POST",
        actor: "viewer",
        body: { operationId: f.op(), expectedVersion: 3 },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/quests/river/close", {
        method: "POST",
        actor: "viewer",
        body: { operationId: f.op(), expectedVersion: 3, actor: f.author },
      })
    ).status,
    400,
  );
  for (const action of ["review", "resolve", "constructor", "toString"]) {
    assert.equal(
      (
        await f.request(`/quests/river/${action}`, {
          method: "POST",
          body: { operationId: f.op() },
        })
      ).status,
      404,
    );
  }
  assert.equal(f.lifecycle.readQuest("river").state, "published");
});

test("writes require the configured origin and JSON; disabled adapters never expose the feature", async (t) => {
  const f = fixture(t);
  for (const origin of ["https://attacker.example", "null", ""])
    assert.equal(
      (
        await f.request("/quests", {
          method: "POST",
          headers: { origin },
          body: { operationId: f.op(), questId: "river", draft: DRAFT },
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await f.request("/me", {
        target: "https://attacker.example/api/creator-community",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/quests", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (await f.request("/quests", { method: "DELETE", body: "{}" })).status,
    405,
  );
  const disabled = createCreatorApi({ ...f.options, enabled: false });
  assert.equal((await disabled(new Request(ROOT + "/me"))).status, 404);
  const omitted = { ...f.options };
  delete omitted.enabled;
  assert.equal(
    (await createCreatorApi(omitted)(new Request(ROOT + "/me"))).status,
    404,
  );
  assert.equal(await f.api(new Request(ORIGIN + "/api/health")), null);
  assert.equal(
    await f.api(new Request(ORIGIN + "/api/creator-community-other")),
    null,
  );
});

test("public API never returns pending content, profile private names or other participants", async (t) => {
  const f = fixture(t);
  f.publish();
  f.lifecycle.revise({
    actor: f.author,
    operationId: f.op(),
    questId: "river",
    expectedVersion: 3,
    draft: { title: "Secret draft", description: "Unapproved private text." },
  });
  const publicValue = await f.request("/quests/river", { actor: "viewer" });
  assert.equal(publicValue.status, 200);
  const serialized = JSON.stringify(publicValue.body);
  for (const secret of [
    "Private",
    "Secret",
    "Unapproved",
    "lockedXp",
    "moderation",
    "participant",
  ])
    assert.ok(!serialized.includes(secret));
  assert.equal(
    (await f.request("/me/quests", { actor: "viewer" })).body.items.length,
    0,
  );
  assert.equal(
    (await f.request("/me/quests")).body.items[0].draft.title,
    "Secret draft",
  );
  assert.equal(
    (await f.request("/quests/river/publication-quote", { actor: "viewer" }))
      .status,
    403,
  );
  assert.equal(
    (await f.request("/quests/river/participation", { actor: "viewer" }))
      .status,
    404,
  );
  assert.equal(publicValue.headers.get("cache-control"), "private, no-store");
  assert.equal(publicValue.headers.get("access-control-allow-origin"), null);
});

test("queries are bounded and reject guessed actor/GPS fields and ambiguous filters", async (t) => {
  const f = fixture(t);
  f.publish();
  for (const query of [
    "limit=0",
    "limit=51",
    "limit=1.1",
    "limit=1&limit=2",
    "following=yes",
    "lat=49.7",
    "actor=someone",
    "cursor=../",
  ]) {
    assert.equal((await f.request("/quests?" + query)).status, 400, query);
  }
  assert.equal(
    (await f.request("/quests?limit=1&following=false")).status,
    200,
  );
  assert.equal(
    (await f.request(`/quests?creator=${f.author}`)).body.items.length,
    1,
  );
  assert.equal((await f.request("/creators?following=true")).status, 400);
});

test("malformed, oversized and streamed oversized JSON cannot create records", async (t) => {
  const f = fixture(t);
  for (const body of ["{", "null", "[]", '"string"'])
    assert.equal(
      (await f.request("/quests", { method: "POST", body })).status,
      400,
    );
  assert.equal(
    (await f.request("/quests", { method: "POST", body: "x".repeat(17000) }))
      .status,
    413,
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(9000)));
      controller.enqueue(new TextEncoder().encode("x".repeat(9000)));
      controller.close();
    },
  });
  const result = await f.api(
    new Request(ROOT + "/quests", {
      method: "POST",
      duplex: "half",
      body: stream,
      headers: {
        cookie: "session=author",
        origin: ORIGIN,
        "content-type": "application/json",
      },
    }),
  );
  assert.equal(result.status, 413);
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM creator_quests").get().n,
    0,
  );
});

test("publication policy mismatch leaves the draft unchanged and preserves XP", async (t) => {
  const f = fixture(t);
  await f.request("/quests", {
    method: "POST",
    body: { operationId: f.op(), questId: "river", draft: DRAFT },
  });
  const result = await f.request("/quests/river/submit", {
    method: "POST",
    body: {
      operationId: f.op(),
      expectedVersion: 1,
      expectedPolicyVersion: "unaccepted",
    },
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "CREATOR_POLICY_CHANGED");
  assert.equal(f.lifecycle.readQuest("river").state, "draft");
  assert.equal(f.lifecycle.progression(f.author).lockedXp, 0);
});

test("API admission obeys bilateral blocks without discarding the existing participant's rights", async (t) => {
  const f = fixture(t);
  f.publish();
  await f.request("/quests/river/participation", {
    method: "POST",
    actor: "viewer",
    body: { operationId: f.op() },
  });
  f.db
    .prepare("INSERT INTO social_blocks VALUES (?,?,?)")
    .run(f.viewer, f.author, NOW);
  assert.equal(
    (await f.request("/quests/river", { actor: "viewer" })).status,
    404,
  );
  assert.equal(
    (await f.request("/quests/river/participation", { actor: "viewer" }))
      .status,
    200,
  );
  const outsider = createPlayer(f.db, "Another player", NOW);
  f.db
    .prepare("INSERT INTO social_blocks VALUES (?,?,?)")
    .run(f.author, outsider, NOW);
  const otherApi = createCreatorApi({
    ...f.options,
    authenticate: () => outsider,
  });
  assert.equal(
    (
      await otherApi(
        new Request(ROOT + "/quests/river/participation", {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json" },
          body: JSON.stringify({ operationId: f.op() }),
        }),
      )
    ).status,
    404,
  );
});

test("unexpected server errors have a generic retry response without leaking internal details", async (t) => {
  const f = fixture(t);
  const broken = createCreatorApi({
    ...f.options,
    authenticate: () => {
      throw Error("secret storage location and credential");
    },
  });
  const result = await broken(new Request(ROOT + "/me"));
  assert.equal(result.status, 500);
  assert.ok(!JSON.stringify(await result.json()).includes("secret"));
});

test("revoking a creator session during paid admission prevents starting the quest", async () => {
  let actor = "explorer", started = false;
  const handle = createCreatorApi({
    enabled:true, origin:ORIGIN, authenticate:() => actor,
    community:{publicQuest:()=>({})},
    admitStart:async () => { actor = null; },
    lifecycle:{start:() => { started = true; }},
  });
  const result = await handle(new Request(ROOT + "/quests/example/participation",{
    method:"POST",headers:{Origin:ORIGIN,"Content-Type":"application/json"},
    body:JSON.stringify({operationId:"test-start"})
  }));
  assert.equal(result.status,401);
  assert.equal(started,false);
});

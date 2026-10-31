import test from "node:test";
import assert from "node:assert/strict";
import {
  createCreatorClient,
  creatorDraftIdentity,
} from "../src/creator-community-client.ts";
import {
  parseCreatorCommunityView,
  parseCreatorCapability,
  creatorReportTarget,
} from "../src/creator-community-types.ts";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import { createCreatorApi } from "../server/creators/api.mjs";

function memory() {
  const values = new Map();
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
}
test("creator history accepts navigation identity only, without operation or permission fields", () => {
  for (const view of [
    { page: "community" },
    { page: "following" },
    { page: "creators" },
    { page: "mine" },
    { page: "participations" },
    { page: "blocked" },
    { page: "profile" },
    { page: "quest", questId: "river-1" },
    { page: "creator", creatorId: "author-1" },
    { page: "edit", questId: null },
  ])
    assert.deepEqual(parseCreatorCommunityView(structuredClone(view)), view);
  for (const view of [
    null,
    [],
    {},
    { page: "moderate" },
    { page: "community", actor: "other" },
    { page: "blocked", blocked: false },
    {
      page: "quest",
      questId: "river",
      reason: "unsafe-place",
      confirmed: true,
    },
    { page: "quest", questId: "river", operationId: "saved" },
    { page: "edit", questId: "../private" },
    { page: { toString: () => "mine" } },
    new String("mine"),
    Object.assign(Object.create({ page: "mine" }), { amount: 999 }),
  ])
    assert.equal(parseCreatorCommunityView(view), null);
});
test("report targeting keeps accepted instructions after closure/block and never substitutes a newer public revision", () => {
  const quest = {
    domain: "demo",
    id: "park",
    revision: 3,
    title: "Current public title",
  };
  const part = {
    domain: "demo",
    questId: "park",
    revision: 1,
    questState: "closing",
    content: { title: "Accepted title", description: "Protected instructions" },
    creator: { id: "author", displayName: null },
  };
  assert.deepEqual(creatorReportTarget(quest, null), {
    questId: "park",
    revision: 3,
    title: "Current public title",
  });
  assert.deepEqual(creatorReportTarget(quest, part), {
    questId: "park",
    revision: 1,
    title: "Accepted title",
  });
  assert.deepEqual(creatorReportTarget(null, part), {
    questId: "park",
    revision: 1,
    title: "Accepted title",
  });
  assert.equal(
    creatorReportTarget(quest, { ...part, questId: "another" }),
    null,
  );
  for (const patch of [
    { revision: 0 },
    { revision: 1.5 },
    { revision: "1" },
    { domain: "native" },
  ])
    assert.equal(creatorReportTarget(null, { ...part, ...patch }), null);
});

test("opposite block intent supersedes an unconfirmed earlier toggle before another deliberate block", async () => {
  const storage = memory(),
    calls = [];
  let sequence = 0,
    lose = true,
    blocked = false;
  const fetcher = async (_, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    blocked = body.blocked;
    if (lose) {
      lose = false;
      throw new TypeError("Lost after block committed");
    }
    return Response.json({
      domain: "demo",
      operationId: body.operationId,
      blocked,
    });
  };
  let client = createCreatorClient({
    playerId: "viewer",
    storage,
    fetcher,
    makeId: () => `safety-toggle-${++sequence}`,
  });
  await assert.rejects(
    client.mutate("/creators/author/block", "PUT", { blocked: true }),
  );
  assert.equal(blocked, true);
  client = createCreatorClient({
    playerId: "viewer",
    storage,
    fetcher,
    makeId: () => `safety-toggle-${++sequence}`,
  });
  await client.mutate("/creators/author/block", "PUT", { blocked: false });
  await client.mutate("/creators/author/block", "PUT", { blocked: true });
  assert.equal(new Set(calls.map((x) => x.operationId)).size, 3);
  assert.equal(blocked, true);
});

test("a lost private report response recovers through the real API after the creator is blocked", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const author = createPlayer(db, "Private author", Date.now()),
    viewer = createPlayer(db, "Private walker", Date.now());
  db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author);
  const services = createCreatorServices(db, {
    policy: { version: "test-safety-200", xpCommitment: 200 },
    isModerator: (a) => a === "reviewer",
  });
  services.community.saveProfile({
    actor: author,
    operationId: "report-profile",
    expectedVersion: 0,
    profile: {
      displayName: "Riverkeeper",
      bio: "Public park stories",
      public: true,
    },
    publicConsent: true,
  });
  services.lifecycle.createDraft({
    actor: author,
    operationId: "report-draft",
    questId: "park",
    draft: {
      title: "Park details",
      description: "Stay on the public footpath.",
    },
  });
  services.lifecycle.submit({
    actor: author,
    operationId: "report-submit",
    questId: "park",
    expectedVersion: 1,
    expectedPolicyVersion: "test-safety-200",
  });
  services.lifecycle.review({
    actor: "reviewer",
    operationId: "report-review",
    questId: "park",
    expectedVersion: 2,
    decision: "approve",
    reason: "Reviewed public interaction point.",
  });
  services.lifecycle.start({
    actor: viewer,
    operationId: "report-start",
    questId: "park",
  });
  services.safety.setBlocked({
    actor: viewer,
    operationId: "report-block",
    creatorId: author,
    blocked: true,
  });
  const api = createCreatorApi({
    ...services,
    authenticate: () => viewer,
    origin: "https://questlayer.example",
    enabled: true,
  });
  const storage = memory(),
    calls = [];
  let lose = true;
  const fetcher = async (path, init) => {
    calls.push(JSON.parse(init.body).operationId);
    const response = await api(
      new Request("https://questlayer.example" + path, {
        ...init,
        headers: { ...init.headers, origin: "https://questlayer.example" },
      }),
    );
    assert.equal(response.status, 200);
    if (lose) {
      lose = false;
      throw new TypeError("Lost private report receipt");
    }
    return response;
  };
  const body = {
    revision: 1,
    reason: "unsafe-place",
    detail: "Private concern about the described entrance.",
  };
  let client = createCreatorClient({ playerId: viewer, storage, fetcher });
  await assert.rejects(
    client.mutate("/quests/park/reports", "POST", body),
    /Lost private report receipt/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM creator_reports").get().n, 1);
  client = createCreatorClient({ playerId: viewer, storage, fetcher });
  const receipt = await client.mutate("/quests/park/reports", "POST", body);
  assert.equal(calls[0], calls[1]);
  assert.equal(receipt.report.revision, 1);
  assert.equal(receipt.command, "reportCreatorQuest");
  assert(!JSON.stringify(receipt).includes(body.detail));
  assert(![...storage.values.values()].join().includes(body.detail));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM creator_reports").get().n, 1);
  assert.equal(
    services.community.myParticipation(viewer, "park").content.description,
    "Stay on the public footpath.",
  );
  assert.equal(
    services.community.myParticipation(viewer, "park").creator.displayName,
    null,
  );
});
test("creator capability never relabels native, paid or unconfigured policy data as this demo feature", () => {
  const cap = {
    enabled: true,
    domain: "demo",
    native: false,
    rewards: "not-configured",
    policy: { version: "test-only-200", xpCommitment: 200 },
    reviewConfigured: true,
    completionConfigured: true,
  };
  assert.deepEqual(parseCreatorCapability(cap), cap);
  for (const change of [
    { native: true },
    { domain: "native" },
    { rewards: "cash" },
    { policy: null },
    { policy: { version: "bad/", xpCommitment: 200 } },
    { policy: { version: "test", xpCommitment: 0 } },
  ])
    assert.equal(parseCreatorCapability({ ...cap, ...change }), null);
  assert.equal(
    parseCreatorCapability({ ...cap, enabled: false, policy: null }).enabled,
    false,
  );
});
test("a lost confirmed response retries the same durable operation ID through the actual creator API", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const actor = createPlayer(db, "Private explorer", Date.now());
  const services = createCreatorServices(db, {
    policy: { version: "test-only-200", xpCommitment: 200 },
  });
  const api = createCreatorApi({
    ...services,
    origin: "https://questlayer.example",
    authenticate: () => actor,
    enabled: true,
  });
  const storage = memory(),
    calls = [];
  let lose = true;
  const fetcher = async (path, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.operationId);
    assert.equal(init.credentials, "same-origin");
    const response = await api(
      new Request("https://questlayer.example" + path, {
        ...init,
        headers: { ...init.headers, origin: "https://questlayer.example" },
      }),
    );
    if (lose) {
      lose = false;
      throw new TypeError("Lost after server commit");
    }
    return response;
  };
  const body = {
    expectedVersion: 0,
    profile: {
      displayName: "Riverkeeper",
      bio: "Private draft phrase",
      public: true,
    },
    publicConsent: true,
  };
  const first = createCreatorClient({ playerId: actor, fetcher, storage });
  await assert.rejects(
    first.mutate("/profile", "PUT", body),
    /Lost after server commit/,
  );
  assert.equal(services.community.myProfile(actor).version, 1);
  const saved = [...storage.values.values()].join();
  assert(!saved.includes("Private draft phrase"));
  assert(!saved.includes("publicConsent"));
  assert(!saved.includes("Riverkeeper"));
  const restored = createCreatorClient({ playerId: actor, fetcher, storage });
  const receipt = await restored.mutate("/profile", "PUT", body);
  assert.equal(receipt.operationId, calls[0]);
  assert.equal(calls[0], calls[1]);
  assert.equal(services.community.myProfile(actor).version, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM creator_operations").get().n,
    1,
  );
});
test("a later identical follow intent receives a new ID after the earlier intent was confirmed", async () => {
  const storage = memory(),
    calls = [];
  let next = 0;
  const client = createCreatorClient({
    playerId: "viewer",
    storage,
    makeId: () => `ui-${++next}`,
    fetcher: async (_, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return Response.json({
        domain: "demo",
        operationId: body.operationId,
        following: body.following,
      });
    },
  });
  await client.mutate("/creators/author/follow", "PUT", { following: true });
  await client.mutate("/creators/author/follow", "PUT", { following: false });
  await client.mutate("/creators/author/follow", "PUT", { following: true });
  assert.equal(new Set(calls.map((c) => c.operationId)).size, 3);
  assert.equal(calls[2].following, true);
});
test("an unmatched success receipt is not acknowledged and a deliberate retry retains the original ID", async () => {
  const calls = [],
    storage = memory();
  let wrong = true;
  const fetcher = async (_, init) => {
    const b = JSON.parse(init.body);
    calls.push(b.operationId);
    return Response.json({
      domain: "demo",
      operationId: wrong ? "foreign-operation" : b.operationId,
    });
  };
  const client = createCreatorClient({ playerId: "viewer", storage, fetcher });
  await assert.rejects(
    client.mutate("/quests/river/participation", "POST", {}),
    /matching demo receipt/,
  );
  wrong = false;
  await client.mutate("/quests/river/participation", "POST", {});
  assert.equal(calls[0], calls[1]);
});
test("changed terms and different actors do not inherit an unknown operation's ID", async () => {
  const calls = [],
    storage = memory();
  let sequence = 0;
  const fetcher = async (_, init) => {
    calls.push(JSON.parse(init.body));
    throw new TypeError("Unknown outcome");
  };
  const a = createCreatorClient({
    playerId: "author-a",
    storage,
    fetcher,
    makeId: () => `ui-${++sequence}`,
  });
  const b = createCreatorClient({
    playerId: "author-b",
    storage,
    fetcher,
    makeId: () => `ui-${++sequence}`,
  });
  await assert.rejects(
    a.mutate("/quests", "POST", {
      questId: "river",
      draft: { title: "A", description: "Clue A" },
    }),
  );
  await assert.rejects(
    a.mutate("/quests", "POST", {
      questId: "river",
      draft: { title: "A", description: "Clue B" },
    }),
  );
  await assert.rejects(
    b.mutate("/quests", "POST", {
      questId: "river",
      draft: { title: "A", description: "Clue A" },
    }),
  );
  assert.equal(new Set(calls.map((c) => c.operationId)).size, 3);
  assert.equal(storage.values.size, 2);
});
test("new quest identity persists through an uncertain create and clears only its own slot", () => {
  const storage = memory(),
    a = creatorDraftIdentity("author-a", storage);
  assert.equal(creatorDraftIdentity("author-a", storage).id, a.id);
  const b = creatorDraftIdentity("author-b", storage);
  assert.notEqual(a.id, b.id);
  a.clear();
  assert.notEqual(creatorDraftIdentity("author-a", storage).id, a.id);
  assert.equal(creatorDraftIdentity("author-b", storage).id, b.id);
});
test("unavailable storage permits same-tab safe retry without claiming reload durability", async () => {
  let lose = true;
  const ids = [];
  const client = createCreatorClient({
    playerId: "author",
    storage: null,
    fetcher: async (_, init) => {
      const body = JSON.parse(init.body);
      ids.push(body.operationId);
      if (lose) {
        lose = false;
        throw new TypeError("lost");
      }
      return Response.json({ domain: "demo", operationId: body.operationId });
    },
  });
  assert.equal(client.durable, false);
  await assert.rejects(
    client.mutate("/quests/river/close", "POST", { expectedVersion: 4 }),
  );
  await client.mutate("/quests/river/close", "POST", { expectedVersion: 4 });
  assert.equal(ids[0], ids[1]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { SocialContent } from "../server/social-content.mjs";
import { Moderation } from "../server/moderation.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { createOperatorConsole } from "../server/operator/console.mjs";
import { ensureWorld, HOME } from "../server/world.mjs";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const TOKEN = "t".repeat(40);

async function fixture(t) {
  const db = openDatabase(":memory:");
  const author = createPlayer(db, "Author", NOW),
    viewer = createPlayer(db, "Viewer", NOW);
  const social = new SocialContent(db, { clock: () => NOW });
  const moderation = new Moderation(db, {
    clock: () => NOW,
    authorizeOperator: (a) => a === "lubos",
  });
  await ensureWorld(db, HOME, true, NOW);
  const noteId = "message_00000001-1111-1111-1111-111111111111";
  db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)").run(
    noteId,
    author,
    "Bench by the river.",
    49.75,
    13.38,
    null,
    null,
    NOW,
  );
  db.prepare("INSERT INTO social_note_meta VALUES(?,1,'published',?)").run(
    noteId,
    NOW,
  );
  social.report(viewer, noteId, { reason: "spam" });
  const handle = createOperatorConsole(db, {
    operator: "lubos",
    token: TOKEN,
    moderation,
    clock: () => NOW,
    assets: { "/": { body: "<!doctype html>", type: "text/html" } },
  });
  const server = createServer(handle);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { body, token = TOKEN, headers = {} } = {}) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  // fetch cannot override Host, so a raw request shows the rebinding check.
  const withHost = (path, host) =>
    new Promise((resolve, reject) => {
      const req = request(
        base + path,
        { headers: { host, authorization: `Bearer ${TOKEN}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
  return { db, noteId, call, withHost };
}

test("the console needs the start token and a loopback host", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("/", { token: null })).status, 200);
  assert.equal((await f.call("/api/report", { token: null })).status, 401);
  assert.equal(
    (await f.call("/api/report", { token: "x".repeat(40) })).status,
    401,
  );
  assert.equal(await f.withHost("/api/report", "evil.example"), 403);
  assert.equal(await f.withHost("/api/report", "localhost:1"), 200);
  const plain = await f.call("/api/world/pause", {
    body: {},
    headers: { "content-type": "text/plain" },
  });
  assert.equal(plain.status, 415);
});

test("the console shows health and the moderation queue and runs audited actions as its operator", async (t) => {
  const f = await fixture(t);
  const report = await (await f.call("/api/report")).json();
  assert.equal(report.cities[0].worlds.length, 1);
  const queue = await (await f.call("/api/moderation/queue")).json();
  assert.equal(queue.items[0].targetId, f.noteId);

  // A body cannot pick another actor; the console acts as its own operator.
  const paused = await f.call("/api/world/pause", {
    body: {
      actor: "someone-else",
      cityId: PLZEN.id,
      day: "2026-11-02",
      zone: 3,
      reason: "Road works",
      expectedVersion: 0,
    },
  });
  assert.equal(paused.status, 200);
  assert.equal((await paused.json()).actor, "lubos");
  const versions = await (
    await f.call(`/api/world/versions?cityId=${PLZEN.id}&day=2026-11-02`)
  ).json();
  assert.deepEqual(versions.pauses["zone:3"], { state: "paused", version: 1 });
  const stale = await f.call("/api/world/resume", {
    body: {
      cityId: PLZEN.id,
      day: "2026-11-02",
      zone: 3,
      reason: "Done",
      expectedVersion: 0,
    },
  });
  assert.equal(stale.status, 409);

  const preview = await (
    await f.call("/api/world/adjust?preview=1", {
      body: {
        cityId: PLZEN.id,
        day: "2026-11-06",
        excludeCandidates: [PLZEN.candidates[0].id],
        reason: "Market day",
        expectedVersion: 0,
      },
    })
  ).json();
  assert.equal(preview.preview, true);
  assert.equal(preview.zones.length, 6);

  const decided = await f.call("/api/moderation/decide", {
    body: { kind: "note", targetId: f.noteId, action: "hide", reason: "Spam" },
  });
  assert.equal(decided.status, 200);
  const audit = await (await f.call("/api/audit")).json();
  assert.equal(audit.world[0].actor, "lubos");
  assert.equal(audit.world[0].kind, "pause");
  assert.equal(audit.moderation[0].operator, "lubos");
  assert.equal(audit.moderationChain.ok, true);
});

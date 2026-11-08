import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createWorkshopStore } from "../server/gotchiverse/store.mjs";
import { createWorkshopRoutes } from "../server/gotchiverse/routes.mjs";
import {
  naturalCell,
  changedCell,
  movePoint,
} from "../src/gotchiverse-model.ts";
import {
  initialAppNavigation,
  parseAppNavigation,
} from "../src/app-navigation.ts";
const alice = { id: "explorer-alice", name: "Alice" },
  bob = { id: "explorer-bob", name: "Bob" },
  eve = { id: "explorer-eve", name: "Eve" };
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-gotchi-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, store: createWorkshopStore({ directory, ...options }) };
}
const edit = (w, overrides = {}) => ({
  workshopId: w.id,
  revision: w.revision,
  requestId: "unique-change-id-0001",
  x: 3,
  z: 4,
  cell: { height: 3, material: "stone", object: null },
  ...overrides,
});
test("workshop edits and receipts persist across store restart without a wallet", (t) => {
  const { directory, store } = fixture(t);
  const w = store.open(alice);
  const input = edit(w);
  store.edit(alice, input);
  const restarted = createWorkshopStore({ directory });
  const recovered = restarted.edit(alice, input);
  assert.equal(recovered.alreadySaved, true);
  assert.equal(recovered.workshop.revision, 1);
  assert.equal(recovered.workshop.cells["3,4"].height, 3);
  assert.equal(statSync(join(directory, w.id + ".json")).mode & 0o777, 0o600);
  assert.equal(store.open(alice).id, w.id);
});
test("foreign actors cannot read, edit, invite or administer another workshop", (t) => {
  const { store } = fixture(t),
    w = store.open(alice);
  for (const fn of [
    () => store.get(eve, w.id),
    () => store.edit(eve, edit(w)),
    () => store.invite(eve, w.id),
    () => store.revoke(eve, w.id, bob.id),
  ])
    assert.throws(fn, (e) => e.status === 403);
  assert.throws(
    () => store.get(alice, "../../private"),
    (e) => e.status === 400,
  );
  assert.equal(store.get(alice, w.id).revision, 0);
});
test("stale concurrent edits never overwrite another builder and a reused ID cannot change its payload", (t) => {
  const { store, directory } = fixture(t),
    w = store.open(alice);
  const invitation = store.invite(alice, w.id);
  store.join(bob, invitation.token);
  const a = store.get(alice, w.id),
    b = store.get(bob, w.id);
  store.edit(alice, edit(a));
  const second = createWorkshopStore({ directory });
  assert.throws(
    () => second.edit(bob, edit(b, { x: 4 })),
    (e) => e.code === "WORKSHOP_CONFLICT",
  );
  assert.throws(
    () => store.edit(alice, edit(a, { x: 8 })),
    (e) => e.code === "WORKSHOP_REPLAY",
  );
  assert.equal(second.get(bob, w.id).cells["3,4"].material, "stone");
  assert.equal(second.get(bob, w.id).cells["4,4"], undefined);
});
test("one-use invitations expire, do not leak in views and revocation blocks both fresh and replayed edits", (t) => {
  let clock = 100000;
  const { store } = fixture(t, { now: () => clock });
  const w = store.open(alice);
  const invite = store.invite(alice, w.id);
  assert.equal(
    JSON.stringify(store.get(alice, w.id)).includes(invite.token),
    false,
  );
  const joined = store.join(bob, invite.token);
  assert.equal(joined.role, "editor");
  assert.deepEqual(joined.members, []);
  assert.throws(
    () => store.join(eve, invite.token),
    (e) => e.code === "WORKSHOP_INVITE_EXPIRED",
  );
  const input = edit(joined);
  store.edit(bob, input);
  store.revoke(alice, w.id, bob.id);
  assert.throws(
    () => store.edit(bob, input),
    (e) => e.status === 403,
  );
  const expired = store.invite(alice, w.id);
  clock += 86400001;
  assert.throws(
    () => store.join(eve, expired.token),
    (e) => e.status === 403,
  );
});
test("an interrupted write preserves the old build and can safely retry", (t) => {
  let fail = false;
  const { store, directory } = fixture(t, {
    beforeCommit: () => {
      if (fail) throw Error("synthetic storage failure");
    },
  });
  const w = store.open(alice);
  fail = true;
  assert.throws(() => store.edit(alice, edit(w)), /synthetic storage failure/);
  assert.equal(store.get(alice, w.id).revision, 0);
  fail = false;
  store.edit(alice, edit(w));
  assert.equal(
    JSON.parse(readFileSync(join(directory, w.id + ".json"), "utf8")).revision,
    1,
  );
});
test("malformed coordinates, heights and objects do not grow workshop state", (t) => {
  const { store } = fixture(t),
    w = store.open(alice);
  for (const patch of [
    { x: -1 },
    { z: 16 },
    { x: "__proto__" },
    { revision: -1 },
    { cell: { height: 999, material: "grass", object: null } },
    { cell: { height: 1, material: "script", object: null } },
    { cell: { height: 1, material: "grass", object: "owned-nft" } },
  ])
    assert.throws(() => store.edit(alice, edit(w, patch)));
  assert.equal(store.get(alice, w.id).revision, 0);
});
test("the building objective counts altered cells once and preserves its completion receipt", (t) => {
  const { store } = fixture(t, { now: () => 123456 });
  let w = store.open(alice);
  w = store.edit(alice, edit(w, { cell: naturalCell(3, 4) })).workshop;
  assert.equal(w.progress.shaped, 0);
  for (let x = 0; x < 3; x++)
    w = store.edit(
      alice,
      edit(w, {
        requestId: `unique-building-${x}`,
        x,
        cell: {
          height: 3,
          material: "sand",
          object: x === 2 ? "lantern" : null,
        },
      }),
    ).workshop;
  assert.equal(w.progress.shaped, 3);
  assert.equal(w.progress.completedAt, 123456);
  w = store.edit(
    alice,
    edit(w, {
      requestId: "remove-the-object-01",
      x: 2,
      cell: { height: 3, material: "sand", object: null },
    }),
  ).workshop;
  assert.equal(w.progress.completedAt, 123456);
});
test("logout during a streamed new-world write is rechecked before any terrain mutation", async (t) => {
  const { store } = fixture(t),
    w = store.open(alice);
  let authenticated = alice.id;
  const respond = () => assert.fail("A revoked request must not succeed");
  const routes = createWorkshopRoutes({
    store,
    authenticate: () => authenticated,
    actorFor: () => alice,
  });
  const payload = JSON.stringify(edit(w));
  const req = Readable.from(
    (async function* () {
      yield Buffer.from(payload.slice(0, 10));
      authenticated = null;
      yield Buffer.from(payload.slice(10));
    })(),
  );
  req.method = "POST";
  req.headers = { "content-type": "application/json" };
  const check = (ok, message, status) => {
    if (!ok) throw Object.assign(Error(message), { status });
  };
  await assert.rejects(
    routes.handle(req, {}, new URL("http://localhost/api/gotchiverse/edit"), {
      player: alice.id,
      respond,
      assert: check,
    }),
    (e) => e.status === 401,
  );
  assert.equal(store.get(alice, w.id).revision, 0);
});
test("new-world JSON bodies are bounded and cross-site writes are refused", async (t) => {
  const { store } = fixture(t);
  const routes = createWorkshopRoutes({
    store,
    authenticate: () => alice.id,
    actorFor: () => alice,
  });
  const check = (ok, message, status) => {
    if (!ok) throw Object.assign(Error(message), { status });
  };
  for (const [headers, data, status] of [
    [
      { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      "{}",
      403,
    ],
    [{ "content-type": "application/json" }, " ".repeat(8193), 413],
    [{ "content-type": "application/json-patch" }, "{}", 415],
  ]) {
    const req = Readable.from([Buffer.from(data)]);
    req.method = "POST";
    req.headers = headers;
    await assert.rejects(
      routes.handle(req, {}, new URL("http://localhost/api/gotchiverse/open"), {
        player: alice.id,
        respond: () => assert.fail(),
        assert: check,
      }),
      (e) => e.status === status,
    );
  }
});
test("virtual navigation keeps the physical objective intact and rejects virtual values as GPS evidence", () => {
  const target = {
    worldId: "demo:arena-plzen:day",
    zoneId: "zone-1",
    questId: "quest-1",
    realm: "arena",
  };
  const n = parseAppNavigation(
    { ...initialAppNavigation(), tab: "gotchiverse", demoTarget: target },
    alice.id,
  );
  assert.deepEqual(n.demoTarget, target);
  assert.equal(n.tab, "gotchiverse");
  assert.equal(
    parseAppNavigation(
      {
        ...initialAppNavigation(),
        demoTarget: { ...target, realm: "gotchiverse" },
      },
      alice.id,
    ),
    null,
  );
  assert.deepEqual(movePoint([0, 15], -1, 1), [0, 15]);
  assert.equal(
    changedCell({ height: 5, material: "grass", object: null }, "raise"),
    null,
  );
});
test("friend presence uses only bounded virtual coordinates, expires and loses access on revocation", (t) => {
  let clock = 100000;
  const { store } = fixture(t, { now: () => clock }),
    w = store.open(alice);
  store.join(bob, store.invite(alice, w.id).token);
  store.visit(bob, w.id, [2, 3]);
  assert.deepEqual(store.get(alice, w.id).visitors, [
    { id: bob.id, name: bob.name, x: 2, z: 3 },
  ]);
  assert.equal(store.get(alice, w.id).revision, 2);
  assert.throws(() => store.visit(bob, w.id, [49.74, 13.37]));
  clock += 20001;
  assert.deepEqual(store.get(alice, w.id).visitors, []);
  store.visit(bob, w.id, [4, 5]);
  store.revoke(alice, w.id, bob.id);
  assert.deepEqual(store.get(alice, w.id).visitors, []);
  assert.throws(
    () => store.visit(bob, w.id, [0, 0]),
    (e) => e.status === 403,
  );
});

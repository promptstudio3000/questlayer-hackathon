import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { GOLD, DAY } from "../server/domain.mjs";
import * as m from "../server/market/service.mjs";
import { createMarketRoutes } from "../server/market/routes.mjs";

const now = Date.parse("2026-11-04T12:00:00Z");
const PLZEN = { lat: 49.7475, lng: 13.3776 };
const fix = (p = PLZEN, t = now) => ({ ...p, accuracy: 8, timestamp: t });
const gold = (db, p) => db.prepare("SELECT gold_u FROM players WHERE id=?").get(p).gold_u;
const fees = (db) => db.prepare("SELECT COALESCE(SUM(amount_u),0) AS n FROM mk_fees").get().n;
function setup() {
  const db = openDatabase(":memory:");
  const alice = createPlayer(db, "Alice", now),
    bob = createPlayer(db, "Bob", now),
    cyril = createPlayer(db, "Cyril", now);
  return { db, alice, bob, cyril, start: gold(db, alice) };
}
const total = (db, players) => players.reduce((s, p) => s + gold(db, p), 0);
const conserved = (db, players, before) => {
  const st = m.marketStats(db);
  assert.equal(total(db, players) + st.held.tasks + st.held.secrets + st.held.transfers + st.fees, before);
  assert.ok(m.marketInvariant(db).ok);
};

test("fee is 10 % on top, rounded up", () => {
  assert.equal(m.feeOnTop(10 * GOLD), GOLD);
  assert.equal(m.feeOnTop(1), 1);
  assert.equal(m.feeOnTop(15), 2);
});

test("auto GPS task: poster pays reward + 10 %, worker gets reward, treasury fee", () => {
  const { db, alice, bob, start } = setup();
  const before = total(db, [alice, bob]);
  const t = m.createTask(db, alice, { title: "Visit the cathedral", type: "go", ...PLZEN, reward: 10 * GOLD }, now);
  assert.equal(t.charged, 11 * GOLD);
  assert.equal(gold(db, alice), start - 11 * GOLD);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  assert.throws(() => m.submitClaim(db, bob, c.id, { fix: fix({ lat: 49.76, lng: 13.38 }) }, now), /closer/);
  const r = m.submitClaim(db, bob, c.id, { fix: fix() }, now);
  assert.equal(r.state, "paid");
  assert.equal(gold(db, bob), start + 10 * GOLD);
  assert.equal(fees(db), GOLD);
  assert.equal(m.getTask(db, alice, t.id, undefined, now).state, "done");
  conserved(db, [alice, bob], before);
});

test("visibility: private link, named user and group", () => {
  const { db, alice, bob, cyril } = setup();
  const priv = m.createTask(db, alice, { title: "Secret errand", visibility: "private", type: "photo", ...PLZEN, reward: GOLD }, now);
  assert.ok(priv.linkKey);
  assert.throws(() => m.getTask(db, bob, priv.id, undefined, now), /not available/);
  assert.equal(m.getTask(db, bob, priv.id, priv.linkKey, now).id, priv.id);
  const named = m.createTask(db, alice, { title: "Just for Bob", visibility: "user", assignee: bob, type: "photo", ...PLZEN, reward: GOLD }, now);
  assert.throws(() => m.reserveTask(db, cyril, named.id, {}, now), /not available/);
  m.reserveTask(db, bob, named.id, {}, now);
  assert.equal(m.nearby(db, bob, PLZEN, now).forMe.length + m.nearby(db, bob, PLZEN, now).taking.length >= 1, true);
  assert.throws(() => m.createTask(db, alice, { title: "Group run", visibility: "group", group: [bob], ...PLZEN, reward: GOLD }, now), /2–20/);
  const g = m.createTask(db, alice, { title: "Group run", visibility: "group", group: [bob, cyril], ...PLZEN, reward: GOLD }, now);
  assert.equal(m.getTask(db, cyril, g.id, undefined, now).id, g.id);
  // Public listing never shows private, link or group tasks.
  assert.deepEqual(m.nearby(db, cyril, PLZEN, now).tasks.map((x) => x.id), []);
});

test("review task: reject, dispute, moderator pays; cancel blocked while disputed", () => {
  const { db, alice, bob } = setup();
  const before = total(db, [alice, bob]);
  const t = m.createTask(db, alice, { title: "Photograph the fountain", type: "photo", ...PLZEN, reward: 5 * GOLD }, now);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  assert.throws(() => m.submitClaim(db, bob, c.id, { evidence: "short" }, now), /ten characters/);
  m.submitClaim(db, bob, c.id, { evidence: "Photo uploaded to the note at the fountain." }, now);
  m.reviewClaim(db, alice, c.id, false, "Wrong fountain", now);
  m.disputeClaim(db, bob, c.id, "It is the right one, see the plaque", now);
  assert.throws(() => m.cancelTask(db, alice, t.id, now), /dispute/);
  m.resolveDispute(db, c.id, true, now);
  assert.equal(fees(db), m.feeOnTop(5 * GOLD));
  conserved(db, [alice, bob], before);
});

test("cancel and expiry refund reward and fee; unreviewed proof pays after 72 h", () => {
  const { db, alice, bob, start } = setup();
  const t = m.createTask(db, alice, { title: "Bring a leaflet", type: "deliver", payoutMode: "review", ...PLZEN, reward: 2 * GOLD, slots: 3 }, now);
  assert.equal(gold(db, alice), start - 6.6 * GOLD);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  m.submitClaim(db, bob, c.id, { fix: fix() }, now);
  const later = now + 73 * 3_600_000;
  m.getTask(db, alice, t.id, undefined, later); // sweep pays the overdue proof
  assert.equal(gold(db, bob), start + 2 * GOLD);
  m.cancelTask(db, alice, t.id, later);
  assert.equal(gold(db, alice), start - 2 * GOLD - m.feeOnTop(2 * GOLD));
  const e = m.createTask(db, alice, { title: "Expires soon", type: "go", ...PLZEN, reward: GOLD, days: 1 }, now);
  m.getTask(db, alice, e.id, undefined, now + 2 * DAY);
  assert.equal(m.getTask(db, alice, e.id, undefined, now + 2 * DAY).state, "expired");
  assert.ok(m.marketInvariant(db).ok);
});

test("answer task pays the right answer only; counteroffer charges the difference + 10 %", () => {
  const { db, alice, bob, cyril, start } = setup();
  const t = m.createTask(db, alice, { title: "What year is on the gate?", type: "answer", answer: "1295", ...PLZEN, reward: GOLD, slots: 2 }, now);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  assert.equal(m.submitClaim(db, bob, c.id, { answer: "1300" }, now).correct, false);
  assert.equal(m.submitClaim(db, bob, c.id, { answer: " 1295 " }, now).state, "paid");
  const o = m.createTask(db, alice, { title: "Carry a box", type: "create", ...PLZEN, reward: 10 * GOLD }, now);
  const offer = m.reserveTask(db, cyril, o.id, { offer: 15 * GOLD }, now);
  assert.equal(offer.state, "offered");
  const before = gold(db, alice);
  assert.equal(m.acceptOffer(db, alice, offer.id, now).charged, 5.5 * GOLD);
  assert.equal(gold(db, alice), before - 5.5 * GOLD);
  m.submitClaim(db, cyril, offer.id, { evidence: "Box delivered to the café." }, now);
  m.reviewClaim(db, alice, offer.id, true, "", now);
  assert.equal(gold(db, cyril), start + 15 * GOLD);
  assert.ok(m.marketInvariant(db).ok);
});

test("chain step needs the previous step; recurring limits slots per round", () => {
  const { db, alice, bob, cyril } = setup();
  const a = m.createTask(db, alice, { title: "Step one", type: "go", ...PLZEN, reward: GOLD }, now);
  const b = m.createTask(db, alice, { title: "Step two", type: "chain", parentId: a.id, ...PLZEN, reward: GOLD }, now);
  assert.throws(() => m.reserveTask(db, bob, b.id, {}, now), /previous step/);
  const c = m.reserveTask(db, bob, a.id, {}, now);
  m.submitClaim(db, bob, c.id, { fix: fix() }, now);
  m.reserveTask(db, bob, b.id, {}, now);
  const r = m.createTask(db, alice, { title: "Weekly clean-up", type: "recurring", rounds: 3, everyDays: 7, ...PLZEN, reward: GOLD }, now);
  m.reserveTask(db, bob, r.id, {}, now);
  assert.throws(() => m.reserveTask(db, cyril, r.id, {}, now), /taken/);
  m.reserveTask(db, cyril, r.id, {}, now + 8 * DAY);
});

test("Secret: fog hides the place, reveal pays 90/10 after a visit or 7 days; dispute refunds", () => {
  const { db, alice, bob, cyril, start } = setup();
  const before = total(db, [alice, bob, cyril]);
  const s = m.createSecret(db, alice, { title: "Hidden courtyard", reveal: "Through the blue door, second yard.", ...PLZEN, fix: fix(), price: 10 * GOLD }, now);
  const hidden = m.getSecret(db, bob, s.id, { from: PLZEN }, now);
  assert.equal(hidden.place, undefined);
  assert.equal(hidden.inside, true);
  assert.ok(Math.hypot(hidden.fog.lat - PLZEN.lat, hidden.fog.lng - PLZEN.lng) > 0);
  m.revealSecret(db, bob, s.id, {}, now);
  assert.deepEqual(m.getSecret(db, bob, s.id, {}, now).place, { lat: PLZEN.lat, lng: PLZEN.lng });
  m.visitSecret(db, bob, s.id, fix(), now);
  assert.equal(gold(db, alice), start + 9 * GOLD);
  m.revealSecret(db, cyril, s.id, {}, now);
  m.getSecret(db, alice, s.id, {}, now + 8 * DAY);
  assert.equal(gold(db, alice), start + 18 * GOLD);
  assert.equal(fees(db), 2 * GOLD);
  const s2 = m.createSecret(db, alice, { title: "Fake view", reveal: "Nothing here really, sorry.", ...PLZEN, fix: fix(), price: GOLD }, now);
  m.revealSecret(db, bob, s2.id, {}, now);
  m.disputeReveal(db, bob, s2.id, "The place does not exist", now);
  const rev = db.prepare("SELECT id FROM mk_reveals WHERE secret_id=? AND buyer=?").get(s2.id, bob).id;
  m.resolveReveal(db, rev, true, now);
  conserved(db, [alice, bob, cyril], before);
});

test("sponsored Secret is free to reveal and pays visit rewards from the sponsor; private needs the link", () => {
  const { db, alice, bob, cyril, start } = setup();
  const s = m.createSecret(db, alice, { kind: "sponsored", title: "Café discovery", reveal: "Say the word 'aura' at the bar.", ...PLZEN, fix: fix(), visitReward: GOLD, visits: 2 }, now);
  assert.equal(s.charged, 2.2 * GOLD);
  m.revealSecret(db, bob, s.id, {}, now);
  assert.equal(m.visitSecret(db, bob, s.id, fix(), now).reward, GOLD);
  assert.equal(gold(db, bob), start + GOLD);
  const p = m.createSecret(db, alice, { kind: "private", title: "For friends", reveal: "Meet at the old tree at dusk.", ...PLZEN, fix: fix() }, now);
  assert.throws(() => m.revealSecret(db, cyril, p.id, {}, now), /not available/);
  m.revealSecret(db, cyril, p.id, { linkKey: p.linkKey }, now);
  assert.equal(m.nearby(db, cyril, PLZEN, now).secrets.some((x) => x.id === p.id), false);
  assert.throws(() => m.createSecret(db, alice, { title: "Far away", reveal: "Not where I stand at all.", lat: 50.08, lng: 14.42, fix: fix() }, now), /closer/);
});

test("conditional sends: both confirm, timed, GPS; decline refunds; no fee", () => {
  const { db, alice, bob, start } = setup();
  const before = total(db, [alice, bob]);
  const a = m.createTransfer(db, alice, { to: bob, amount: 3 * GOLD }, now);
  assert.equal(m.actOnTransfer(db, bob, a.id, "confirm", {}, now).state, "held");
  assert.throws(() => m.actOnTransfer(db, alice, a.id, "cancel", {}, now), /confirmed/);
  assert.equal(m.actOnTransfer(db, alice, a.id, "confirm", {}, now).state, "released");
  const t = m.createTransfer(db, alice, { to: bob, amount: GOLD, condition: "after", at: now + DAY }, now);
  assert.equal(m.listTransfers(db, bob, now + 2 * DAY).find((x) => x.id === t.id).state, "released");
  const g = m.createTransfer(db, alice, { to: bob, amount: GOLD, condition: "gps", place: PLZEN }, now);
  assert.throws(() => m.actOnTransfer(db, bob, g.id, "arrive", { fix: fix({ lat: 49.8, lng: 13.4 }) }, now), /closer/);
  m.actOnTransfer(db, bob, g.id, "arrive", { fix: fix() }, now);
  const d = m.createTransfer(db, alice, { to: bob, amount: GOLD }, now);
  m.actOnTransfer(db, bob, d.id, "decline", {}, now);
  assert.equal(gold(db, bob), start + 5 * GOLD);
  assert.equal(fees(db), 0);
  conserved(db, [alice, bob], before);
});

test("routes mount under /api/market and gate moderators", async () => {
  const { db, alice, bob } = setup();
  const routes = createMarketRoutes({ db, isModerator: (p) => p === bob, clock: () => now });
  const call = async (player, method, path, data) => {
    let out;
    const req = { method, async *[Symbol.asyncIterator]() {} };
    const handled = await routes.handle(req, {}, new URL(`http://x${path}`), {
      player,
      body: async () => data,
      respond: (_res, body, status = 200) => (out = { status, body }),
      assert: (c, msg, status = 400) => {
        if (!c) throw Object.assign(new Error(msg), { status });
      },
    });
    return handled ? out : null;
  };
  const created = await call(alice, "POST", "/api/market/tasks", { title: "Route test", ...PLZEN, reward: GOLD });
  assert.equal(created.status, 201);
  const near = await call(bob, "GET", `/api/market/nearby?lat=${PLZEN.lat}&lng=${PLZEN.lng}`);
  assert.equal(near.body.tasks[0].id, created.body.id);
  await assert.rejects(call(alice, "POST", "/api/market/task/resolve", { claimId: "x" }), /moderator/);
  assert.equal(await call(alice, "GET", "/api/other"), null);
});

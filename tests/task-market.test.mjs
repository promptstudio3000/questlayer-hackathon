import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { GOLD, DAY } from "../server/domain.mjs";
import * as m from "../server/market/service.mjs";
import * as chain from "../server/market/chain.mjs";
import { createMarketRoutes } from "../server/market/routes.mjs";
import { escrowFundingView } from "./fixtures/escrow-funding.mjs";
import { mockDelivery } from "./fixtures/escrow-delivery.mjs";

const now = Date.parse("2026-11-04T12:00:00Z");
const PLZEN = { lat: 49.7475, lng: 13.3776 };
const ESCROW = { contractId: "escrow.testnet", tokenId: "qgold.testnet", treasuryId: "treasury.testnet", publisherId: "pub.testnet" };
const fix = (p = PLZEN, t = now) => ({ ...p, accuracy: 8, timestamp: t });
const gold = (db, p) => db.prepare("SELECT gold_u FROM players WHERE id=?").get(p).gold_u;
const fees = (db) => db.prepare("SELECT COALESCE(SUM(amount_u),0) AS n FROM mk_fees").get().n;
const ACC = { Alice: "alice.testnet", Bob: "bob.testnet", Cyril: "cyril.testnet" };
function setup({ accounts = true } = {}) {
  chain.setEscrowConfig(ESCROW);
  const db = openDatabase(":memory:");
  const ids = {};
  for (const name of ["Alice", "Bob", "Cyril"]) {
    ids[name.toLowerCase()] = createPlayer(db, name, now);
    if (accounts) db.prepare("UPDATE players SET native_account=? WHERE id=?").run(ACC[name], ids[name.toLowerCase()]);
  }
  return { db, ...ids, start: gold(db, ids.alice) };
}
/** Escrow calls queued since the last look, as "method arg" strings. */
function ops(db) {
  const rows = db.prepare("SELECT * FROM mk_chain_ops WHERE state='queued' ORDER BY seq").all();
  db.prepare("UPDATE mk_chain_ops SET state='sent' WHERE state='queued'").run();
  return rows.map((r) => {
    const a = JSON.parse(r.args);
    return [r.method, a.id ?? a.account_id, a.worker, a.pay ?? a.refund].filter((x) => x !== undefined).join(" ");
  });
}
/** Simulates the player's ft_transfer_call landing in the escrow. */
function fund(db, r, at = now) {
  assert.equal(r.funding.methodName, "ft_transfer_call");
  assert.equal(r.funding.receiverId, ESCROW.tokenId);
  assert.equal(r.funding.args.receiver_id, ESCROW.contractId);
  assert.equal(r.funding.deposit, "1");
  const f = db.prepare("SELECT * FROM mk_fundings WHERE id=?").get(r.funding.id);
  assert.ok(chain.markFunded(db, f, m.ACTIVATE, at, escrowFundingView(f, at)));
  return JSON.parse(f.msg);
}

test("fee is 10 % on top, rounded up", () => {
  assert.equal(m.feeOnTop(10 * GOLD), GOLD);
  assert.equal(m.feeOnTop(1), 1);
  assert.equal(m.feeOnTop(15), 2);
});

test("the market never touches players.gold_u and needs a NEAR account and the escrow", () => {
  const { db, alice, start } = setup({ accounts: false });
  assert.throws(() => m.createTask(db, alice, { title: "Visit the cathedral", ...PLZEN, reward: GOLD }, now), /NEAR account/);
  chain.setEscrowConfig(null);
  db.prepare("UPDATE players SET native_account='alice.testnet' WHERE id=?").run(alice);
  assert.throws(() => m.createTask(db, alice, { title: "Visit the cathedral", ...PLZEN, reward: GOLD }, now), /not open yet/);
  chain.setEscrowConfig(ESCROW);
  m.createTask(db, alice, { title: "Visit the cathedral", ...PLZEN, reward: GOLD }, now);
  assert.equal(gold(db, alice), start);
});

test("auto GPS task: funded by ft_transfer_call, paid by approve_task, credit pushed out", () => {
  const { db, alice, bob, start } = setup();
  const t = m.createTask(db, alice, { title: "Visit the cathedral", type: "go", ...PLZEN, reward: 10 * GOLD }, now);
  assert.equal(t.charged, 11 * GOLD);
  assert.equal(t.state, "funding");
  assert.equal(t.funding.args.amount, String(11 * GOLD));
  assert.deepEqual(JSON.parse(t.funding.args.msg), { kind: "task", id: t.id, reward: String(10 * GOLD), deadline_ms: String(now + 7 * DAY), slots: 1 });
  // Not listed and not takeable before the QGOLD arrives.
  assert.deepEqual(m.nearby(db, bob, PLZEN, now).tasks, []);
  assert.throws(() => m.reserveTask(db, bob, t.id, {}, now), /closed/);
  fund(db, t);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  assert.throws(() => m.submitClaim(db, bob, c.id, { fix: fix({ lat: 49.76, lng: 13.38 }) }, now), /closer/);
  assert.equal(m.submitClaim(db, bob, c.id, { fix: fix() }, now).state, "paid");
  assert.deepEqual(ops(db), [`approve_task ${t.id} bob.testnet`, "withdraw_for bob.testnet", "withdraw_for treasury.testnet"]);
  assert.equal(fees(db), GOLD);
  assert.equal(m.getTask(db, alice, t.id, undefined, now).state, "done");
  assert.equal(gold(db, bob), start);
  assert.ok(m.marketInvariant(db).ok);
});

test("visibility: private link, named user (assignee on chain) and group", () => {
  const { db, alice, bob, cyril } = setup();
  const priv = m.createTask(db, alice, { title: "Secret errand", visibility: "private", type: "photo", ...PLZEN, reward: GOLD }, now);
  fund(db, priv);
  assert.ok(priv.linkKey);
  assert.throws(() => m.getTask(db, bob, priv.id, undefined, now), /not available/);
  assert.equal(m.getTask(db, bob, priv.id, priv.linkKey, now).id, priv.id);
  const named = m.createTask(db, alice, { title: "Just for Bob", visibility: "user", assignee: bob, type: "photo", ...PLZEN, reward: GOLD }, now);
  assert.equal(fund(db, named).assignee, "bob.testnet");
  assert.throws(() => m.reserveTask(db, cyril, named.id, {}, now), /not available/);
  m.reserveTask(db, bob, named.id, {}, now);
  assert.ok(m.nearby(db, bob, PLZEN, now).taking.length >= 1);
  assert.throws(() => m.createTask(db, alice, { title: "Group run", visibility: "group", group: [bob], ...PLZEN, reward: GOLD }, now), /2–20/);
  const g = m.createTask(db, alice, { title: "Group run", visibility: "group", group: [bob, cyril], ...PLZEN, reward: GOLD }, now);
  fund(db, g);
  assert.equal(m.getTask(db, cyril, g.id, undefined, now).id, g.id);
  assert.deepEqual(m.nearby(db, cyril, PLZEN, now).tasks.map((x) => x.id), []);
});

test("review task: proof holds its slot on chain; reject frees it; moderator pays", () => {
  const { db, alice, bob } = setup();
  const t = m.createTask(db, alice, { title: "Photograph the fountain", type: "photo", ...PLZEN, reward: 5 * GOLD }, now);
  fund(db, t);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  assert.throws(() => m.submitClaim(db, bob, c.id, { evidence: "short" }, now), /ten characters/);
  m.submitClaim(db, bob, c.id, { evidence: "Photo uploaded to the note at the fountain." }, now);
  assert.deepEqual(ops(db), [`open_dispute ${t.id} bob.testnet`]);
  m.reviewClaim(db, alice, c.id, false, "Wrong fountain", now);
  assert.deepEqual(ops(db), [`resolve_dispute ${t.id} bob.testnet false`]);
  m.disputeClaim(db, bob, c.id, "It is the right one, see the plaque", now);
  assert.throws(() => m.cancelTask(db, alice, t.id, now), /dispute/);
  m.resolveDispute(db, c.id, true, now);
  assert.deepEqual(ops(db), [`approve_task ${t.id} bob.testnet`, "withdraw_for bob.testnet", "withdraw_for treasury.testnet"]);
  assert.equal(fees(db), m.feeOnTop(5 * GOLD));
  assert.ok(m.marketInvariant(db).ok);
});

test("cancel and expiry refund through cancel_task; unreviewed proof pays after 72 h", () => {
  const { db, alice, bob } = setup();
  const t = m.createTask(db, alice, { title: "Bring a leaflet", type: "deliver", payoutMode: "review", ...PLZEN, reward: 2 * GOLD, slots: 3 }, now);
  assert.equal(t.charged, 6.6 * GOLD);
  assert.equal(fund(db, t).slots, 3);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  m.submitClaim(db, bob, c.id, { fix: fix() }, now);
  ops(db);
  const later = now + 73 * 3_600_000;
  m.getTask(db, alice, t.id, undefined, later); // sweep pays the overdue proof
  assert.deepEqual(ops(db), [`resolve_dispute ${t.id} bob.testnet true`, "withdraw_for bob.testnet", "withdraw_for treasury.testnet"]);
  assert.equal(m.cancelTask(db, alice, t.id, later).refunded, 4 * GOLD + 2 * GOLD * 0.1 * 2);
  assert.deepEqual(ops(db), [`cancel_task ${t.id}`, "withdraw_for alice.testnet"]);
  const e = m.createTask(db, alice, { title: "Expires soon", type: "go", ...PLZEN, reward: GOLD, days: 1 }, now);
  fund(db, e);
  assert.equal(m.getTask(db, alice, e.id, undefined, now + 2 * DAY).state, "expired");
  assert.deepEqual(ops(db), [`cancel_task ${e.id}`, "withdraw_for alice.testnet"]);
  assert.ok(m.marketInvariant(db).ok);
});

test("answer task pays the right answer only; counteroffer extra is its own escrow", () => {
  const { db, alice, bob, cyril } = setup();
  const t = m.createTask(db, alice, { title: "What year is on the gate?", type: "answer", answer: "1295", ...PLZEN, reward: GOLD, slots: 2 }, now);
  fund(db, t);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  assert.equal(m.submitClaim(db, bob, c.id, { answer: "1300" }, now).correct, false);
  assert.equal(m.submitClaim(db, bob, c.id, { answer: " 1295 " }, now).state, "paid");
  assert.throws(() => m.reserveTask(db, bob, t.id, {}, now), /already/);
  ops(db);
  const o = m.createTask(db, alice, { title: "Carry a box", type: "create", ...PLZEN, reward: 10 * GOLD }, now);
  fund(db, o);
  const offer = m.reserveTask(db, cyril, o.id, { offer: 15 * GOLD }, now);
  assert.equal(offer.state, "offered");
  const acc = m.acceptOffer(db, alice, offer.id, now);
  assert.equal(acc.charged, 5.5 * GOLD);
  // Asking again before signing returns the same payment.
  assert.equal(m.acceptOffer(db, alice, offer.id, now).funding.id, acc.funding.id);
  const msg = fund(db, acc);
  assert.deepEqual([msg.reward, msg.slots, msg.assignee], [String(5 * GOLD), 1, "cyril.testnet"]);
  m.submitClaim(db, cyril, offer.id, { evidence: "Box delivered to the café." }, now);
  m.reviewClaim(db, alice, offer.id, true, "", now);
  assert.deepEqual(ops(db), [
    `open_dispute ${o.id} cyril.testnet`,
    `resolve_dispute ${o.id} cyril.testnet true`,
    `approve_task ${acc.funding.id} cyril.testnet`,
    "withdraw_for cyril.testnet",
    "withdraw_for treasury.testnet",
  ]);
  assert.ok(m.marketInvariant(db).ok);
});

test("chain step needs the previous step; recurring limits slots per round and 50 in all", () => {
  const { db, alice, bob, cyril } = setup();
  const a = m.createTask(db, alice, { title: "Step one", type: "go", ...PLZEN, reward: GOLD }, now);
  fund(db, a);
  const b = m.createTask(db, alice, { title: "Step two", type: "chain", parentId: a.id, ...PLZEN, reward: GOLD }, now);
  fund(db, b);
  assert.throws(() => m.reserveTask(db, bob, b.id, {}, now), /previous step/);
  const c = m.reserveTask(db, bob, a.id, {}, now);
  m.submitClaim(db, bob, c.id, { fix: fix() }, now);
  m.reserveTask(db, bob, b.id, {}, now);
  const r = m.createTask(db, alice, { title: "Weekly clean-up", type: "recurring", rounds: 3, everyDays: 7, ...PLZEN, reward: GOLD }, now);
  assert.equal(fund(db, r).slots, 3);
  m.reserveTask(db, bob, r.id, {}, now);
  assert.throws(() => m.reserveTask(db, cyril, r.id, {}, now), /taken/);
  m.reserveTask(db, cyril, r.id, {}, now + 8 * DAY);
  assert.throws(() => m.createTask(db, alice, { title: "Too many", ...PLZEN, reward: GOLD, slots: 20, type: "recurring", rounds: 3 }, now), /50/);
});

test("Secret: reveal is funded by the buyer; visit, 7 days or moderator release; refund on dispute", () => {
  const { db, alice, bob, cyril } = setup();
  const s = m.createSecret(db, alice, { title: "Hidden courtyard", reveal: "Through the blue door, second yard.", ...PLZEN, fix: fix(), price: 10 * GOLD }, now);
  assert.equal(s.state, "open");
  const hidden = m.getSecret(db, bob, s.id, { from: PLZEN }, now);
  assert.equal(hidden.place, undefined);
  assert.equal(hidden.inside, true);
  const r = m.revealSecret(db, bob, s.id, {}, now);
  assert.equal(r.state, "funding");
  assert.deepEqual(JSON.parse(r.funding.args.msg), { kind: "secret", id: r.id, secret_id: s.id, creator: "alice.testnet", price: String(10 * GOLD) });
  assert.equal(m.getSecret(db, bob, s.id, {}, now).place, undefined); // not paid yet
  assert.equal(m.revealSecret(db, bob, s.id, {}, now).funding.id, r.id);
  fund(db, r);
  assert.deepEqual(m.getSecret(db, bob, s.id, {}, now).place, { lat: PLZEN.lat, lng: PLZEN.lng });
  m.visitSecret(db, bob, s.id, fix(), now);
  assert.deepEqual(ops(db), [`confirm_visit ${r.id}`, "withdraw_for alice.testnet", "withdraw_for treasury.testnet"]);
  const r2 = m.revealSecret(db, cyril, s.id, {}, now);
  fund(db, r2, now + DAY);
  m.getSecret(db, alice, s.id, {}, now + 7 * DAY); // 7 days count from the funding
  assert.deepEqual(ops(db), []);
  m.getSecret(db, alice, s.id, {}, now + 9 * DAY);
  assert.deepEqual(ops(db), [`release_secret ${r2.id}`, "withdraw_for alice.testnet", "withdraw_for treasury.testnet"]);
  assert.equal(fees(db), 2 * GOLD);
  const s2 = m.createSecret(db, alice, { title: "Fake view", reveal: "Nothing here really, sorry.", ...PLZEN, fix: fix(), price: GOLD }, now);
  fund(db, m.revealSecret(db, bob, s2.id, {}, now));
  m.disputeReveal(db, bob, s2.id, "The place does not exist", now);
  const rev = db.prepare("SELECT id FROM mk_reveals WHERE secret_id=? AND buyer=?").get(s2.id, bob).id;
  m.resolveReveal(db, rev, true, now);
  assert.deepEqual(ops(db), [`dispute_secret ${rev}`, `resolve_secret ${rev} true`, "withdraw_for bob.testnet"]);
  assert.ok(m.marketInvariant(db).ok);
});

test("sponsored Secret: sponsor funds a slot per finder; private needs the link", () => {
  const { db, alice, bob, cyril } = setup();
  const s = m.createSecret(db, alice, { kind: "sponsored", title: "Café discovery", reveal: "Say the word 'aura' at the bar.", ...PLZEN, fix: fix(), visitReward: GOLD, visits: 2 }, now);
  assert.equal(s.charged, 2.2 * GOLD);
  assert.equal(s.state, "funding");
  assert.equal(fund(db, s).slots, 2);
  m.revealSecret(db, bob, s.id, {}, now);
  assert.equal(m.visitSecret(db, bob, s.id, fix(), now).reward, GOLD);
  assert.deepEqual(ops(db), [`approve_task ${s.id} bob.testnet`, "withdraw_for bob.testnet", "withdraw_for treasury.testnet"]);
  assert.equal(m.closeSecret(db, alice, s.id, now).refunded, 1.1 * GOLD);
  assert.deepEqual(ops(db), [`cancel_task ${s.id}`, "withdraw_for alice.testnet"]);
  assert.throws(() => m.createSecret(db, alice, { kind: "sponsored", title: "Too many", reveal: "Far too many visits here.", ...PLZEN, fix: fix(), visitReward: GOLD, visits: 51 }, now), /1–50/);
  const p = m.createSecret(db, alice, { kind: "private", title: "For friends", reveal: "Meet at the old tree at dusk.", ...PLZEN, fix: fix() }, now);
  assert.throws(() => m.revealSecret(db, cyril, p.id, {}, now), /not available/);
  m.revealSecret(db, cyril, p.id, { linkKey: p.linkKey }, now);
  assert.equal(m.nearby(db, cyril, PLZEN, now).secrets.some((x) => x.id === p.id), false);
  assert.throws(() => m.createSecret(db, alice, { title: "Far away", reveal: "Not where I stand at all.", lat: 50.08, lng: 14.42, fix: fix() }, now), /closer/);
});

test("conditional sends map to escrow transfers; no fee", () => {
  const { db, alice, bob } = setup();
  const a = m.createTransfer(db, alice, { to: bob, amount: 3 * GOLD }, now);
  assert.deepEqual(JSON.parse(a.funding.args.msg), { kind: "transfer", id: a.id, to: "bob.testnet", condition: { type: "both_confirm" }, expires_ms: String(now + 7 * DAY) });
  fund(db, a);
  assert.equal(m.actOnTransfer(db, bob, a.id, "confirm", {}, now).state, "held");
  assert.throws(() => m.actOnTransfer(db, alice, a.id, "cancel", {}, now), /expires/);
  assert.equal(m.actOnTransfer(db, alice, a.id, "confirm", {}, now).state, "released");
  assert.deepEqual(ops(db), [`confirm_transfer ${a.id}`, "withdraw_for bob.testnet"]);
  const t = m.createTransfer(db, alice, { to: bob, amount: GOLD, condition: "after", at: now + DAY }, now);
  assert.deepEqual(JSON.parse(t.funding.args.msg).condition, { type: "after", at_ms: String(now + DAY) });
  fund(db, t);
  assert.equal(m.listTransfers(db, bob, now + 2 * DAY).find((x) => x.id === t.id).state, "released");
  assert.deepEqual(ops(db), [`release_transfer ${t.id}`, "withdraw_for bob.testnet"]);
  const g = m.createTransfer(db, alice, { to: bob, amount: GOLD, condition: "gps", place: PLZEN }, now);
  assert.deepEqual(JSON.parse(g.funding.args.msg).condition, { type: "gps", place_id: g.id, radius_m: 60 });
  fund(db, g);
  assert.throws(() => m.actOnTransfer(db, bob, g.id, "arrive", { fix: fix({ lat: 49.8, lng: 13.4 }) }, now), /closer/);
  m.actOnTransfer(db, bob, g.id, "arrive", { fix: fix() }, now);
  const d = m.createTransfer(db, alice, { to: bob, amount: GOLD }, now);
  fund(db, d);
  m.actOnTransfer(db, bob, d.id, "decline", {}, now);
  assert.deepEqual(ops(db), [`confirm_transfer_gps ${g.id}`, "withdraw_for bob.testnet", `decline_transfer ${d.id}`, "withdraw_for alice.testnet"]);
  assert.equal(fees(db), 0);
  assert.ok(m.marketInvariant(db).ok);
});

test("escrow worker: confirms matching fundings, drops stale ones, sends calls in order", async () => {
  const { db, alice, bob } = setup();
  const t = m.createTask(db, alice, { title: "Visit the cathedral", type: "go", ...PLZEN, reward: 5 * GOLD, slots: 2 }, now);
  const stale = m.createTransfer(db, alice, { to: bob, amount: GOLD }, now);
  const views = {
    [t.id]: escrowFundingView(db.prepare("SELECT * FROM mk_fundings WHERE id=?").get(t.id)),
  };
  const calls = [];
  const run = (at, call = async (method, args) => (calls.push(`${method} ${args.id ?? args.account_id}`), "tx")) =>
    chain.runEscrowWorker(db, { view: async (method, args) => method === "get_credit" ? "100" : views[args.id] ?? null,
      call: mockDelivery(call), activate: m.ACTIVATE, drop: m.DROP, now: at });
  // A funding from another account does not count.
  views[stale.id] = { sender: "mallory.testnet", to: "bob.testnet", amount: String(GOLD) };
  let r = await run(now);
  assert.equal(r.funded, 1);
  assert.equal(m.getTask(db, alice, t.id, undefined, now).state, "open");
  delete views[stale.id];
  r = await run(now + 3 * 3_600_000);
  assert.equal(r.dropped, 1);
  assert.equal(m.listTransfers(db, alice, now).find((x) => x.id === stale.id).state, "unfunded");
  const c = m.reserveTask(db, bob, t.id, {}, now);
  m.submitClaim(db, bob, c.id, { fix: fix() }, now);
  r = await run(now + 3 * 3_600_000);
  assert.deepEqual(calls, [`approve_task ${t.id}`, "withdraw_for bob.testnet", "withdraw_for treasury.testnet"]);
  // Error text alone proves nothing; the original signed attempt stays pending.
  m.cancelTask(db, alice, t.id, now);
  calls.length = 0;
  r = await run(now + 4 * 3_600_000, async (method) => {
    if (method === "cancel_task") throw Error("Smart contract panicked: Task is closed");
    throw Error("RPC timeout");
  });
  assert.deepEqual([r.sent, r.pending], [0, 1]);
  const left = db.prepare("SELECT method,state,attempts FROM mk_chain_ops WHERE state!='sent'").all().map((r) => ({ ...r }));
  assert.deepEqual(left, [{ method: "cancel_task", state: "queued", attempts: 1 }, { method: "withdraw_for", state: "queued", attempts: 0 }]);
  assert.equal(chain.escrowHealth(db).queued, 2);
});

test("an unverified review hold cannot trigger a guessed approval or bypass a failed operation", async () => {
  const { db, alice, bob } = setup();
  const t = m.createTask(db, alice, { title: "Photograph the fountain", type: "photo", ...PLZEN, reward: GOLD }, now);
  fund(db, t);
  const c = m.reserveTask(db, bob, t.id, {}, now);
  m.submitClaim(db, bob, c.id, { evidence: "Photo uploaded to the note at the fountain." }, now);
  m.reviewClaim(db, alice, c.id, true, "", now);
  const calls = [];
  await chain.runEscrowWorker(db, {
    view: async () => null,
    activate: m.ACTIVATE,
    drop: m.DROP,
    now,
    call: mockDelivery(async (method, args) => {
      calls.push(method);
      if (method === "open_dispute") throw Error("Smart contract panicked: Escrow is paused");
      if (method === "resolve_dispute") throw Error("Smart contract panicked: No open dispute for this worker");
      return "tx";
    }),
  });
  assert.deepEqual(calls, ["open_dispute"]); // the failing hold blocks this task's later calls
  db.prepare("UPDATE mk_chain_ops SET state='failed' WHERE method='open_dispute'").run();
  calls.length = 0;
  await chain.runEscrowWorker(db, {
    view: async () => null, activate: m.ACTIVATE, drop: m.DROP, now: now + 3_600_000,
    call: mockDelivery(async (method) => {
      calls.push(method);
      if (method === "resolve_dispute") throw Error("Smart contract panicked: No open dispute for this worker");
      return "tx";
    }),
  });
  assert.deepEqual(calls, []);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mk_delivery_attempts").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mk_chain_ops WHERE method='approve_task'").get().n, 0);
});

test("routes mount under /api/market, confirm a funding and gate moderators", async () => {
  const { db, alice, bob } = setup();
  const views = {};
  const routes = createMarketRoutes({ db, isModerator: (p) => p === bob, clock: () => now, escrowView: async (_m, a) => views[a.id] ?? null });
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
  assert.equal((await call(alice, "POST", "/api/market/funded", { id: created.body.id })).body.state, "waiting");
  views[created.body.id] = escrowFundingView(db.prepare("SELECT * FROM mk_fundings WHERE id=?").get(created.body.id));
  await assert.rejects(call(bob, "POST", "/api/market/funded", { id: created.body.id }), /Unknown payment/);
  assert.equal((await call(alice, "POST", "/api/market/funded", { id: created.body.id })).body.state, "funded");
  const near = await call(bob, "GET", `/api/market/nearby?lat=${PLZEN.lat}&lng=${PLZEN.lng}`);
  assert.equal(near.body.tasks[0].id, created.body.id);
  assert.equal((await call(bob, "GET", "/api/market/escrow")).body.contractId, ESCROW.contractId);
  await assert.rejects(call(alice, "POST", "/api/market/task/resolve", { claimId: "x" }), /moderator/);
  assert.equal(await call(alice, "GET", "/api/other"), null);
});

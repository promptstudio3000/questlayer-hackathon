import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { GOLD, DAY } from "../server/domain.mjs";
import * as market from "../server/market/service.mjs";
import * as chain from "../server/market/chain.mjs";
import { escrowFundingView } from "./fixtures/escrow-funding.mjs";
import { fundingAssessment } from "../server/market/funding.mjs";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const PLACE = { lat: 49.7475, lng: 13.3776 };
function fixture(t, filename = ":memory:") {
  chain.setEscrowConfig({ contractId: "escrow.testnet", tokenId: "qgold.testnet", treasuryId: "treasury.testnet" });
  const db = openDatabase(filename);
  t.after(() => { if (db.isOpen) db.close(); });
  const alice = createPlayer(db, "Alice", NOW), bob = createPlayer(db, "Bob", NOW);
  db.prepare("UPDATE players SET native_account=? WHERE id=?").run("alice.testnet", alice);
  db.prepare("UPDATE players SET native_account=? WHERE id=?").run("bob.testnet", bob);
  const row = (id) => db.prepare("SELECT * FROM mk_fundings WHERE id=?").get(id);
  const task = (extra = {}) => market.createTask(db, alice, { title: "Visit the cathedral", ...PLACE, reward: GOLD, ...extra }, NOW);
  const secret = () => {
    const s = market.createSecret(db, alice, { title: "A hidden courtyard", teaser: "A quiet place to explore", reveal: "Go through the archway.", ...PLACE, fix: { ...PLACE, accuracy: 8, timestamp: NOW }, price: GOLD }, NOW);
    return { secret: s, ...market.revealSecret(db, bob, s.id, {}, NOW) };
  };
  const transfer = (extra = {}) => market.createTransfer(db, alice, { to: bob, amount: GOLD, ...extra }, NOW);
  const confirm = (id, view, now = NOW) => chain.checkFunding(db, id, row(id).player, { view: async () => view, activate: market.ACTIVATE, now });
  const run = (view, extra = {}) => chain.runEscrowWorker(db, {
    view, call: async () => "test-tx", activate: market.ACTIVATE, drop: market.DROP, now: NOW,
    maxOps: 0, ...extra,
  });
  return { db, alice, bob, row, task, secret, transfer, confirm, run };
}

test("funding rejects an escrow with a different task deadline", async (t) => {
  const f = fixture(t), task = f.task();
  const view = escrowFundingView(f.row(task.id));
  view.deadline_ms = String(NOW + DAY);
  assert.equal((await f.confirm(task.id, view)).state, "waiting");
  assert.equal(f.db.prepare("SELECT state FROM mk_tasks WHERE id=?").get(task.id).state, "funding");
});

test("a payment for a different Secret never reveals this Secret", async (t) => {
  const f = fixture(t), purchase = f.secret();
  const view = escrowFundingView(f.row(purchase.id));
  view.secret_id = "different-secret";
  assert.equal((await f.confirm(purchase.id, view)).state, "waiting");
  assert.equal(market.getSecret(f.db, f.bob, purchase.secret.id, {}, NOW).revealed, false);
});

test("a refunded Secret payment is reconciled without granting access", async (t) => {
  const f = fixture(t), purchase = f.secret();
  const view = { ...escrowFundingView(f.row(purchase.id)), status: "refunded" };
  await f.confirm(purchase.id, view);
  assert.equal(market.getSecret(f.db, f.bob, purchase.secret.id, {}, NOW).revealed, false);
  assert.deepEqual({ ...f.db.prepare("SELECT state,held_u FROM mk_reveals WHERE id=?").get(purchase.id) }, { state: "refunded", held_u: 0 });
});

test("already released Secret payment keeps legitimate access without another release", async (t) => {
  const f = fixture(t), purchase = f.secret();
  const view = { ...escrowFundingView(f.row(purchase.id)), status: "released" };
  await Promise.all([f.confirm(purchase.id, view), f.confirm(purchase.id, view)]);
  assert.equal(market.getSecret(f.db, f.bob, purchase.secret.id, {}, NOW).revealed, true);
  assert.deepEqual({ ...f.db.prepare("SELECT state,held_u FROM mk_reveals WHERE id=?").get(purchase.id) }, { state: "released", held_u: 0 });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mk_fees WHERE ref=?").get(purchase.id).n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mk_chain_ops WHERE method!='withdraw_for'").get().n, 0);
});

test("Secret hold and dispute window start at chain funding, not worker recovery", async (t) => {
  const f = fixture(t), purchase = f.secret();
  await f.confirm(purchase.id, escrowFundingView(f.row(purchase.id)), NOW + 2 * DAY);
  assert.equal(f.db.prepare("SELECT created_at FROM mk_reveals WHERE id=?").get(purchase.id).created_at, NOW);
});

test("transfer funding binds the complete release condition and expiry", async (t) => {
  const f = fixture(t), transfer = f.transfer();
  const original = escrowFundingView(f.row(transfer.id));
  for (const view of [
    { ...original, condition: { type: "after", at_ms: String(NOW) } },
    { ...original, expires_ms: String(NOW + DAY) },
  ]) assert.equal((await f.confirm(transfer.id, view)).state, "waiting");
});

test("refunded and released transfers do not reopen held money", async (t) => {
  const f = fixture(t);
  for (const status of ["refunded", "released"]) {
    const transfer = f.transfer();
    const view = { ...escrowFundingView(f.row(transfer.id)), status,
      sender_confirmed: status === "released", receiver_confirmed: status === "released" };
    await f.confirm(transfer.id, view);
    assert.deepEqual({ ...f.db.prepare("SELECT state,held_u FROM mk_transfers WHERE id=?").get(transfer.id) }, { state: status, held_u: 0 });
  }
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mk_chain_ops WHERE method!='withdraw_for'").get().n, 0);
});

test("cancelled task collateral cannot reopen a payable task", async (t) => {
  const f = fixture(t), task = f.task();
  const view = { ...escrowFundingView(f.row(task.id)), refunded_slots: 1, open_slots: 0, held: "0", status: "refunded" };
  await f.confirm(task.id, view);
  const row = f.db.prepare("SELECT state,held_u,fee_held_u FROM mk_tasks WHERE id=?").get(task.id);
  assert.deepEqual({ ...row }, { state: "cancelled", held_u: 0, fee_held_u: 0 });
  assert.throws(() => market.reserveTask(f.db, f.bob, task.id, {}, NOW), /closed/);
});

test("a stale successful check cannot resurrect a dropped funding", async (t) => {
  const f = fixture(t), task = f.task(), snapshot = f.row(task.id);
  const response = await chain.checkFunding(f.db, task.id, f.alice, {
    activate: market.ACTIVATE, now: NOW,
    view: async () => {
      chain.dropFunding(f.db, snapshot, market.DROP, NOW);
      return escrowFundingView(snapshot);
    },
  });
  assert.equal(response.state, "dropped");
  assert.equal(f.row(task.id).state, "dropped");
});

test("an intent changed while RPC was in flight cannot use the old evidence", async (t) => {
  const f = fixture(t), task = f.task(), snapshot = f.row(task.id);
  const response = await chain.checkFunding(f.db, task.id, f.alice, {
    activate: market.ACTIVATE, now: NOW,
    view: async () => {
      f.db.prepare("UPDATE mk_fundings SET account='other.testnet' WHERE id=?").run(task.id);
      return escrowFundingView(snapshot);
    },
  });
  assert.equal(response.state, "waiting");
});

test("markFunded cannot activate without an authoritative agreement snapshot", (t) => {
  const f = fixture(t), task = f.task();
  assert.equal(chain.markFunded(f.db, f.row(task.id), market.ACTIVATE, NOW), false);
});

test("undefined RPC data is not authoritative absence and cannot drop a payment", async (t) => {
  const f = fixture(t), task = f.task();
  await f.run(async () => undefined, { now: NOW + 3 * 3_600_000 });
  assert.equal(f.row(task.id).state, "waiting");
});

test("task funding binds identity, fees, allocation and complete collateral", (t) => {
  const f = fixture(t), task = f.task(), intent = f.row(task.id), good = escrowFundingView(intent);
  assert.ok(fundingAssessment(intent, good));
  const mutations = {
    id: "another-id", poster: "another.testnet", reward: "1", fee: "0", slots: 2,
    reward_per_slot: "0", assignee: "bob.testnet", deadline_ms: undefined, held: "0",
    created_at_ms: good.deadline_ms, paid_slots: 1, refunded_slots: 1, open_slots: 0,
    paid_workers: ["bob.testnet"], open_disputes: ["bob.testnet"], rejected_disputes: ["bob.testnet"],
    status: "unexpected",
  };
  for (const [field, value] of Object.entries(mutations))
    assert.equal(fundingAssessment(intent, { ...good, [field]: value }), null, field);
  for (const amount_u of [intent.amount_u + 1, Number.MAX_SAFE_INTEGER + 1, 1.5])
    assert.equal(fundingAssessment({ ...intent, amount_u }, good), null);
  for (const value of [GOLD, "01", "1e6", "-1", "340282366920938463463374607431768211456"])
    assert.equal(fundingAssessment(intent, { ...good, reward: value }), null);
});

test("Secret funding binds its owner, amount, identity and seven-day window", (t) => {
  const f = fixture(t), purchase = f.secret(), intent = f.row(purchase.id), good = escrowFundingView(intent);
  const mutations = { id: "wrong", buyer: "other.testnet", creator: "other.testnet", secret_id: undefined,
    price: "0", creator_share: "0", fee: "0", funded_at_ms: "9007199254740992",
    auto_release_at_ms: String(NOW + 8 * DAY), status: "unknown" };
  for (const [field, value] of Object.entries(mutations))
    assert.equal(fundingAssessment(intent, { ...good, [field]: value }), null, field);
});

test("GPS and timed transfers bind every condition field and confirmation flag", (t) => {
  const f = fixture(t);
  for (const extra of [{ condition: "gps", place: PLACE }, { condition: "after", at: NOW + DAY }]) {
    const transfer = f.transfer(extra), intent = f.row(transfer.id), good = escrowFundingView(intent);
    assert.ok(fundingAssessment(intent, good));
    const changes = extra.condition === "gps" ? [{ place_id: "another-place" }, { radius_m: 1 }] : [{ at_ms: String(NOW + 2 * DAY) }];
    for (const change of [...changes, { unexpected: true }])
      assert.equal(fundingAssessment(intent, { ...good, condition: { ...good.condition, ...change } }), null);
    for (const [field, value] of Object.entries({ id: "wrong", sender: "other.testnet", to: "other.testnet",
      amount: "0", expires_ms: undefined, created_at_ms: good.expires_ms, sender_confirmed: true,
      receiver_confirmed: null, status: "unknown" }))
      assert.equal(fundingAssessment(intent, { ...good, [field]: value }), null, field);
  }
});

test("a fully paid task stays complete and records the fee once", async (t) => {
  const f = fixture(t), task = f.task();
  const paid = { ...escrowFundingView(f.row(task.id)), status: "paid", paid_slots: 1, open_slots: 0,
    paid_workers: ["bob.testnet"], held: "0" };
  await Promise.all([f.confirm(task.id, paid), f.run(async () => paid)]);
  assert.deepEqual({ ...f.db.prepare("SELECT state,held_u,fee_held_u,paid_slots FROM mk_tasks WHERE id=?").get(task.id) },
    { state: "done", held_u: 0, fee_held_u: 0, paid_slots: 1 });
  assert.equal(f.db.prepare("SELECT SUM(amount_u) n FROM mk_fees WHERE ref=?").get(task.id).n, GOLD / 10);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mk_chain_ops WHERE method!='withdraw_for'").get().n, 0);
  assert.throws(() => market.reserveTask(f.db, f.bob, task.id, {}, NOW), /closed/);
  assert.ok(market.marketInvariant(f.db).ok);
});

test("settled sponsored Secrets cannot invent new finder rewards", async (t) => {
  const f = fixture(t);
  for (const status of ["paid", "refunded"]) {
    const secret = market.createSecret(f.db, f.alice, { kind: "sponsored", title: "Cafe discovery",
      reveal: "Ask for the courtyard tour.", ...PLACE, fix: { ...PLACE, accuracy: 8, timestamp: NOW },
      visitReward: GOLD, visits: 1 }, NOW);
    const view = { ...escrowFundingView(f.row(secret.id)), status, held: "0", open_slots: 0,
      paid_slots: Number(status === "paid"), refunded_slots: Number(status === "refunded"),
      paid_workers: status === "paid" ? ["bob.testnet"] : [] };
    await f.confirm(secret.id, view);
    assert.deepEqual({ ...f.db.prepare("SELECT state,held_u,fee_held_u,visits_left FROM mk_secrets WHERE id=?").get(secret.id) },
      { state: status === "paid" ? "done" : "closed", held_u: 0, fee_held_u: 0, visits_left: 0 });
  }
  assert.ok(market.marketInvariant(f.db).ok);
});

test("partially spent tasks and consumed counteroffers stay unresolved", async (t) => {
  const f = fixture(t), task = f.task({ slots: 2 }), intent = f.row(task.id);
  const partial = { ...escrowFundingView(intent), paid_slots: 1, open_slots: 1,
    paid_workers: ["bob.testnet"], held: String(intent.amount_u / 2) };
  assert.equal((await f.confirm(task.id, partial)).state, "waiting");
  assert.equal(f.db.prepare("SELECT state FROM mk_tasks WHERE id=?").get(task.id).state, "funding");
  const offer = { ...intent, target: "offer", ref: "claim" };
  const refunded = { ...escrowFundingView(offer), status: "refunded", open_slots: 0, refunded_slots: 2, held: "0" };
  assert.equal(fundingAssessment(offer, refunded), null);
});

test("a pre-existing dispute is not automatically released after recovery", async (t) => {
  const f = fixture(t), purchase = f.secret();
  await f.confirm(purchase.id, { ...escrowFundingView(f.row(purchase.id)), status: "disputed" });
  market.getSecret(f.db, f.bob, purchase.secret.id, {}, NOW + 8 * DAY);
  assert.deepEqual({ ...f.db.prepare("SELECT state,held_u FROM mk_reveals WHERE id=?").get(purchase.id) },
    { state: "disputed", held_u: GOLD });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mk_chain_ops").get().n, 0);
});

test("a transfer keeps an existing on-chain confirmation without asking again", async (t) => {
  const f = fixture(t), transfer = f.transfer();
  await f.confirm(transfer.id, { ...escrowFundingView(f.row(transfer.id)), sender_confirmed: true });
  assert.deepEqual({ ...f.db.prepare("SELECT sender_ok,receiver_ok,state FROM mk_transfers WHERE id=?").get(transfer.id) },
    { sender_ok: 1, receiver_ok: 0, state: "held" });
});

test("activation failure rolls back its funding claim and all effects before retry", async (t) => {
  const f = fixture(t), purchase = f.secret(), snapshot = f.row(purchase.id);
  const released = { ...escrowFundingView(snapshot), status: "released" };
  const failing = { ...market.ACTIVATE, reveal: (...args) => { market.ACTIVATE.reveal(...args); throw Error("interrupted"); } };
  assert.throws(() => chain.markFunded(f.db, snapshot, failing, NOW, released), /interrupted/);
  assert.equal(f.row(purchase.id).state, "waiting");
  assert.equal(f.db.prepare("SELECT state FROM mk_reveals WHERE id=?").get(purchase.id).state, "funding");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mk_fees").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM mk_chain_ops").get().n, 0);
  await f.confirm(purchase.id, released);
  assert.equal(f.row(purchase.id).state, "funded");
});

test("bounded checks rotate past malformed and unresolved funding intents", async (t) => {
  const f = fixture(t), bad = f.task(), unresolved = f.task(), good = f.task();
  f.db.prepare("UPDATE mk_fundings SET created_at=? WHERE id=?").run(NOW - 2, bad.id);
  f.db.prepare("UPDATE mk_fundings SET created_at=? WHERE id=?").run(NOW - 1, unresolved.id);
  f.db.prepare("UPDATE mk_fundings SET msg='invalid-json' WHERE id=?").run(bad.id);
  const view = async (_method, args) => args.id === good.id ? escrowFundingView(f.row(good.id)) : {};
  for (let i = 0; i < 3; i++) await f.run(view, { maxChecks: 1, now: NOW + i });
  assert.equal(f.row(good.id).state, "funded");
  assert.equal(f.row(bad.id).state, "waiting");
  assert.equal(f.row(unresolved.id).state, "waiting");
});

test("one inconsistent target does not block other fundings or queued settlement", async (t) => {
  const f = fixture(t), broken = f.task(), good = f.task();
  f.db.prepare("UPDATE mk_tasks SET state='cancelled' WHERE id=?").run(broken.id);
  chain.enqueue(f.db, null, "withdraw_for", { account_id: "bob.testnet" }, NOW);
  const result = await f.run(async (_method, args) => escrowFundingView(f.row(args.id)), { maxOps: 1 });
  assert.equal(f.row(broken.id).state, "waiting");
  assert.equal(f.row(good.id).state, "funded");
  assert.equal(result.fundingFailed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.sent, 1);
});

test("FINAL RPC reads use only the configured escrow and the requested ID", async () => {
  const requests = [];
  const view = chain.escrowView({ query: async (request) => {
    requests.push(request); return { result: [...Buffer.from("null")] };
  } }, "configured-escrow.testnet");
  assert.equal(await view("get_task", { id: "expected-id" }), null);
  assert.deepEqual(requests, [{ request_type: "call_function", account_id: "configured-escrow.testnet",
    method_name: "get_task", args_base64: Buffer.from('{"id":"expected-id"}').toString("base64"), finality: "final" }]);
});

test("SIGKILL inside activation rolls back, and two restarted workers settle once", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "escrow-regression-")), filename = join(dir, "synthetic.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = fixture(t, filename), purchase = f.secret(), snapshot = f.row(purchase.id);
  f.db.close();
  const run = (kill) => spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { openDatabase } from './server/database.mjs';
    import * as chain from './server/market/chain.mjs';
    import * as market from './server/market/service.mjs';
    import { escrowFundingView } from './tests/fixtures/escrow-funding.mjs';
    chain.setEscrowConfig({ contractId:'escrow.testnet', tokenId:'qgold.testnet', treasuryId:'treasury.testnet' });
    const db = openDatabase(process.argv[1]);
    const activate = { ...market.ACTIVATE, reveal: (...args) => {
      market.ACTIVATE.reveal(...args);
      if (process.argv[2] === 'kill') process.kill(process.pid, 'SIGKILL');
    } };
    await chain.runEscrowWorker(db, { activate, drop:market.DROP, maxOps:0, now:${NOW},
      call:async () => { throw Error('No settlement calls expected'); },
      view:async () => ({ ...escrowFundingView(${JSON.stringify(snapshot)}), status:'released' }) });
    db.close();
  `, filename, kill ? "kill" : "resume"], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 15000 });
  assert.equal(run(true).signal, "SIGKILL");
  const interrupted = openDatabase(filename);
  assert.equal(interrupted.prepare("SELECT state FROM mk_fundings WHERE id=?").get(purchase.id).state, "waiting");
  assert.equal(interrupted.prepare("SELECT COUNT(*) n FROM mk_chain_ops").get().n, 0);
  interrupted.close();
  for (let i = 0; i < 2; i++) { const result = run(false); assert.equal(result.status, 0, result.stderr); }
  const recovered = openDatabase(filename);
  try {
    assert.equal(recovered.prepare("SELECT state FROM mk_fundings WHERE id=?").get(purchase.id).state, "funded");
    assert.equal(recovered.prepare("SELECT state FROM mk_reveals WHERE id=?").get(purchase.id).state, "released");
    assert.equal(recovered.prepare("SELECT COUNT(*) n FROM mk_fees WHERE ref=?").get(purchase.id).n, 1);
    assert.equal(recovered.prepare("SELECT COUNT(*) n FROM mk_chain_ops").get().n, 2);
  } finally { recovered.close(); }
});

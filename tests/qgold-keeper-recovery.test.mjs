import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { backup } from "node:sqlite";
import { QgoldKeeper } from "../server/qgold/keeper.mjs";
import { KEEPER_LEASE_MS } from "../server/qgold/keeper-journal.mjs";
import { keeperTransport } from "../server/qgold/keeper-transport.mjs";
import { assessKeeperStep } from "../server/qgold/keeper-receipts.mjs";
import { keeperFixture, keeperOutcome, NOW } from "./fixtures/qgold-keeper.mjs";
const Subject = process.env.KEEPER_TEST_SUBJECT ? (await import(pathToFileURL(process.env.KEEPER_TEST_SUBJECT))).QgoldKeeper : QgoldKeeper;
const DAY = 86_400_000, LATER = NOW + 3_600_001;
const ops = (f) => f.db.prepare("SELECT * FROM qgold_keeper_ops ORDER BY position").all();
const steps = (f) => f.db.prepare("SELECT * FROM qgold_keeper_steps ORDER BY rowid").all();
function fixture(t, options = {}) { const f = keeperFixture({ Keeper: Subject, ...options }); t.after(f.close); return f; }
function directory(t) { const dir = mkdtempSync(join(tmpdir(), "questlayer-keeper-test-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const reopened = (f) => new Subject(f.db, f.options);

test("keeper limits include money already spent when the burn fails", async (t) => {
  const f = fixture(t, { mode: "buyback" }); f.controls.reject = "ft_burn";
  await f.keeper.tick(NOW);
  assert.ok(f.balance("spent") > 0n, "the modeled wrap and swap really consumed the allocation");
  assert.equal(f.keeper.sums("2026-11-06").buybackSpent, f.balance("spent"));
});

test("overlapping keeper instances cannot spend the same slot twice", async (t) => {
  const f = fixture(t, { mode: "buyback" }); let announce, release, held = false;
  const ready = new Promise((r) => { announce = r; }), wait = new Promise((r) => { release = r; });
  f.controls.afterSend = async (method) => { if (method === "near_deposit" && !held) { held = true; announce(); await wait; } };
  const first = f.keeper.tick(NOW); await ready;
  await reopened(f).tick(NOW); release(); await first;
  assert.equal(f.calls().filter((r) => r.method === "near_deposit").length, 1);
});

for (const mode of ["inverse", "buyback", "sale"]) test(`keeper ${mode} persists its allocation before signing and completes each step once`, async (t) => {
  const f = fixture(t, { mode }); let prepared = 0;
  const create = f.account.createSignedTransaction;
  f.account.createSignedTransaction = async (args) => {
    prepared++; assert.equal(ops(f).length, 1); assert.equal(ops(f)[0].state, "pending");
    assert.ok(BigInt(ops(f)[0].reserved_near) > 0n); return create.call(f.account, args);
  };
  await f.keeper.tick(NOW);
  assert.equal(ops(f)[0].state, "done", ops(f)[0].last_error);
  const expected = mode === "sale" ? 2 : 3;
  assert.equal(prepared, expected); assert.equal(f.calls().length, expected);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM qgold_keeper_actions WHERE state='sent'").get().n, 1);
  await reopened(f).tick(NOW + 1000); assert.equal(f.calls().length, expected);
});

for (const method of ["near_deposit", "ft_transfer_call", "ft_burn"]) {
  test(`lost finalized ${method} reply resumes from its hash without repeating the step`, async (t) => {
    const f = fixture(t); let interrupted = false;
    f.controls.afterSend = async (m) => { if (m === method && !interrupted) { interrupted = true; throw Error("lost RPC reply"); } };
    await f.keeper.tick(NOW); assert.equal(ops(f)[0].state, "pending");
    const before = steps(f).at(-1); assert.equal(before.state, "prepared");
    await reopened(f).tick(LATER);
    assert.equal(ops(f)[0].state, "done"); assert.equal(f.calls().length, 3);
    assert.ok(steps(f).some((s) => s.tx === before.tx && s.state === "succeeded"));
  });
  test(`interrupted ${method} before broadcast reuses the identical signed transaction`, async (t) => {
    const f = fixture(t); let interrupted = false, saved;
    f.controls.beforeSend = async (m) => { if (m === method && !interrupted) { interrupted = true; saved = steps(f).at(-1); throw Error("pre-send interruption"); } };
    await f.keeper.tick(NOW); await reopened(f).tick(LATER);
    assert.equal(ops(f)[0].state, "done"); assert.equal(f.calls().length, 3);
    const row = steps(f).find((s) => s.tx === saved.tx);
    assert.equal(row.signed_tx, saved.signed_tx); assert.equal(row.attempt, 1);
  });
}

test("failed burn retries only burning and keeps original purchases, hashes and budget", async (t) => {
  const f = fixture(t, { mode: "buyback" }); f.controls.reject = "ft_burn";
  await f.keeper.tick(NOW); const spent = f.balance("spent"), first = steps(f).slice(0, 2).map((s) => s.tx);
  assert.equal(steps(f).at(-1).state, "retry"); assert.equal(ops(f)[0].state, "pending");
  assert.equal(f.keeper.publicView(NOW).buybackSpent, String(spent));
  f.controls.reject = null; await reopened(f).tick(LATER);
  assert.equal(ops(f)[0].state, "done"); assert.equal(f.balance("spent"), spent);
  assert.deepEqual(steps(f).slice(0, 2).map((s) => s.tx), first);
  assert.deepEqual(f.calls().map((r) => r.method), ["near_deposit", "ft_transfer_call", "ft_burn", "ft_burn"]);
  assert.equal(f.keeper.sums("2026-11-06").buybackSpent, spent);
});

test("fully refunded swap retries the same wrapped inventory without spending NEAR again", async (t) => {
  const f = fixture(t); f.controls.refund = true;
  await f.keeper.tick(NOW); const spent = f.balance("spent");
  assert.equal(steps(f).at(-1).state, "retry"); assert.equal(f.balance("wrap.testnet"), spent);
  f.controls.refund = false; await reopened(f).tick(LATER);
  assert.equal(ops(f)[0].state, "done"); assert.equal(f.balance("spent"), spent);
  assert.equal(f.calls().filter((r) => r.method === "near_deposit").length, 1);
});

test("restart across midnight recovers the old operation and keeps its daily reservation", async (t) => {
  const f = fixture(t); f.controls.reject = "ft_burn";
  await f.keeper.tick(NOW); const spent = f.balance("spent");
  assert.equal(f.keeper.sums("2026-11-07").inverseToday, spent);
  f.controls.reject = null; const k = reopened(f);
  k.readState = async () => { throw Error("recovery must not depend on a fresh market quote"); };
  await k.tick(NOW + DAY);
  assert.equal(ops(f)[0].state, "done"); assert.equal(ops(f)[0].completed_day, "2026-11-07");
  assert.equal(k.sums("2026-11-07").inverseToday, spent); assert.equal(f.balance("spent"), spent);
});

test("lease takeover fences a stale sender after its status request returns", async (t) => {
  const f = fixture(t, { leaseClock: () => NOW }); let announce, release, held = false;
  const ready = new Promise((r) => { announce = r; }), wait = new Promise((r) => { release = r; });
  f.controls.beforeStatus = async () => { if (!held) { held = true; announce(); await wait; } };
  const first = f.keeper.tick(NOW); await ready;
  const successor = new Subject(f.db, { ...f.options, leaseClock: () => NOW + KEEPER_LEASE_MS + 1 });
  await successor.tick(NOW + KEEPER_LEASE_MS + 1); release(); await first;
  assert.equal(ops(f)[0].state, "done"); assert.equal(f.calls().length, 3);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM qgold_keeper_actions WHERE state='sent'").get().n, 1);
});

test("configuration/key identity changes cannot replace an unknown pending attempt", async (t) => {
  const f = fixture(t); f.controls.beforeSend = async () => { throw Error("unknown outcome"); };
  await f.keeper.tick(NOW); const saved = steps(f)[0].tx;
  f.controls.beforeSend = null;
  const changed = new Subject(f.db, { ...f.options, poolId: 8 }); await changed.tick(LATER);
  assert.match(ops(f)[0].last_error, /identity changed/); assert.equal(f.calls().length, 0); assert.equal(steps(f)[0].tx, saved);
});

test("unknown or non-FINAL outcomes never sign a replacement or advance the burn", async (t) => {
  const f = fixture(t); f.controls.beforeSend = async () => { throw Error("InvalidNonce: transaction expired"); };
  await f.keeper.tick(NOW); const saved = steps(f)[0]; await reopened(f).tick(LATER);
  assert.equal(steps(f).length, 1); assert.equal(steps(f)[0].signed_tx, saved.signed_tx);
  f.controls.beforeSend = null;
  f.provider.viewTransactionStatusWithReceipts = async () => ({ final_execution_status: "EXECUTED" });
  await reopened(f).tick(LATER + DAY); assert.equal(f.calls().length, 0); assert.equal(ops(f)[0].state, "pending");
});

test("unrelated wallet deposits are neither burned nor sold as operation output", async (t) => {
  for (const mode of ["inverse", "sale"]) {
    const f = fixture(t, { mode }); const unrelated = 123456789n; f.change("qgold.testnet", unrelated);
    await f.keeper.tick(NOW); assert.equal(ops(f)[0].state, "done");
    if (mode === "inverse") assert.equal(f.balance("qgold.testnet"), unrelated);
    else {
      const bought = BigInt(JSON.parse(steps(f)[0].proof).amount), sold = BigInt(JSON.parse(steps(f)[1].request).args.amount);
      assert.equal(f.balance("qgold.testnet"), unrelated + bought - sold);
    }
  }
});

test("all actions for one slot are reserved before the first step and resume together", async (t) => {
  const f = fixture(t), read = f.keeper.readState.bind(f.keeper);
  f.keeper.readState = async () => { const r = await read(); r.state.fees = 5n * 10n ** 24n; return r; };
  f.controls.beforeSend = async () => { assert.equal(ops(f).length, 2); throw Error("stopped"); };
  await f.keeper.tick(NOW); assert.equal(ops(f).length, 2);
  f.controls.beforeSend = null; await reopened(f).tick(LATER);
  assert.ok(ops(f).every((op) => op.state === "done")); assert.equal(f.calls().length, 6);
});

test("a changed stored attempt during RPC wait is never broadcast", async (t) => {
  const f = fixture(t); f.controls.beforeStatus = async () => {
    f.db.prepare("UPDATE qgold_keeper_steps SET signed_tx='corrupt'").run(); throw Error("unknown");
  };
  await f.keeper.tick(NOW); assert.equal(f.calls().length, 0); assert.equal(ops(f)[0].state, "pending");
});

test("disabled execution preserves pending work; legacy failures prevent fresh spending", async (t) => {
  const f = fixture(t); f.controls.reject = "ft_burn"; await f.keeper.tick(NOW); const count = f.calls().length;
  const disabled = new Subject(f.db, { ...f.options, settings: { ...f.options.settings, execute: false } });
  await disabled.tick(LATER); assert.equal(f.calls().length, count); assert.equal(ops(f)[0].state, "pending");
  const legacy = fixture(t); legacy.keeper.record({ day: "2026-11-05", slot: 1, at: NOW - DAY, kind: "buyback-burn", state: "failed", near: "100" });
  await legacy.keeper.tick(NOW); assert.equal(legacy.calls().length, 0); assert.match(legacy.keeper.lastError.message, /Legacy/);
  assert.equal(legacy.keeper.sums("2026-11-06").buybackSpent, 100n);
});

test("final root rejection retries only that step, with the original budget reservation", async (t) => {
  const f = fixture(t); f.controls.reject = "near_deposit"; await f.keeper.tick(NOW);
  assert.equal(f.balance("spent"), 0n); const reserved = ops(f)[0].reserved_near;
  f.controls.reject = null; await reopened(f).tick(LATER);
  assert.equal(ops(f).length, 1); assert.equal(f.balance("spent"), BigInt(reserved)); assert.equal(ops(f)[0].state, "done");
});

test("public keeper output exposes pending status without signed bytes, salts or errors", async (t) => {
  const f = fixture(t); f.controls.beforeSend = async () => { throw Error("private diagnostic"); }; await f.keeper.tick(NOW);
  const view = f.keeper.publicView(NOW), serialized = JSON.stringify(view);
  assert.equal(view.pending.length, 1); assert.ok(BigInt(view.budgetCommitted.inverseNear) > 0n);
  assert.doesNotMatch(serialized, /signed_tx|private diagnostic|model-salt|model-seed/);
});

test("consistent snapshot and process-style reopen recover a lost final response", async (t) => {
  const dir = directory(t), dbPath = join(dir, "app.sqlite"), ledgerPath = join(dir, "ledger.sqlite"), snapshot = join(dir, "snapshot.sqlite");
  const f = fixture(t, { dbPath, ledgerPath }); let lost = false;
  f.controls.afterSend = async (m) => { if (m === "ft_transfer_call" && !lost) { lost = true; throw Error("reply lost"); } };
  await f.keeper.tick(NOW); await backup(f.db, snapshot); const old = steps(f).map((s) => s.tx), secret = f.secret; f.close();
  const restored = fixture(t, { dbPath: snapshot, ledgerPath, secret }); await restored.keeper.tick(LATER);
  assert.equal(ops(restored)[0].state, "done"); assert.equal(restored.calls().length, 3);
  assert.deepEqual(steps(restored).slice(0, 2).map((s) => s.tx), old);
});

test("receipt verifier rejects wrong identity, amount, ancestry, refund and callback evidence", async (t) => {
  const f = fixture(t); await f.keeper.tick(NOW); const step = steps(f)[1], good = JSON.parse(step.outcome);
  assert.equal(assessKeeperStep(step, good).state, "succeeded");
  const mutations = [
    (r) => { r.final_execution_status = "EXECUTED"; }, (r) => { r.transaction.hash = "other"; },
    (r) => { r.transaction.receiver_id = "other"; }, (r) => { r.transaction.signer_id = "other"; },
    (r) => { r.transaction.public_key = "other"; }, (r) => { r.transaction.actions[0].FunctionCall.deposit = "2"; },
    (r) => { r.transaction.actions[0].FunctionCall.gas = "1"; }, (r) => { r.transaction.actions[0].FunctionCall.args = "e30="; },
    (r) => { r.receipts_outcome[1].outcome.receipt_ids = []; },
    (r) => { r.receipts_outcome[2].outcome.executor_id = "fake-token.testnet"; },
    (r) => { r.receipts_outcome[2].outcome.logs = []; },
    (r) => { r.receipts_outcome[2].outcome.logs[0] = r.receipts_outcome[2].outcome.logs[0].replace('"new_owner_id":"keeper.testnet"','"new_owner_id":"mallory.testnet"'); },
    (r) => { r.receipts_outcome.pop(); }, (r) => { r.status = { SuccessValue: Buffer.from('"0"').toString("base64") }; },
  ];
  for (const mutate of mutations) { const bad = structuredClone(good); mutate(bad); assert.equal(assessKeeperStep(step, bad).state, "pending"); }
});

test("real signing/encoding binds the persisted request and transport identity", async (t) => {
  const f = fixture(t), transport = await keeperTransport(f.keeper);
  const request = { contractId: "wrap.testnet", methodName: "near_deposit", args: {}, deposit: "10000", gas: "30000000000000", phase: "fund" };
  const a = await transport.prepare(request); assert.doesNotThrow(() => transport.verify(a, request));
  for (const change of [{ tx: "wrong" }, { signed_tx: "invalid" }, { identity: "other" }, { request: "{}" }]) assert.throws(() => transport.verify({ ...a, ...change }, request));
  assert.throws(() => transport.verify(a, { ...request, deposit: "20000" }));
  for (const change of [{ contractId: "attacker.testnet" }, { methodName: "delete_account" }, { gas: "300000000000000" }, { deposit: "-1" }, { args: { receiver_id: "attacker.testnet" } }])
    await assert.rejects(() => transport.prepare({ ...request, ...change }));
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import * as chain from "../server/market/chain.mjs";
import { runEscrowDelivery, ESCROW_LEASE_MS } from "../server/market/delivery.mjs";
import { assessEscrowDelivery } from "../server/market/delivery-receipts.mjs";
import { escrowDeliveryTransport } from "../server/market/delivery-transport.mjs";
import { mockDelivery, deliveryOutcome, DELIVERY_IDENTITY } from "./fixtures/escrow-delivery.mjs";
import { KeyPair, KeyPairSigner, Transaction } from "near-api-js";
import { backup } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { preflightDatabase } from "../server/schema-compatibility.mjs";

const NOW = 1_800_000_000_000;
function setup(t) {
  const db = openDatabase(":memory:"); chain.ensureMarketChainSchema(db); t.after(() => db.close());
  const enqueue = (account = "alice.testnet") => chain.payOut(db, account, NOW);
  const ops = () => db.prepare("SELECT * FROM mk_chain_ops ORDER BY seq").all();
  const attempts = () => db.prepare("SELECT * FROM mk_delivery_attempts ORDER BY rowid").all();
  const run = (call, options = {}) => runEscrowDelivery(db, { call, view: async () => "100", now: NOW, maxOps: 20, ...options });
  return { db, enqueue, ops, attempts, run };
}
const attempt = { tx: "known-tx", identity: DELIVERY_IDENTITY, method: "withdraw_for", args: '{"account_id":"alice.testnet"}' };

test("receipt verification requires exact FINAL transaction and linked token/callback evidence", () => {
  const good = deliveryOutcome(attempt);
  assert.deepEqual(assessEscrowDelivery(attempt, good), { state: "delivered", reason: "final_token_delivery", amount: "100" });
  const mutations = [
    (r) => { r.final_execution_status = "EXECUTED"; },
    (r) => { r.transaction.hash = "wrong"; },
    (r) => { r.transaction.signer_id = "other.testnet"; },
    (r) => { r.transaction.receiver_id = "other.testnet"; },
    (r) => { r.transaction.public_key = "different"; },
    (r) => { r.transaction.actions[0].FunctionCall.deposit = "1"; },
    (r) => { r.transaction.actions[0].FunctionCall.args = Buffer.from('{"account_id":"bob.testnet"}').toString("base64"); },
    (r) => { r.receipts_outcome[0].outcome.receipt_ids = ["known-tx-callback"]; },
    (r) => { r.receipts_outcome[1].outcome.executor_id = "fake-token.testnet"; },
    (r) => { r.receipts_outcome[1].outcome.logs[0] = r.receipts_outcome[1].outcome.logs[0].replace('"amount":"100"', '"amount":"99"'); },
    (r) => { r.receipts_outcome[2].outcome.logs = []; },
    (r) => { r.receipts_outcome[2].outcome.status.SuccessValue = Buffer.from('"99"').toString("base64"); },
    (r) => { r.receipts_outcome.pop(); },
  ];
  for (const mutate of mutations) { const bad = structuredClone(good); mutate(bad); assert.equal(assessEscrowDelivery(attempt, bad).state, "pending"); }
});

test("zero callback with restored credit is retryable, not paid", () => {
  assert.deepEqual(assessEscrowDelivery(attempt, deliveryOutcome(attempt, { failed: true })),
    { state: "retry", reason: "credit_restored_after_failed_transfer", amount: "100" });
  const spoof = deliveryOutcome(attempt, { failed: true });
  spoof.receipts_outcome[1].outcome.status = { SuccessValue: "" };
  assert.equal(assessEscrowDelivery(attempt, spoof).state, "pending");
});

test("failed token delivery retains a retry and later delivers without manual recovery", async (t) => {
  const f = setup(t); f.enqueue(); let paused = true;
  const call = mockDelivery(async () => ({ failed: paused }));
  await f.run(call);
  assert.equal(f.ops()[0].state, "queued"); assert.equal(f.attempts()[0].state, "retry");
  paused = false; await f.run(call, { now: NOW + 60_000 });
  assert.equal(f.ops()[0].state, "sent"); assert.equal(f.attempts().length, 2);
  assert.equal(f.attempts()[1].state, "delivered");
  await f.run(call, { now: NOW + 120_000 }); assert.equal(f.attempts().length, 2);
});

test("lost finalized reply is recovered by the stored hash without a second send", async (t) => {
  const f = setup(t); f.enqueue(); const call = mockDelivery(); let sends = 0;
  const send = call.send;
  call.send = async (a) => { sends++; await send(a); throw Error("reply lost"); };
  await f.run(call);
  assert.equal(f.attempts().length, 1); assert.equal(f.ops()[0].state, "queued");
  await f.run(call, { now: NOW + 60_000 });
  assert.equal(f.ops()[0].state, "sent"); assert.equal(sends, 1); assert.equal(f.attempts().length, 1);
});

test("interrupted pre-broadcast attempt reuses the identical signed bytes", async (t) => {
  const f = setup(t); f.enqueue(); const call = mockDelivery(); const send = call.send; let first = true, seen;
  call.send = async (a) => { if (first) { first = false; seen = { tx: a.tx, signed: a.signed_tx }; throw Error("before broadcast"); }
    assert.deepEqual({ tx: a.tx, signed: a.signed_tx }, seen); return send(a); };
  await f.run(call); await f.run(call, { now: NOW + 60_000 });
  assert.equal(f.ops()[0].state, "sent"); assert.equal(f.attempts().length, 1);
});

test("unknown outcome never uses zero credit, panic strings or a replacement transaction as proof", async (t) => {
  const f = setup(t); f.enqueue(); const call = mockDelivery();
  call.send = async () => { throw Error("No credit to withdraw; Task is closed; InvalidNonce"); };
  await f.run(call);
  await f.run(call, { now: NOW + 60_000, view: async () => "0" });
  assert.equal(f.ops()[0].state, "queued"); assert.equal(f.attempts().length, 1);
  assert.equal(f.attempts()[0].state, "prepared");
});

test("hash-only transports cannot mark money delivered", async (t) => {
  const f = setup(t); f.enqueue(); let called = false;
  await f.run(async () => { called = true; return "tx"; });
  assert.equal(called, false); assert.equal(f.ops()[0].state, "queued");
});

test("one confirmed recipient is not paid again when the other transfer failed", async (t) => {
  const f = setup(t); f.enqueue(); f.enqueue("treasury.testnet"); let failTreasury = true; const sent = [];
  const call = mockDelivery(async (_m, args) => { sent.push(args.account_id); return { failed: args.account_id === "treasury.testnet" && failTreasury }; });
  await f.run(call); failTreasury = false; await f.run(call, { now: NOW + 60_000 });
  assert.deepEqual(sent, ["alice.testnet", "treasury.testnet", "treasury.testnet"]);
  assert.ok(f.ops().every((o) => o.state === "sent"));
});

test("new credit work cannot be coalesced into an already prepared withdrawal", async (t) => {
  const f = setup(t); f.enqueue(); const call = mockDelivery(); const send = call.send; let added = false;
  call.send = async (a) => { if (!added) { added = true; f.enqueue(); } return send(a); };
  await f.run(call); assert.equal(f.ops().length, 2);
  await f.run(call); assert.ok(f.ops().every((o) => o.state === "sent"));
});

test("a later settlement gets its own withdrawal even before the older push is prepared", (t) => {
  const f = setup(t); f.enqueue(); f.enqueue(); assert.equal(f.ops().length, 1);
  chain.enqueue(f.db, "another-task", "approve_task", { id: "another-task", worker: "alice.testnet" }, NOW);
  f.enqueue(); assert.equal(f.ops().filter((o) => o.method === "withdraw_for").length, 2);
});

test("new credit arriving during an empty-credit read gets a separate durable push", async (t) => {
  const f = setup(t); f.enqueue();
  await f.run(mockDelivery(), { view: async () => { f.enqueue(); return "0"; } });
  assert.equal(f.ops().length, 2); assert.equal(f.ops()[0].last_error, "no_current_credit");
  assert.equal(f.ops()[1].state, "queued");
  await f.run(mockDelivery()); assert.equal(f.ops()[1].state, "sent");
});

test("overlapping workers share one lease and cannot sign competing attempts", async (t) => {
  const f = setup(t); f.enqueue(); const call = mockDelivery(); let release, started;
  const ready = new Promise((r) => { started = r; }), held = new Promise((r) => { release = r; });
  const send = call.send; let count = 0;
  call.send = async (a) => { count++; started(); await held; return send(a); };
  const first = f.run(call); await ready; await f.run(call); release(); await first;
  assert.equal(count, 1); assert.equal(f.attempts().length, 1); assert.equal(f.ops()[0].state, "sent");
});

test("expired lease takeover reconciles the same attempt and fences a stale worker", async (t) => {
  const f = setup(t); f.enqueue(); const call = mockDelivery(); let release, started;
  const ready = new Promise((r) => { started = r; }), held = new Promise((r) => { release = r; });
  const send = call.send; let firstSend = true;
  call.send = async (a) => { const result = await send(a); if (firstSend) { firstSend = false; started(); await held; } return result; };
  const first = f.run(call, { clock: () => NOW }); await ready;
  await f.run(call, { now: NOW + ESCROW_LEASE_MS + 1, clock: () => NOW + ESCROW_LEASE_MS + 1 });
  release(); await first;
  assert.equal(f.ops()[0].state, "sent"); assert.equal(f.attempts().length, 1); assert.equal(f.attempts()[0].state, "delivered");
});

test("signed transaction preparation binds signer, network, recipient, method, args, gas and hash", async () => {
  const key = KeyPair.fromRandom("ed25519"), signer = KeyPairSigner.fromSecretKey(key.toString());
  const account = { accountId: "pub.testnet", signer,
    async createSignedTransaction({ receiverId, actions }) {
      const tx = new Transaction({ signerId: this.accountId, receiverId, actions, publicKey: key.getPublicKey(), nonce: 1n, blockHash: new Uint8Array(32) });
      return (await signer.signTransaction(tx)).signedTransaction;
    } };
  const transport = await escrowDeliveryTransport({ viewNodeStatus: async () => ({ chain_id: "test-chain-unit" }) }, account,
    { contractId: "escrow.testnet", tokenId: "qgold.testnet", publisherId: "pub.testnet" }, ["withdraw_for"]);
  const op = { method: "withdraw_for", args: '{"account_id":"alice.testnet"}' }, a = await transport.prepare(op);
  assert.doesNotThrow(() => transport.verify(a, op));
  for (const change of [{ tx: "wrong" }, { identity: DELIVERY_IDENTITY }, { signed_tx: "invalid" }])
    assert.throws(() => transport.verify({ ...a, ...change }, op));
  assert.throws(() => transport.verify(a, { ...op, args: '{"account_id":"bob.testnet"}' }));
  await assert.rejects(() => transport.prepare({ method: "unknown", args: "{}" }));
});

test("an operation changed during a status lookup cannot be broadcast", async (t) => {
  const f = setup(t); f.enqueue(); const call = mockDelivery(); let sent = 0;
  call.status = async () => { f.db.prepare("UPDATE mk_chain_ops SET args=?").run('{"account_id":"bob.testnet"}'); throw Error("unknown"); };
  call.send = async () => { sent++; };
  await f.run(call); assert.equal(sent, 0); assert.equal(f.ops()[0].state, "queued");
});

test("legacy attempted rows require reconciliation before any new publisher transaction", async (t) => {
  const f = setup(t); f.enqueue(); f.enqueue("treasury.testnet");
  f.db.prepare("UPDATE mk_chain_ops SET attempts=1 WHERE seq=(SELECT MIN(seq) FROM mk_chain_ops)").run();
  let sent = 0; await f.run(mockDelivery(async () => { sent++; }));
  assert.equal(sent, 0); assert.equal(f.attempts().length, 0);
  assert.match(f.ops()[0].last_error, /requires reconciliation/);
});

test("a FINAL contract rejection permits a new attempt without interpreting panic text", async (t) => {
  const f = setup(t); chain.enqueue(f.db, "task", "approve_task", { id: "task", worker: "alice.testnet" }, NOW);
  let rejected = true; const call = mockDelivery(async () => ({ rejected }));
  await f.run(call); assert.equal(f.attempts()[0].state, "retry");
  rejected = false; await f.run(call, { now: NOW + 60_000 });
  assert.equal(f.ops()[0].state, "sent"); assert.equal(f.attempts().length, 2);
});

test("an unfinalized known transaction blocks replacement and later publisher nonces", async (t) => {
  const f = setup(t); f.enqueue(); f.enqueue("treasury.testnet"); const call = mockDelivery(); let sends = 0;
  call.status = async (a) => ({ ...deliveryOutcome(a), final_execution_status: "EXECUTED" });
  call.send = async () => { sends++; };
  await f.run(call); await f.run(call, { now: NOW + 120_000 });
  assert.equal(sends, 0); assert.equal(f.attempts().length, 1); assert.ok(f.ops().every((o) => o.state === "queued"));
});

test("restored credit remains retryable beyond the old attempt limit", async (t) => {
  const f = setup(t); f.enqueue(); let failed = true; const call = mockDelivery(async () => ({ failed }));
  for (let i = 0; i < 10; i++) await f.run(call, { now: NOW + i * 3_600_001 });
  assert.equal(f.ops()[0].state, "queued"); assert.equal(f.attempts().length, 10);
  failed = false; await f.run(call, { now: NOW + 11 * 3_600_001 });
  assert.equal(f.ops()[0].state, "sent"); assert.equal(f.attempts().length, 11);
});

test("empty current credit retires only an unattempted push, never invents delivery evidence", async (t) => {
  const f = setup(t); f.enqueue();
  await f.run(mockDelivery(), { view: async () => "0" });
  assert.equal(f.ops()[0].state, "sent"); assert.equal(f.ops()[0].last_error, "no_current_credit");
  assert.equal(f.attempts().length, 0); f.enqueue(); assert.equal(f.ops().length, 2);
});

test("disk reopen and consistent backup preserve the exact attempt through lost-reply recovery", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-delivery-restore-"));
  const path = join(dir, "state.sqlite"), snapshot = join(dir, "snapshot.sqlite");
  let db = openDatabase(path); t.after(() => { if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }); });
  chain.ensureMarketChainSchema(db); chain.payOut(db, "alice.testnet", NOW);
  const call = mockDelivery(), send = call.send; let sent = 0;
  call.send = async (a) => { sent++; await send(a); throw Error("lost final reply"); };
  const run = () => runEscrowDelivery(db, { call, view: async () => "100", now: NOW, maxOps: 20 });
  await run(); const original = { ...db.prepare("SELECT * FROM mk_delivery_attempts").get() };
  await backup(db, snapshot); db.close();
  db = openDatabase(path); chain.ensureMarketChainSchema(db);
  assert.deepEqual({ ...db.prepare("SELECT * FROM mk_delivery_attempts").get() }, original); db.close();
  assert.doesNotThrow(() => preflightDatabase(snapshot)); db = openDatabase(snapshot); chain.ensureMarketChainSchema(db);
  await run();
  assert.equal(sent, 1); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mk_delivery_attempts").get().n, 1);
  assert.equal(db.prepare("SELECT tx,state FROM mk_delivery_attempts").get().tx, original.tx);
  assert.equal(db.prepare("SELECT state FROM mk_chain_ops").get().state, "sent");
});

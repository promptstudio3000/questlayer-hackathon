import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlayer, openDatabase } from "../server/database.mjs";
import { burnGold, setSpendRealm } from "../server/gold-spend/ledger.mjs";
import { purchaseAtomic } from "../server/gold-spend/purchases.mjs";
import { burnEvents } from "../server/gold-spend/qgold-burn.mjs";
import { purchaseFixture, burnOutcome, TOKEN } from "./fixtures/qgold-purchase.mjs";
const code = expected => e => e.code === expected;
function fixture(t, options) { setSpendRealm("qgold"); const f = purchaseFixture(options); t.after(() => { if (f.db.isOpen) f.db.close(); setSpendRealm("practice"); }); return f; }
async function quote(f) { await assert.rejects(f.run(), code("QGOLD_BURN")); return f.prepare(); }

for (const delegated of [false, true]) test(`${delegated ? "delegated" : "direct"} final burn delivers once, preserves practice GOLD and replays the exact reply`, async t => {
  const f = fixture(t), before = f.db.prepare("SELECT gold_u FROM players WHERE id=?").get(f.player).gold_u;
  const call = await quote(f);
  assert.equal(call.methodName, "ft_burn"); assert.equal(call.deposit, "1");
  assert.deepEqual(f.prepare(), call, "prepare retries retain the same memo and submission");
  const proof = burnOutcome(f.row(), { delegated });
  const credit = await f.confirm(proof);
  assert.equal(credit.amount_u, f.row().amount_u); assert.equal(credit.memo, call.args.memo);
  assert.equal(burnEvents(proof, "other.testnet").length, 0);
  assert.deepEqual(await f.confirm(null), credit, "lost confirmation reply does not query or pay again");
  const delivered = await f.run();
  assert.deepEqual(await f.run(), delivered, "lost purchase reply does not issue a second item");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM gold_unlocks").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM gold_burns WHERE realm='qgold'").get().n, 1);
  assert.equal(f.db.prepare("SELECT gold_u FROM players WHERE id=?").get(f.player).gold_u, before);
  assert.equal(f.row().state, "complete");
  const other = createPlayer(f.db, "Other");
  await assert.rejects(f.confirm(proof, { player: other }), code("PURCHASE_NOT_FOUND"));
  await assert.rejects(f.run({ sku: "cosmetic:frame-gold" }), code("PURCHASE_MISMATCH"));
});

test("concurrent request IDs share one pending payment; a foreign or changed request cannot use it", async t => {
  const f = fixture(t), aliases = Array.from({ length: 12 }, () => randomUUID());
  const attempts = await Promise.allSettled(aliases.map(id => f.run(undefined, id)));
  assert.ok(attempts.every(r => r.status === "rejected" && r.reason.code === "QGOLD_BURN"));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM qgold_purchases").get().n, 1);
  await quote(f); const original = f.prepare();
  const anotherTab = f.prepare({ submitterId: randomUUID() });
  assert.equal(anotherTab.canSign, false); assert.equal(anotherTab.args.memo, original.args.memo);
  await f.confirm(burnOutcome(f.row()));
  const replies = await Promise.all(aliases.map(id => f.run(undefined, id)));
  assert.ok(replies.every(r => r.burn.id === replies[0].burn.id));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM gold_unlocks").get().n, 1);
});

const corruptions = {
  "wrong transaction hash": r => { r.transaction.hash = "9".repeat(44); },
  "wrong transaction outcome": r => { r.transaction_outcome.id = "foreign"; },
  "optimistic finality": r => { r.final_execution_status = "EXECUTED_OPTIMISTIC"; },
  "wrong delegated owner": r => { r.transaction.actions[0].Delegate.delegate_action.sender_id = "eve.testnet"; },
  "wrong delegated target": r => { r.transaction.actions[0].Delegate.delegate_action.receiver_id = "other.testnet"; },
  "wrong outer receiver": r => { r.transaction.receiver_id = "other.testnet"; },
  "wrong amount": r => { const a = r.transaction.actions[0].Delegate.delegate_action.actions[0].FunctionCall; a.args = Buffer.from(JSON.stringify({ amount: "1", memo: "fake" })).toString("base64"); },
  "missing ancestry": r => { r.receipts_outcome[0].outcome.receipt_ids = []; },
  "missing final refund receipt": r => { r.receipts_outcome.pop(); },
  "failed child": r => { r.receipts_outcome.at(-1).outcome.status = { Failure: {} }; },
  "duplicate receipt ID": r => { r.receipts_outcome.push(r.receipts_outcome[1]); },
  "unrelated burn event": r => { r.receipts_outcome[1].outcome.logs = []; r.receipts_outcome.push({ id: "foreign", outcome: { executor_id: TOKEN, status: { SuccessValue: "" }, receipt_ids: [], logs: ["EVENT_JSON:{}"] } }); },
  "duplicate burn event": r => { r.receipts_outcome[1].outcome.logs.push(r.receipts_outcome[1].outcome.logs[0]); },
};
for (const [name, corrupt] of Object.entries(corruptions)) test(`no purchase credit from ${name}`, async t => {
  const f = fixture(t); await quote(f); const r = burnOutcome(f.row(), { delegated: true }); corrupt(r);
  await assert.rejects(f.confirm(r), code("BURN_PENDING"));
  assert.equal(f.row().state, "prepared"); assert.equal(f.row().submission, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM qgold_burn_credits").get().n, 0);
});

test("proven burn failure permits one new submission; repeating old failure cannot reset a paid purchase", async t => {
  const f = fixture(t); const first = await quote(f), failed = burnOutcome(f.row(), { delegated: true, failed: true });
  await assert.rejects(f.confirm(failed), code("BURN_REJECTED"));
  await assert.rejects(f.confirm(failed), code("BURN_REJECTED"));
  const retry = f.prepare(); assert.equal(retry.submission, 1); assert.equal(retry.args.memo, first.args.memo);
  const hash = "9".repeat(44);
  await f.confirm(burnOutcome(f.row(), { hash }), { txHash: hash });
  await assert.rejects(f.confirm(failed), code("BURN_OWNER"));
  await f.run(); assert.equal(f.row().state, "complete");
});

test("delivery failure rolls back credit consumption and response together", async t => {
  const f = fixture(t); await quote(f); await f.confirm(burnOutcome(f.row()));
  await assert.rejects(f.run(undefined, f.id, () => purchaseAtomic(f.db, () => {
    burnGold(f.db, { player: f.player, kind: "emote", ref: "dragon", amountU: f.row().amount_u });
    throw Error("process interrupted before commit");
  })), /process interrupted/);
  assert.equal(f.db.prepare("SELECT used_at FROM qgold_burn_credits").get().used_at, null);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM gold_burns").get().n, 0);
  assert.equal(f.row().state, "credited"); await f.run();
});

test("closing and reopening the database preserves paid-but-undelivered purchases", async t => {
  const file = join(mkdtempSync(join(tmpdir(), "questlayer-purchase-")), "synthetic.sqlite");
  const f = fixture(t, { file }); await quote(f); await f.confirm(burnOutcome(f.row()));
  const player = f.player, id = f.id; f.db.close();
  const db = openDatabase(file), next = purchaseFixture({ db, player });
  const delivered = await next.run(undefined, id);
  assert.equal(delivered.sku, "emote:dragon"); assert.equal(db.prepare("SELECT COUNT(*) n FROM qgold_burn_credits").get().n, 1);
  db.close();
});

test("fresh GPS proof can change on retry while the purchased item stays bound", async t => {
  const f = fixture(t); const input = { sku: "emote:dragon", fix: { timestamp: 1 }, encounter: "old-proof" };
  await assert.rejects(f.run(input), code("QGOLD_BURN")); f.prepare(); await f.confirm(burnOutcome(f.row()));
  await f.run({ ...input, fix: { timestamp: 2 }, encounter: "new-proof" });
  assert.equal(f.row().state, "complete");
});

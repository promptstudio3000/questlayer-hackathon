import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { createLayerActivity, metaLayerNearConfiguration, verifyMetaLayerAction } from "../server/layer/activity.mjs";

const H = "B".repeat(44), FINAL = "C".repeat(44), INCLUDED = "D".repeat(44), EXECUTED = "E".repeat(44), CODE = "F".repeat(44);
const config = { contract: "meta-layer.testnet", recorder: "recorder.meta-layer.testnet", codeHash: CODE };
function fixture() {
  const now = 1000000, action = { id: "mla_evidence", layer: "space", actor: "actor-hash", evidence_hash: "evidence-hash" };
  const event = { standard: "questlayer_metalayer", version: "1.0.0", event: "action_recorded", data: [{ action_id: action.id, layer_id: action.layer, actor: action.actor, evidence_hash: action.evidence_hash }] };
  const outcome = {
    final_execution_status: "FINAL", status: { SuccessValue: "" },
    transaction: { hash: H, signer_id: config.recorder, receiver_id: config.contract, actions: [{ FunctionCall: { method_name: "record_batch", deposit: "0", args: "e30=" } }] },
    transaction_outcome: { block_hash: INCLUDED, outcome: { status: { SuccessReceiptId: "receipt-one" }, receipt_ids: ["receipt-one"] } },
    receipts_outcome: [{ id: "receipt-one", block_hash: EXECUTED, outcome: { executor_id: config.contract, status: { SuccessValue: "" }, receipt_ids: [], logs: ["EVENT_JSON:" + JSON.stringify(event)] } }],
  };
  const replies = {
    status: { chain_id: "testnet", sync_info: { syncing: false } },
    final: { header: { height: 100, hash: FINAL, timestamp_nanosec: String(BigInt(now) * 1000000n) } },
    included: { header: { height: 98, hash: INCLUDED } },
    execution: { header: { height: 99, hash: EXECUTED } },
    historical: { code_hash: CODE, block_hash: EXECUTED }, current: { code_hash: CODE, block_hash: FINAL }, outcome,
  };
  const rpc = async (method, p) => method === "status" ? replies.status : method === "tx" ? replies.outcome : method === "block"
    ? p.finality ? replies.final : p.block_id === INCLUDED ? replies.included : replies.execution
    : p.block_id === EXECUTED ? replies.historical : replies.current;
  const verify = () => verifyMetaLayerAction({ config, rpc, action, transactionHash: H, now: () => now });
  return { now, action, event, replies, rpc, verify };
}

test("MetaLayer reuses final receipt validation and binds a read-only proof to its own action domain", async () => {
  const f = fixture(), proof = await f.verify();
  assert.equal(proof.status, "confirmed"); assert.equal(proof.tx, H);
  assert.equal(proof.blockHash, EXECUTED); assert.equal(proof.poll, "none");
});

test("unconfigured or malformed MetaLayer contracts cannot open a verifier", async () => {
  assert.equal(metaLayerNearConfiguration({}), null);
  assert.equal(metaLayerNearConfiguration({ METALAYER_NEAR_CONTRACT: "city.testnet", METALAYER_NEAR_CODE_HASH: "invented" }), null);
  await assert.rejects(verifyMetaLayerAction({ config: null }), e => e.status === 503);
});

test("wrong network, syncing, stale or nonfinal receipts are rejected", async () => {
  for (const mutate of [
    f => f.replies.status.chain_id = "another-network",
    f => f.replies.status.sync_info.syncing = true,
    f => f.replies.final.header.timestamp_nanosec = "1000",
    f => f.replies.outcome.final_execution_status = "EXECUTED_OPTIMISTIC",
    f => f.replies.execution.header.height = 101,
    f => f.replies.included.header.hash = FINAL,
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.verify()); }
});

test("receiver, recorder, method, deposit, code changes and foreign action evidence fail closed", async () => {
  for (const mutate of [
    f => f.replies.outcome.transaction.receiver_id = "city.testnet",
    f => f.replies.outcome.transaction.signer_id = "visitor.testnet",
    f => f.replies.outcome.transaction.actions[0].FunctionCall.method_name = "ft_transfer",
    f => f.replies.outcome.transaction.actions[0].FunctionCall.deposit = "1",
    f => f.replies.historical.code_hash = FINAL,
    f => f.replies.current.code_hash = FINAL,
    f => f.action.actor = "another-player",
    f => f.action.layer = "world",
    f => f.action.evidence_hash = "changed-evidence",
    f => f.replies.outcome.receipts_outcome[0].outcome.executor_id = "counterfeit.testnet",
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.verify()); }
});

test("partial failure, missing receipts, detached logs and duplicate outcomes cannot look final", async () => {
  for (const mutate of [
    f => f.replies.outcome.receipts_outcome[0].outcome.status = { Failure: { error: "failed" } },
    f => f.replies.outcome.transaction_outcome.outcome.receipt_ids = ["missing-receipt"],
    f => f.replies.outcome.receipts_outcome[0].outcome.receipt_ids = ["unfinished-receipt"],
    f => f.replies.outcome.receipts_outcome.push(structuredClone(f.replies.outcome.receipts_outcome[0])),
    f => f.replies.outcome.receipts_outcome.push({ ...structuredClone(f.replies.outcome.receipts_outcome[0]), id: "detached" }),
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.verify()); }
});

test("action evidence and confirmed proofs stay actor-scoped and durable without granting XP or NFTs", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  for (const id of ["a", "b"]) db.prepare("INSERT INTO players(id,name,created_at) VALUES(?,?,?)").run(id, id, 1);
  const f = fixture(), a = { id: "a" }, b = { id: "b" }, layer = { id: "space" };
  let queries = 0;
  const activity = createLayerActivity(db, { now: () => f.now, config, rpc: async (...args) => { queries++; return f.rpc(...args); } });
  const id = activity.record(a, layer, "same-request", "signal-tuned", { site: "garden" });
  assert.equal(activity.record(a, layer, "same-request", "signal-tuned", { site: "garden" }), id);
  assert.equal(activity.list(a, layer).actions.length, 1); assert.equal(activity.list(b, layer).actions.length, 0);
  const row = db.prepare("SELECT * FROM ml_actions WHERE id=?").get(id);
  const e = f.event.data[0]; e.action_id = id; e.actor = JSON.parse(row.envelope).actor; e.evidence_hash = row.evidence_hash;
  f.replies.outcome.receipts_outcome[0].outcome.logs = ["EVENT_JSON:" + JSON.stringify(f.event)];
  await assert.rejects(activity.verify(b, layer, { actionId: id, transactionHash: H }), e => e.status === 404);
  const saved = await activity.verify(a, layer, { actionId: id, transactionHash: H });
  assert.equal(saved.actions[0].chain.status, "confirmed");
  const count = queries; await activity.verify(a, layer, { actionId: id, transactionHash: H });
  assert.equal(queries, count, "the same verified proof recovers without relying on an available RPC");
  assert.equal(db.prepare("SELECT xp FROM players WHERE id='a'").get().xp, 0);
});


test("an action kind is part of the evidence identity, so request IDs cannot hide another action",t=>{
  const db=openDatabase(":memory:");t.after(()=>db.close());
  db.prepare("INSERT INTO players(id,name,created_at) VALUES('a','A',1)").run();
  const activity=createLayerActivity(db,{config:null,now:()=>100});
  const first=activity.record({id:"a"},{id:"space"},"expedition-started","expedition-started",{});
  const edit=activity.record({id:"a"},{id:"space"},"expedition-started","block-changed",{x:10,y:15,z:10,block:1});
  assert.notEqual(first,edit);assert.equal(activity.list({id:"a"},{id:"space"}).actions.length,2);
});

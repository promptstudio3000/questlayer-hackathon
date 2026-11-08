import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assessKeeperStep } from "../server/qgold/keeper-receipts.mjs";
import { recoverKeeperOutput } from "../server/qgold/keeper-recovery.mjs";
import { keeperTransport } from "../server/qgold/keeper-transport.mjs";
import { keeperFixture } from "./fixtures/qgold-keeper.mjs";

// Public evidence captured from the pinned local WASM smoke run. No private key
// or signed transaction is needed to challenge the finalized receipt verifier.
const evidence = JSON.parse(readFileSync(new URL("./fixtures/keeper-retained-output.json", import.meta.url)));
const { attempt, response } = evidence.swap;
const proof = assessKeeperStep(attempt, response);
const updateArgs = (r, index, fn) => {
  const a = r.receipts[index].receipt.Action.actions[0].FunctionCall;
  const args = JSON.parse(Buffer.from(a.args, "base64").toString()); fn(args);
  a.args = Buffer.from(JSON.stringify(args)).toString("base64");
};
test("actual retained-output, registration and recovery receipts prove three distinct steps", () => {
  assert.equal(proof.state, "recoverable"); assert.equal(proof.location, "lostfound");
  for (const name of ["register", "recover"]) {
    const e = evidence[name]; assert.equal(assessKeeperStep(e.attempt, e.response).state, "succeeded");
  }
  assert.equal(assessKeeperStep(evidence.recover.attempt, evidence.recover.response).amount, proof.amount);
});
test("nested final outcomes retain their receipt action evidence", () => {
  assert.deepEqual(assessKeeperStep(attempt, { final_execution_status: "FINAL", final_execution_outcome: response }), proof);
});

const mutations = {
  "unfinalized status": r => { r.final_execution_status = "EXECUTED"; },
  "foreign transaction": r => { r.transaction.hash = "other"; },
  "missing raw actions": r => { delete r.receipts; },
  "different receipt identity": r => { r.receipts[0].receipt_id = "other"; },
  "unknown receipt status": r => { r.receipts_outcome.at(-1).outcome.status = { Unknown: "" }; },
  "missing receipt status": r => { delete r.receipts_outcome.at(-1).outcome.status; },
  "wrong output predecessor": r => { r.receipts[0].predecessor_id = "attacker.testnet"; },
  "wrong output token": r => { r.receipts[0].receiver_id = "other.testnet"; },
  "wrong output method": r => { r.receipts[0].receipt.Action.actions[0].FunctionCall.method_name = "ft_transfer_call"; },
  "wrong output deposit": r => { r.receipts[0].receipt.Action.actions[0].FunctionCall.deposit = "0"; },
  "wrong output recipient": r => updateArgs(r, 0, a => { a.receiver_id = "attacker.testnet"; }),
  "wrong output amount": r => updateArgs(r, 0, a => { a.amount = "1"; }),
  "wrong callback method": r => { r.receipts[1].receipt.Action.actions[0].FunctionCall.method_name = "other"; },
  "wrong callback owner": r => updateArgs(r, 1, a => { a.sender_id = "attacker.testnet"; }),
  "wrong callback amount": r => updateArgs(r, 1, a => { a.amount = "1"; }),
  "wrong callback token": r => updateArgs(r, 1, a => { a.token_id = "other.testnet"; }),
  "owner lost-found fallback": r => { r.receipts_outcome.find(n => n.id === proof.callbackReceipt).outcome.logs[1] = "Depositing to owner account."; },
  "missing callback": r => { r.receipts_outcome = r.receipts_outcome.filter(n => n.id !== proof.callbackReceipt); },
  "second failed receipt": r => { r.receipts_outcome.find(n => ![proof.outputReceipt, proof.callbackReceipt].includes(n.id)).outcome.status = { Failure: {} }; },
  "altered swap amount": r => { const n = r.receipts_outcome.find(n => n.outcome.logs.some(l => l.startsWith("Swapped "))); n.outcome.logs[0] = n.outcome.logs[0].replace(`for ${proof.amount}`, "for 1"); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`retained-output proof rejects ${name}`, () => {
  const r = structuredClone(response); mutate(r); assert.equal(assessKeeperStep(attempt, r).state, "pending");
});

function recovery(t, { balance = proof.amount, registered = true, minimum = "1250000000000000000000" } = {}) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE qgold_keeper_steps(op_id TEXT,step INTEGER,attempt INTEGER,state TEXT,request TEXT,proof TEXT)");
  const calls = [], views = [], id = JSON.parse(attempt.identity);
  const params = { db, op: { id: "op", identity: attempt.identity }, swap: attempt, proof,
    current() {}, transport: { async view(contract, method, args) {
      views.push({ contract, method, args });
      return method === "storage_balance_of" ? (registered ? { total: minimum } : null)
        : method === "storage_balance_bounds" ? { min: minimum } : method === "get_deposits" ? { [id.qgold]: balance } : balance;
    } }, async advance(step, request) {
      calls.push({ step, request });
      return { attempt: { tx: "claim-transaction" }, proof: { state: "succeeded", amount: step === 100 ? minimum : proof.amount, swapTx: attempt.tx } };
    } };
  return { db, params, calls, views };
}
for (const balance of ["0", "1", String(BigInt(proof.amount) + 1n)]) test(`recovery refuses missing, partial or pooled inventory (${balance})`, async t => {
  const f = recovery(t, { balance }); await assert.rejects(recoverKeeperOutput(f.params), /ambiguous/); assert.equal(f.calls.length, 0);
});
test("recovery registration is bounded and claim never repurchases input", async t => {
  const f = recovery(t, { registered: false }); const result = await recoverKeeperOutput(f.params);
  assert.equal(result.state, "succeeded"); assert.deepEqual(f.calls.map(c => c.request.methodName), ["storage_deposit", "claim_lostfound"]);
  assert.equal(f.calls[1].request.swapTx, attempt.tx);
});
test("recovery refuses excessive storage sponsorship", async t => {
  const f = recovery(t, { registered: false, minimum: "1250000000000000000001" });
  await assert.rejects(recoverKeeperOutput(f.params), /excessive/); assert.equal(f.calls.length, 0);
});
test("prepared claim is reconciled after a lost reply even when retained balance is zero", async t => {
  const f = recovery(t, { balance: "0" });
  f.db.prepare("INSERT INTO qgold_keeper_steps VALUES(?,101,1,'prepared',?,NULL)").run("op", evidence.recover.attempt.request);
  assert.equal((await recoverKeeperOutput(f.params)).state, "succeeded");
  assert.equal(f.calls.length, 1); assert.ok(!f.views.some(v => v.method === "get_lostfound_token"));
});
test("recovery rejects stored claim for a different swap", async t => {
  const f = recovery(t); const request = { ...JSON.parse(evidence.recover.attempt.request), swapTx: "other" };
  f.db.prepare("INSERT INTO qgold_keeper_steps VALUES(?,101,1,'prepared',?,NULL)").run("op", JSON.stringify(request));
  await assert.rejects(recoverKeeperOutput(f.params), /original swap/); assert.equal(f.calls.length, 0);
});
test("recovery signing cannot sweep a different token, amount or receiver", async t => {
  const f = keeperFixture(); t.after(f.close); const transport = await keeperTransport(f.keeper);
  const request = { ...JSON.parse(evidence.recover.attempt.request), contractId: "v2.ref-finance.testnet" };
  // Use the actual configured fixture identity, not the recorded sandbox ID.
  request.contractId = JSON.parse(transport.identity).rhea;
  await transport.prepare(request);
  for (const change of [{ contractId: "attacker.testnet" }, { tokenOut: "attacker.testnet" }, { args: { token_id: "attacker.testnet" } }, { expectedAmount: "0" }, { swapTx: "bad" }, { deposit: "2" }])
    await assert.rejects(() => transport.prepare({ ...request, ...change }));
});

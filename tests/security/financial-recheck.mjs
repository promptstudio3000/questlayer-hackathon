// Diagnostic negative controls for OPEN audit findings, not passing regressions.
// Synthetic finalized receipt models and an in-memory DB only; no RPC or secrets.
// Exit 2 means the listed pre-existing defects were reproduced.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { openDatabase, createPlayer } from "../../server/database.mjs";
import { prepareQgoldBurn, confirmQgoldBurn } from "../../server/gold-spend/qgold-burn.mjs";
const output = process.argv[2]; assert.ok(output, "Pass a local JSON report path");
const db = openDatabase(":memory:"), player = createPlayer(db, "Synthetic audit player", 1);
const account = "player.testnet", contract = "qgold.testnet", hash = "8".repeat(44);
const prepare = () => prepareQgoldBurn({ contract, accountId: account, kind: "emote", amountU: 500000, kinds: ["emote"] });
const report = { at: new Date().toISOString(), scope: "modeled receipt / in-memory database; no chain", findings: [], releaseReady: false };
const outcome = (call, delegated = false) => {
  const action = { FunctionCall: { method_name: "ft_burn", args: Buffer.from(JSON.stringify(call.args)).toString("base64"), gas: call.gas, deposit: "1" } };
  const root = delegated ? "delegate-root" : "burn-root";
  return { final_execution_status: "FINAL", status: { SuccessValue: "" },
    transaction: { hash, signer_id: delegated ? "relayer.testnet" : account, receiver_id: delegated ? account : contract,
      actions: delegated ? [{ Delegate: { delegate_action: { sender_id: account, receiver_id: contract, nonce: 1, max_block_height: 100,
        public_key: "synthetic-public-key", actions: [action] } } }] : [action] },
    transaction_outcome: { id: hash, outcome: { executor_id: delegated ? "relayer.testnet" : account, status: { SuccessReceiptId: root }, receipt_ids: [root], logs: [] } },
    receipts_outcome: [ ...(delegated ? [{ id: root, outcome: { executor_id: account, status: { SuccessValue: "" }, receipt_ids: ["burn-root"], logs: [] } }] : []),
      { id: "burn-root", outcome: { executor_id: contract, status: { SuccessValue: "" }, receipt_ids: [], logs: [`EVENT_JSON:${JSON.stringify({
        standard: "nep141", version: "1.0.0", event: "ft_burn", data: [{ owner_id: account, ...call.args }] })}`] } } ] };
};
try {
  const one = prepare(), two = prepare();
  assert.notEqual(one.args.memo, two.args.memo);
  report.findings.push({ id: "A05-intent", reproduced: true, observation: "The same purchase price/kind prepares different burn memos on retry; no durable intent was returned." });
  const delegated = outcome(one, true);
  await assert.rejects(confirmQgoldBurn(db, { player, accountIds: [account], contract, txHash: hash, txStatus: async () => delegated }), e => e.code === "BURN_SIGNER");
  report.findings.push({ id: "A05-delegate", reproduced: true, observation: "A modeled successful delegated player burn is rejected as BURN_SIGNER." });
  const suppliedHash = "9".repeat(44), direct = outcome(two);
  const credit = await confirmQgoldBurn(db, { player, accountIds: [account], contract, txHash: suppliedHash, txStatus: async () => direct });
  assert.equal(credit.tx_hash, suppliedHash); assert.notEqual(direct.transaction.hash, suppliedHash);
  report.findings.push({ id: "A05-binding", reproduced: true, observation: "A mismatched RPC transaction hash is accepted as a burn credit; exact transaction binding is absent. This alone does not demonstrate attacker control of trusted RPC." });
  process.exitCode = 2;
} finally { db.close(); writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); }

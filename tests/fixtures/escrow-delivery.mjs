// Receipt-shaped unit data; actual WASM coverage lives in tests/sandbox/.
import assert from "node:assert/strict";
let sequence = 0;
export const DELIVERY_IDENTITY = JSON.stringify({ chainId: "test-chain-unit", contractId: "escrow.testnet", tokenId: "qgold.testnet", publisherId: "pub.testnet", publicKey: "ed25519:unit" });
const result = (value) => ({ SuccessValue: Buffer.from(JSON.stringify(value)).toString("base64") });
const log = (standard, event, data) => `EVENT_JSON:${JSON.stringify({ standard, version: "1.0.0", event, data: [data] })}`;
export function deliveryOutcome(a, { failed = false, rejected = false, amount = "100" } = {}) {
  const args = JSON.parse(a.args), root = `${a.tx}-root`, token = `${a.tx}-token`, callback = `${a.tx}-callback`;
  const withdrawal = a.method === "withdraw_for" && !rejected;
  const final = rejected ? { Failure: { ActionError: { kind: "ExecutionError" } } } : result(withdrawal ? failed ? "0" : amount : {});
  const node = (id, executor_id, status, logs = [], receipt_ids = []) => ({ id, outcome: { executor_id, status, logs, receipt_ids } });
  return {
    final_execution_status: "FINAL", status: final,
    transaction: { hash: a.tx, signer_id: "pub.testnet", receiver_id: "escrow.testnet", public_key: "ed25519:unit",
      actions: [{ FunctionCall: { method_name: a.method, args: Buffer.from(a.args).toString("base64"), gas: "120000000000000", deposit: "0" } }] },
    transaction_outcome: node(a.tx, "pub.testnet", { SuccessReceiptId: root }, [], [root]),
    receipts_outcome: [node(root, "escrow.testnet", withdrawal ? { SuccessReceiptId: callback } : final,
      withdrawal ? [log("questlayer-escrow", "withdraw_started", { account_id: args.account_id, amount })] : [], withdrawal ? [token, callback] : []),
    ...(withdrawal ? [
      node(token, "qgold.testnet", failed ? { Failure: "token paused" } : result(null), failed ? [] : [log("nep141", "ft_transfer", { old_owner_id: "escrow.testnet", new_owner_id: args.account_id, amount })]),
      node(callback, "escrow.testnet", final, [log("questlayer-escrow", failed ? "withdraw_failed" : "withdrawn", { account_id: args.account_id, amount })]),
    ] : [])],
  };
}
export function mockDelivery(onSend = async () => {}, { outcomes = new Map() } = {}) {
  return {
    scope: "unit-escrow", identity: DELIVERY_IDENTITY, outcomes,
    verify(a, op) { assert.equal(a.identity, DELIVERY_IDENTITY); assert.equal(a.method, op.method); assert.equal(a.args, op.args); },
    async prepare(op) { return { identity: DELIVERY_IDENTITY, method: op.method, args: op.args, tx: `unit-${++sequence}`, signed_tx: "synthetic-unit-signature" }; },
    async status(a) { if (!outcomes.has(a.tx)) throw Error("Unknown transaction"); return outcomes.get(a.tx); },
    async send(a) {
      const options = await onSend(a.method, JSON.parse(a.args), a);
      const outcome = deliveryOutcome(a, options && typeof options === "object" ? options : {});
      outcomes.set(a.tx, outcome); return outcome;
    },
  };
}

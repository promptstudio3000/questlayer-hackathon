// A FINAL transaction is not necessarily a delivered token transfer: the
// escrow's successful callback can return zero after restoring failed credit.
const need = (ok) => { if (!ok) throw Error("Incomplete or mismatched escrow receipt evidence"); };
const amount = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v) && BigInt(v) < 2n ** 128n;
const decoded = (status) => {
  need(typeof status?.SuccessValue === "string");
  return JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8"));
};
function events(node, standard, event) {
  return (node.outcome.logs ?? []).flatMap((line) => {
    if (!line.startsWith("EVENT_JSON:")) return [];
    const value = JSON.parse(line.slice(11));
    return value.standard === standard && value.version === "1.0.0" && value.event === event && Array.isArray(value.data) ? value.data : [];
  });
}

/** Unknown/incomplete proof stays pending; only a proved rejection may be retried with a new transaction. */
export function assessEscrowDelivery(attempt, response) {
  try {
    need(response?.final_execution_status === "FINAL");
    const r = response.final_execution_outcome ?? response;
    const identity = JSON.parse(attempt.identity), args = JSON.parse(attempt.args);
    const tx = r.transaction, action = tx?.actions?.[0]?.FunctionCall;
    need(tx?.hash === attempt.tx && tx.signer_id === identity.publisherId && tx.receiver_id === identity.contractId);
    need(tx.public_key === identity.publicKey && tx.actions.length === 1);
    need(action?.method_name === attempt.method && action.deposit === "0" && String(action.gas) === "120000000000000");
    need(Buffer.from(action.args, "base64").toString() === attempt.args);
    need(r.transaction_outcome?.id === attempt.tx);
    const nodes = new Map();
    for (const node of r.receipts_outcome ?? []) {
      need(typeof node.id === "string" && !nodes.has(node.id)); nodes.set(node.id, node);
    }
    const rootId = r.transaction_outcome.outcome.status?.SuccessReceiptId;
    need(r.transaction_outcome.outcome.receipt_ids.includes(rootId));
    const root = nodes.get(rootId);
    need(root?.outcome.executor_id === identity.contractId);
    // Only outcomes descended from this transaction may supply payout evidence.
    const reachable = new Map(), visit = (id) => {
      if (reachable.has(id)) return;
      const node = nodes.get(id); need(node); reachable.set(id, node);
      for (const child of node.outcome.receipt_ids ?? []) visit(child);
    };
    for (const id of r.transaction_outcome.outcome.receipt_ids) visit(id);
    if (root.outcome.status?.Failure) {
      need(attempt.method !== "withdraw_for" || events(root, "questlayer-escrow", "withdraw_started").length === 0);
      return { state: "retry", reason: "final_contract_rejection" };
    }
    if (attempt.method !== "withdraw_for") {
      need(typeof root.outcome.status?.SuccessValue === "string" && typeof r.status?.SuccessValue === "string");
      return { state: "delivered", reason: "final_contract_execution" };
    }
    const started = events(root, "questlayer-escrow", "withdraw_started");
    need(started.length === 1 && started[0].account_id === args.account_id && amount(started[0].amount) && BigInt(started[0].amount) > 0n);
    const expected = started[0].amount;
    let terminal = root;
    const followed = new Set();
    while (terminal.outcome.status?.SuccessReceiptId) {
      const next = terminal.outcome.status.SuccessReceiptId;
      need(!followed.has(next) && reachable.has(next)); followed.add(next); terminal = reachable.get(next);
    }
    need(terminal !== root && terminal.outcome.executor_id === identity.contractId);
    const value = decoded(terminal.outcome.status);
    need(amount(value) && decoded(r.status) === value);
    const transfers = [...reachable.values()].filter((n) => n.outcome.executor_id === identity.tokenId)
      .flatMap((n) => events(n, "nep141", "ft_transfer").map((e) => ({ node: n, event: e })))
      .filter(({ event: e }) => e.old_owner_id === identity.contractId);
    if (value === expected) {
      const withdrawn = events(terminal, "questlayer-escrow", "withdrawn");
      need(withdrawn.length === 1 && withdrawn[0].account_id === args.account_id && withdrawn[0].amount === expected);
      need(transfers.length === 1 && transfers[0].event.new_owner_id === args.account_id && transfers[0].event.amount === expected);
      need(typeof transfers[0].node.outcome.status?.SuccessValue === "string");
      return { state: "delivered", reason: "final_token_delivery", amount: expected };
    }
    const restored = events(terminal, "questlayer-escrow", "withdraw_failed");
    need(value === "0" && transfers.length === 0 && restored.length === 1);
    need(restored[0].account_id === args.account_id && restored[0].amount === expected);
    need([...reachable.values()].some((n) => n.outcome.executor_id === identity.tokenId && n.outcome.status?.Failure));
    return { state: "retry", reason: "credit_restored_after_failed_transfer", amount: expected };
  } catch {
    return { state: "pending", reason: "unverified_receipt_outcome" };
  }
}

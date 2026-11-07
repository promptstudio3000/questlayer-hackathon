import { isDeepStrictEqual } from "node:util";
const need = (v) => {
  if (!v) throw Error("Incomplete purchase evidence");
};
const success = (n) => typeof n?.outcome?.status?.SuccessValue === "string";
export function burnEvents(outcome, contract) {
  return (outcome?.receipts_outcome ?? [])
    .filter((n) => n.outcome?.executor_id === contract && success(n))
    .flatMap((n) =>
      (n.outcome.logs ?? []).flatMap((line) => {
        if (!line.startsWith("EVENT_JSON:")) return [];
        try {
          const e = JSON.parse(line.slice(11));
          return e.standard === "nep141" &&
            e.version === "1.0.0" &&
            e.event === "ft_burn" &&
            Array.isArray(e.data)
            ? e.data
            : [];
        } catch {
          return [];
        }
      }),
    );
}
/** A relayer's outer signer is not the owner of the delegated burn. */
export function assessBurn(purchase, txHash, response) {
  try {
    need(response?.final_execution_status === "FINAL");
    const r = response.final_execution_outcome ?? response,
      tx = r.transaction;
    need(
      tx?.hash === txHash &&
        tx.actions?.length === 1 &&
        r.transaction_outcome?.id === txHash,
    );
    const delegated = tx.actions[0].Delegate?.delegate_action;
    const action = delegated
      ? delegated.actions?.[0]?.FunctionCall
      : tx.actions[0].FunctionCall;
    need(
      delegated
        ? delegated.sender_id === purchase.account_id &&
            delegated.receiver_id === purchase.contract_id &&
            tx.receiver_id === purchase.account_id &&
            delegated.actions.length === 1
        : tx.signer_id === purchase.account_id &&
            tx.receiver_id === purchase.contract_id,
    );
    need(
      action?.method_name === "ft_burn" &&
        action.deposit === "1" &&
        String(action.gas) === "30000000000000",
    );
    need(
      isDeepStrictEqual(
        JSON.parse(Buffer.from(action.args, "base64").toString()),
        { amount: String(purchase.amount_u), memo: purchase.memo },
      ),
    );
    const nodes = new Map(),
      reachable = new Map();
    for (const n of r.receipts_outcome ?? []) {
      need(typeof n.id === "string" && !nodes.has(n.id));
      nodes.set(n.id, n);
    }
    function visit(id) {
      if (reachable.has(id)) return;
      const n = nodes.get(id),
        s = n?.outcome?.status;
      need(n && s && Object.keys(s).length === 1);
      need(
        typeof s.SuccessValue === "string" ||
          typeof s.SuccessReceiptId === "string" ||
          !!s.Failure,
      );
      reachable.set(id, n);
      if (s.SuccessReceiptId)
        need(n.outcome.receipt_ids?.includes(s.SuccessReceiptId));
      for (const next of n.outcome.receipt_ids ?? []) visit(next);
    }
    const rootId = r.transaction_outcome.outcome.status?.SuccessReceiptId;
    need(r.transaction_outcome.outcome.receipt_ids?.includes(rootId));
    for (const id of r.transaction_outcome.outcome.receipt_ids) visit(id);
    const root = reachable.get(rootId);
    need(
      root.outcome.executor_id ===
        (delegated ? purchase.account_id : purchase.contract_id),
    );
    if (root.outcome.status.Failure) {
      need(r.status?.Failure);
      return {
        state: "rejected",
        txHash,
        retrySafe:
          !delegated ||
          JSON.stringify(root.outcome.status.Failure).includes(
            "DelegateActionExpired",
          ),
      };
    }
    let burn = root;
    if (delegated) {
      need(
        success(root) ||
          typeof root.outcome.status.SuccessReceiptId === "string",
      );
      const targets = (root.outcome.receipt_ids ?? [])
        .map((id) => reachable.get(id))
        .filter((n) => n.outcome.executor_id === purchase.contract_id);
      need(targets.length === 1);
      burn = targets[0];
      if (root.outcome.status.SuccessReceiptId)
        need(root.outcome.status.SuccessReceiptId === burn.id);
    }
    if (burn.outcome.status.Failure)
      return { state: "rejected", txHash, retrySafe: true };
    need(
      success(burn) &&
        burn.outcome.status.SuccessValue === "" &&
        r.status?.SuccessValue === "",
    );
    need([...reachable.values()].every((n) => !n.outcome.status.Failure));
    const events = burnEvents(
      { receipts_outcome: [...reachable.values()] },
      purchase.contract_id,
    );
    need(
      events.length === 1 &&
        isDeepStrictEqual(events[0], {
          owner_id: purchase.account_id,
          amount: String(purchase.amount_u),
          memo: purchase.memo,
        }),
    );
    need(
      burnEvents({ receipts_outcome: [burn] }, purchase.contract_id).length ===
        1,
    );
    return {
      state: "succeeded",
      txHash,
      accountId: purchase.account_id,
      contractId: purchase.contract_id,
      receiptId: burn.id,
    };
  } catch {
    return { state: "pending" };
  }
}

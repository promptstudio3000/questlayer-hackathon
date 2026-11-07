const need = (ok) => { if (!ok) throw Error("Incomplete keeper receipt evidence"); };
const integer = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v) && BigInt(v) < 2n ** 128n;
const value = (s) => { need(typeof s?.SuccessValue === "string"); return JSON.parse(Buffer.from(s.SuccessValue, "base64").toString()); };
function events(node, event) {
  return (node.outcome.logs ?? []).flatMap((line) => {
    if (!line.startsWith("EVENT_JSON:")) return [];
    const e = JSON.parse(line.slice(11));
    return e.standard === "nep141" && e.version === "1.0.0" && e.event === event && Array.isArray(e.data) ? e.data : [];
  });
}
function transfers(node, legacy) {
  const modern = events(node, "ft_transfer");
  if (modern.length || !legacy) return modern;
  return (node.outcome.logs ?? []).flatMap((line) => {
    const m = /^(?:Transfer|Refund) ([0-9]+) from ([a-z0-9._-]+) to ([a-z0-9._-]+)$/.exec(line);
    return m ? [{ amount: m[1], old_owner_id: m[2], new_owner_id: m[3] }] : [];
  });
}

/** Never substitute a current wallet balance or an unrelated transaction for this step's receipts. */
export function assessKeeperStep(attempt, response) {
  try {
    need(response?.final_execution_status === "FINAL");
    const r = response.final_execution_outcome ?? response, id = JSON.parse(attempt.identity), request = JSON.parse(attempt.request);
    const tx = r.transaction, action = tx?.actions?.[0]?.FunctionCall;
    need(tx?.hash === attempt.tx && tx.signer_id === id.accountId && tx.public_key === id.publicKey && tx.receiver_id === request.contractId);
    need(tx.actions.length === 1 && action?.method_name === request.methodName && String(action.gas) === request.gas && action.deposit === request.deposit);
    need(Buffer.from(action.args, "base64").toString() === JSON.stringify(request.args));
    need(r.transaction_outcome?.id === attempt.tx);
    const nodes = new Map();
    for (const n of r.receipts_outcome ?? []) { need(typeof n.id === "string" && !nodes.has(n.id)); nodes.set(n.id, n); }
    const reachable = new Map();
    function visit(key, into = reachable) {
      if (into.has(key)) return;
      const n = nodes.get(key); need(n); into.set(key, n);
      for (const child of n.outcome.receipt_ids ?? []) visit(child, into);
    }
    const rootId = r.transaction_outcome.outcome.status?.SuccessReceiptId;
    need(r.transaction_outcome.outcome.receipt_ids.includes(rootId));
    for (const key of r.transaction_outcome.outcome.receipt_ids) visit(key);
    const root = reachable.get(rootId); need(root?.outcome.executor_id === request.contractId);
    if (root.outcome.status?.Failure) {
      // This single function call reverted atomically. FINAL also includes
      // protocol deposit/gas refunds; a later failed promise is not this case.
      need(r.status?.Failure);
      return { state: "retry", reason: "final_root_rejection" };
    }
    let terminal = root; const followed = new Set();
    while (terminal.outcome.status?.SuccessReceiptId) {
      const next = terminal.outcome.status.SuccessReceiptId;
      need(!followed.has(next) && reachable.has(next)); followed.add(next); terminal = reachable.get(next);
    }
    need(typeof terminal.outcome.status?.SuccessValue === "string" && typeof r.status?.SuccessValue === "string");
    need(terminal.outcome.status.SuccessValue === r.status.SuccessValue);
    const allSucceeded = [...reachable.values()].every((n) => !n.outcome.status?.Failure);
    if (request.phase === "fund") {
      need(allSucceeded && terminal === root);
      if (request.methodName === "deposit") {
        const minted = events(root, "ft_mint"), got = value(r.status);
        need(integer(got) && BigInt(got) > 0n && BigInt(got) >= BigInt(request.args.min_out));
        need(minted.length === 1 && minted[0].owner_id === id.accountId && minted[0].amount === got);
        return { state: "succeeded", amount: got };
      }
      need(request.methodName === "near_deposit" && request.contractId === id.wnear);
      const mints = events(root, "ft_mint").filter((e) => e.owner_id === id.accountId).map((e) => e.amount);
      const legacy = (root.outcome.logs ?? []).flatMap((line) => {
        const m = /^Deposit ([0-9]+) NEAR to ([a-z0-9._-]+)$/.exec(line);
        return m && m[2] === id.accountId ? [m[1]] : [];
      });
      const amounts = mints.length ? mints : legacy;
      need(amounts.length === 1 && integer(amounts[0]) && BigInt(amounts[0]) > 0n && BigInt(amounts[0]) <= BigInt(request.deposit));
      return { state: "succeeded", amount: amounts[0] };
    }
    if (request.phase === "burn") {
      const burned = events(root, "ft_burn");
      need(allSucceeded && terminal === root && request.contractId === id.qgold && request.methodName === "ft_burn");
      need(burned.length === 1 && burned[0].owner_id === id.accountId && burned[0].amount === request.args.amount && burned[0].memo === request.args.memo);
      return { state: "succeeded", amount: request.args.amount };
    }
    need(request.phase === "swap" && request.methodName === "ft_transfer_call" && terminal.outcome.executor_id === request.contractId);
    const used = value(r.status); need(integer(used));
    const input = transfers(root, request.contractId === id.wnear);
    need(input.length === 1 && input[0].old_owner_id === id.accountId && input[0].new_owner_id === id.rhea && input[0].amount === request.args.amount);
    const dex = [...reachable.values()].filter((n) => n.outcome.executor_id === id.rhea);
    need(dex.length > 0);
    const descendants = new Map(); for (const n of dex) visit(n.id, descendants);
    const outputs = [...descendants.values()].filter((n) => n.outcome.executor_id === request.tokenOut)
      .flatMap((n) => transfers(n, request.tokenOut === id.wnear).map((e) => ({ n, e })))
      .filter(({ e }) => e.old_owner_id === id.rhea && e.new_owner_id === id.accountId);
    if (used === request.args.amount) {
      need(allSucceeded && outputs.length === 1 && typeof outputs[0].n.outcome.status?.SuccessValue === "string");
      const got = outputs[0].e.amount;
      need(integer(got) && BigInt(got) > 0n && BigInt(got) >= BigInt(request.minOut));
      return { state: "succeeded", amount: got };
    }
    const refunds = transfers(terminal, request.contractId === id.wnear);
    need(used === "0" && outputs.length === 0 && refunds.length === 1);
    need(refunds[0].old_owner_id === id.rhea && refunds[0].new_owner_id === id.accountId && refunds[0].amount === request.args.amount);
    need(dex.some((n) => n.outcome.status?.Failure));
    return { state: "retry", reason: "full_swap_input_refunded" };
  } catch {
    return { state: "pending", reason: "unverified_keeper_receipts" };
  }
}

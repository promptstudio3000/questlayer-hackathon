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

// A failed output has no token event. Bind its actual action arguments and the
// successful Rhea restoration callback to the finalized swap receipt tree.
function retainedOutput(r, id, request, reachable, dexRoot, expected) {
  const children = (dexRoot.outcome.receipt_ids ?? []).map((key) => reachable.get(key));
  const failed = children.filter((n) => n?.outcome.executor_id === request.tokenOut && n.outcome.status?.Failure);
  const callbacks = children.filter((n) => n?.outcome.executor_id === id.rhea && n !== dexRoot && n.outcome.status?.SuccessValue);
  need(failed.length === 1 && callbacks.length === 1);
  need([...reachable.values()].filter((n) => n.outcome.status?.Failure).length === 1);
  const ids = [failed[0].id, callbacks[0].id];
  const receipts = new Map((r.receipts ?? []).map((n) => [n.receipt_id, n]));
  if (!ids.every((key) => receipts.has(key))) return { state: "pending", reason: "rhea_receipts_required", receiptIds: ids };
  const call = (key, receiver, method) => {
    const receipt = receipts.get(key), a = receipt?.receipt?.Action;
    need(receipt?.predecessor_id === id.rhea && receipt.receiver_id === receiver && a?.actions?.length === 1);
    const action = a.actions[0].FunctionCall; need(action?.method_name === method);
    return { args: JSON.parse(Buffer.from(action.args, "base64").toString()), deposit: action.deposit };
  };
  const output = call(ids[0], request.tokenOut, "ft_transfer"), callback = call(ids[1], id.rhea, "exchange_callback_post_withdraw");
  need(output.deposit === "1" && output.args.receiver_id === id.accountId && output.args.amount === expected);
  need(callback.deposit === "0" && callback.args.token_id === request.tokenOut && callback.args.sender_id === id.accountId && callback.args.amount === expected);
  need(value(callbacks[0].outcome.status) === "0");
  const logs = callbacks[0].outcome.logs ?? [];
  // Never claim the DEX owner's aggregate balance. Unsupported destinations or
  // unexpected callback logs remain pending for explicit reconciliation.
  const user = logs.includes("Depositing to user lostfound account.");
  const location = user && logs.length === 2 && logs[0].startsWith(`Account ${id.accountId} `) ? "lostfound" : logs.length === 0 ? "deposit" : null;
  need(location);
  return { state: "recoverable", reason: "rhea_output_retained", amount: expected, location,
    outputReceipt: ids[0], callbackReceipt: ids[1] };
}

/** Never substitute a current wallet balance or an unrelated transaction for this step's receipts. */
export function assessKeeperStep(attempt, response) {
  try {
    need(response?.final_execution_status === "FINAL");
    const r = response.final_execution_outcome ? { ...response.final_execution_outcome,
      receipts: response.receipts ?? response.final_execution_outcome.receipts } : response;
    const id = JSON.parse(attempt.identity), request = JSON.parse(attempt.request);
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
      const status = n.outcome?.status;
      need(status && Object.keys(status).length === 1 &&
        (typeof status.SuccessValue === "string" || typeof status.SuccessReceiptId === "string" ||
          (status.Failure && typeof status.Failure === "object")));
      if (status.SuccessReceiptId) need(n.outcome.receipt_ids?.includes(status.SuccessReceiptId));
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
    if (request.phase === "register") {
      need(allSucceeded && terminal === root && request.methodName === "storage_deposit");
      const storage = value(r.status);
      need(storage && integer(storage.total) && BigInt(storage.total) >= BigInt(request.deposit) && storage.available === "0");
      return { state: "succeeded", amount: request.deposit };
    }
    if (request.phase === "recover") {
      need(request.contractId === id.rhea && ["claim_lostfound", "withdraw"].includes(request.methodName));
      need(terminal.outcome.executor_id === id.rhea && terminal !== root && integer(request.expectedAmount));
      const got = value(r.status);
      const outputs = [...reachable.values()].filter((n) => n.outcome.executor_id === request.tokenOut)
        .flatMap((n) => transfers(n, request.tokenOut === id.wnear).map((e) => ({ n, e })))
        .filter(({ e }) => e.old_owner_id === id.rhea);
      if (got === request.expectedAmount) {
        need(allSucceeded && outputs.length === 1 && typeof outputs[0].n.outcome.status?.SuccessValue === "string");
        need(outputs[0].e.new_owner_id === id.accountId && outputs[0].e.amount === got);
        return { state: "succeeded", amount: got, swapTx: request.swapTx };
      }
      need(got === "0" && outputs.length === 0);
      const proof = retainedOutput(r, id, request, reachable, root, request.expectedAmount);
      return proof.state === "recoverable" ? { ...proof, state: "retry", reason: "rhea_recovery_output_restored" } : proof;
    }
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
      if (!allSucceeded && outputs.length === 0) {
        const swapRoots = dex.filter((n) => (root.outcome.receipt_ids ?? []).includes(n.id));
        need(swapRoots.length === 1 && value(swapRoots[0].outcome.status) === "0");
        const logs = (swapRoots[0].outcome.logs ?? []).filter((line) => line.startsWith("Swapped "));
        need(logs.length === 1);
        const match = /^Swapped ([0-9]+) ([a-z0-9._-]+) for ([0-9]+) ([a-z0-9._-]+)$/.exec(logs[0]);
        need(match && match[1] === request.args.amount && match[2] === request.contractId && match[4] === request.tokenOut);
        need(integer(match[3]) && BigInt(match[3]) > 0n && BigInt(match[3]) >= BigInt(request.minOut));
        return retainedOutput(r, id, request, reachable, swapRoots[0], match[3]);
      }
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

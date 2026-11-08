// Recover only a receipt-proved retained swap output. Aggregate balances alone
// never authorize a claim or a burn, and no path here can buy tokens again.
const need = (ok, message) => { if (!ok) throw Error(message); };
const amount = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v) && BigInt(v) < 2n ** 128n;
export const RECOVERY_STORAGE_STEP = 100, RECOVERY_CLAIM_STEP = 101;

export async function recoverKeeperOutput({ db, op, swap, proof, transport, current, advance }) {
  const identity = JSON.parse(op.identity), request = JSON.parse(swap.request), token = request.tokenOut;
  need(proof.state === "recoverable" && amount(proof.amount) && BigInt(proof.amount) > 0n, "Missing retained-output proof");
  const latest = (step) => db.prepare("SELECT * FROM qgold_keeper_steps WHERE op_id=? AND step=? ORDER BY attempt DESC LIMIT 1").get(op.id, step);
  const storage = latest(RECOVERY_STORAGE_STEP);
  if (storage) {
    const result = await advance(RECOVERY_STORAGE_STEP, JSON.parse(storage.request));
    if (result.proof.state !== "succeeded") return null;
  } else {
    const registered = await transport.view(token, "storage_balance_of", { account_id: identity.accountId }); current();
    if (!registered) {
      const bounds = await transport.view(token, "storage_balance_bounds", {}); current();
      need(amount(bounds?.min) && BigInt(bounds.min) > 0n && BigInt(bounds.min) <= 1250000000000000000000n,
        "Unverified or excessive keeper storage quote");
      const result = await advance(RECOVERY_STORAGE_STEP, { contractId: token, methodName: "storage_deposit",
        args: { account_id: identity.accountId, registration_only: true }, deposit: bounds.min, gas: "30000000000000", phase: "register" });
      if (result.proof.state !== "succeeded") return null;
    }
  }
  // A prepared attempt always takes precedence over today's balances: a lost
  // successful reply leaves a zero lost-found balance but still needs its ack.
  const claim = latest(RECOVERY_CLAIM_STEP);
  let claimRequest;
  if (claim && claim.state !== "retry") claimRequest = JSON.parse(claim.request);
  else {
    const previous = claim?.proof ? JSON.parse(claim.proof) : null;
    const location = previous?.location ?? proof.location;
    let available;
    if (location === "lostfound") available = await transport.view(identity.rhea, "get_lostfound_token", { account_id: identity.accountId, token_id: token });
    else {
      need(location === "deposit", "Rhea output is not owned by the keeper");
      const deposits = await transport.view(identity.rhea, "get_deposits", { account_id: identity.accountId });
      available = deposits?.[token] ?? "0";
    }
    current();
    // claim_lostfound has no amount parameter. Refuse missing, partial or pooled
    // inventory instead of sweeping unrelated rights into this operation.
    need(available === proof.amount, "Rhea retained output is ambiguous; preserve the operation for reconciliation");
    claimRequest = { contractId: identity.rhea, methodName: location === "lostfound" ? "claim_lostfound" : "withdraw",
      args: location === "lostfound" ? { token_id: token } : { token_id: token, amount: proof.amount, unregister: false, skip_unwrap_near: true },
      deposit: "1", gas: "100000000000000", phase: "recover", tokenOut: token, expectedAmount: proof.amount, swapTx: swap.tx };
  }
  need(claimRequest.swapTx === swap.tx && claimRequest.expectedAmount === proof.amount && claimRequest.tokenOut === token,
    "Recovery request is not bound to the original swap");
  const result = await advance(RECOVERY_CLAIM_STEP, claimRequest);
  if (result.proof.state !== "succeeded") return null;
  need(result.proof.amount === proof.amount && result.proof.swapTx === swap.tx, "Recovery output attribution mismatch");
  return { state: "succeeded", amount: proof.amount, recoveryTx: result.attempt.tx, swapTx: swap.tx };
}

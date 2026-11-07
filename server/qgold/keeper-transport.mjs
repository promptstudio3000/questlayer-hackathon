import { createHash } from "node:crypto";
import { actions, baseEncode, decodeSignedTransaction } from "near-api-js";

const need = (ok) => { if (!ok) throw Error("Keeper transaction identity or request mismatch"); };
const hash = (signed) => baseEncode(createHash("sha256").update(signed.transaction.encode()).digest());

// Only explicit one-action requests produced by the persisted keeper plan are signed.
export async function keeperTransport(k) {
  const status = await k.provider.viewNodeStatus();
  const publicKey = (await k.account.signer.getPublicKey()).toString();
  need(typeof status.chain_id === "string" && status.chain_id.length > 0);
  need(Number.isInteger(k.poolId) && k.poolId >= 0 && new Set([k.qgoldId, k.wnear, k.rhea?.contractId, k.account.accountId]).size === 4);
  const identity = JSON.stringify({ chainId: status.chain_id, accountId: k.account.accountId,
    publicKey, qgold: k.qgoldId, wnear: k.wnear, rhea: k.rhea?.contractId, poolId: k.poolId });
  const positive = (v) => typeof v === "string" && /^[1-9][0-9]{0,38}$/.test(v) && BigInt(v) < 2n ** 128n;
  const allowed = (r) => {
    const gas = (n) => r.gas === String(BigInt(n) * 10n ** 12n);
    if (r.phase === "fund") {
      need(positive(r.deposit));
      if (r.methodName === "near_deposit") need(r.contractId === k.wnear && gas(30) && JSON.stringify(r.args) === "{}");
      else need(r.methodName === "deposit" && r.contractId === k.qgoldId && gas(100) && positive(r.args.min_out) && Object.keys(r.args).length === 1);
    } else if (r.phase === "burn") {
      need(r.contractId === k.qgoldId && r.methodName === "ft_burn" && r.deposit === "1" && gas(30) && positive(r.args.amount));
      need(["qgold-keeper:inverse-buy-burn", "qgold-keeper:buyback-burn"].includes(r.args.memo) && Object.keys(r.args).length === 2);
    } else {
      need(r.phase === "swap" && [k.wnear, k.qgoldId].includes(r.contractId) && r.methodName === "ft_transfer_call" && r.deposit === "1" && gas(150));
      need(r.args.receiver_id === k.rhea.contractId && positive(r.args.amount) && positive(r.minOut) && Object.keys(r.args).length === 3);
      const tokenOut = r.contractId === k.wnear ? k.qgoldId : k.wnear;
      need(r.tokenOut === tokenOut && r.args.msg === JSON.stringify({ force: 0, actions: [{ pool_id: k.poolId,
        token_in: r.contractId, token_out: tokenOut, amount_in: r.args.amount, min_amount_out: r.minOut }] }));
    }
  };
  const verify = (attempt, request) => {
    allowed(request);
    need(attempt.identity === identity && attempt.request === JSON.stringify(request));
    const signed = decodeSignedTransaction(Buffer.from(attempt.signed_tx, "base64")), tx = signed.transaction;
    const action = tx.actions[0]?.functionCall;
    need(hash(signed) === attempt.tx && tx.signerId === k.account.accountId && tx.publicKey.toString() === publicKey &&
      tx.receiverId === request.contractId && tx.actions.length === 1 && action?.methodName === request.methodName &&
      action.gas === BigInt(request.gas) && action.deposit === BigInt(request.deposit) &&
      Buffer.from(action.args).toString() === JSON.stringify(request.args));
    return signed;
  };
  return {
    identity, verify,
    async prepare(request) {
      allowed(request);
      const signed = await k.account.createSignedTransaction({ receiverId: request.contractId,
        actions: [actions.functionCall(request.methodName, request.args, BigInt(request.gas), BigInt(request.deposit))] });
      const attempt = { identity, request: JSON.stringify(request), tx: hash(signed), signed_tx: Buffer.from(signed.encode()).toString("base64") };
      verify(attempt, request); return attempt;
    },
    status: (attempt) => k.provider.viewTransactionStatusWithReceipts({ txHash: attempt.tx, accountId: k.account.accountId, waitUntil: "NONE" }),
    // Exact-byte replay only. Account.callFunctionRaw may re-sign after nonce errors.
    send: (attempt) => k.provider.sendTransactionUntil(decodeSignedTransaction(Buffer.from(attempt.signed_tx, "base64")), "FINAL"),
  };
}

import { createHash } from "node:crypto";
import { actions, baseEncode, decodeSignedTransaction } from "near-api-js";
import { assert } from "../domain.mjs";

export const ESCROW_DELIVERY_GAS = 120n * 10n ** 12n;
const hash = (signed) => baseEncode(createHash("sha256").update(signed.transaction.encode()).digest());

/** Used by the checked publisher transport and by synthetic local WASM signers. */
export async function escrowDeliveryTransport(provider, account, escrow, allowedMethods) {
  const status = await provider.viewNodeStatus();
  const publicKey = (await account.signer.getPublicKey()).toString();
  const identity = JSON.stringify({ chainId: status.chain_id, contractId: escrow.contractId, tokenId: escrow.tokenId,
    publisherId: account.accountId, publicKey });
  assert(account.accountId === escrow.publisherId && typeof status.chain_id === "string", "Wrong escrow publisher identity.", 503);
  const scope = JSON.stringify([status.chain_id, escrow.contractId, escrow.tokenId]);
  const verify = (attempt, op) => {
    assert(attempt.identity === identity && attempt.method === op.method && attempt.args === op.args, "Escrow attempt identity changed.", 503);
    assert(allowedMethods.includes(op.method), "Publisher method is not allowed.", 503);
    const signed = decodeSignedTransaction(Buffer.from(attempt.signed_tx, "base64")), tx = signed.transaction;
    const action = tx.actions[0]?.functionCall;
    assert(hash(signed) === attempt.tx && tx.signerId === account.accountId && tx.receiverId === escrow.contractId &&
      tx.publicKey.toString() === publicKey && tx.actions.length === 1 && action?.methodName === op.method &&
      action.deposit === 0n && action.gas === ESCROW_DELIVERY_GAS && Buffer.from(action.args).toString() === op.args,
    "Stored escrow transaction does not match its operation.", 503);
    return signed;
  };
  return {
    identity, scope, verify,
    async prepare(op) {
      assert(allowedMethods.includes(op.method), "Publisher method is not allowed.", 503);
      const signed = await account.createSignedTransaction({ receiverId: escrow.contractId,
        actions: [actions.functionCall(op.method, JSON.parse(op.args), ESCROW_DELIVERY_GAS, 0n)] });
      const attempt = { identity, method: op.method, args: op.args, tx: hash(signed), signed_tx: Buffer.from(signed.encode()).toString("base64") };
      verify(attempt, op); return attempt;
    },
    async status(attempt) {
      return provider.viewTransactionStatusWithReceipts({ txHash: attempt.tx, accountId: account.accountId, waitUntil: "NONE" });
    },
    async send(attempt) {
      // Replay these exact bytes. Never let an SDK nonce retry silently sign a different transaction.
      return provider.sendTransactionUntil(decodeSignedTransaction(Buffer.from(attempt.signed_tx, "base64")), "FINAL");
    },
  };
}

// Opt-in local-WASM transport. No application configuration or real signer files.
import assert from "node:assert/strict";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

export async function escrowLocalTransport({ rpcUrl, accountId, secretKey }) {
  const url = new URL(rpcUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port);
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const status = await provider.viewNodeStatus();
  assert.match(status.chain_id, /^test-chain-/);
  const account = new Account(accountId, provider, KeyPairSigner.fromSecretKey(secretKey));
  const view = async (contractId, method, args = {}) => {
    const r = await provider.callFunctionRaw({ contractId, method, args, finalityQuery: { finality: "final" } });
    return JSON.parse(Buffer.from(r.result).toString());
  };
  const call = async (contractId, methodName, args = {}, deposit = 0n, gas = 120n * 10n ** 12n) => {
    let raw;
    try {
      raw = await account.callFunctionRaw({ contractId, methodName, args, deposit, gas, waitUntil: "FINAL" });
    } catch (error) {
      // near-api-js throws for a finalized contract rejection. Preserve that
      // real outcome so tests can inspect both the failure receipt and balances.
      if (!error.transactionResult) throw error;
      raw = error.transactionResult;
    }
    const outcome = raw.final_execution_outcome ?? raw;
    assert.ok(outcome.transaction?.hash);
    return outcome;
  };
  return { provider, account, view, call, status };
}

export function escrowReceiptSummary(outcome) {
  return {
    hash: outcome.transaction.hash, status: outcome.status,
    receipts: outcome.receipts_outcome.map(({ outcome: r }) => ({
      executor: r.executor_id, gasBurnt: String(r.gas_burnt), status: r.status, logs: r.logs,
    })),
  };
}

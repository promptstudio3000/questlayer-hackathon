// Local integration transport only. Never load runtime configuration or real keys.
import assert from "node:assert/strict";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

export async function localTransport({ rpcUrl, secretKey, accountId }) {
  const url = new URL(rpcUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port);
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const status = await provider.viewNodeStatus();
  assert.ok(!["mainnet", "testnet", "betanet"].includes(status.chain_id));
  const account = new Account(accountId, provider, KeyPairSigner.fromSecretKey(secretKey));
  const view = async (contractId, method, args = {}) => {
    const result = await provider.callFunctionRaw({
      contractId, method, args, finalityQuery: { finality: "final" },
    });
    return JSON.parse(Buffer.from(result.result).toString());
  };
  const call = async (contractId, methodName, args = {}, deposit = 0n, gas = 280n * 10n ** 12n) => {
    const response = await account.callFunctionRaw({
      contractId, methodName, args, deposit, gas, waitUntil: "FINAL",
    });
    const outcome = response.final_execution_outcome ?? response;
    if (outcome.status?.Failure) throw Error(JSON.stringify(outcome.status.Failure));
    assert.ok(outcome.transaction?.hash, "expected a finalized transaction outcome");
    return outcome;
  };
  return { provider, account, view, call, status };
}

export function receiptSummary(outcome) {
  return {
    hash: outcome.transaction.hash,
    receipts: outcome.receipts_outcome.map(({ outcome: r }) => ({
      executor: r.executor_id,
      gasBurnt: String(r.gas_burnt),
      status: r.status,
      logs: r.logs,
    })),
  };
}

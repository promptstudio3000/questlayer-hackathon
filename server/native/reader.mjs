import { assert } from "../domain.mjs";
import { nearAccountId, assertTestnetRpc } from "../identity/near.mjs";
import { NETWORK, onNetwork } from "./network.mjs";
export class NativeContractReader {
  constructor(provider, contractId) {
    nearAccountId(contractId);
    assert(onNetwork(contractId), `Native contracts are ${NETWORK}-only.`);
    this.provider = provider;
    this.contractId = contractId;
    this.cache = new Map();
    this.pending = new Map();
  }
  async view(method, args = {}, fresh = false) {
    const key = method + ":" + JSON.stringify(args),
      cached = this.cache.get(key);
    if (!fresh && cached?.until > Date.now()) return cached.value;
    if (!fresh && this.pending.has(key)) return this.pending.get(key);
    const pending = (async () => {
      await assertTestnetRpc(this.provider);
      const r = await this.provider.query({
        request_type: "call_function",
        account_id: this.contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        finality: "final",
      });
      assert(
        Array.isArray(r.result) && r.result.length <= 1000000,
        "The native contract response is too large.",
        503,
      );
      const value = JSON.parse(Buffer.from(r.result).toString());
      if (this.pending.get(key) === pending) {
        // Oldest entry out first; clearing everything at once made every
        // player's next read go back to the RPC (docs/NEAR-RPC-CACHE.md).
        this.cache.delete(key);
        this.cache.set(key, { until: Date.now() + 15000, value });
        while (this.cache.size > 512)
          this.cache.delete(this.cache.keys().next().value);
      }
      return value;
    })();
    this.pending.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }
}

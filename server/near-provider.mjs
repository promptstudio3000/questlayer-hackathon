import { JsonRpcProvider, FailoverRpcProvider } from "near-api-js";
// Current public testnet endpoints: https://docs.near.org/api/rpc/providers
export const TESTNET_RPC = "https://test.rpc.fastnear.com";
export function createNearProvider(url = TESTNET_RPC) {
  const urls =
    // fastnear rate-limits the VPS under load (11 Nov 2026), so a second
    // fallback keeps reads working; both answer the same JSON-RPC.
    url === TESTNET_RPC
      ? [TESTNET_RPC, "https://testnet-rpc.intea.rs", "https://near-testnet.drpc.org"]
      : [url];
  const providers = urls.map(
    (url) =>
      new JsonRpcProvider({ url }, { retries: 2, wait: 250, backoff: 1.5 }),
  );
  return providers.length === 1
    ? providers[0]
    : new FailoverRpcProvider(providers);
}

export function rpcErrorText(error) {
  const seen = new Set(),
    parts = [];
  function visit(value) {
    if (!value || seen.has(value) || seen.size >= 12) return;
    seen.add(value);
    parts.push(String(value.message || value));
    if (Array.isArray(value.errors)) value.errors.forEach(visit);
    if (value.cause) visit(value.cause);
  }
  visit(error);
  return parts.join(" | ");
}

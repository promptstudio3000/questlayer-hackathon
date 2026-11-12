// Patient NEAR RPC for long deploy runs (scripts/deploy-testlayer.mjs loads it
// into itself and every deploy script with `node --import`).
//
// The free fastnear tier answers bursts with HTTP 429 or a JSON-RPC error
// -429, and the VPS shares that budget with the game server. This wraps
// fetch for JSON-RPC POSTs to the known testnet RPC hosts: calls are paced,
// a rate-limit answer waits with exponential backoff and alternates between
// fastnear and drpc (the same pair server/near-provider.mjs uses). Only
// rate-limit answers are retried for transactions, which an RPC refuses
// before it looks at them; reads also retry on 502/503/504 and network errors.
const HOSTS = ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"];
const MIN_GAP_MS = Number(process.env.RPC_PATIENCE_GAP_MS || 150);
const TRIES = Number(process.env.RPC_PATIENCE_TRIES || 9);
const SEND = new Set(["send_tx", "broadcast_tx_commit", "broadcast_tx_async"]);
const original = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
let preferred = 0;

function rpcHost(url) {
  const s = String(url);
  return HOSTS.findIndex((h) => s === h || s.startsWith(h + "/"));
}
async function paced() {
  const wait = last + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
}
const rateLimited = (status, text) =>
  status === 429 || /"code"\s*:\s*-429\b|Rate limits exceeded|Too Many Requests/i.test(text);

export async function patientFetch(input, init = {}) {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const host = rpcHost(url);
  if (host < 0 || (init.method || "GET").toUpperCase() !== "POST" || typeof init.body !== "string")
    return original(input, init);
  let method = "";
  try {
    method = JSON.parse(init.body).method || "";
  } catch {
    /* not JSON-RPC: passed through with pacing only */
  }
  const path = url.slice(HOSTS[host].length);
  let pick = preferred;
  for (let attempt = 1; ; attempt++) {
    await paced();
    const target = HOSTS[pick] + path;
    let res, text, error;
    try {
      res = await original(target, init);
      text = await res.clone().text();
    } catch (e) {
      error = e;
    }
    const limited = res && rateLimited(res.status, text);
    const flaky = !SEND.has(method) && (error || (res && [502, 503, 504].includes(res.status)));
    if ((!limited && !flaky) || attempt >= TRIES) {
      if (error) throw error;
      preferred = pick;
      return res;
    }
    const backoff = Math.min(16_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
    console.error(JSON.stringify({ rpc: "retry", method, host: HOSTS[pick], attempt, waitMs: backoff, reason: limited ? "rate limit" : error ? String(error.message || error) : res.status }));
    await sleep(backoff);
    if (attempt % 2 === 0) pick = (pick + 1) % HOSTS.length;
  }
}
globalThis.fetch = patientFetch;

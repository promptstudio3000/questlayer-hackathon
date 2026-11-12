// scripts/lib/rpc-patience.mjs: deploy runs wait out RPC rate limits.
import test from "node:test";
import assert from "node:assert/strict";

const calls = [];
let answers = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), method: JSON.parse(init.body).method });
  const a = answers.shift();
  return new Response(a.body, { status: a.status });
};
process.env.RPC_PATIENCE_GAP_MS = "0";
const { patientFetch } = await import("../scripts/lib/rpc-patience.mjs");
const post = (method) => ({ method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }) });
const ok = { status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{}}' };
const limit = { status: 200, body: '{"jsonrpc":"2.0","error":{"code":-429,"message":"Rate limits exceeded"}}' };

test("a rate limit waits and moves to the other host; a send is retried only on rate limits", { timeout: 20_000 }, async () => {
  answers = [limit, { status: 429, body: "Too Many Requests" }, ok];
  const r = await patientFetch("https://test.rpc.fastnear.com", post("query"));
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map((c) => c.url), ["https://test.rpc.fastnear.com", "https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"]);
  calls.length = 0;
  answers = [{ status: 503, body: "busy" }];
  const sent = await patientFetch("https://near-testnet.drpc.org", post("send_tx"));
  assert.equal(sent.status, 503);
  assert.equal(calls.length, 1);
  calls.length = 0;
  answers = [ok];
  await patientFetch("https://example.com/rpc", post("query"));
  assert.equal(calls[0].url, "https://example.com/rpc");
});

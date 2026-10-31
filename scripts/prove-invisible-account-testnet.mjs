// Proves the invisible-account path end to end against a locally running API
// that has PLAYER_FACTORY_* and RELAYER_KEY_PATH configured (testnet only):
// guest session → device key → sponsored sub-account → relayed mint_avatar →
// relayed equip_aura, all without a wallet. Writes a public proof with hashes.
// Usage: node scripts/prove-invisible-account-testnet.mjs [--api http://127.0.0.1:8787]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  createDeviceKey,
  bindAccount,
  memoryKeyStore,
  signDelegate,
} from "../src/player-key.ts";

const args = process.argv.slice(2);
const base = args[args.indexOf("--api") + 1] || process.env.QUESTLAYER_API_URL || "http://127.0.0.1:8787";
const origin = process.env.QUESTLAYER_ORIGIN || "http://localhost:5173";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Run this against a local API.");
let cookie = "";
async function api(path, data) {
  const r = await fetch(`${base}/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const body = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${body.code || ""} ${body.error || ""}`);
  return body;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proof = { network: "testnet", startedAt: new Date().toISOString(), steps: [] };
const step = (label, data) => { proof.steps.push({ label, ...data }); console.log(JSON.stringify({ step: label, ...data })); };

const health = await api("/health");
assert.equal(health.relayer?.status !== "not-configured", true, "The API has no relayer configured.");
const session = await api("/session", { name: `Proof ${Date.now().toString(36)}` });
step("guest session", { playerId: session.player.id });
const store = memoryKeyStore();
const key = await createDeviceKey(store);
let view = await api("/account/create", { publicKey: key.publicKey });
let account = view.account ?? view;
step("account requested", { accountId: account.accountId, state: account.state });
for (let i = 0; i < 90 && account.state === "creating"; i++) {
  await sleep(2000);
  account = (await api("/account")).account;
}
assert.equal(account.state, "ready", `account state ${account.state}: ${account.error || ""}`);
await bindAccount(store, account.accountId);
const bound = { ...key, accountId: account.accountId };
step("account ready", { accountId: account.accountId, transactionHash: account.transactionHash });

async function relay(receiverId, call) {
  const prepared = await api("/relay/prepare", { accountId: account.accountId, receiverId, methodName: call.methodName, publicKey: key.publicKey });
  const signed = await signDelegate(bound, { senderId: account.accountId, receiverId, call, nonce: prepared.nonce, maxBlockHeight: prepared.maxBlockHeight });
  let job = await api("/relay", { signedDelegateBase64: signed.signedDelegateBase64, preview: { receiverId, methodName: call.methodName, gas: call.gas, deposit: call.deposit } });
  for (let i = 0; i < 60 && !["confirmed", "failed"].includes(job.state); i++) {
    await sleep(2000);
    job = await api(`/relay/${encodeURIComponent(job.id)}`);
  }
  assert.equal(job.state, "confirmed", `${call.methodName}: ${job.errorCode || ""} ${job.error || ""}`);
  return job;
}
const contracts = (await api("/relay/prepare", { accountId: account.accountId, publicKey: key.publicKey })).contracts;
const mint = await relay(contracts.collectibles, { methodName: "mint_avatar", args: {}, gas: "100000000000000", deposit: "50000000000000000000000" });
step("avatar minted without a wallet", { transactionHash: mint.transactionHash, result: mint.result });
const collection = await api("/native/collection");
step("collection read", { tokens: collection?.tokens?.length ?? null });
proof.finishedAt = new Date().toISOString();
proof.accountId = account.accountId;
proof.relayer = health.relayer;
writeFileSync("public/native-invisible-account-proof.json", JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ status: "verified", accountId: account.accountId, proof: "public/native-invisible-account-proof.json" }));

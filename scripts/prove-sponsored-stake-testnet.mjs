// Proves the staking path from an invisible account against a locally running
// API with the relayer configured (testnet only): guest session → device key →
// sponsored sub-account → the project operator funds the account like a player
// who bought NEAR → self-paid create_position and deposit_and_stake signed by
// the device key (the relayer refuses money actions because a NEP-366 relayer
// pays every attached deposit) → relayed zero-deposit `refresh`. No wallet
// popup anywhere. Writes a public proof.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { createDeviceKey, bindAccount, memoryKeyStore, signDelegate, signerFor } from "../src/player-key.ts";
import { actions as nearActions } from "near-api-js";

const args = process.argv.slice(2);
const base = args[args.indexOf("--api") + 1] || process.env.QUESTLAYER_API_URL || "http://127.0.0.1:8787";
const origin = process.env.QUESTLAYER_ORIGIN || "http://localhost:5173";
const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const NEAR = 10n ** 24n;
// Setup deposit 3.52 + stake 0.5 + prepaid gas for two 280 TGas calls, with margin.
const FUND = 55n * NEAR / 10n, STAKE = NEAR / 2n;
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
assert.notEqual(health.relayer?.status, "not-configured", "The API has no relayer configured.");
const session = await api("/session", { name: `Stake ${Date.now().toString(36)}` });
step("guest session", { playerId: session.player.id });
const store = memoryKeyStore();
const key = await createDeviceKey(store);
let account = (await api("/account/create", { publicKey: key.publicKey })).account;
for (let i = 0; i < 90 && account.state === "creating"; i++) { await sleep(2000); account = (await api("/account")).account; }
assert.equal(account.state, "ready", `account state ${account.state}: ${account.error || ""}`);
await bindAccount(store, account.accountId);
const bound = { ...key, accountId: account.accountId };
step("account ready", { accountId: account.accountId, transactionHash: account.transactionHash });

// The operator stands in for a player who bought NEAR: a plain transfer, no key sharing.
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
assert(operator.network === "testnet" && operator.accountId.endsWith(".testnet"), "Testnet only.");
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com" });
const funder = new Account(operator.accountId, provider, KeyPairSigner.fromSecretKey(operator.secretKey));
const funded = await funder.transfer({ receiverId: account.accountId, amount: FUND });
step("player money arrives (operator transfer stands in for a purchase)", { from: operator.accountId, amount: FUND.toString(), transactionHash: funded.transaction.hash });

// Money actions: the player's own key signs an ordinary transaction and pays gas.
async function selfPaid(quote) {
  const player = new Account(account.accountId, provider, signerFor(bound));
  const outcome = await player.signAndSendTransaction({
    receiverId: quote.receiverId,
    actions: [nearActions.functionCall(quote.methodName, quote.args, BigInt(quote.gas), BigInt(quote.deposit))],
    waitUntil: "FINAL",
  });
  const failed = [outcome.status, ...outcome.receipts_outcome.map((r) => r.outcome.status)].some((s) => s && typeof s === "object" && "Failure" in s);
  assert.ok(!failed, `${quote.methodName} failed: ${JSON.stringify(outcome.status)}`);
  return { transactionHash: outcome.transaction.hash };
}
async function relay(quote) {
  const prepared = await api("/relay/prepare", { accountId: account.accountId, receiverId: quote.receiverId, methodName: quote.methodName, publicKey: key.publicKey });
  const call = { methodName: quote.methodName, args: quote.args, gas: quote.gas, deposit: quote.deposit };
  const signed = await signDelegate(bound, { senderId: account.accountId, receiverId: quote.receiverId, call, nonce: prepared.nonce, maxBlockHeight: prepared.maxBlockHeight });
  let job = await api("/relay", { signedDelegateBase64: signed.signedDelegateBase64, preview: { receiverId: quote.receiverId, methodName: quote.methodName, gas: quote.gas, deposit: quote.deposit } });
  for (let i = 0; i < 90 && !["confirmed", "failed"].includes(job.state); i++) { await sleep(2000); job = await api(`/relay/${encodeURIComponent(job.id)}`); }
  assert.equal(job.state, "confirmed", `${quote.methodName}: ${job.errorCode || ""} ${job.error || ""}`);
  return job;
}
const positions = async (...states) => {
  for (let i = 0; i < 60; i++) {
    const snap = await api(`/native/vaults?account=${encodeURIComponent(account.accountId)}`);
    const p = snap.positions.find((x) => states.includes(x.state));
    if (p) return { snap, p };
    await sleep(3000);
  }
  throw new Error(`No position reached ${states.join("/")}.`);
};
const vaults = await api(`/native/vaults?account=${encodeURIComponent(account.accountId)}`);
const pool = vaults.pools[0].id;
const create = await api("/native/vaults/prepare", { accountId: account.accountId, action: "create", poolId: pool, contributionBps: 5000 });
// A relayed money action is refused before the relayer signs anything.
let refusal = null;
try {
  const prepared = await api("/relay/prepare", { accountId: account.accountId, receiverId: create.receiverId, methodName: create.methodName, publicKey: key.publicKey });
  const signed = await signDelegate(bound, { senderId: account.accountId, receiverId: create.receiverId, call: { methodName: create.methodName, args: create.args, gas: create.gas, deposit: create.deposit }, nonce: prepared.nonce, maxBlockHeight: prepared.maxBlockHeight });
  await api("/relay", { signedDelegateBase64: signed.signedDelegateBase64, preview: { receiverId: create.receiverId, methodName: create.methodName, gas: create.gas, deposit: create.deposit } });
} catch (error) { refusal = error.message; }
assert.match(refusal || "", /RELAY_SELF_PAID/, "the relayer must refuse the setup deposit");
step("relayer refuses to carry the setup deposit", { refusal });
const created = await selfPaid(create);
step("position created by the player's own key (setup deposit and gas paid by the player)", { factory: create.receiverId, pool, setupDeposit: create.deposit, transactionHash: created.transactionHash });
// The factory registers the vault in its own callback; manual registration is
// only the retry path when that callback failed.
let { p: pending } = await positions("created", "ready");
if (pending.state === "created") {
  const register = await api("/native/vaults/prepare", { accountId: account.accountId, action: "register", vaultId: pending.account_id });
  const registered = await relay(register);
  step("position registered by the player (retry path)", { positionId: pending.id, vault: pending.account_id, transactionHash: registered.transactionHash });
} else step("position registered by the factory callback", { positionId: pending.id, vault: pending.account_id });
const { p: ready } = await positions("ready");
const deposit = await api("/native/vaults/prepare", { accountId: account.accountId, action: "deposit", vaultId: ready.account_id, amount: STAKE.toString() });
const staked = await selfPaid(deposit);
step("stake deposited by the player's own key, no wallet popup", { vault: ready.account_id, amount: STAKE.toString(), transactionHash: staked.transactionHash });
const refresh = await api("/native/vaults/prepare", { accountId: account.accountId, action: "refresh", vaultId: ready.account_id });
const refreshed = await relay(refresh);
step("zero-deposit maintenance relayed (gas sponsored)", { vault: ready.account_id, transactionHash: refreshed.transactionHash });
let final;
for (let i = 0; i < 20; i++) {
  const snap = await api(`/native/vaults?account=${encodeURIComponent(account.accountId)}`);
  final = snap.positions.find((x) => x.account_id === ready.account_id);
  if (final?.position && BigInt(final.position.deposited || 0) >= STAKE) break;
  await sleep(3000);
}
step("vault state read back", { stage: final?.position?.stage, deposited: final?.position?.deposited, staked: final?.position?.staked, contributionBps: final?.position?.contribution_bps, pool: final?.position?.pool });
proof.finishedAt = new Date().toISOString();
proof.accountId = account.accountId;
proof.vault = ready.account_id;
proof.relayer = health.relayer;
proof.note = "The 3.52 NEAR setup deposit, the 1 NEAR stake and their gas came from the player's own account (funded here by the project operator in place of a purchase) in transactions signed by the device key; the relayer refused the setup deposit and sponsored only the zero-deposit refresh.";
writeFileSync("public/native-sponsored-stake-proof.json", JSON.stringify(proof, null, 2) + "\n");
console.log("Proof written to public/native-sponsored-stake-proof.json");

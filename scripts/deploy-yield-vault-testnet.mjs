// Deploys questlayer-yield-vault (docs/YIELD-VAULT.md) on testnet, allowlists
// stNEAR, LiNEAR, USDC and USDT, registers the vault on each token and on Rhea
// Lend, and proves one stNEAR deposit that counts at once and is locked 24 h.
// Testnet only. Deploy the Linux/Docker WASM (contracts/wasm-sha256.json pins it).
//
//   node scripts/deploy-yield-vault-testnet.mjs
//   NEAR_YIELD_VAULT_ACCOUNT=...  YIELD_TREASURY_ACCOUNT=...  (optional)
//
// The treasury is immutable once initialized: it is the only account harvest can pay.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer);
const contractId = process.env.NEAR_YIELD_VAULT_ACCOUNT || "questlayer-yield-20261102.testnet";
const treasuryId = process.env.YIELD_TREASURY_ACCOUNT || operator.accountId;
assert(contractId.endsWith(".testnet") && treasuryId.endsWith(".testnet"), "Testnet only");
const RHEA = "contract.burrow.testnet";
const TOKENS = [
  { id: "meta-v2.pool.testnet", rhea: false },
  { id: "linear-protocol.testnet", rhea: false },
  { id: "usdc.fakes.testnet", rhea: true },
  { id: "usdt.fakes.testnet", rhea: true },
];
const TGAS = 10n ** 12n, NEAR = 10n ** 24n;

const wasmPath = "contracts/target/wasm32-unknown-unknown/release/questlayer_yield_vault.wasm";
const wasm = readFileSync(wasmPath);
const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
const pinned = JSON.parse(readFileSync("contracts/wasm-sha256.json")).contracts.questlayer_yield_vault;
assert.equal(wasmSha256, pinned, `${wasmPath} is not the reproducible build (run npm run contracts:docker or use the CI artifact)`);

const journal = ".data/yield-vault-deploy-journal.json",
  transactions = existsSync(journal) ? JSON.parse(readFileSync(journal)) : [];
async function record(label, fn) {
  const r = await fn();
  assert(!r.status?.Failure, label + " failed: " + JSON.stringify(r.status));
  const tx = r.transaction?.hash || r.transaction_outcome?.id;
  transactions.push({ label, transaction: tx });
  writeFileSync(journal, JSON.stringify(transactions, null, 2));
  console.log(JSON.stringify({ label, transaction: tx }));
  return r;
}
async function viewOn(accountId, method, args = {}) {
  const r = await provider.query({ request_type: "call_function", account_id: accountId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
}
const view = (method, args) => viewOn(contractId, method, args);
const callOn = (receiver, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
  root.callFunctionRaw({ contractId: receiver, methodName, args, deposit, gas, waitUntil: "FINAL" });

let info;
try { info = await provider.viewAccount({ accountId: contractId }); } catch (e) { if (!/does not exist|unknown_account/i.test(rpcErrorText(e))) throw e; }
if (!info) {
  const r = await fetch("https://helper.testnet.near.org/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: contractId, newAccountPublicKey: operator.publicKey }), signal: AbortSignal.timeout(30000) });
  assert(r.ok, "Testnet helper could not create " + contractId + ": " + (await r.text()).slice(0, 200));
  console.log(JSON.stringify({ step: "Create contract account through the official testnet helper", contractId }));
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
const contract = new Account(contractId, provider, signer);
const balance = BigInt((await provider.viewAccount({ accountId: contractId })).amount);
if (balance < 6n * NEAR) await record("Fund the vault for code and position storage", () => root.transfer({ receiverId: contractId, amount: 6n * NEAR - balance }));
const state = await provider.query({ request_type: "view_state", account_id: contractId, prefix_base64: "", finality: "final" });
if (!state.values?.some((v) => v.key === "U1RBVEU=")) {
  await record("Deploy and initialize " + contractId, () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.deployContract(wasm), actions.functionCall("new", { owner_id: operator.accountId, treasury_id: treasuryId }, 100n * TGAS, 0n)],
      waitUntil: "FINAL",
    }),
  );
} else {
  const code = await provider.query({ request_type: "view_code", account_id: contractId, finality: "final" });
  assert(Buffer.from(code.code_base64, "base64").equals(wasm), "Deployed code differs; refusing an implicit upgrade.");
}
assert.equal((await view("get_config")).treasury_id, treasuryId, "Treasury differs from the deployed one");

const listed = new Set((await view("get_tokens")).map((t) => t.token_id));
for (const t of TOKENS) {
  if (!listed.has(t.id)) await record(`Allowlist ${t.id}`, () => callOn(contractId, "add_token", { token_id: t.id, rhea: t.rhea }));
  for (const holder of [contractId, treasuryId]) {
    const reg = await viewOn(t.id, "storage_balance_of", { account_id: holder });
    if (!reg) await record(`Register ${holder} on ${t.id}`, () => callOn(t.id, "storage_deposit", { account_id: holder, registration_only: true }, 125n * 10n ** 22n, 30n * TGAS));
  }
}
if (!(await viewOn(RHEA, "storage_balance_of", { account_id: contractId })))
  await record("Register the vault on Rhea Lend", () => callOn(contractId, "register_on_rhea", {}, NEAR / 10n, 50n * TGAS));

// Smoke: the operator stakes 0.2 NEAR with Meta Pool and deposits the stNEAR.
const ST = "meta-v2.pool.testnet";
let st = BigInt(await viewOn(ST, "ft_balance_of", { account_id: operator.accountId }));
if (st < NEAR / 10n) {
  await record("Stake 0.2 NEAR with Meta Pool for the smoke deposit", () => callOn(ST, "deposit_and_stake", {}, NEAR / 5n, 50n * TGAS));
  st = BigInt(await viewOn(ST, "ft_balance_of", { account_id: operator.accountId }));
}
const amount = st < NEAR / 5n ? st : NEAR / 5n;
await record("Deposit stNEAR into the yield vault", () => callOn(ST, "ft_transfer_call", { receiver_id: contractId, amount: String(amount), msg: "deposit" }, 1n, 150n * TGAS));
const position = (await view("get_position", { account_id: operator.accountId })).find((p) => p.token_id === ST);
assert(position && BigInt(position.principal) > 0n, "Deposit not recorded");
assert(position.tranches.length > 0 && Number(position.tranches.at(-1).locked_until_ms) > Date.now(), "Deposit is not locked");

const config = await view("get_config"), tokens = await view("get_tokens");
const account = await provider.viewAccount({ accountId: contractId });
mkdirSync("output/qa/2026-11-testnet", { recursive: true });
const manifest = { network: "testnet", verifiedAt: new Date().toISOString(), contractId, codeHash: account.code_hash, wasmSha256, ownerId: config.owner_id, treasuryId: config.treasury_id, rheaId: config.rhea_id, lockMs: config.lock_ms, tokens: tokens.map(({ token_id, kind, value_unit, price_source, strategy, cap, account_cap, min_deposit, buffer_bps, max_util_bps, safety_bps }) => ({ token_id, kind, value_unit, price_source, strategy, cap, account_cap, min_deposit, buffer_bps, max_util_bps, safety_bps })), audited: false };
writeFileSync("public/native-yield-vault-testnet.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("output/qa/2026-11-testnet/yield-vault-proof.json", JSON.stringify({ ...manifest, smoke: { account: operator.accountId, position }, transactions }, null, 2) + "\n");
console.log(JSON.stringify({ status: "verified", contractId, principal: position.principal }));

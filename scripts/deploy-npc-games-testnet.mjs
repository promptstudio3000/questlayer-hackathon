// Deploys the npc-games contract (NPC-PLAN §7, slice N4) on testnet, publishes
// the first prize table and proves one earned roll end to end:
// server-signed ticket -> start_roll -> wait 3+ blocks -> resolve_roll.
// Testnet only. Deploy the Linux/Docker WASM (contracts/wasm-sha256.json pins it);
// the script refuses any other build.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
import { loadAwardSigner } from "../server/native/award-vouchers.mjs";

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer);
const contractId = process.env.NEAR_NPC_GAMES_ACCOUNT || "questlayer-npc-games-20261101.testnet";
assert(contractId.endsWith(".testnet"), "Testnet only");
const TIMEOUT_BLOCKS = 600;
const TABLE_ID = "wisp-v1";
// NPC-PLAN §7.2 example odds. Prize ids are mapped to award claims by the server.
const TIERS = [
  { prize: "trader-voucher", weight: 60, daily_cap: null },
  { prize: "aura-rare", weight: 30, daily_cap: null },
  { prize: "aura-epic", weight: 9, daily_cap: 20 },
  { prize: "aura-legendary-wisp", weight: 1, daily_cap: 2 },
];

const wasmPath = "contracts/target/wasm32-unknown-unknown/release/questlayer_npc_games.wasm";
const wasm = readFileSync(wasmPath);
const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
const pinned = JSON.parse(readFileSync("contracts/wasm-sha256.json")).contracts.questlayer_npc_games;
assert.equal(wasmSha256, pinned, `${wasmPath} is not the reproducible build (run npm run contracts:docker or use the CI artifact)`);

// Ticket signer: a dedicated Ed25519 key, private to the machine that runs this.
const ticketSigner = loadAwardSigner(process.env.NPC_TICKET_SIGNER_PATH || ".data/npc-games-ticket-signer.pem");

const journal = ".data/npc-games-deploy-journal.json",
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
async function view(method, args = {}) {
  const r = await provider.query({ request_type: "call_function", account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
}
const call = (account, methodName, args, deposit = 0n, gas = 100n * 10n ** 12n) =>
  account.callFunctionRaw({ contractId, methodName, args, deposit, gas, waitUntil: "FINAL" });
const height = async () => (await provider.viewBlock({ finality: "final" })).header.height;

let info;
try { info = await provider.viewAccount({ accountId: contractId }); } catch (e) { if (!/does not exist|unknown_account/i.test(rpcErrorText(e))) throw e; }
if (!info) {
  const r = await fetch("https://helper.testnet.near.org/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: contractId, newAccountPublicKey: operator.publicKey }), signal: AbortSignal.timeout(30000) });
  assert(r.ok, "Testnet helper could not create " + contractId + ": " + (await r.text()).slice(0, 200));
  console.log(JSON.stringify({ step: "Create contract account through the official testnet helper", contractId }));
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
const contract = new Account(contractId, provider, signer);
const state = await provider.query({ request_type: "view_state", account_id: contractId, prefix_base64: "", finality: "final" });
if (!state.values?.some((v) => v.key === "U1RBVEU=")) {
  await record("Deploy and initialize " + contractId, () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.deployContract(wasm),
        actions.functionCall("new", { owner_id: operator.accountId, ticket_signer: ticketSigner.publicKey, timeout_blocks: TIMEOUT_BLOCKS }, 100n * 10n ** 12n, 0n),
      ],
      waitUntil: "FINAL",
    }),
  );
} else {
  const code = await provider.query({ request_type: "view_code", account_id: contractId, finality: "final" });
  assert(Buffer.from(code.code_base64, "base64").equals(wasm), "Deployed code differs; refusing an implicit upgrade.");
}
if ((await view("get_config")).ticket_signer !== ticketSigner.publicKey)
  await record("Set the ticket signer", () => call(root, "set_ticket_signer", { key: ticketSigner.publicKey }, 1n));
if (!(await view("get_table", { table_id: TABLE_ID })))
  await record(`Publish prize table ${TABLE_ID}`, () => call(root, "publish_table", { table_id: TABLE_ID, tiers: TIERS, minimum: 0 }, 1n));

// Smoke: one earned roll for the operator, revealed by the operator as the worker.
const secret = randomBytes(32);
const commit = createHash("sha256").update(secret).digest("hex");
const rollId = `smoke-${Date.now().toString(36)}`;
const expires = String(Date.now() + 10 * 60_000);
const message = await view("ticket_message", { roll_id: rollId, account_id: operator.accountId, commit, table_id: TABLE_ID, expires_at_ms: expires });
const signature = ticketSigner.sign(message);
await record("Start an earned roll with a server ticket", () => call(root, "start_roll", { roll_id: rollId, table_id: TABLE_ID, commit, expires_at_ms: expires, signature }));
const started = await view("get_roll", { roll_id: rollId });
while ((await height()) < Number(started.start_height) + 4) await new Promise((r) => setTimeout(r, 1500));
await record("Reveal the secret and resolve the roll", () => call(root, "resolve_roll", { roll_id: rollId, secret: secret.toString("hex") }));
const roll = await view("get_roll", { roll_id: rollId });
assert.equal(roll.status, "Resolved");
assert.equal(roll.secret, secret.toString("hex"));

const config = await view("get_config"), table = await view("get_table", { table_id: TABLE_ID });
const account = await provider.viewAccount({ accountId: contractId });
mkdirSync("output/qa/2026-11-testnet", { recursive: true });
const manifest = { network: "testnet", verifiedAt: new Date().toISOString(), contractId, codeHash: account.code_hash, wasmSha256, ticketSignerPublicKey: ticketSigner.publicKey, timeoutBlocks: config.timeout_blocks, minRevealDelayBlocks: config.min_reveal_delay_blocks, tables: { [TABLE_ID]: table }, wagering: false, capabilities: ["earned-tickets-only", "commit-reveal", "random-seed", "timeout-minimum", "daily-caps"] };
writeFileSync("public/native-npc-games-testnet.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("output/qa/2026-11-testnet/npc-games-proof.json", JSON.stringify({ ...manifest, smoke: { rollId, roll }, transactions }, null, 2) + "\n");
console.log(JSON.stringify({ status: "verified", contractId, rollId, prize: roll.prize }));

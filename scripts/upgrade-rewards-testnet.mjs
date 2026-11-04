// Reviewed in-place upgrade of the testnet rewards contract (per-date cap
// across cities, v1.1). Backs up the deployed code, deploys the new WASM with
// the operator's key, proves the treasury and every known day are unchanged,
// backfills already-published days into their date totals once, and updates
// the manifest's code hash so the server keeps verifying the code it talks to.
// Testnet only; no player keys; refuses to run without --upgrade-reviewed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Account, JsonRpcProvider, KeyPairSigner, actions } from "near-api-js";

assert(process.argv.includes("--upgrade-reviewed"), "Pass --upgrade-reviewed after reviewing the contract diff.");
const manifestPath = "public/native-rewards-testnet.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const operator = JSON.parse(readFileSync(process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json", "utf8"));
assert(manifest.network === "testnet" && operator.network === "testnet", "Testnet only.");
const id = manifest.contractId;
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com" });
const signer = KeyPairSigner.fromSecretKey(operator.secretKey);
const view = async (method, args = {}) =>
  JSON.parse(Buffer.from((await provider.query({ request_type: "call_function", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" })).result).toString());
const wasm = readFileSync("contracts/target/wasm32-unknown-unknown/release/questlayer_rewards.wasm");
const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
const db = new DatabaseSync(process.env.DATABASE_PATH || ".data/questlayer-hackathon.sqlite", { readOnly: true });
const dayIds = db.prepare("SELECT id FROM native_days WHERE state IN ('prepared','published') ORDER BY day,id").all().map((r) => r.id);
const log = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));

const info = await provider.viewAccount({ accountId: id });
assert.equal(info.code_hash, manifest.codeHash, "Deployed code differs from the manifest; stop and review.");
const code = await provider.query({ request_type: "view_code", account_id: id, finality: "final" });
mkdirSync(".data/contract-backups", { recursive: true, mode: 0o700 });
writeFileSync(`.data/contract-backups/${id}-${info.code_hash}.wasm`, Buffer.from(code.code_base64, "base64"), { mode: 0o600 });
const before = { treasury: await view("get_treasury"), config: await view("get_config"), days: {} };
for (const d of dayIds) before.days[d] = await view("get_day", { day_id: d });
log("backed up", { id, codeHash: info.code_hash, days: dayIds });

const contract = new Account(id, provider, signer);
const deployed = await contract.signAndSendTransaction({ receiverId: id, actions: [actions.deployContract(wasm)], waitUntil: "FINAL" });
const after = { treasury: await view("get_treasury"), config: await view("get_config"), days: {} };
for (const d of dayIds) after.days[d] = await view("get_day", { day_id: d });
assert.deepEqual(after, before, "Upgrade changed treasury, config or day state.");
const newHash = (await provider.viewAccount({ accountId: id })).code_hash;
log("upgraded", { transactionHash: deployed.transaction.hash, codeHash: newHash, wasmSha256 });

const owner = new Account(operator.accountId, provider, signer);
const backfill = [];
for (const d of dayIds) {
  if (!before.days[d] || before.days[d].closed) continue;
  const tx = await owner.callFunctionRaw({ contractId: id, methodName: "record_existing_day", args: { day_id: d }, gas: 30n * 10n ** 12n, deposit: 0n, waitUntil: "FINAL" });
  backfill.push({ dayId: d, transactionHash: tx.transaction.hash });
}
const dates = [...new Set(dayIds.map((d) => d.match(/(\d{4}-\d{2}-\d{2})-v\d+$/)[1]))];
const totals = {};
for (const date of dates) totals[date] = await view("get_date_totals", { date });
log("backfilled", { backfill, totals });

manifest.codeHash = newHash;
manifest.wasmSha256 = wasmSha256;
manifest.verifiedAt = new Date().toISOString();
manifest.dailyCapAcrossCities = { since: manifest.verifiedAt, cap: totals[dates[0]]?.cap ?? null, view: "get_date_totals(date)", backfill };
manifest.transactions = [...(manifest.transactions || []), { label: "Upgrade: per-date cap across cities", transaction: deployed.transaction.hash }, ...backfill.map((b) => ({ label: `Backfill date total ${b.dayId}`, transaction: b.transactionHash }))];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
log("manifest updated", { manifestPath });

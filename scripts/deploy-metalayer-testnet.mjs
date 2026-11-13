// Deploys the MetaLayer economy contract (docs/METALAYER-INTEGRATION.md) on
// NEAR testnet: MetaGold (NEP-141) with its own treasury, soulbound MetaXP and
// badges, and 16 × 16 parcel NFTs (NEP-171). Then it proves the loop end to end:
// fund the treasury, define the first badge, pay one award through the bounded
// recorder key, buy one parcel with the awarded MetaGold.
//
// Testnet only. Deploys the reproducible WASM pinned in contracts/wasm-sha256.json.
// Writes the recorder key to .data/metalayer-recorder.json (installed on the VPS
// as <state dir>/metalayer-recorder.json) and public/native-metalayer-testnet.json.
//
//   node scripts/deploy-metalayer-testnet.mjs
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

const NEAR = 10n ** 24n;
// Placeholder testnet economy, for Lubos to review before mainnet. MetaGold uses
// the QGOLD scale: 1 NEAR = 1,000,000,000 units, and 1 QGOLD unit = 1 MetaGold unit.
const ECONOMY = {
  metagold_per_near: "1000000000",
  metagold_per_qgold: "1",
  daily_cap: "100000",
  parcel_price: "100",
  fundNear: 1n * NEAR / 10n, // 0.1 NEAR -> 100,000,000 MetaGold in the treasury
};
export const METALAYER_BADGES = [
  ["quiet-beacon", "Quiet Beacon", "Woke the quiet beacon on the MetaLayer square."],
  ["crystal-hollow", "Crystal Hollow", "Brought ten diamonds out of Crystal Hollow."],
];

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer);
const contractId = process.env.NEAR_METALAYER_ACCOUNT || "questlayer-metalayer-20261113.testnet";
assert(contractId.endsWith(".testnet"), "Testnet only");
const qgold = JSON.parse(readFileSync("public/native-qgold-vault-testnet.json")).tokenContract;
assert(qgold?.endsWith(".testnet"), "QGOLD token manifest missing");

const wasmPath = "contracts/target/wasm32-unknown-unknown/release/questlayer_metalayer.wasm";
const wasm = readFileSync(wasmPath);
const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
const pinned = JSON.parse(readFileSync("contracts/wasm-sha256.json")).contracts.questlayer_metalayer;
assert.equal(wasmSha256, pinned, `${wasmPath} is not the reproducible build`);

const recorderPath = ".data/metalayer-recorder.json";
if (!existsSync(recorderPath)) {
  const pair = KeyPair.fromRandom("ed25519");
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(recorderPath, JSON.stringify({ network: "testnet", accountId: contractId, secretKey: pair.toString(), publicKey: pair.getPublicKey().toString() }), { mode: 0o600, flag: "wx" });
}
const recorder = JSON.parse(readFileSync(recorderPath));
assert.equal(recorder.accountId, contractId, `${recorderPath} belongs to another contract`);

const journal = ".data/metalayer-deploy-journal.json",
  transactions = existsSync(journal) ? JSON.parse(readFileSync(journal)) : [];
async function record(label, fn) {
  const r = await fn();
  const failures = [r.status, ...(r.receipts_outcome || []).map((x) => x.outcome?.status)].filter((s) => s && typeof s === "object" && "Failure" in s);
  assert(!failures.length, label + " failed: " + JSON.stringify(failures[0]));
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

// 1. Account from the operator through the testnet registrar (the helper rate-limits the VPS).
let exists = true;
try {
  await provider.viewAccount({ accountId: contractId });
} catch (e) {
  if (!/does not exist|doesnotexist|unknown_account/i.test(rpcErrorText(e))) throw e;
  exists = false;
}
if (!exists)
  await record("Create " + contractId + " from the operator", () =>
    root.callFunctionRaw({ contractId: "testnet", methodName: "create_account", args: { new_account_id: contractId, new_public_key: operator.publicKey }, deposit: 5n * NEAR, gas: 100n * 10n ** 12n, waitUntil: "FINAL" }),
  );
const contract = new Account(contractId, provider, signer);

// 2. Deploy + init once; never an implicit upgrade.
const state = await provider.query({ request_type: "view_state", account_id: contractId, prefix_base64: "", finality: "final" });
if (!state.values?.some((v) => v.key === "U1RBVEU=")) {
  await record("Deploy and initialize " + contractId, () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.deployContract(wasm),
        actions.functionCall("new", { owner_id: operator.accountId, recorder_id: contractId, qgold_token: qgold, metagold_per_near: ECONOMY.metagold_per_near, metagold_per_qgold: ECONOMY.metagold_per_qgold, daily_cap: ECONOMY.daily_cap, parcel_price: ECONOMY.parcel_price }, 150n * 10n ** 12n, 0n),
      ],
      waitUntil: "FINAL",
    }),
  );
} else {
  const code = await provider.query({ request_type: "view_code", account_id: contractId, finality: "final" });
  assert(Buffer.from(code.code_base64, "base64").equals(wasm), "Deployed code differs; refusing an implicit upgrade.");
}

// 3. Recorder: a function-call key on the contract's own account, award and record_batch only.
const keys = await provider.query({ request_type: "view_access_key_list", account_id: contractId, finality: "final" });
if (!keys.keys.some((k) => k.public_key === recorder.publicKey))
  await record("Install the bounded recorder key (award, record_batch)", () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.addFunctionCallAccessKey(KeyPair.fromString(recorder.secretKey).getPublicKey(), contractId, ["award", "record_batch"], 2n * NEAR)],
      waitUntil: "FINAL",
    }),
  );

// 4. Badges and treasury funding.
for (const [id, title, description] of METALAYER_BADGES)
  if (!(await view("badge", { badge_id: id })))
    await record("Define badge " + id, () => call(root, "define_badge", { badge_id: id, title, description }));
if (BigInt((await view("treasury")).metagold_available) === 0n)
  await record("Fund the MetaGold treasury with 0.1 NEAR", () => call(root, "fund", {}, ECONOMY.fundNear));

// 5. Smoke: the recorder pays the operator one award, which buys one parcel.
const recorderAccount = new Account(contractId, provider, KeyPairSigner.fromSecretKey(recorder.secretKey));
const smokeId = "smoke:deploy:20261113";
if (!(await view("is_paid", { action_id: smokeId })))
  await record("Recorder pays one smoke award (MetaGold, MetaXP, badge)", () =>
    call(recorderAccount, "award", { awards: [{ action_id: smokeId, account_id: operator.accountId, actor: "deploy-smoke", layer_id: "space", evidence_hash: createHash("sha256").update(smokeId).digest("hex"), metagold: "150", meta_xp: 1, badge: "quiet-beacon" }] }, 0n, 100n * 10n ** 12n),
  );
const parcel = await view("parcel", { x0: 4064, z0: 4064 });
if (!parcel)
  await record("Operator buys smoke parcel 4064, 4064 with MetaGold", () => call(root, "buy_parcel", { x0: 4064, z0: 4064 }, NEAR / 50n));
const owned = await view("parcel", { x0: 4064, z0: 4064 });
assert.equal(owned?.owner_id, operator.accountId, "smoke parcel belongs to the operator");
assert.deepEqual(await view("badges_of", { account_id: operator.accountId }), ["quiet-beacon"]);

const treasury = await view("treasury");
const account = await provider.viewAccount({ accountId: contractId });
const manifest = {
  network: "testnet",
  verifiedAt: new Date().toISOString(),
  contractId,
  codeHash: account.code_hash,
  wasmSha256,
  recorderPublicKey: recorder.publicKey,
  qgoldToken: qgold,
  symbol: "METAGOLD",
  decimals: 6,
  economy: { metagoldPerNear: ECONOMY.metagold_per_near, metagoldPerQgold: ECONOMY.metagold_per_qgold, dailyCap: ECONOMY.daily_cap, parcelPrice: ECONOMY.parcel_price },
  badges: METALAYER_BADGES.map(([id, title]) => ({ id, title })),
  capabilities: ["nep141-metagold", "own-treasury", "one-way-qgold", "award-once", "daily-cap", "soulbound-metaxp", "soulbound-badges", "nep171-parcels", "action-events"],
};
writeFileSync("public/native-metalayer-testnet.json", JSON.stringify(manifest, null, 2) + "\n");
mkdirSync("output/qa/2026-11-testnet", { recursive: true });
writeFileSync("output/qa/2026-11-testnet/metalayer-proof.json", JSON.stringify({ ...manifest, treasury, smoke: { award: smokeId, parcel: owned.token_id }, transactions }, null, 2) + "\n");
console.log(JSON.stringify({ status: "verified", contractId, treasury: treasury.metagold_available, next: "install metalayer-recorder.json in the World state dir, commit public/native-metalayer-testnet.json" }));

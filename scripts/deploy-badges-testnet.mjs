// Deploys the soulbound badges contract (docs/BADGES.md) on testnet, installs a
// bounded minter key for the game server and proves one sponsored badge end to
// end: minter key -> create_badge (sponsored, creator = operator) -> creator
// award. Signed claims are proven by the live server's badge worker once the
// minter key is installed (scripts/install-badges-minter-vps.sh).
//
// Testnet only. Deploys the Linux/Docker WASM pinned in contracts/wasm-sha256.json.
// The claim signer is the live server's award signer public key, read from
// <APP_ORIGIN>/api/native/claim-signer (or BADGES_CLAIM_SIGNER_PUBLIC_KEY).
//
//   node scripts/deploy-badges-testnet.mjs
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer);
const contractId = process.env.NEAR_BADGES_ACCOUNT || "questlayer-badges-20261102.testnet";
assert(contractId.endsWith(".testnet"), "Testnet only");
const origin = process.env.APP_ORIGIN || "https://questlayer.promptstudio3000.com";

const wasmPath = "contracts/target/wasm32-unknown-unknown/release/questlayer_badges.wasm";
const wasm = readFileSync(wasmPath);
const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
const pinned = JSON.parse(readFileSync("contracts/wasm-sha256.json")).contracts.questlayer_badges;
assert.equal(wasmSha256, pinned, `${wasmPath} is not the reproducible build (run npm run contracts:docker or use the CI artifact)`);

let claimSigner = process.env.BADGES_CLAIM_SIGNER_PUBLIC_KEY;
if (!claimSigner) {
  const r = await fetch(`${origin}/api/native/claim-signer`, { signal: AbortSignal.timeout(15000) });
  assert(r.ok, `Could not read the live award signer from ${origin}`);
  const info = await r.json();
  assert.equal(info.network, "testnet");
  claimSigner = info.publicKey;
}
assert.equal(Buffer.from(claimSigner, "base64").length, 32, "claim signer must be a base64 Ed25519 public key");

// Minter: a function-call key on the contract's own account, for create_badge and claim only.
const minterPath = ".data/badges-minter.json";
if (!existsSync(minterPath)) {
  const pair = KeyPair.fromRandom("ed25519");
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(minterPath, JSON.stringify({ network: "testnet", accountId: contractId, secretKey: pair.toString(), publicKey: pair.getPublicKey().toString() }), { mode: 0o600, flag: "wx" });
}
const minter = JSON.parse(readFileSync(minterPath));
assert.equal(minter.accountId, contractId, `${minterPath} belongs to another contract`);

const journal = ".data/badges-deploy-journal.json",
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

let info;
try {
  info = await provider.viewAccount({ accountId: contractId });
} catch (e) {
  if (!/does not exist|unknown_account/i.test(rpcErrorText(e))) throw e;
}
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
      actions: [actions.deployContract(wasm), actions.functionCall("new", { owner_id: operator.accountId, claim_signer: claimSigner }, 100n * 10n ** 12n, 0n)],
      waitUntil: "FINAL",
    }),
  );
} else {
  const code = await provider.query({ request_type: "view_code", account_id: contractId, finality: "final" });
  assert(Buffer.from(code.code_base64, "base64").equals(wasm), "Deployed code differs; refusing an implicit upgrade.");
}
if ((await view("get_config")).claim_signer !== claimSigner)
  await record("Set the claim signer to the live award signer", () => call(root, "set_claim_signer", { key: claimSigner }, 1n));
const keys = await provider.query({ request_type: "view_access_key_list", account_id: contractId, finality: "final" });
if (!keys.keys.some((k) => k.public_key === minter.publicKey))
  await record("Install the bounded minter key (create_badge, claim)", () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.addFunctionCallAccessKey(KeyPair.fromString(minter.secretKey).getPublicKey(), contractId, ["create_badge", "claim"], 3n * 10n ** 24n)],
      waitUntil: "FINAL",
    }),
  );

// Smoke: the minter sponsors a launch badge for the operator, who awards it to itself.
const minterAccount = new Account(contractId, provider, KeyPairSigner.fromSecretKey(minter.secretKey));
const smokeId = "questlayer-testnet-launch";
if (!(await view("get_badge", { badge_id: smokeId })))
  await record("Sponsored create_badge through the minter key", () =>
    call(minterAccount, "create_badge", {
      badge_id: smokeId,
      creator_id: operator.accountId,
      input: { title: "QuestLayer testnet launch", description: "Was there when player badges went live on NEAR testnet.", icon: "🏅", color: "#c08a2b", kind: "Event", max_supply: 500, starts_at_ms: null, ends_at_ms: null },
    }, 0n, 60n * 10n ** 12n),
  );
if (!(await view("has_badge", { badge_id: smokeId, account_id: operator.accountId })))
  await record("Creator awards the launch badge", () => call(root, "award", { badge_id: smokeId, account_ids: [operator.accountId] }));
const held = await view("nft_tokens_for_owner", { account_id: operator.accountId });
assert(held.some((t) => t.token_id.startsWith(smokeId + ":")), "operator holds the launch badge");

const config = await view("get_config");
const account = await provider.viewAccount({ accountId: contractId });
mkdirSync("output/qa/2026-11-testnet", { recursive: true });
const manifest = {
  network: "testnet",
  verifiedAt: new Date().toISOString(),
  contractId,
  codeHash: account.code_hash,
  wasmSha256,
  claimSignerPublicKey: claimSigner,
  minterPublicKey: minter.publicKey,
  badgeBaseYocto: config.badge_base_yocto,
  perClaimYocto: config.per_claim_yocto,
  transferable: false,
  capabilities: ["soulbound", "signed-claims", "creator-award", "sponsored-create", "nep171-views", "budget-refund"],
};
writeFileSync("public/native-badges-testnet.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("output/qa/2026-11-testnet/badges-proof.json", JSON.stringify({ ...manifest, smoke: { badgeId: smokeId, held }, transactions }, null, 2) + "\n");
console.log(JSON.stringify({ status: "verified", contractId, smokeBadge: smokeId, next: "bash scripts/install-badges-minter-vps.sh, commit public/native-badges-testnet.json, deploy" }));

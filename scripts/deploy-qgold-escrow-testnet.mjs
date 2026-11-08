// Deploys the QGOLD market escrow (contracts/qgold-escrow, docs/QGOLD-ESCROW.md)
// on testnet for the task market, Secrets and conditional sends:
//   1. creates the escrow and publisher accounts through the testnet helper,
//   2. deploys and initializes the pinned reproducible WASM: token = the QGOLD
//      vault, owner = guardian = treasury = operator, publisher = moderator =
//      the publisher account (the game server),
//   3. registers the escrow on the QGOLD token,
//   4. adds a function-call key to the publisher account for the escrow's
//      release/refund methods only and writes it to .data/escrow-publisher.json
//      (install it on the VPS with scripts/install-escrow-publisher-vps.sh),
//   5. DELETES the escrow's full-access key (no admin withdrawal exists, and
//      now nobody can replace the code either),
//   6. smoke test: operator sends 0.01 QGOLD into a both_confirm transfer to the
//      publisher, the new publisher key releases it and pushes it out with
//      withdraw_for; the escrow stats stay conserved,
//   7. writes public/native-qgold-escrow-testnet.json.
// Testnet only. Run on the Mac (operator key in .data/near-operator.json):
//   node scripts/deploy-qgold-escrow-testnet.mjs --reviewed
// Then commit the manifest, run scripts/install-escrow-publisher-vps.sh and
// deploy the VPS.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner, PublicKey, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

assert(process.argv.includes("--reviewed"), "Pass --reviewed after reviewing contracts/qgold-escrow.");
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
const provider = createNearProvider();
const signer = KeyPairSigner.fromSecretKey(operator.secretKey);
const root = new Account(operator.accountId, provider, signer);
const vaultManifest = JSON.parse(readFileSync("public/native-qgold-vault-testnet.json", "utf8"));
const tokenId = vaultManifest.tokenContract;
const escrowId = process.env.NEAR_QGOLD_ESCROW_ACCOUNT || "questlayer-qgold-escrow-20261105.testnet";
const publisherId = process.env.NEAR_QGOLD_ESCROW_PUBLISHER || "questlayer-escrow-pub-20261105.testnet";
const PUBLISHER_METHODS = [
  "approve_task", "cancel_task", "open_dispute", "resolve_dispute", "confirm_visit", "release_secret",
  "dispute_secret", "resolve_secret", "confirm_transfer", "release_transfer", "confirm_transfer_gps",
  "refund_transfer", "decline_transfer", "withdraw_for",
];

const sha = (b) => createHash("sha256").update(b).digest("hex");
const pins = JSON.parse(readFileSync("contracts/wasm-sha256.json")).contracts;
const wasmPath = "contracts/target/wasm32-unknown-unknown/release/questlayer_qgold_escrow.wasm";
const wasm = readFileSync(wasmPath);
assert.equal(sha(wasm), pins.questlayer_qgold_escrow, "Escrow WASM differs from contracts/wasm-sha256.json. Build it with npm run contracts:docker.");

const journalPath = ".data/qgold-escrow-deploy-journal.json";
const transactions = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath)) : [];
async function record(label, fn) {
  const r = await fn();
  assert(!r.status?.Failure, label + " failed: " + JSON.stringify(r.status));
  const tx = r.transaction?.hash || r.transaction_outcome?.id;
  transactions.push({ label, transaction: tx });
  writeFileSync(journalPath, JSON.stringify(transactions, null, 2));
  console.log(JSON.stringify({ label, transaction: tx }));
  return r;
}
async function view(id, method, args = {}) {
  const r = await provider.query({ request_type: "call_function", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
}
const callAs = (account, label, receiverId, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
  record(label, () => account.signAndSendTransaction({ receiverId, actions: [actions.functionCall(methodName, args, gas, deposit)], waitUntil: "FINAL" }));
async function ensureAccount(accountId) {
  try {
    return await provider.viewAccount({ accountId });
  } catch (e) {
    if (!/does not exist|unknown_account/i.test(rpcErrorText(e))) throw e;
  }
  const r = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: operator.publicKey }),
    signal: AbortSignal.timeout(30000),
  });
  assert(r.ok, "Testnet helper could not create " + accountId + ": " + (await r.text()).slice(0, 200));
  console.log(JSON.stringify({ step: "Created account through the testnet helper", accountId }));
  await new Promise((res) => setTimeout(res, 3000));
  return provider.viewAccount({ accountId });
}
const hasState = async (id) =>
  (await provider.query({ request_type: "view_state", account_id: id, prefix_base64: "", finality: "final" })).values?.some((v) => v.key === "U1RBVEU=");
const keysOf = async (id) => (await provider.query({ request_type: "view_access_key_list", account_id: id, finality: "final" })).keys;

// 1. Accounts.
await ensureAccount(escrowId);
await ensureAccount(publisherId);
const escrow = new Account(escrowId, provider, signer);
const publisherFull = new Account(publisherId, provider, signer);
// The escrow pays token registrations of new payees (0.00125 NEAR each).
const escrowBalance = BigInt((await provider.viewAccount({ accountId: escrowId })).amount);
if (escrowBalance < 3n * NEAR)
  await record("Top up the escrow operating balance", () =>
    root.signAndSendTransaction({ receiverId: escrowId, actions: [actions.transfer(3n * NEAR - escrowBalance)], waitUntil: "FINAL" }),
  );

// 2. Code.
if (!(await hasState(escrowId))) {
  await record("Deploy and initialize the QGOLD escrow", () =>
    escrow.signAndSendTransaction({
      receiverId: escrowId,
      actions: [
        actions.deployContract(wasm),
        actions.functionCall(
          "new",
          { owner_id: operator.accountId, token_id: tokenId, publisher_id: publisherId, moderator_id: publisherId, guardian_id: operator.accountId, treasury_id: operator.accountId },
          100n * TGAS,
          0n,
        ),
      ],
      waitUntil: "FINAL",
    }),
  );
}
const code = await provider.query({ request_type: "view_code", account_id: escrowId, finality: "final" });
assert.equal(sha(Buffer.from(code.code_base64, "base64")), pins.questlayer_qgold_escrow, "Deployed escrow code differs from the pin.");
const config = await view(escrowId, "get_config");
assert.equal(config.token_id, tokenId);
assert.equal(config.publisher_id, publisherId);

// 3. Token registration of the escrow, the operator treasury and the publisher
//    (the smoke send below is not an earned payout, so withdraw_for does not
//    register its recipient on the token).
for (const id of [escrowId, operator.accountId, publisherId])
  if (!(await view(tokenId, "storage_balance_of", { account_id: id })))
    await callAs(root, `Register ${id} on QGOLD`, tokenId, "storage_deposit", { account_id: id, registration_only: true }, 1_250_000_000_000_000_000_000n);

// 4. Publisher function-call key.
const keyPath = ".data/escrow-publisher.json";
if (!existsSync(keyPath)) {
  const pair = KeyPair.fromRandom("ed25519");
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, JSON.stringify({ network: "testnet", accountId: publisherId, escrowId, secretKey: pair.toString(), publicKey: pair.getPublicKey().toString() }), { mode: 0o600, flag: "wx" });
}
const pub = JSON.parse(readFileSync(keyPath));
assert.equal(pub.accountId, publisherId, `${keyPath} belongs to another account`);
if (!(await keysOf(publisherId)).some((k) => k.public_key === pub.publicKey))
  await record("Add the escrow publisher key (function-call only)", () =>
    publisherFull.signAndSendTransaction({
      receiverId: publisherId,
      actions: [actions.addFunctionCallAccessKey(PublicKey.from(pub.publicKey), escrowId, PUBLISHER_METHODS, 2n * NEAR)],
      waitUntil: "FINAL",
    }),
  );

// 5. Keyless escrow.
for (const k of await keysOf(escrowId))
  await record("Delete escrow access key " + k.public_key, () =>
    escrow.signAndSendTransaction({ receiverId: escrowId, actions: [actions.deleteKey(PublicKey.from(k.public_key))], waitUntil: "FINAL" }),
  );
assert.equal((await keysOf(escrowId)).length, 0, "The escrow must have no access keys.");

// 6. Smoke test with the publisher key.
const publisher = new Account(publisherId, provider, KeyPairSigner.fromSecretKey(pub.secretKey));
const opBalance = BigInt(await view(tokenId, "ft_balance_of", { account_id: operator.accountId }));
const amount = 10_000n; // 0.01 QGOLD
if (opBalance < amount) {
  const quote = await view(tokenId, "quote_deposit", { near: (2n * 10n ** 22n).toString() });
  await callAs(root, "Smoke: buy a little QGOLD for the test", tokenId, "deposit", { min_out: quote.qgold }, 2n * 10n ** 22n);
}
// The funder holds native storage on the escrow for its agreements (M6): a
// send needs PAIR_GROWTH plus the deposit record, well inside 0.1 NEAR.
const reserve = await view(escrowId, "get_storage_reserve");
const needed = (BigInt(reserve.pair_growth_bytes) + BigInt(reserve.entry_bytes)) * BigInt(reserve.storage_byte_cost_yocto);
const operatorStorage = await view(escrowId, "storage_balance_of", { account_id: operator.accountId });
if (!operatorStorage || BigInt(operatorStorage.available) < needed)
  await callAs(root, "Smoke: operator storage deposit on the escrow", escrowId, "storage_deposit", { account_id: operator.accountId, grant: true }, 10n ** 23n);
const smokeId = `smoke-${Date.now()}`;
await callAs(root, "Smoke: fund a both_confirm transfer", tokenId, "ft_transfer_call", {
  receiver_id: escrowId,
  amount: amount.toString(),
  memo: null,
  msg: JSON.stringify({ kind: "transfer", id: smokeId, to: publisherId, condition: { type: "both_confirm" }, expires_ms: String(Date.now() + 86_400_000) }),
}, 1n, 200n * TGAS);
assert.equal((await view(escrowId, "get_transfer", { id: smokeId }))?.status, "held", "The smoke transfer was not funded");
await callAs(publisher, "Smoke: publisher releases the transfer", escrowId, "confirm_transfer", { id: smokeId });
await callAs(publisher, "Smoke: publisher pushes the payout", escrowId, "withdraw_for", { account_id: publisherId }, 0n, 120n * TGAS);
assert.equal(BigInt(await view(tokenId, "ft_balance_of", { account_id: publisherId })), amount, "The payout did not arrive");
const stats = await view(escrowId, "get_stats");
assert.equal(stats.conserved, true, "Escrow stats are not conserved");

// 7. Manifest.
const info = await provider.viewAccount({ accountId: escrowId });
const manifest = {
  network: "testnet",
  verifiedAt: new Date().toISOString(),
  contractId: escrowId,
  tokenId,
  publisherId,
  moderatorId: publisherId,
  ownerId: operator.accountId,
  guardianId: operator.accountId,
  treasuryId: operator.accountId,
  publisherKey: pub.publicKey,
  publisherMethods: PUBLISHER_METHODS,
  codeHash: info.code_hash,
  wasmSha256: pins.questlayer_qgold_escrow,
  accessKeys: 0,
  feeBps: 1000,
  smoke: { id: smokeId, stats },
  transactions,
};
writeFileSync("public/native-qgold-escrow-testnet.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ done: true, escrowId, publisherId, stats }));

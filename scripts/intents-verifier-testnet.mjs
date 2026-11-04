// EXPERIMENTAL: self-deploy the NEAR Intents verifier (github.com/near/intents,
// tag defuse/v0.4.5) on TESTNET and prove Aura <-> wNEAR trades through it.
// There is no official testnet Intents endpoint; this is our own copy for a
// compatibility test. Mainnet uses intents.near and needs Lubos's explicit go
// (docs/NEAR-INTENTS-MARKET.md, "Mainnet proof").
//
// Runs on the operator's Mac only (reads .data/near-operator.json). One
// command per step:
//   node scripts/intents-verifier-testnet.mjs --build     # reproducible WASM via Docker
//   node scripts/intents-verifier-testnet.mjs             # plan: checks only, sends nothing
//   node scripts/intents-verifier-testnet.mjs --deploy    # create + deploy + init (atomic)
//   node scripts/intents-verifier-testnet.mjs --prove     # live Aura <-> wNEAR proof
//
// --deploy and --prove write public/native-intents-testnet.json, which turns
// the experimental market on in the game after the next VPS deploy.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
import {
  INTENTS_SOURCE,
  auraTokenDiff,
  auraTransferPair,
  intentMessage,
  signIntentWithKeyPair,
  verifierInitArgs,
  versionedNonce,
} from "../server/native/intents.mjs";

const args = new Set(process.argv.slice(2));
const BUILD = args.has("--build"),
  DEPLOY = args.has("--deploy"),
  PROVE = args.has("--prove");
const NEAR = 10n ** 24n,
  TGAS = 10n ** 12n,
  WNEAR = process.env.INTENTS_WNEAR || "wrap.testnet";
const vendorDir = resolve(".data/vendor/near-intents"),
  wasmOut = resolve("contracts/target/near-intents/defuse-v0.4.5.wasm"),
  manifestPath = "public/native-intents-testnet.json",
  outDir = "output/qa/near-intents";
const log = (o) => console.log(JSON.stringify(o));

// ---- Build (Docker, the image pinned in the verifier's own Cargo.toml) ----
if (BUILD) {
  if (!existsSync(join(vendorDir, ".git")))
    execFileSync("git", ["clone", INTENTS_SOURCE.repository, vendorDir], { stdio: "inherit" });
  execFileSync("git", ["-C", vendorDir, "fetch", "--tags", "origin"], { stdio: "inherit" });
  execFileSync("git", ["-C", vendorDir, "checkout", "--detach", INTENTS_SOURCE.commit], { stdio: "inherit" });
  const head = execFileSync("git", ["-C", vendorDir, "rev-parse", "HEAD"]).toString().trim();
  assert.equal(head, INTENTS_SOURCE.commit, "Pinned verifier commit not checked out");
  execFileSync(
    "docker",
    [
      "run", "--rm", "--platform", "linux/amd64",
      "-v", `${vendorDir}:/host`, "-w", `/host/${INTENTS_SOURCE.crate}`,
      `${INTENTS_SOURCE.image.split(":")[0]}@${INTENTS_SOURCE.imageDigest}`,
      "cargo", "near", "build", "non-reproducible-wasm", "--locked",
      `--features=${INTENTS_SOURCE.features}`, "--no-abi",
    ],
    { stdio: "inherit" },
  );
  const dir = join(vendorDir, "target/near");
  const found = readdirSync(dir, { recursive: true }).find((f) => String(f).endsWith("defuse.wasm"));
  assert.ok(found, "Build produced no defuse.wasm");
  mkdirSync(resolve("contracts/target/near-intents"), { recursive: true });
  const wasm = readFileSync(join(dir, String(found)));
  writeFileSync(wasmOut, wasm);
  log({ step: "Built verifier", path: wasmOut, bytes: wasm.length, sha256: createHash("sha256").update(wasm).digest("hex"), source: INTENTS_SOURCE });
  process.exit(0);
}

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet", "Testnet only");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet only");
const market = JSON.parse(readFileSync("public/native-market-testnet.json"));
const nftId = market.nftContract,
  operatorId = operator.accountId,
  verifierId = process.env.INTENTS_VERIFIER_ACCOUNT || `intents.${operatorId}`;
assert.ok(verifierId.endsWith(".testnet") && nftId.endsWith(".testnet"));
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  keyPair = KeyPair.fromString(operator.secretKey),
  publicKey = keyPair.getPublicKey().toString();
const accountOf = (id) => new Account(id, provider, signer);
const transactions = [];
const txHash = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failedOutcome = (r) => Boolean(r.status?.Failure) || (r.receipts_outcome || []).some((o) => o.outcome?.status?.Failure);
const view = async (contractId, method, a = {}) => {
  const r = await provider.query({
    request_type: "call_function", account_id: contractId, method_name: method,
    args_base64: Buffer.from(JSON.stringify(a)).toString("base64"), finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
const exists = async (id) => {
  try {
    await provider.query({ request_type: "view_account", account_id: id, finality: "final" });
    return true;
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(rpcErrorText(e))) return false;
    throw e;
  }
};
async function call(label, who, contractId, methodName, a, deposit = 0n, { gas = 150n * TGAS, expectFailure = false } = {}) {
  let r;
  try {
    r = await accountOf(who).callFunctionRaw({ contractId, methodName, args: a, deposit, gas, waitUntil: "FINAL" });
  } catch (error) {
    if (!expectFailure) throw error;
    transactions.push({ label, rejectedAsExpected: true, error: String(error.message || error).slice(0, 200) });
    log({ step: label, rejected: true });
    return null;
  }
  assert.equal(failedOutcome(r), expectFailure, `${label}: ${expectFailure ? "expected rejection" : JSON.stringify(r.status)}`);
  transactions.push({ label, transaction: txHash(r), rejectedAsExpected: expectFailure || undefined });
  log({ step: label, transaction: txHash(r) });
  return r;
}

const wasm = existsSync(wasmOut) ? readFileSync(wasmOut) : null;
const wasmSha256 = wasm ? createHash("sha256").update(wasm).digest("hex") : null;
const deployed = await exists(verifierId);
const operatorBalance = BigInt((await provider.query({ request_type: "view_account", account_id: operatorId, finality: "final" })).amount);
// Contract storage costs 1 NEAR per 100 kB; keep 3 NEAR for verifier state.
const fund = wasm ? BigInt(wasm.length) * 10n ** 19n + 3n * NEAR : null;
log({ step: "Plan", verifierId, deployed, nftId, wnear: WNEAR, wasmSha256, wasmBytes: wasm?.length ?? null, fundNear: fund ? Number(fund / 10n ** 21n) / 1000 : null, operatorNear: Number(operatorBalance / 10n ** 21n) / 1000, initArgs: verifierInitArgs({ owner: operatorId, wnear: WNEAR }) });

function writeManifest(extra = {}) {
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath)) : {};
  const manifest = {
    ...previous,
    experimental: true,
    label: "Self-deployed NEAR Intents verifier (testnet, experimental, not intents.near)",
    network: "testnet",
    verifierContract: verifierId,
    nftContract: nftId,
    wnear: WNEAR,
    owner: operatorId,
    fee: 0,
    source: INTENTS_SOURCE,
    wasmSha256: wasmSha256 ?? previous.wasmSha256,
    verifiedAt: new Date().toISOString(),
    transactions: [...(previous.transactions || []), ...transactions],
    ...extra,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  log({ step: "Manifest written", path: manifestPath });
}

if (DEPLOY && !deployed) {
  assert.ok(wasm, "Run --build first");
  assert.ok(operatorBalance > fund + NEAR, `The operator needs about ${Number(fund / NEAR) + 1} test NEAR; top it up from the testnet faucet.`);
  // Create, fund, deploy and init in one transaction: a failed init leaves no account.
  const r = await accountOf(operatorId).signAndSendTransaction({
    receiverId: verifierId,
    actions: [
      actions.createAccount(),
      actions.transfer(fund),
      actions.addFullAccessKey(keyPair.getPublicKey()),
      actions.deployContract(wasm),
      actions.functionCall("new", verifierInitArgs({ owner: operatorId, wnear: WNEAR }), 200n * TGAS, 0n),
    ],
    waitUntil: "FINAL",
  });
  assert.ok(!failedOutcome(r), JSON.stringify(r.status));
  transactions.push({ label: "Create, deploy and init the experimental testnet verifier (atomic)", transaction: txHash(r) });
  log({ step: "Deployed", transaction: txHash(r) });
  // The verifier must hold a wNEAR storage registration to receive deposits.
  await call("Register the verifier with wNEAR storage", operatorId, WNEAR, "storage_deposit", { account_id: verifierId, registration_only: true }, 125n * 10n ** 19n);
} else if (deployed && wasm) {
  const code = await provider.query({ request_type: "view_code", account_id: verifierId, finality: "final" });
  assert.ok(Buffer.from(code.code_base64, "base64").equals(wasm), "The verifier runs different code than the pinned build");
  log({ step: "Verifier already runs the pinned build" });
}
if (deployed || DEPLOY) {
  assert.equal(await view(verifierId, "fee"), 0, "The experimental verifier must have a zero fee");
  log({ step: "Verifier state", salt: await view(verifierId, "current_salt") });
}
if (DEPLOY) writeManifest();

if (PROVE) {
  assert.ok(await exists(verifierId), "Run --deploy first");
  const proof = await proveTrades();
  writeManifest({ proof });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/proof.json`, JSON.stringify(proof, null, 2) + "\n");
}

async function proveTrades() {
  const explorerId = `explorer.${operatorId}`;
  const salt = await view(verifierId, "current_salt");
  const nftOwner = async (t) => (await view(nftId, "nft_token", { token_id: t }))?.owner_id;
  const bal = async (who, token) => BigInt(await view(verifierId, "mt_balance_of", { account_id: who, token_id: token }));
  const sign = (who, intents, ttlMs = 10 * 60_000) => {
    const deadlineMs = Date.now() + ttlMs;
    // Developer CLI stand-in for the device key's signNep413Message.
    return signIntentWithKeyPair(keyPair, {
      message: intentMessage({ signerId: who, deadlineMs, intents }),
      nonce: versionedNonce({ salt, deadlineMs }),
      recipient: verifierId,
    });
  };
  let seller, token;
  for (const id of [operatorId, explorerId]) {
    const owned = await view(nftId, "nft_tokens_for_owner", { account_id: id, from_index: "0", limit: 50 });
    const aura = owned.find((t) => t.token_id.startsWith("aura:"));
    if (aura) { seller = id; token = aura.token_id; break; }
  }
  assert.ok(seller, "Neither developer account owns an Aura to trade");
  const buyer = seller === operatorId ? explorerId : operatorId;
  const price = 10n ** 22n; // 0.01 wNEAR
  const nftToken = `nep171:${nftId}:${token}`,
    ftToken = `nep141:${WNEAR}`;
  // 1. Register the signing key with the verifier for both accounts.
  for (const id of [seller, buyer])
    if (!(await view(verifierId, "has_public_key", { account_id: id, public_key: publicKey })))
      await call(`Register intents key for ${id}`, id, verifierId, "add_public_key", { public_key: publicKey }, 1n);
  // 2. Deposits: the Aura from the seller, wNEAR from the buyer.
  await call(`Deposit ${token} into the verifier`, seller, nftId, "nft_transfer_call",
    { receiver_id: verifierId, token_id: token, approval_id: null, memo: null, msg: "" }, 1n, { gas: 200n * TGAS });
  assert.equal(await bal(seller, nftToken), 1n);
  const storage = await view(WNEAR, "storage_balance_of", { account_id: buyer });
  if (!storage) await call(`Register ${buyer} with wNEAR`, buyer, WNEAR, "storage_deposit", { account_id: buyer, registration_only: true }, 125n * 10n ** 19n);
  await call("Wrap 0.01 NEAR", buyer, WNEAR, "near_deposit", {}, price);
  await call("Deposit 0.01 wNEAR into the verifier", buyer, WNEAR, "ft_transfer_call",
    { receiver_id: verifierId, amount: price.toString(), msg: "" }, 1n, { gas: 100n * TGAS });
  const buyerWnear = await bal(buyer, ftToken);
  assert.ok(buyerWnear >= price);
  // 3. Primary path: two opposite token_diff intents settled by one execute_intents.
  const sellIntent = sign(seller, [auraTokenDiff({ side: "sell", nftContract: nftId, tokenId: token, price, wnear: WNEAR })]);
  const buyIntent = sign(buyer, [auraTokenDiff({ side: "buy", nftContract: nftId, tokenId: token, price, wnear: WNEAR })]);
  const sim = await view(verifierId, "simulate_intents", { signed: [sellIntent, buyIntent] });
  assert.ok(!sim.invariant_violated, JSON.stringify(sim.invariant_violated));
  await call("Aura -> wNEAR via token_diff (execute_intents)", operatorId, verifierId, "execute_intents", { signed: [sellIntent, buyIntent] }, 0n);
  assert.equal(await bal(buyer, nftToken), 1n);
  assert.equal(await bal(seller, nftToken), 0n);
  // 4. Replay of the same signed intents must fail (nonces are used).
  await call("Replay of the same intents is rejected", operatorId, verifierId, "execute_intents", { signed: [sellIntent, buyIntent] }, 0n, { expectFailure: true });
  // 5. Fallback path: two transfer intents, same call, so still atomic (trade back).
  const pair = auraTransferPair({ seller: buyer, buyer: seller, nftContract: nftId, tokenId: token, price, wnear: WNEAR });
  await call("Aura <- wNEAR via transfer + transfer (fallback)", operatorId, verifierId, "execute_intents",
    { signed: [sign(buyer, [pair.seller]), sign(seller, [pair.buyer])] }, 0n);
  assert.equal(await bal(seller, nftToken), 1n);
  // 6. Withdrawals signed as intents and submitted by the solver (no player gas).
  await call("Withdraw the Aura back to its owner (nft_withdraw intent)", operatorId, verifierId, "execute_intents",
    { signed: [sign(seller, [{ intent: "nft_withdraw", token: nftId, token_id: token, receiver_id: seller }])] }, 0n, { gas: 250n * TGAS });
  const left = await bal(buyer, ftToken);
  if (left > 0n)
    await call("Withdraw wNEAR as native NEAR (native_withdraw intent)", operatorId, verifierId, "execute_intents",
      { signed: [sign(buyer, [{ intent: "native_withdraw", receiver_id: buyer, amount: left.toString() }])] }, 0n, { gas: 250n * TGAS });
  assert.equal(await nftOwner(token), seller, "The Aura must be back with its owner");
  return {
    provedAt: new Date().toISOString(),
    verifier: verifierId,
    experimental: true,
    seller, buyer, token, price: price.toString(),
    steps: transactions.filter((t) => !/Create, deploy/.test(t.label)),
  };
}

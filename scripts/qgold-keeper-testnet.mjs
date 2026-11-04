// QGOLD market keeper account on TESTNET (docs/QGOLD-MARKET.md). Mac only:
// reads .data/near-operator.json and writes .data/qgold-keeper.json (mode 600).
//
//   node scripts/qgold-keeper-testnet.mjs                 # plan: checks only, sends nothing
//   node scripts/qgold-keeper-testnet.mjs --create        # create + fund (3 NEAR) + register
//   node scripts/qgold-keeper-testnet.mjs --create --near 3
//   node scripts/qgold-keeper-testnet.mjs --register      # only redo the registrations
//
// The keeper is its own sub-account (qgold-keeper.<operator>.testnet) with a
// full-access key, because it attaches NEAR to vault deposits and wraps NEAR;
// it holds only what it is funded with, never treasury or player money. Then
// `bash scripts/install-qgold-keeper-vps.sh` puts the key in the VPS state
// directory, where the server finds it and the keeper starts trading at its
// 12 committed times (QGOLD_KEEPER_EXECUTE=0 turns trading off again).
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

const argv = process.argv.slice(2);
const CREATE = argv.includes("--create"),
  REGISTER = CREATE || argv.includes("--register");
const nearArg = argv.includes("--near") ? argv[argv.indexOf("--near") + 1] : "3";
assert.match(nearArg, /^\d{1,3}(\.\d{1,6})?$/, "--near takes a plain NEAR amount");
const NEAR = 10n ** 24n,
  TGAS = 10n ** 12n;
const [w, f = ""] = nearArg.split(".");
const FUND = BigInt(w) * NEAR + BigInt(f.padEnd(24, "0"));
const keyPath = ".data/qgold-keeper.json";
const log = (o) => console.log(JSON.stringify(o));

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet", "Testnet only");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0, "Operator key file must be private");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet only");
const vault = JSON.parse(readFileSync("public/native-qgold-vault-testnet.json"));
const pool = JSON.parse(readFileSync("public/native-qgold-pool-testnet.json"));
const QGOLD = vault.tokenContract || vault.vaultContract,
  DEX = pool.dex,
  WNEAR = pool.wnear;
const keeperId = `qgold-keeper.${operator.accountId}`;
const exists = async (id) => {
  try {
    return await provider.viewAccount({ accountId: id });
  } catch {
    return null;
  }
};
const existing = await exists(keeperId);
log({ step: "plan", keeper: keeperId, exists: Boolean(existing), balance: existing?.amount ?? null, fund: FUND.toString(), qgold: QGOLD, dex: DEX, poolId: pool.poolId, keyFile: existsSync(keyPath) });
if (!REGISTER) {
  log({ step: "Plan only. Run with --create (or --register) to send." });
  process.exit(0);
}

if (CREATE && !existing) {
  assert.ok(!existsSync(keyPath), `${keyPath} exists but ${keeperId} does not; move it aside first.`);
  const key = KeyPair.fromRandom("ed25519");
  const record = { network: "testnet", accountId: keeperId, publicKey: key.getPublicKey().toString(), secretKey: key.toString(), createdAt: new Date().toISOString(), purpose: "QGOLD market keeper (testnet)" };
  // Key first, account second: a crash in between leaves a key for nothing, never an account without its key.
  writeFileSync(keyPath, JSON.stringify(record, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  const root = new Account(operator.accountId, provider, KeyPairSigner.fromSecretKey(operator.secretKey));
  try {
    const r = await root.createAccount({ newAccountId: keeperId, publicKey: record.publicKey, nearToTransfer: FUND });
    log({ step: "Created and funded the keeper", transaction: r?.transaction?.hash ?? r?.transaction_outcome?.id });
  } catch (error) {
    throw Error(`create keeper: ${rpcErrorText(error)}`);
  }
}

assert.ok(existsSync(keyPath), `${keyPath} is missing`);
assert.equal(statSync(keyPath).mode & 0o077, 0, "Keeper key file must be private");
const keeper = JSON.parse(readFileSync(keyPath));
assert.equal(keeper.accountId, keeperId);
const account = new Account(keeperId, provider, KeyPairSigner.fromSecretKey(keeper.secretKey));
const view = async (contractId, method, args) => {
  const r = await provider.query({ request_type: "call_function", account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
};
async function call(label, contractId, methodName, args, deposit) {
  const r = await account.callFunctionRaw({ contractId, methodName, args, deposit, gas: 50n * TGAS, waitUntil: "FINAL" });
  const bad = r?.status?.Failure || (r?.receipts_outcome || []).find((o) => o.outcome?.status?.Failure);
  if (bad) throw Error(`${label} failed: ${JSON.stringify(bad).slice(0, 300)}`);
  log({ step: label, transaction: r?.transaction?.hash ?? r?.transaction_outcome?.id });
}
const registered = async (contractId) => (await view(contractId, "storage_balance_of", { account_id: keeperId })) != null;
if (!(await registered(WNEAR))) await call("Register the keeper on wNEAR", WNEAR, "storage_deposit", { account_id: keeperId, registration_only: true }, NEAR / 100n);
if (!(await registered(QGOLD))) await call("Register the keeper on QGOLD", QGOLD, "storage_deposit", { account_id: keeperId, registration_only: true }, NEAR / 100n);
if (!(await registered(DEX))) await call("Register the keeper on Rhea", DEX, "storage_deposit", { account_id: keeperId, registration_only: false }, NEAR / 10n);
await call("Register both tokens for the keeper on Rhea", DEX, "register_tokens", { token_ids: [WNEAR, QGOLD] }, 1n);
const after = await exists(keeperId);
log({ step: "Keeper ready", keeper: keeperId, balance: after?.amount, next: "bash scripts/install-qgold-keeper-vps.sh" });

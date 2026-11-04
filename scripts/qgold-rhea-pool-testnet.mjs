// QGOLD/wNEAR pool on Rhea (Ref) TESTNET, ref-finance-101.testnet.
// docs/QGOLD-MARKET.md. Runs on the operator's Mac only (.data/near-operator.json).
// Needs the QGOLD vault manifest (public/native-qgold-vault-testnet.json) from
// the vault stream: QGOLD must be the transferable NEP-141 of that vault.
//
//   node scripts/qgold-rhea-pool-testnet.mjs               # plan: checks only, sends nothing
//   node scripts/qgold-rhea-pool-testnet.mjs --create      # create the pool and seed it
//   node scripts/qgold-rhea-pool-testnet.mjs --create --near 5
//
// The pool opens at the vault's buy price (R + 1 %), so nobody can buy from
// the pool and sell to the vault for a profit on the first block. --create
// writes public/native-qgold-pool-testnet.json; commit it and deploy the VPS
// to show the pool on /economy and let the keeper read it.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
import { QGOLD_ONE, depositQuote, poolPrice } from "../server/qgold/market-math.mjs";
import { vaultState } from "../server/qgold/keeper.mjs";

const argv = process.argv.slice(2);
const CREATE = argv.includes("--create");
const nearArg = argv.includes("--near") ? argv[argv.indexOf("--near") + 1] : "5";
assert.match(nearArg, /^\d{1,4}(\.\d{1,6})?$/, "--near takes a plain NEAR amount");
const NEAR = 10n ** 24n,
  TGAS = 10n ** 12n;
const [w, f = ""] = nearArg.split(".");
const SEED_NEAR = BigInt(w) * NEAR + BigInt(f.padEnd(24, "0"));
const DEX = process.env.QGOLD_RHEA_DEX || "ref-finance-101.testnet",
  WNEAR = "wrap.testnet",
  FEE_BPS = 30,
  vaultManifestPath = "public/native-qgold-vault-testnet.json",
  poolManifestPath = "public/native-qgold-pool-testnet.json";
const log = (o) => console.log(JSON.stringify(o));

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet", "Testnet only");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0, "Operator key file must be private");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet only");
assert.ok(existsSync(vaultManifestPath), `${vaultManifestPath} is missing: the QGOLD vault is not deployed yet.`);
const vaultManifest = JSON.parse(readFileSync(vaultManifestPath));
const QGOLD = vaultManifest.tokenContract || vaultManifest.vaultContract;
assert.ok(QGOLD?.endsWith(".testnet"), "Vault manifest has no testnet QGOLD contract");

const view = async (contractId, method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};

const dexConfig = await view(DEX, "metadata");
assert.equal(dexConfig.state, "Running", "Rhea testnet exchange is not running");
const state = vaultState(await view(QGOLD, "get_state"));
const meta = await view(QGOLD, "ft_metadata");
const balance = BigInt((await provider.viewAccount({ accountId: operator.accountId })).amount);
const price = (state.rate * 10100n) / 10000n; // open at R + 1 %
const seed = depositQuote(SEED_NEAR, state.rate); // QGOLD bought from the vault with SEED_NEAR
const poolNear = SEED_NEAR,
  poolQgold = (poolNear * QGOLD_ONE) / price;
const plan = {
  dex: DEX,
  dexPools: dexConfig.pool_count,
  qgold: QGOLD,
  symbol: meta.symbol,
  decimals: meta.decimals,
  rate: state.rate.toString(),
  openPrice: price.toString(),
  seedNear: SEED_NEAR.toString(),
  qgoldFromVault: seed.qgold,
  pool: { near: poolNear.toString(), qgold: poolQgold.toString() },
  operator: operator.accountId,
  operatorBalance: balance.toString(),
  needs: (2n * SEED_NEAR + NEAR / 2n).toString(),
};
assert.equal(meta.decimals, 6, "QGOLD must have 6 decimals");
assert.ok(BigInt(seed.qgold) >= poolQgold, "Vault deposit would not cover the pool's QGOLD side");
log({ step: "plan", ...plan });
if (!CREATE) {
  log({ step: "Plan only. Run again with --create to send." });
  process.exit(0);
}
assert.ok(balance > BigInt(plan.needs), "Operator balance too low for the pool seed");

const account = new Account(operator.accountId, provider, KeyPairSigner.fromSecretKey(operator.secretKey));
const txs = [];
async function call(label, contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) {
  try {
    const r = await account.callFunctionRaw({ contractId, methodName, args, deposit, gas, waitUntil: "FINAL" });
    const hash = r?.transaction?.hash || r?.transaction_outcome?.id;
    const bad = r?.status?.Failure || (r?.receipts_outcome || []).find((o) => o.outcome?.status?.Failure);
    assert.ok(!bad, `${label} failed: ${String(JSON.stringify(bad)).slice(0, 400)}`);
    txs.push({ label, transaction: hash });
    log({ step: label, transaction: hash });
    return r;
  } catch (error) {
    throw Error(`${label}: ${rpcErrorText(error)}`);
  }
}
const returned = (r) => {
  const v = r?.status?.SuccessValue;
  return v ? JSON.parse(Buffer.from(v, "base64").toString()) : null;
};

// --pool <id> resumes an empty pool this script already created, without a second one.
const resumePool = argv.includes("--pool") ? Number(argv[argv.indexOf("--pool") + 1]) : null;
let poolId;
if (resumePool === null) {
  // 1. Storage on the exchange and the tokens.
  await call("Register the operator on Rhea", DEX, "storage_deposit", { account_id: operator.accountId, registration_only: false }, NEAR / 10n);
  await call("Register Rhea on QGOLD", QGOLD, "storage_deposit", { account_id: DEX, registration_only: true }, NEAR / 100n);
  // 2. Pool.
  const created = await call("Create the QGOLD/wNEAR simple pool", DEX, "add_simple_pool", { tokens: [WNEAR, QGOLD], fee: FEE_BPS }, NEAR / 10n);
  poolId = Number(returned(created));
  assert.ok(Number.isInteger(poolId) && poolId >= 0, "No pool id returned");
  await call("Register both tokens for the operator on Rhea", DEX, "register_tokens", { token_ids: [WNEAR, QGOLD] }, 1n);
} else {
  const existing = await view(DEX, "get_pool", { pool_id: resumePool });
  assert.deepEqual(existing.token_account_ids, [WNEAR, QGOLD], "--pool is not the QGOLD/wNEAR pool");
  assert.ok(existing.amounts.every((a) => a === "0"), "--pool already has liquidity");
  poolId = resumePool;
}
// 3. Liquidity: QGOLD from the vault at R + 1 % (fully backed), wNEAR by wrapping.
// Wrapping the first time also pays wrap.testnet storage out of the deposit, so
// the pool takes the wNEAR actually held, not the amount sent.
const held = async (token) => BigInt(await view(token, "ft_balance_of", { account_id: operator.accountId }));
if ((await held(QGOLD)) < poolQgold)
  await call("Buy QGOLD from the vault for the pool", QGOLD, "deposit", { min_out: ((BigInt(seed.qgold) * 99n) / 100n).toString() }, SEED_NEAR, 100n * TGAS);
if ((await held(WNEAR)) < (poolNear * 99n) / 100n) await call("Wrap NEAR", WNEAR, "near_deposit", {}, poolNear, 30n * TGAS);
const wnearIn = [poolNear, await held(WNEAR)].reduce((a, b) => (a < b ? a : b));
const qgoldIn = (wnearIn * QGOLD_ONE) / price;
await call("Deposit wNEAR on Rhea", WNEAR, "ft_transfer_call", { receiver_id: DEX, amount: wnearIn.toString(), msg: "" }, 1n, 100n * TGAS);
await call("Deposit QGOLD on Rhea", QGOLD, "ft_transfer_call", { receiver_id: DEX, amount: qgoldIn.toString(), msg: "" }, 1n, 100n * TGAS);
await call("Add liquidity", DEX, "add_liquidity", { pool_id: poolId, amounts: [wnearIn.toString(), qgoldIn.toString()] }, NEAR / 100n, 100n * TGAS);

const pool = await view(DEX, "get_pool", { pool_id: poolId });
const near = BigInt(pool.amounts[pool.token_account_ids.indexOf(WNEAR)]),
  qg = BigInt(pool.amounts[pool.token_account_ids.indexOf(QGOLD)]);
const manifest = {
  network: "testnet",
  dex: DEX,
  poolId,
  wnear: WNEAR,
  qgold: QGOLD,
  feeBps: FEE_BPS,
  openPrice: price.toString(),
  createdAt: new Date().toISOString(),
  reserves: { near: near.toString(), qgold: qg.toString(), price: poolPrice({ near, qgold: qg }).toString() },
  swapUrl: `https://testnet.rhea.finance/#${WNEAR}|${QGOLD}`,
  transactions: txs,
};
writeFileSync(poolManifestPath, JSON.stringify(manifest, null, 2) + "\n");
log({ step: "Wrote manifest", path: poolManifestPath, poolId });

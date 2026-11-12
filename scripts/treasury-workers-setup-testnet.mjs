// Moves the daily treasury workers off the Mac (docs/TREASURY-WORKERS-VPS.md).
// Runs ON THE MAC with the operator key; testnet only. It prepares everything
// scripts/install-treasury-workers-vps.sh copies to the VPS, so the operator
// full-access key never leaves the Mac.
//
//   node scripts/treasury-workers-setup-testnet.mjs                       # dry run: what would happen
//   node scripts/treasury-workers-setup-testnet.mjs --execute             # keeper + council-a on the VPS
//   node scripts/treasury-workers-setup-testnet.mjs --execute --council-b # also council-b (Lubos's choice)
//   node scripts/treasury-workers-setup-testnet.mjs --execute --sweep     # move what reached the operator after the move
//
// What --execute does, idempotently:
//  1. Creates treasury-ops.<operator>: a dedicated account that holds only the
//     treasury mix (stNEAR, wNEAR reserve, test stablecoins) and its gas. Its
//     key is a full-access key because harvest, rebalance and keep attach
//     deposits (fund_rewards, deposit_and_stake, near_deposit, 1 yocto on
//     ft_transfer_call and vault withdraw), which a function-call key cannot do.
//  2. Adds function-call keys for the DAO only: keeper (add_proposal,
//     act_proposal), council-a (act_proposal) and, with --council-b, council-b.
//     Their full-access keys stay in .data/treasury-dao-keys.json on the Mac.
//  3. Moves the mix holdings from the operator to treasury-ops: withdraws the
//     operator's yield-vault positions, transfers stNEAR, wNEAR, USDC and USDT,
//     and the NEAR the testnet stand-in counterparty holds.
//  4. Writes the VPS bundle .data/treasury-vps/ (keys + state rewritten for
//     treasury-ops) and renames the Mac state files to *.moved-to-vps.json so
//     the Mac scripts cannot run on stale state.
// Step 3 refuses while the Mac LaunchAgent is installed: remove it first
// (bash scripts/install-stnear-harvest-mac.sh --remove).
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import { DAO_FACTORY, DAO_NAME } from "../server/native/treasury-dao.mjs";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const withCouncilB = args.includes("--council-b");
// Sweep again after the move (e.g. a stablecoin the vault first had to pull back from Rhea).
const sweep = args.includes("--sweep");

const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath));
assert.equal(operator.network, "testnet", "Testnet only");
assert.equal(statSync(operatorPath).mode & 0o077, 0, "Operator key file must be private (chmod 600)");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");

const op = operator.accountId;
const opsId = `treasury-ops.${op}`;
const daoId = process.env.TREASURY_DAO_ID || `${DAO_NAME}.${DAO_FACTORY.testnet}`;
const yieldVault = process.env.TREASURY_MIX_VAULT || "questlayer-yield-20261102.testnet";
const TOKENS = ["meta-v2.pool.testnet", "wrap.testnet", "usdc.fakes.testnet", "usdt.fakes.testnet"];
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const OPS_GAS = NEAR; // gas money for a year of daily runs
const SEAT_BALANCE = NEAR; // keeper / council accounts are topped up to this
const FC_ALLOWANCE = (9n * NEAR) / 10n;
const bundle = ".data/treasury-vps";
const daoKeysPath = ".data/treasury-dao-keys.json";
const opsKeyPath = ".data/treasury-ops.json";
const launchAgent = `${homedir()}/Library/LaunchAgents/com.questlayer.stnear-harvest.plist`;

const txOf = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failed = (r) => r.status?.Failure || r.receipts_outcome?.some((o) => o.outcome.status?.Failure);
const log = (v) => console.log(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
const nearStr = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4);
const readJson = (p) => JSON.parse(readFileSync(p));
function writePrivate(path, value) {
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
async function view(accountId, method, a = {}) {
  const r = await provider.query({ request_type: "call_function", account_id: accountId, method_name: method, args_base64: Buffer.from(JSON.stringify(a)).toString("base64"), finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
}
async function balance(accountId) {
  try {
    return BigInt((await provider.viewAccount({ accountId })).amount);
  } catch (e) {
    if (/does not exist|unknown_account/i.test(String(e?.message || e) + JSON.stringify(e?.data || ""))) return null;
    throw e;
  }
}
async function accessKeys(accountId) {
  const r = await provider.query({ request_type: "view_access_key_list", account_id: accountId, finality: "final" });
  return r.keys;
}
const operatorAccount = new Account(op, provider, KeyPairSigner.fromSecretKey(operator.secretKey));
async function send(account, receiverId, acts) {
  const r = await account.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL" });
  assert(!failed(r), `${receiverId}: ${JSON.stringify(r.status).slice(0, 400)}`);
  return r;
}

assert(existsSync(daoKeysPath), `${daoKeysPath} is missing: the DAO was set up from another folder?`);
assert.equal(statSync(daoKeysPath).mode & 0o077, 0, `${daoKeysPath} must be private (chmod 600)`);
const daoKeys = readJson(daoKeysPath);
const seats = { keeper: ["add_proposal", "act_proposal"], councilA: ["act_proposal"], ...(withCouncilB ? { councilB: ["act_proposal"] } : {}) };
for (const k of Object.keys(seats)) assert(daoKeys[k]?.accountId, `${daoKeysPath} has no ${k}.`);
const policy = await view(daoId, "get_policy");
assert.equal(String(policy.proposal_bond), "0", "The DAO asks for a proposal bond; a function-call key cannot attach it.");

// ------------------------------------------------------------------ plan
const opsBalance = await balance(opsId);
const vpsKeysPath = `${bundle}/treasury-dao-keys.json`;
const vpsKeys = existsSync(vpsKeysPath) ? readJson(vpsKeysPath) : {};
const positions = (await view(yieldVault, "get_position", { account_id: op })).filter((p) => BigInt(p.withdrawable) > 0n);
const wallet = {};
for (const t of TOKENS) wallet[t] = BigInt(await view(t, "ft_balance_of", { account_id: op }));
const mixState = existsSync(".data/treasury-mix.json") ? readJson(".data/treasury-mix.json") : null;
const stnearState = existsSync(".data/stnear-treasury.json") ? readJson(".data/stnear-treasury.json") : null;
const standIn = BigInt(mixState?.standIn?.nearHeld || "0");
log({
  execute,
  treasuryOps: { id: opsId, exists: opsBalance != null, balanceNear: opsBalance != null ? nearStr(opsBalance) : null },
  functionCallKeys: Object.fromEntries(Object.entries(seats).map(([k, m]) => [daoKeys[k].accountId, { receiver: daoId, methods: m, haveKey: !!vpsKeys[k] }])),
  councilOnVps: withCouncilB ? "council-a + council-b (both automatic approvals)" : "council-a only (second approval: approve-pending on the Mac or the operator seat)",
  move: {
    vaultPositions: positions.map((p) => ({ token: p.token_id, withdrawable: p.withdrawable })),
    wallet: Object.fromEntries(Object.entries(wallet).filter(([, v]) => v > 0n)),
    standInNear: nearStr(standIn),
    alreadyMoved: !mixState && existsSync(".data/treasury-mix.moved-to-vps.json"),
  },
  launchAgentInstalled: existsSync(launchAgent),
});
if (!execute) {
  log({ note: "Dry run. Remove the Mac LaunchAgent, then re-run with --execute (add --council-b if Lubos allowed both council keys on the VPS)." });
  process.exit(0);
}
mkdirSync(bundle, { recursive: true, mode: 0o700 });

// ------------------------------------------------------------------ 1. treasury-ops
let opsKey = existsSync(opsKeyPath) ? readJson(opsKeyPath) : null;
if (opsBalance == null) {
  if (!opsKey) {
    const pair = KeyPair.fromRandom("ed25519");
    opsKey = { network: "testnet", accountId: opsId, publicKey: pair.getPublicKey().toString(), secretKey: pair.toString() };
    writePrivate(opsKeyPath, opsKey); // before the account exists, so a crash never loses the key
  }
  const r = await operatorAccount.createAccount({ newAccountId: opsId, publicKey: opsKey.publicKey, nearToTransfer: OPS_GAS });
  log({ created: opsId, transaction: txOf(r) });
} else {
  assert(opsKey, `${opsId} exists but ${opsKeyPath} is missing.`);
  assert((await accessKeys(opsId)).some((k) => k.public_key === opsKey.publicKey), `${opsKeyPath} is not a key of ${opsId}.`);
}

// ------------------------------------------------------------------ 2. DAO function-call keys
for (const [k, methods] of Object.entries(seats)) {
  const id = daoKeys[k].accountId;
  const onChain = await accessKeys(id);
  if (!vpsKeys[k] || !onChain.some((x) => x.public_key === vpsKeys[k].publicKey)) {
    const pair = KeyPair.fromRandom("ed25519");
    vpsKeys[k] = { accountId: id, publicKey: pair.getPublicKey().toString(), secretKey: pair.toString(), receiver: daoId, methods };
    writePrivate(vpsKeysPath, vpsKeys);
    const seat = new Account(id, provider, KeyPairSigner.fromSecretKey(daoKeys[k].secretKey));
    const r = await send(seat, id, [actions.addFunctionCallAccessKey(pair.getPublicKey(), daoId, methods, FC_ALLOWANCE)]);
    log({ functionCallKey: id, methods, transaction: txOf(r) });
  }
  const have = await balance(id);
  if (have < SEAT_BALANCE) {
    const r = await send(operatorAccount, id, [actions.transfer(SEAT_BALANCE - have)]);
    log({ toppedUp: id, near: nearStr(SEAT_BALANCE - have), transaction: txOf(r) });
  }
}
// A council key the VPS should no longer hold is dropped from the bundle (its
// chain key stays until removed by hand from the Mac with the full-access key).
if (!withCouncilB && vpsKeys.councilB) {
  delete vpsKeys.councilB;
  writePrivate(vpsKeysPath, vpsKeys);
  log({ note: "council-b is no longer in the VPS bundle; delete its function-call key on chain if it was installed" });
}

// ------------------------------------------------------------------ 3. move the mix holdings
if (mixState || stnearState || sweep) {
  assert(!existsSync(launchAgent), "The Mac LaunchAgent is still installed: bash scripts/install-stnear-harvest-mac.sh --remove first.");
  for (const p of positions) {
    const r = await send(operatorAccount, yieldVault, [actions.functionCall("withdraw", { token_id: p.token_id, amount: p.withdrawable }, 100n * TGAS, 1n)]);
    log({ vaultWithdraw: p.token_id, amount: p.withdrawable, transaction: txOf(r) });
  }
  const queued = (await view(yieldVault, "get_position", { account_id: op })).filter((p) => BigInt(p.queued || "0") > 0n);
  if (queued.length) log({ note: "the vault queued part of a withdrawal; re-run with --execute --sweep once it arrives", queued: queued.map((p) => [p.token_id, p.queued]) });
  for (const t of TOKENS) {
    const amount = BigInt(await view(t, "ft_balance_of", { account_id: op }));
    if (amount === 0n) continue;
    let registered = true;
    try {
      registered = !!(await view(t, "storage_balance_of", { account_id: opsId }));
    } catch {
      registered = true; // no NEP-145 on this token
    }
    if (!registered) {
      const r = await send(operatorAccount, t, [actions.functionCall("storage_deposit", { account_id: opsId, registration_only: true }, 30n * TGAS, 1_250_000_000_000_000_000_000n)]);
      log({ storage: t, transaction: txOf(r) });
    }
    const r = await send(operatorAccount, t, [actions.functionCall("ft_transfer", { receiver_id: opsId, amount: amount.toString(), memo: "treasury mix to treasury-ops" }, 30n * TGAS, 1n)]);
    log({ moved: t, amount, transaction: txOf(r) });
  }
  if (standIn > 0n) {
    const r = await send(operatorAccount, opsId, [actions.transfer(standIn)]);
    log({ movedStandInNear: nearStr(standIn), transaction: txOf(r) });
  }
  if (stnearState) {
    writePrivate(`${bundle}/stnear-treasury.json`, { ...stnearState, account: opsId, movedFrom: op, movedAt: new Date().toISOString() });
    renameSync(".data/stnear-treasury.json", ".data/stnear-treasury.moved-to-vps.json");
  }
  if (mixState) {
    writePrivate(`${bundle}/treasury-mix.json`, { ...mixState, account: opsId, movedFrom: op, movedAt: new Date().toISOString() });
    renameSync(".data/treasury-mix.json", ".data/treasury-mix.moved-to-vps.json");
  }
} else log({ note: "holdings already moved (state files are *.moved-to-vps.json)" });

// ------------------------------------------------------------------ 4. bundle
writePrivate(`${bundle}/treasury-ops.json`, opsKey);
log({
  bundle,
  files: ["treasury-ops.json", "treasury-dao-keys.json", "stnear-treasury.json", "treasury-mix.json"].filter((f) => existsSync(`${bundle}/${f}`)),
  opsBalanceNear: nearStr(await balance(opsId)),
  next: "bash scripts/install-treasury-workers-vps.sh --dry-run, then without --dry-run",
});

// Testnet faucet NEAR -> global prize pool (rewards treasury), Mac side.
//
// The official testnet helper (helper.testnet.near.org/account) creates a new
// account with 10 test NEAR. We create throwaway accounts keyed with the
// operator's PUBLIC key (the helper never sees a secret), then this script,
// signing with the operator key in .data/:
//   1. calls fund_rewards(source "sponsor", receipt_id "faucet-<account>") from
//      each faucet account, so the NEAR enters the treasury the proper way
//      (never a plain transfer), and
//   2. deletes the faucet account with the operator as beneficiary, so the
//      gas reserve left over returns to the operator.
// A rerun is safe: a recorded receipt id is refused by the contract and a
// deleted account is skipped.
//
//   node scripts/faucet-to-treasury-testnet.mjs                  # status, sends nothing
//   node scripts/faucet-to-treasury-testnet.mjs create <n>       # n new faucet accounts (10 NEAR each)
//   node scripts/faucet-to-treasury-testnet.mjs sweep [--dry-run]
//
// Account list: scripts/data/faucet-accounts-testnet.txt (one id per line,
// no keys). Public record: public/faucet-treasury-testnet.json.
import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
import { fundingAttachment, fundingAlreadyRecorded } from "../server/native/stnear-treasury.mjs";

const [command = "status", ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run");
const TGAS = 10n ** 12n,
  NEAR = 10n ** 24n,
  // fund_rewards attaches the sponsor storage fee on top of the amount, so the
  // reserve covers that fee plus gas; the rest returns via delete.
  GAS_RESERVE = NEAR / 10n;
const near = (y) => (Number(BigInt(y)) / 1e24).toFixed(6);
const log = (o) => console.log(JSON.stringify(o));

const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
assert.equal(operator.network, "testnet", "Testnet only.");
assert.equal(statSync(operatorPath).mode & 0o077, 0, "Operator key file must be private (chmod 600).");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet RPC only.");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  operatorPublicKey = KeyPair.fromString(operator.secretKey).getPublicKey().toString(),
  rewardsId = process.env.NEAR_REWARDS_ACCOUNT || JSON.parse(readFileSync("public/native-rewards-testnet.json", "utf8")).contractId;
assert.ok(rewardsId.endsWith(".testnet"));

const listPath = "scripts/data/faucet-accounts-testnet.txt";
const listed = () =>
  existsSync(listPath)
    ? readFileSync(listPath, "utf8")
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("#"))
    : [];
const recordPath = "public/faucet-treasury-testnet.json";
const record = existsSync(recordPath)
  ? JSON.parse(readFileSync(recordPath, "utf8"))
  : { network: "testnet", rewardsContract: rewardsId, beneficiary: operator.accountId, receiptPrefix: "faucet-", sweeps: [] };
const save = () => {
  record.updatedAt = new Date().toISOString();
  record.totalFunded = near(record.sweeps.reduce((s, e) => s + BigInt(e.funded || 0), 0n));
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
};
const accountOf = async (account_id) => {
  try {
    return await provider.query({ request_type: "view_account", account_id, finality: "final" });
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(rpcErrorText(e))) return null;
    throw e;
  }
};
const txOf = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failed = (r) => Boolean(r?.status?.Failure) || (r?.receipts_outcome || []).some((o) => o.outcome?.status?.Failure);

if (command === "create") {
  const n = Number(rest[0] || 1);
  assert.ok(Number.isInteger(n) && n > 0 && n <= 50, "create <1..50>");
  for (let i = 0; i < n; i++) {
    const id = `ql-faucet-${Math.floor(Date.now() / 1000)}-${i}.testnet`;
    const r = await fetch("https://helper.testnet.near.org/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newAccountId: id, newAccountPublicKey: operatorPublicKey }),
      signal: AbortSignal.timeout(40000),
    });
    log({ create: id, status: r.status });
    if (!r.ok) break;
    appendFileSync(listPath, id + "\n");
    await new Promise((res) => setTimeout(res, 2000));
  }
  process.exit(0);
}

let total = 0n;
for (const id of listed()) {
  const acc = await accountOf(id);
  const done = record.sweeps.find((e) => e.account === id && e.deleteTransaction);
  if (command === "status" || !acc) {
    log({ account: id, balance: acc ? near(acc.amount) : "deleted", swept: Boolean(done) });
    if (acc) total += BigInt(acc.amount);
    continue;
  }
  assert.equal(command, "sweep", "Unknown command: " + command);
  const keys = await provider.query({ request_type: "view_access_key_list", account_id: id, finality: "final" });
  if (!keys.keys.some((k) => k.public_key === operatorPublicKey)) {
    log({ account: id, skipped: "not keyed with the operator key" });
    continue;
  }
  const amount = BigInt(acc.amount) - GAS_RESERVE;
  if (dryRun) {
    log({ account: id, wouldFund: near(amount), thenDeleteTo: operator.accountId });
    continue;
  }
  const from = new Account(id, provider, signer);
  let entry = record.sweeps.find((e) => e.account === id);
  if (!entry) record.sweeps.push((entry = { account: id, receiptId: `faucet-${id.replace(/\.testnet$/, "")}`.slice(0, 64) }));
  if (!entry.fundTransaction && amount > NEAR / 10n) {
    try {
      const r = await from.signAndSendTransaction({
        receiverId: rewardsId,
        actions: [actions.functionCall("fund_rewards", { source: "sponsor", receipt_id: entry.receiptId }, 50n * TGAS, fundingAttachment(amount))],
        waitUntil: "FINAL",
      });
      if (failed(r)) {
        assert.ok(fundingAlreadyRecorded(r.status), "fund_rewards failed: " + JSON.stringify(r.status));
        entry.fundTransaction = "already-funded";
      } else {
        entry.fundTransaction = txOf(r);
        entry.funded = amount.toString();
      }
    } catch (error) {
      if (!fundingAlreadyRecorded(error)) throw error;
      entry.fundTransaction = "already-funded";
    }
    save();
    log({ account: id, funded: near(amount), transaction: entry.fundTransaction });
  }
  const r = await from.signAndSendTransaction({ receiverId: id, actions: [actions.deleteAccount(operator.accountId)], waitUntil: "FINAL" });
  // The gas refund to the deleted account always fails; only the transaction status counts.
  assert.ok(!r?.status?.Failure, "delete failed: " + JSON.stringify(r.status));
  entry.deleteTransaction = txOf(r);
  entry.finishedAt = new Date().toISOString();
  save();
  log({ account: id, deleted: true, beneficiary: operator.accountId, transaction: entry.deleteTransaction });
}
if (command === "status") log({ faucetAccounts: listed().length, unsweptBalance: near(total), rewardsContract: rewardsId, totalFunded: record.totalFunded || "0" });

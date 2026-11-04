// Treasury fee on the game's NEAR Intents verifier (testnet), Mac side.
// Lubos 4 Nov 2026: every P2P trade pays 2 % into the treasury, which funds
// more map rewards (docs/ONCHAIN-TRADES.md, "Trade fee to the treasury").
//
// The verifier (near/intents defuse v0.4.5) takes its fee from the buyer's
// wNEAR leg only (NFT legs pay nothing) and credits it to its fee collector,
// which is the operator account. This script turns the fee on and sweeps what
// was collected into the global prize pool:
//
//   node scripts/intents-fees-testnet.mjs                  # status, sends nothing
//   node scripts/intents-fees-testnet.mjs set-fee          # fee -> 2 % (20,000 pips)
//   node scripts/intents-fees-testnet.mjs sweep --dry-run  # what a sweep would do
//   node scripts/intents-fees-testnet.mjs sweep            # verifier -> NEAR -> fund_rewards
//
// The sweep moves only what the operator's verifier balance gained since the
// fee went on (the baseline in .data/intents-fees.json), so the operator's own
// test wNEAR from the proof trades never ends up in the prize pool. Each step
// is recorded before the next one, so a rerun continues where it stopped.
import { readFileSync, writeFileSync, statSync, existsSync, renameSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import { TREASURY_FEE_PIPS, nep141 } from "../server/native/intents.mjs";
import { fundingAttachment, fundingAlreadyRecorded } from "../server/native/stnear-treasury.mjs";

const [command = "status", ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run");
const TGAS = 10n ** 12n,
  NEAR = 10n ** 24n,
  MIN_SWEEP = 10n ** 22n; // 0.01 NEAR
const near = (y) => (Number(BigInt(y)) / 1e24).toFixed(6);
const log = (o) => console.log(JSON.stringify(o));

const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath));
assert.equal(operator.network, "testnet", "Testnet only");
assert.equal(statSync(operatorPath).mode & 0o077, 0, "Operator key file must be private (chmod 600)");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet only");

const manifestPath = "public/native-intents-testnet.json";
const manifest = JSON.parse(readFileSync(manifestPath));
const verifierId = manifest.verifierContract,
  wnear = manifest.wnear;
const rewardsId = process.env.NEAR_REWARDS_ACCOUNT || "questlayer-rewards-20261101b.testnet";
const account = new Account(operator.accountId, provider, KeyPairSigner.fromSecretKey(operator.secretKey));

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
const txOf = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failed = (r) =>
  Boolean(r?.status?.Failure) || (r?.receipts_outcome || []).some((o) => o.outcome?.status?.Failure);
async function call(label, receiverId, method, args, deposit, gas = 100n * TGAS) {
  const r = await account.signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(method, args, gas, deposit)],
    waitUntil: "FINAL",
  });
  assert.ok(!failed(r), `${label} failed: ${JSON.stringify(r.status)}`);
  log({ step: label, transaction: txOf(r) });
  return r;
}

const statePath = ".data/intents-fees.json",
  recordPath = "public/native-intents-fees-testnet.json";
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath))
  : { network: "testnet", verifier: verifierId, collector: operator.accountId, baseline: null, sweeps: [] };
assert.equal(state.verifier, verifierId, "State file belongs to another verifier.");
function save() {
  const tmp = statePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, statePath);
  // Public record (no keys) for the economy page.
  writeFileSync(
    recordPath,
    JSON.stringify(
      {
        network: "testnet",
        verifier: verifierId,
        feePips: state.feePips ?? null,
        collector: state.collector,
        rewardsContract: rewardsId,
        receiptPrefix: "intents-fees-",
        sweeps: state.sweeps,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
}

const [fee, collector] = await Promise.all([view(verifierId, "fee"), view(verifierId, "fee_collector")]);
assert.equal(collector, operator.accountId, "The verifier's fee collector must be the operator account.");
const collected = BigInt(await view(verifierId, "mt_balance_of", { account_id: collector, token_id: nep141(wnear) }));
const baseline = state.baseline === null ? null : BigInt(state.baseline);
const sweepable = baseline === null ? 0n : collected > baseline ? collected - baseline : 0n;
log({ verifier: verifierId, feePips: fee, feePercent: fee / 10_000, collector, collectorWnear: near(collected), baseline: baseline === null ? null : near(baseline), sweepable: near(sweepable) });

if (command === "status") process.exit(0);

if (command === "set-fee") {
  const target = Number(rest.find((a) => /^\d+$/.test(a)) ?? TREASURY_FEE_PIPS);
  assert.ok(Number.isSafeInteger(target) && target >= 0 && target <= 50_000, "Keep the fee between 0 and 5 %.");
  if (fee !== target) {
    if (dryRun) {
      log({ dryRun: true, wouldSetFee: target });
      process.exit(0);
    }
    const r = await call(`Set the verifier fee to ${target / 10_000} % (treasury)`, verifierId, "set_fee", { fee: target }, 1n, 30n * TGAS);
    manifest.fee = target;
    manifest.feeCollector = collector;
    manifest.transactions = [...(manifest.transactions || []), { label: `Set the verifier fee to ${target / 10_000} % (paid to the treasury)`, transaction: txOf(r) }];
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  // From now on, only what the collector gains is a fee.
  if (state.baseline === null) state.baseline = collected.toString();
  state.feePips = target;
  save();
  log({ step: "Fee on", feePips: target, baseline: near(collected), next: "commit public/native-intents-testnet.json and deploy the VPS" });
  process.exit(0);
}

if (command === "sweep") {
  assert.ok(state.baseline !== null, "Run set-fee first.");
  const date = new Date().toISOString().slice(0, 10);
  let entry = state.sweeps.find((s) => s.receiptId === `intents-fees-${date}` && !s.fundTransaction);
  if (!entry) {
    if (sweepable < MIN_SWEEP) {
      log({ step: "Nothing to sweep", sweepable: near(sweepable), minimum: near(MIN_SWEEP) });
      process.exit(0);
    }
    assert.ok(!state.sweeps.some((s) => s.receiptId === `intents-fees-${date}`), "Already swept today.");
    entry = { receiptId: `intents-fees-${date}`, amount: sweepable.toString(), startedAt: new Date().toISOString() };
    if (dryRun) {
      log({ dryRun: true, wouldSweep: near(sweepable), receiptId: entry.receiptId, rewardsContract: rewardsId });
      process.exit(0);
    }
    state.sweeps.push(entry);
    save();
  }
  const amount = BigInt(entry.amount);
  if (!entry.withdrawTransaction) {
    // If the collector no longer holds this sweep above the baseline, an
    // earlier run may have withdrawn it without saving: check the explorer.
    assert.ok(sweepable >= amount, `Collected fees (${near(sweepable)}) no longer cover this sweep (${near(amount)}). Check the last ft_withdraw on the explorer before continuing.`);
    const r = await call("Withdraw collected fees from the verifier", verifierId, "ft_withdraw", { token: wnear, receiver_id: collector, amount: amount.toString(), memo: "questlayer treasury fee", msg: null }, 1n);
    entry.withdrawTransaction = txOf(r);
    save();
  }
  if (!entry.unwrapTransaction) {
    const r = await call("Unwrap wNEAR", wnear, "near_withdraw", { amount: amount.toString() }, 1n, 30n * TGAS);
    entry.unwrapTransaction = txOf(r);
    save();
  }
  let r, already = false;
  try {
    r = await account.signAndSendTransaction({
      receiverId: rewardsId,
      actions: [actions.functionCall("fund_rewards", { source: "sponsor", receipt_id: entry.receiptId }, 50n * TGAS, fundingAttachment(amount))],
      waitUntil: "FINAL",
    });
  } catch (error) {
    if (!fundingAlreadyRecorded(error)) throw error;
    already = true;
  }
  if (r && failed(r) && fundingAlreadyRecorded(r.status)) already = true;
  assert.ok(already || !failed(r), "fund_rewards failed: " + JSON.stringify(r?.status));
  entry.fundTransaction = already ? "already-funded" : txOf(r);
  entry.rewardsContract = rewardsId;
  entry.finishedAt = new Date().toISOString();
  save();
  log({ step: "Fees in the prize pool", amount: near(amount), receiptId: entry.receiptId, transaction: entry.fundTransaction });
  process.exit(0);
}

throw new Error(`Unknown command ${command}. Use status, set-fee or sweep.`);

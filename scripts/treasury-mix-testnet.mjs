// Treasury mix, Mac side (docs/TREASURY-MIX.md). Runs with the operator key in
// .data/near-operator.json, testnet only.
//
//   node scripts/treasury-mix-testnet.mjs status              # live mix, targets and the next run's plan
//   node scripts/treasury-mix-testnet.mjs rebalance --dry-run # what a run would do
//   node scripts/treasury-mix-testnet.mjs rebalance           # move at most 25 % of the treasury toward 50/40/10
//   node scripts/treasury-mix-testnet.mjs keep [--dry-run]    # vault keeper: supply stables to Rhea, harvest their interest
//
// State: .data/treasury-mix.json (private). Public record without keys:
// public/treasury-mix-testnet.json, shown at GET /api/treasury/mix and /economy.
// Selling or buying stNEAR also updates the stNEAR treasury principal in
// .data/stnear-treasury.json, so the daily stNEAR harvest still sells only growth.
//
// Swaps: testnet Ref pools hold made-up prices (one wNEAR/USDC pool says 35 000
// USDC per NEAR), so on testnet the NEAR <-> stablecoin leg is a recorded
// stand-in: the operator mints the test stablecoin at the Pyth price and keeps
// the NEAR as the counterparty would. Every stand-in is marked `route:
// "testnet-mint"` in the public record. Mainnet needs a real route (Ref with an
// oracle guard, or Intents 1Click) and Lubos's go.
import { readFileSync, writeFileSync, statSync, existsSync, renameSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import { mixSettings, readMix, unitsFor, valueIn, pendingYield } from "../server/native/treasury-mix.mjs";
import { quoteSell, fundingAttachment, fundingAlreadyRecorded } from "../server/native/stnear-treasury.mjs";
import { readDao, adoptedMix, dailyRun, sameTargets, utcDate } from "../server/native/treasury-dao.mjs";

const [command = "status", ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run");

const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath));
assert.equal(operator.network, "testnet", "Testnet only");
assert.equal(statSync(operatorPath).mode & 0o077, 0, "Operator key file must be private (chmod 600)");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");

const settings = mixSettings({ ...process.env, TREASURY_MIX_ACCOUNT: operator.accountId }, "testnet");
assert(settings.enabled && !settings.policyError, "Treasury mix settings are invalid.");
const rewardsId = process.env.NEAR_REWARDS_ACCOUNT || "questlayer-rewards-20261101b.testnet";
const account = new Account(operator.accountId, provider, KeyPairSigner.fromSecretKey(operator.secretKey));
const asset = (id) => settings.assets.find((a) => a.id === id);

// Treasury DAO (docs/TREASURY-DAO.md): once the DAO exists, the target is the
// mix the DAO adopted and a run happens only on a day whose run the DAO approved.
const daoManifestPath = process.env.TREASURY_DAO_MANIFEST || "public/native-treasury-dao-testnet.json";
const dao = existsSync(daoManifestPath) ? await readDao(provider, JSON.parse(readFileSync(daoManifestPath)).contractId) : null;
if (dao?.exists) {
  const adopted = adoptedMix(dao.proposals);
  if (adopted) settings.target = adopted.targets;
  console.log(JSON.stringify({ dao: dao.daoId, adoptedMix: adopted && { proposal: adopted.proposalId, option: adopted.option, target: adopted.targets } }));
}
function daoAllowsRun() {
  if (!dao) return true;
  assert(dao.exists, `The treasury DAO ${dao.daoId} is in the manifest but does not exist.`);
  const run = dailyRun(dao.proposals, utcDate(Date.now()));
  if (!run || run.status !== "Approved") {
    console.log(JSON.stringify({ skipped: "rebalance", reason: run ? `today's DAO run is ${run.status}` : "no DAO run filed today (scripts/treasury-dao-testnet.mjs daily)" }));
    return false;
  }
  assert(sameTargets(run.meta.target, settings.target), "Today's approved DAO run has another target than the adopted mix.");
  return true;
}

const statePath = ".data/treasury-mix.json",
  recordPath = "public/treasury-mix-testnet.json",
  stnearPath = ".data/stnear-treasury.json";
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath))
  : { network: "testnet", account: operator.accountId, runs: [], stableYield: [], standIn: { nearHeld: "0" } };
assert.equal(state.account, operator.accountId, "State file belongs to another treasury account.");

const TGAS = 10n ** 12n;
const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);
const txOf = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failed = (r) => r.status?.Failure || r.receipts_outcome?.some((o) => o.outcome.status?.Failure);
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

function save() {
  const tmp = statePath + ".tmp";
  writeFileSync(tmp, json(state), { mode: 0o600 });
  renameSync(tmp, statePath);
  const record = {
    network: "testnet",
    account: state.account,
    vault: settings.vault,
    rewardsContract: rewardsId,
    policy: { target: settings.target, maxProtocolBps: settings.maxProtocolBps, maxUtilBps: settings.maxUtilBps, maxMoveBps: settings.maxMoveBps },
    standIn: state.standIn,
    runs: state.runs.slice(-30),
    stableYield: state.stableYield.slice(-30),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(recordPath, JSON.stringify(JSON.parse(json(record)), null, 2) + "\n");
  if (process.env.TREASURY_MIX_RECORD_PUSH === "1") {
    const host = process.env.DEPLOY_HOST || "root@72.61.188.39";
    try {
      execFileSync("scp", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", recordPath, `${host}:/var/lib/questlayer-hackathon/treasury-mix-testnet.json`], { stdio: "ignore" });
    } catch {
      console.error("note: could not copy the public record to the VPS; the next deploy carries it.");
    }
  }
}

// The stNEAR harvest sells growth above its principal; moving stNEAR in or out
// of the treasury mix must move that principal too, or the harvest would
// either never run (principal too high) or sell capital (too low).
function adjustStnearPrincipal(delta, entry) {
  if (!existsSync(stnearPath)) return;
  const st = JSON.parse(readFileSync(stnearPath));
  const next = BigInt(st.principal) + delta;
  st.principal = (next > 0n ? next : 0n).toString();
  (delta < 0n ? st.withdrawals : st.deposits).push({ ...entry, reason: "treasury-mix" });
  const tmp = stnearPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(st, null, 2), { mode: 0o600 });
  renameSync(tmp, stnearPath);
}

async function call(receiverId, method, args, gasT, deposit = 0n) {
  const r = await account.signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(method, args, BigInt(gasT) * TGAS, deposit)],
    waitUntil: "FINAL",
  });
  assert(!failed(r), `${receiverId}.${method} failed: ${JSON.stringify(r.status)}`);
  return r;
}

async function balanceOf(token) {
  const r = await provider.query({
    request_type: "call_function",
    account_id: token,
    method_name: "ft_balance_of",
    args_base64: Buffer.from(JSON.stringify({ account_id: operator.accountId })).toString("base64"),
    finality: "final",
  });
  return BigInt(JSON.parse(Buffer.from(r.result).toString()));
}

async function ensureStorage(token) {
  const r = await provider.query({
    request_type: "call_function",
    account_id: token,
    method_name: "storage_balance_of",
    args_base64: Buffer.from(JSON.stringify({ account_id: operator.accountId })).toString("base64"),
    finality: "final",
  });
  if (JSON.parse(Buffer.from(r.result).toString())) return;
  await call(token, "storage_deposit", { account_id: operator.accountId, registration_only: true }, 30, 1_250_000_000_000_000_000_000n);
}

function summary(live) {
  return {
    totalNear: near(live.plan.total),
    buckets: live.plan.buckets.map((b) => ({ bucket: b.bucket, now: `${b.currentBps / 100} %`, target: `${b.targetBps / 100} %`, valueNear: near(b.current) })),
    holdings: live.holdings.filter((h) => h.value > 0n).map((h) => ({ id: h.id, wallet: h.wallet.toString(), vault: h.vault.toString(), valueNear: near(h.value) })),
    exposure: live.exposure.map((e) => ({ protocol: e.protocol, share: `${e.bps / 100} %`, overCap: e.overCap })),
    stalePrices: live.prices.stale.map((p) => p.id),
    next: { action: live.plan.action, reason: live.plan.reason, steps: live.plan.steps.map((s) => `${s.op} ${s.asset} ${near(s.value)} NEAR`), notes: live.plan.notes },
  };
}

const read = () => readMix(provider, settings, { account: operator.accountId, record: state });

if (command === "status") {
  console.log(JSON.stringify(summary(await read()), null, 2));
} else if (command === "rebalance") {
  const live = await read();
  console.log(JSON.stringify({ dryRun, ...summary(live) }, null, 2));
  if (live.plan.action !== "rebalance" || dryRun) process.exit(0);
  if (!daoAllowsRun()) process.exit(0);
  // One run a day: the VPS retries `rebalance` during the day in case the DAO
  // approves later, and a second run must not move another 25 %.
  const today = utcDate(Date.now());
  if (state.runs.some((r) => r.at?.slice(0, 10) === today)) {
    console.log(JSON.stringify({ skipped: "rebalance", reason: `already ran on ${today}` }));
    process.exit(0);
  }
  await rebalance(live);
} else if (command === "keep") {
  await keep();
} else {
  console.error("Commands: status | rebalance [--dry-run] | keep [--dry-run]");
  process.exit(2);
}

async function rebalance(live) {
  const run = { at: new Date().toISOString(), before: live.plan.buckets, steps: [], notes: live.plan.notes };
  state.runs.push(run);
  let cash = 0n; // NEAR freed by this run; sinks spend only this.
  let bought = {}; // token units acquired this run, per stable, for deposit-vault
  const done = (entry) => {
    run.steps.push(entry);
    save();
    console.log(json(entry));
  };
  for (const step of live.plan.steps) {
    const a = asset(step.asset);
    try {
      if (step.op === "sell-lst") {
        assert(a.id === "stnear", "Only stNEAR has an instant exit wired here.");
        const shares = unitsFor(a, step.value, live.prices);
        const quote = await quoteSell(provider, a.token, shares);
        const gross = valueIn(a, shares, live.prices);
        assert(quote * 10_000n >= gross * 9_900n, `Instant-exit fee above 1 % (quote ${near(quote)} for ${near(gross)}).`);
        const before = (await provider.viewAccount({ accountId: operator.accountId })).amount;
        const r = await call(a.token, "liquid_unstake", { st_near_to_burn: shares.toString(), min_expected_near: ((quote * 9_950n) / 10_000n).toString() }, 100);
        let received;
        try {
          received = BigInt(JSON.parse(Buffer.from(r.status.SuccessValue, "base64").toString()).near);
        } catch {
          received = BigInt((await provider.viewAccount({ accountId: operator.accountId })).amount) - BigInt(before);
        }
        cash += received;
        adjustStnearPrincipal(-gross, { at: new Date().toISOString(), near: gross.toString(), stnear: shares.toString(), received: received.toString(), transaction: txOf(r) });
        done({ op: step.op, asset: a.id, value: gross, units: shares, received, transaction: txOf(r) });
      } else if (step.op === "withdraw-vault") {
        const units = a.bucket === "lst" ? step.value : unitsFor(a, step.value, live.prices);
        const r = await call(settings.vault, "withdraw", { token_id: a.token, amount: units.toString() }, 100, 1n);
        done({ op: step.op, asset: a.id, value: step.value, units, transaction: txOf(r) });
      } else if (step.op === "unwrap") {
        const r = await call(a.token, "near_withdraw", { amount: step.value.toString() }, 30, 1n);
        cash += step.value;
        done({ op: step.op, asset: a.id, value: step.value, transaction: txOf(r) });
      } else if (step.op === "sell-stable") {
        // Stand-in counterparty: burns the test stablecoin and hands back NEAR
        // it took in earlier stand-in buys, never more.
        const held = BigInt(state.standIn.nearHeld);
        const value = step.value < held ? step.value : held;
        assert(value > 0n, "No stand-in NEAR to sell stablecoins against.");
        const units = unitsFor(a, value, live.prices);
        const r = await call(a.token, "burn", { account_id: operator.accountId, amount: units.toString() }, 30);
        state.standIn.nearHeld = (held - value).toString();
        cash += value;
        done({ op: step.op, asset: a.id, value, units, route: "testnet-mint", transaction: txOf(r) });
      } else if (step.op === "buy-stable") {
        const spend = step.value < cash ? step.value : cash;
        assert(spend > 0n, "Nothing freed to buy with.");
        const units = unitsFor(a, spend, live.prices);
        const before = await balanceOf(a.token);
        const r = await call(a.token, "mint", { account_id: operator.accountId, amount: units.toString() }, 30);
        const got = (await balanceOf(a.token)) - before;
        assert(got === units, `Mint gave ${got}, expected ${units}.`);
        cash -= spend;
        state.standIn.nearHeld = (BigInt(state.standIn.nearHeld) + spend).toString();
        bought[a.id] = (bought[a.id] || 0n) + units;
        done({ op: step.op, asset: a.id, value: spend, units, route: "testnet-mint", priceNearUsdE8: live.prices.usd.near, transaction: txOf(r) });
      } else if (step.op === "deposit-vault") {
        const units = bought[a.id] || 0n;
        assert(units > 0n, "Nothing bought to deposit.");
        const r = await call(a.token, "ft_transfer_call", { receiver_id: settings.vault, amount: units.toString(), msg: "deposit" }, 150, 1n);
        bought[a.id] = 0n;
        // Keeper: supply what is above the 20 % buffer to Rhea Lend (skipped by
        // the vault itself when the market is at or above 95 % utilization).
        let supply = null;
        try {
          supply = txOf(await call(settings.vault, "rebalance", { token_id: a.token }, 250));
        } catch (e) {
          console.error("note: rebalance after deposit failed; `keep` retries it.", String(e.message || e).slice(0, 200));
        }
        done({ op: step.op, asset: a.id, value: valueIn(a, units, live.prices), units, transaction: txOf(r), supplyTransaction: supply });
      } else if (step.op === "stake-lst") {
        const spend = step.value < cash ? step.value : cash;
        assert(spend >= a.minStake, "Below the minimum stake.");
        const r = await call(a.token, "deposit_and_stake", {}, 50, spend);
        cash -= spend;
        if (a.id === "stnear") adjustStnearPrincipal(spend, { at: new Date().toISOString(), near: spend.toString(), stnear: unitsFor(a, spend, live.prices).toString(), transaction: txOf(r) });
        done({ op: step.op, asset: a.id, value: spend, transaction: txOf(r) });
      } else if (step.op === "wrap") {
        const spend = step.value < cash ? step.value : cash;
        if (spend <= 0n) continue;
        await ensureStorage(a.token);
        const r = await call(a.token, "near_deposit", {}, 30, spend);
        cash -= spend;
        done({ op: step.op, asset: a.id, value: spend, transaction: txOf(r) });
      }
    } catch (e) {
      done({ op: step.op, asset: a.id, value: step.value, error: String(e.message || e).slice(0, 300) });
      // Park whatever this run freed in the reserve rather than leave it in the gas wallet.
      break;
    }
  }
  if (cash > 0n) {
    try {
      await ensureStorage("wrap.testnet");
      const r = await call("wrap.testnet", "near_deposit", {}, 30, cash);
      done({ op: "wrap", asset: "wnear", value: cash, transaction: txOf(r), note: "leftover from this run" });
      cash = 0n;
    } catch (e) {
      done({ op: "wrap", asset: "wnear", value: cash, error: String(e.message || e).slice(0, 300) });
    }
  }
  const after = await read();
  run.after = after.plan.buckets;
  save();
  console.log(JSON.stringify(summary(after), null, 2));
}

// Keeper for our stable positions: supply idle tokens to Rhea, harvest the
// interest (the vault pays it to the treasury, i.e. this wallet), then send
// it to the prize pool as a sponsor receipt `stable-yield-<date>`.
async function keep() {
  const date = new Date().toISOString().slice(0, 10);
  const live = await read();
  for (const h of live.holdings.filter((x) => x.bucket === "stable" && x.vault > 0n)) {
    const a = asset(h.id);
    console.log(json({ token: a.token, vaultPrincipal: h.vault, dryRun }));
    if (dryRun) continue;
    try {
      console.log(json({ rebalance: txOf(await call(settings.vault, "rebalance", { token_id: a.token }, 250)) }));
    } catch (e) {
      console.error("rebalance:", String(e.message || e).slice(0, 200));
    }
    const before = await balanceOf(a.token);
    try {
      const r = await call(settings.vault, "harvest", { token_id: a.token }, 100);
      const got = (await balanceOf(a.token)) - before;
      if (got > 0n) {
        state.stableYield.push({ date, asset: a.id, amount: got.toString(), harvestTransaction: txOf(r), fundTransaction: null });
        save();
      }
      console.log(json({ harvest: txOf(r), received: got }));
    } catch (e) {
      console.error("harvest:", String(e.message || e).slice(0, 200));
    }
  }
  if (dryRun) return;
  // Fund the prize pool with pending stable yield once it is worth 0.01 NEAR.
  const pend = pendingYield(state);
  let value = 0n;
  for (const [id, units] of Object.entries(pend)) value += valueIn(asset(id), units, live.prices);
  if (value < 10n ** 22n) {
    console.log(json({ stableYieldPendingNear: near(value), note: "below 0.01 NEAR, waits" }));
    return;
  }
  // Testnet stand-in sale: burn the yield tokens, pay their NEAR value out of
  // the stand-in counterparty balance, never beyond it.
  const held = BigInt(state.standIn.nearHeld);
  assert(value <= held, "Stand-in counterparty holds less NEAR than the yield is worth.");
  for (const [id, units] of Object.entries(pend)) await call(asset(id).token, "burn", { account_id: operator.accountId, amount: units.toString() }, 30);
  state.standIn.nearHeld = (held - value).toString();
  const receiptId = `stable-yield-${date}`;
  let tx;
  try {
    tx = txOf(await call(rewardsId, "fund_rewards", { source: "sponsor", receipt_id: receiptId }, 50, fundingAttachment(value)));
  } catch (e) {
    if (!fundingAlreadyRecorded(e)) throw e;
    tx = "already-funded";
  }
  for (const y of state.stableYield.filter((x) => !x.fundTransaction)) Object.assign(y, { fundTransaction: tx, receiptId, route: "testnet-mint" });
  save();
  console.log(json({ funded: near(value), receiptId, transaction: tx }));
}

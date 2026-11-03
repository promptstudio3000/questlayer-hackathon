// Game treasury in stNEAR, Mac side (docs/STNEAR-TREASURY.md). Runs with the
// operator key in .data/near-operator.json, testnet only.
//
//   node scripts/stnear-treasury-testnet.mjs status
//   node scripts/stnear-treasury-testnet.mjs deposit 3          # stake 3 NEAR into stNEAR
//   node scripts/stnear-treasury-testnet.mjs harvest --dry-run  # what today's harvest would do
//   node scripts/stnear-treasury-testnet.mjs harvest            # sell only the growth, fund rewards
//   node scripts/stnear-treasury-testnet.mjs withdraw 1         # take 1 NEAR of principal back out
//
// State (principal, done receipts) lives in .data/stnear-treasury.json. A
// public record without keys goes to public/stnear-treasury-testnet.json so
// the server can show it at GET /api/treasury/stnear.
import {
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  renameSync,
} from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import {
  treasurySettings,
  readTreasury,
  quoteSell,
  planHarvest,
  fundingAttachment,
  sharesFor,
  YOCTO,
} from "../server/native/stnear-treasury.mjs";

const [command = "status", ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run");
const dateArg = rest.find((a) => /^--date=/.test(a));
const amountArg = rest.find((a) => /^\d+(\.\d+)?$/.test(a));

const operatorPath =
  process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath));
assert.equal(operator.network, "testnet", "Testnet only");
assert.equal(
  statSync(operatorPath).mode & 0o077,
  0,
  "Operator key file must be private (chmod 600)",
);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");

const settings = treasurySettings(
  {
    ...process.env,
    STNEAR_TREASURY_ACCOUNT:
      process.env.STNEAR_TREASURY_ACCOUNT || operator.accountId,
  },
  "testnet",
);
assert.equal(
  settings.account,
  operator.accountId,
  "The treasury account must be the operator account whose key is here.",
);
const rewardsId =
  process.env.NEAR_REWARDS_ACCOUNT || "questlayer-rewards-20261101b.testnet";
const account = new Account(
  operator.accountId,
  provider,
  KeyPairSigner.fromSecretKey(operator.secretKey),
);

const statePath = ".data/stnear-treasury.json",
  recordPath = "public/stnear-treasury-testnet.json";
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath))
  : {
      network: "testnet",
      account: settings.account,
      contract: settings.contract,
      principal: "0",
      deposits: [],
      harvests: [],
      withdrawals: [],
    };
assert.equal(
  state.account,
  settings.account,
  "State file belongs to another treasury account.",
);

function save() {
  const tmp = statePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, statePath);
  writeFileSync(
    recordPath,
    JSON.stringify(
      {
        network: "testnet",
        account: state.account,
        contract: state.contract,
        rewardsContract: rewardsId,
        receiptPrefix: "stnear-yield-",
        principal: state.principal,
        deposits: state.deposits,
        harvests: state.harvests,
        withdrawals: state.withdrawals,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  // Optional: copy the public record to the VPS state directory so
  // /api/treasury/stnear shows today's harvest without a redeploy.
  if (process.env.STNEAR_RECORD_PUSH === "1") {
    const host = process.env.DEPLOY_HOST || "root@72.61.188.39";
    try {
      execFileSync(
        "scp",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=15",
          recordPath,
          `${host}:/var/lib/questlayer-hackathon/stnear-treasury-testnet.json`,
        ],
        { stdio: "ignore" },
      );
    } catch {
      console.error(
        "note: could not copy the public record to the VPS; the next deploy carries it.",
      );
    }
  }
}

const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);
const yocto = (n) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n;
const txOf = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failed = (r) =>
  r.status?.Failure ||
  r.receipts_outcome?.some((o) => o.outcome.status?.Failure);

async function status() {
  const live = await readTreasury(provider, settings);
  const principal = BigInt(state.principal);
  const { amount } = await provider.viewAccount({
    accountId: settings.account,
  });
  console.log(
    JSON.stringify(
      {
        account: settings.account,
        contract: settings.contract,
        stnear: near(live.balance),
        price: near(live.price),
        valueNear: near(live.value),
        principalNear: near(principal),
        growthNear: near(live.value > principal ? live.value - principal : 0n),
        liquidNear: near(amount),
        harvests: state.harvests.length,
      },
      null,
      2,
    ),
  );
  return live;
}

if (command === "status") {
  await status();
} else if (command === "deposit") {
  assert(amountArg, "Usage: deposit <NEAR>");
  const amount = yocto(amountArg);
  assert(amount >= YOCTO, "Meta Pool needs at least 1 NEAR per deposit.");
  const before = await readTreasury(provider, settings);
  if (dryRun) {
    console.log(
      JSON.stringify({
        dryRun: true,
        deposit: near(amount),
        expectStnear: near(sharesFor(amount, before.price)),
      }),
    );
    process.exit(0);
  }
  const r = await account.signAndSendTransaction({
    receiverId: settings.contract,
    actions: [
      actions.functionCall("deposit_and_stake", {}, 50n * 10n ** 12n, amount),
    ],
    waitUntil: "FINAL",
  });
  assert(!failed(r), "deposit_and_stake failed: " + JSON.stringify(r.status));
  const after = await readTreasury(provider, settings);
  // Principal grows by what the deposit is worth in stNEAR now, which is the NEAR put in.
  const added = after.value - before.value;
  state.principal = (
    BigInt(state.principal) + (added > 0n && added <= amount ? added : amount)
  ).toString();
  state.deposits.push({
    at: new Date().toISOString(),
    near: amount.toString(),
    stnear: (after.balance - before.balance).toString(),
    transaction: txOf(r),
  });
  save();
  console.log(
    JSON.stringify({ deposited: near(amount), transaction: txOf(r) }),
  );
  await status();
} else if (command === "withdraw") {
  // Takes principal back out to NEAR (instant exit). Lowers the principal by
  // the NEAR value sold, so the next harvest still sells only growth.
  assert(amountArg, "Usage: withdraw <NEAR>");
  const live = await readTreasury(provider, settings);
  const amount = yocto(amountArg);
  assert(amount <= BigInt(state.principal), "That is more than the principal.");
  const shares = sharesFor(amount, live.price);
  const quote = await quoteSell(provider, settings.contract, shares);
  console.log(
    JSON.stringify({
      sellStnear: near(shares),
      quoteNear: near(quote),
      dryRun,
    }),
  );
  if (dryRun) process.exit(0);
  const r = await liquidUnstake(shares, (quote * 9_950n) / 10_000n);
  state.principal = (BigInt(state.principal) - amount).toString();
  state.withdrawals.push({
    at: new Date().toISOString(),
    near: amount.toString(),
    stnear: shares.toString(),
    received: r.received.toString(),
    transaction: r.transaction,
  });
  save();
  await status();
} else if (command === "harvest") {
  const date = dateArg
    ? dateArg.slice(7)
    : new Date().toISOString().slice(0, 10);
  const live = await readTreasury(provider, settings);
  const rough = planHarvest({
    ...live,
    principal: BigInt(state.principal),
    settings,
    harvested: state.harvests.map((h) => h.receiptId),
    date,
  });
  const plan =
    rough.action === "harvest"
      ? planHarvest({
          ...live,
          principal: BigInt(state.principal),
          settings,
          harvested: [],
          date,
          quote: await quoteSell(provider, settings.contract, rough.sell),
        })
      : rough;
  console.log(
    JSON.stringify({
      date,
      action: plan.action,
      reason: plan.reason,
      growthNear: near(plan.growth),
      sellStnear: plan.sell != null ? near(plan.sell) : undefined,
      quoteNear: plan.quote != null ? near(plan.quote) : undefined,
      feeBps: plan.feeBps,
      receiptId: plan.receiptId,
      dryRun,
    }),
  );
  if (plan.action !== "harvest" || dryRun) process.exit(0);
  // 1) Sell only the growth.
  const sold = await liquidUnstake(plan.sell, plan.minExpected);
  // Record the sale at once: if funding fails below, the NEAR waits in the
  // operator wallet and `harvest --date=<same day>` retries only the funding.
  const entry = {
    receiptId: plan.receiptId,
    at: new Date().toISOString(),
    stnear: plan.sell.toString(),
    received: sold.received.toString(),
    unstakeTransaction: sold.transaction,
    fundTransaction: null,
  };
  state.harvests.push(entry);
  save();
  await fund(entry);
} else if (command === "fund-pending") {
  for (const entry of state.harvests.filter((h) => !h.fundTransaction))
    await fund(entry);
} else {
  console.error(
    "Commands: status | deposit <NEAR> | harvest [--dry-run] [--date=YYYY-MM-DD] | fund-pending | withdraw <NEAR>",
  );
  process.exit(2);
}

async function liquidUnstake(shares, minExpected) {
  const { amount: before } = await provider.viewAccount({
    accountId: settings.account,
  });
  const send = (deposit) =>
    account.signAndSendTransaction({
      receiverId: settings.contract,
      actions: [
        actions.functionCall(
          "liquid_unstake",
          {
            st_near_to_burn: shares.toString(),
            min_expected_near: minExpected.toString(),
          },
          100n * 10n ** 12n,
          deposit,
        ),
      ],
      waitUntil: "FINAL",
    });
  let r;
  try {
    r = await send(0n);
  } catch (e) {
    // Some Meta Pool versions require exactly 1 yocto on liquid_unstake.
    if (!/1 ?yocto|one_yocto|attached deposit/i.test(String(e?.message || e)))
      throw e;
    r = await send(1n);
  }
  assert(!failed(r), "liquid_unstake failed: " + JSON.stringify(r.status));
  // Meta Pool returns { near, fee, meta }; fall back to the balance change
  // (which is net of gas) if the shape ever differs. The contract itself
  // enforces min_expected_near.
  let received;
  try {
    received = BigInt(
      JSON.parse(Buffer.from(r.status.SuccessValue, "base64").toString()).near,
    );
  } catch {
    const { amount: after } = await provider.viewAccount({
      accountId: settings.account,
    });
    received = BigInt(after) - BigInt(before);
  }
  assert(received > 0n, "liquid_unstake paid nothing.");
  console.log(
    JSON.stringify({ liquidUnstake: txOf(r), receivedNear: near(received) }),
  );
  return { received, transaction: txOf(r) };
}

async function fund(entry) {
  const attached = fundingAttachment(BigInt(entry.received));
  const r = await account.signAndSendTransaction({
    receiverId: rewardsId,
    actions: [
      actions.functionCall(
        "fund_rewards",
        { source: "sponsor", receipt_id: entry.receiptId },
        50n * 10n ** 12n,
        attached,
      ),
    ],
    waitUntil: "FINAL",
  });
  assert(!failed(r), "fund_rewards failed: " + JSON.stringify(r.status));
  entry.fundTransaction = txOf(r);
  entry.rewardsContract = rewardsId;
  save();
  console.log(
    JSON.stringify({
      funded: near(entry.received),
      receiptId: entry.receiptId,
      transaction: entry.fundTransaction,
    }),
  );
}

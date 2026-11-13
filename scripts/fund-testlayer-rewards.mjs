// Test Layer prize pool top-up, VPS release runner (docs/TEST-LAYER.md).
//
// The Test Layer pays map coins, finds and zone prizes as Test QGOLD in payout
// rounds (MAP_PAYOUTS=1). Every round draws from its rewards contract's coin
// and zone pools, which only fund_rewards fills. This script sends test NEAR
// from the testnet operator into the Test Layer's rewards contract the proper
// way (fund_rewards, source "sponsor"), never a plain transfer, and never to
// World's contract.
//
//   node scripts/fund-testlayer-rewards.mjs             # plan: pools now, what would be sent
//   node scripts/fund-testlayer-rewards.mjs --execute   # sends FUND_NEAR (default 5, at most 8)
//
// The receipt id is fixed per amount and UTC day, so a rerun the same day is
// refused by the contract instead of paying twice.
import { readFileSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import { fundingAttachment, fundingAlreadyRecorded } from "../server/native/stnear-treasury.mjs";

const execute = process.argv.includes("--execute");
const NEAR = 10n ** 24n,
  TGAS = 10n ** 12n;
const whole = Number(process.env.FUND_NEAR || 5);
assert.ok(Number.isInteger(whole) && whole >= 1 && whole <= 8, "FUND_NEAR is a whole number from 1 to 8.");
const amount = BigInt(whole) * NEAR;
const near = (y) => (Number(BigInt(y)) / 1e24).toFixed(4);
const log = (o) => console.log(JSON.stringify(o));

const rewardsId = JSON.parse(readFileSync("public/native-rewards-testlayer.json", "utf8")).contractId;
assert.match(rewardsId, /-tl\d+\.testnet$/, "Test Layer rewards contract only.");
const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
assert.equal(operator.network, "testnet", "Testnet only.");
assert.equal(statSync(operatorPath).mode & 0o077, 0, "Operator key file must be private (chmod 600).");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet RPC only.");

const view = async (method) => {
  const r = await provider.query({ request_type: "call_function", account_id: rewardsId, method_name: method, args_base64: "e30=", finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
};
const pools = async () => {
  const t = await view("get_treasury");
  return { coinsAvailable: near(t.coins.available), zonesAvailable: near(t.zones.available), funded: near(t.funded) };
};
const balance = BigInt((await provider.query({ request_type: "view_account", account_id: operator.accountId, finality: "final" })).amount);
const receiptId = `testlayer-pool-${new Date().toISOString().slice(0, 10)}-${whole}`;
log({ rewards: rewardsId, operator: operator.accountId, operatorBalance: near(balance), send: near(amount), receiptId, before: await pools() });
assert.ok(balance > amount + NEAR, "The operator keeps at least 1 NEAR after the top-up.");
if (!execute) {
  log({ plan: "fund_rewards(sponsor) from the operator; run with --execute to send" });
  process.exit(0);
}
const account = new Account(operator.accountId, provider, KeyPairSigner.fromSecretKey(operator.secretKey));
try {
  const r = await account.signAndSendTransaction({
    receiverId: rewardsId,
    actions: [actions.functionCall("fund_rewards", { source: "sponsor", receipt_id: receiptId }, 50n * TGAS, fundingAttachment(amount))],
    waitUntil: "FINAL",
  });
  const failure = r?.status?.Failure;
  if (failure) {
    assert.ok(fundingAlreadyRecorded(failure), "fund_rewards failed: " + JSON.stringify(failure));
    log({ already: receiptId });
  } else log({ funded: near(amount), transaction: r.transaction?.hash || r.transaction_outcome?.id });
} catch (error) {
  if (!fundingAlreadyRecorded(error)) throw error;
  log({ already: receiptId });
}
log({ after: await pools() });

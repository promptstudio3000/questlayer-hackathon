// Read-only verification of existing project receipts. No secret or signer is loaded.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createNearProvider } from "../server/near-provider.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { NativeVaults } from "../server/native/vaults.mjs";
import { NativeTransactionConfirmation } from "../server/native/transaction-confirmation.mjs";
const load = (name) => JSON.parse(readFileSync(`public/${name}.json`));
const rewardsConfig = load("native-rewards-testnet"),
  marketManifest = load("native-market-testnet"),
  claimsManifest = load("native-claims-testnet");
const market = load("native-market-trades-testnet"),
  profile = load("native-profile-testnet"),
  aura = load("earned-aura-testnet"),
  pilot = load("native-pilot-proof");
const provider = createNearProvider(),
  db = openDatabase(":memory:");
const player = createPlayer(db, "Read-only finality proof");
const vaults = new NativeVaults(db, provider, rewardsConfig);
const verifier = new NativeTransactionConfirmation(db, provider, {
  rewardsConfig,
  marketManifest,
  claimsManifest,
  vaults,
  timeoutMs: 30000,
});
const cases = [
  ...market.transactions
    .filter((r) =>
      /List earned|Buyer pays|Seller withdraws|Cancel and return/.test(r.label),
    )
    .map((r) => ({
      ...r,
      accountId: /Buyer pays/.test(r.label) ? market.buyer : market.seller,
    })),
  {
    label: "Public SocialDB profile",
    transaction: profile.transaction,
    accountId: profile.accountId,
  },
  {
    ...aura.transactions.find((r) => r.label === "Redeem signed earned Aura"),
    accountId: aura.accountId,
  },
  ...pilot.transactions
    .filter((r) => /factory|withdraw|position|Create/i.test(r.label))
    .map((r) => ({ ...r, accountId: pilot.participant })),
];
const receipts = [];
for (const candidate of cases) {
  db.prepare("INSERT OR IGNORE INTO wallet_links VALUES(?,?,?)").run(
    candidate.accountId,
    player,
    Date.now(),
  );
  try {
    const receipt = await provider.viewTransactionStatus({
      txHash: candidate.transaction,
      accountId: candidate.accountId,
      waitUntil: "FINAL",
    });
    const call = receipt.transaction.actions[0].FunctionCall;
    if (!call) continue;
    const quote = {
      network: "testnet",
      signerId: candidate.accountId,
      receiverId: receipt.transaction.receiver_id,
      methodName: call.method_name,
      args: JSON.parse(Buffer.from(call.args, "base64").toString()),
      gas: String(call.gas),
      deposit: call.deposit,
    };
    const confirmed = await verifier.confirm(player, {
      accountId: candidate.accountId,
      transactionHash: candidate.transaction,
      quote,
    });
    await assert.rejects(
      verifier.confirm(player, {
        accountId: candidate.accountId,
        transactionHash: candidate.transaction,
        quote: { ...quote, gas: String(BigInt(quote.gas) + 1n) },
      }),
    );
    receipts.push({
      ...candidate,
      method: call.method_name,
      confirmed: confirmed.confirmed,
      alteredGasRejected: true,
    });
  } catch (error) {
    receipts.push({ ...candidate, confirmed: false, reason: error.message });
  }
}
const positions = await vaults.positions(pilot.participant, true);
const position = positions.find((r) => r.account_id === pilot.vaultId);
assert(position);
const state = await vaults.state(position);
const poolResponse = await provider.query({
  request_type: "call_function",
  account_id: position.pool,
  method_name: "get_account",
  args_base64: Buffer.from(
    JSON.stringify({ account_id: position.account_id }),
  ).toString("base64"),
  finality: "final",
});
const pool = JSON.parse(Buffer.from(poolResponse.result).toString());
const report = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  mode: "read-only",
  newTransactions: 0,
  receipts,
  exit: {
    accountId: position.account_id,
    beneficiary: position.beneficiary,
    epoch: state.epoch,
    unlockEpoch: state.unlock_epoch,
    stage: state.stage,
    canWithdraw: pool.can_withdraw,
    ownerCredit: state.owner_credit,
    ownerPending: state.owner_pending,
    ownerPaid: state.owner_paid,
    realizedGameYieldPaid: state.game_paid,
  },
  boundaries: [
    "Quotes reconstructed from existing project transactions, not a new wallet UI approval",
    "Historical code different from the current reviewed manifest is deliberately rejected",
    "No epoch bypass, withdrawal, deposit or signature performed",
  ],
};
mkdirSync("output/qa/W03-native-confirmation", { recursive: true });
writeFileSync(
  "output/qa/W03-native-confirmation/read-only-proof.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
db.close();

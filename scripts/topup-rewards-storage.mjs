// Testnet only. Tops up the rewards contract's separate storage and gas
// reserve so the next publications fit (contracts/rewards reserve_storage):
//   balance >= (storage_usage + (slots + 256 per new day) * 1024 + 8192) * byte cost
//              + (funded - withdrawn) + 0.5 NEAR
// Every published day (city or map) holds 256 receipt slots until it closes,
// so the steady state is about five days at once: yesterday and today of the
// map, and yesterday, today and tomorrow of the city. A plain transfer is
// never reward income (it is not fund_rewards).
//
//   node scripts/topup-rewards-storage.mjs            # dry run
//   node scripts/topup-rewards-storage.mjs --send     # sends from the operator
//   ... --testlayer                                   # the Test Layer's rewards contract
import { readFileSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";

const NEAR = 10n ** 24n;
const SLOTS_PER_DAY = 256n,
  CLAIM_STORAGE = 1024n,
  BYTE_COST = 10n ** 19n;
const EXTRA_DAYS = BigInt(process.env.TOPUP_EXTRA_DAYS || 2); // new days beyond what is reserved now
const MARGIN = NEAR / 4n;
const MAX_TOPUP = 8n * NEAR;

const record = process.argv.includes("--testlayer") ? "public/native-rewards-testlayer.json" : "public/native-rewards-testnet.json";
const config = JSON.parse(readFileSync(record));
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const contractId = config.contractId;

const view = async (method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
async function reservedSlots() {
  const prefix = Buffer.from("native-storage-v1"),
    key = Buffer.from("__total"),
    len = Buffer.alloc(4);
  len.writeUInt32LE(key.length);
  const r = await provider.query({
    request_type: "view_state",
    account_id: contractId,
    prefix_base64: Buffer.concat([prefix, len, key]).toString("base64"),
    finality: "final",
  });
  const v = r.values?.[0];
  return v ? Buffer.from(v.value, "base64").readBigUInt64LE() : 0n;
}

const account = await provider.viewAccount({ accountId: contractId });
const treasury = await view("get_treasury");
const slots = await reservedSlots();
const balance = BigInt(account.amount);
const required =
  (BigInt(account.storage_usage) +
    (slots + EXTRA_DAYS * SLOTS_PER_DAY) * CLAIM_STORAGE +
    8192n) *
    BYTE_COST +
  (BigInt(treasury.funded) - BigInt(treasury.withdrawn)) +
  NEAR / 2n;
const deficit = required + MARGIN - balance;
const fmt = (y) => (Number(y) / 1e24).toFixed(3);
console.log(
  JSON.stringify(
    {
      contractId,
      balance: fmt(balance),
      reservedSlots: Number(slots),
      extraDays: Number(EXTRA_DAYS),
      required: fmt(required),
      topUp: deficit > 0n ? fmt(deficit) : "0",
    },
    null,
    1,
  ),
);
if (deficit <= 0n) process.exit(0);
assert(deficit <= MAX_TOPUP, `Top-up above ${fmt(MAX_TOPUP)} NEAR; check the numbers first.`);
if (!process.argv.includes("--send")) {
  console.log("Dry run. Re-run with --send to transfer from the operator.");
  process.exit(0);
}
const keyPath = ".data/near-operator.json";
assert.equal(statSync(keyPath).mode & 0o077, 0, "Operator key must be private.");
const key = JSON.parse(readFileSync(keyPath));
assert.equal(key.network, "testnet");
const operator = new Account(
  key.accountId,
  provider,
  KeyPairSigner.fromSecretKey(key.secretKey),
);
const result = await operator.signAndSendTransaction({
  receiverId: contractId,
  actions: [actions.transfer(deficit)],
  waitUntil: "FINAL",
});
assert(!result.status?.Failure, "The transfer failed.");
console.log(
  `Sent ${fmt(deficit)} NEAR from ${key.accountId} to ${contractId}: ${result.transaction.hash}`,
);

// Refreshes a rewards contract's reward worker key, VPS release runner
// (docs/VPS-RELEASE-RUNNER.md). Testnet only.
//
// The reward worker signs publish/claim/close calls with a function-call key
// on the rewards contract account. Every transaction is charged to the key's
// allowance; once the allowance is below one transaction's prepaid gas, the
// worker stalls ("AccessKeyNotEnoughAllowance") and coins stay pending. A key's
// allowance can't be raised in place, so this deletes the same key and adds it
// back in one transaction: same public key, same receiver, same methods, a
// fresh allowance (at most 1 NEAR, the bound the worker accepts). The worker's
// key file stays valid; the worker rebuilds its signer after the failed send
// and picks up the new nonce (a restart does the same).
//
//   node scripts/refresh-reward-worker-key.mjs --account questlayer-rewards-tl1112.testnet \
//     --key-file .data/near-operator.json             # plan: the key now, what would change
//   ... --execute                                      # sends the transaction
//
// --key-file is a full-access key of --account (for accounts the deploy made,
// the operator key). --public-key picks the worker key when the account has more
// than one function-call key. --min-near (default 0.9) skips a key that already
// has at least that much left, so a rerun does nothing.
import { readFileSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, PublicKey, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import { allowedWorkerMethods } from "../server/native/reward-worker.mjs";

const NEAR = 10n ** 24n;
const ALLOWANCE = NEAR; // the worker refuses a key with more (server/native/reward-worker.mjs)
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const execute = process.argv.includes("--execute");
const accountId = arg("--account");
const keyFile = arg("--key-file") || ".data/near-operator.json";
const only = arg("--public-key");
const minNear = Number(arg("--min-near") ?? 0.9);
const near = (y) => (y === null ? null : Number(BigInt(y) / 10n ** 18n) / 1e6);
const log = (o) => console.log(JSON.stringify(o));

assert.match(accountId || "", /^[a-z0-9._-]+\.testnet$/, "--account must be a testnet account.");
assert.ok(Number.isFinite(minNear) && minNear >= 0 && minNear <= 1, "--min-near is 0 to 1.");
const key = JSON.parse(readFileSync(keyFile, "utf8"));
assert.equal(key.network, "testnet", "Testnet key only.");
assert.equal(statSync(keyFile).mode & 0o077, 0, "The key file must be private (chmod 600).");
const signer = KeyPairSigner.fromSecretKey(key.secretKey);
const signerPublic = (await signer.getPublicKey()).toString();
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet RPC only.");

const { keys } = await provider.query({ request_type: "view_access_key_list", account_id: accountId, finality: "final" });
assert.ok(
  keys.some((k) => k.public_key === signerPublic && k.access_key.permission === "FullAccess"),
  `${keyFile} is not a full-access key of ${accountId}.`,
);
const workers = keys.filter((k) => {
  const p = k.access_key.permission?.FunctionCall;
  return p && p.receiver_id === accountId && allowedWorkerMethods(p.method_names) && (!only || k.public_key === only);
});
assert.equal(workers.length, 1, `Expected exactly one reward worker key on ${accountId}, found ${workers.length}; pass --public-key.`);
const worker = workers[0];
const p = worker.access_key.permission.FunctionCall;
const before = { publicKey: worker.public_key, allowanceNear: near(p.allowance), methods: p.method_names, nonce: worker.access_key.nonce };
log({ account: accountId, signer: signerPublic, before, newAllowanceNear: near(ALLOWANCE) });
if (p.allowance !== null && BigInt(p.allowance) >= BigInt(Math.round(minNear * 1e6)) * 10n ** 18n) {
  log({ skipped: `allowance already at least ${minNear} NEAR` });
  process.exit(0);
}
if (!execute) {
  log({ plan: "delete and re-add the same key with the same methods and a fresh allowance; run with --execute" });
  process.exit(0);
}
const pk = PublicKey.fromString(worker.public_key);
const r = await new Account(accountId, provider, signer).signAndSendTransaction({
  receiverId: accountId,
  actions: [actions.deleteKey(pk), actions.addFunctionCallAccessKey(pk, accountId, p.method_names, ALLOWANCE)],
  waitUntil: "FINAL",
});
assert.ok(!r?.status?.Failure, "Key refresh failed: " + JSON.stringify(r?.status?.Failure));
const after = await provider.query({ request_type: "view_access_key", account_id: accountId, public_key: worker.public_key, finality: "final" });
const q = after.permission?.FunctionCall;
assert.ok(q && q.receiver_id === accountId && JSON.stringify(q.method_names) === JSON.stringify(p.method_names), "Re-added key differs.");
log({ refreshed: worker.public_key, allowanceNear: near(q.allowance), transaction: r.transaction?.hash || r.transaction_outcome?.id });

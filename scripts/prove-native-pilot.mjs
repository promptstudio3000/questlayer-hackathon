// Project-owned testnet accounts and explicitly synthetic GPS only.
// This is protocol/API evidence, never a claim of a physical walk or device wallet approval.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
import { assertVaultQuote } from "../src/native-vault-quote.ts";
import { distance } from "../server/domain.mjs";
const base =
    process.env.PILOT_API_URL || "https://questlayer.promptstudio3000.com",
  origin = base;
assert(
  ["questlayer.promptstudio3000.com", "127.0.0.1"].includes(
    new URL(base).hostname,
  ),
);
const operator = JSON.parse(readFileSync(".data/near-operator.json")),
  config = JSON.parse(readFileSync("public/native-rewards-testnet.json"));
assert.equal(operator.network, "testnet");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const pilotId = "questlayer-pilot-20261031.testnet",
  signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  pilot = new Account(pilotId, provider, signer),
  root = new Account(operator.accountId, provider, signer);
let info;
try {
  info = await provider.viewAccount({ accountId: pilotId });
} catch (e) {
  if (!/does not exist|doesnotexist|unknown_account/i.test(rpcErrorText(e)))
    throw e;
}
if (!info) {
  const r = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newAccountId: pilotId,
      newAccountPublicKey: operator.publicKey,
    }),
    signal: AbortSignal.timeout(30000),
  });
  assert(r.ok, "Pilot faucet creation failed");
}
let cookie;
const transactions = [];
async function api(path, body) {
  const r = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", Origin: origin }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const data = await r.json();
  assert.equal(r.status, 200, `${path}: ${r.status} ${data.error || ""}`);
  cookie = r.headers.get("set-cookie")?.split(";")[0] || cookie;
  return data;
}
const c = await api("/auth/near/challenge", {
    accountId: pilotId,
    name: "Native pilot QA",
  }),
  signed = await signMessage({
    signerAccount: pilot,
    payload: {
      message: c.message,
      recipient: c.recipient,
      nonce: new Uint8Array(Buffer.from(c.nonce, "base64")),
    },
  });
await api("/auth/near/verify", {
  challengeId: c.challengeId,
  accountId: pilotId,
  publicKey: signed.publicKey.toString(),
  signature: Buffer.from(signed.signature).toString("base64"),
});
const view = async (id, method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: id,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
async function call(
  label,
  account,
  contractId,
  methodName,
  args,
  deposit = 0n,
) {
  const r = await account.callFunctionRaw({
    contractId,
    methodName,
    args,
    deposit,
    gas: 280n * 10n ** 12n,
    waitUntil: "FINAL",
  });
  assert(!r.status?.Failure, label + " failed");
  const transaction = r.transaction?.hash || r.transaction_outcome?.id;
  transactions.push({ label, transaction });
  console.log(JSON.stringify({ label, transaction }));
  return r;
}
async function prepared(request) {
  const full = { accountId: pilotId, ...request },
    quote = await api("/native/vaults/prepare", full);
  assertVaultQuote(quote, full);
  return call(
    "Prepared " + request.action,
    pilot,
    quote.receiverId,
    quote.methodName,
    quote.args,
    BigInt(quote.deposit),
  );
}
let vaults = await api("/native/vaults?account=" + pilotId),
  p = vaults.positions[0];
if (!p) {
  await prepared({
    action: "create",
    poolId: "aurora.pool.f863973.m0",
    contributionBps: 5000,
    setupDeposit: vaults.config.setup_deposit,
  });
  vaults = await api("/native/vaults?account=" + pilotId);
  p = vaults.positions[0];
}
assert.equal(p.state, "ready");
assert.equal(p.beneficiary, pilotId);
const vaultId = p.account_id;
assert.equal(
  (
    await provider.query({
      request_type: "view_access_key_list",
      account_id: vaultId,
      finality: "final",
    })
  ).keys.length,
  0,
);
if (p.position.deposited === "0") {
  await prepared({
    action: "deposit",
    vaultId,
    amount: "10000000000000000000000",
  });
  await prepared({ action: "refresh", vaultId });
}
let state = await view(vaultId, "get_state"),
  pool = await view(state.pool, "get_account", { account_id: vaultId });
assert.equal(state.deposited, "10000000000000000000000");
if (!state.exit_requested) {
  assert(BigInt(pool.staked_balance) > 0n);
  await prepared({ action: "exit", vaultId });
}
state = await view(vaultId, "get_state");
assert.equal(state.stage, "unlocking");
const unlock = state.unlock_epoch;
await prepared({ action: "exit", vaultId });
state = await view(vaultId, "get_state");
assert.equal(state.unlock_epoch, unlock);
assert.equal(state.weighted_stake, "0");
pool = await view(state.pool, "get_account", { account_id: vaultId });
assert(BigInt(pool.unstaked_balance) > 0n);
assert.equal(pool.staked_balance, "0");
let unauthorizedRejected = false;
try {
  const r = await root.callFunctionRaw({
    contractId: vaultId,
    methodName: "withdraw_owner",
    args: {},
    deposit: 1n,
    gas: 30n * 10n ** 12n,
    waitUntil: "FINAL",
  });
  unauthorizedRejected = /Beneficiary only/.test(JSON.stringify(r.status));
} catch (e) {
  unauthorizedRejected = /Beneficiary only/.test(rpcErrorText(e));
}
assert(unauthorizedRejected);
await api("/native/rewards/join", { accountId: pilotId, consent: true });
let board = await api("/native/rewards?account=" + pilotId + "&refresh=1");
assert.equal(board.status, "ready");
const q = board.day.quests
  .filter(
    (q) => q.tier === 1 && q.opensAt <= Date.now() && q.closesAt > Date.now(),
  )
  .sort(
    (a, b) =>
      a.targets.slice(1).reduce((s, p, i) => s + distance(a.targets[i], p), 0) -
      b.targets.slice(1).reduce((s, p, i) => s + distance(b.targets[i], p), 0),
  )[0];
assert(q);
let previous = null,
  questReceipt;
for (let i = q.checkpoint; i < q.targets.length; i++) {
  const target = q.targets[i];
  if (previous)
    await new Promise((r) =>
      setTimeout(
        r,
        Math.max(
          4000,
          Math.ceil((distance(previous, target) / 8) * 1000) + 1200,
        ),
      ),
    );
  const result = await api("/native/rewards/visit", {
    accountId: pilotId,
    dayId: board.day.id,
    kind: "quest",
    index: q.index,
    checkpoint: i,
    mode: "gps",
    fix: { ...target, accuracy: 5, timestamp: Date.now() },
  });
  previous = target;
  questReceipt = result;
  console.log(
    JSON.stringify({
      checkpoint: i + 1,
      state: result.state,
      syntheticGPS: true,
    }),
  );
}
if (!previous) previous = q.targets.at(-1);
board = await api("/native/rewards/nearby", {
  accountId: pilotId,
  location: previous,
  fresh: true,
});
const coin = board.day.coins[0];
assert(coin);
await new Promise((r) =>
  setTimeout(
    r,
    Math.max(4000, Math.ceil((distance(previous, coin) / 8) * 1000) + 1200),
  ),
);
const input = {
  accountId: pilotId,
  dayId: board.day.id,
  kind: "coin",
  index: coin.index,
  mode: "gps",
  fix: { lat: coin.lat, lng: coin.lng, accuracy: 5, timestamp: Date.now() },
};
const coinReceipt = await api("/native/rewards/visit", input),
  replay = await api("/native/rewards/visit", input);
assert.equal(replay.id, coinReceipt.id);
let final;
for (let i = 0; i < 30; i++) {
  final = await api("/native/rewards?account=" + pilotId + "&refresh=1");
  if (
    final.receipts.some(
      (r) => r.id === coinReceipt.id && r.state === "confirmed",
    ) &&
    final.receipts.some(
      (r) =>
        r.kind === "quest" && r.index === q.index && r.state === "confirmed",
    )
  )
    break;
  await new Promise((r) => setTimeout(r, 5000));
}
assert(
  final.receipts.some(
    (r) => r.id === coinReceipt.id && r.state === "confirmed",
  ),
  "Coin did not reconcile",
);
assert(
  final.receipts.some(
    (r) => r.kind === "quest" && r.index === q.index && r.state === "confirmed",
  ),
  "Quest did not reconcile",
);
const owed = BigInt(final.balance.credit);
assert(owed > 0n);
await call(
  "Withdraw actual native exploration reward",
  pilot,
  config.contractId,
  "withdraw",
  {},
  1n,
);
const paid = await view(config.contractId, "get_account", {
  account_id: pilotId,
});
assert.equal(paid.credit, "0");
assert.equal(paid.pending, "0");
assert(BigInt(paid.withdrawn) >= owed);
const proof = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  api: base,
  participant: pilotId,
  participantControl:
    "Project-controlled developer account; no personal wallet used",
  evidenceMode:
    "Synthetic GPS API rehearsal, not physical walking or mobile wallet approval",
  factory: config.factory.contractId,
  vaultId,
  vaultKeyCount: 0,
  actualDeposit: "0.01 test NEAR",
  poolPosition: pool,
  exitState: state,
  repeatedExitPreservedUnlock: true,
  unauthorizedOwnerWithdrawalRejected: unauthorizedRejected,
  fullExitCycleComplete: false,
  whyExitPending:
    "Real validator epochs must elapse; worker will progress the sealed batch without resetting it",
  nativeDay: board.day.id,
  quest: {
    index: q.index,
    title: q.title,
    location: q.name,
    checkpointCount: 3,
  },
  coinReceiptId: coinReceipt.id,
  duplicateReceiptPreserved: true,
  confirmedReceipts: final.receipts.filter((r) => r.state === "confirmed"),
  withdrawnThisRun: owed.toString(),
  nativeAccountAfterWithdrawal: paid,
  treasury: await view(config.contractId, "get_treasury"),
  transactions,
};
mkdirSync("output/qa/W05-W06-native", { recursive: true });
writeFileSync(
  "public/native-pilot-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
writeFileSync(
  "output/qa/W05-W06-native/live-pilot.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    verified: true,
    vaultId,
    unlockEpoch: unlock,
    nativeXP: paid.xp,
    withdrawn: owed.toString(),
    physicalWalkVerified: false,
  }),
);

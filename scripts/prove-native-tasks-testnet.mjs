// Programmatic project-wallet proof, not field verification or a mobile wallet test.
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { Account, KeyPairSigner } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import { NativeTasks } from "../server/native/tasks.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";
const keyPath = ".data/near-operator.json";
assert.equal(statSync(keyPath).mode & 0o077, 0);
const operator = JSON.parse(readFileSync(keyPath));
assert.equal(operator.network, "testnet");
assert.equal(operator.accountId, "auratrail-dev-20261030.testnet");
const manifest = JSON.parse(readFileSync("public/native-tasks-testnet.json"));
assert.equal(manifest.network, "testnet");
assert.equal(manifest.contractId, "questlayer-tasks-20261031.testnet");
assert.equal(manifest.keyless, true);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const sponsorId = "questlayer-pilot-20261031.testnet",
  claimantId = "explorer.auratrail-dev-20261030.testnet",
  arbiterId = operator.accountId;
assert.equal(manifest.arbiterId, arbiterId);
const ids = [sponsorId, claimantId, arbiterId],
  db = openDatabase(":memory:");
const player = createPlayer(db, "Project escrow protocol proof");
const accounts = new Map();
for (const accountId of ids) {
  const keys = await provider.query({
    request_type: "view_access_key_list",
    account_id: accountId,
    finality: "final",
  });
  assert(
    keys.keys.some(
      (k) =>
        k.public_key === operator.publicKey &&
        k.access_key.permission === "FullAccess",
    ),
    "Use only verified project-owned accounts.",
  );
  accounts.set(
    accountId,
    new Account(
      accountId,
      provider,
      KeyPairSigner.fromSecretKey(operator.secretKey),
    ),
  );
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    accountId,
    player,
    Date.now(),
  );
}
const adapter = new NativeTasks(db, provider, manifest, { timeoutMs: 20000 });
const journalPath = ".data/native-tasks-proof-journal.json";
const journal = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath))
  : {
      contractId: manifest.contractId,
      codeHash: manifest.codeHash,
      createdAt: Date.now(),
      steps: {},
      pending: null,
    };
assert.equal(journal.contractId, manifest.contractId);
assert.equal(journal.codeHash, manifest.codeHash);
assert(
  !journal.pending,
  "An earlier transaction has an unknown outcome. Reconcile its exact recorded operation before rerunning; never repeat a deposit blindly.",
);
const save = () =>
  writeFileSync(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
save();
const digest = (text) => createHash("sha256").update(text).digest("hex");
const request = (accountId, action, fields = {}) => ({
  accountId,
  action,
  codeHash: manifest.codeHash,
  policy: manifest.policy,
  ...fields,
});
const snapshot = (accountId, taskId = null) =>
  adapter.snapshot(player, accountId, true, taskId);
async function execute(label, accountId, quote) {
  journal.pending = {
    label,
    accountId,
    methodName: quote.methodName,
    args: quote.args,
    deposit: quote.deposit,
    createdAt: Date.now(),
  };
  save();
  const outcome = await accounts
    .get(accountId)
    .callFunctionRaw({
      contractId: manifest.contractId,
      methodName: quote.methodName,
      args: quote.args,
      deposit: BigInt(quote.deposit),
      gas: BigInt(quote.gas),
      waitUntil: "FINAL",
    });
  assert(
    outcome.status && "SuccessValue" in outcome.status,
    `${label} failed; inspect the recorded operation before resuming.`,
  );
  let value = null;
  if (outcome.status.SuccessValue)
    value = JSON.parse(
      Buffer.from(outcome.status.SuccessValue, "base64").toString(),
    );
  const result = { label, transaction: outcome.transaction.hash, value };
  journal.steps[label] = result;
  journal.pending = null;
  save();
  console.log(JSON.stringify({ label, transaction: result.transaction }));
  return value;
}
async function act(label, input) {
  if (journal.steps[label]) return journal.steps[label].value;
  const quote = await adapter.prepare(player, input);
  return execute(label, input.accountId, quote);
}
const rewardYocto = (10n ** 21n).toString();
async function create(label, suffix) {
  const description =
    "Project protocol rehearsal only: public synthetic evidence tests escrow. This is not an invitation to perform physical work.";
  return act(
    label,
    request(sponsorId, "create", {
      clientId: `questlayer-escrow-proof-${suffix}-v1`,
      title: `Escrow proof · ${suffix}`,
      description,
      reference: "",
      contentHash: digest(description),
      area: "Plzeň · protocol test",
      rewardYocto,
      dueAtMs: journal.createdAt + 2 * 3600000,
    }),
  );
}
const evidence = (text) => ({ text, reference: "", contentHash: digest(text) });
const approved = await create("Create approval rehearsal", "approved");
const taskA = approved.task_id;
await act(
  "Submit public synthetic evidence",
  request(claimantId, "submit", {
    taskId: taskA,
    ...evidence(
      "Synthetic project evidence for the approval path. No GPS or field visit is claimed.",
    ),
  }),
);
await act(
  "Sponsor approves earliest evidence",
  request(sponsorId, "review", {
    taskId: taskA,
    submissionId: 0,
    approved: true,
    reason: "Protocol fixture accepted; no physical verification claimed.",
  }),
);
let a = await snapshot(claimantId, taskA);
assert.equal(a.status, "available");
assert.equal(a.tasks.find((t) => t.task_id === taskA).winner_id, claimantId);
const replayLabel = "Repeat finalization without a second award";
if (!journal.steps[replayLabel]) {
  const before = a.totals.awarded_yocto;
  await execute(replayLabel, sponsorId, {
    methodName: "finalize_task",
    args: { task_id: taskA },
    deposit: "0",
    gas: "100000000000000",
  });
  a = await snapshot(claimantId, taskA);
  assert.equal(a.totals.awarded_yocto, before);
}
await act(
  "Claimant withdraws approved reward",
  request(claimantId, "withdraw"),
);
assert.equal((await snapshot(claimantId)).account.credit_yocto, "0");

const cancelled = await create("Create refund rehearsal", "refund");
await act(
  "Cancel empty task and credit refund",
  request(sponsorId, "cancel", { taskId: cancelled.task_id }),
);
const b = await snapshot(sponsorId, cancelled.task_id);
assert.equal(
  b.tasks.find((t) => t.task_id === cancelled.task_id).status,
  "refunded",
);
await act("Sponsor withdraws exact refund", request(sponsorId, "withdraw"));
assert.equal((await snapshot(sponsorId)).account.credit_yocto, "0");

const disputed = await create("Create appeal rehearsal", "appeal");
const taskC = disputed.task_id;
await act(
  "Submit evidence for appeal rehearsal",
  request(claimantId, "submit", {
    taskId: taskC,
    ...evidence(
      "Synthetic project evidence for the rejection and appeal path.",
    ),
  }),
);
await act(
  "Sponsor rejects evidence with reason",
  request(sponsorId, "review", {
    taskId: taskC,
    submissionId: 0,
    approved: false,
    reason:
      "Deliberate protocol rejection so the claimant can exercise appeal rights.",
  }),
);
await act(
  "Cancellation preserves timely evidence rights",
  request(sponsorId, "cancel", { taskId: taskC }),
);
let c = await snapshot(claimantId, taskC);
if (!journal.steps["Claimant files appeal after cancellation"]) {
  assert.equal(c.tasks.find((t) => t.task_id === taskC).status, "closing");
  assert.equal(c.actions.appealSubmissionId, 0);
}
await act(
  "Claimant files appeal after cancellation",
  request(claimantId, "appeal", {
    taskId: taskC,
    submissionId: 0,
    ...evidence(
      "Synthetic appeal: the fixture fulfills the published protocol-only requirement.",
    ),
  }),
);
await act(
  "Named arbiter resolves appeal for claimant",
  request(arbiterId, "resolve", {
    taskId: taskC,
    submissionId: 0,
    approved: true,
    reason: "Protocol appeal accepted. No real-world verification is asserted.",
  }),
);
await act(
  "Claimant withdraws appealed reward",
  request(claimantId, "withdraw"),
);
const final = await snapshot(claimantId, taskC);
assert.equal(final.status, "available");
assert.equal(final.totals.conserved, true);
assert.equal(final.account.credit_yocto, "0");
assert.equal(final.account.pending_withdrawal, null);
assert.equal(final.totals.open_escrow_yocto, "0");
assert.equal(
  final.totals.reward_deposits_yocto,
  (3n * BigInt(rewardYocto)).toString(),
);
assert.equal(final.totals.awarded_yocto, (2n * BigInt(rewardYocto)).toString());
assert.equal(final.totals.refunded_yocto, rewardYocto);
assert.equal(final.totals.withdrawn_yocto, final.totals.reward_deposits_yocto);
const proof = {
  schema: 1,
  network: "testnet",
  verifiedAt: new Date().toISOString(),
  contractId: manifest.contractId,
  codeHash: manifest.codeHash,
  keyless: true,
  policy: manifest.policy,
  wallets: { sponsorId, claimantId, arbiterId },
  tasks: { approval: taskA, refund: cancelled.task_id, appeal: taskC },
  totals: final.totals,
  transactions: Object.values(journal.steps).map(({ label, transaction }) => ({
    label,
    transaction,
  })),
  boundaries: [
    "Synthetic public text evidence, no physical-location proof",
    "Project-owned programmatic wallets, no personal wallet or mobile UI signature",
    "Rewards are test NEAR, not yield or mainnet funds",
    "Fixed storage funding is separate and nonrefundable",
    "Timeout and failed-transfer recovery verified by unit tests, not elapsed live deadlines",
  ],
};
mkdirSync("output/qa/W08-W10-native-tasks", { recursive: true });
for (const path of [
  "public/native-tasks-proof.json",
  "output/qa/W08-W10-native-tasks/native-tasks-proof.json",
])
  writeFileSync(path, JSON.stringify(proof, null, 2) + "\n");
db.close();
console.log(
  JSON.stringify({ success: true, tasks: proof.tasks, totals: proof.totals }),
);

// Opt-in actual-WASM escrow regression. Never contact a public network.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { KeyPair } from "near-api-js";
import { openDatabase, createPlayer } from "../../server/database.mjs";
import { GOLD, DAY } from "../../server/domain.mjs";
import * as market from "../../server/market/service.mjs";
import * as chain from "../../server/market/chain.mjs";
import { escrowLocalTransport, escrowReceiptSummary } from "./escrow-rpc.mjs";

const [sandboxModule, wasmDirectory, reportPath] = process.argv.slice(2);
assert.ok(sandboxModule && wasmDirectory && reportPath, "arguments: sandbox module, WASM directory, report path");
const { Sandbox, GenesisAccount } = await import(pathToFileURL(resolve(sandboxModule)));
const NEAR = 10n ** 24n, PRICE = BigInt(GOLD), PLACE = { lat: 49.7475, lng: 13.3776 };
const escrow = { contractId: "escrow.testnet", tokenId: "qgold.testnet", treasuryId: "treasury.testnet", publisherId: "owner.testnet" };
chain.setEscrowConfig(escrow);
const keys = new Map();
const accounts = ["owner", "escrow", "qgold", "alice", "bob", "treasury", "worker2", "unregistered"].map((name) => {
  const id = `${name}.testnet`, key = KeyPair.fromRandom("ed25519"); keys.set(id, key);
  return new GenesisAccount(id, key.getPublicKey().toString(), key.toString(), 200n * NEAR);
});
const dir = mkdtempSync(join(tmpdir(), "questlayer-escrow-wasm-fixture-"));
const report = { startedAt: new Date().toISOString(), scope: "local sandbox only", scenarios: [], findings: [], transactions: [], workers: [] };
const children = new Set(), databases = new Set(), barriers = new Map(), transports = new Map();
const artifacts = {};
for (const name of ["qgold", "qgold_escrow"]) {
  const code = readFileSync(join(wasmDirectory, `questlayer_${name}.wasm`));
  assert.equal(code.subarray(0, 4).toString("hex"), "0061736d"); artifacts[name] = code;
  (report.wasm ??= {})[name] = { bytes: code.length, sha256: createHash("sha256").update(code).digest("hex") };
}
let sandbox, owner;
const transport = async (accountId) => {
  if (!transports.has(accountId)) transports.set(accountId, await escrowLocalTransport({ rpcUrl: sandbox.rpcUrl, accountId, secretKey: keys.get(accountId).toString() }));
  return transports.get(accountId);
};
const view = (method, args = {}) => owner.view(escrow.contractId, method, args);
const gold = (method, args = {}) => owner.view(escrow.tokenId, method, args);
const balance = async (account) => BigInt(await gold("ft_balance_of", { account_id: account }));
const chainNow = async () => Number(BigInt((await owner.provider.viewBlock({ finality: "final" })).header.timestamp_nanosec) / 1_000_000n);
async function call(method, args = {}, { sender = "owner.testnet", contract = escrow.contractId, deposit = 0n, failure = false, gas } = {}) {
  const outcome = await (await transport(sender)).call(contract, method, args, deposit, gas);
  report.transactions.push({ source: "runner", method, ...escrowReceiptSummary(outcome) });
  assert.equal(!!outcome.status?.Failure, failure, `${method}: ${JSON.stringify(outcome.status)}`);
  return outcome;
}
async function conserved() {
  const s = await view("get_stats"), b = await balance(escrow.contractId);
  assert.equal(s.conserved, true);
  assert.equal(BigInt(s.total_held), BigInt(s.escrowed) + BigInt(s.credits) + BigInt(s.pending_withdrawals));
  assert.equal(BigInt(s.deposited) - BigInt(s.withdrawn), BigInt(s.total_held));
  assert.equal(BigInt(s.pending_withdrawals), 0n, "all tested callbacks must have resolved");
  assert.equal(b, BigInt(s.total_held), "real token balance equals the escrow's accounted liabilities");
  return s;
}
async function passed(name, details = {}) {
  report.scenarios.push({ name, passed: true, stats: await conserved(), ...details });
  console.log(`PASS ${name}`);
}
async function fixture(label) {
  const now = await chainNow(), dbPath = join(dir, `${label}.sqlite`), db = openDatabase(dbPath);
  databases.add(db);
  const alice = createPlayer(db, "Alice", now), bob = createPlayer(db, "Bob", now);
  db.prepare("UPDATE players SET native_account='alice.testnet' WHERE id=?").run(alice);
  db.prepare("UPDATE players SET native_account='bob.testnet' WHERE id=?").run(bob);
  const fix = { ...PLACE, accuracy: 8, timestamp: now };
  return { db, dbPath, alice, bob, now,
    row: (id) => db.prepare("SELECT * FROM mk_fundings WHERE id=?").get(id),
    task: (extra = {}) => market.createTask(db, alice, { title: "Visit the cathedral", ...PLACE, reward: GOLD, ...extra }, now),
    secret: () => {
      const s = market.createSecret(db, alice, { title: "Hidden courtyard", reveal: "Go through the blue archway.", ...PLACE, fix, price: GOLD }, now);
      return { secret: s, ...market.revealSecret(db, bob, s.id, {}, now) };
    },
    sponsored: () => market.createSecret(db, alice, { kind: "sponsored", title: "Cafe discovery", reveal: "Ask for the courtyard tour.", ...PLACE, fix, visitReward: GOLD, visits: 1 }, now),
    transfer: (extra = {}) => market.createTransfer(db, alice, { to: bob, amount: GOLD, ...extra }, now),
  };
}
async function fund(f, item, change = {}, amountDelta = 0n) {
  const row = f.row(item.id), msg = { ...JSON.parse(row.msg), ...change };
  return call("ft_transfer_call", { receiver_id: escrow.contractId, amount: String(BigInt(row.amount_u) + amountDelta), msg: JSON.stringify(msg) },
    { sender: row.account, contract: escrow.tokenId, deposit: 1n, gas: 200n * 10n ** 12n });
}
async function confirm(f, item) {
  return chain.checkFunding(f.db, item.id, f.row(item.id).player, {
    view: chain.escrowView(owner.provider, escrow.contractId), activate: market.ACTIVATE, now: await chainNow(),
  });
}
async function worker(f, options = {}) {
  const now = options.now ?? Math.max(await chainNow(), f.workerTime ?? 0) + 120_000;
  f.workerTime = now;
  const child = fork(new URL("./escrow-worker-child.mjs", import.meta.url), [], {
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.add(child);
  const run = { pid: child.pid, ...options, stopped: null }, messages = [];
  report.workers.push(run);
  let stderr = ""; child.stderr.on("data", (data) => { stderr += data; });
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(Error("worker timeout")); }, 90_000);
    child.on("message", (message) => {
      messages.push(message);
      if (message.type === "transaction") report.transactions.push({ source: "worker", ...message });
      if (message.type === "stopped") { run.stopped = message.phase; child.kill("SIGKILL"); }
      if (message.type === "barrier") {
        const waiting = barriers.get(message.group) ?? []; waiting.push(child); barriers.set(message.group, waiting);
        if (waiting.length === 2) { for (const peer of waiting) peer.send({ type: "release" }); barriers.delete(message.group); }
      }
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout); children.delete(child); Object.assign(run, { code, signal });
      const error = messages.find((m) => m.type === "error");
      if (error) return reject(Error(error.message));
      if (run.stopped) assert.equal(signal, "SIGKILL");
      else if (code !== 0 || !messages.some((m) => m.type === "done")) return reject(Error(`worker exited ${code}: ${stderr.slice(0, 1000)}`));
      run.result = messages.find((m) => m.type === "done")?.result;
      resolve(messages);
    });
    child.on("error", reject);
  });
  const accountId = options.accountId ?? "owner.testnet";
  child.send({ rpcUrl: sandbox.rpcUrl, secretKey: keys.get(accountId).toString(), accountId, escrow, dbPath: f.dbPath, now, ...options });
  return result;
}
const sql = (f, table, item) => f.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(item.id);
const feeCount = (f, item) => f.db.prepare("SELECT COUNT(*) n FROM mk_fees WHERE ref=?").get(item.id).n;
const outstandingOps = (f) => f.db.prepare("SELECT method,state,attempts FROM mk_chain_ops WHERE state!='sent' ORDER BY seq").all();

try {
  sandbox = await Sandbox.start({ version: "2.14.0", config: { additionalAccounts: accounts, additionalGenesis: { epoch_length: 10_000_000 } } });
  owner = await transport("owner.testnet");
  report.node = { chainId: owner.status.chain_id, version: owner.status.version.version, protocolVersion: owner.status.protocol_version, rpcHost: new URL(sandbox.rpcUrl).hostname };
  console.log(`Local NEAR ${report.node.version} ready`);
  await (await transport(escrow.contractId)).account.deployContract(artifacts.qgold_escrow);
  await (await transport(escrow.tokenId)).account.deployContract(artifacts.qgold);
  await call("new", { council: ["owner.testnet"], threshold: 1, guardian_id: "owner.testnet", treasury_id: "treasury.testnet",
    minters: ["owner.testnet"], initial_rate: String(10n ** 21n),
    metadata: { spec: "ft-1.0.0", name: "Sandbox QGOLD", symbol: "QGOLD", decimals: 6 } }, { contract: escrow.tokenId });
  await call("new", { owner_id: "owner.testnet", token_id: escrow.tokenId, publisher_id: "owner.testnet",
    moderator_id: "owner.testnet", guardian_id: "owner.testnet", treasury_id: "treasury.testnet" });
  await call("storage_deposit", { account_id: escrow.contractId, registration_only: true }, { contract: escrow.tokenId, deposit: 10n ** 23n });
  for (const account_id of ["alice.testnet", "bob.testnet"])
    await call("mint_for", { account_id, memo: "local escrow fixture" }, { contract: escrow.tokenId, deposit: NEAR });
  report.initialTokenSupply = await gold("ft_total_supply");

  // First scenario doubles as a negative control against the original server.
  const wrong = await fixture("wrong-terms"), task = wrong.task();
  const message = JSON.parse(wrong.row(task.id).msg);
  await fund(wrong, task, { deadline_ms: String(BigInt(message.deadline_ms) + BigInt(DAY)) });
  assert.ok(await view("get_task", { id: task.id }), "the altered payment really exists on chain");
  assert.equal((await confirm(wrong, task)).state, "waiting", "changed on-chain deadline cannot activate the intended task");
  const badSecret = wrong.secret();
  await fund(wrong, badSecret, { secret_id: "another-real-secret" });
  assert.equal((await confirm(wrong, badSecret)).state, "waiting");
  assert.equal(market.getSecret(wrong.db, wrong.bob, badSecret.secret.id, {}, await chainNow()).revealed, false);
  for (const change of [{ condition: { type: "after", at_ms: String(await chainNow()) } }, { expires_ms: String(await chainNow() + 2 * DAY) }]) {
    const transfer = wrong.transfer(); await fund(wrong, transfer, change);
    assert.equal((await confirm(wrong, transfer)).state, "waiting");
  }
  await passed("real altered deadline, Secret identity, transfer condition and expiry do not activate rights");

  const invalid = await fixture("rejected-deposit"), invalidTask = invalid.task();
  const beforeInvalid = await balance("alice.testnet"), beforeStats = await view("get_stats");
  const badReceipt = await fund(invalid, invalidTask, {}, -1n);
  assert.ok(badReceipt.receipts_outcome.some((r) => r.outcome.status.Failure));
  assert.equal(await view("get_task", { id: invalidTask.id }), null);
  assert.equal(await balance("alice.testnet"), beforeInvalid, "failed ft_on_transfer returns the exact QGOLD");
  assert.deepEqual(await view("get_stats"), beforeStats);
  assert.equal((await confirm(invalid, invalidTask)).state, "waiting");
  await fund(invalid, invalidTask);
  await worker(invalid, { stopAfterView: true });
  assert.equal(invalid.row(invalidTask.id).state, "waiting");
  await worker(invalid);
  assert.equal(sql(invalid, "mk_tasks", invalidTask).state, "open");
  const normalBalance = await balance("bob.testnet"), normalFee = await balance("treasury.testnet");
  const claim = market.reserveTask(invalid.db, invalid.bob, invalidTask.id, {}, await chainNow());
  market.submitClaim(invalid.db, invalid.bob, claim.id, { fix: { ...PLACE, accuracy: 8, timestamp: await chainNow() } }, await chainNow());
  await worker(invalid); await worker(invalid);
  assert.equal(await balance("bob.testnet") - normalBalance, PRICE);
  assert.equal(await balance("treasury.testnet") - normalFee, PRICE / 10n);
  assert.equal((await view("get_task", { id: invalidTask.id })).status, "paid");
  await passed("failed exact-amount deposit refunds, then retry and view-stage worker restart settle the normal task once");

  for (const sponsored of [false, true]) {
    const f = await fixture(sponsored ? "sponsor-refund" : "task-refund"), item = sponsored ? f.sponsored() : f.task();
    const before = await balance("alice.testnet"); await fund(f, item);
    await call("cancel_task", { id: item.id }, { sender: "alice.testnet" });
    await worker(f, { stopBefore: "withdraw_for" });
    assert.equal(f.row(item.id).state, "funded");
    assert.equal(sql(f, sponsored ? "mk_secrets" : "mk_tasks", item).held_u, 0);
    await worker(f); await worker(f);
    assert.equal(await balance("alice.testnet"), before);
    assert.equal(feeCount(f, item), 0);
    await call("cancel_task", { id: item.id }, { failure: true });
    assert.equal(await balance("alice.testnet"), before);
    assert.equal(outstandingOps(f).length, 0);
    await passed(`${sponsored ? "sponsored Secret" : "task"}: real cancellation refunds reward plus fee once across a pre-send restart`);
  }

  const refunded = await fixture("secret-refund"), purchase = refunded.secret();
  const refundBalance = await balance("bob.testnet"); await fund(refunded, purchase);
  await call("dispute_secret", { id: purchase.id }, { sender: "bob.testnet" });
  await call("resolve_secret", { id: purchase.id, refund: true });
  await worker(refunded, { stopInsideActivation: true });
  assert.equal(refunded.row(purchase.id).state, "waiting");
  assert.equal(sql(refunded, "mk_reveals", purchase).state, "funding");
  assert.equal(refunded.db.prepare("SELECT COUNT(*) n FROM mk_chain_ops").get().n, 0);
  await worker(refunded); await worker(refunded);
  assert.equal(sql(refunded, "mk_reveals", purchase).state, "refunded");
  assert.equal(market.getSecret(refunded.db, refunded.bob, purchase.secret.id, {}, await chainNow()).revealed, false);
  assert.equal(await balance("bob.testnet"), refundBalance);
  assert.equal(feeCount(refunded, purchase), 0);
  await call("resolve_secret", { id: purchase.id, refund: true }, { failure: true });
  await passed("Secret dispute refund survives SIGKILL inside local activation and never grants paid access");

  const released = await fixture("secret-paid"), paid = released.secret();
  const creatorBefore = await balance("alice.testnet"), feeBefore = await balance("treasury.testnet"), buyerBefore = await balance("bob.testnet");
  await fund(released, paid); await call("confirm_visit", { id: paid.id });
  const realPaid = await view("get_secret", { id: paid.id });
  await Promise.all([worker(released, { barrier: "confirm-together", maxOps: 0 }), worker(released, { barrier: "confirm-together", maxOps: 0 })]);
  assert.equal(feeCount(released, paid), 1);
  assert.equal(sql(released, "mk_reveals", paid).created_at, Number(realPaid.funded_at_ms));
  const together = Math.max(await chainNow(), released.workerTime) + 120_000;
  await Promise.all([worker(released, { now: together }), worker(released, { now: together })]);
  await worker(released);
  assert.equal(await balance("alice.testnet") - creatorBefore, PRICE * 9n / 10n);
  assert.equal(await balance("treasury.testnet") - feeBefore, PRICE / 10n);
  assert.equal(buyerBefore - await balance("bob.testnet"), PRICE);
  assert.equal(market.getSecret(released.db, released.bob, paid.secret.id, {}, await chainNow()).revealed, true);
  const duplicateDeposit = await fund(released, paid);
  assert.ok(duplicateDeposit.receipts_outcome.some((r) => r.outcome.status.Failure));
  assert.equal(buyerBefore - await balance("bob.testnet"), PRICE, "reusing an escrow ID refunds the extra transfer");
  await call("confirm_visit", { id: paid.id }, { failure: true });
  await call("withdraw_for", { account_id: "alice.testnet" }, { failure: true });
  assert.equal(await balance("alice.testnet") - creatorBefore, PRICE * 9n / 10n);
  await passed("fast-settled Secret plus simultaneous funding workers records one fee, one payout and preserves paid access");

  const sends = await fixture("conditional-sends"), returned = sends.transfer();
  const senderBefore = await balance("alice.testnet"); await fund(sends, returned);
  await call("decline_transfer", { id: returned.id }, { sender: "bob.testnet" });
  await worker(sends); await worker(sends);
  assert.equal(await balance("alice.testnet"), senderBefore);
  assert.equal(sql(sends, "mk_transfers", returned).state, "refunded");
  const accepted = sends.transfer(), receiverBefore = await balance("bob.testnet");
  await fund(sends, accepted);
  await call("confirm_transfer", { id: accepted.id }, { sender: "alice.testnet" });
  await worker(sends);
  assert.equal(sql(sends, "mk_transfers", accepted).sender_ok, 1);
  assert.equal(sql(sends, "mk_transfers", accepted).receiver_ok, 0);
  market.actOnTransfer(sends.db, sends.bob, accepted.id, "confirm", {}, await chainNow());
  await worker(sends); await worker(sends);
  assert.equal(await balance("bob.testnet") - receiverBefore, PRICE);
  await call("confirm_transfer", { id: accepted.id }, { failure: true });
  assert.equal(await balance("bob.testnet") - receiverBefore, PRICE);
  await passed("conditional send refunds once or preserves an existing consent and pays once with the normal receiver action");

  const lost = await fixture("lost-withdraw-reply"), lostPayment = lost.secret();
  const lostCreator = await balance("alice.testnet"), lostTreasury = await balance("treasury.testnet");
  await fund(lost, lostPayment); await call("confirm_visit", { id: lostPayment.id });
  await worker(lost, { stopAfter: "withdraw_for" });
  assert.equal(await balance("alice.testnet") - lostCreator, PRICE * 9n / 10n);
  assert.equal(outstandingOps(lost).length, 2, "the first successful chain payout has no local acknowledgement");
  await worker(lost);
  assert.equal(await balance("alice.testnet") - lostCreator, PRICE * 9n / 10n);
  assert.equal(await balance("treasury.testnet") - lostTreasury, PRICE / 10n);
  assert.equal(feeCount(lost, lostPayment), 1);
  const afterLost = outstandingOps(lost);
  assert.equal(afterLost.length, 0, "lost acknowledgement must reconcile to delivered automatically");
  assert.equal(lost.db.prepare("SELECT COUNT(*) n FROM mk_delivery_attempts").get().n, 2, "one signed attempt per recipient, no replacement after response loss");
  await passed("SIGKILL after finalized withdrawal is reconciled without a second transfer or stranded outbox row");

  const failedPush = await fixture("failed-token-push"), failedPurchase = failedPush.secret();
  const pushCreator = await balance("alice.testnet"), pushTreasury = await balance("treasury.testnet");
  await fund(failedPush, failedPurchase); await call("confirm_visit", { id: failedPurchase.id });
  await call("pause", {}, { contract: escrow.tokenId });
  await worker(failedPush);
  assert.equal(await balance("alice.testnet"), pushCreator);
  assert.equal(await balance("treasury.testnet"), pushTreasury);
  const retainedCredit = await view("get_credit", { account_id: "alice.testnet" });
  assert.equal(BigInt(retainedCredit), PRICE * 9n / 10n, "actual failed token receipt restores the creator's escrow credit");
  await call("unpause", {}, { contract: escrow.tokenId });
  await worker(failedPush); await worker(failedPush);
  const undelivered = await balance("alice.testnet") === pushCreator;
  const failedPushOps = failedPush.db.prepare("SELECT method,state,attempts FROM mk_chain_ops ORDER BY seq").all();
  assert.equal(undelivered, false, "restored credit must be delivered automatically after unpause");
  assert.ok(failedPushOps.every((op) => op.state === "sent" && op.attempts === 2));
  assert.equal(failedPush.db.prepare("SELECT COUNT(*) n FROM mk_delivery_attempts WHERE state='retry'").get().n, 2);
  assert.equal(failedPush.db.prepare("SELECT COUNT(*) n FROM mk_delivery_attempts WHERE state='delivered'").get().n, 2);
  assert.equal(await balance("alice.testnet") - pushCreator, PRICE * 9n / 10n);
  assert.equal(await balance("treasury.testnet") - pushTreasury, PRICE / 10n);
  await passed("failed real token transfers retain exact credit and restarted workers automatically pay both recipients once", { automaticWorkerRecovery: true, operatorRecoveryRequired: false });

  const unregistered = await fixture("partial-delivery");
  unregistered.db.prepare("UPDATE players SET native_account='unregistered.testnet' WHERE id=?").run(unregistered.alice);
  const unregisteredSecret = unregistered.secret(), registeredTreasury = await balance("treasury.testnet");
  await fund(unregistered, unregisteredSecret);
  await call("confirm_visit", { id: unregisteredSecret.id });
  assert.equal(await gold("storage_balance_of", { account_id: "unregistered.testnet" }), null);
  await worker(unregistered, { maxOps: 1 });
  assert.equal(await balance("unregistered.testnet"), PRICE * 9n / 10n, "withdraw_for registers its recipient automatically");
  assert.equal(await balance("treasury.testnet"), registeredTreasury);
  await call("pause", {}, { contract: escrow.tokenId });
  await worker(unregistered);
  assert.equal(await view("get_credit", { account_id: "treasury.testnet" }), String(PRICE / 10n));
  assert.equal(unregistered.db.prepare("SELECT COUNT(*) n FROM mk_delivery_attempts WHERE state='retry'").get().n, 1);
  assert.equal(unregistered.db.prepare("SELECT COUNT(*) n FROM mk_delivery_attempts WHERE state='delivered'").get().n, 1);
  await call("unpause", {}, { contract: escrow.tokenId });
  await worker(unregistered); await worker(unregistered);
  assert.equal(await balance("unregistered.testnet"), PRICE * 9n / 10n);
  assert.equal(await balance("treasury.testnet") - registeredTreasury, PRICE / 10n);
  assert.equal(await view("get_credit", { account_id: "unregistered.testnet" }), "0");
  assert.equal(outstandingOps(unregistered).length, 0);
  assert.equal(unregistered.db.prepare("SELECT COUNT(*) n FROM mk_delivery_attempts").get().n, 3);
  await passed("partial delivery registers and pays the creator once, then recovers only the failed treasury share after restart");

  const partial = await fixture("partial-task"), multi = partial.task({ slots: 2 });
  await fund(partial, multi); await call("approve_task", { id: multi.id, worker: "bob.testnet" });
  await worker(partial);
  assert.equal(partial.row(multi.id).state, "waiting");
  assert.equal(sql(partial, "mk_tasks", multi).state, "funding");
  assert.equal(partial.db.prepare("SELECT COUNT(*) n FROM mk_chain_ops").get().n, 0);
  await passed("partly consumed real collateral remains unresolved instead of reopening the full task");

  const timed = await fixture("chain-clock"), expired = timed.transfer({ days: 1 }), timedSecret = timed.secret();
  const disputed = timed.secret();
  await fund(timed, expired); await fund(timed, timedSecret); await fund(timed, disputed);
  await call("dispute_secret", { id: disputed.id }, { sender: "bob.testnet" });
  const startTime = await chainNow();
  const response = await fetch(sandbox.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: "advance", method: "sandbox_fast_forward", params: { delta_height: 8 * 86_400 * 10 } }) });
  const advanced = await response.json(); assert.ok(!advanced.error, JSON.stringify(advanced.error));
  let advancedNow;
  for (let i = 0; i < 100; i++) { advancedNow = await chainNow(); if (advancedNow >= startTime + 8 * DAY) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(advancedNow >= startTime + 8 * DAY);
  report.timeAdvance = { before: startTime, after: advancedNow, elapsedDays: (advancedNow - startTime) / DAY };
  await call("refund_transfer", { id: expired.id });
  await call("release_secret", { id: timedSecret.id });
  await call("release_secret", { id: disputed.id }, { failure: true });
  await worker(timed); await worker(timed);
  assert.equal(sql(timed, "mk_transfers", expired).state, "refunded");
  assert.equal(sql(timed, "mk_reveals", timedSecret).state, "released");
  assert.equal(sql(timed, "mk_reveals", disputed).state, "disputed");
  assert.equal(sql(timed, "mk_reveals", disputed).held_u, GOLD);
  assert.equal(sql(timed, "mk_reveals", timedSecret).created_at, Number((await view("get_secret", { id: timedSecret.id })).funded_at_ms));
  await passed("actual chain time permits expired-send refund and seven-day Secret release while preserving a dispute");

  report.finalStats = await conserved();
  report.finalTokenSupply = await gold("ft_total_supply");
  assert.equal(report.finalTokenSupply, report.initialTokenSupply, "settlement/replay does not mint new QGOLD");
  report.assertionsPassed = true;
  report.passed = report.findings.length === 0;
  if (report.findings.length) process.exitCode = 2;
  report.releaseReady = false;
} catch (error) {
  report.passed = false; report.failure = { message: error.message, stack: error.stack };
  console.error(error.stack); process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  for (const db of databases) if (db.isOpen) db.close();
  if (sandbox) await sandbox.tearDown(true);
  rmSync(dir, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

// Opt-in keeper integration against real wNEAR, archived Ref/Rhea, and QGOLD WASM.
// No public RPC, application environment, real key files, or production database.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { KeyPair } from "near-api-js";
import { openDatabase } from "../../server/database.mjs";
import { QgoldKeeper } from "../../server/qgold/keeper.mjs";
import { escrowLocalTransport } from "./escrow-rpc.mjs";

const [sandboxModule, wasmDirectory, reportPath, selection = ""] = process.argv.slice(2);
assert.ok(sandboxModule && wasmDirectory && reportPath, "arguments: sandbox module, WASM directory, report path");
const { Sandbox, GenesisAccount } = await import(pathToFileURL(resolve(sandboxModule)));
const NEAR = 10n ** 24n, GOLD = 10n ** 6n, NOW = Date.parse("2026-11-06T01:00:00Z");
const manifest = JSON.parse(readFileSync(new URL("./keeper-wasm-artifacts.json", import.meta.url)));
const artifacts = {}, report = { startedAt: new Date().toISOString(), scope: "loopback local chain only", wasm: {}, scenarios: [], transactions: [], workers: [], findings: [], releaseReady: false };
for (const [name, artifact] of Object.entries(manifest)) {
  const code = readFileSync(join(wasmDirectory, artifact.filename));
  const sha256 = createHash("sha256").update(code).digest("hex");
  assert.equal(sha256, artifact.sha256, `${name} WASM must match the reviewed fixture`);
  artifacts[name] = code; report.wasm[name] = { ...artifact, bytes: code.length };
}
const dir = mkdtempSync(join(tmpdir(), "questlayer-keeper-wasm-fixture-"));
const keys = new Map(), transports = new Map(), children = new Set(), databases = new Set();
const accounts = ["owner", "qgold", "wrap", "dex", "treasury", ...Array.from({ length: 40 }, (_, i) => `keeper${i}`)].map((name) => {
  const id = `${name}.testnet`, key = KeyPair.fromRandom("ed25519"); keys.set(id, key);
  return new GenesisAccount(id, key.getPublicKey().toString(), key.toString(), 1_000_000n * NEAR);
});
let sandbox, owner, fixtureIndex = 0, activeFixture;
const transport = async (accountId) => {
  if (!transports.has(accountId)) transports.set(accountId, await escrowLocalTransport({ rpcUrl: sandbox.rpcUrl, accountId, secretKey: keys.get(accountId).toString() }));
  return transports.get(accountId);
};
const view = (token, method, args = {}) => owner.view(`${token}.testnet`, method, args);
const balance = async (token, account_id) => BigInt(await view(token, "ft_balance_of", { account_id }));
async function call(token, method, args = {}, deposit = 0n, sender = "owner.testnet", failure = false) {
  const outcome = await (await transport(sender)).call(`${token}.testnet`, method, args, deposit, 250n * 10n ** 12n);
  report.transactions.push({ source: "fixture", method, response: outcome });
  assert.equal(!!outcome.status?.Failure, failure, `${token}.${method}: ${JSON.stringify(outcome.status)}`);
  return outcome;
}
const amountOf = (outcome) => JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString());
async function snapshot(f) {
  const [qgold, wnear, vault, pool, native] = await Promise.all([
    balance("qgold", f.accountId), balance("wrap", f.accountId), view("qgold", "get_state"),
    view("dex", "get_pool", { pool_id: f.poolId }), owner.provider.viewAccount({ accountId: f.accountId }),
  ]);
  return { qgold: String(qgold), wnear: String(wnear), supply: vault.supply, burned: vault.burned_total,
    native: native.amount, pool: pool.amounts };
}
const rows = (f) => ({
  operations: f.db.prepare("SELECT id,kind,state,reserved_near,reserved_qgold,last_error FROM qgold_keeper_ops ORDER BY position").all(),
  steps: f.db.prepare("SELECT step,attempt,tx,state,request,proof FROM qgold_keeper_steps ORDER BY rowid").all(),
  sent: f.db.prepare("SELECT COUNT(*) n FROM qgold_keeper_actions WHERE state='sent'").get().n,
});
async function fixture(mode = "inverse", { registerWnear = true, registerQgold = true, registerDex = false } = {}) {
  const index = fixtureIndex++, accountId = `keeper${index}.testnet`, dbPath = join(dir, `keeper${index}.sqlite`);
  const rate = BigInt((await view("qgold", "get_state")).rate), multiplier = mode === "sale" ? 1500n : mode === "buyback" ? 1050n : 800n;
  const amounts = [String(1000n * NEAR), String(1000n * NEAR * GOLD * 1000n / (rate * multiplier))];
  const poolId = Number(amountOf(await call("dex", "add_simple_pool", { tokens: ["wrap.testnet", "qgold.testnet"], fee: 30 }, NEAR / 10n)));
  for (const [i, token] of ["wrap", "qgold"].entries())
    await call(token, "ft_transfer_call", { receiver_id: "dex.testnet", amount: amounts[i], msg: "" }, 1n);
  await call("dex", "add_liquidity", { pool_id: poolId, amounts, min_amounts: amounts }, NEAR / 10n);
  if (registerWnear) await call("wrap", "storage_deposit", { account_id: accountId, registration_only: true }, NEAR / 10n);
  if (registerDex) await call("dex", "storage_deposit", { account_id: accountId }, NEAR);
  if (registerQgold) {
    await call("qgold", "storage_deposit", { account_id: accountId, registration_only: true }, NEAR / 10n);
    // A real unrelated balance must survive buy-and-burn recovery untouched.
    await call("qgold", "ft_transfer", { receiver_id: accountId, amount: String(11n * GOLD) }, 1n);
  }
  const db = openDatabase(dbPath); databases.add(db);
  new QgoldKeeper(db, { vault: { contractId: "qgold.testnet" } });
  db.prepare("INSERT INTO qgold_keeper_days VALUES(?,?,?,?,?,?,?,?)").run("2026-11-06", "fixture-commitment", "fixture-salt", NOW - 100_000, 1, "fixture-seed", 2,
    JSON.stringify([NOW - 1000, ...Array.from({ length: 11 }, (_, i) => NOW + (i + 1) * 7_200_000)]));
  const f = { mode, accountId, poolId, dbPath, db, runs: 0 };
  f.before = await snapshot(f); activeFixture = f; return f;
}
async function intercept(action) {
  if (action === "pause-qgold") return call("qgold", "pause");
  if (action === "pause-rhea") return call("dex", "change_state", { state: "Paused" }, 1n);
  throw Error(`Unknown fixture action ${action}`);
}
async function worker(f, options = {}) {
  const sequence = f.runs++, leaseNow = NOW + sequence * 120_000;
  const child = fork(new URL("./keeper-worker-child.mjs", import.meta.url), [], {
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);
  const run = { scenario: f.accountId, sequence, ...options, code: null, signal: null }, messages = [];
  report.workers.push(run);
  let stderr = ""; child.stderr.on("data", (data) => { stderr += data; });
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(Error("keeper worker timeout")); }, 90_000);
    child.stdout.on("data", (data) => { if (data.toString().includes("KEEPER_COMMIT_BOUNDARY")) { run.boundary = "commit"; child.kill("SIGKILL"); } });
    child.on("message", (message) => {
      messages.push(message);
      if (message.type === "transaction") report.transactions.push({ source: "worker", scenario: f.accountId, ...message });
      if (message.type === "boundary") { run.boundary = message; child.kill("SIGKILL"); }
      if (message.type === "intercept") intercept(message.action).then(() => child.send({ type: "continue" }), (error) => { child.kill("SIGKILL"); reject(error); });
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timeout); children.delete(child); Object.assign(run, { code, signal });
      const error = messages.find((m) => m.type === "error");
      run.result = messages.find((m) => m.type === "done")?.result;
      try {
        assert.ok(!error, error?.message);
        if (options.stop) { assert.ok(run.boundary, JSON.stringify(run.result)); assert.equal(signal, "SIGKILL"); }
        else { assert.equal(code, 0, stderr); assert.ok(run.result); }
        resolve(run);
      } catch (error) { reject(error); }
    });
  });
  child.send({ rpcUrl: sandbox.rpcUrl, accountId: f.accountId, secretKey: keys.get(f.accountId).toString(), dbPath: f.dbPath,
    poolId: f.poolId, mode: f.mode, subject: process.env.KEEPER_SANDBOX_SUBJECT,
    now: options.now ?? NOW + sequence * 120_000, leaseNow: options.leaseNow ?? leaseNow, ...options });
  return done;
}
async function completed(f, { attempts = f.mode === "sale" ? 2 : 3 } = {}) {
  const r = rows(f), after = await snapshot(f);
  assert.equal(r.operations.length, 1, JSON.stringify(r.operations));
  assert.equal(r.operations[0].state, "done", JSON.stringify(r));
  assert.equal(r.sent, 1); assert.equal(r.steps.length, attempts);
  assert.equal(r.steps.filter((s) => s.state === "succeeded" && s.step === 0).length, 1, "funded exactly once");
  const swap = r.steps.find((s) => s.step === 1 && s.state === "succeeded"), output = BigInt(JSON.parse(swap.proof).amount);
  if (f.mode !== "sale") {
    assert.equal(after.qgold, f.before.qgold, "only the acquired output is burned; unrelated tokens survive");
    assert.equal(after.wnear, f.before.wnear);
    assert.equal(BigInt(f.before.supply) - BigInt(after.supply), output);
    assert.equal(BigInt(after.burned) - BigInt(f.before.burned), output);
    assert.equal(BigInt(after.pool[0]) - BigInt(f.before.pool[0]), BigInt(JSON.parse(swap.request).args.amount));
  } else {
    assert.equal(BigInt(after.wnear) - BigInt(f.before.wnear), output);
    assert.equal(after.burned, f.before.burned);
    const mint = BigInt(JSON.parse(r.steps.find((s) => s.step === 0 && s.state === "succeeded").proof).amount);
    assert.equal(BigInt(after.qgold) - BigInt(f.before.qgold), mint - BigInt(JSON.parse(swap.request).args.amount));
  }
  // Principal debit is bounded independently by the actual NEAR account. Gas is
  // additional, small and nonzero; it must not hide a second 1+ NEAR purchase.
  const principal = BigInt(r.operations[0].reserved_near), debit = BigInt(f.before.native) - BigInt(after.native);
  assert.ok(debit > principal && debit < principal + NEAR / 20n, `principal/gas debit ${debit}`);
  await worker(f, { now: NOW + 3_600_000 });
  assert.deepEqual(await snapshot(f), after, "another tick cannot repeat any chain movement");
  assert.equal(rows(f).steps.length, attempts);
  return { before: f.before, after, principal: String(principal), gasAndYoctoDeposits: String(debit - principal), journal: rows(f) };
}
async function scenario(name, body) {
  if (selection && !name.includes(selection)) return;
  activeFixture = null;
  const start = report.workers.length;
  try {
    const details = await body(); report.scenarios.push({ name, passed: true, workers: report.workers.length - start, ...details }); console.log(`PASS ${name}`);
  } catch (error) {
    const evidence = activeFixture ? { journal: rows(activeFixture), before: activeFixture.before, after: await snapshot(activeFixture) } : {};
    report.scenarios.push({ name, passed: false, error: error.message, workers: report.workers.length - start, ...evidence });
    report.findings.push({ scenario: name, message: error.message }); console.log(`FAIL ${name}: ${error.message.slice(0, 200)}`);
  } finally {
    // Restore only synthetic contracts for independent scenarios after failures.
    if ((await view("qgold", "get_state")).paused) await call("qgold", "unpause");
    if ((await view("dex", "metadata")).state === "Paused") await call("dex", "change_state", { state: "Running" }, 1n);
  }
}

try {
  sandbox = await Sandbox.start({ version: "2.14.0", config: { additionalAccounts: accounts, additionalGenesis: { epoch_length: 10_000_000 } } });
  owner = await transport("owner.testnet");
  report.node = { chainId: owner.status.chain_id, version: owner.status.version.version, protocol: owner.status.protocol_version, host: new URL(sandbox.rpcUrl).hostname };
  console.log(`Local NEAR ${report.node.version} ready`);
  for (const [account, name] of [["qgold", "qgold"], ["wrap", "wnear"], ["dex", "rhea"]])
    await (await transport(`${account}.testnet`)).account.deployContract(artifacts[name]);
  await call("wrap", "new");
  await call("qgold", "new", { council: ["owner.testnet"], threshold: 1, guardian_id: "owner.testnet", treasury_id: "treasury.testnet",
    minters: ["owner.testnet"], initial_rate: String(10n ** 21n), metadata: { spec: "ft-1.0.0", name: "Local QGOLD", symbol: "QGOLD", decimals: 6 } });
  await call("dex", "new", { owner_id: "owner.testnet", boost_farm_id: "unused-farm.testnet", burrowland_id: "unused-lending.testnet", exchange_fee: 1600, referral_fee: 400 });
  report.rheaMetadata = await view("dex", "metadata");
  await call("dex", "extend_whitelisted_tokens", { tokens: ["wrap.testnet", "qgold.testnet"] }, 1n);
  await call("dex", "storage_deposit", { account_id: "owner.testnet" }, NEAR);
  for (const token of ["wrap", "qgold"]) await call(token, "storage_deposit", { account_id: "dex.testnet", registration_only: true }, NEAR / 10n);
  await call("qgold", "mint_for", { account_id: "owner.testnet", memo: "synthetic local liquidity" }, 100_000n * NEAR);
  await call("wrap", "near_deposit", {}, 100_000n * NEAR);

  await scenario("inverse: actual wrap, Rhea swap and burn conserve principal and unrelated tokens", async () => {
    const f = await fixture(); await worker(f); return completed(f);
  });
  for (const method of ["near_deposit", "ft_transfer_call", "ft_burn"]) for (const phase of ["before", "after"])
    await scenario(`SIGKILL ${phase} ${method}: exact transaction recovery`, async () => {
      const f = await fixture(); await worker(f, { stop: { phase, method } });
      await worker(f, { now: NOW + 3_600_001 }); return completed(f);
    });
  await scenario("SIGKILL during final accounting: chain steps survive database rollback", async () => {
    const f = await fixture(); await worker(f, { stop: { phase: "commit" } }); await worker(f); return completed(f);
  });
  await scenario("lost swap reply and unavailable status: exact-byte replay cannot spend twice", async () => {
    const f = await fixture(); await worker(f, { loseReply: "ft_transfer_call" });
    const before = await snapshot(f), tx = rows(f).steps.at(-1).tx;
    await worker(f, { hideStatus: true });
    assert.equal(rows(f).steps.filter((s) => s.step === 1).length, 1);
    assert.equal(rows(f).steps.find((s) => s.step === 1).tx, tx);
    // Replaying an executed nonce may reject; a later status lookup must finish.
    assert.equal((await snapshot(f)).pool[0], before.pool[0]);
    await worker(f); return completed(f);
  });
  await scenario("Rhea paused: failed swap refunds all input; restart swaps without wrapping twice", async () => {
    const f = await fixture(); await worker(f, { intercept: { phase: "before", method: "ft_transfer_call", action: "pause-rhea" } });
    const failed = rows(f), afterFailure = await snapshot(f);
    assert.equal(failed.steps.at(-1).state, "retry", JSON.stringify(failed));
    assert.equal(BigInt(afterFailure.wnear), NEAR); assert.deepEqual(afterFailure.pool, f.before.pool);
    await call("dex", "change_state", { state: "Running" }, 1n); await worker(f); return { afterFailure, ...await completed(f, { attempts: 4 }) };
  });
  await scenario("QGOLD paused after swap: burn rejection retries only burn after restart", async () => {
    const f = await fixture(); await worker(f, { intercept: { phase: "before", method: "ft_burn", action: "pause-qgold" } });
    const afterFailure = await snapshot(f), failed = rows(f);
    assert.equal(failed.steps.at(-1).state, "retry", JSON.stringify(failed));
    assert.ok(BigInt(afterFailure.qgold) > BigInt(f.before.qgold)); assert.equal(afterFailure.burned, f.before.burned);
    await call("qgold", "unpause"); await worker(f); return { afterFailure, ...await completed(f, { attempts: 4 }) };
  });
  await scenario("two concurrent OS workers: one reservation and one set of chain steps", async () => {
    const f = await fixture(); await Promise.all([worker(f, { leaseNow: NOW }), worker(f, { leaseNow: NOW })]); return completed(f);
  });
  await scenario("unregistered wNEAR: actual storage deduction cannot cause a second wrap", async () => {
    const f = await fixture("inverse", { registerWnear: false }); await worker(f); return completed(f);
  });
  await scenario("missing QGOLD output storage: automatic registration, lost-found claim and original burn", async () => {
    const f = await fixture("inverse", { registerQgold: false });
    const lostfoundArgs = { account_id: f.accountId, token_id: "qgold.testnet" };
    const lostfoundBefore = await view("dex", "get_lostfound_token", lostfoundArgs);
    await worker(f);
    const result = await completed(f, { attempts: 5 });
    const lostfoundAfter = await view("dex", "get_lostfound_token", lostfoundArgs);
    assert.equal(lostfoundBefore, "0"); assert.equal(lostfoundAfter, "0");
    return { ...result, lostfoundBefore, lostfoundAfter, recoveredAutomatically: true };
  });
  for (const method of ["storage_deposit", "claim_lostfound"]) for (const phase of ["before", "after"])
    await scenario(`recovery SIGKILL ${phase} ${method}: resume one retained output`, async () => {
      const f = await fixture("inverse", { registerQgold: false });
      await worker(f, { stop: { phase, method } }); await worker(f);
      return completed(f, { attempts: 5 });
    });
  for (const [method, action] of [["claim_lostfound", "pause-rhea"], ["claim_lostfound", "pause-qgold"], ["ft_burn", "pause-qgold"]])
    await scenario(`recovery rejected ${method} with ${action}: no duplicate swap or claim`, async () => {
      const f = await fixture("inverse", { registerQgold: false });
      await worker(f, { intercept: { phase: "before", method, action } });
      const afterFailure = await snapshot(f), failed = rows(f);
      assert.equal(failed.operations[0].state, "pending"); assert.equal(failed.steps.at(-1).state, "retry", JSON.stringify(failed));
      if (action === "pause-rhea") await call("dex", "change_state", { state: "Running" }, 1n); else await call("qgold", "unpause");
      await worker(f); return { afterFailure, ...await completed(f, { attempts: 6 }) };
    });
  await scenario("recovery lost claim reply: zero lost-found balance still resumes the same transaction", async () => {
    const f = await fixture("inverse", { registerQgold: false }); await worker(f, { loseReply: "claim_lostfound" });
    assert.equal(await view("dex", "get_lostfound_token", { account_id: f.accountId, token_id: "qgold.testnet" }), "0");
    const claim = rows(f).steps.find((s) => s.step === 101); assert.equal(claim.state, "prepared");
    await worker(f); assert.equal(rows(f).steps.find((s) => s.step === 101).tx, claim.tx);
    return completed(f, { attempts: 5 });
  });
  await scenario("recovery two processes claim and burn the retained output once", async () => {
    const f = await fixture("inverse", { registerQgold: false });
    await Promise.all([worker(f, { leaseNow: NOW }), worker(f, { leaseNow: NOW })]);
    return completed(f, { attempts: 5 });
  });
  await scenario("recovery from registered Rhea deposit withdraws only the original output", async () => {
    const f = await fixture("inverse", { registerQgold: false, registerDex: true }); await worker(f);
    const result = await completed(f, { attempts: 5 });
    assert.equal(JSON.parse(rows(f).steps.find((s) => s.step === 101).request).methodName, "withdraw");
    assert.equal((await view("dex", "get_deposits", { account_id: f.accountId }))["qgold.testnet"], "0");
    return result;
  });
  await scenario("recovery refuses mixed lost-found inventory without another purchase", async () => {
    const f = await fixture("inverse", { registerQgold: false });
    await worker(f, { stop: { phase: "after", method: "ft_transfer_call" } });
    const swap = rows(f).steps.find(s => s.step === 1), request = JSON.parse(swap.request);
    const original = await view("dex", "get_lostfound_token", { account_id: f.accountId, token_id: "qgold.testnet" });
    // An independently funded swap puts unrelated inventory into the same
    // amount-less Rhea lost-found bucket before keeper reconciliation.
    await call("wrap", "near_deposit", {}, NEAR / 10n, f.accountId);
    await call("wrap", "ft_transfer_call", { ...request.args, amount: String(NEAR / 10n),
      msg: JSON.stringify({ force: 0, actions: [{ pool_id: f.poolId, token_in: "wrap.testnet", token_out: "qgold.testnet", min_amount_out: "1" }] }) }, 1n, f.accountId);
    const mixed = await view("dex", "get_lostfound_token", { account_id: f.accountId, token_id: "qgold.testnet" });
    assert.ok(BigInt(mixed) > BigInt(original));
    const before = await snapshot(f); await worker(f); await worker(f);
    const after = await snapshot(f), journal = rows(f);
    assert.equal(journal.operations[0].state, "pending"); assert.match(journal.operations[0].last_error, /ambiguous/);
    assert.equal(journal.steps.filter(s => s.step === 0).length, 1); assert.equal(journal.steps.filter(s => s.step === 1).length, 1);
    assert.ok(!journal.steps.some(s => [2, 101].includes(s.step))); assert.equal(after.burned, before.burned); assert.deepEqual(after.pool, before.pool);
    assert.equal(await view("dex", "get_lostfound_token", { account_id: f.accountId, token_id: "qgold.testnet" }), mixed);
    return { original, mixed, before, after, journal, heldForReconciliation: true };
  });
  // Sales generate real vault fees; run them after fee-free inverse scenarios.
  await scenario("sale: actual QGOLD deposit and Rhea swap", async () => { const f = await fixture("sale"); await worker(f); return completed(f); });
  await scenario("sale missing wNEAR storage: automatically recover output without buying QGOLD twice", async () => {
    const f = await fixture("sale", { registerWnear: false }); await worker(f);
    const result = await completed(f, { attempts: 4 });
    assert.equal(await view("dex", "get_lostfound_token", { account_id: f.accountId, token_id: "wrap.testnet" }), "0");
    return result;
  });
  for (const method of ["deposit", "ft_transfer_call"])
    await scenario(`sale SIGKILL after ${method}: no duplicate vault purchase`, async () => {
      const f = await fixture("sale"); await worker(f, { stop: { phase: "after", method } }); await worker(f); return completed(f);
    });
  await scenario("sale vault rejection: no minted tokens or lost principal; restart retries safely", async () => {
    const f = await fixture("sale"); await worker(f, { intercept: { phase: "before", method: "deposit", action: "pause-qgold" } });
    const failed = rows(f), afterFailure = await snapshot(f);
    assert.equal(failed.steps[0].state, "retry"); assert.equal(afterFailure.qgold, f.before.qgold);
    assert.ok(BigInt(f.before.native) - BigInt(afterFailure.native) < NEAR / 20n);
    await call("qgold", "unpause"); await worker(f); return { afterFailure, ...await completed(f, { attempts: 3 }) };
  });
  await scenario("buyback: real fee-funded budget, wrap, swap, burn and repeated restart", async () => {
    const f = await fixture("buyback"); await worker(f); return completed(f);
  });
  report.passed = report.findings.length === 0;
  report.counts = { scenarios: report.scenarios.length, passed: report.scenarios.filter((s) => s.passed).length,
    workers: report.workers.length, sigkills: report.workers.filter((w) => w.signal === "SIGKILL").length };
  if (!report.passed) process.exitCode = 2;
} catch (error) {
  report.passed = false; report.failure = { message: error.message, stack: error.stack }; console.error(error.stack); process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  for (const db of databases) if (db.isOpen) db.close();
  if (sandbox) await sandbox.tearDown(true);
  rmSync(dir, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  // RPC error results may carry SDK BigInts. Public signatures are unnecessary
  // in evidence; preserve hashes, actions and the complete receipt graph.
  writeFileSync(reportPath, JSON.stringify(report, (key, value) => key === "signature" ? undefined : typeof value === "bigint" ? String(value) : value, 2));
}

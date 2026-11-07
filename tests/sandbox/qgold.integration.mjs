// Opt-in actual-WASM test. See docs/QGOLD-SANDBOX-2026-11-06.md.
// No production transport, environment files, keys, database or public RPC.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { KeyPair } from "near-api-js";
import { openDatabase } from "../../server/database.mjs";
import { ensurePayoutSchema, pendingPayout } from "../../server/payouts/worker.mjs";
import { buildPayoutDay } from "../../server/payouts/payout-tree.mjs";
import { localTransport, receiptSummary } from "./qgold-rpc.mjs";

const [sandboxModule, wasmDirectory, reportPath] = process.argv.slice(2);
assert.ok(sandboxModule && wasmDirectory && reportPath, "arguments: sandbox module, WASM directory, report path");
const { Sandbox, GenesisAccount } = await import(pathToFileURL(resolve(sandboxModule)));
const NEAR = 10n ** 24n, UNIT = 10n ** 15n;
const keys = new Map();
const ids = ["owner", "rewards", "qgold", "withdrawal", ...Array.from({ length: 10 }, (_, i) => `player${i}`)];
const accounts = ids.map((name) => {
  const id = `${name}.testnet`, key = KeyPair.fromRandom("ed25519");
  keys.set(id, key);
  return new GenesisAccount(id, key.getPublicKey().toString(), key.toString(), 200n * NEAR);
});
const attestor = KeyPair.fromRandom("ed25519");
const dir = mkdtempSync(join(tmpdir(), "questlayer-qgold-sandbox-fixture-"));
const report = { startedAt: new Date().toISOString(), scope: "local sandbox only", scenarios: [], transactions: [], workerRuns: [] };
let sandbox;
const children = new Set();
const barriers = new Map();
const artifacts = {};
for (const name of ["rewards", "qgold"]) {
  const code = readFileSync(join(wasmDirectory, `questlayer_${name}.wasm`));
  assert.equal(code.subarray(0, 4).toString("hex"), "0061736d");
  artifacts[name] = code;
  (report.wasm ??= {})[name] = { sha256: createHash("sha256").update(code).digest("hex"), bytes: code.length };
}
function passed(name, details = {}) {
  report.scenarios.push({ name, passed: true, ...details });
  console.log(`PASS ${name}`);
}
async function worker(dbPath, options = {}) {
  const messages = [];
  const child = fork(new URL("./qgold-worker-child.mjs", import.meta.url), [], {
    // Do not forward a real application's environment to the test worker.
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.add(child);
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data.toString(); });
  const run = { pid: child.pid, stopped: null, ...options };
  report.workerRuns.push(run);
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(Error("worker timeout")); }, 90_000);
    child.on("message", (message) => {
      messages.push(message);
      if (message.type === "barrier-ready") {
        const waiting = barriers.get(message.group) ?? [];
        waiting.push(child);
        barriers.set(message.group, waiting);
        if (waiting.length === 2) {
          for (const waiter of waiting) waiter.send({ type: "release" });
          barriers.delete(message.group);
        }
      }
      if (message.type === "transaction") report.transactions.push({ source: "worker", ...message });
      if (message.type.startsWith("stopped-")) {
        run.stopped = message.type;
        child.kill("SIGKILL");
      }
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      children.delete(child);
      Object.assign(run, { code, signal });
      const error = messages.find((m) => m.type === "error");
      if (error) return reject(Error(error.message));
      if (run.stopped) {
        assert.equal(signal, "SIGKILL");
      } else if (code !== 0 || !messages.some((m) => m.type === "done")) {
        return reject(Error(`worker exited ${code}: ${stderr.slice(0, 1000)}`));
      }
      resolve(messages);
    });
    child.on("error", reject);
  });
  child.send({
    rpcUrl: sandbox.rpcUrl, secretKey: keys.get("owner.testnet").toString(),
    accountId: "owner.testnet", dbPath, now: Date.now(), ...options,
  });
  return completed;
}
function fixture(label, count = 2, { date, coinsShare } = {}) {
  const dbPath = join(dir, `${label}.sqlite`), db = openDatabase(dbPath);
  ensurePayoutSchema(db);
  const dateString = date ?? "2026-11-05";
  const tree = buildPayoutDay({
    dayId: `payout-${dateString}-v1`,
    entries: Array.from({ length: count }, (_, i) => ({ accountId: `player${i}.testnet`, amountYocto: (BigInt(i) + 1n) * 10n ** 18n })),
    coinsShareYocto: coinsShare ?? null,
  });
  const now = Date.now() - 60_000;
  db.prepare("INSERT INTO payout_days VALUES(?,?,?,?,?,?,'pending',NULL,NULL,NULL,NULL,?,?)")
    .run(tree.dayId, dateString, tree.root, JSON.stringify(tree.publish), String(tree.total), count, now, now);
  for (const c of tree.claims) {
    db.prepare("INSERT INTO payout_claims VALUES(?,?,?,?,?,'queued',NULL,0,NULL,?)")
      .run(tree.dayId, c.index, c.account_id, c.amount_yocto, JSON.stringify(c.proof), now);
    db.prepare("INSERT INTO payout_items VALUES(?,'coin',?,?,?,?,?)")
      .run(`${label}-${c.index}`, tree.dayId, `player-${c.index}`, c.account_id, c.amount_yocto, now);
  }
  db.close();
  return { dbPath, tree };
}
function inspectDb(path, fn) {
  const db = openDatabase(path);
  try { return fn(db); } finally { db.close(); }
}
try {
  sandbox = await Sandbox.start({ version: "2.14.0", config: {
    additionalAccounts: accounts,
    // Keep the four-day clock jump within one epoch; otherwise the sandbox
    // waits for real blocks at every intervening epoch boundary.
    additionalGenesis: { epoch_length: 10_000_000 },
  } });
  const transport = async (id) => localTransport({ rpcUrl: sandbox.rpcUrl, accountId: id, secretKey: keys.get(id).toString() });
  const owner = await transport("owner.testnet");
  report.node = { chainId: owner.status.chain_id, version: owner.status.version.version, protocolVersion: owner.status.protocol_version, rpcHost: new URL(sandbox.rpcUrl).hostname };
  console.log(`Local NEAR ${report.node.version} ready`);
  const view = (method, args = {}) => owner.view("rewards.testnet", method, args);
  const gold = (method, args = {}) => owner.view("qgold.testnet", method, args);
  const balance = (id) => gold("ft_balance_of", { account_id: id });
  const call = async (method, args = {}, deposit = 0n, contractId = "rewards.testnet", sender = owner) => {
    const outcome = await sender.call(contractId, method, args, deposit);
    report.transactions.push({ source: "runner", method, ...receiptSummary(outcome) });
    return outcome;
  };
  for (const name of ["rewards", "qgold"]) {
    const signer = await transport(`${name}.testnet`);
    await signer.account.deployContract(artifacts[name]);
  }
  await call("new", { owner_id: "owner.testnet", publisher_id: "owner.testnet", attestor: Buffer.from(attestor.getPublicKey().data).toString("base64") });
  await call("new", {
    council: ["owner.testnet"], threshold: 1, guardian_id: "owner.testnet", treasury_id: "owner.testnet",
    minters: ["rewards.testnet"], initial_rate: String(10n ** 21n),
    metadata: { spec: "ft-1.0.0", name: "Sandbox QGOLD", symbol: "QGOLD", decimals: 6 },
  }, 0n, "qgold.testnet");
  await call("set_qgold_vault", { account_id: "qgold.testnet" });
  await call("fund_rewards", { source: "sponsor", receipt_id: "sandbox-funding" }, 10n * NEAR + 5n * 10n ** 21n);

  // Earn through the real attested gameplay path, with no state patching.
  const block = await owner.provider.viewBlock({ finality: "final" });
  const time = Number(BigInt(block.header.timestamp_nanosec) / 1_000_000n);
  const amount = 10n ** 19n;
  const dayId = "plzen-2026-11-06-v1";
  await call("publish_day", {
    day_id: dayId, starts_at: String(time - 1000), ends_at: String(time + 3_600_000), manifest_hash: "a".repeat(64),
    coin_count: 4, coin_unit: String(amount), finds: [],
    quests: Array.from({ length: 6 }, () => ({ reward: "0", xp: 10, tier: 1, opens_at: String(time - 1000), closes_at: String(time + 3_600_000) })),
  });
  const earn = async (index) => {
    const claim = { receipt_id: `sandbox-coin-${index}`, day_id: dayId, kind: "coin", index, receiver_id: "withdrawal.testnet", received_at: String(time), evidence_hash: "b".repeat(64) };
    const message = await view("claim_message", { claim });
    const signature = Buffer.from(attestor.sign(Buffer.from(message)).signature).toString("base64");
    await call("claim", { claim, signature });
    return { claim, signature };
  };
  const player = await transport("withdrawal.testnet");
  const firstClaim = await earn(0);
  const initialMint = await gold("get_state");
  const withdrawal = await call("withdraw", {}, 1n, "rewards.testnet", player);
  assert.equal(await balance("withdrawal.testnet"), String(amount / UNIT));
  assert.deepEqual(await view("get_account", { account_id: "withdrawal.testnet" }), { credit: "0", pending: "0", withdrawn: String(amount), xp: 2 });
  const mintReceipt = withdrawal.receipts_outcome.find((r) => r.outcome.executor_id === "qgold.testnet" && r.outcome.status.SuccessValue);
  assert.ok(mintReceipt, "real mint returns a nonempty JSON U128");
  assert.equal(JSON.parse(Buffer.from(mintReceipt.outcome.status.SuccessValue, "base64").toString()), String(amount / UNIT));
  // The locked release profile strips panic strings. Assert rejection and the
  // monetary state, not a debug-only message.
  await assert.rejects(() => call("withdraw", {}, 1n, "rewards.testnet", player));
  await call("claim", firstClaim);
  assert.equal((await view("get_account", { account_id: "withdrawal.testnet" })).credit, "0");
  assert.equal(BigInt((await gold("get_state")).minted_total) - BigInt(initialMint.minted_total), amount / UNIT);
  passed("withdrawal: real U128 callback clears credit; repeated withdrawal and receipt cannot pay twice");

  await earn(1);
  await call("pause", {}, 0n, "qgold.testnet");
  const beforeFail = await gold("get_state");
  const failedWithdrawal = await call("withdraw", {}, 1n, "rewards.testnet", player);
  assert.ok(failedWithdrawal.receipts_outcome.some((r) => r.outcome.executor_id === "qgold.testnet" && r.outcome.status.Failure));
  assert.deepEqual(await view("get_account", { account_id: "withdrawal.testnet" }), { credit: String(amount), pending: "0", withdrawn: String(amount), xp: 4 });
  assert.equal((await gold("get_state")).minted_total, beforeFail.minted_total);
  // A failure does not prevent earning the next coin.
  await earn(2);
  assert.equal((await view("get_account", { account_id: "withdrawal.testnet" })).credit, String(2n * amount));
  await call("unpause", {}, 0n, "qgold.testnet");
  await call("withdraw", {}, 1n, "rewards.testnet", player);
  assert.equal(await balance("withdrawal.testnet"), String(3n * amount / UNIT));
  assert.equal((await view("get_account", { account_id: "withdrawal.testnet" })).credit, "0");
  passed("withdrawal: actual mint failure restores credit, continued earning and retry pay exactly once");

  const crash = fixture("crash-after-mint", 10);
  const before = await gold("get_state");
  await worker(crash.dbPath, { stopAfter: "claim_payout" });
  const progress = await view("get_payout_progress", { day_id: crash.tree.dayId, indexes: crash.tree.claims.map((c) => c.index) });
  assert.deepEqual(progress.statuses, Array(10).fill("paid"));
  inspectDb(crash.dbPath, (db) => {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n, 0);
    assert.ok(BigInt(pendingPayout(db, "player-0").yocto) > 0n);
  });
  const recovered = await worker(crash.dbPath, { clockOffset: 180_000 });
  assert.equal(recovered.filter((m) => m.type === "transaction" && m.method === "claim_payout").length, 0);
  inspectDb(crash.dbPath, (db) => {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n, 10);
    assert.equal(pendingPayout(db, "player-0").yocto, "0");
  });
  assert.equal(BigInt((await gold("get_state")).minted_total) - BigInt(before.minted_total), crash.tree.total / UNIT);
  // Bypass the worker guard deliberately: the contract must also reject repeats.
  await call("claim_payout", { day_id: crash.tree.dayId, claims: crash.tree.claims });
  assert.equal(BigInt((await gold("get_state")).minted_total) - BigInt(before.minted_total), crash.tree.total / UNIT);
  for (const c of crash.tree.claims) assert.equal(await balance(c.account_id), String(BigInt(c.amount_yocto) / UNIT));
  passed("nightly: SIGKILL after a ten-leaf mint, restart and direct replay cause exactly ten payments");

  const failed = fixture("failed-mint", 2, { date: "2026-11-04", coinsShare: 15n * 10n ** 17n });
  await call("pause", {}, 0n, "qgold.testnet");
  const mintBeforeFailure = await gold("get_state");
  await worker(failed.dbPath, { stopAfter: "claim_payout" });
  assert.equal((await gold("get_state")).minted_total, mintBeforeFailure.minted_total);
  const failedDay = await view("get_payout_day", { day_id: failed.tree.dayId });
  const failedProgress = await view("get_payout_progress", { day_id: failed.tree.dayId, indexes: [0, 1] });
  assert.deepEqual(failedProgress.statuses, ["unclaimed", "unclaimed"]);
  assert.equal(failedProgress.pending_leaves, 0);
  assert.equal(failedDay.coins_left, failed.tree.publish.coins_yocto);
  assert.equal(failedDay.zones_left, failed.tree.publish.zones_yocto);
  inspectDb(failed.dbPath, (db) => assert.equal(pendingPayout(db, "player-1").yocto, failed.tree.claims[1].amount_yocto));
  await call("unpause", {}, 0n, "qgold.testnet");
  await worker(failed.dbPath, { clockOffset: 180_000, now: Date.now() + 1_000_000 });
  await worker(failed.dbPath, { clockOffset: 180_000, now: Date.now() + 1_060_000 });
  assert.deepEqual((await view("get_payout_progress", { day_id: failed.tree.dayId, indexes: [0, 1] })).statuses, ["paid", "paid"]);
  assert.equal(BigInt((await gold("get_state")).minted_total) - BigInt(mintBeforeFailure.minted_total), failed.tree.total / UNIT);
  inspectDb(failed.dbPath, (db) => assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n, 2));
  passed("nightly: failed real mints restore both treasury buckets; restart retries without losing or duplicating rewards");

  const beforeSend = fixture("crash-before-send", 2, { date: "2026-11-03" });
  await worker(beforeSend.dbPath, { stopBefore: "claim_payout" });
  assert.deepEqual((await view("get_payout_progress", { day_id: beforeSend.tree.dayId, indexes: [0, 1] })).statuses, ["unclaimed", "unclaimed"]);
  await worker(beforeSend.dbPath, { clockOffset: 180_000, now: Date.now() + 1_000_000 });
  await worker(beforeSend.dbPath, { clockOffset: 180_000, now: Date.now() + 1_060_000 });
  inspectDb(beforeSend.dbPath, (db) => assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n, 2));
  passed("nightly: SIGKILL after durable intent but before submission is recovered by a new process");

  const publishCrash = fixture("crash-after-publish", 2, { date: "2026-11-02" });
  await worker(publishCrash.dbPath, { stopAfter: "publish_payout_day" });
  assert.ok(await view("get_payout_day", { day_id: publishCrash.tree.dayId }));
  const publishRecovery = await worker(publishCrash.dbPath, { clockOffset: 180_000 });
  assert.equal(publishRecovery.filter((m) => m.type === "transaction" && m.method === "publish_payout_day").length, 0);
  await worker(publishCrash.dbPath, { clockOffset: 180_000, now: Date.now() + 60_000 });
  inspectDb(publishCrash.dbPath, (db) => assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n, 2));
  passed("nightly: restart recovers a published day whose transaction response was lost");

  // Two independent durable outboxes intentionally bypass the single-DB lease.
  // Both must observe unclaimed leaves before either submits the transaction.
  const race = fixture("concurrent-workers", 2, { date: "2026-11-01" });
  await call("publish_payout_day", race.tree.publish);
  const raceReplica = join(dir, "concurrent-workers-replica.sqlite");
  inspectDb(race.dbPath, (db) => db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get());
  writeFileSync(raceReplica, readFileSync(race.dbPath));
  const beforeRace = await gold("get_state");
  const racers = await Promise.all([
    worker(race.dbPath, { barrierGroup: "two-outboxes" }),
    worker(raceReplica, { barrierGroup: "two-outboxes" }),
  ]);
  assert.equal(racers.flat().filter((m) => m.type === "transaction" && m.method === "claim_payout").length, 2);
  assert.equal(BigInt((await gold("get_state")).minted_total) - BigInt(beforeRace.minted_total), race.tree.total / UNIT);
  await worker(race.dbPath, { now: Date.now() + 60_000 });
  await worker(raceReplica, { now: Date.now() + 60_000 });
  for (const path of [race.dbPath, raceReplica]) inspectDb(path, (db) => assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n, 2));
  passed("nightly: two actual worker processes submit the same unclaimed leaves concurrently; contract pays once");

  const partial = fixture("partial-completion", 2, { date: "2026-10-31" });
  await call("publish_payout_day", partial.tree.publish);
  const beforePartial = await gold("get_state");
  await call("claim_payout", { day_id: partial.tree.dayId, claims: [partial.tree.claims[0]] });
  const partialRecovery = await worker(partial.dbPath);
  assert.equal(partialRecovery.filter((m) => m.type === "transaction" && m.method === "claim_payout").length, 1);
  assert.deepEqual(partialRecovery.find((m) => m.type === "transaction" && m.method === "claim_payout").indexes, [1]);
  await worker(partial.dbPath, { now: Date.now() + 60_000 });
  assert.equal(BigInt((await gold("get_state")).minted_total) - BigInt(beforePartial.minted_total), partial.tree.total / UNIT);
  inspectDb(partial.dbPath, (db) => assert.equal(db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n, 2));
  passed("nightly: a partly paid day reconciles the paid leaf and sends only the outstanding leaf");

  const overdue = fixture("overdue-unpaid", 2, { date: "2026-10-30" });
  await call("publish_payout_day", overdue.tree.publish);
  const beforeTime = await owner.provider.viewBlock({ finality: "final" });
  const startTime = BigInt(beforeTime.header.timestamp_nanosec);
  const targetTime = startTime + 4n * 86_400_000_000_000n;
  // The sandbox RPC advances real local chain height/time. Contract time and
  // final views remain authoritative; no storage or method responses are mocked.
  const response = await fetch(sandbox.rpcUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: "advance", method: "sandbox_fast_forward", params: { delta_height: 4 * 86_400 * 10 } }),
  });
  const advanced = await response.json();
  assert.ok(!advanced.error, JSON.stringify(advanced.error));
  let afterTime;
  for (let attempt = 0; attempt < 100; attempt++) {
    afterTime = await owner.provider.viewBlock({ finality: "final" });
    if (BigInt(afterTime.header.timestamp_nanosec) >= targetTime) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  report.timeAdvance = { before: beforeTime.header.timestamp_nanosec, after: afterTime.header.timestamp_nanosec };
  assert.ok(BigInt(afterTime.header.timestamp_nanosec) >= targetTime, "sandbox must actually advance beyond the grace period");
  const overdueBefore = await view("get_payout_day", { day_id: overdue.tree.dayId });
  await assert.rejects(() => call("close_payout_day", { day_id: overdue.tree.dayId }));
  assert.deepEqual(await view("get_payout_day", { day_id: overdue.tree.dayId }), overdueBefore);
  const beforeOverdue = await gold("get_state");
  const chainNow = Number(BigInt(afterTime.header.timestamp_nanosec) / 1_000_000n);
  await worker(overdue.dbPath, { now: chainNow });
  await worker(overdue.dbPath, { now: chainNow + 60_000 });
  assert.equal((await view("get_payout_day", { day_id: overdue.tree.dayId })).closed, true);
  assert.deepEqual((await view("get_payout_progress", { day_id: overdue.tree.dayId, indexes: [0, 1] })).statuses, ["paid", "paid"]);
  await assert.rejects(() => call("claim_payout", { day_id: overdue.tree.dayId, claims: overdue.tree.claims }));
  assert.equal(BigInt((await gold("get_state")).minted_total) - BigInt(beforeOverdue.minted_total), overdue.tree.total / UNIT);
  inspectDb(overdue.dbPath, (db) => assert.equal(pendingPayout(db, "player-0").yocto, "0"));
  passed("nightly: unpaid rights survive four chain days; settlement then closes safely and retains replay protection");

  const utcStart=Math.ceil((chainNow+3600000)/86400000)*86400000,worldDate=new Date(utcStart).toISOString().slice(0,10),worldId=`world-${worldDate}-v1`;
  const worldTree=buildPayoutDay({dayId:`payout-world-${worldDate}-v1`,entries:[{accountId:'player8.testnet',amountYocto:10n**16n+7n},{accountId:'player9.testnet',amountYocto:2n*10n**16n+11n}],coinsShareYocto:0n});
  const reserve={day_id:worldId,manifest_hash:'d'.repeat(64),starts_at:String(utcStart),ends_at:String(utcStart+86400000),coins_yocto:'0',zones_yocto:String(worldTree.total+13n)};
  const treasuryBefore=await view('get_treasury');await call('reserve_world_day',reserve);await call('reserve_world_day',reserve);
  const reserved=await view('get_treasury'),dateCap=await view('get_date_totals',{date:worldDate});
  assert.equal(BigInt(treasuryBefore.zones.available)-BigInt(reserved.zones.available),worldTree.total+13n);
  await assert.rejects(()=>call('reserve_world_day',{...reserve,manifest_hash:'e'.repeat(64)}));
  await assert.rejects(()=>call('record_world_earned',{day_id:worldId,coins_yocto:'0',zones_yocto:String(worldTree.total)}));
  // Advance the real chain beyond the earning window. The trusted publisher
  // reports already accepted GPS evidence, including the final dust balance.
  const advance=await fetch(sandbox.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({jsonrpc:'2.0',id:'world-advance',method:'sandbox_fast_forward',params:{delta_height:3*86400*10}})});
  assert.ok(!(await advance.json()).error);
  for(let i=0;i<100;i++){const b=await owner.provider.viewBlock({finality:'final'});if(Number(BigInt(b.header.timestamp_nanosec)/1000000n)>utcStart+86400000)break;await new Promise(r=>setTimeout(r,100));}
  await call('record_world_earned',{day_id:worldId,coins_yocto:'0',zones_yocto:String(worldTree.total)});
  await call('close_world_day',{day_id:worldId,earned_coins:'0',earned_zones:String(worldTree.total)});
  const closedWorld=await view('get_treasury');assert.equal(BigInt(closedWorld.zones.available)-BigInt(reserved.zones.available),13n);
  const move={day_id:worldTree.dayId,root:worldTree.root,leaves:worldTree.claims.length,sources:[{world_day_id:worldId,coins_yocto:'0',zones_yocto:String(worldTree.total)}]};
  await call('move_world_to_payout',move);await call('move_world_to_payout',move);
  assert.deepEqual(await view('get_date_totals',{date:worldDate}),dateCap);
  assert.deepEqual(await view('get_treasury'),closedWorld);
  await call('pause',{},0n,'qgold.testnet');await call('claim_payout',{day_id:worldTree.dayId,claims:worldTree.claims});
  assert.deepEqual((await view('get_payout_progress',{day_id:worldTree.dayId,indexes:[0,1]})).statuses,['unclaimed','unclaimed']);
  assert.deepEqual(await view('get_treasury'),closedWorld);
  await call('unpause',{},0n,'qgold.testnet');
  const beforeWorldMint=await gold('get_state');
  await call('claim_payout',{day_id:worldTree.dayId,claims:worldTree.claims});
  assert.deepEqual((await view('get_payout_progress',{day_id:worldTree.dayId,indexes:[0,1]})).statuses,['paid','paid']);
  for(const leaf of worldTree.claims){const receipt=await gold('get_game_conversion',{minter_id:'rewards.testnet',memo:`world payout ${worldTree.dayId}:${leaf.index}`});assert.equal(receipt.account_id,leaf.account_id);assert.equal(BigInt(receipt.consumedYocto)+BigInt(receipt.carryYocto),BigInt(leaf.amount_yocto));assert.equal(await gold('get_mint_carry',{minter_id:'rewards.testnet',account_id:leaf.account_id}),receipt.carryYocto);}
  const afterWorldMint=await gold('get_state');assert.equal(BigInt(afterWorldMint.mint_carry_total),18n);assert.equal(BigInt(afterWorldMint.backing)-BigInt(beforeWorldMint.backing),worldTree.total-18n);
  await call('claim_payout',{day_id:worldTree.dayId,claims:worldTree.claims});assert.deepEqual(await gold('get_state'),afterWorldMint);
  passed('world: pre-opening reservation, immutable replay, exact unused release, no second date charge, real mint failure/retry and durable account-bound NEAR carry',{day:worldId,carryYocto:afterWorldMint.mint_carry_total});

  report.finalQgold = await gold("get_state");
  report.finalTreasury = await view("get_treasury");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  if (sandbox) await sandbox.tearDown(true);
  rmSync(dir, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
}

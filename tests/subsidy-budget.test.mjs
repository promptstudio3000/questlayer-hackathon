import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair, actions } from "near-api-js";
import { createPlayer, openDatabase } from "../server/database.mjs";
import { SubsidyBudget } from "../server/relayer/subsidy-budget.mjs";
import { ManagedAccounts } from "../server/relayer/accounts.mjs";
import { fixture, NEAR, FACTORY, outcomeFor } from "./relayer-fixture.mjs";
const pk = () => KeyPair.fromRandom("ed25519").getPublicKey().toString();

test("reservations of relays that fail before any transaction are released and never carry across days (N2)", async (t) => {
  const f = fixture({ subsidyLimits: { dailyYocto: NEAR, gasReserveYocto: NEAR / 100n, dailyOperations: 1000 } });
  t.after(() => f.db.close());
  const alice = f.ready(f.player, "alice-novakova");
  const jobs = [];
  for (let i = 0; i < 5; i++) jobs.push(await f.relayer.submit(f.player, { signedDelegateBase64: await f.sign(alice) }));
  assert.equal(f.accounts.subsidyBudget.snapshot().pending, 5);
  // The first relay is FINAL-rejected; the account's later relays can never execute.
  f.transport.onSend = async ({ hash, signedDelegate }) =>
    outcomeFor(signedDelegate, { hash, failure: { ActionError: { index: 0, kind: "DelegateActionExpired" } } });
  assert.deepEqual(await f.relayer.runRelayJobs(), { completed: 0, failed: 1, retried: 0 });
  assert.deepEqual(jobs.map((j) => f.job(j.id).error_code), ["RELAY_EXPIRED", "RELAY_BLOCKED", "RELAY_BLOCKED", "RELAY_BLOCKED", "RELAY_BLOCKED"]);
  const rows = f.rows("subsidy_reservations");
  assert.deepEqual(rows.map((r) => r.state), ["spent", "released", "released", "released", "released"]);
  assert.ok(rows.slice(1).every((r) => r.reserved === "0"), "nothing left the treasury for a job that never signed");
  const today = f.accounts.subsidyBudget.snapshot();
  assert.deepEqual([today.pending, today.operations, today.reservedYocto], [0, 1, rows[0].reserved]);
  f.advance(2 * 86_400_000);
  const later = f.accounts.subsidyBudget.snapshot();
  assert.deepEqual([later.pending, later.operations, later.reservedYocto], [0, 0, "0"]);
});
test("a pre-send ACCOUNT_TAKEN releases the creation reservation back to today's budget (N2)", async (t) => {
  // Exactly one creation fits: 0.1 NEAR funding + 0.01 NEAR gas reserve.
  const f = fixture({ subsidyLimits: { dailyYocto: (11n * NEAR) / 100n, gasReserveYocto: NEAR / 100n, dailyOperations: 1000 } });
  t.after(() => f.db.close());
  await f.accounts.create(f.player, { publicKey: pk() });
  const bob = createPlayer(f.db, "Bob");
  await assert.rejects(f.accounts.create(bob, { publicKey: pk() }), (e) => e.code === "SUBSIDY_BUDGET");
  const job = f.db.prepare("SELECT * FROM relay_jobs WHERE kind='create-account'").get();
  // Someone else creates the account on chain with a different key before the worker runs.
  f.state.add(job.account_id, { amount: NEAR, keys: [["ed25519:" + "1".repeat(44), 0, "FullAccess"]] });
  assert.deepEqual(await f.relayer.runRelayJobs(), { completed: 0, failed: 1, retried: 0 });
  assert.equal(f.job(job.id).error_code, "ACCOUNT_TAKEN");
  assert.equal(f.factory.calls.length, 0, "no transaction was ever sent");
  assert.deepEqual(f.rows("subsidy_reservations").map((r) => [r.state, r.reserved]), [["released", "0"]]);
  assert.equal(f.accounts.subsidyBudget.snapshot().pending, 0);
  // The freed budget serves another explorer today.
  const created = await f.accounts.create(bob, { publicKey: pk() });
  assert.equal(created.account.state, "creating");
  f.advance(3 * 86_400_000);
  assert.equal(f.accounts.subsidyBudget.snapshot().pending, 1, "only the live reservation carries over");
});
test("a released reservation id competes for the budget again when it is reserved anew", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const budget = new SubsidyBudget(db, { dailyYocto: 12n, dailyOperations: 10, gasReserveYocto: 2n, clock: () => 1_000 });
  const request = { kind: "relay", accountId: "alice.testnet", principal: 10n };
  budget.reserve("one", request);
  assert.throws(() => budget.reserve("two", request), (e) => e.code === "SUBSIDY_BUDGET");
  assert.equal(budget.release("one"), true);
  assert.equal(budget.release("one"), false, "release is idempotent and never touches a settled row");
  assert.deepEqual([budget.snapshot().operations, budget.snapshot().reservedYocto], [0, "0"]);
  assert.equal(budget.reserve("two", request).state, "reserved");
  assert.throws(() => budget.reserve("one", request), (e) => e.code === "SUBSIDY_BUDGET", "a released id does not ride on its old row");
  budget.release("two");
  assert.equal(budget.reserve("one", request).state, "reserved");
  budget.settle("one", "hash");
  assert.equal(budget.release("one"), false);
  assert.equal(db.prepare("SELECT state FROM subsidy_reservations WHERE id='one'").get().state, "spent");
});

test("unconfigured sponsorship fails closed without affecting free player creation", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const b = new SubsidyBudget(db);
  const player = createPlayer(db, "Solo explorer");
  assert.ok(player);
  assert.throws(
    () =>
      b.reserve("one", {
        kind: "relay",
        accountId: "a.testnet",
        principal: "1",
      }),
    (e) => e.code === "SUBSIDY_DISABLED",
  );
  assert.equal(b.snapshot().operations, 0);
});
test("atomic reservations enforce one global amount across unrelated players and services", async (t) => {
  const f = fixture({
    subsidyLimits: { dailyYocto: NEAR / 5n, gasReserveYocto: NEAR / 100n },
  });
  t.after(() => f.db.close());
  await f.accounts.create(f.player, { publicKey: pk() });
  const bob = createPlayer(f.db, "Bob");
  await assert.rejects(
    f.accounts.create(bob, { publicKey: pk() }),
    (e) => e.code === "SUBSIDY_BUDGET",
  );
  assert.equal(f.rows("managed_accounts").length, 1);
  assert.equal(f.factory.calls.length, 0);
  const a = f.ready(bob, "bob");
  const signedDelegateBase64 = await f.sign(
    { ...a, playerId: bob },
    {
      action: actions.functionCall(
        "equip_aura",
        { token_id: "aura:polar:1" },
        50000000000000n,
        0n,
      ),
    },
  );
  await f.relayer.submit(bob, { signedDelegateBase64 });
  assert.equal(
    f.accounts.subsidyBudget.snapshot().reservedYocto,
    String((12n * NEAR) / 100n),
  );
});
test("unknown sponsorship carries across midnight and refunds are not spent a second time", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let now = Date.parse("2026-11-07T23:59:59Z");
  const budget = new SubsidyBudget(db, {
    dailyYocto: 20n,
    dailyOperations: 2,
    gasReserveYocto: 2n,
    clock: () => now,
  });
  const req = { kind: "topup", accountId: "alice.testnet", principal: "10" };
  budget.reserve("unknown", req);
  now += 2000;
  assert.throws(
    () => budget.reserve("next", req),
    (e) => e.code === "SUBSIDY_BUDGET",
  );
  assert.equal(budget.reserve("unknown", req).reserved, "12");
  budget.settle("unknown", "proved-final-hash");
  budget.reserve("next", req);
  assert.equal(budget.snapshot().operations, 1);
  assert.throws(
    () => budget.reserve("same-day-after-refund", req),
    (e) => e.code === "SUBSIDY_BUDGET",
  );
});
test("a changed reservation and a second database budget instance cannot bypass the cap", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const opts = { dailyYocto: 20n, dailyOperations: 1, gasReserveYocto: 2n },
    a = new SubsidyBudget(db, opts),
    b = new SubsidyBudget(db, opts);
  const request = { kind: "relay", accountId: "a.testnet", principal: "1" };
  a.reserve("same", request);
  assert.throws(
    () => b.reserve("same", { ...request, principal: "2" }),
    (e) => e.code === "SUBSIDY_MISMATCH",
  );
  assert.throws(
    () => b.reserve("other", request),
    (e) => e.code === "SUBSIDY_BUDGET",
  );
  assert.equal(b.reserve("same", request).reserved, "3");
});
test("lost topup reply survives a worker restart even if the beneficiary spends the transfer", async (t) => {
  const f = fixture(),
    account = f.ready(f.player, "alice", { amount: 0n });
  t.after(() => f.db.close());
  const original = f.factory.signAndSendTransaction;
  let lost = true;
  f.factory.signAndSendTransaction = async (request) => {
    const result = await original(request);
    if (lost) {
      lost = false;
      throw Error("lost response after transfer");
    }
    return result;
  };
  await assert.rejects(
    f.accounts.ensureFunded(account.accountId, NEAR / 100n, {
      jobId: "one-payment",
    }),
    (e) => e.code === "FUNDING_PENDING",
  );
  assert.equal(f.state.accounts.get(account.accountId).amount, NEAR / 100n);
  f.state.accounts.get(account.accountId).amount = 0n;
  const restarted = new ManagedAccounts(f.db, f.state.provider, f.factory, {
    factoryId: FACTORY,
    topupCapYocto: NEAR / 5n,
    subsidyBudget: f.accounts.subsidyBudget,
    clock: f.clock,
  });
  await restarted.ensureFunded(account.accountId, NEAR / 100n, {
    jobId: "one-payment",
  });
  assert.equal(f.factory.calls.length, 1);
  assert.equal(f.state.accounts.get(account.accountId).amount, 0n);
  assert.equal(f.rows("managed_account_funding").length, 1);
  assert.equal(f.rows("native_funding_attempts").length, 1);
  assert.equal(f.accounts.subsidyBudget.snapshot().pending, 0);
});
test("concurrent topups reserve account and global budget before sending", async (t) => {
  const f = fixture({ topupCapYocto: NEAR / 100n }),
    account = f.ready(f.player, "alice", { amount: 0n });
  t.after(() => f.db.close());
  const settled = await Promise.allSettled(
    ["first", "second"].map((jobId) =>
      f.accounts.ensureFunded(account.accountId, NEAR / 100n, { jobId }),
    ),
  );
  assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.factory.calls.length, 1);
  assert.equal(f.state.accounts.get(account.accountId).amount, NEAR / 100n);
  assert.equal(f.rows("subsidy_reservations").length, 1);
});
test("a stale worker after signing cannot broadcast a native funding transfer", async (t) => {
  const f = fixture(),
    account = f.ready(f.player, "alice", { amount: 0n });
  t.after(() => f.db.close());
  await assert.rejects(
    f.accounts.ensureFunded(account.accountId, NEAR / 100n, {
      jobId: "fenced",
      write: () => {
        throw Error("Relay worker lease expired.");
      },
    }),
    /lease expired/,
  );
  assert.equal(f.factory.calls.length, 0);
  assert.equal(f.rows("native_funding_attempts").length, 0);
});

test("actual fee overruns trip a persistent shared breaker across restart and midnight", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let now = Date.parse("2026-11-07T23:59:59Z");
  const options = {
    dailyYocto: 100n,
    dailyOperations: 10,
    gasReserveYocto: 2n,
    clock: () => now,
  };
  const budget = new SubsidyBudget(db, options),
    request = { kind: "relay", accountId: "alice.testnet", principal: 10n };
  budget.reserve("paid", request);
  budget.reserve("queued", request);
  budget.settle("paid", "final-hash", {
    transaction_outcome: { outcome: { tokens_burnt: "1" } },
    receipts_outcome: [{ outcome: { tokens_burnt: "3" } }],
  });
  assert.equal(
    db.prepare("SELECT state FROM subsidy_reservations WHERE id='paid'").get()
      .state,
    "overrun",
  );
  assert.equal(
    db
      .prepare("SELECT reserved FROM subsidy_reservations WHERE id='paid'")
      .get().reserved,
    "14",
  );
  now += 86400000;
  const restarted = new SubsidyBudget(db, options);
  for (const id of ["queued", "new"])
    assert.throws(
      () => restarted.reserve(id, request),
      (e) => e.code === "SUBSIDY_GAS_OVERRUN",
    );
});

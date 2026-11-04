import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { createPlayer } from "../server/database.mjs";
import { FACTORY, NEAR, NOW, fixture } from "./relayer-fixture.mjs";

const key = () => KeyPair.fromRandom("ed25519").getPublicKey().toString();

test("slugs are lowercase ASCII, dash separated, bounded and never empty", (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const s = (name) => f.accounts.slugFor(name);
  assert.equal(s("Alice Nováková!"), "alice-novakova");
  assert.equal(s("  Řehoř__von   Ťuk "), "rehor-von-tuk");
  assert.equal(s(""), "explorer");
  assert.equal(s("---"), "explorer");
  assert.equal(s("x"), "explorer");
  assert.equal(s("a".repeat(80)), "a".repeat(32));
  assert.equal(
    s("abcdefghijklmnopqrstuvwxyz01234-xyz"),
    "abcdefghijklmnopqrstuvwxyz01234",
  );
  assert.equal(s("Ⅻ 🎮 gamer"), "xii-gamer");
  assert.ok(`${s("a".repeat(80))}.${FACTORY}`.length <= 64);
});

test("one managed account per player; colliding names and taken on-chain names get a suffix", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const view = await f.accounts.create(f.player, { publicKey: key() });
  assert.equal(view.account.accountId, `alice-novakova.${FACTORY}`);
  assert.equal(view.account.state, "creating");
  assert.equal(view.account.keys[0].state, "pending");
  assert.equal(view.account.creation.state, "queued");
  const again = await f.accounts.create(f.player, {
    publicKey: key(),
    name: "Different",
  });
  assert.equal(
    again.account.accountId,
    view.account.accountId,
    "the first request wins",
  );
  assert.equal(f.rows("managed_accounts").length, 1);
  assert.equal(f.rows("relay_jobs").length, 1);
  const twin = createPlayer(f.db, "Alice Nováková", NOW);
  const twinView = await f.accounts.create(twin, { publicKey: key() });
  assert.match(
    twinView.account.accountId,
    new RegExp(
      `^alice-novakova-[0-9a-f]{4}\\.${FACTORY.replaceAll(".", "\\.")}$`,
    ),
  );
  f.state.add(`carol.${FACTORY}`);
  const carol = createPlayer(f.db, "Carol", NOW);
  assert.match(
    (await f.accounts.create(carol, { publicKey: key() })).account.accountId,
    /^carol-[0-9a-f]{4}\./,
  );
  await assert.rejects(
    f.accounts.create(createPlayer(f.db, "Dan", NOW), {
      publicKey: "ed25519:short",
    }),
    /invalid/,
  );
  await assert.rejects(
    f.accounts.create(createPlayer(f.db, "Eve", NOW), {
      publicKey: "secp256k1:" + "1".repeat(64),
    }),
    /ed25519|invalid/i,
  );
  assert.equal(
    f.accounts.view(createPlayer(f.db, "Nobody", NOW)).account,
    null,
  );
});

test("the worker creates the account with the player's full-access key, links it and records funding", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const publicKey = key();
  const view = await f.accounts.create(f.player, { publicKey });
  const accountId = view.account.accountId;
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 1,
    failed: 0,
    retried: 0,
  });
  assert.equal(f.factory.calls.length, 1);
  const [call] = f.factory.calls;
  assert.equal(call.receiverId, accountId);
  assert.ok(call.actions[0].createAccount);
  assert.equal(call.actions[1].transfer.deposit, NEAR / 10n);
  assert.equal(call.actions[2].addKey.publicKey.toString(), publicKey);
  assert.ok(call.actions[2].addKey.accessKey.permission.fullAccess);
  const ready = f.accounts.view(f.player).account;
  assert.equal(ready.state, "ready");
  assert.equal(ready.transactionHash, "F1");
  assert.equal(ready.fundedYocto, (NEAR / 10n).toString());
  assert.equal(ready.keys[0].state, "active");
  assert.equal(ready.creation.state, "confirmed");
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        f.db.prepare("SELECT account_id,player_id FROM wallet_links").all(),
      ),
    ),
    [{ account_id: accountId, player_id: f.player }],
  );
  assert.equal(
    f.db.prepare("SELECT native_account FROM players WHERE id=?").get(f.player)
      .native_account,
    accountId,
  );
  const funding = f.rows("managed_account_funding");
  assert.equal(funding.length, 1);
  assert.equal(funding[0].kind, "initial");
  assert.equal(funding[0].amount_yocto, (NEAR / 10n).toString());
  assert.equal(
    f.state.accounts.get(accountId).keys.get(publicKey).permission,
    "FullAccess",
  );
  // Re-running changes nothing and sends nothing.
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 0,
    retried: 0,
  });
  assert.equal(f.factory.calls.length, 1);
});

test("a lost creation response is reconciled from the chain; a stolen name fails and can be retried", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const publicKey = key();
  const first = (await f.accounts.create(f.player, { publicKey })).account
    .accountId;
  f.state.add(first, { amount: NEAR / 10n, keys: [[publicKey]] });
  await f.relayer.runRelayJobs();
  assert.equal(
    f.factory.calls.length,
    0,
    "existing account with our key needs no transaction",
  );
  assert.equal(f.accounts.view(f.player).account.state, "ready");
  const bob = createPlayer(f.db, "Bob", NOW);
  const bobAccount = (await f.accounts.create(bob, { publicKey: key() }))
    .account.accountId;
  f.state.add(bobAccount, { amount: NEAR, keys: [[key()]] });
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 1,
    retried: 0,
  });
  const failed = f.accounts.view(bob).account;
  assert.equal(failed.state, "failed");
  assert.equal(failed.errorCode, "ACCOUNT_TAKEN");
  assert.equal(failed.creation.state, "failed");
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) n FROM wallet_links WHERE player_id=?")
      .get(bob).n,
    0,
  );
  const retry = await f.accounts.create(bob, {
    publicKey: key(),
    name: "Bob Second",
  });
  assert.equal(retry.account.accountId, `bob-second.${FACTORY}`);
  assert.equal(retry.account.state, "creating");
  assert.equal(f.rows("managed_accounts").length, 2);
  // Factory funding problems retry instead of burning the account slot.
  f.factory.calls.length = 0;
  const original = f.factory.signAndSendTransaction;
  f.factory.signAndSendTransaction = async (input) => ({
    ...(await original.call(f.factory, { ...input, actions: [] })),
    status: {
      Failure: {
        ActionError: {
          index: 1,
          kind: { LackBalanceForState: { account_id: FACTORY, amount: "1" } },
        },
      },
    },
  });
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 0,
    retried: 1,
  });
  const job = f.db
    .prepare("SELECT * FROM relay_jobs WHERE account_id=?")
    .get(retry.account.accountId);
  assert.equal(job.error_code, "FACTORY_UNDERFUNDED");
  assert.equal(f.accounts.view(bob).account.state, "creating");
  f.factory.signAndSendTransaction = original;
  f.advance(5000);
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 1,
    failed: 0,
    retried: 0,
  });
  assert.equal(f.accounts.view(bob).account.state, "ready");
});

test("top-ups stay within the per-account daily cap and are recorded", async (t) => {
  const f = fixture({ topupCapYocto: NEAR / 10n });
  t.after(() => f.db.close());
  const acct = f.ready(f.player, "alice-novakova", { amount: 2n * 10n ** 22n });
  assert.deepEqual(await f.accounts.ensureFunded(acct.accountId, 10n ** 22n), {
    toppedUp: false,
    balance: (2n * 10n ** 22n).toString(),
  });
  const first = await f.accounts.ensureFunded(acct.accountId, 6n * 10n ** 22n, {
    jobId: "relay_x",
  });
  assert.equal(first.toppedUp, true);
  assert.equal(first.amount, (4n * 10n ** 22n).toString());
  assert.equal(f.state.accounts.get(acct.accountId).amount, 6n * 10n ** 22n);
  assert.equal(
    f.relayer.budget(acct.accountId).topupYocto,
    (4n * 10n ** 22n).toString(),
  );
  const second = await f.accounts.ensureFunded(
    acct.accountId,
    12n * 10n ** 22n,
  );
  assert.equal(second.amount, (6n * 10n ** 22n).toString());
  await assert.rejects(
    f.accounts.ensureFunded(acct.accountId, 13n * 10n ** 22n),
    (e) => e.code === "RELAY_TOPUP_CAP" && e.terminal === true,
  );
  assert.equal(f.rows("managed_account_funding").length, 2);
  assert.deepEqual(
    f
      .rows("managed_account_funding")
      .map((r) => [r.kind, r.amount_yocto, r.job_id]),
    [
      ["topup", (4n * 10n ** 22n).toString(), "relay_x"],
      ["topup", (6n * 10n ** 22n).toString(), null],
    ],
  );
  f.advance(86400000);
  assert.equal(
    (await f.accounts.ensureFunded(acct.accountId, 13n * 10n ** 22n)).toppedUp,
    true,
  );
  await assert.rejects(
    f.accounts.ensureFunded("ghost." + FACTORY, 1n),
    (e) => e.code === "ACCOUNT_MISSING",
  );
  const keyless = f.ready(createPlayer(f.db, "Zed", NOW), "zed");
  assert.throws(
    () => f.accounts.requestKeyRemoval(f.player, { publicKey: acct.publicKey }),
    /at least one active key/,
  );
  assert.equal(keyless.accountId, `zed.${FACTORY}`);
});

test("account ids stay within NEAR's 64 characters under a long factory id", async () => {
  const { ManagedAccounts } = await import("../server/relayer/accounts.mjs");
  const live = Object.create(ManagedAccounts.prototype);
  live.factoryId = "play-20261101.questlayer-dev-20261101.testnet";
  for (const name of ["test phone-390 brno", "a".repeat(24), "Lubos z Prahy na vylete"]) {
    const id = `${live.slugFor(name)}.${live.factoryId}`;
    assert.ok(id.length <= 64, `${id} is ${id.length} characters`);
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*\./);
  }
});

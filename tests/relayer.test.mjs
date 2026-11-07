import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair, PublicKey, actions } from "near-api-js";
import { backoff } from "../server/relayer/relay.mjs";
import {
  CONTRACTS,
  FACTORY,
  NEAR,
  NOW,
  RELAYER,
  encode,
  fixture,
  outcomeFor,
} from "./relayer-fixture.mjs";

test("prepare, submit, pre-flight funding and verified confirmation of a sponsored mint", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const acct = f.ready(f.player, "alice-novakova", { amount: NEAR / 100n });
  const prepared = await f.relayer.prepare(f.player, {
    accountId: acct.accountId,
    receiverId: CONTRACTS.collectibles,
    methodName: "mint_avatar",
  });
  assert.equal(prepared.nonce, "101");
  assert.equal(prepared.maxBlockHeight, "5120");
  assert.equal(prepared.relayer, RELAYER);
  assert.equal(prepared.remainingJobs, 40);
  const base64 = await f.sign(acct);
  const job = await f.relayer.submit(f.player, {
    signedDelegateBase64: base64,
    preview: { receiverId: CONTRACTS.collectibles, methodName: "mint_avatar" },
  });
  assert.equal(job.state, "queued");
  assert.equal(job.duplicate, false);
  assert.equal(job.sponsorDeposit, true);
  assert.equal(f.relayer.budget(acct.accountId).jobs, 1);
  await assert.rejects(
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, { nonce: 102n }),
      preview: { methodName: "equip_aura" },
    }),
    /differs from the reviewed preview/,
  );
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 1,
    failed: 0,
    retried: 0,
  });
  const done = f.relayer.status(f.player, job.id);
  assert.equal(done.state, "confirmed");
  assert.equal(done.transactionHash, "T1");
  assert.deepEqual(done.result, {
    transactionHash: "T1",
    tokenId: `avatar:${acct.accountId}`,
    methodName: "mint_avatar",
    receiverId: CONTRACTS.collectibles,
  });
  // The relayer's own transaction carries the 0.05 NEAR storage deposit
  // (NEP-366); the player's account is not topped up for it.
  assert.deepEqual(f.rows("managed_account_funding"), []);
  assert.equal(f.factory.calls.length, 0);
  assert.equal(f.relayer.budget(acct.accountId).topupYocto, "0");
  assert.equal(f.transport.sends[0].receiverId, acct.accountId);
  assert.equal(f.relayer.list(f.player, acct.accountId).jobs.length, 1);
  assert.equal(f.relayer.workerStatus().lease.owner, null);
  assert.equal(f.relayer.workerStatus().jobs.confirmed, 1);
  // A purchase would make the relayer pay the price: refused before signing.
  await assert.rejects(
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, {
        receiverId: CONTRACTS.market,
        action: actions.functionCall(
          "buy",
          { token_id: "aura:polar:1", listing_id: 1 },
          50_000_000_000_000n,
          NEAR,
        ),
      }),
    }),
    (error) => error.code === "RELAY_SELF_PAID",
  );
  assert.equal(f.rows("managed_account_funding").length, 0);
});

test("resubmitting the same signed delegate is idempotent and never spends budget twice", async (t) => {
  const f = fixture({ maxJobsPerDay: 2 });
  t.after(() => f.db.close());
  const acct = f.ready();
  const base64 = await f.sign(acct);
  const first = await f.relayer.submit(f.player, {
    signedDelegateBase64: base64,
  });
  const again = await f.relayer.submit(f.player, {
    signedDelegateBase64: base64,
  });
  assert.equal(again.id, first.id);
  assert.equal(again.duplicate, true);
  assert.equal(f.relayer.budget(acct.accountId).jobs, 1);
  await f.relayer.runRelayJobs();
  const after = await f.relayer.submit(f.player, {
    signedDelegateBase64: base64,
  });
  assert.equal(after.state, "confirmed");
  assert.equal(after.duplicate, true);
  assert.equal(f.transport.sends.length, 1);
  const second = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct),
  });
  assert.equal(second.state, "queued");
  await assert.rejects(
    f.relayer.submit(f.player, { signedDelegateBase64: await f.sign(acct) }),
    (e) => e.code === "RELAY_BUDGET" && e.status === 429,
  );
  const other = f.db
    .prepare("SELECT id FROM players WHERE id!=?")
    .get(f.player);
  assert.equal(other, undefined);
});

test("storage deposits the relayer carries are capped per account and day", async (t) => {
  // A relayed call that fails refunds its deposit to the player's account, so
  // without a cap 40 failing 0.05 NEAR calls a day would move 2 NEAR out.
  const f = fixture({ maxDepositYoctoPerDay: NEAR / 10n });
  t.after(() => f.db.close());
  const acct = f.ready();
  await f.relayer.submit(f.player, { signedDelegateBase64: await f.sign(acct) });
  await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct, { nonce: 102n }),
  });
  assert.equal(f.relayer.budget(acct.accountId).depositYocto, String(NEAR / 10n));
  await assert.rejects(
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, { nonce: 103n }),
    }),
    (e) => e.code === "RELAY_DEPOSIT_BUDGET" && e.status === 429,
  );
  // Zero-deposit maintenance still goes through.
  const equip = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct, {
      nonce: 103n,
      action: actions.functionCall(
        "equip_aura",
        { token_id: "aura:polar:1" },
        30_000_000_000_000n,
        0n,
      ),
    }),
  });
  assert.equal(equip.state, "queued");
  assert.equal(f.relayer.budget(acct.accountId).jobs, 3);
  // The next UTC day starts a fresh deposit budget.
  f.advance(86_400_000);
  const tomorrow = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct, { nonce: 104n }),
  });
  assert.equal(tomorrow.state, "queued");
});

test("network failures retry durably with bounded backoff and reconcile a lost response by hash", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const acct = f.ready();
  const job = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct),
  });
  f.transport.onSend = async () => {
    throw Error("fetch failed: ECONNRESET");
  };
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 0,
    retried: 1,
  });
  let row = f.job(job.id);
  assert.equal(row.state, "retrying");
  assert.equal(row.attempts, 1);
  assert.equal(row.run_after, f.clock() + backoff(0));
  assert.equal(backoff(0), 5000);
  assert.equal(
    row.transaction_hash,
    "T1",
    "the signed hash stays durable for reconciliation",
  );
  assert.equal(row.error_code, "RELAY_NETWORK");
  assert.match(f.relayer.workerStatus().lease.lastError, /ECONNRESET/);
  assert.deepEqual(
    await f.relayer.runRelayJobs(),
    { completed: 0, failed: 0, retried: 0 },
    "not due yet",
  );
  f.advance(5000);
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 0,
    retried: 1,
  });
  row = f.job(job.id);
  assert.equal(row.attempts, 2);
  assert.equal(row.run_after, f.clock() + 10000);
  assert.equal(
    row.transaction_hash,
    "T1",
    "an unknown transaction replays the original signed bytes and hash",
  );
  assert.deepEqual(
    [backoff(5), backoff(6), backoff(20)],
    [160000, 300000, 300000],
  );
  assert.equal(f.rows("relay_submissions").length, 1);
  assert.equal(f.transport.sends[0].hash, f.transport.sends[1].hash);
  // The original transaction landed; the successor finds it by hash and sends nothing.
  f.advance(10000);
  f.transport.onStatus = async (hash) => {
    assert.equal(hash, "T1");
    return outcomeFor(f.transport.sends[1].signedDelegate, { hash });
  };
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 1,
    failed: 0,
    retried: 0,
  });
  assert.equal(f.transport.sends.length, 2);
  row = f.job(job.id);
  assert.equal(row.state, "confirmed");
  assert.equal(row.transaction_hash, "T1");
  assert.equal(row.last_error, null);
});

test("the worker lease excludes overlap and a stale owner cannot write a successor's result", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const acct = f.ready();
  const job = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct),
  });
  f.db
    .prepare(
      "UPDATE relay_worker_lease SET owner='other',until_ms=? WHERE id=1",
    )
    .run(f.clock() + 60000);
  assert.deepEqual(await f.relayer.runRelayJobs(), { busy: true });
  assert.equal(f.job(job.id).state, "queued");
  f.db
    .prepare("UPDATE relay_worker_lease SET owner=NULL,until_ms=0 WHERE id=1")
    .run();
  f.transport.onSend = async ({ hash, signedDelegate }) => {
    f.db
      .prepare(
        "UPDATE relay_worker_lease SET owner='successor',until_ms=? WHERE id=1",
      )
      .run(f.clock() + 120000);
    return outcomeFor(signedDelegate, { hash });
  };
  await assert.rejects(f.relayer.runRelayJobs(), /lease expired/);
  const row = f.job(job.id);
  assert.equal(row.state, "sent");
  assert.equal(row.transaction_hash, "T1");
  assert.equal(row.confirmed_at, null);
  const lease = f.db
    .prepare("SELECT * FROM relay_worker_lease WHERE id=1")
    .get();
  assert.equal(
    lease.owner,
    "successor",
    "the loser does not clear a successor's lease",
  );
  f.db
    .prepare("UPDATE relay_worker_lease SET owner=NULL,until_ms=0 WHERE id=1")
    .run();
  f.transport.onStatus = async (hash) =>
    outcomeFor(f.transport.sends[0].signedDelegate, { hash });
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 1,
    failed: 0,
    retried: 0,
  });
  assert.equal(f.transport.sends.length, 1);
  assert.equal(f.job(job.id).state, "confirmed");
});

test("outcome verification rejects foreign tokens, foreign signers and classifies final failures", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const alice = f.ready(),
    bobPlayer =
      f.db.prepare("SELECT id FROM players").all().length &&
      (await import("../server/database.mjs")).createPlayer(f.db, "Bob", NOW),
    bob = f.ready(bobPlayer, "bob", { amount: NEAR });
  bob.playerId = bobPlayer;
  const stolen = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(alice),
  });
  f.transport.onSend = async ({ hash, signedDelegate }) =>
    outcomeFor(signedDelegate, { hash, owner: "mallory.testnet" });
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 1,
    retried: 0,
  });
  assert.equal(f.job(stolen.id).state, "failed");
  assert.equal(f.job(stolen.id).error_code, "RELAY_OUTCOME");
  // Alice's chain nonce did not move, so a fresh prepare still yields 101.
  const foreign = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(alice),
  });
  f.transport.onSend = async ({ hash, signedDelegate }) =>
    outcomeFor(signedDelegate, { hash, relayer: "impostor.testnet" });
  await f.relayer.runRelayJobs();
  assert.equal(f.job(foreign.id).error_code, "RELAY_OUTCOME");
  // An expired delegate fails terminally and blocks the later nonce of the same
  // account only; another account's job proceeds in the same pass.
  const expired = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(alice),
  });
  const blocked = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(alice),
  });
  const bobs = await f.relayer.submit(bobPlayer, {
    signedDelegateBase64: await f.sign(bob),
  });
  assert.equal(JSON.parse(f.job(blocked.id).call).nonce, "102");
  f.transport.onSend = async ({ hash, signedDelegate }) =>
    signedDelegate.delegateAction.senderId === alice.accountId
      ? outcomeFor(signedDelegate, {
          hash,
          failure: { ActionError: { index: 0, kind: "DelegateActionExpired" } },
        })
      : outcomeFor(signedDelegate, { hash });
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 1,
    failed: 1,
    retried: 0,
  });
  assert.equal(f.job(expired.id).error_code, "RELAY_EXPIRED");
  assert.equal(f.job(blocked.id).state, "failed");
  assert.equal(f.job(blocked.id).error_code, "RELAY_BLOCKED");
  assert.equal(f.job(bobs.id).state, "confirmed");
  const nonce = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(alice),
  });
  f.transport.onSend = async ({ hash, signedDelegate }) =>
    outcomeFor(signedDelegate, {
      hash,
      failure: {
        ActionError: {
          index: 0,
          kind: {
            DelegateActionInvalidNonce: { ak_nonce: 105, delegate_nonce: 101 },
          },
        },
      },
    });
  await f.relayer.runRelayJobs();
  assert.equal(f.job(nonce.id).error_code, "RELAY_NONCE");
  const panic = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(alice),
  });
  f.transport.onSend = async ({ hash, signedDelegate }) =>
    outcomeFor(signedDelegate, {
      hash,
      failure: {
        ActionError: {
          index: 0,
          kind: {
            FunctionCallError: {
              ExecutionError: "Smart contract panicked: avatar exists",
            },
          },
        },
      },
    });
  await f.relayer.runRelayJobs();
  assert.equal(f.job(panic.id).error_code, "RELAY_CONTRACT_FAILED");
  assert.equal(
    f.relayer.status(f.player, panic.id).error,
    "The contract rejected the action. Refresh its state before retrying.",
  );
  assert.throws(() => f.relayer.status(bobPlayer, panic.id), /not found/);
});

test("a state-storage shortfall funds one margin-sized top-up and retries once; a second shortfall is final", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const acct = f.ready(f.player, "alice-novakova", { amount: NEAR });
  const mint = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct),
  });
  const lack = {
    ActionError: {
      index: 0,
      kind: {
        LackBalanceForState: { account_id: acct.accountId, amount: "1" },
      },
    },
  };
  let sends = 0;
  f.transport.onSend = async ({ hash, signedDelegate }) =>
    ++sends === 1
      ? outcomeFor(signedDelegate, { hash, failure: lack })
      : outcomeFor(signedDelegate, { hash });
  f.state.accounts.get(acct.accountId).amount = 0n;
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 0,
    retried: 1,
  });
  assert.equal(f.job(mint.id).error_code, "RELAY_INSUFFICIENT_BALANCE");
  assert.equal(f.job(mint.id).transaction_hash, null);
  const funding = f.rows("managed_account_funding");
  assert.equal(funding.length, 1);
  assert.equal(funding[0].kind, "topup");
  // Only the state margin is funded, never the relayed deposit itself.
  assert.equal(funding[0].amount_yocto, (10n ** 22n).toString());
  f.advance(5000);
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 1,
    failed: 0,
    retried: 0,
  });
  assert.equal(f.rows("managed_account_funding").length, 1);
  const equip = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct, {
      action: actions.functionCall(
        "equip_aura",
        { token_id: "aura:polar:1" },
        50_000_000_000_000n,
        0n,
      ),
    }),
  });
  f.transport.onSend = async ({ hash, signedDelegate }) =>
    outcomeFor(signedDelegate, { hash, failure: lack });
  f.state.accounts.get(acct.accountId).amount = 0n;
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 0,
    retried: 1,
  });
  f.advance(5000);
  assert.deepEqual(await f.relayer.runRelayJobs(), {
    completed: 0,
    failed: 1,
    retried: 0,
  });
  assert.equal(f.job(equip.id).error_code, "RELAY_INSUFFICIENT_BALANCE");
  assert.equal(f.rows("managed_account_funding").length, 2);
});

test("submission enforces ownership, readiness, signature and policy before anything is stored", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const acct = f.ready();
  const { createPlayer } = await import("../server/database.mjs");
  const stranger = createPlayer(f.db, "Stranger", NOW);
  await assert.rejects(
    f.relayer.prepare(stranger, { accountId: acct.accountId }),
    (e) => e.code === "ACCOUNT_FORBIDDEN" && e.status === 403,
  );
  const base64 = await f.sign(acct);
  await assert.rejects(
    f.relayer.submit(stranger, { signedDelegateBase64: base64 }),
    (e) => e.code === "ACCOUNT_FORBIDDEN",
  );
  await assert.rejects(
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, { nonce: 150n }),
    }),
    (e) => e.code === "RELAY_NONCE",
  );
  await assert.rejects(
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, { maxBlockHeight: 9000n }),
    }),
    (e) => e.code === "RELAY_EXPIRY",
  );
  const tampered = Buffer.from(base64, "base64");
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(
    f.relayer.submit(f.player, {
      signedDelegateBase64: tampered.toString("base64"),
    }),
    (e) => e.code === "RELAY_SIGNATURE",
  );
  await assert.rejects(
    f.relayer.submit(f.player, { signedDelegateBase64: "@@" }),
    (e) => e.code === "RELAY_DECODE",
  );
  f.db
    .prepare("UPDATE managed_accounts SET state='creating' WHERE account_id=?")
    .run(acct.accountId);
  await assert.rejects(
    f.relayer.submit(f.player, { signedDelegateBase64: base64 }),
    (e) => e.code === "ACCOUNT_NOT_READY",
  );
  assert.equal(f.rows("relay_jobs").length, 0);
  assert.equal(f.rows("relay_budget").length, 0);
  const disabled = new (await import("../server/relayer/relay.mjs")).Relayer(
    f.db,
    f.state.provider,
    null,
    { accounts: f.accounts, contracts: CONTRACTS },
  );
  assert.equal(disabled.enabled, false);
  await assert.rejects(
    disabled.submit(f.player, { signedDelegateBase64: base64 }),
    (e) => e.code === "RELAY_DISABLED",
  );
});

test("a pending device key becomes active after its sponsored addKey confirms", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const acct = f.ready();
  const laptop = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  await assert.rejects(
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, {
        receiverId: acct.accountId,
        action: actions.addFullAccessKey(PublicKey.fromString(laptop)),
      }),
    }),
    (e) => e.code === "RELAY_KEY_TARGET",
  );
  await f.accounts.requestKey(f.player, { publicKey: laptop, label: "laptop" });
  const job = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(acct, {
      receiverId: acct.accountId,
      action: actions.addFullAccessKey(PublicKey.fromString(laptop)),
    }),
  });
  assert.equal(job.kind, "relay");
  assert.equal(job.methodName, "addKey");
  await f.relayer.runRelayJobs();
  assert.equal(f.job(job.id).state, "confirmed");
  assert.equal(
    f.db
      .prepare("SELECT state FROM managed_account_keys WHERE public_key=?")
      .get(laptop).state,
    "active",
  );
  assert.equal(f.accounts.view(f.player).account.keys.length, 2);
  assert.equal(f.accounts.view(f.player).account.keys[1].label, "laptop");
});

test("the route handler dispatches account and relay routes with the parent's helpers", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { createRelayerRoutes } = await import("../server/relayer/routes.mjs");
  const { assert: gameAssert } = await import("../server/domain.mjs");
  let mayManage = false;
  const routes = createRelayerRoutes({
    authorizeEnrollment: () => gameAssert(mayManage, "Sign in again", 403),
    relayer: f.relayer,
    accounts: f.accounts,
  });
  const acct = f.ready();
  const call = async (method, path, input) => {
    const out = {};
    const handled = await routes.handle(
      { method },
      {},
      new URL(path, "http://localhost:8787"),
      {
        player: f.player,
        body: async () => input,
        respond: (res, data, status = 200) =>
          Object.assign(out, { data, status }),
        assert: gameAssert,
      },
    );
    return { handled, ...out };
  };
  assert.equal((await call("GET", "/api/other")).handled, false);
  const view = await call("GET", "/api/account");
  assert.equal(view.handled, true);
  assert.equal(view.data.account.accountId, acct.accountId);
  const prepared = await call("POST", "/api/relay/prepare", {
    accountId: acct.accountId,
  });
  assert.equal(prepared.data.nonce, "101");
  const submitted = await call("POST", "/api/relay", {
    signedDelegateBase64: await f.sign(acct),
  });
  assert.equal(submitted.status, 202);
  assert.equal(
    (
      await call("POST", "/api/relay", {
        signedDelegateBase64: f.job(submitted.data.id).delegate,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call("GET", `/api/relay/${submitted.data.id}`)).data.state,
    "queued",
  );
  assert.equal(
    (await call("GET", `/api/relay?account=${acct.accountId}`)).data.jobs
      .length,
    1,
  );
  await assert.rejects(
    call("GET", "/api/relay?account=INVALID"),
    /valid NEAR account/,
  );
  const attemptedKey = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  for (const remove of [true, false])
    await assert.rejects(call("POST", "/api/account/keys", {publicKey: attemptedKey, remove}), error => error.status === 403);
  assert.equal(f.accounts.view(f.player).account.keys.length, 1);
  mayManage = true;
  const keys = await call("POST", "/api/account/keys", {
    publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString(),
    label: "tablet",
  });
  assert.equal(keys.data.account.keys.length, 2);
  const disabled = createRelayerRoutes({ relayer: null, accounts: null });
  const off = {};
  await disabled.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/account"),
    {
      player: f.player,
      respond: (res, data) => Object.assign(off, data),
      assert: gameAssert,
    },
  );
  assert.equal(off.enabled, false);
  await assert.rejects(
    disabled.handle(
      { method: "POST" },
      {},
      new URL("http://localhost/api/relay"),
      {
        player: f.player,
        body: async () => ({}),
        respond() {},
        assert: gameAssert,
      },
    ),
    (e) => e.code === "RELAY_DISABLED" && e.status === 503,
  );
});

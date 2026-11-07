import test from "node:test";
import assert from "node:assert/strict";
import { actions } from "near-api-js";
import { fixture as relayFixture } from "./relayer-fixture.mjs";
import { purchaseFixture, TOKEN } from "./fixtures/qgold-purchase.mjs";
import { setSpendRealm } from "../server/gold-spend/ledger.mjs";
test("two signed delegates for one purchase allocate one job and one sponsor debit", async (t) => {
  const f = relayFixture(),
    account = f.ready();
  f.relayer.contracts.qgold = TOKEN;
  const purchase = purchaseFixture({
    db: f.db,
    player: f.player,
    owner: account.accountId,
  });
  setSpendRealm("qgold");
  t.after(() => {
    f.db.close();
    setSpendRealm("practice");
  });
  await assert.rejects(purchase.run(), (e) => e.code === "QGOLD_BURN");
  const call = purchase.prepare(),
    action = actions.functionCall(
      call.methodName,
      call.args,
      BigInt(call.gas),
      1n,
    );
  const delegates = await Promise.all(
    [5119n, 5120n].map((maxBlockHeight) =>
      f.sign(account, {
        receiverId: TOKEN,
        action,
        nonce: 101n,
        maxBlockHeight,
      }),
    ),
  );
  const jobs = await Promise.all(
    delegates.map((signedDelegateBase64) =>
      f.relayer.submit(f.player, { signedDelegateBase64 }),
    ),
  );
  assert.equal(jobs[0].id, jobs[1].id);
  assert.equal(f.rows("relay_jobs").length, 1);
  assert.equal(purchase.row().relay_job_id, jobs[0].id);
  const wrong = await f.sign(account, {
    receiverId: TOKEN,
    action: actions.functionCall(
      call.methodName,
      { ...call.args, memo: "questlayer:burn:emote:1111111111111111" },
      BigInt(call.gas),
      1n,
    ),
    nonce: 102n,
  });
  await assert.rejects(
    f.relayer.submit(f.player, { signedDelegateBase64: wrong }),
    (e) => e.code === "BURN_INTENT",
  );
  assert.equal(f.rows("relay_jobs").length, 1);
});

test("a purchase blocked behind an earlier failed job resumes the same never-sent delegate", async (t) => {
  const f = relayFixture(),
    account = f.ready();
  f.relayer.contracts.qgold = TOKEN;
  const purchase = purchaseFixture({
    db: f.db,
    player: f.player,
    owner: account.accountId,
  });
  setSpendRealm("qgold");
  t.after(() => {
    f.db.close();
    setSpendRealm("practice");
  });
  await assert.rejects(purchase.run(), (e) => e.code === "QGOLD_BURN");
  const call = purchase.prepare(),
    signedDelegateBase64 = await f.sign(account, {
      receiverId: TOKEN,
      action: actions.functionCall(
        call.methodName,
        call.args,
        BigInt(call.gas),
        1n,
      ),
      nonce: 101n,
    });
  const job = await f.relayer.submit(f.player, { signedDelegateBase64 });
  f.db
    .prepare(
      "UPDATE relay_jobs SET state='failed',error_code='RELAY_BLOCKED' WHERE id=?",
    )
    .run(job.id);
  const again = purchase.prepare();
  assert.equal(again.relayJobId, job.id);
  assert.equal(again.submission, 0);
  const row = f.db.prepare("SELECT * FROM relay_jobs WHERE id=?").get(job.id);
  assert.equal(row.state, "queued");
  assert.equal(row.delegate, signedDelegateBase64);
  assert.equal(f.rows("subsidy_reservations").length, 1);
  f.db
    .prepare(
      "INSERT INTO relay_submissions(job_id,attempt,hash,signed_tx,account_id,public_key,created_at) VALUES(?,1,'hash','bytes','relay','key',0)",
    )
    .run(job.id);
  f.db
    .prepare(
      "UPDATE relay_jobs SET state='failed',error_code='RELAY_BLOCKED' WHERE id=?",
    )
    .run(job.id);
  purchase.prepare();
  assert.equal(
    f.db.prepare("SELECT state FROM relay_jobs WHERE id=?").get(job.id).state,
    "failed",
    "an uncertain submission must stay held",
  );
});

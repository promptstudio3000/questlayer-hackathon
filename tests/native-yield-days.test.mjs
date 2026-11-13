// Yield-backed publication: the worker publishes only what vault payouts cover.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { openDatabase } from "../server/database.mjs";
import { NativeRewards } from "../server/native/rewards.mjs";
import { storedNativeManifest } from "../server/native/reward-manifest.mjs";
import { runRewardWorker } from "../server/native/reward-worker.mjs";
import { readYieldBacking } from "../server/native/day-publication.mjs";
import { manifestCost } from "../server/native/allocation.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { ACCOUNT_SUFFIX, NETWORK } from "../server/native/network.mjs";

const NOW = Date.parse("2026-11-04T10:00:00Z");
function fixture({ gamePaid }) {
  const db = openDatabase(":memory:"),
    contractId = `rewards${ACCOUNT_SUFFIX}`;
  const keys = generateKeyPairSync("ed25519"),
    signer = {
      publicKey: keys.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64"),
      sign: (m) =>
        sign(null, Buffer.from(m), keys.privateKey).toString("base64"),
    };
  const vault = {
    accountId: `treasury-vault${ACCOUNT_SUFFIX}`,
    beneficiary: `operator${ACCOUNT_SUFFIX}`,
    codeHash: "vault-code",
  };
  const vaultState = {
    beneficiary: vault.beneficiary,
    rewards: contractId,
    pool: "aurora.pool.f863973.m0",
    stage: "idle",
    principal: "0",
    exit_requested: false,
    owner_pending: "0",
    game_pending: "0",
    game_credit: "0",
    game_paid: gamePaid,
  };
  const provider = {
    viewNodeStatus: async () => ({ chain_id: NETWORK }),
    query: async (q) => {
      if (q.request_type === "view_account")
        return {
          code_hash:
            q.account_id === vault.accountId ? vault.codeHash : "reviewed",
        };
      assert.equal(q.method_name, "get_state");
      return { result: [...Buffer.from(JSON.stringify(vaultState))] };
    },
  };
  const n = new NativeRewards(
    db,
    provider,
    { contractId, codeHash: "reviewed", vaults: [vault] },
    signer,
    { clock: () => NOW, city: PLZEN },
  );
  n.yieldBackedDays = true;
  const days = new Map();
  n.view = async (method, args = {}) => {
    if (method === "get_config")
      return {
        attestor: signer.publicKey,
        publisher: contractId,
        paused: false,
      };
    if (method === "get_treasury")
      return {
        coins: { available: "100000000000000000000000" },
        zones: { available: "100000000000000000000000" },
      };
    if (method === "get_day") return days.get(args.day_id) || null;
    throw Error(method);
  };
  const send = async (method, args) => {
    if (method === "publish_day")
      days.set(args.day_id, {
        ...args,
        closed: false,
        claims_accepted: 0,
        claims_limit: 256,
        storage_reserved: true,
      });
    return "tx";
  };
  return { db, n, send, vaultState };
}
const published = (db) =>
  db
    .prepare("SELECT * FROM native_days ORDER BY day")
    .all()
    .map(storedNativeManifest);

test("yield-backed days drip the realized yield: today and tomorrow both get a share", async () => {
  const paid = 176316808318321203504n; // one harvest's game share on 5 NEAR
  const f = fixture({ gamePaid: paid.toString() });
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  const days = published(f.db);
  // Each day takes one seventh of what is free when it is planned, so the
  // day after a harvest is not left without rewards.
  assert.equal(days.length, 2);
  assert.deepEqual(days.map((m) => m.day), ["2026-11-04", "2026-11-05"]);
  let spent = 0n;
  for (const m of days) {
    assert.equal(m.funding, "realized_yield");
    assert.equal(m.fundingEvidence.paid, paid.toString());
    assert.equal(m.fundingEvidence.dripDays, 7);
    assert.deepEqual(m.fundingEvidence.vaults, [
      {
        accountId: `treasury-vault${ACCOUNT_SUFFIX}`,
        gamePaid: paid.toString(),
      },
    ]);
    const cost = manifestCost(m).total;
    // One drip of the yield still free before this day, never more.
    const freeBefore = paid - BigInt(m.fundingEvidence.committedBefore);
    assert.ok(cost > 0n && cost <= freeBefore / 7n);
    spent += cost;
  }
  assert.ok(spent <= (paid * 2n) / 7n);
  assert.equal(days[0].fundingEvidence.committedBefore, "0");
  assert.equal(
    days[1].fundingEvidence.committedBefore,
    manifestCost(days[0]).total.toString(),
  );
  // Players see where today's rewards come from.
  const shown = (await f.n.snapshot(null)).day;
  assert.equal(shown.funding, "realized_yield");
  assert.equal(shown.fundingEvidence.paid, paid.toString());
  // A published day is never re-planned when more yield arrives.
  f.vaultState.game_paid = (paid * 2n).toString();
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  const again = published(f.db);
  assert.equal(again.length, 2);
  assert.deepEqual(again.map((m) => m.hash), days.map((m) => m.hash));
});

test("a drip of one day keeps the old behaviour: the first day takes all free yield", async () => {
  const paid = 176316808318321203504n;
  const f = fixture({ gamePaid: paid.toString() });
  f.n.yieldDripDays = 1;
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  const days = published(f.db);
  assert.equal(days.length, 1);
  assert.equal(days[0].day, "2026-11-04");
  const spent = manifestCost(days[0]).total;
  assert.ok(spent > 0n && spent <= paid);
  // A later harvest frees new yield; the next day sees only what is uncommitted.
  f.vaultState.game_paid = (paid * 2n).toString();
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  const next = published(f.db);
  assert.equal(next.length, 2);
  assert.equal(next[1].fundingEvidence.committedBefore, spent.toString());
  const total = next.reduce((n, m) => n + manifestCost(m).total, 0n);
  assert.ok(total <= paid * 2n);
});

test("a tiny yield still funds every coin of the day", async () => {
  // 0.0000147 NEAR free, as on testnet on 11 Nov 2026: 6,000 coins share one
  // drip and each still carries a whole number of yoctoNEAR.
  const paid = 14687034587253392810n;
  const f = fixture({ gamePaid: paid.toString() });
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  const days = published(f.db);
  assert.equal(days.length, 2);
  for (const m of days) {
    assert.ok(BigInt(m.coinUnit) > 0n);
    assert.ok(manifestCost(m).total <= paid / 7n);
  }
});

test("a closed yield day gives its unclaimed budget back to the yield", async () => {
  const paid = 176316808318321203504n;
  const f = fixture({ gamePaid: paid.toString() });
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  const [first, second] = published(f.db);
  const before = await readYieldBacking(f.n);
  assert.equal(
    BigInt(before.committed),
    manifestCost(first).total + manifestCost(second).total,
  );
  // Nobody collected anything on the first day and it closed on chain.
  f.db.prepare("UPDATE native_days SET state='closed' WHERE id=?").run(first.id);
  const after = await readYieldBacking(f.n);
  assert.equal(BigInt(after.committed), manifestCost(second).total);
  assert.equal(BigInt(after.free), paid - manifestCost(second).total);
  assert.equal(after.covered, true);
});

test("without realized yield nothing is published in yield-backed mode", async () => {
  const f = fixture({ gamePaid: "0" });
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  assert.equal(published(f.db).length, 0);
  // The gap is reported, not silent.
  assert.deepEqual(f.n.unfundedDays, {
    "2026-11-04": "no-free-yield",
    "2026-11-05": "no-free-yield",
  });
  // Switching the mode off publishes the ordinary sponsor-funded days again.
  f.n.yieldBackedDays = false;
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  assert.equal(published(f.db).length, 2);
  assert.deepEqual(f.n.unfundedDays, {});
  const shown = (await f.n.snapshot(null)).day;
  assert.equal(shown.funding, "sponsor");
  assert.equal(shown.fundingEvidence, undefined);
});

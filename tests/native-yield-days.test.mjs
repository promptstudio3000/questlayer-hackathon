// Yield-backed publication: the worker publishes only what vault payouts cover.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { openDatabase } from "../server/database.mjs";
import { NativeRewards } from "../server/native/rewards.mjs";
import { storedNativeManifest } from "../server/native/reward-manifest.mjs";
import { runRewardWorker } from "../server/native/reward-worker.mjs";
import { manifestCost } from "../server/native/allocation.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";

const NOW = Date.parse("2026-11-04T10:00:00Z");
function fixture({ gamePaid }) {
  const db = openDatabase(":memory:"),
    contractId = "rewards.testnet";
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
    accountId: "treasury-vault.testnet",
    beneficiary: "operator.testnet",
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
    viewNodeStatus: async () => ({ chain_id: "testnet" }),
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

test("yield-backed days spend no more than realized yield, across both days", async () => {
  const paid = 176316808318321203504n; // one harvest's game share on 5 NEAR
  const f = fixture({ gamePaid: paid.toString() });
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  const days = published(f.db);
  // Today's day takes all free yield; tomorrow waits for the next harvest.
  assert.equal(days.length, 1);
  let spent = 0n;
  for (const m of days) {
    assert.equal(m.funding, "realized_yield");
    assert.equal(m.fundingEvidence.paid, paid.toString());
    assert.deepEqual(m.fundingEvidence.vaults, [
      { accountId: "treasury-vault.testnet", gamePaid: paid.toString() },
    ]);
    spent += manifestCost(m).total;
  }
  assert.ok(spent > 0n && spent <= paid);
  assert.equal(days[0].day, "2026-11-04");
  assert.equal(days[0].fundingEvidence.committedBefore, "0");
  // A later harvest frees new yield; the next day sees only what is uncommitted.
  f.vaultState.game_paid = (paid * 2n).toString();
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  const next = published(f.db);
  assert.equal(next.length, 2);
  assert.equal(next[1].fundingEvidence.committedBefore, spent.toString());
  const total = next.reduce((n, m) => n + manifestCost(m).total, 0n);
  assert.ok(total <= paid * 2n);
});

test("without realized yield nothing is published in yield-backed mode", async () => {
  const f = fixture({ gamePaid: "0" });
  await runRewardWorker(f.n, f.send, { clock: () => NOW });
  assert.equal(published(f.db).length, 0);
});

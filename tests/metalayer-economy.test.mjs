import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { createLayerActivity } from "../server/layer/activity.mjs";
import { createMetaLayerEconomy, METALAYER_REWARDS } from "../server/layer/economy.mjs";

function fixture(t, { accounts = { "p-alice": "alice.testnet" }, statuses } = {}) {
  const db = openDatabase(":memory:"), clock = { at: 1_000_000 }, calls = [];
  t.after(() => db.close());
  for (const id of ["p-alice", "p-bob"]) db.prepare("INSERT INTO players(id,name,created_at) VALUES(?,?,1)").run(id, id);
  const chain = {
    active: true, state: { contractId: "metalayer.testnet" },
    async award(awards) { calls.push(awards); return { tx: "Tx" + calls.length, statuses: statuses?.(awards) ?? awards.map(() => "paid") }; },
    async view(method) { return { treasury: { metagold_available: "1000", paid_today: "0", daily_cap: "100000", parcel_price: "100" }, ft_balance_of: "85", meta_xp_of: "150", badges_of: ["crystal-hollow"], nft_tokens_for_owner: [] }[method]; },
  };
  const economy = createMetaLayerEconomy(db, { chain, linkedAccount: (id) => accounts[id] ?? null, now: () => clock.at });
  const activity = createLayerActivity(db, { now: () => clock.at, config: null, onRecord: economy.onRecord });
  const layer = { id: "space" };
  return { db, clock, calls, economy, activity, layer };
}

test("story steps queue one payout each; walking and mining earn nothing", async (t) => {
  const { db, calls, economy, activity, layer } = fixture(t);
  const alice = { id: "p-alice" };
  activity.record(alice, layer, "tile:1,1", "atlas-revealed", {});
  activity.record(alice, layer, "r1", "resource-mined", {});
  const id = activity.record(alice, layer, "expedition-complete", "expedition-complete", {});
  activity.record(alice, layer, "expedition-complete", "expedition-complete", {});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ml_payouts").get().n, 1);
  assert.equal(await economy.tick(), 1);
  const [award] = calls[0];
  assert.equal(award.action_id, id);
  assert.equal(award.account_id, "alice.testnet");
  assert.equal(award.metagold, String(METALAYER_REWARDS["expedition-complete"].metagold));
  assert.equal(award.badge, "crystal-hollow");
  assert.match(award.actor, /^[0-9a-f]{64}$/, "the hashed actor, never the account, names the action");
  const row = db.prepare("SELECT status,tx FROM ml_payouts").get();
  assert.deepEqual({ ...row }, { status: "paid", tx: "Tx1" });
  assert.equal(db.prepare("SELECT tx FROM ml_actions WHERE id=?").get(id).tx, "Tx1");
  assert.equal(await economy.tick(), 0, "a paid row is never sent again");
});

test("without a linked NEAR account the payout waits; a full treasury day retries later", async (t) => {
  const { db, clock, calls, economy, activity, layer } = fixture(t, { statuses: (a) => a.map(() => "over-daily-cap") });
  activity.record({ id: "p-bob" }, layer, "beacon-restored", "beacon-restored", {});
  activity.record({ id: "p-alice" }, layer, "beacon-restored", "beacon-restored", {});
  await economy.tick();
  assert.equal(calls[0].length, 1);
  assert.equal(db.prepare("SELECT status FROM ml_payouts WHERE player_id='p-bob'").get().status, "no-account");
  assert.equal(db.prepare("SELECT status FROM ml_payouts WHERE player_id='p-alice'").get().status, "over-daily-cap");
  assert.equal(await economy.tick(), 0, "nothing is due before the retry time");
  clock.at += 61 * 60_000;
  await economy.tick();
  assert.equal(calls.length, 2);
});

test("summary reads balances from the contract and lists what still waits", async (t) => {
  const { economy, activity, layer } = fixture(t);
  activity.record({ id: "p-alice" }, layer, "signal:garden", "signal-tuned", {});
  const s = await economy.summary({ id: "p-alice" }, "space");
  assert.equal(s.active, true);
  assert.equal(s.metagold, "85");
  assert.equal(s.metaXp, 150);
  assert.deepEqual(s.badges, ["crystal-hollow"]);
  assert.equal(s.pending.length, 1);
});

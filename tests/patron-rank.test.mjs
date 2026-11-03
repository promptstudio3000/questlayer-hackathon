// Patron rank 1–5 (GAME-LOOPS P1-2): grows with matured patron epochs,
// rewards holding (not depositing more), never decays.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createKeeperVault, keeperVaultSettings } from "../server/npc/keeper-vault.mjs";
import { createPatronRank, rankFor, rankSettings, DEFAULT_RANK_EPOCHS } from "../server/npc/patron-rank.mjs";
import { createTraderRoutes } from "../server/npc/trader-routes.mjs";

const N = 10n ** 24n;
function state({ principal, mature = principal, bps = 5000, epoch, exit = false }) {
  return {
    principal: principal.toString(),
    staked: principal.toString(),
    contribution_bps: bps,
    weighted_stake: (exit ? 0n : (mature * BigInt(bps)) / 10000n).toString(),
    epoch: String(epoch),
    observed_epoch: String(epoch),
    exit_requested: exit,
    owner_credit: "0",
    owner_pending: "0",
    owner_paid: "0",
    game_credit: "0",
    game_pending: "0",
    game_paid: "0",
  };
}
function setup(env = {}) {
  const db = openDatabase(":memory:");
  const player = createPlayer(db, "Patron");
  const kv = createKeeperVault(db, { clock: () => 1, settings: keeperVaultSettings(env) });
  const view = (s) => kv.view({ player, level: 1, positions: [{ accountId: "pat.testnet", vaults: [{ vault: "v1.testnet", pool: "pool", state: "ready", s }] }] });
  return { db, player, kv, view };
}

test("rank thresholds and settings", () => {
  assert.deepEqual([0, 1, 3, 4, 13, 14, 59, 60, 500].map((e) => rankFor(e)), [0, 1, 1, 2, 2, 3, 4, 5, 5]);
  assert.deepEqual(rankSettings({}).epochs, DEFAULT_RANK_EPOCHS);
  assert.deepEqual(rankSettings({ KEEPER_RANK_EPOCHS: "1,2,3,4,5" }).epochs, [1, 2, 3, 4, 5]);
  assert.deepEqual(rankSettings({ KEEPER_RANK_EPOCHS: "1,1,3,4,5" }).epochs, DEFAULT_RANK_EPOCHS, "must rise");
  assert.equal(rankSettings({}).minStep, 1, "Staker step by default");
  assert.equal(rankSettings({ KEEPER_RANK_STEP: "tier2" }).minStep, 2);
  assert.equal(rankSettings({ KEEPER_RANK_STEP: "gold" }).minStep, 1);
  assert.equal(rankSettings({ KEEPER_RANK_ENABLED: "0" }).enabled, false);
});

test("pending stake does not count; each matured patron epoch does, once", () => {
  const { view } = setup();
  let r = view(state({ principal: 100n * N, mature: 0n, epoch: 100 })).rank;
  assert.equal(r.rank, 0);
  assert.equal(r.epochs, 0);
  r = view(state({ principal: 100n * N, epoch: 102 })).rank; // weighted 50 → tier 2
  assert.equal(r.rank, 1);
  assert.equal(r.name, "Spark");
  assert.equal(r.epochs, 1);
  assert.equal(view(state({ principal: 100n * N, epoch: 102 })).rank.epochs, 1, "same epoch counts once");
  r = view(state({ principal: 100n * N, epoch: 103 })).rank;
  assert.equal(r.epochs, 2);
  assert.equal(r.next.rank, 2);
  assert.equal(r.next.left, 2);
});

test("holding between readings is credited; depositing more does not speed it up", () => {
  const { view } = setup();
  view(state({ principal: 100n * N, epoch: 100 }));
  let r = view(state({ principal: 100n * N, epoch: 110 })).rank;
  assert.equal(r.epochs, 11, "1 + a gap of 10 held epochs");
  assert.equal(r.rank, 2);
  r = view(state({ principal: 1000n * N, epoch: 111 })).rank;
  assert.equal(r.epochs, 12, "a bigger stake still earns one epoch per epoch");
});

test("a shrink between readings credits only the current epoch, and long gaps are capped", () => {
  const { view } = setup({ KEEPER_RANK_GAP_MAX: "5" });
  view(state({ principal: 200n * N, epoch: 100 }));
  let r = view(state({ principal: 120n * N, epoch: 110 })).rank;
  assert.equal(r.epochs, 2, "stake shrank: no gap credit");
  r = view(state({ principal: 120n * N, epoch: 130 })).rank;
  assert.equal(r.epochs, 7, "gap capped at 5");
});

test("no decay: an exit pauses growth but keeps the rank; rank-up ceremony closes once", () => {
  const { view, kv, player } = setup({ KEEPER_RANK_EPOCHS: "1,2,3,4,5" });
  view(state({ principal: 100n * N, epoch: 100 }));
  let r = view(state({ principal: 100n * N, epoch: 102 })).rank;
  assert.equal(r.rank, 3);
  assert.deepEqual(r.rankUp, { rank: 3, name: "Lantern" }, "one ceremony for the highest new rank");
  assert.equal(kv.rankSeen(player, 3).seen, true);
  assert.equal(kv.rankSeen(player, 3).seen, false);
  r = view(state({ principal: 100n * N, epoch: 103, exit: true })).rank;
  assert.equal(r.rank, 3, "rank stays after an exit");
  assert.equal(r.growing, false);
  assert.equal(r.rankUp, null);
  r = view(state({ principal: 100n * N, epoch: 110 })).rank;
  assert.equal(r.epochs, 4, "re-matured stake after a pause adds one, not the gap");
  assert.equal(r.rank, 4);
  assert.deepEqual(kv.badge(player), { rank: 4, name: "Beacon", epochs: 4 });
});

test("rank 0 = Staker from 2 NEAR matured; less does not count; the step is configurable", () => {
  const { view } = setup();
  let r = view(state({ principal: 1n * N, epoch: 100 })).rank;
  assert.equal(r.epochs, 0, "1 NEAR is below the Staker step");
  assert.equal(r.name, null);
  const fresh = setup();
  r = fresh.view(state({ principal: 3n * N, mature: 0n, epoch: 100 })).rank;
  assert.equal(r.staker, false, "still maturing");
  r = fresh.view(state({ principal: 3n * N, epoch: 102 })).rank;
  assert.equal(r.staker, true);
  assert.equal(r.epochs, 1, "a Tier 1 staker earns patron epochs too");
  const zero = setup({ KEEPER_RANK_EPOCHS: "2,4,6,8,10" });
  r = zero.view(state({ principal: 3n * N, epoch: 100 })).rank;
  assert.deepEqual([r.rank, r.name], [0, "Staker"]);
  const t2 = setup({ KEEPER_RANK_STEP: "tier2" });
  assert.equal(t2.view(state({ principal: 20n * N, epoch: 100 })).rank.epochs, 0);
  assert.equal(t2.view(state({ principal: 100n * N, epoch: 101 })).rank.epochs, 1);
  const off = setup({ KEEPER_RANK_ENABLED: "0" });
  assert.equal(off.view(state({ principal: 100n * N, epoch: 100 })).rank, null);
});

test("rank-up route closes the ceremony", async () => {
  const { db, player, kv, view } = setup();
  view(state({ principal: 100n * N, epoch: 100 }));
  const routes = createTraderRoutes({ traders: null, actors: null, db, market: null, vaults: {}, keeperVault: kv });
  let sent;
  const ctx = { player, body: async () => ({}), respond: (_r, v) => (sent = v), assert: (ok, m) => { if (!ok) throw new Error(m); } };
  assert.equal(await routes.handle({ method: "POST" }, {}, new URL("http://x/api/keeper/rank/1/seen"), ctx), true);
  assert.equal(sent.seen, true);
  assert.equal(await routes.handle({ method: "POST" }, {}, new URL("http://x/api/keeper/rank/9/seen"), ctx), false);
});

test("standalone module works without the Keeper card", () => {
  const db = openDatabase(":memory:");
  const pr = createPatronRank(db, { settings: rankSettings({}) });
  assert.equal(pr.badge("nobody"), null);
  assert.equal(pr.observe("p", { epoch: 5, step: 1, amount: "1" }).rank, 1);
});

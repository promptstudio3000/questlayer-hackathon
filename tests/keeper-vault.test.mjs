// Keeper's inner vault (GAME-LOOPS P0-3): stake card, E+2 countdown,
// ceremonies and the staker + level gate. Read-only over vault state.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  DEFAULT_CHAPTERS,
  createKeeperVault,
  keeperVaultSettings,
  tierFor,
  vaultMaturity,
} from "../server/npc/keeper-vault.mjs";
import { createTraderRoutes, keeperView } from "../server/npc/trader-routes.mjs";

const N = 10n ** 24n;
// Same formula as contracts/vault get_state.
function weightedOf(mature, staked, principal, bps) {
  const active = staked < principal ? staked : principal;
  return (((mature * active) / principal) * BigInt(bps)) / 10000n;
}
function state({ principal, mature = principal, staked = principal, bps = 5000, epoch = 100, exit = false, owner = 0n, game = 0n }) {
  return {
    principal: principal.toString(),
    staked: staked.toString(),
    contribution_bps: bps,
    weighted_stake: (exit ? 0n : weightedOf(mature, staked, principal, bps)).toString(),
    epoch: String(epoch),
    observed_epoch: String(epoch),
    exit_requested: exit,
    owner_credit: owner.toString(),
    owner_pending: "0",
    owner_paid: "0",
    game_credit: "0",
    game_pending: "0",
    game_paid: game.toString(),
  };
}

function setup({ env = {}, clock, today = () => null } = {}) {
  const db = openDatabase(":memory:");
  const player = createPlayer(db, "Patron");
  db.prepare("INSERT INTO wallet_links(account_id,player_id,verified_at) VALUES(?,?,?)").run("pat.testnet", player, 1);
  let now = clock ?? Date.parse("2026-11-02T08:00:00Z");
  const kv = createKeeperVault(db, { clock: () => now, settings: keeperVaultSettings(env), today });
  const at = (iso) => (now = Date.parse(iso));
  const view = (s, level = 1) => kv.view({ player, level, positions: [{ accountId: "pat.testnet", vaults: [{ vault: "v1.testnet", pool: "pool", state: "ready", s }] }] });
  return { db, player, kv, at, view };
}

test("mature and pending principal are read back from the contract's weighted stake", () => {
  for (const [principal, mature, staked, bps] of [
    [100n * N, 100n * N, 100n * N, 5000],
    [100n * N, 40n * N, 100n * N, 5000],
    [60n * N, 10n * N, 59n * N, 10000],
    [3n * N + 7n, 1n * N, 3n * N + 7n, 1],
  ]) {
    const m = vaultMaturity(state({ principal, mature, staked, bps }));
    const diff = m.mature > mature ? m.mature - mature : mature - m.mature;
    assert.ok(diff <= 10n ** 18n || m.pending === 0n, `${principal} ${mature}`);
    assert.equal(m.state, mature === principal ? "mature" : "pending");
  }
  assert.equal(vaultMaturity(state({ principal: 5n * N, bps: 0 })).state, "uncounted");
  assert.equal(vaultMaturity(state({ principal: 5n * N, exit: true })).state, "exiting");
  assert.equal(vaultMaturity({ ...state({ principal: 5n * N }), observed_epoch: "90" }).state, "refreshing");
  assert.equal(tierFor(50n * N), 2);
  assert.equal(tierFor(100n * N), 3);
  assert.equal(tierFor(49n * N), 1);
});

test("a new deposit gets an E+2 countdown from the epoch the Keeper first saw it", () => {
  const { view } = setup();
  let v = view(state({ principal: 120n * N, mature: 20n * N, epoch: 100 })).accounts[0].vaults[0];
  assert.equal(v.maturity.state, "pending");
  assert.equal(v.maturity.byEpoch, 102);
  assert.equal(v.maturity.epochsLeft, 2);
  assert.equal(v.maturity.hoursLeft, 24);
  v = view(state({ principal: 120n * N, mature: 20n * N, epoch: 101 })).accounts[0].vaults[0];
  assert.equal(v.maturity.byEpoch, 102, "the same deposit keeps its countdown");
  assert.equal(v.maturity.epochsLeft, 1);
  v = view(state({ principal: 130n * N, mature: 20n * N, epoch: 101 })).accounts[0].vaults[0];
  assert.equal(v.maturity.byEpoch, 103, "a top-up restarts the countdown");
});

test("ceremonies: matured once, tier steps once, patron title stays", () => {
  const { view, kv, player } = setup();
  // 200 NEAR at 50 % → weighted 100 → tier 3 once mature.
  const first = view(state({ principal: 200n * N, mature: 0n, epoch: 100 }));
  assert.equal(first.tier, 1);
  assert.equal(first.ceremonies.length, 0);
  assert.equal(first.patron, null);
  const done = view(state({ principal: 200n * N, epoch: 102 }));
  assert.equal(done.tier, 3);
  const kinds = done.ceremonies.map((c) => `${c.kind}:${c.tier ?? ""}`).sort();
  assert.deepEqual(kinds, ["matured:", "tier:2", "tier:3"]);
  assert.equal(done.patron.title, "Patron of the Gate");
  const again = view(state({ principal: 200n * N, epoch: 103 }));
  assert.equal(again.ceremonies.length, 3, "no duplicates");
  for (const c of again.ceremonies) assert.equal(kv.seen(player, c.id).seen, true);
  assert.equal(kv.seen(player, again.ceremonies[0].id).seen, false);
  const exited = view(state({ principal: 200n * N, exit: true, epoch: 104 }));
  assert.equal(exited.ceremonies.length, 0);
  assert.equal(exited.tier, 1);
  assert.ok(exited.patron, "the earned title stays after an exit (no decay)");
});

test("the inner vault opens at Staker (2 NEAR matured) + level 2, and every default is configurable", () => {
  // 2 NEAR matured at 50 % city share: no tier, but a Staker.
  const small = state({ principal: 2n * N, epoch: 100 });
  const { view } = setup();
  const l1 = view(small, 1);
  assert.equal(l1.tier, 1);
  assert.equal(l1.staker.step, "staker");
  assert.equal(l1.inner.open, false);
  assert.deepEqual(l1.inner.missing, ["Reach level 2"]);
  assert.ok(l1.inner.chapters.every((c) => c.locked && !c.text));
  assert.equal(l1.stakeToday.open, false);
  const l2 = view(small, 2);
  assert.equal(l2.inner.open, true);
  assert.equal(l2.inner.chapters[0].text, DEFAULT_CHAPTERS[0].text);
  assert.equal(l2.stakeToday.open, true);
  assert.equal(l2.gates.patron_line.open, false, "the rest of the patron line waits for level 4");
  assert.deepEqual(l2.gates.patron_line.missing.map((m) => m.label), ["Reach level 4"]);
  assert.deepEqual(l2.gates.t2_lines.missing.map((m) => m.label), ["Reach Tier 2 (10 NEAR matured)", "Reach level 6"]);
  // 1 NEAR is not enough; the chip names the stake and the level.
  const poor = setup().view(state({ principal: 1n * N, epoch: 100 }), 1).inner;
  assert.deepEqual(poor.missing, ["Stake 2 NEAR", "Reach level 2"]);
  assert.equal(poor.stakeNear, "2");
  // Still maturing: the chip says so instead of asking for more.
  const young = setup().view(state({ principal: 3n * N, mature: 0n, epoch: 100 }), 5).inner;
  assert.deepEqual(young.missing, ["Your stake is maturing (E+2)"]);

  const custom = keeperVaultSettings({
    KEEPER_MATURITY_EPOCHS: "3",
    KEEPER_EPOCH_HOURS: "6",
    KEEPER_PATRON_TITLE: "Friend of the Vault",
    KEEPER_CEREMONIES: "0",
  });
  assert.deepEqual(
    [custom.maturityEpochs, custom.epochHours, custom.patronTitle, custom.ceremonies],
    [3, 6, "Friend of the Vault", false],
  );
  assert.equal(keeperVaultSettings({ KEEPER_MATURITY_EPOCHS: "99" }).maturityEpochs, 2, "bad values fall back");
  assert.equal(keeperVaultSettings({ KEEPER_VAULT_ENABLED: "0" }).enabled, false);
});

test("at 0 % city share the Keeper counts a stake as matured after its own E+2 observation", () => {
  const { view, db, player } = setup();
  const zero = (epoch) => state({ principal: 2n * N, bps: 0, epoch });
  assert.equal(view(zero(100), 2).staker.step, "none");
  assert.equal(view(zero(101), 2).staker.step, "none");
  const later = view(zero(102), 2);
  assert.equal(later.staker.step, "staker");
  assert.equal(later.inner.open, true);
  assert.equal(db.prepare("SELECT matured FROM staker_status WHERE player_id=?").get(player).matured, (2n * N).toString());
});

test("your stake today: growth since the last reading before today and today's coin equivalence", () => {
  const { view, at } = setup({ today: () => ({ dayId: "d1", coinUnit: (N / 1000n).toString(), coinCount: 40, funding: "realized_yield" }) });
  at("2026-11-01T20:00:00Z");
  view(state({ principal: 10n * N, owner: 1n * N, game: N / 100n }));
  at("2026-11-02T09:00:00Z");
  const card = view(state({ principal: 10n * N, staked: 10n * N + N / 50n, owner: 1n * N + N / 10n, game: N / 50n }));
  const t = card.accounts[0].vaults[0].today;
  assert.equal(t.sinceYesterday, true);
  assert.equal(t.retained, (N / 10n).toString());
  assert.equal(t.given, (N / 100n).toString());
  assert.equal(card.accounts[0].vaults[0].totals.inPool, (N / 50n).toString());
  // 0.02 NEAR paid to the city ÷ 0.001 per coin = 20 coins' worth (of 40).
  assert.equal(card.coins.backed, 20);
  assert.equal(card.coins.funding, "realized_yield");
});

test("the Keeper view and the Profile stake route return the card; ceremonies close by id", async () => {
  const { db, player, kv } = setup();
  const vaults = {
    snapshot: async () => ({
      positions: [{ account_id: "v1.testnet", pool: "pool", state: "ready", position: state({ principal: 100n * N, epoch: 100 }) }],
    }),
  };
  const view = await keeperView({ db, player, market: null, vaults, keeperVault: kv, level: 6 });
  assert.ok(view.lines.length);
  assert.equal(view.stake.tier, 2);
  assert.equal(view.stake.inner.open, true);
  const routes = createTraderRoutes({ traders: null, actors: null, db, market: null, vaults, keeperVault: kv, levelOf: () => 2 });
  let sent;
  const ctx = {
    player,
    body: async () => ({}),
    respond: (_res, value) => (sent = value),
    assert: (ok, msg) => {
      if (!ok) throw new Error(msg);
    },
  };
  assert.equal(await routes.handle({ method: "GET" }, {}, new URL("http://x/api/keeper/stake"), ctx), true);
  assert.equal(sent.inner.open, true, "Tier 2 at level 2 opens the inner vault (Staker + L2)");
  assert.equal(sent.linked, 1);
  const id = sent.ceremonies.find((c) => c.kind === "tier").id;
  assert.equal(await routes.handle({ method: "POST" }, {}, new URL(`http://x/api/keeper/ceremonies/${id}/seen`), ctx), true);
  assert.equal(sent.seen, true);
});

test("held liquid tokens count toward the Staker step only, never toward a tier", async () => {
  const { kv, player, db } = setup();
  const liquidView = (liquid) => kv.view({ player, level: 2, positions: [], liquid });
  // 2 NEAR of stNEAR held through the window: Staker, still Tier 1.
  const held = liquidView({ matureNear: (2n * N).toString(), near: (2n * N).toString(), holdHours: 24 });
  assert.equal(held.staker.step, "staker");
  assert.equal(held.tier, 1);
  assert.equal(held.inner.open, true);
  assert.equal(held.staker.liquid.matureNear, (2n * N).toString());
  // 100 NEAR of liquid tokens is still no tier: tiers and the city share stay in the vault.
  const whale = liquidView({ matureNear: (100n * N).toString(), near: (100n * N).toString() });
  assert.equal(whale.tier, 1);
  assert.equal(whale.gates.t2_lines.open, false);
  // A fresh purchase is maturing, not counted.
  const fresh = liquidView({ matureNear: "0", near: (2n * N).toString() });
  assert.equal(fresh.staker.step, "none");
  assert.equal(fresh.staker.maturing, (2n * N).toString());
  // 1 NEAR in the vault + 1 NEAR of tokens add up.
  const mixed = kv.view({
    player,
    level: 2,
    positions: [{ accountId: "pat.testnet", vaults: [{ vault: "v1.testnet", pool: "pool", state: "ready", s: state({ principal: 1n * N, epoch: 100 }) }] }],
    liquid: { matureNear: (1n * N).toString(), near: (1n * N).toString() },
  });
  assert.equal(mixed.staker.step, "staker");
  // The stake card route passes the reader through.
  const reader = { forPlayer: async () => ({ matureNear: (2n * N).toString(), holdHours: 24, unreadable: 0, readings: [{ near: (2n * N).toString() }] }) };
  const routes = createTraderRoutes({ db, vaults: { snapshot: async () => ({ positions: [] }) }, keeperVault: kv, liquidStake: reader, levelOf: () => 2 });
  let body;
  await routes.handle({ method: "GET" }, {}, new URL("http://x/api/keeper/stake"), {
    player,
    respond: (_res, v) => (body = v),
    assert: (ok, msg) => {
      if (!ok) throw new Error(msg);
    },
  });
  assert.equal(body.staker.step, "staker");
  assert.equal(body.staker.liquid.near, (2n * N).toString());
});

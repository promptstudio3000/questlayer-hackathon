// Keeper's inner vault (GAME-LOOPS P0-3): stake card, E+2 countdown,
// ceremonies and the tier + level gate. Read-only over vault state.
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

test("the inner vault needs both tier and level, and every default is configurable", () => {
  const { view } = setup();
  const s = state({ principal: 100n * N, epoch: 100 }); // weighted 50 → tier 2
  const low = view(s, 4).inner;
  assert.equal(low.open, false);
  assert.deepEqual(low.missing, ["Level 5"]);
  assert.ok(low.chapters.every((c) => c.locked && !c.text));
  const open = view(s, 5).inner;
  assert.equal(open.open, true);
  assert.equal(open.chapters[0].text, DEFAULT_CHAPTERS[0].text);
  const poor = view(state({ principal: 10n * N, epoch: 100 }), 9).inner;
  assert.deepEqual(poor.missing, ["Tier 2 (matured stake)"]);

  const custom = keeperVaultSettings({
    KEEPER_INNER_TIER: "3",
    KEEPER_INNER_LEVEL: "8",
    KEEPER_MATURITY_EPOCHS: "3",
    KEEPER_EPOCH_HOURS: "6",
    KEEPER_PATRON_TITLE: "Friend of the Vault",
    KEEPER_CEREMONIES: "0",
  });
  assert.deepEqual(
    [custom.innerTier, custom.innerLevel, custom.maturityEpochs, custom.epochHours, custom.patronTitle, custom.ceremonies],
    [3, 8, 3, 6, "Friend of the Vault", false],
  );
  assert.equal(keeperVaultSettings({ KEEPER_INNER_TIER: "9" }).innerTier, 2, "bad values fall back");
  assert.equal(keeperVaultSettings({ KEEPER_VAULT_ENABLED: "0" }).enabled, false);
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
  assert.equal(sent.inner.open, false, "level 2 keeps the inner vault closed");
  assert.equal(sent.linked, 1);
  const id = sent.ceremonies.find((c) => c.kind === "tier").id;
  assert.equal(await routes.handle({ method: "POST" }, {}, new URL(`http://x/api/keeper/ceremonies/${id}/seen`), ctx), true);
  assert.equal(sent.seen, true);
});

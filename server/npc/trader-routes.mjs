// Routes for NPC traders and the vault keeper (N3). Trade and keeper calls
// need a live encounter token (the player is standing next to the NPC).
//   POST /api/actors/:id/offers/(trade_buy|trade_sell|trade_up):<hex>/accept   {encounter}
//   POST /api/actors/:id/offers/trade_up:<hex>/complete                       {encounter}
//   POST /api/actors/:id/keeper                                               {encounter}
//   GET  /api/npc/traders     public books: float, 7-day P&L, premiums, sweeps
//   GET  /api/npc/trades      the player's trader trades with their tx hashes
//   POST /api/npc/trades/tx   {tradeId, transactionHash} records a trade-up hand-over
//   POST /api/npc/trades/fill {tradeId, signed} settles an accepted buy or sale on
//                             NEAR Intents with the player's signed token_diff
//   GET  /api/keeper/stake                       "your stake today" card (Profile → Stake)
//   POST /api/keeper/ceremonies/:id/seen         closes an E+2 / tier ceremony
//   POST /api/keeper/rank/:rank/seen             closes a patron rank-up ceremony
//   GET  /api/staker/gates       the staker gate table with this player's state
// A liquid-stake reader (server/native/liquid-stake.mjs), when on, adds held
// stNEAR/LiNEAR to the Staker step of the Keeper's reading.
import { formatNear } from "./trader-pricing.mjs";
import { patronPathView } from "./patron-path.mjs";
import { allGates, defaultStakerGates, playerStakerAccess } from "../staker-gates.mjs";

const TRADE = /^\/api\/actors\/([a-z0-9-]{3,44})\/offers\/((?:trade_buy|trade_sell|trade_up):[0-9a-f]{16})\/(accept|complete)$/;
const KEEPER = /^\/api\/actors\/([a-z0-9-]{3,44})\/keeper$/;
const CEREMONY = /^\/api\/keeper\/ceremonies\/(kcer_[A-Za-z0-9_-]{4,80})\/seen$/;
const RANK_SEEN = /^\/api\/keeper\/rank\/([1-5])\/seen$/;

function linkedAccounts(db, player) {
  return db
    .prepare("SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at")
    .all(player)
    .map((r) => r.account_id)
    .slice(0, 3);
}

/** Liquid tokens held by the player's linked wallets, or null when off/unreadable. */
async function liquidOf(liquidStake, db, player) {
  if (!liquidStake) return null;
  try {
    const r = await liquidStake.forPlayer(db, player);
    const near = r.readings.reduce((a, x) => a + BigInt(x.near), 0n).toString();
    return { matureNear: r.matureNear, near, holdHours: r.holdHours, unreadable: r.unreadable };
  } catch {
    return null;
  }
}

/** Plain-language view of a player's market balance and vault positions. */
export async function keeperView({ db, player, market, vaults, keeperVault = null, level = 1, liquidStake = null }) {
  const accounts = linkedAccounts(db, player);
  const out = { accounts: [], lines: [] };
  const positions = [];
  if (!accounts.length) {
    out.lines.push("Link a NEAR account and I can show your market balance and staking vaults.");
    return out;
  }
  for (const accountId of accounts) {
    const entry = { accountId, market: null, vaults: [] };
    if (market) {
      try {
        const a = await market.view("get_account", { account_id: accountId }, true);
        entry.market = { credit: a.credit, withdrawing: a.withdrawing, listed: a.listed };
        out.lines.push(
          `${accountId}: ${formatNear(a.credit)} test NEAR in your market balance${BigInt(a.withdrawing || "0") > 0n ? `, ${formatNear(a.withdrawing)} on its way out` : ""}${a.listed ? `, ${a.listed} Aura(s) held by the market` : ""}.`,
        );
      } catch {
        out.lines.push(`${accountId}: the market balance is not readable right now.`);
      }
    }
    if (vaults) {
      try {
        const snap = await vaults.snapshot(player, accountId);
        positions.push({
          accountId,
          vaults: snap.positions.map((p) => ({ vault: p.account_id, pool: p.pool, state: p.state, s: p.position })),
        });
        for (const p of snap.positions) {
          const s = p.position || {};
          const v = {
            vault: p.account_id,
            state: p.state,
            pool: p.pool,
            staked: s.staked ?? null,
            contributionPercent: s.contribution_bps != null ? s.contribution_bps / 100 : null,
            exitRequested: !!s.exit_requested,
            unlockEpoch: s.unlock_epoch ?? null,
            epoch: s.epoch ?? null,
            ownerCredit: s.owner_credit ?? null,
          };
          entry.vaults.push(v);
          out.lines.push(
            `Vault ${p.account_id} (${p.state})${v.staked != null ? `: ${formatNear(v.staked)} test NEAR staked` : ""}${v.contributionPercent != null ? `, ${v.contributionPercent}% of the yield goes to the game` : ""}${v.ownerCredit != null && BigInt(v.ownerCredit) > 0n ? `, ${formatNear(v.ownerCredit)} test NEAR earned for you` : ""}${v.exitRequested ? `, exit requested (unlocks at epoch ${v.unlockEpoch}, now ${v.epoch})` : ""}.`,
          );
        }
        if (!snap.positions.length) out.lines.push(`${accountId}: no staking vault yet. Open Stake to create one.`);
      } catch {
        out.lines.push(`${accountId}: the vaults are not readable right now.`);
      }
    }
    out.accounts.push(entry);
  }
  out.lines.push("I never move your funds: every deposit, exit or change is signed by you on the usual confirmation screen.");
  if (keeperVault?.settings.enabled)
    out.stake = keeperVault.view({
      player,
      level,
      positions,
      liquid: await liquidOf(liquidStake, db, player),
      patronPath: (gate) => patronPathView(db, player, gate),
    });
  return out;
}

/** The stake card without the market lines, for Profile → Stake. */
export async function stakeCard({ db, player, vaults, keeperVault, level = 1, liquidStake = null }) {
  const positions = [];
  let unreadable = 0;
  for (const accountId of linkedAccounts(db, player)) {
    try {
      const snap = await vaults.snapshot(player, accountId);
      positions.push({
        accountId,
        vaults: snap.positions.map((p) => ({ vault: p.account_id, pool: p.pool, state: p.state, s: p.position })),
      });
    } catch {
      unreadable++;
    }
  }
  const liquid = await liquidOf(liquidStake, db, player);
  return {
    ...keeperVault.view({ player, level, positions, liquid, patronPath: (gate) => patronPathView(db, player, gate) }),
    linked: positions.length + unreadable,
    unreadable,
  };
}

/** Gate table + the player's cached staker state, for chips and the stake sheet. */
export function stakerGatesView({ db, player, level = 1, worldTier = 1, gates = defaultStakerGates(), priceEur = null }) {
  const access = playerStakerAccess(db, player, { worldTier, level, settings: gates });
  return {
    policy: gates.policy,
    version: gates.version,
    minNear: gates.minNear,
    suggestNear: gates.minNear,
    priceEur: priceEur > 0 ? priceEur : null,
    access: { step: access.stepName, staker: access.staker, tier: access.tier, level: access.level, matured: access.matured, maturing: access.pending },
    gates: allGates(access, { settings: gates, priceEur }),
  };
}

export function createTraderRoutes({ traders, actors, db, market, vaults, keeperVault = null, levelOf = () => 1, priceEur = () => null, gates = defaultStakerGates(), liquidStake = null }) {
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (path === "/api/npc/traders" && method === "GET") {
        assert(traders, "NPC traders are not open here.", 503, "NPC_TRADERS_DISABLED");
        respond(res, await traders.books());
        return true;
      }
      if (path === "/api/npc/trades" && method === "GET") {
        assert(traders, "NPC traders are not open here.", 503, "NPC_TRADERS_DISABLED");
        assert(player, "Sign in first.", 401);
        respond(res, { network: "testnet", trades: traders.myTrades(player) });
        return true;
      }
      if (path === "/api/npc/trades/tx" && method === "POST") {
        assert(traders, "NPC traders are not open here.", 503, "NPC_TRADERS_DISABLED");
        assert(player, "Sign in first.", 401);
        const input = await body(req);
        respond(res, await traders.recordTx({ player, tradeId: input.tradeId, transactionHash: input.transactionHash }));
        return true;
      }
      if (path === "/api/npc/trades/fill" && method === "POST") {
        assert(traders, "NPC traders are not open here.", 503, "NPC_TRADERS_DISABLED");
        assert(player, "Sign in first.", 401);
        const input = await body(req);
        assert(input?.signed && typeof input.signed === "object", "Sign your side of the trade first.", 400, "NPC_TX");
        respond(res, await traders.fill({ player, tradeId: input.tradeId, signed: input.signed }));
        return true;
      }
      if (path === "/api/staker/gates" && method === "GET") {
        respond(res, stakerGatesView({ db, player, level: player ? levelOf(player) : 1, gates, priceEur: priceEur() }));
        return true;
      }
      if (path === "/api/keeper/stake" && method === "GET") {
        assert(keeperVault?.settings.enabled && vaults, "The Keeper's vault is not open here.", 503, "KEEPER_DISABLED");
        respond(res, await stakeCard({ db, player, vaults, keeperVault, level: levelOf(player), liquidStake }));
        return true;
      }
      const ceremony = method === "POST" && path.match(CEREMONY);
      if (ceremony) {
        assert(keeperVault, "The Keeper's vault is not open here.", 503, "KEEPER_DISABLED");
        respond(res, keeperVault.seen(player, ceremony[1]));
        return true;
      }
      const rankSeen = method === "POST" && path.match(RANK_SEEN);
      if (rankSeen) {
        assert(keeperVault, "The Keeper's vault is not open here.", 503, "KEEPER_DISABLED");
        respond(res, keeperVault.rankSeen(player, Number(rankSeen[1])));
        return true;
      }
      if (method !== "POST" || !path.startsWith("/api/actors/")) return false;
      const trade = path.match(TRADE),
        keeper = path.match(KEEPER);
      if (!trade && !keeper) return false;
      assert(actors, "Characters on the map are not enabled here.", 503, "ACTORS_DISABLED");
      const input = await body(req);
      const actorId = (trade || keeper)[1];
      const encounter = await actors.requireEncounter({ token: input.encounter, player, actorId });
      const actor = { ...encounter.def, ...encounter.actor };
      if (keeper) {
        assert(actor.archetype === "keeper", "This character keeps no vault.", 404, "NPC_UNKNOWN");
        respond(res, await keeperView({ db, player, market, vaults, keeperVault, level: levelOf(player), liquidStake }));
        return true;
      }
      assert(traders?.isTrader(actorId), "This trader is not open for business yet.", 503, "NPC_TRADERS_DISABLED");
      if (trade[3] === "accept") respond(res, await traders.accept({ player, actor, encounter, offerId: trade[2] }));
      else {
        assert(trade[2].startsWith("trade_up:"), "Only trade-ups are turned in.", 400, "NPC_OFFER");
        respond(res, await traders.completeTradeUp({ player, actor, offerId: trade[2] }));
      }
      return true;
    },
  };
}

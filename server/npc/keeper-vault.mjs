// Keeper's inner vault (GAME-LOOPS P0-3): the bank NPC gets a job.
//  - "Your stake today": what each vault retained for the player and gave to
//    the city since the start of the day, plus how many of today's coins the
//    player's realized contribution equals in value (attribution only: the
//    coins stay shared and first-come; this is a display, not a money path).
//  - E+2 countdown: the vault contract counts a deposit toward tier only from
//    the second epoch after it (contracts/vault get_state). The chain does not
//    expose tranche epochs, so the Keeper notes the epoch it first saw a new,
//    not-yet-mature deposit; the countdown is "by epoch X at the latest".
//  - Ceremonies: a one-time moment when a deposit matures and when the
//    account reaches a new tier. The patron title it grants is cosmetic and
//    stays after a withdrawal (no decay, D29).
//  - Inner vault and the "stake today" card: gated by the staker gate table
//    (server/staker-gates.mjs, owner decision 1 Nov 23:47: Staker + level 2,
//    where Staker = at least STAKER_MIN_NEAR of matured stake). Lures are
//    things to read or wear, never odds, payouts or multipliers.
//  - Staker status: every reading records the player's matured stake so NPC
//    menus can check staker gates without a chain call.
// Reads only. It never signs, moves funds or changes a chance.
import { readFileSync } from "node:fs";
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";
import { dayKey, id } from "../domain.mjs";
import { allGates, checkGate, defaultStakerGates, recordStakerStatus, stakerAccess } from "../staker-gates.mjs";

export const KEEPER_VAULT_SCHEMA = registerModuleSchema({
  name: "keeper-vault",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS keeper_vault_watch(
  vault TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  principal TEXT NOT NULL,
  pending TEXT NOT NULL,
  pending_since_epoch INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS keeper_stake_days(
  vault TEXT NOT NULL,
  day TEXT NOT NULL,
  account_id TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  first_json TEXT NOT NULL,
  last_at INTEGER NOT NULL,
  last_json TEXT NOT NULL,
  PRIMARY KEY(vault, day)
);
CREATE TABLE IF NOT EXISTS keeper_ceremonies(
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('matured','tier')),
  ref TEXT NOT NULL,
  tier INTEGER,
  amount TEXT,
  epoch INTEGER,
  created_at INTEGER NOT NULL,
  seen_at INTEGER,
  UNIQUE(account_id, kind, ref)
);
`,
});

const YOCTO = 10n ** 24n;
// Rounding dust from reversing mul_bps(mul_ratio(...)) in the contract.
const DUST = 10n ** 18n;
const TIERS = [
  { tier: 3, weighted: 100n * YOCTO },
  { tier: 2, weighted: 50n * YOCTO },
];

export const DEFAULT_CHAPTERS = [
  {
    title: "The ledger behind the gate",
    text: "Every coin on today's map was paid for before it appeared: by yield that vaults already sent in, or by a sponsor. Nothing here is printed. That is the first rule of this vault.",
  },
  {
    title: "Why two epochs",
    text: "A deposit sits with the validator for two epochs before it counts. The pool needs that long to put it to work, and the city refuses to count fuel that is not burning yet.",
  },
  {
    title: "What patrons are for",
    text: "Patrons do not get luckier and they do not hit harder. They get doors: zones, lines and stories that only open when someone keeps the city fuelled and keeps walking it.",
  },
];

const int = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** Every default is configurable through the environment. */
export function keeperVaultSettings(env = process.env) {
  let chapters = DEFAULT_CHAPTERS;
  if (env.KEEPER_INNER_PATH) {
    try {
      const parsed = JSON.parse(readFileSync(env.KEEPER_INNER_PATH, "utf8"));
      const list = Array.isArray(parsed) ? parsed : parsed.chapters;
      if (
        Array.isArray(list) &&
        list.length &&
        list.length <= 12 &&
        list.every((c) => typeof c?.title === "string" && typeof c?.text === "string" && c.title.length <= 80 && c.text.length <= 800)
      )
        chapters = list.map((c) => ({ title: c.title, text: c.text }));
    } catch {
      /* A broken override keeps the default chapters. */
    }
  }
  return {
    enabled: env.KEEPER_VAULT_ENABLED !== "0",
    // The inner vault gate moved to server/data/staker-gates.json
    // (keeper_inner, stake_today); STAKER_GATES_JSON overrides it.
    maturityEpochs: int(env.KEEPER_MATURITY_EPOCHS, 2, 0, 10),
    epochHours: Number(env.KEEPER_EPOCH_HOURS) > 0 && Number(env.KEEPER_EPOCH_HOURS) <= 48 ? Number(env.KEEPER_EPOCH_HOURS) : 12,
    patronTitle: (env.KEEPER_PATRON_TITLE || "Patron of the Gate").slice(0, 40),
    ceremonies: env.KEEPER_CEREMONIES !== "0",
    chapters,
    timezone: env.KEEPER_TIMEZONE || "Europe/Prague",
  };
}

const big = (v) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};
const sum = (...values) => values.reduce((t, v) => t + big(v), 0n);
export const tierFor = (weighted) => TIERS.find((t) => big(weighted) >= t.weighted)?.tier || 1;

/**
 * Mature vs. pending principal of one vault from its public state. The
 * contract reports weighted = mature × active/principal × contribution, so the
 * mature part can be read back unless the contribution is 0 % (then the stake
 * never counts toward tier and maturity cannot be seen on chain).
 */
export function vaultMaturity(s) {
  const principal = big(s.principal),
    staked = big(s.staked),
    weighted = big(s.weighted_stake),
    bps = BigInt(Number.isInteger(s.contribution_bps) ? s.contribution_bps : 0),
    epoch = Number(s.epoch),
    observed = Number(s.observed_epoch);
  if (principal === 0n) return { state: "empty", principal, mature: 0n, pending: 0n };
  if (s.exit_requested) return { state: "exiting", principal, mature: 0n, pending: 0n };
  if (Number.isFinite(observed) && Number.isFinite(epoch) && observed + 1 < epoch)
    return { state: "refreshing", principal, mature: null, pending: null };
  const active = staked < principal ? staked : principal;
  if (bps === 0n || active === 0n) return { state: "uncounted", principal, mature: null, pending: null };
  let mature = (weighted * 10000n * principal) / (bps * active);
  if (mature > principal) mature = principal;
  let pending = principal - mature;
  if (pending <= DUST) {
    pending = 0n;
    mature = principal;
  }
  return { state: pending > 0n ? "pending" : "mature", principal, mature, pending };
}

/** Running totals one vault has produced, as yocto bigints. */
export function vaultTotals(s) {
  const principal = big(s.principal),
    staked = big(s.staked);
  return {
    retained: sum(s.owner_credit, s.owner_pending, s.owner_paid),
    given: sum(s.game_credit, s.game_pending, s.game_paid),
    givenPaid: big(s.game_paid),
    // Pool rewards the vault has not split yet (staked value above principal).
    inPool: staked > principal ? staked - principal : 0n,
  };
}

const str = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? null : v.toString()]));

/** Matured stake that is actually staked (active), in yocto; null if unknown. */
export function maturedActive(s, m = vaultMaturity(s)) {
  if (m.mature == null) return null;
  const principal = big(s.principal),
    staked = big(s.staked);
  if (principal === 0n) return 0n;
  const active = staked < principal ? staked : principal;
  return (m.mature * active) / principal;
}

export function createKeeperVault(
  db,
  { clock = Date.now, settings = keeperVaultSettings(), today = () => null, gates = defaultStakerGates(), priceEur = () => null } = {},
) {
  // Tables appear on the first Keeper visit, not at boot, like the other
  // optional NPC modules (a host that never opens the vault stays unchanged).
  let ready = false;
  const init = () => {
    if (!ready) ensureModuleVersion(db, KEEPER_VAULT_SCHEMA);
    ready = true;
  };
  const q = (sql) => db.prepare(sql);

  function remember(player, accountId, vault, s, maturity) {
    const now = clock(),
      epoch = Number(s.epoch);
    if (maturity.state === "pending" || maturity.state === "mature" || maturity.state === "empty" || maturity.state === "exiting") {
      const row = q("SELECT * FROM keeper_vault_watch WHERE vault=?").get(vault);
      const pending = maturity.pending ?? 0n;
      let since = row?.pending_since_epoch ?? null;
      if (pending > 0n) {
        if (!row || big(row.pending) === 0n || maturity.principal > big(row.principal)) since = epoch;
      } else {
        if (row && big(row.pending) > 0n && maturity.state === "mature" && settings.ceremonies)
          q(
            "INSERT OR IGNORE INTO keeper_ceremonies(id,player_id,account_id,kind,ref,tier,amount,epoch,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          ).run(id("kcer"), player, accountId, "matured", `${vault}:${row.pending_since_epoch ?? epoch}`, null, row.pending, epoch, now);
        since = null;
      }
      q(
        "INSERT INTO keeper_vault_watch(vault,account_id,principal,pending,pending_since_epoch,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(vault) DO UPDATE SET account_id=excluded.account_id,principal=excluded.principal,pending=excluded.pending,pending_since_epoch=excluded.pending_since_epoch,updated_at=excluded.updated_at",
      ).run(vault, accountId, maturity.principal.toString(), pending.toString(), since, now);
      return since;
    }
    return q("SELECT pending_since_epoch FROM keeper_vault_watch WHERE vault=?").get(vault)?.pending_since_epoch ?? null;
  }

  // At 0 % city share the contract reports no weighted stake, so maturity
  // cannot be read back. For the Staker step (not for tiers) the Keeper uses
  // its own observation: principal unchanged for maturityEpochs epochs.
  function observedMature(accountId, vault, s) {
    const principal = big(s.principal),
      epoch = Number(s.epoch);
    if (!Number.isFinite(epoch) || principal === 0n) return { matured: 0n, pending: 0n };
    const row = q("SELECT * FROM keeper_vault_watch WHERE vault=?").get(vault);
    // First sighting or a new deposit starts the clock; otherwise keep it
    // (null = already matured). A first sighting is counted conservatively.
    const since = !row || principal > big(row.principal) ? epoch : (row.pending_since_epoch ?? null);
    const done = since == null || epoch >= since + settings.maturityEpochs;
    q(
      "INSERT INTO keeper_vault_watch(vault,account_id,principal,pending,pending_since_epoch,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(vault) DO UPDATE SET account_id=excluded.account_id,principal=excluded.principal,pending=excluded.pending,pending_since_epoch=excluded.pending_since_epoch,updated_at=excluded.updated_at",
    ).run(vault, accountId, principal.toString(), done ? "0" : principal.toString(), done ? null : since, clock());
    const staked = big(s.staked),
      active = staked < principal ? staked : principal;
    return done ? { matured: active, pending: 0n } : { matured: 0n, pending: principal };
  }

  function daily(accountId, vault, totals) {
    const now = clock(),
      day = dayKey(now, settings.timezone),
      json = JSON.stringify(str(totals));
    q(
      "INSERT INTO keeper_stake_days(vault,day,account_id,first_at,first_json,last_at,last_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(vault,day) DO UPDATE SET last_at=excluded.last_at,last_json=excluded.last_json",
    ).run(vault, day, accountId, now, json, now, json);
    // Baseline: the last reading before today, else the first one today.
    const before = q("SELECT last_at at,last_json json FROM keeper_stake_days WHERE vault=? AND day<? ORDER BY day DESC LIMIT 1").get(vault, day);
    const first = q("SELECT first_at at,first_json json FROM keeper_stake_days WHERE vault=? AND day=?").get(vault, day);
    const base = before || first,
      b = JSON.parse(base.json);
    const delta = (k) => {
      const d = totals[k] - big(b[k]);
      return d > 0n ? d : 0n;
    };
    return { since: base.at, sinceYesterday: !!before, retained: delta("retained"), given: delta("given"), inPool: totals.inPool - big(b.inPool) };
  }

  /**
   * Stake card for one player. `positions` are the vault snapshot rows of
   * each linked account: [{accountId, vaults: [{vault, pool, state, s}]}].
   */
  function view({ player, level, positions, patronPath = null }) {
    init();
    const accounts = [];
    let weighted = 0n,
      matured = 0n,
      maturing = 0n,
      givenPaid = 0n,
      epoch = null,
      anyPosition = false;
    for (const { accountId, vaults } of positions) {
      const out = [];
      let accountWeighted = 0n;
      for (const { vault, pool, state, s } of vaults) {
        if (!s) {
          out.push({ vault, pool, state, maturity: { state: state === "failed" ? "failed" : "setup" } });
          continue;
        }
        anyPosition = true;
        epoch = Number(s.epoch);
        accountWeighted += big(s.weighted_stake);
        const m = vaultMaturity(s),
          totals = vaultTotals(s),
          since = remember(player, accountId, vault, s, m),
          today = daily(accountId, vault, totals);
        givenPaid += totals.givenPaid;
        if (m.state === "uncounted" && !s.exit_requested) {
          const o = observedMature(accountId, vault, s);
          matured += o.matured;
          maturing += o.pending;
        } else if (m.state === "pending" || m.state === "mature") {
          matured += maturedActive(s, m) ?? 0n;
          maturing += m.pending ?? 0n;
        }
        const byEpoch = m.state === "pending" && since != null ? since + settings.maturityEpochs : null;
        const epochsLeft = byEpoch != null ? Math.max(0, byEpoch - epoch) : null;
        out.push({
          vault,
          pool,
          state,
          contributionPercent: Number.isInteger(s.contribution_bps) ? s.contribution_bps / 100 : null,
          principal: m.principal.toString(),
          maturity: {
            state: m.state,
            mature: m.mature?.toString() ?? null,
            pending: m.pending?.toString() ?? null,
            seenEpoch: m.state === "pending" ? since : null,
            byEpoch,
            epochsLeft,
            hoursLeft: epochsLeft != null ? epochsLeft * settings.epochHours : null,
          },
          totals: str(totals),
          today: { ...str(today), since: today.since, sinceYesterday: today.sinceYesterday },
        });
      }
      weighted += accountWeighted;
      const tier = tierFor(accountWeighted);
      if (settings.ceremonies && tier >= 2) {
        const known = q("SELECT MAX(tier) t FROM keeper_ceremonies WHERE account_id=? AND kind='tier'").get(accountId)?.t || 1;
        if (tier > known)
          for (let t = known + 1; t <= tier; t++)
            q(
              "INSERT OR IGNORE INTO keeper_ceremonies(id,player_id,account_id,kind,ref,tier,amount,epoch,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            ).run(id("kcer"), player, accountId, "tier", `tier-${t}`, t, null, epoch, clock());
      }
      accounts.push({ accountId, tier, weighted: accountWeighted.toString(), vaults: out });
    }
    const tier = Math.max(1, ...accounts.map((a) => a.tier));
    const next = TIERS.slice().reverse().find((t) => t.tier > tier);
    const day = today();
    let coins = null;
    if (day && big(day.coinUnit) > 0n) {
      const backed = givenPaid / big(day.coinUnit);
      coins = {
        dayId: day.dayId,
        coinUnit: String(day.coinUnit),
        coinCount: day.coinCount,
        funding: day.funding,
        // Value equivalence of your realized contribution, capped at today's count.
        backed: Number(backed > BigInt(day.coinCount) ? BigInt(day.coinCount) : backed),
        givenPaid: givenPaid.toString(),
      };
    }
    const ceremonies = q(
      "SELECT id,account_id accountId,kind,tier,amount,epoch,created_at createdAt,seen_at seenAt FROM keeper_ceremonies WHERE player_id=? ORDER BY created_at DESC LIMIT 20",
    ).all(player);
    const patronSince = q("SELECT MIN(created_at) t FROM keeper_ceremonies WHERE player_id=? AND kind='tier'").get(player)?.t ?? null;
    const access = stakerAccess({ tier, matured, pending: maturing, weighted, level }, gates);
    recordStakerStatus(db, player, { tier, matured, pending: maturing, weighted }, clock());
    const price = priceEur();
    const inner = checkGate("keeper_inner", access, { settings: gates, priceEur: price });
    const stakeToday = checkGate("stake_today", access, { settings: gates, priceEur: price });
    const open = inner.open;
    return {
      epoch,
      epochHours: settings.epochHours,
      maturityEpochs: settings.maturityEpochs,
      tier,
      weighted: weighted.toString(),
      nextTier: next ? { tier: next.tier, weighted: next.weighted.toString(), missing: (next.weighted - weighted).toString() } : null,
      hasPosition: anyPosition,
      accounts,
      coins,
      ceremonies: ceremonies.filter((c) => !c.seenAt),
      patron: patronSince ? { title: settings.patronTitle, since: patronSince } : null,
      staker: {
        step: access.stepName,
        staker: access.staker,
        matured: access.matured,
        maturing: access.pending,
        minNear: gates.minNear,
        priceEur: price,
      },
      stakeToday: { open: stakeToday.open, missing: stakeToday.missing.map((m) => m.label), stakeNear: stakeToday.stakeNear },
      gates: allGates(access, { settings: gates, priceEur: price }),
      inner: {
        open,
        gate: inner.need,
        have: { step: access.stepName, tier, level },
        missing: inner.missing.map((m) => m.label),
        stakeNear: inner.stakeNear,
        chapters: open ? settings.chapters : settings.chapters.map((c) => ({ title: c.title, locked: true })),
        // Patron's Path (P1-1, server/npc/patron-path.mjs): progress through
        // the patron quest lines. Shown to everyone; walking it needs the tier.
        ...(patronPath
          ? { path: typeof patronPath === "function" ? patronPath({ access, settings: gates, priceEur: price }) : patronPath }
          : {}),
      },
    };
  }

  function seen(player, ceremonyId) {
    init();
    const r = q("UPDATE keeper_ceremonies SET seen_at=? WHERE id=? AND player_id=? AND seen_at IS NULL").run(clock(), ceremonyId, player);
    return { seen: r.changes > 0 };
  }

  return { view, seen, settings };
}

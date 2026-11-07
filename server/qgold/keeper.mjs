// QGOLD market keeper (docs/QGOLD-MARKET.md). Testnet only.
//
// Every market action happens at one of 12 sale times a day. The times are
// committed (sha256 of a secret salt) before the NEAR block whose random seed
// fixes them exists, and the salt is revealed after the day, so anyone can
// check that the keeper did not pick its moments and nobody could front-run
// them. At each due time the keeper:
//   1. inverse buy + burn while the Rhea pool price is under R,
//   2. buyback + burn from 20 % of fees while the price is under 1.1 R,
//   3. sells newly deposited QGOLD while the price is over 1.1 R (1/12 of
//      half the gap, ≤ 2 % of supply a day, vs the 24 h average price).
// All of it is off while the pool holds less than ~500 NEAR. Without
// QGOLD_KEEPER_EXECUTE=1 and a keeper key it only records what it would do.
import { randomBytes } from "node:crypto";
import { keeperTransport } from "./keeper-transport.mjs";
import { ensureKeeperJournal, withKeeperLease, pendingKeeperOperation, keeperLegacyBlocked,
  reserveKeeperPlan, resumeKeeperOperations, keeperSums } from "./keeper-journal.mjs";
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";
import {
  POLICY,
  askLadder,
  average24h,
  backingRate,
  buybackBudget,
  keeperPlan,
  poolPrice,
  saleTimes,
  scheduleCommitment,
} from "./market-math.mjs";

export const QGOLD_KEEPER_SCHEMA = registerModuleSchema({
  name: "qgold-keeper",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS qgold_keeper_days(
 day TEXT PRIMARY KEY,
 commitment TEXT NOT NULL,
 salt TEXT NOT NULL,
 commit_at INTEGER NOT NULL,
 commit_height INTEGER NOT NULL,
 seed TEXT,
 seed_height INTEGER,
 times TEXT CHECK(times IS NULL OR json_valid(times))
);
CREATE TABLE IF NOT EXISTS qgold_keeper_actions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 day TEXT NOT NULL,
 slot INTEGER NOT NULL,
 at INTEGER NOT NULL,
 kind TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('simulated','sent','failed','skipped','missed')),
 qgold TEXT,
 near TEXT,
 reason TEXT,
 tx_hashes TEXT CHECK(tx_hashes IS NULL OR json_valid(tx_hashes))
);
CREATE INDEX IF NOT EXISTS qgold_keeper_actions_day ON qgold_keeper_actions(day,slot);
CREATE TABLE IF NOT EXISTS qgold_snapshots(
 at INTEGER PRIMARY KEY,
 rate TEXT NOT NULL,
 supply TEXT NOT NULL,
 backing TEXT NOT NULL,
 burned TEXT,
 fees TEXT,
 pool_price TEXT,
 pool_near TEXT,
 pool_qgold TEXT
);
`,
});

const DAY_MS = 86_400_000;
const SNAPSHOT_MS = 10 * 60_000;
const MISSED_AFTER_MS = 30 * 60_000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const big = (v) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

/**
 * The keeper executes when its key file exists (QGOLD_KEEPER_KEY_PATH, or
 * <state dir>/qgold-keeper.json installed by scripts/install-qgold-keeper-vps.sh)
 * unless QGOLD_KEEPER_EXECUTE=0. Without a key it only records.
 */
export function keeperSettings(env = process.env, { defaultKeyPath = null, exists = () => false } = {}) {
  const minPool = env.QGOLD_KEEPER_MIN_POOL_NEAR;
  const keyPath = env.QGOLD_KEEPER_KEY_PATH || (defaultKeyPath && exists(defaultKeyPath) ? defaultKeyPath : null);
  return {
    enabled: env.QGOLD_KEEPER_ENABLED !== "0",
    execute: env.QGOLD_KEEPER_EXECUTE === "1" || (env.QGOLD_KEEPER_EXECUTE !== "0" && Boolean(keyPath)),
    keyPath,
    // Inverse buys spend at most this; unset = the keeper's own NEAR above a 1 NEAR reserve.
    inverseBudgetYocto: env.QGOLD_INVERSE_BUDGET_YOCTO ? big(env.QGOLD_INVERSE_BUDGET_YOCTO) : null,
    policy: {
      ...POLICY,
      minPoolNear:
        minPool && /^\d+$/.test(minPool) ? BigInt(minPool) * 10n ** 24n : POLICY.minPoolNear,
    },
  };
}

/** Normalised vault state from get_state (names agreed with the vault thread). */
export function vaultState(raw) {
  const s = raw || {};
  const supply = big(s.supply),
    backing = big(s.backing);
  return {
    supply,
    backing,
    rate: s.rate != null ? big(s.rate) : backingRate({ backing, supply }),
    rPeak: s.r_peak != null ? big(s.r_peak) : null,
    reserveNear: big(s.reserve_near),
    lsts: Array.isArray(s.lsts) ? s.lsts : [],
    insurance: big(s.insurance),
    burned: big(s.burned_total),
    fees: big(s.fees_total),
    exit: {
      instantUsed24h: big(s.exit?.instant_used_24h),
      instantCap24h: big(s.exit?.instant_cap_24h),
      queuePending: big(s.exit?.queue_pending),
      queueCount: Number(s.exit?.queue_count || 0),
      accountCap24h: (s.exit?.account_cap_24h ?? s.account_cap_24h) != null ? big(s.exit?.account_cap_24h ?? s.account_cap_24h) : null,
      safeWindowMs: Number(s.exit?.safe_window_ms ?? s.safe_window_ms ?? 0) || null,
    },
    paused: Boolean(s.paused),
    pauseUntil: s.pause_until ?? null,
  };
}

/** Pool reserves from a Rhea get_pool answer, oriented as NEAR / QGOLD. */
export function poolReserves(raw, { wnear, qgold }) {
  const ids = raw?.token_account_ids || [];
  const iN = ids.indexOf(wnear),
    iQ = ids.indexOf(qgold);
  if (iN < 0 || iQ < 0) return null;
  return {
    near: big(raw.amounts?.[iN]),
    qgold: big(raw.amounts?.[iQ]),
    feeBps: Number(raw.total_fee ?? POLICY.poolFeeBps),
  };
}

export class QgoldKeeper {
  /**
   * @param db        game database
   * @param vault     NativeContractReader for the QGOLD vault (token = vault)
   * @param rhea      NativeContractReader for the Rhea exchange, or null
   * @param poolId    Rhea pool id, or null while there is no pool
   * @param wnear     wNEAR contract id
   * @param provider  NEAR provider (for the block random seed)
   * @param account   keeper near-api-js Account, or null (records only)
   */
  constructor(db, { vault, rhea = null, poolId = null, wnear, provider, account = null, settings = keeperSettings(), clock = Date.now, leaseClock = Date.now, transportFactory = keeperTransport }) {
    ensureModuleVersion(db, QGOLD_KEEPER_SCHEMA);
    ensureKeeperJournal(db);
    Object.assign(this, { db, vault, rhea, poolId, wnear, provider, account, settings, clock, leaseClock, transportFactory });
    this.running = false;
    this.lastError = null;
  }

  get qgoldId() {
    return this.vault.contractId;
  }

  async readState() {
    const state = vaultState(await this.vault.view("get_state", {}, true));
    let pool = null;
    if (this.rhea && Number.isInteger(this.poolId)) {
      const raw = await this.rhea.view("get_pool", { pool_id: this.poolId }, true);
      pool = poolReserves(raw, { wnear: this.wnear, qgold: this.qgoldId });
    }
    return { state, pool };
  }

  snapshot({ state, pool }, now = this.clock()) {
    const last = this.db.prepare("SELECT MAX(at) at FROM qgold_snapshots").get()?.at || 0;
    if (now - last < SNAPSHOT_MS) return false;
    this.db
      .prepare(
        "INSERT OR REPLACE INTO qgold_snapshots(at,rate,supply,backing,burned,fees,pool_price,pool_near,pool_qgold) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        now,
        state.rate.toString(),
        state.supply.toString(),
        state.backing.toString(),
        state.burned.toString(),
        state.fees.toString(),
        pool ? poolPrice(pool).toString() : null,
        pool ? pool.near.toString() : null,
        pool ? pool.qgold.toString() : null,
      );
    return true;
  }

  /** Commit to today and tomorrow, fix seeds once a later block exists. */
  async ensureSchedule(now = this.clock(), guard = () => {}) {
    const block = await this.provider.viewBlock({ finality: "final" });
    guard();
    const height = Number(block?.header?.height),
      random = block?.header?.random_value;
    for (const day of [dayOf(now), dayOf(now + DAY_MS)]) {
      const row = this.db.prepare("SELECT * FROM qgold_keeper_days WHERE day=?").get(day);
      if (!row) {
        const salt = randomBytes(32).toString("hex");
        this.db
          .prepare(
            "INSERT INTO qgold_keeper_days(day,commitment,salt,commit_at,commit_height) VALUES(?,?,?,?,?)",
          )
          .run(day, scheduleCommitment(day, salt), salt, now, height);
        continue;
      }
      // The seed comes from the first final block seen after the commitment.
      if (!row.seed && height > row.commit_height && random) {
        const times = saleTimes(day, row.salt, random);
        this.db
          .prepare("UPDATE qgold_keeper_days SET seed=?,seed_height=?,times=? WHERE day=?")
          .run(random, height, JSON.stringify(times), day);
      }
    }
  }

  /** The slot due now, if any; older unhandled slots are marked missed. */
  dueSlot(now = this.clock()) {
    const day = dayOf(now);
    const row = this.db.prepare("SELECT * FROM qgold_keeper_days WHERE day=?").get(day);
    if (!row?.times) return null;
    const times = JSON.parse(row.times);
    const done = new Set(
      this.db.prepare("SELECT slot FROM qgold_keeper_actions WHERE day=? UNION SELECT slot FROM qgold_keeper_slots WHERE day=?").all(day, day).map((r) => r.slot),
    );
    let due = null;
    times.forEach((t, slot) => {
      if (done.has(slot) || t > now) return;
      // A slot whose time fell before the commitment was fixed cannot count.
      if (t < row.commit_at || now - t > MISSED_AFTER_MS) {
        this.record({ day, slot, at: now, kind: "slot", state: "missed", reason: t < row.commit_at ? "before-commitment" : "keeper-offline" });
      } else {
        // Only the latest due slot acts; an older one it overtakes counts as missed.
        if (due) this.record({ ...due, at: now, kind: "slot", state: "missed", reason: "superseded" });
        due = { day, slot, at: t };
      }
    });
    return due;
  }

  record({ day, slot, at, kind, state, qgold = null, near = null, reason = null, txHashes = null }) {
    const row = this.db
      .prepare(
        "INSERT INTO qgold_keeper_actions(day,slot,at,kind,state,qgold,near,reason,tx_hashes) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(day, slot, at, kind, state, qgold, near, reason, txHashes ? JSON.stringify(txHashes) : null);
    return Number(row.lastInsertRowid);
  }

  sums(day) {
    return keeperSums(this.db, day);
  }

  avgPrice(now = this.clock()) {
    const rows = this.db
      .prepare("SELECT at,pool_price price FROM qgold_snapshots WHERE at>=? AND pool_price IS NOT NULL")
      .all(now - DAY_MS);
    return average24h(rows, now);
  }

  async tick(now = this.clock()) {
    if (this.running || !this.settings.enabled) return null;
    this.running = true;
    try {
      return await withKeeperLease(this.db, this.leaseClock, async (guard) => {
        const executing = this.settings.execute && this.account;
        // Resume before new market reads, schedule expiry or the next UTC day.
        // Trading disabled means pause recovery too; it never erases a claim.
        if (pendingKeeperOperation(this.db)) {
          if (!executing) return { active: false, reason: "keeper-recovery-paused", actions: [] };
          const transport = await this.transportFactory(this); guard();
          await resumeKeeperOperations(this, transport, guard, now);
          return { active: true, recovering: true, actions: [] };
        }
        if (executing && keeperLegacyBlocked(this.db)) throw Error("Legacy failed keeper actions require reconciliation before trading");
        const read = await this.readState(); guard();
        this.snapshot(read, now);
        await this.ensureSchedule(now, guard); guard();
        const due = this.dueSlot(now);
        if (!due) return null;
        const { state, pool } = read, sums = this.sums(due.day);
        const budget = await this.inverseBudget(); guard();
        const plan = keeperPlan({ pool, rate: state.rate, supply: state.supply, avgPrice24h: this.avgPrice(now),
          soldToday: sums.soldToday, inverseSpentToday: sums.inverseToday, inverseBudget: budget,
          buyback: buybackBudget({ feesTotal: state.fees, spent: sums.buybackSpent }), saleDue: true, policy: this.settings.policy });
        const transport = executing && plan.active && plan.actions.some((a) => a.kind !== "sale-skipped")
          ? await this.transportFactory(this) : null;
        guard();
        if (!reserveKeeperPlan(this, due, plan, read, transport?.identity, guard, now)) return null;
        if (transport) await resumeKeeperOperations(this, transport, guard, now);
        return plan;
      });
    } catch (error) {
      this.lastError = { at: now, message: String(error?.message || error).slice(0, 300) };
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Configured budget, else the keeper account's NEAR above a 1 NEAR reserve, else 0. */
  async inverseBudget() {
    if (this.settings.inverseBudgetYocto != null) return this.settings.inverseBudgetYocto;
    if (!this.account || !this.settings.execute) return 0n;
    try {
      const a = await this.provider.viewAccount({ accountId: this.account.accountId });
      const free = big(a.amount) - 10n ** 24n;
      return free > 0n ? free : 0n;
    } catch {
      return 0n;
    }
  }

  /** Public view of the keeper: commitments, revealed past days, recent actions. */
  publicView(now = this.clock(), { rate, supply } = {}) {
    const today = dayOf(now);
    const days = this.db.prepare("SELECT * FROM qgold_keeper_days ORDER BY day DESC LIMIT 8").all();
    const actions = this.db
      .prepare("SELECT day,slot,at,kind,state,qgold,near,reason,tx_hashes FROM qgold_keeper_actions ORDER BY id DESC LIMIT 60")
      .all();
    const sums = keeperSums(this.db, today, { reserve: false });
    const reserved = this.sums(today);
    const pending = this.db.prepare("SELECT day,slot,kind,last_error FROM qgold_keeper_ops WHERE state='pending' ORDER BY created_at,position LIMIT 60").all();
    return {
      execute: Boolean(this.settings.execute && this.account),
      minPoolNear: this.settings.policy.minPoolNear.toString(),
      lastError: this.lastError,
      pending: pending.map((op) => ({ day: op.day, slot: op.slot, kind: op.kind, state: "pending" })),
      budgetCommitted: { saleQgold: reserved.soldToday.toString(), inverseNear: reserved.inverseToday.toString(), buybackNear: reserved.buybackSpent.toString() },
      soldToday: sums.soldToday.toString(),
      buybackSpent: sums.buybackSpent.toString(),
      ladder: rate != null ? askLadder({ rate, supply, soldToday: reserved.soldToday, policy: this.settings.policy }) : [],
      schedule: days.map((d) => {
        const ended = d.day < today;
        const times = d.times ? JSON.parse(d.times) : null;
        return {
          day: d.day,
          commitment: d.commitment,
          committedAt: new Date(d.commit_at).toISOString(),
          commitHeight: d.commit_height,
          seedHeight: d.seed_height ?? null,
          // Until the day is over only the number of sales done is public.
          salt: ended ? d.salt : null,
          seed: ended ? d.seed : null,
          times: ended && times ? times.map((t) => new Date(t).toISOString()) : null,
          done: times ? times.filter((t) => t <= now).length : 0,
        };
      }),
      actions: actions.map((a) => ({
        day: a.day,
        slot: a.slot,
        at: new Date(a.at).toISOString(),
        kind: a.kind,
        state: a.state,
        qgold: a.qgold,
        near: a.near,
        reason: a.reason,
        txHashes: a.tx_hashes ? JSON.parse(a.tx_hashes) : [],
      })),
    };
  }

  chart(now = this.clock(), days = 30) {
    const rows = this.db
      .prepare("SELECT at,rate,pool_price,supply,burned FROM qgold_snapshots WHERE at>=? ORDER BY at")
      .all(now - days * DAY_MS);
    // At most ~240 points: keep the last snapshot of each bucket.
    const step = Math.max(1, Math.ceil(rows.length / 240));
    return rows
      .filter((_, i) => i % step === step - 1 || i === rows.length - 1)
      .map((r) => ({ at: new Date(r.at).toISOString(), rate: r.rate, price: r.pool_price, supply: r.supply, burned: r.burned }));
  }
}

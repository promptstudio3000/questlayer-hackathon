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
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";
import {
  POLICY,
  QGOLD_ONE,
  askLadder,
  average24h,
  backingRate,
  buybackBudget,
  depositQuote,
  keeperPlan,
  poolPrice,
  saleTimes,
  scheduleCommitment,
  swapNearIn,
  swapQgoldIn,
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
const TGAS = 10n ** 12n;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const big = (v) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};
const hashOf = (r) => r?.transaction?.hash || r?.transaction_outcome?.id || null;
const failed = (r) =>
  Boolean(r?.status?.Failure) || (r?.receipts_outcome || []).some((o) => o.outcome?.status?.Failure);

export function keeperSettings(env = process.env) {
  const minPool = env.QGOLD_KEEPER_MIN_POOL_NEAR;
  return {
    enabled: env.QGOLD_KEEPER_ENABLED !== "0",
    execute: env.QGOLD_KEEPER_EXECUTE === "1",
    keyPath: env.QGOLD_KEEPER_KEY_PATH || null,
    inverseBudgetYocto: big(env.QGOLD_INVERSE_BUDGET_YOCTO || "0"),
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
  constructor(db, { vault, rhea = null, poolId = null, wnear, provider, account = null, settings = keeperSettings(), clock = Date.now }) {
    ensureModuleVersion(db, QGOLD_KEEPER_SCHEMA);
    Object.assign(this, { db, vault, rhea, poolId, wnear, provider, account, settings, clock });
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
  async ensureSchedule(now = this.clock()) {
    const block = await this.provider.viewBlock({ finality: "final" });
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
      this.db.prepare("SELECT slot FROM qgold_keeper_actions WHERE day=?").all(day).map((r) => r.slot),
    );
    let due = null;
    times.forEach((t, slot) => {
      if (done.has(slot) || t > now) return;
      // A slot whose time fell before the commitment was fixed cannot count.
      if (t < row.commit_at || now - t > MISSED_AFTER_MS) {
        this.record({ day, slot, at: now, kind: "slot", state: "missed", reason: t < row.commit_at ? "before-commitment" : "keeper-offline" });
      } else due = { day, slot, at: t };
    });
    return due;
  }

  record({ day, slot, at, kind, state, qgold = null, near = null, reason = null, txHashes = null }) {
    this.db
      .prepare(
        "INSERT INTO qgold_keeper_actions(day,slot,at,kind,state,qgold,near,reason,tx_hashes) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(day, slot, at, kind, state, qgold, near, reason, txHashes ? JSON.stringify(txHashes) : null);
  }

  sums(day) {
    const rows = this.db
      .prepare("SELECT kind,qgold,near,state,day FROM qgold_keeper_actions WHERE state IN ('sent','simulated')")
      .all();
    let soldToday = 0n,
      inverseToday = 0n,
      buybackSpent = 0n;
    for (const r of rows) {
      if (r.kind === "sale" && r.day === day) soldToday += big(r.qgold);
      if (r.kind === "inverse-buy-burn" && r.day === day) inverseToday += big(r.near);
      if (r.kind === "buyback-burn") buybackSpent += big(r.near);
    }
    return { soldToday, inverseToday, buybackSpent };
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
      const read = await this.readState();
      this.snapshot(read, now);
      await this.ensureSchedule(now);
      const due = this.dueSlot(now);
      if (!due) return null;
      const { state, pool } = read;
      const sums = this.sums(due.day);
      const plan = keeperPlan({
        pool,
        rate: state.rate,
        supply: state.supply,
        avgPrice24h: this.avgPrice(now),
        soldToday: sums.soldToday,
        inverseSpentToday: sums.inverseToday,
        inverseBudget: this.settings.inverseBudgetYocto,
        buyback: buybackBudget({ feesTotal: state.fees, spent: sums.buybackSpent }),
        saleDue: true,
        policy: this.settings.policy,
      });
      if (!plan.active) {
        this.record({ ...due, kind: "slot", state: "skipped", reason: plan.reason });
        return plan;
      }
      if (!plan.actions.length) this.record({ ...due, kind: "slot", state: "skipped", reason: "nothing-to-do" });
      for (const a of plan.actions) {
        if (a.kind === "sale-skipped") {
          this.record({ ...due, kind: "sale", state: "skipped", reason: a.reason });
          continue;
        }
        if (!this.settings.execute || !this.account) {
          this.record({ ...due, kind: a.kind, state: "simulated", qgold: a.qgold ?? null, near: a.near ?? null, reason: a.reason });
          continue;
        }
        try {
          const out = await this.execute(a, { state, pool });
          this.record({ ...due, kind: a.kind, state: "sent", qgold: out.qgold, near: out.near, reason: a.reason, txHashes: out.txHashes });
        } catch (error) {
          this.record({ ...due, kind: a.kind, state: "failed", qgold: a.qgold ?? null, near: a.near ?? null, reason: String(error?.message || error).slice(0, 300) });
        }
      }
      return plan;
    } catch (error) {
      this.lastError = { at: now, message: String(error?.message || error).slice(0, 300) };
      return null;
    } finally {
      this.running = false;
    }
  }

  async call(contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) {
    const r = await this.account.callFunctionRaw({ contractId, methodName, args, gas, deposit, waitUntil: "FINAL" });
    if (failed(r)) throw Error(`${contractId}.${methodName} failed (${hashOf(r)})`);
    return hashOf(r);
  }

  async qgoldBalance() {
    return big(await this.vault.view("ft_balance_of", { account_id: this.account.accountId }, true));
  }

  /** Executes one planned action. Every step is a separate final transaction. */
  async execute(action, { state, pool }) {
    const rhea = this.rhea.contractId,
      txHashes = [];
    const swapMsg = (tokenIn, tokenOut, amountIn, minOut) =>
      JSON.stringify({
        force: 0,
        actions: [{ pool_id: this.poolId, token_in: tokenIn, token_out: tokenOut, amount_in: amountIn.toString(), min_amount_out: minOut.toString() }],
      });
    if (action.kind === "sale") {
      const qgold = big(action.qgold);
      // Buy the QGOLD from the vault at R + 1 % (backed 1:R), then sell it into the pool.
      const near = (qgold * state.rate * 10100n) / (QGOLD_ONE * 10000n) + 1n;
      const minted = big(depositQuote(near, state.rate).qgold);
      txHashes.push(await this.call(this.qgoldId, "deposit", { min_out: ((minted * 99n) / 100n).toString() }, near));
      const amount = await this.qgoldBalance();
      const sell = amount < qgold ? amount : qgold;
      const minOut = (swapQgoldIn(pool, sell, pool.feeBps) * 98n) / 100n;
      txHashes.push(
        await this.call(this.qgoldId, "ft_transfer_call", { receiver_id: rhea, amount: sell.toString(), msg: swapMsg(this.qgoldId, this.wnear, sell, minOut) }, 1n, 150n * TGAS),
      );
      return { qgold: sell.toString(), near: near.toString(), txHashes };
    }
    // Buys (inverse and buyback): wrap NEAR, swap into QGOLD, burn what arrived.
    const near = big(action.near);
    const before = await this.qgoldBalance();
    txHashes.push(await this.call(this.wnear, "near_deposit", {}, near, 30n * TGAS));
    const minOut = (swapNearIn(pool, near, pool.feeBps) * 98n) / 100n;
    txHashes.push(
      await this.call(this.wnear, "ft_transfer_call", { receiver_id: rhea, amount: near.toString(), msg: swapMsg(this.wnear, this.qgoldId, near, minOut) }, 1n, 150n * TGAS),
    );
    const got = (await this.qgoldBalance()) - before;
    if (got > 0n)
      txHashes.push(await this.call(this.qgoldId, "ft_burn", { amount: got.toString(), memo: `qgold-keeper:${action.kind}` }, 1n, 30n * TGAS));
    return { qgold: got.toString(), near: near.toString(), txHashes };
  }

  /** Public view of the keeper: commitments, revealed past days, recent actions. */
  publicView(now = this.clock(), { rate, supply } = {}) {
    const today = dayOf(now);
    const days = this.db.prepare("SELECT * FROM qgold_keeper_days ORDER BY day DESC LIMIT 8").all();
    const actions = this.db
      .prepare("SELECT day,slot,at,kind,state,qgold,near,reason,tx_hashes FROM qgold_keeper_actions ORDER BY id DESC LIMIT 60")
      .all();
    const sums = this.sums(today);
    return {
      execute: Boolean(this.settings.execute && this.account),
      minPoolNear: this.settings.policy.minPoolNear.toString(),
      lastError: this.lastError,
      soldToday: sums.soldToday.toString(),
      buybackSpent: sums.buybackSpent.toString(),
      ladder: rate != null ? askLadder({ rate, supply, soldToday: sums.soldToday, policy: this.settings.policy }) : [],
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

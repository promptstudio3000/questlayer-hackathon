// MetaLayer economy on NEAR (contracts/metalayer, docs/METALAYER-INTEGRATION.md).
//
// A story step saved in ml_actions (activity.mjs) that earns something queues
// one payout row. The worker sends queued rows to the contract's `award` with
// the bounded recorder key (<state dir>/metalayer-recorder.json): the contract
// pays MetaGold from its own treasury, adds soulbound MetaXP and badges, and
// pays each action id once. A player without a linked NEAR account keeps the
// row queued until one is linked. Nothing here touches city XP or QGOLD.
import { existsSync } from "node:fs";
import { atomic } from "../database.mjs";
import { ensureModuleVersion, registerModuleSchema } from "../schema-compatibility.mjs";

export const PAYOUT_SCHEMA = registerModuleSchema({ name: "metalayer-payouts", version: 1, sql: `
CREATE TABLE IF NOT EXISTS ml_payouts(
 action_id TEXT PRIMARY KEY REFERENCES ml_actions(id),layer TEXT NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),
 actor TEXT NOT NULL,kind TEXT NOT NULL,evidence_hash TEXT NOT NULL,metagold INTEGER NOT NULL,meta_xp INTEGER NOT NULL,badge TEXT,
 account_id TEXT,status TEXT NOT NULL DEFAULT 'queued',tx TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ml_payouts_due ON ml_payouts(status,next_at);
CREATE INDEX IF NOT EXISTS ml_payouts_player ON ml_payouts(layer,player_id);
` });
// Parcel owners read from the contract (building rights). Its own module, so the
// payout module keeps the shape already recorded in live databases.
export const PARCEL_SCHEMA = registerModuleSchema({ name: "metalayer-parcels", version: 1, sql: `
CREATE TABLE IF NOT EXISTS ml_parcels(
 x0 INTEGER NOT NULL,z0 INTEGER NOT NULL,owner TEXT NOT NULL,checked_at INTEGER NOT NULL,PRIMARY KEY(x0,z0)
);
` });

/**
 * What each story step earns (testnet placeholders for owner review). MetaGold
 * uses the QGOLD scale (1 NEAR = 1,000,000,000 units). The Quiet Beacon
 * pays 95 MetaGold and Nera's tour 5 more: 100, the price of one parcel. Ordinary mining, building and walking earn nothing.
 */
export const METALAYER_REWARDS = Object.freeze({
  "expedition-complete": { metagold: 20, metaXp: 50, badge: "crystal-hollow" },
  "quarry-found": { metagold: 0, metaXp: 20, badge: null },
  "signal-tuned": { metagold: 5, metaXp: 15, badge: null },
  "marker-checked": { metagold: 0, metaXp: 20, badge: null },
  "beacon-restored": { metagold: 60, metaXp: 100, badge: "quiet-beacon" },
  "place-found": { metagold: 0, metaXp: 5, badge: null },
  "tour-complete": { metagold: 5, metaXp: 10, badge: null },
});
const RETRY_MS = { queued: 60_000, "over-daily-cap": 60 * 60_000, "treasury-empty": 60 * 60_000, failed: 5 * 60_000 };
const BATCH = 20;

const failureText = (r) => {
  const failures = [r?.status, ...(r?.receipts_outcome || []).map((x) => x.outcome?.status)].filter(
    (s) => s && typeof s === "object" && "Failure" in s,
  );
  return failures.length ? JSON.stringify(failures[0].Failure).slice(0, 300) : null;
};

/** Contract reads and the recorder's award call. */
export function createMetaLayerChain({ provider, contractId, keyPath, loadAccount, log = console }) {
  const state = { contractId: contractId || null, ready: false, error: null, account: null };
  async function connect() {
    if (!contractId) return ((state.error = "no contract"), state);
    if (!keyPath || !existsSync(keyPath)) return ((state.error = "no recorder key"), state);
    try {
      const service = await loadAccount(provider, keyPath, { expectAccountId: contractId, requireFullAccess: false });
      state.account = service.account;
      state.ready = true;
      state.error = null;
    } catch (e) {
      state.error = String(e?.message || e).slice(0, 200);
      log.warn?.(JSON.stringify({ metalayer: "recorder unavailable", error: state.error }));
    }
    return state;
  }
  async function view(method, args = {}) {
    const r = await provider.query({
      request_type: "call_function", account_id: contractId, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic",
    });
    return JSON.parse(Buffer.from(r.result).toString());
  }
  async function award(awards) {
    if (!state.ready) await connect();
    if (!state.ready) throw new Error(state.error || "recorder unavailable");
    const r = await state.account.callFunctionRaw({
      contractId, methodName: "award", args: { awards }, deposit: 0n, gas: 300n * 10n ** 12n, waitUntil: "FINAL",
    });
    const failure = failureText(r);
    if (failure) throw new Error(failure);
    const value = r.status?.SuccessValue;
    const statuses = value ? JSON.parse(Buffer.from(value, "base64").toString()) : [];
    return { tx: r.transaction?.hash || r.transaction_outcome?.id, statuses };
  }
  return { state, connect, view, award, get active() { return !!contractId; } };
}

export function createMetaLayerEconomy(db, { chain = null, linkedAccount = () => null, now = Date.now, log = console } = {}) {
  ensureModuleVersion(db, PAYOUT_SCHEMA);
  ensureModuleVersion(db, PARCEL_SCHEMA);
  /** Called by activity.record for every newly saved action. */
  function onRecord({ id, layer, playerId, actor, kind, evidenceHash }) {
    const reward = METALAYER_REWARDS[kind];
    if (!reward || !chain?.active) return;
    const at = now();
    db.prepare(`INSERT OR IGNORE INTO ml_payouts(action_id,layer,player_id,actor,kind,evidence_hash,metagold,meta_xp,badge,status,next_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?)`)
      .run(id, layer, playerId, actor, kind, evidenceHash, reward.metagold, reward.metaXp, reward.badge, at, at, at);
  }
  let busy = false;
  /** Sends due rows to the contract. Returns how many rows changed. */
  async function tick() {
    if (busy || !chain?.active) return 0;
    busy = true;
    try {
      const due = db.prepare("SELECT * FROM ml_payouts WHERE status NOT IN ('paid','duplicate') AND next_at<=? ORDER BY created_at LIMIT ?").all(now(), BATCH * 3);
      const ready = [];
      for (const row of due) {
        const account = row.account_id || linkedAccount(row.player_id);
        if (!account) {
          db.prepare("UPDATE ml_payouts SET status='no-account',next_at=?,updated_at=? WHERE action_id=?").run(now() + 10 * 60_000, now(), row.action_id);
          continue;
        }
        if (!row.account_id) db.prepare("UPDATE ml_payouts SET account_id=? WHERE action_id=?").run(account, row.action_id);
        ready.push({ ...row, account_id: account });
        if (ready.length === BATCH) break;
      }
      if (!ready.length) return 0;
      let result;
      try {
        result = await chain.award(ready.map((r) => ({
          action_id: r.action_id, account_id: r.account_id, actor: r.actor, layer_id: r.layer,
          evidence_hash: r.evidence_hash, metagold: String(r.metagold), meta_xp: r.meta_xp, badge: r.badge,
        })));
      } catch (e) {
        log.warn?.(JSON.stringify({ metalayer: "award failed", error: String(e?.message || e).slice(0, 200) }));
        const at = now();
        for (const r of ready)
          db.prepare("UPDATE ml_payouts SET status='failed',attempts=attempts+1,next_at=?,updated_at=? WHERE action_id=?").run(at + RETRY_MS.failed, at, r.action_id);
        return 0;
      }
      atomic(db, () => {
        const at = now();
        ready.forEach((r, i) => {
          const status = result.statuses[i] || "failed";
          const done = status === "paid" || status === "duplicate";
          db.prepare("UPDATE ml_payouts SET status=?,tx=COALESCE(?,tx),attempts=attempts+1,next_at=?,updated_at=? WHERE action_id=?")
            .run(status, done ? result.tx : null, done ? at : at + (RETRY_MS[status] || RETRY_MS.failed), at, r.action_id);
          if (done) db.prepare("UPDATE ml_actions SET tx=COALESCE(tx,?) WHERE id=?").run(result.tx, r.action_id);
        });
      });
      return ready.length;
    } finally {
      busy = false;
    }
  }
  const cache = new Map();
  /** The explorer's MetaGold, MetaXP, badges, parcels and what still waits. */
  async function summary(actor, layerId) {
    const pending = db.prepare("SELECT kind,metagold,meta_xp,status FROM ml_payouts WHERE layer=? AND player_id=? AND status NOT IN ('paid','duplicate') ORDER BY created_at")
      .all(layerId, actor.id);
    const account = linkedAccount(actor.id);
    const base = { active: !!chain?.active, contract: chain?.state.contractId ?? null, account, pending: pending.map((p) => ({ kind: p.kind, metagold: p.metagold, metaXp: p.meta_xp, waiting: p.status })) };
    if (!chain?.active) return { ...base, metagold: "0", metaXp: 0, badges: [], parcels: [], treasury: null };
    const key = `${actor.id}:${account}`, hit = cache.get(key);
    if (hit && hit.at > now() - 15_000 && hit.pendingCount === pending.length) return { ...base, ...hit.value };
    try {
      const [treasury, metagold, metaXp, badges, parcels] = await Promise.all([
        chain.view("treasury"),
        account ? chain.view("ft_balance_of", { account_id: account }) : "0",
        account ? chain.view("meta_xp_of", { account_id: account }) : "0",
        account ? chain.view("badges_of", { account_id: account }) : [],
        account ? chain.view("nft_tokens_for_owner", { account_id: account, from_index: null, limit: 20 }) : [],
      ]);
      const value = {
        metagold: String(metagold), metaXp: Number(metaXp), badges,
        parcels: parcels.map((t) => t.token_id),
        treasury: { available: treasury.metagold_available, paidToday: treasury.paid_today, dailyCap: treasury.daily_cap, parcelPrice: treasury.parcel_price },
      };
      if (account) rememberParcels(account, parcels);
      cache.set(key, { at: now(), pendingCount: pending.length, value });
      if (cache.size > 2000) cache.clear();
      return { ...base, ...value };
    } catch (e) {
      return { ...base, metagold: null, metaXp: null, badges: [], parcels: [], treasury: null, error: "NEAR is not answering right now." };
    }
  }
  const PARCEL_ID = /^parcel:(-?\d+):(-?\d+)$/;
  function rememberParcels(account, tokens) {
    atomic(db, () => {
      const at = now(), mine = new Set();
      for (const t of tokens) {
        const m = PARCEL_ID.exec(t.token_id || t);
        if (!m) continue;
        mine.add(`${m[1]}:${m[2]}`);
        db.prepare("INSERT INTO ml_parcels VALUES(?,?,?,?) ON CONFLICT(x0,z0) DO UPDATE SET owner=excluded.owner,checked_at=excluded.checked_at").run(Number(m[1]), Number(m[2]), account, at);
      }
      for (const row of db.prepare("SELECT x0,z0 FROM ml_parcels WHERE owner=?").all(account))
        if (!mine.has(`${row.x0}:${row.z0}`)) db.prepare("DELETE FROM ml_parcels WHERE x0=? AND z0=?").run(row.x0, row.z0);
    });
  }
  /** Building rights on a parcel: the cached owner from the last chain read. */
  function ownsLand(actor, x0, z0) {
    const account = linkedAccount(actor.id);
    return !!account && db.prepare("SELECT 1 FROM ml_parcels WHERE x0=? AND z0=? AND owner=?").get(x0, z0, account) !== undefined;
  }
  /** Reads one parcel's owner from the contract after a purchase or transfer. */
  async function syncParcel(actor, x0, z0) {
    if (!chain?.active) return { owned: false, owner: null };
    if (!Number.isSafeInteger(x0) || !Number.isSafeInteger(z0) || x0 % 16 || z0 % 16) return { owned: false, owner: null };
    const token = await chain.view("parcel", { x0, z0 });
    const owner = token?.owner_id ?? null;
    if (owner) db.prepare("INSERT INTO ml_parcels VALUES(?,?,?,?) ON CONFLICT(x0,z0) DO UPDATE SET owner=excluded.owner,checked_at=excluded.checked_at").run(x0, z0, owner, now());
    else db.prepare("DELETE FROM ml_parcels WHERE x0=? AND z0=?").run(x0, z0);
    cache.clear();
    return { owned: !!owner && owner === linkedAccount(actor.id), owner: owner ? (owner === linkedAccount(actor.id) ? "you" : "someone") : null };
  }
  return { onRecord, tick, summary, ownsLand, syncParcel };
}

// Durable index of NEP-413 signed Aura orders (market version 2).
//
// Open orders exist only off chain until someone fills them, so the index
// itself is the durable copy: it lives in the game database, survives
// restarts and travels with database backups. The market contract stays the
// authority. Every order is verified with `check_order` before it is stored
// and again before it is shown, and terminal states come from the contract's
// own events (order_match, order_cancel, orders_cancel_all) read from final
// transaction receipts. After a restore, `reconcile` re-verifies every open
// order, so a restored snapshot can never show a filled or cancelled order as
// available.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import { assert } from "../domain.mjs";
import { verifySignedOrderLocally } from "./signed-orders.mjs";

export const SIGNED_ORDER_INDEX_SCHEMA = registerModuleSchema({
  name: "signed-market-orders",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS signed_market_orders(
 id TEXT PRIMARY KEY,
 market TEXT NOT NULL,
 maker TEXT NOT NULL,
 nonce TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('sell','buy')),
 token_id TEXT NOT NULL,
 price TEXT NOT NULL CHECK(price GLOB '[0-9]*'),
 deadline_ms INTEGER NOT NULL,
 epoch INTEGER NOT NULL,
 signed_order TEXT NOT NULL CHECK(json_valid(signed_order)),
 state TEXT NOT NULL CHECK(state IN ('open','filled','cancelled','expired','rejected')),
 reason TEXT,
 fillable INTEGER NOT NULL DEFAULT 0 CHECK(fillable IN (0,1)),
 settlement_tx TEXT,
 received_at INTEGER NOT NULL,
 checked_at INTEGER NOT NULL,
 closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS signed_market_orders_open ON signed_market_orders(market,state,token_id);
CREATE INDEX IF NOT EXISTS signed_market_orders_maker ON signed_market_orders(maker,received_at DESC);
CREATE INDEX IF NOT EXISTS signed_market_orders_checked ON signed_market_orders(state,checked_at);
CREATE TABLE IF NOT EXISTS signed_market_order_events(
 tx_hash TEXT NOT NULL,
 seq INTEGER NOT NULL,
 market TEXT NOT NULL,
 event TEXT NOT NULL,
 data TEXT NOT NULL CHECK(json_valid(data)),
 recorded_at INTEGER NOT NULL,
 PRIMARY KEY(tx_hash,seq)
);
CREATE TABLE IF NOT EXISTS signed_market_order_cursor(
 market TEXT PRIMARY KEY,
 relay_seq INTEGER NOT NULL DEFAULT 0
);
`,
});

const MAX_OPEN = 512,
  MAX_OPEN_PER_MAKER = 24,
  HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const orderId = (maker, nonce) => `${maker}:${nonce}`;

/** Maps a check_order result to an index state. */
export function stateFromCheck(check, nowMs, deadlineMs) {
  if (check.valid) return Number(deadlineMs) <= nowMs ? "expired" : "open";
  const reason = check.reason || "";
  // A used nonce is a fill unless a recorded cancel event says otherwise.
  if (/nonce already used/i.test(reason)) return "filled";
  if (/cancelled by the maker|not registered by the maker/i.test(reason))
    return "cancelled";
  if (/expired/i.test(reason)) return "expired";
  return "rejected";
}

export class SignedOrderIndex {
  constructor(db, market, { now = () => Date.now(), relaySenderId = null } = {}) {
    ensureModuleVersion(db, SIGNED_ORDER_INDEX_SCHEMA);
    this.db = db;
    this.market = market;
    this.marketId = market.contractId;
    this.now = now;
    // Relayed transactions are signed by the relayer account, which RPC needs
    // to locate them.
    this.relaySenderId = relaySenderId;
  }
  row(id) {
    return this.db.prepare("SELECT * FROM signed_market_orders WHERE id=?").get(id);
  }
  view(r) {
    return {
      id: r.id,
      terms: JSON.parse(JSON.parse(r.signed_order).message),
      order: JSON.parse(r.signed_order),
      state: r.state,
      reason: r.reason,
      fillable: !!r.fillable,
      settlementTx: r.settlement_tx,
      receivedAt: r.received_at,
      checkedAt: r.checked_at,
    };
  }
  async submit(order) {
    const now = this.now();
    const stats = await this.market.view("get_stats", {});
    assert(stats.version === 2, "Signed orders need the version 2 market.", 503);
    const terms = verifySignedOrderLocally(order, {
      market: this.marketId,
      nftContract: this.market.nfts.contractId,
      nowMs: now,
    });
    const id = orderId(terms.maker, order.nonce);
    const existing = this.row(id);
    if (existing) return { ...this.view(existing), duplicate: true };
    const counts = this.db
      .prepare(
        "SELECT COUNT(*) total, SUM(maker=?) mine FROM signed_market_orders WHERE market=? AND state='open'",
      )
      .get(terms.maker, this.marketId);
    assert(counts.total < MAX_OPEN, "The order book is full. Try again later.", 503);
    assert(
      (counts.mine || 0) < MAX_OPEN_PER_MAKER,
      "You have too many open orders. Cancel one first.",
      409,
    );
    const check = await this.market.view("check_order", { order }, true);
    assert(check.valid, check.reason || "The market rejected this order.", 409);
    this.db
      .prepare(
        `INSERT INTO signed_market_orders(id,market,maker,nonce,kind,token_id,price,deadline_ms,epoch,signed_order,state,fillable,received_at,checked_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,'open',?,?,?)`,
      )
      .run(
        id,
        this.marketId,
        terms.maker,
        order.nonce,
        terms.kind,
        terms.token_id,
        terms.price,
        Number(terms.deadline_ms),
        terms.epoch,
        JSON.stringify(order),
        check.fillable ? 1 : 0,
        now,
        now,
      );
    return this.view(this.row(id));
  }
  close(id, state, { reason = null, tx = null } = {}) {
    const now = this.now();
    this.db
      .prepare(
        `UPDATE signed_market_orders SET state=?,reason=COALESCE(?,reason),settlement_tx=COALESCE(?,settlement_tx),fillable=0,checked_at=?,closed_at=COALESCE(closed_at,?)
         WHERE id=? AND (state='open' OR (state='filled' AND ?='cancelled' AND settlement_tx IS NULL))`,
      )
      .run(state, reason, tx, now, now, id, state);
  }
  /** Re-verify open orders against current contract state. */
  async reconcile(limit = 32, { all = false } = {}) {
    const now = this.now();
    const rows = this.db
      .prepare(
        `SELECT * FROM signed_market_orders WHERE market=? AND state='open' ${all ? "" : "AND checked_at<?"} ORDER BY checked_at LIMIT ?`,
      )
      .all(...(all ? [this.marketId, limit] : [this.marketId, now - 15000, limit]));
    let changed = 0;
    for (const r of rows) {
      const check = await this.market.view(
        "check_order",
        { order: JSON.parse(r.signed_order) },
        true,
      );
      const state = stateFromCheck(check, now, r.deadline_ms);
      if (state === "open")
        this.db
          .prepare("UPDATE signed_market_orders SET fillable=?,checked_at=? WHERE id=?")
          .run(check.fillable ? 1 : 0, now, r.id);
      else {
        this.close(r.id, state, { reason: check.reason });
        changed++;
      }
    }
    return { checked: rows.length, changed };
  }
  async list({ tokenId = null } = {}) {
    await this.reconcile(48);
    const rows = this.db
      .prepare(
        `SELECT * FROM signed_market_orders WHERE market=? AND state='open' AND deadline_ms>? ${tokenId ? "AND token_id=?" : ""} ORDER BY received_at DESC LIMIT 48`,
      )
      .all(...[this.marketId, this.now(), ...(tokenId ? [tokenId] : [])]);
    return rows.map((r) => this.view(r));
  }
  /** States for a maker's own orders; unknown ones are checked on chain. */
  async statuses(orders) {
    assert(Array.isArray(orders) && orders.length <= 12, "Check at most 12 orders.");
    return Promise.all(
      orders.map(async (order) => {
        let terms;
        try {
          terms = JSON.parse(order?.message);
        } catch {
          return { state: "rejected", reason: "Malformed order." };
        }
        const r = this.row(orderId(terms?.maker, order?.nonce));
        if (r && r.state !== "open")
          return { state: r.state, reason: r.reason, settlementTx: r.settlement_tx };
        const check = await this.market.view("check_order", { order }, true);
        return {
          state: stateFromCheck(check, this.now(), terms?.deadline_ms),
          reason: check.reason,
          fillable: !!check.fillable,
        };
      }),
    );
  }
  /**
   * Apply this market's events from one final transaction. The hash is read
   * from chain, so a caller cannot invent events; repeats are idempotent.
   */
  async recordTransaction(transactionHash, accountId) {
    assert(HASH.test(String(transactionHash)), "Invalid transaction hash.");
    const outcome = await this.market.provider.viewTransactionStatus({
      txHash: transactionHash,
      accountId,
      waitUntil: "FINAL",
    });
    assert(
      outcome?.final_execution_status === "FINAL" &&
        outcome.transaction?.hash === transactionHash,
      "The transaction is not final yet.",
      409,
    );
    const events = [];
    for (const receipt of outcome.receipts_outcome || []) {
      if (receipt?.outcome?.executor_id !== this.marketId) continue;
      if (receipt.outcome.status && Object.hasOwn(receipt.outcome.status, "Failure")) continue;
      for (const log of receipt.outcome.logs || []) {
        if (!log.startsWith("EVENT_JSON:")) continue;
        let e;
        try {
          e = JSON.parse(log.slice(11));
        } catch {
          continue;
        }
        if (e?.standard !== "questlayer_market" || !Array.isArray(e.data)) continue;
        for (const data of e.data) events.push({ event: e.event, data });
      }
    }
    return this.applyEvents(transactionHash, events);
  }
  applyEvents(transactionHash, events) {
    const now = this.now();
    let applied = 0;
    events.forEach(({ event, data }, seq) => {
      const fresh = this.db
        .prepare(
          "INSERT OR IGNORE INTO signed_market_order_events(tx_hash,seq,market,event,data,recorded_at) VALUES(?,?,?,?,?,?)",
        )
        .run(transactionHash, seq, this.marketId, String(event), JSON.stringify(data), now);
      if (!fresh.changes) return;
      applied++;
      if (event === "order_match" && data?.maker && data?.nonce)
        this.close(orderId(data.maker, data.nonce), "filled", { tx: transactionHash });
      else if (event === "order_cancel" && data?.maker && data?.nonce)
        this.close(orderId(data.maker, data.nonce), "cancelled", { tx: transactionHash });
      else if (event === "orders_cancel_all" || event === "signing_key_remove") {
        const rows = this.db
          .prepare(
            "SELECT id FROM signed_market_orders WHERE market=? AND maker=? AND state='open' AND epoch<?",
          )
          .all(this.marketId, String(data?.account_id), Number(data?.epoch) || 0);
        for (const r of rows) this.close(r.id, "cancelled", { tx: transactionHash });
      }
    });
    return { events: events.length, applied };
  }
  /** Replays every stored event, e.g. after restoring an older backup. */
  replayEvents() {
    const rows = this.db
      .prepare(
        "SELECT tx_hash,seq,event,data FROM signed_market_order_events WHERE market=? ORDER BY recorded_at,tx_hash,seq",
      )
      .all(this.marketId);
    const byTx = new Map();
    for (const r of rows) {
      if (!byTx.has(r.tx_hash)) byTx.set(r.tx_hash, []);
      byTx.get(r.tx_hash).push({ event: r.event, data: JSON.parse(r.data) });
    }
    this.db.prepare("DELETE FROM signed_market_order_events WHERE market=?").run(this.marketId);
    for (const [tx, events] of byTx) this.applyEvents(tx, events);
    return { transactions: byTx.size };
  }
  /** Reads confirmed relayed market calls from this database's relay jobs. */
  async scanRelayJobs(limit = 16) {
    const exists = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='relay_jobs'")
      .get();
    if (!exists || !this.relaySenderId) return 0;
    this.db
      .prepare("INSERT OR IGNORE INTO signed_market_order_cursor(market) VALUES(?)")
      .run(this.marketId);
    const { relay_seq } = this.db
      .prepare("SELECT relay_seq FROM signed_market_order_cursor WHERE market=?")
      .get(this.marketId);
    const jobs = this.db
      .prepare(
        `SELECT seq,transaction_hash,account_id FROM relay_jobs WHERE seq>? AND receiver_id=? AND state='confirmed'
         AND method_name IN ('cancel_order','cancel_all_orders','remove_signing_key') ORDER BY seq LIMIT ?`,
      )
      .all(relay_seq, this.marketId, limit);
    for (const job of jobs) {
      if (job.transaction_hash)
        await this.recordTransaction(job.transaction_hash, this.relaySenderId);
      this.db
        .prepare("UPDATE signed_market_order_cursor SET relay_seq=? WHERE market=?")
        .run(job.seq, this.marketId);
    }
    return jobs.length;
  }
}

export function startOrderIndexWorker(index, { intervalMs = 30000 } = {}) {
  let running = false;
  const tick = async (all = false) => {
    if (running) return;
    running = true;
    try {
      await index.scanRelayJobs();
      await index.reconcile(all ? 512 : 32, { all });
    } catch (error) {
      console.error("Signed order index:", error?.code || error?.message || error);
    } finally {
      running = false;
    }
  };
  // A restart or restore re-verifies every open order once.
  void tick(true);
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}

import { randomUUID } from "node:crypto";
import { atomic } from "../database.mjs";
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";
import { assessEscrowDelivery } from "./delivery-receipts.mjs";

export const ESCROW_LEASE_MS = 60_000;
export const ESCROW_DELIVERY_SCHEMA = registerModuleSchema({
  name: "task-market-delivery", version: 1,
  sql: `CREATE TABLE IF NOT EXISTS mk_delivery_lease(scope TEXT PRIMARY KEY,owner TEXT NOT NULL,until_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mk_delivery_attempts(op_id TEXT NOT NULL,attempt INTEGER NOT NULL,tx TEXT NOT NULL UNIQUE,signed_tx TEXT NOT NULL,identity TEXT NOT NULL,method TEXT NOT NULL,args TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('prepared','delivered','retry')),outcome TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(op_id,attempt))`,
});
const ready = new WeakSet();
export function ensureEscrowDeliverySchema(db) {
  if (!ready.has(db)) { ensureModuleVersion(db, ESCROW_DELIVERY_SCHEMA); ready.add(db); }
}
const errorText = (e) => String(e?.message ?? e).slice(0, 300);
const sameOp = (a, b) => b?.state === "queued" && ["id", "seq", "escrow_id", "method", "args"].every((k) => a[k] === b[k]);

/** One durable publisher lease, immutable signed attempts, and receipt-based acknowledgement. */
export async function runEscrowDelivery(db, { call, view, now, maxOps, clock }) {
  ensureEscrowDeliverySchema(db);
  const result = { sent: 0, failed: 0, pending: 0 };
  if (!maxOps || !call?.prepare || !call?.send || !call?.status || !call?.verify) return result;
  const start = Date.now(), tick = clock ?? (() => now + Date.now() - start), owner = randomUUID(), scope = call.scope;
  const claim = db.prepare(`INSERT INTO mk_delivery_lease VALUES(?,?,?) ON CONFLICT(scope)
    DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms WHERE mk_delivery_lease.until_ms<=?`)
    .run(scope, owner, tick() + ESCROW_LEASE_MS, tick()).changes;
  if (!claim) return result;
  let lost = false;
  const fence = () => {
    const lease = db.prepare("SELECT * FROM mk_delivery_lease WHERE scope=?").get(scope);
    if (lost || lease?.owner !== owner || lease.until_ms <= tick()) throw Error("Escrow worker lease lost");
  };
  const heartbeat = setInterval(() => {
    try {
      if (!db.prepare("UPDATE mk_delivery_lease SET until_ms=? WHERE scope=? AND owner=? AND until_ms>?")
        .run(tick() + ESCROW_LEASE_MS, scope, owner, tick()).changes) lost = true;
    } catch { lost = true; }
  }, ESCROW_LEASE_MS / 3);
  heartbeat.unref();
  const latest = (id) => db.prepare("SELECT * FROM mk_delivery_attempts WHERE op_id=? ORDER BY attempt DESC LIMIT 1").get(id);
  const current = (op, attempt) => {
    fence();
    if (!sameOp(op, db.prepare("SELECT * FROM mk_chain_ops WHERE id=?").get(op.id)) ||
      (attempt && latest(op.id)?.tx !== attempt.tx)) throw Error("Escrow operation changed");
  };
  try {
    const blocked = new Set();
    let processed = 0;
    for (const op of db.prepare("SELECT * FROM mk_chain_ops WHERE state IN ('queued','failed') ORDER BY seq LIMIT ?").all(maxOps * 3)) {
      if (processed >= maxOps) break;
      if (op.escrow_id && blocked.has(op.escrow_id)) continue;
      if (!op.escrow_id && blocked.size) break;
      // Legacy exhausted rows have no reliable receipt proof. Do not let a
      // higher publisher nonce replace an unresolved older transaction.
      if (op.state === "failed") { result.pending++; break; }
      if (op.run_after > now) {
        if (latest(op.id)?.state === "prepared") { result.pending++; break; }
        if (op.escrow_id) blocked.add(op.escrow_id); continue;
      }
      processed++;
      try {
        fence();
        let attempt = latest(op.id);
        if (!attempt && (op.attempts !== 0 || op.tx)) throw Error("Escrow operation requires reconciliation: no recorded signed attempt");
        if (!attempt || attempt.state === "retry") {
          // This is an empty-current-credit observation, not proof that an old
          // unknown transaction paid. Never use it to resolve a prepared attempt.
          if (op.method === "withdraw_for") {
            const credit = await view("get_credit", JSON.parse(op.args)); current(op, attempt);
            if (credit === "0") {
              atomic(db, () => { current(op, attempt);
                db.prepare("UPDATE mk_chain_ops SET state='sent',last_error='no_current_credit' WHERE id=?").run(op.id);
              }); result.sent++; continue;
            }
            if (typeof credit !== "string" || !/^[1-9][0-9]{0,38}$/.test(credit)) throw Error("Invalid escrow credit view");
          }
          const prepared = await call.prepare(op); fence();
          call.verify(prepared, op);
          attempt = atomic(db, () => {
            fence();
            if (!sameOp(op, db.prepare("SELECT * FROM mk_chain_ops WHERE id=?").get(op.id))) throw Error("Escrow operation changed");
            const previous = latest(op.id);
            if (previous && previous.state !== "retry") throw Error("Escrow attempt changed");
            const n = (previous?.attempt ?? 0) + 1;
            db.prepare("INSERT INTO mk_delivery_attempts VALUES(?,?,?,?,?,?,?,'prepared',NULL,?,?)")
              .run(op.id, n, prepared.tx, prepared.signed_tx, prepared.identity, op.method, op.args, tick(), tick());
            db.prepare("UPDATE mk_chain_ops SET attempts=attempts+1,tx=? WHERE id=?").run(prepared.tx, op.id);
            return latest(op.id);
          });
        }
        call.verify(attempt, op); fence();
        let response;
        try { response = await call.status(attempt); } catch { /* Exact-byte rebroadcast remains safe after an unavailable status. */ }
        current(op, attempt);
        if (!response) { response = await call.send(attempt); current(op, attempt); }
        const proof = assessEscrowDelivery(attempt, response);
        atomic(db, () => {
          fence();
          if (!sameOp(op, db.prepare("SELECT * FROM mk_chain_ops WHERE id=?").get(op.id)) || latest(op.id)?.tx !== attempt.tx)
            throw Error("Escrow operation changed");
          db.prepare("UPDATE mk_delivery_attempts SET state=?,outcome=?,updated_at=? WHERE op_id=? AND attempt=?")
            .run(proof.state === "pending" ? "prepared" : proof.state, JSON.stringify(response), tick(), op.id, attempt.attempt);
          const retryAt = now + Math.min(3_600_000, 15_000 * 2 ** Math.min(attempt.attempt, 8));
          db.prepare("UPDATE mk_chain_ops SET state=?,last_error=?,run_after=? WHERE id=?")
            .run(proof.state === "delivered" ? "sent" : "queued", proof.state === "delivered" ? null : proof.reason,
              proof.state === "retry" ? retryAt : now, op.id);
        });
        if (proof.state === "delivered") result.sent++;
        else if (proof.state === "retry") { result.failed++; if (op.escrow_id) blocked.add(op.escrow_id); }
        else { result.pending++; break; } // No higher nonce may replace an unknown outcome.
      } catch (e) {
        if (lost) break;
        try { fence(); db.prepare("UPDATE mk_chain_ops SET last_error=? WHERE id=? AND state='queued'").run(errorText(e), op.id); } catch { break; }
        result.pending++; break; // Preserve the signed attempt and exact bytes through all transport errors.
      }
    }
  } finally {
    clearInterval(heartbeat);
    db.prepare("DELETE FROM mk_delivery_lease WHERE scope=? AND owner=?").run(scope, owner);
  }
  return result;
}

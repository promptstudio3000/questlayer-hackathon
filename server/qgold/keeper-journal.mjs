import { randomUUID } from "node:crypto";
import { atomic } from "../database.mjs";
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";
import { depositQuote, QGOLD_ONE, swapNearIn, swapQgoldIn } from "./market-math.mjs";
import { assessKeeperStep } from "./keeper-receipts.mjs";
import { recoverKeeperOutput } from "./keeper-recovery.mjs";

export const KEEPER_LEASE_MS = 60_000;
export const KEEPER_JOURNAL_SCHEMA = registerModuleSchema({ name: "qgold-keeper-journal", version: 1, sql: `
CREATE TABLE IF NOT EXISTS qgold_keeper_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,until_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS qgold_keeper_slots(day TEXT NOT NULL,slot INTEGER NOT NULL,plan TEXT NOT NULL CHECK(json_valid(plan)),created_at INTEGER NOT NULL,PRIMARY KEY(day,slot));
CREATE TABLE IF NOT EXISTS qgold_keeper_ops(
 id TEXT PRIMARY KEY,day TEXT NOT NULL,slot INTEGER NOT NULL,position INTEGER NOT NULL,kind TEXT NOT NULL,
 identity TEXT NOT NULL,plan TEXT NOT NULL CHECK(json_valid(plan)),reserved_near TEXT NOT NULL,reserved_qgold TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','done')),run_after INTEGER NOT NULL,last_error TEXT,
 created_at INTEGER NOT NULL,completed_day TEXT,action_id INTEGER,UNIQUE(day,slot,kind));
CREATE TABLE IF NOT EXISTS qgold_keeper_steps(
 op_id TEXT NOT NULL,step INTEGER NOT NULL,attempt INTEGER NOT NULL,identity TEXT NOT NULL,request TEXT NOT NULL CHECK(json_valid(request)),
 tx TEXT NOT NULL UNIQUE,signed_tx TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('prepared','succeeded','retry')),
 proof TEXT,outcome TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(op_id,step,attempt));
` });
export const ensureKeeperJournal = (db) => ensureModuleVersion(db, KEEPER_JOURNAL_SCHEMA);
export const pendingKeeperOperation = (db) => db.prepare("SELECT * FROM qgold_keeper_ops WHERE state='pending' ORDER BY created_at,position,id LIMIT 1").get();
export const keeperLegacyBlocked = (db) => !!db.prepare(`SELECT 1 FROM qgold_keeper_actions a WHERE a.state='failed'
  AND NOT EXISTS(SELECT 1 FROM qgold_keeper_ops o WHERE o.action_id=a.id) LIMIT 1`).get();
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const json = (v) => JSON.stringify(v, (_key, value) => typeof value === "bigint" ? value.toString() : value);
const need = (ok, message = "Keeper operation changed") => { if (!ok) throw Error(message); };

/** All keepers sharing this database/configuration serialize before any RPC/signing work. */
export async function withKeeperLease(db, clock, work) {
  const owner = randomUUID();
  const changed = db.prepare(`INSERT INTO qgold_keeper_lease VALUES(1,?,?) ON CONFLICT(id)
    DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms WHERE qgold_keeper_lease.until_ms<=?`)
    .run(owner, clock() + KEEPER_LEASE_MS, clock()).changes;
  if (!changed) return null;
  let lost = false;
  const guard = () => {
    const row = db.prepare("SELECT * FROM qgold_keeper_lease WHERE id=1").get();
    need(!lost && row?.owner === owner && row.until_ms > clock(), "Keeper lease lost");
  };
  const heartbeat = setInterval(() => {
    try { if (!db.prepare("UPDATE qgold_keeper_lease SET until_ms=? WHERE id=1 AND owner=? AND until_ms>?")
      .run(clock() + KEEPER_LEASE_MS, owner, clock()).changes) lost = true; } catch { lost = true; }
  }, KEEPER_LEASE_MS / 3);
  heartbeat.unref();
  try { return await work(guard); }
  finally { clearInterval(heartbeat); db.prepare("DELETE FROM qgold_keeper_lease WHERE id=1 AND owner=?").run(owner); }
}

export function reserveKeeperPlan(k, due, plan, read, identity, guard, now) {
  return atomic(k.db, () => {
    guard();
    if (k.db.prepare("SELECT 1 FROM qgold_keeper_slots WHERE day=? AND slot=?").get(due.day, due.slot) ||
      k.db.prepare("SELECT 1 FROM qgold_keeper_actions WHERE day=? AND slot=?").get(due.day, due.slot)) return false;
    k.db.prepare("INSERT INTO qgold_keeper_slots VALUES(?,?,?,?)").run(due.day, due.slot, json(plan), now);
    if (!plan.active || !plan.actions.length) k.record({ ...due, kind: "slot", state: "skipped", reason: plan.reason ?? "nothing-to-do" });
    plan.actions.forEach((a, position) => {
      if (a.kind === "sale-skipped") { k.record({ ...due, kind: "sale", state: "skipped", reason: a.reason }); return; }
      if (!identity) { k.record({ ...due, kind: a.kind, state: "simulated", qgold: a.qgold ?? null, near: a.near ?? null, reason: a.reason }); return; }
      need(["sale", "inverse-buy-burn", "buyback-burn"].includes(a.kind), "Unknown keeper action");
      const near = a.kind === "sale" ? (BigInt(a.qgold) * read.state.rate * 10100n) / (QGOLD_ONE * 10000n) + 1n : BigInt(a.near);
      const frozen = json({ action: a, rate: read.state.rate, pool: read.pool, near });
      k.db.prepare("INSERT INTO qgold_keeper_ops VALUES(?,?,?,?,?,?,?,?,?,'pending',?,NULL,?,NULL,NULL)")
        .run(randomUUID(), due.day, due.slot, position, a.kind, identity, frozen, near.toString(), a.qgold ?? "0", now, now);
    });
    return true;
  });
}

const successful = (db, id, step) => db.prepare("SELECT * FROM qgold_keeper_steps WHERE op_id=? AND step=? AND state='succeeded'").get(id, step);
export function keeperSums(db, day, { reserve = true } = {}) {
  const sums = { soldToday: 0n, inverseToday: 0n, buybackSpent: 0n };
  const add = (r, near, qgold, daily) => {
    if (r.kind === "sale" && daily) sums.soldToday += BigInt(qgold ?? "0");
    if (r.kind === "inverse-buy-burn" && daily) sums.inverseToday += BigInt(near ?? "0");
    if (r.kind === "buyback-burn") sums.buybackSpent += BigInt(near ?? "0");
  };
  for (const r of db.prepare(`SELECT * FROM qgold_keeper_actions a WHERE state IN ('sent','simulated','failed')
    AND NOT EXISTS(SELECT 1 FROM qgold_keeper_ops o WHERE o.action_id=a.id)`).all()) add(r, r.near, r.qgold, r.day === day);
  for (const r of db.prepare("SELECT * FROM qgold_keeper_ops").all()) {
    // A partial operation occupies its budget across midnight. Completion also
    // charges that day, conservatively, so delayed recovery cannot evade a cap.
    const daily = r.day === day || r.completed_day === day || r.state === "pending";
    if (reserve) add(r, r.reserved_near, r.reserved_qgold, daily);
    else {
      const funded = successful(db, r.id, 0), swapped = successful(db, r.id, 1);
      add(r, funded ? r.reserved_near : "0", swapped ? JSON.parse(swapped.request).args.amount : "0", daily);
    }
  }
  return sums;
}

function nextRequest(op, step, prior) {
  const p = JSON.parse(op.plan), id = JSON.parse(op.identity), sale = op.kind === "sale";
  const base = (contractId, methodName, args, deposit, gas, phase) => ({ contractId, methodName, args, deposit: String(deposit), gas: String(BigInt(gas) * 10n ** 12n), phase });
  if (step === 0) {
    if (!sale) return base(id.wnear, "near_deposit", {}, p.near, 30, "fund");
    const minted = BigInt(depositQuote(BigInt(p.near), BigInt(p.rate)).qgold);
    return base(id.qgold, "deposit", { min_out: String(minted * 99n / 100n) }, p.near, 100, "fund");
  }
  const got = BigInt(JSON.parse(prior.proof).amount);
  if (step === 2) return base(id.qgold, "ft_burn", { amount: String(got), memo: `qgold-keeper:${op.kind}` }, 1, 30, "burn");
  const amount = sale && got > BigInt(p.action.qgold) ? BigInt(p.action.qgold) : got;
  const pool = { near: BigInt(p.pool.near), qgold: BigInt(p.pool.qgold), feeBps: p.pool.feeBps };
  const minOut = (sale ? swapQgoldIn(pool, amount, pool.feeBps) : swapNearIn(pool, amount, pool.feeBps)) * 98n / 100n;
  need(amount > 0n && minOut > 0n, "Keeper amount below minimum; reconciliation required");
  const tokenIn = sale ? id.qgold : id.wnear, tokenOut = sale ? id.wnear : id.qgold;
  return { ...base(tokenIn, "ft_transfer_call", { receiver_id: id.rhea, amount: String(amount), msg: json({ force: 0,
    actions: [{ pool_id: id.poolId, token_in: tokenIn, token_out: tokenOut, amount_in: String(amount), min_amount_out: String(minOut) }] }) }, 1, 150, "swap"), tokenOut, minOut: String(minOut) };
}

export async function resumeKeeperOperations(k, transport, guard, now) {
  const db = k.db;
  for (const op of db.prepare("SELECT * FROM qgold_keeper_ops WHERE state='pending' ORDER BY created_at,position,id").all()) {
    const current = () => {
      guard(); const fresh = db.prepare("SELECT * FROM qgold_keeper_ops WHERE id=?").get(op.id);
      need(fresh?.state === "pending" && ["identity", "plan", "kind", "day", "slot", "position", "reserved_near", "reserved_qgold"].every((key) => fresh[key] === op[key]));
    };
    try {
      current(); need(op.identity === transport.identity, "Keeper identity changed; reconcile pending operations before rotating configuration");
      if (op.run_after > now) return false;
      const advance = async (step, request) => {
        const done = successful(db, op.id, step);
        if (done) {
          need(done.request === json(request), "Completed keeper request changed");
          return { attempt: done, proof: JSON.parse(done.proof) };
        }
        let attempt = db.prepare("SELECT * FROM qgold_keeper_steps WHERE op_id=? AND step=? ORDER BY attempt DESC LIMIT 1").get(op.id, step);
        if (!attempt || attempt.state === "retry") {
          const prepared = await transport.prepare(request); current(); transport.verify(prepared, request);
          attempt = atomic(db, () => {
            current();
            const last = db.prepare("SELECT * FROM qgold_keeper_steps WHERE op_id=? AND step=? ORDER BY attempt DESC LIMIT 1").get(op.id, step);
            need(!last || last.state === "retry");
            const number = (last?.attempt ?? 0) + 1;
            db.prepare("INSERT INTO qgold_keeper_steps VALUES(?,?,?,?,?,?,?,'prepared',NULL,NULL,?,?)")
              .run(op.id, step, number, op.identity, json(request), prepared.tx, prepared.signed_tx, now, now);
            return db.prepare("SELECT * FROM qgold_keeper_steps WHERE op_id=? AND step=? AND attempt=?").get(op.id, step, number);
          });
        }
        const currentAttempt = () => {
          current();
          const fresh = db.prepare("SELECT * FROM qgold_keeper_steps WHERE op_id=? AND step=? ORDER BY attempt DESC LIMIT 1").get(op.id, step);
          need(fresh?.state === "prepared" && ["tx", "signed_tx", "identity", "request", "attempt"].every((key) => fresh[key] === attempt[key]));
        };
        transport.verify(attempt, request); currentAttempt();
        let response;
        try { response = await transport.status(attempt); } catch { /* Re-send only persisted identical bytes. */ }
        currentAttempt(); if (!response) { response = await transport.send(attempt); currentAttempt(); }
        let proof = assessKeeperStep(attempt, response);
        if (proof.reason === "rhea_receipts_required" && transport.receipts) {
          response = await transport.receipts(response, proof.receiptIds); currentAttempt();
          proof = assessKeeperStep(attempt, response);
        }
        atomic(db, () => {
          current();
          need(db.prepare("SELECT state FROM qgold_keeper_steps WHERE tx=?").get(attempt.tx)?.state === "prepared");
          db.prepare("UPDATE qgold_keeper_steps SET state=?,proof=?,outcome=?,updated_at=? WHERE tx=?")
            .run(["pending", "recoverable"].includes(proof.state) ? "prepared" : proof.state, json(proof), json(response), now, attempt.tx);
          const next = proof.state === "retry" ? now + Math.min(3_600_000, 15_000 * 2 ** Math.min(attempt.attempt, 8)) : now;
          db.prepare("UPDATE qgold_keeper_ops SET last_error=?,run_after=? WHERE id=?").run(proof.reason ?? null, next, op.id);
        });
        return { attempt, proof };
      };
      const count = op.kind === "sale" ? 2 : 3;
      for (let step = 0; step < count; step++) {
        if (successful(db, op.id, step)) continue;
        const request = nextRequest(op, step, step ? successful(db, op.id, step - 1) : null);
        const result = await advance(step, request);
        if (step === 1 && result.proof.state === "recoverable") {
          const recovered = await recoverKeeperOutput({ db, op, swap: result.attempt, proof: result.proof, transport, current, advance });
          if (!recovered) return false;
          atomic(db, () => {
            current();
            need(db.prepare("SELECT state FROM qgold_keeper_steps WHERE tx=?").get(result.attempt.tx)?.state === "prepared");
            db.prepare("UPDATE qgold_keeper_steps SET state='succeeded',proof=?,updated_at=? WHERE tx=?").run(json(recovered), now, result.attempt.tx);
            db.prepare("UPDATE qgold_keeper_ops SET last_error=NULL WHERE id=?").run(op.id);
          });
        } else if (result.proof.state !== "succeeded") return false;
      }
      atomic(db, () => {
        current();
        const swap = successful(db, op.id, 1), p = JSON.parse(op.plan);
        const qgold = op.kind === "sale" ? JSON.parse(swap.request).args.amount : JSON.parse(swap.proof).amount;
        const txHashes = db.prepare("SELECT tx FROM qgold_keeper_steps WHERE op_id=? AND state='succeeded' ORDER BY step").all(op.id).map((r) => r.tx);
        const actionId = k.record({ day: op.day, slot: op.slot, at: now, kind: op.kind, state: "sent", near: op.reserved_near,
          qgold, reason: p.action.reason, txHashes });
        db.prepare("UPDATE qgold_keeper_ops SET state='done',completed_day=?,action_id=?,last_error=NULL WHERE id=?").run(dayOf(now), actionId, op.id);
      });
    } catch (error) {
      current();
      db.prepare("UPDATE qgold_keeper_ops SET last_error=? WHERE id=?").run(String(error.message ?? error).slice(0, 300), op.id);
      return false;
    }
  }
  return true;
}

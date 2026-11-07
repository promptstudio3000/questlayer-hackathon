import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { atomic } from "../database.mjs";
import { assert } from "../domain.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";

export const PURCHASE_SCHEMA = registerModuleSchema({
  name: "qgold-purchases",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS qgold_purchases(
 id TEXT PRIMARY KEY, player_id TEXT NOT NULL, request_hash TEXT NOT NULL, request TEXT NOT NULL,
 kind TEXT, amount_u INTEGER, memo TEXT UNIQUE, account_id TEXT, contract_id TEXT,
 submitter_id TEXT, submission INTEGER NOT NULL DEFAULT 0, relay_job_id TEXT, tx_hash TEXT, tx_sender TEXT,
 state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','prepared','credited','complete')),
 response TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS qgold_purchases_owner ON qgold_purchases(player_id,request_hash,state);
CREATE TABLE IF NOT EXISTS qgold_purchase_attempts(tx_hash TEXT PRIMARY KEY,purchase_id TEXT NOT NULL,state TEXT NOT NULL,outcome TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS qgold_purchase_aliases(id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES qgold_purchases(id),player_id TEXT NOT NULL);
`,
});
const ready = new WeakSet(),
  context = new AsyncLocalStorage();
export const purchaseId = (id) =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    id,
  );
export function ensurePurchases(db) {
  if (!ready.has(db)) {
    ensureModuleVersion(db, PURCHASE_SCHEMA);
    ready.add(db);
  }
}
export function currentPurchase() {
  return context.getStore();
}
export function purchaseRow(db, player, id) {
  ensurePurchases(db);
  assert(purchaseId(id), "Invalid purchase reference.", 400, "PURCHASE_ID");
  const row =
    db
      .prepare(
        "SELECT p.* FROM qgold_purchase_aliases a JOIN qgold_purchases p ON p.id=a.purchase_id WHERE a.id=? AND a.player_id=?",
      )
      .get(id, player) ??
    db
      .prepare("SELECT * FROM qgold_purchases WHERE id=? AND player_id=?")
      .get(id, player);
  assert(row, "Purchase not found.", 404, "PURCHASE_NOT_FOUND");
  return row;
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
/** The HTTP request identity survives price quotation, signing and response loss. */
export async function runPurchase(db, { player, id, path, input }, work) {
  ensurePurchases(db);
  assert(
    purchaseId(id),
    "This purchase needs a recovery reference.",
    400,
    "PURCHASE_ID",
  );
  const request = JSON.stringify(
    canonical({
      path,
      input: Object.fromEntries(
        Object.entries(input).filter(
          ([key]) => !["fix", "encounter"].includes(key),
        ),
      ),
    }),
  );
  assert(
    request.length <= 16384,
    "Purchase is too large.",
    400,
    "PURCHASE_SIZE",
  );
  const digest = createHash("sha256").update(request).digest("hex"),
    now = Date.now();
  const row = atomic(db, () => {
    const alias = db
      .prepare("SELECT * FROM qgold_purchase_aliases WHERE id=?")
      .get(id);
    let old = alias
      ? purchaseRow(db, player, id)
      : db.prepare("SELECT * FROM qgold_purchases WHERE id=?").get(id);
    if (old)
      assert(
        old.player_id === player && old.request_hash === digest,
        "Purchase reference changed.",
        409,
        "PURCHASE_MISMATCH",
      );
    if (!old)
      old = db
        .prepare(
          "SELECT * FROM qgold_purchases WHERE player_id=? AND request_hash=? AND state!='complete' ORDER BY created_at LIMIT 1",
        )
        .get(player, digest);
    if (!old) {
      assert(
        db
          .prepare(
            "SELECT COUNT(*) n FROM qgold_purchases WHERE player_id=? AND state!='complete'",
          )
          .get(player).n < 8,
        "Existing purchases are still being confirmed. Their payments are saved.",
        409,
        "PURCHASE_PENDING",
      );
      db.prepare(
        "INSERT INTO qgold_purchases(id,player_id,request_hash,request,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ).run(id, player, digest, request, now, now);
      old = db.prepare("SELECT * FROM qgold_purchases WHERE id=?").get(id);
    }
    db.prepare(
      "INSERT OR IGNORE INTO qgold_purchase_aliases VALUES(?,?,?)",
    ).run(id, old.id, player);
    return old;
  });
  if (row.state === "complete") return JSON.parse(row.response);
  try {
    return await context.run({ db, id: row.id, player }, work);
  } catch (error) {
    if (error.code !== "QGOLD_BURN") {
      const fresh = db
        .prepare("SELECT * FROM qgold_purchases WHERE id=?")
        .get(row.id);
      if (fresh?.state === "complete") return JSON.parse(fresh.response);
      // A rejected request with no payment prepared has no financial side effect.
      if (!fresh || (fresh.state === "new" && !fresh.memo))
        atomic(db, () => {
          const locked = db
            .prepare("SELECT * FROM qgold_purchases WHERE id=?")
            .get(row.id);
          if (!locked || (locked.state === "new" && !locked.memo)) {
            db.prepare(
              "DELETE FROM qgold_purchase_aliases WHERE purchase_id=?",
            ).run(row.id);
            db.prepare("DELETE FROM qgold_purchases WHERE id=?").run(row.id);
            error.details = { ...error.details, purchaseReleased: id };
          }
        });
      throw error;
    }
    const fresh = atomic(db, () => {
      const p = purchaseRow(db, player, row.id);
      if (p.state === "complete") return p;
      assert(
        !p.kind ||
          (p.kind === error.details.kind &&
            p.amount_u === error.details.amountU),
        "The purchase price changed; its payment is preserved.",
        409,
        "PURCHASE_PRICE_CHANGED",
      );
      db.prepare(
        "UPDATE qgold_purchases SET kind=?,amount_u=?,updated_at=? WHERE id=?",
      ).run(error.details.kind, error.details.amountU, now, p.id);
      return p;
    });
    if (fresh.state === "complete") return JSON.parse(fresh.response);
    error.details = { ...error.details, purchaseId: row.id };
    throw error;
  }
}
/** Called at the business transaction boundary, so delivery and its reply commit together. */
export function purchaseAtomic(db, work) {
  const ctx = context.getStore();
  return atomic(db, () => {
    if (!ctx || ctx.db !== db) return work();
    const row = purchaseRow(db, ctx.player, ctx.id);
    if (row.state === "complete") return JSON.parse(row.response);
    const result = work();
    assert(
      !result?.then,
      "Purchase completion must be synchronous.",
      503,
      "PURCHASE_TRANSACTION",
    );
    db.prepare(
      "UPDATE qgold_purchases SET state='complete',response=?,updated_at=? WHERE id=?",
    ).run(JSON.stringify(result), Date.now(), row.id);
    return result;
  });
}

/** Called inside relayer enqueue's transaction, before budgets or another job are allocated. */
export function existingPurchaseRelay(db, player, call) {
  ensurePurchases(db);
  const row = db
    .prepare("SELECT * FROM qgold_purchases WHERE memo=?")
    .get(call.args?.memo);
  assert(
    row &&
      row.player_id === player &&
      row.account_id === call.senderId &&
      row.contract_id === call.receiverId &&
      String(row.amount_u) === call.args.amount &&
      call.methodName === "ft_burn",
    "Burn does not match a prepared purchase.",
    409,
    "BURN_INTENT",
  );
  const job = row.relay_job_id
    ? db.prepare("SELECT * FROM relay_jobs WHERE id=?").get(row.relay_job_id)
    : null;
  assert(
    job || row.state === "prepared",
    "This purchase already has a payment.",
    409,
    "BURN_REPLAY",
  );
  return { row, job };
}

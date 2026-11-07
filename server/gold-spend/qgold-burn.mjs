// Spending real QGOLD (docs/GOLD-SPENDING.md, "QGOLD burns").
//
// A spend is two steps. The player first burns the exact price from their own
// NEAR account with `ft_burn` on the QGOLD vault (1 yocto, memo
// `questlayer:burn:<kind>:<nonce>`). The server then reads that transaction
// from chain and stores it as a burn credit. The spend itself (burnGold in
// ledger.mjs) uses one unused credit of the same kind and amount, so the
// practice balance players.gold_u is never touched. The backing stays in the
// vault, so every burn raises R for all holders.
//
//   prepareQgoldBurn  -> the exact call to sign
//   confirmQgoldBurn  -> verifies the transaction and stores the credit
//   takeQgoldCredit   -> used by burnGold inside the spend's transaction
import { randomBytes } from "node:crypto";
import { assert } from "../domain.mjs";
import { atomic } from "../database.mjs";
import { currentPurchase, ensurePurchases, purchaseId, purchaseRow } from "./purchases.mjs";
import { assessBurn } from "./burn-receipts.mjs";
export { burnEvents } from "./burn-receipts.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";

export const QGOLD_BURN_SCHEMA = registerModuleSchema({
  name: "qgold-burns",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS qgold_burn_credits(tx_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, account_id TEXT NOT NULL, kind TEXT NOT NULL, amount_u INTEGER NOT NULL CHECK(amount_u>0), memo TEXT NOT NULL UNIQUE, burn_id TEXT, created_at INTEGER NOT NULL, used_at INTEGER);
CREATE INDEX IF NOT EXISTS qgold_burn_credits_open ON qgold_burn_credits(player_id,kind,amount_u,used_at)`,
});
const ready = new WeakSet();
export function ensureQgoldBurns(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, QGOLD_BURN_SCHEMA);
  ensurePurchases(db);
  ready.add(db);
}

export const BURN_GAS = "30000000000000";
const MEMO = /^questlayer:burn:([a-z]+):[0-9a-f]{16}$/;
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** The exact ft_burn call for a spend of `amountU` micro-QGOLD. */
export function prepareQgoldBurn({ db, player, intentId, submitterId, contract, accountId, kinds }) {
  ensureQgoldBurns(db);
  assert(contract, "QGOLD is not open here.", 503, "QGOLD_DISABLED");
  assert(accountId, "Sign in with a NEAR account to spend QGOLD.", 409, "NEAR_ACCOUNT");
  assert(purchaseId(submitterId), "Invalid purchase sender reference.", 400, "PURCHASE_ID");
  const p = atomic(db, () => {
    const row = purchaseRow(db, player, intentId);
    assert(kinds.includes(row.kind) && Number.isSafeInteger(row.amount_u) && row.amount_u > 0, "Request the purchase before preparing payment.", 409, "BURN_INTENT");
    assert(!row.account_id || row.account_id === accountId, "This purchase belongs to a different wallet.", 409, "BURN_ACCOUNT");
    assert(!row.contract_id || row.contract_id === contract, "The payment contract changed.", 409, "BURN_CONTRACT");
    if (row.state === "prepared" && row.relay_job_id && !row.tx_hash) {
      // A preceding failed job can block an untouched queue entry. Resume that
      // same delegate and reservation; never sign a replacement to bypass it.
      db.prepare(`UPDATE relay_jobs SET state='queued',run_after=?,updated_at=?,error_code=NULL,last_error=NULL
        WHERE id=? AND state='failed' AND error_code='RELAY_BLOCKED' AND transaction_hash IS NULL
        AND NOT EXISTS(SELECT 1 FROM relay_submissions WHERE job_id=relay_jobs.id)`)
        .run(Date.now(), Date.now(), row.relay_job_id);
    }
    if (!row.memo) db.prepare("UPDATE qgold_purchases SET memo=?,account_id=?,contract_id=?,submitter_id=?,state='prepared',updated_at=? WHERE id=?")
      .run(`questlayer:burn:${row.kind}:${randomBytes(8).toString('hex')}`, accountId, contract, submitterId, Date.now(), row.id);
    if (row.memo && !row.submitter_id) db.prepare("UPDATE qgold_purchases SET submitter_id=? WHERE id=?").run(submitterId, row.id);
    return purchaseRow(db, player, intentId);
  });
  const job = p.relay_job_id ? db.prepare("SELECT transaction_hash,state FROM relay_jobs WHERE id=?").get(p.relay_job_id) : null;
  return {
    purchaseId: p.id, submission: p.submission, state: p.state, canSign: p.state === "prepared" && p.submitter_id === submitterId && !p.tx_hash,
    txHash: p.tx_hash ?? job?.transaction_hash ?? null, relayJobId: p.relay_job_id,
    signerId: accountId,
    receiverId: contract,
    methodName: "ft_burn",
    // QGOLD has 6 decimals, so micro-QGOLD is the token's raw amount.
    args: { amount: String(p.amount_u), memo: p.memo },
    gas: BURN_GAS,
    deposit: "1",
  };
}

/**
 * Reads the player's ft_burn transaction from chain and stores the credit.
 * `txStatus(hash, accountId)` returns the final outcome (near-api-js
 * provider.txStatus). Returns the credit, or the stored one on a repeat.
 */
export async function confirmQgoldBurn(db, { player, intentId, accountIds, contract, txHash, txStatus, relayerId, now = Date.now() }) {
  ensureQgoldBurns(db);
  assert(typeof txHash === "string" && HASH.test(txHash), "Invalid transaction hash.", 400, "TX_HASH");
  const p = purchaseRow(db, player, intentId);
  assert(p.memo && p.contract_id === contract && accountIds.includes(p.account_id), "Burn from this purchase's linked account.", 403, "BURN_SIGNER");
  const seen = db.prepare("SELECT * FROM qgold_burn_credits WHERE memo=?").get(p.memo);
  if (seen) {
    assert(seen.player_id === player && seen.tx_hash === txHash, "This burn belongs to another purchase.", 409, "BURN_OWNER");
    return seen;
  }
  if (p.relay_job_id) {
    const job = db.prepare("SELECT transaction_hash FROM relay_jobs WHERE id=?").get(p.relay_job_id);
    assert(job?.transaction_hash === txHash, "The purchase relay has not confirmed this submission.", 409, "BURN_PENDING");
  }
  let outcome = null;
  for (const account of [...new Set([p.account_id, relayerId].filter(Boolean))]) {
    try {
      outcome = await txStatus(txHash, account);
      if (outcome) break;
    } catch {
      /* try the next linked account */
    }
  }
  assert(outcome, "The burn is not on chain yet. Try again in a moment.", 409, "BURN_PENDING");
  const proof = assessBurn(p, txHash, outcome);
  if (proof.state === "rejected" && proof.retrySafe) {
    atomic(db, () => {
      const fresh = purchaseRow(db, player, intentId);
      assert(fresh.submission === p.submission && fresh.relay_job_id === p.relay_job_id, "Purchase submission changed.", 409, "BURN_PENDING");
      assert(!fresh.tx_hash, "This purchase already has a payment.", 409, "BURN_REPLAY");
      const inserted = db.prepare("INSERT OR IGNORE INTO qgold_purchase_attempts VALUES(?,?,'rejected',?,?)").run(txHash, p.id, JSON.stringify(outcome), now);
      if (inserted.changes) db.prepare("UPDATE qgold_purchases SET relay_job_id=NULL,submitter_id=NULL,submission=submission+1,updated_at=? WHERE id=?").run(now, p.id);
    });
    assert(false, "The burn was rejected; the same purchase can retry safely.", 409, "BURN_REJECTED");
  }
  assert(proof.state === "succeeded", "The burn receipt is not verified yet.", 409, "BURN_PENDING");
  return atomic(db, () => {
    const fresh = purchaseRow(db, player, intentId);
    assert(fresh.submission === p.submission && fresh.relay_job_id === p.relay_job_id, "Purchase submission changed.", 409, "BURN_PENDING");
    assert(fresh.memo === p.memo && (!fresh.tx_hash || fresh.tx_hash === txHash), "Purchase payment changed.", 409, "BURN_REPLAY");
    db.prepare("INSERT OR IGNORE INTO qgold_purchase_attempts VALUES(?,?,'succeeded',?,?)").run(txHash, p.id, JSON.stringify(outcome), now);
    db.prepare(
    "INSERT INTO qgold_burn_credits(tx_hash,player_id,account_id,kind,amount_u,memo,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  ).run(txHash, player, p.account_id, p.kind, p.amount_u, p.memo, now);
  const row = db.prepare("SELECT * FROM qgold_burn_credits WHERE tx_hash=?").get(txHash);
  assert(row && row.player_id === player, "This burn was already counted.", 409, "BURN_REPLAY");
  db.prepare("UPDATE qgold_purchases SET tx_hash=?,tx_sender=?,state=CASE WHEN state='complete' THEN state ELSE 'credited' END,updated_at=? WHERE id=?")
    .run(txHash, (outcome.final_execution_outcome ?? outcome).transaction.signer_id, now, p.id);
  return row;
  });
}

/** Inside the spend's transaction: takes one unused credit, or null. */
export function takeQgoldCredit(db, { player, kind, amountU, burnId, now = Date.now() }) {
  ensureQgoldBurns(db);
  const intent = currentPurchase();
  assert(intent?.db === db && intent.player === player, "This purchase needs a recovery reference.", 409, "PURCHASE_ID");
  const p = purchaseRow(db, player, intent.id);
  const row = db
    .prepare(
      "SELECT tx_hash,memo FROM qgold_burn_credits WHERE player_id=? AND kind=? AND amount_u=? AND used_at IS NULL AND memo=? LIMIT 1",
    )
    .get(player, kind, amountU, p.memo);
  if (!row) return null;
  db.prepare("UPDATE qgold_burn_credits SET used_at=?,burn_id=? WHERE tx_hash=? AND used_at IS NULL").run(
    now,
    burnId,
    row.tx_hash,
  );
  return row;
}

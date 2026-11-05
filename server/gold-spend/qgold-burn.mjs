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
  ready.add(db);
}

export const BURN_GAS = "30000000000000";
const MEMO = /^questlayer:burn:([a-z]+):[0-9a-f]{16}$/;
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** The exact ft_burn call for a spend of `amountU` micro-QGOLD. */
export function prepareQgoldBurn({ contract, accountId, kind, amountU, kinds }) {
  assert(contract, "QGOLD is not open here.", 503, "QGOLD_DISABLED");
  assert(accountId, "Sign in with a NEAR account to spend QGOLD.", 409, "NEAR_ACCOUNT");
  assert(kinds.includes(kind), "Unknown GOLD spend.", 400, "BURN_KIND");
  assert(Number.isSafeInteger(amountU) && amountU > 0, "Invalid GOLD amount.", 400, "BURN_AMOUNT");
  return {
    signerId: accountId,
    receiverId: contract,
    methodName: "ft_burn",
    // QGOLD has 6 decimals, so micro-QGOLD is the token's raw amount.
    args: { amount: String(amountU), memo: `questlayer:burn:${kind}:${randomBytes(8).toString("hex")}` },
    gas: BURN_GAS,
    deposit: "1",
  };
}

/** The nep141 ft_burn events a transaction outcome logged on `contract`. */
export function burnEvents(outcome, contract) {
  const out = [];
  for (const r of outcome?.receipts_outcome || []) {
    if (r?.outcome?.executor_id !== contract) continue;
    if (r.outcome.status && !("SuccessValue" in r.outcome.status)) continue;
    for (const line of r.outcome.logs || []) {
      if (!line.startsWith("EVENT_JSON:")) continue;
      try {
        const e = JSON.parse(line.slice(11));
        if (e.standard === "nep141" && e.event === "ft_burn")
          for (const d of e.data || []) out.push(d);
      } catch {
        /* not ours */
      }
    }
  }
  return out;
}

/**
 * Reads the player's ft_burn transaction from chain and stores the credit.
 * `txStatus(hash, accountId)` returns the final outcome (near-api-js
 * provider.txStatus). Returns the credit, or the stored one on a repeat.
 */
export async function confirmQgoldBurn(db, { player, accountIds, contract, txHash, txStatus, now = Date.now() }) {
  ensureQgoldBurns(db);
  assert(typeof txHash === "string" && HASH.test(txHash), "Invalid transaction hash.", 400, "TX_HASH");
  const seen = db.prepare("SELECT * FROM qgold_burn_credits WHERE tx_hash=?").get(txHash);
  if (seen) {
    assert(seen.player_id === player, "This burn belongs to another player.", 409, "BURN_OWNER");
    return seen;
  }
  let outcome = null;
  for (const account of accountIds) {
    try {
      outcome = await txStatus(txHash, account);
      if (outcome) break;
    } catch {
      /* try the next linked account */
    }
  }
  assert(outcome, "The burn is not on chain yet. Try again in a moment.", 409, "BURN_PENDING");
  const signer = outcome.transaction?.signer_id;
  assert(accountIds.includes(signer), "Burn QGOLD from your own linked account.", 403, "BURN_SIGNER");
  assert(outcome.transaction?.receiver_id === contract, "That transaction is not a QGOLD burn.", 400, "BURN_CONTRACT");
  const event = burnEvents(outcome, contract).find(
    (d) => d.owner_id === signer && typeof d.memo === "string" && MEMO.test(d.memo),
  );
  assert(event, "That transaction did not burn QGOLD for the game.", 400, "BURN_EVENT");
  const amountU = Number(event.amount);
  assert(Number.isSafeInteger(amountU) && amountU > 0, "Invalid burn amount.", 400, "BURN_AMOUNT");
  const kind = MEMO.exec(event.memo)[1];
  db.prepare(
    "INSERT INTO qgold_burn_credits(tx_hash,player_id,account_id,kind,amount_u,memo,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  ).run(txHash, player, signer, kind, amountU, event.memo, now);
  const row = db.prepare("SELECT * FROM qgold_burn_credits WHERE tx_hash=?").get(txHash);
  assert(row && row.player_id === player, "This burn was already counted.", 409, "BURN_REPLAY");
  return row;
}

/** Inside the spend's transaction: takes one unused credit, or null. */
export function takeQgoldCredit(db, { player, kind, amountU, burnId, now = Date.now() }) {
  ensureQgoldBurns(db);
  const row = db
    .prepare(
      "SELECT tx_hash,memo FROM qgold_burn_credits WHERE player_id=? AND kind=? AND amount_u=? AND used_at IS NULL ORDER BY created_at LIMIT 1",
    )
    .get(player, kind, amountU);
  if (!row) return null;
  db.prepare("UPDATE qgold_burn_credits SET used_at=?,burn_id=? WHERE tx_hash=? AND used_at IS NULL").run(
    now,
    burnId,
    row.tx_hash,
  );
  return row;
}

import { atomic } from "../database.mjs";
import { assert } from "../domain.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";
export const SUBSIDY_SCHEMA = registerModuleSchema({
  name: "subsidy-budget",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS subsidy_reservations(
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, account_id TEXT NOT NULL,
 principal TEXT NOT NULL, gas_reserve TEXT NOT NULL, reserved TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'reserved', tx_hash TEXT, created_at INTEGER NOT NULL, settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS subsidy_reservations_day ON subsidy_reservations(created_at,state);`,
});
const amount = (n) => {
  const value = String(n);
  assert(
    /^(0|[1-9][0-9]{0,38})$/.test(value),
    "Invalid sponsor budget amount.",
    503,
  );
  return BigInt(value);
};
/** One treasury-wide boundary, shared by account creation, relays and topups.
 * Unknown reservations carry across UTC midnight; a timeout never frees money.
 * Final refunds are deliberately not reclaimed, including refunds to a player.
 * A reservation whose job ended before any transaction was signed, or whose
 * signed transaction is proved never includable, is released: nothing left the
 * treasury, so it must not consume the shared daily budget.
 */
export class SubsidyBudget {
  constructor(
    db,
    {
      dailyYocto = 0n,
      dailyOperations = 0,
      gasReserveYocto = 0n,
      clock = Date.now,
    } = {},
  ) {
    ensureModuleVersion(db, SUBSIDY_SCHEMA);
    this.db = db;
    this.dailyYocto = amount(dailyYocto);
    this.gasReserve = amount(gasReserveYocto);
    assert(
      Number.isSafeInteger(dailyOperations) && dailyOperations >= 0,
      "Invalid sponsor operation limit.",
      503,
    );
    this.dailyOperations = dailyOperations;
    this.clock = clock;
  }
  snapshot() {
    const start = Math.floor(this.clock() / 86400000) * 86400000;
    const rows = this.db
      .prepare(
        "SELECT reserved,state FROM subsidy_reservations WHERE (created_at>=? AND state!='released') OR state='reserved'",
      )
      .all(start);
    return {
      operations: rows.length,
      reservedYocto: rows
        .reduce((sum, r) => sum + BigInt(r.reserved), 0n)
        .toString(),
      pending: rows.filter((r) => r.state === "reserved").length,
      limitYocto: String(this.dailyYocto),
      limitOperations: this.dailyOperations,
    };
  }
  reserve(id, { kind, accountId, principal }) {
    const value = amount(principal);
    const work = () => {
      assert(
        !this.db
          .prepare(
            "SELECT 1 FROM subsidy_reservations WHERE state='overrun' LIMIT 1",
          )
          .get(),
        "Observed sponsorship fees exceeded their reserve. New sponsorship awaits operator review; saved submissions remain recoverable.",
        503,
        "SUBSIDY_GAS_OVERRUN",
      );
      const old = this.db
        .prepare("SELECT * FROM subsidy_reservations WHERE id=?")
        .get(id);
      if (old) {
        assert(
          old.kind === kind &&
            old.account_id === accountId &&
            old.principal === String(value),
          "Sponsor reservation changed.",
          503,
          "SUBSIDY_MISMATCH",
        );
        // A released id that is reserved again competes for today's budget
        // like a new reservation; it never rides on the released row.
        if (old.state !== "released") return old;
      }
      assert(
        this.dailyYocto > 0n &&
          this.dailyOperations > 0 &&
          this.gasReserve > 0n,
        "Sponsored transactions need an operator-configured service budget. Free play remains available.",
        503,
        "SUBSIDY_DISABLED",
      );
      const used = this.snapshot(),
        total = value + this.gasReserve;
      assert(
        used.operations < this.dailyOperations &&
          BigInt(used.reservedYocto) + total <= this.dailyYocto,
        "The service sponsorship budget is currently reserved. Saved operations remain recoverable.",
        429,
        "SUBSIDY_BUDGET",
      );
      if (old)
        this.db
          .prepare(
            "UPDATE subsidy_reservations SET state='reserved',gas_reserve=?,reserved=?,tx_hash=NULL,created_at=?,settled_at=NULL WHERE id=? AND state='released'",
          )
          .run(String(this.gasReserve), String(total), this.clock(), id);
      else
        this.db
          .prepare(
            "INSERT INTO subsidy_reservations(id,kind,account_id,principal,gas_reserve,reserved,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            id,
            kind,
            accountId,
            String(value),
            String(this.gasReserve),
            String(total),
            this.clock(),
          );
      return this.db
        .prepare("SELECT * FROM subsidy_reservations WHERE id=?")
        .get(id);
    };
    return this.db.isTransaction ? work() : atomic(this.db, work);
  }
  /** Frees a reservation whose operation provably never reached the chain. */
  release(id) {
    return (
      this.db
        .prepare(
          "UPDATE subsidy_reservations SET state='released',reserved='0',settled_at=? WHERE id=? AND state='reserved'",
        )
        .run(this.clock(), id).changes === 1
    );
  }
  settle(id, txHash, response = null) {
    // Call only after the owning journal proves a final outcome for its exact
    // transaction. Conservatively charge the entire reservation even on failure.
    const row = this.db
      .prepare("SELECT * FROM subsidy_reservations WHERE id=?")
      .get(id);
    if (!row || row.state !== "reserved") return;
    const result = response?.final_execution_outcome ?? response;
    const outcomes = result
      ? [result.transaction_outcome, ...(result.receipts_outcome ?? [])]
      : [];
    // Receipt tokens_burnt include execution charges across the receipt graph.
    // Never recycle a refund. A configured gas reserve is an estimate, so an
    // observed overrun trips a persistent breaker before another new send.
    const priced =
      outcomes.length > 0 &&
      outcomes.every((o) =>
        /^(0|[1-9][0-9]*)$/.test(String(o?.outcome?.tokens_burnt ?? "")),
      );
    const fees = priced
      ? outcomes.reduce((n, o) => n + BigInt(o.outcome.tokens_burnt), 0n)
      : 0n;
    const overrun = priced && fees > BigInt(row.gas_reserve);
    this.db
      .prepare(
        "UPDATE subsidy_reservations SET state=?,reserved=?,tx_hash=?,settled_at=? WHERE id=? AND state='reserved'",
      )
      .run(
        overrun ? "overrun" : "spent",
        String(overrun ? BigInt(row.principal) + fees : BigInt(row.reserved)),
        txHash,
        this.clock(),
        id,
      );
  }
}

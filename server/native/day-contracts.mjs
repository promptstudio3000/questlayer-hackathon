// Which rewards contract each native day belongs to.
//
// native_days predates contract generations: a manifest names no contract, so a
// host that moves to a new rewards account (for example generation 20261101b)
// keeps rows that were published on an older one. Those days can never be read,
// closed or audited on the current contract, and the retire loop must not stall
// on them. This additive module records the owning contract per day:
//   - 'current': confirmed on this host's rewards contract (contract_id set);
//   - 'foreign': published locally but absent from the current contract.
// Foreign days are quarantined: the worker skips them, nothing is closed or
// rewritten, and their rows stay for the operator and the public record.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";

export const NATIVE_DAY_CONTRACTS_SCHEMA = registerModuleSchema({
  name: "native-day-contracts",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS native_day_contracts(
 day_id TEXT PRIMARY KEY,
 contract_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('current','foreign')),
 reason TEXT,
 updated_at INTEGER NOT NULL
);
`,
});

export function ensureNativeDayContracts(db) {
  ensureModuleVersion(db, NATIVE_DAY_CONTRACTS_SCHEMA);
}

function ready(db) {
  return !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_day_contracts'",
    )
    .get();
}

/** The recorded owner of a day, or null when it was never checked (legacy row). */
export function nativeDayContract(db, dayId) {
  if (!ready(db)) return null;
  return (
    db
      .prepare("SELECT * FROM native_day_contracts WHERE day_id=?")
      .get(dayId) || null
  );
}

/** True when a recorded owner says this day is not on `contractId`. */
export function belongsElsewhere(record, contractId) {
  return (
    !!record &&
    (record.state === "foreign" || record.contract_id !== contractId)
  );
}

/** SQL fragment (alias `d` for native_days) excluding days of other contracts. */
export function onContractSql(db) {
  return ready(db)
    ? " AND NOT EXISTS(SELECT 1 FROM native_day_contracts c WHERE c.day_id=d.id AND (c.state='foreign' OR c.contract_id IS NOT ?))"
    : "";
}

export function recordCurrentDay(write, dayId, contractId, at) {
  write(
    "INSERT INTO native_day_contracts(day_id,contract_id,state,reason,updated_at) VALUES(?,?,'current',NULL,?) ON CONFLICT(day_id) DO UPDATE SET contract_id=excluded.contract_id,state='current',reason=NULL,updated_at=excluded.updated_at",
    dayId,
    contractId,
    at,
  );
}

export function quarantineForeignDay(write, dayId, reason, at) {
  write(
    "INSERT INTO native_day_contracts(day_id,contract_id,state,reason,updated_at) VALUES(?,NULL,'foreign',?,?) ON CONFLICT(day_id) DO UPDATE SET state='foreign',reason=excluded.reason,updated_at=excluded.updated_at",
    dayId,
    String(reason).slice(0, 200),
    at,
  );
}

/** Days the worker quarantined, for health/operator reports. */
export function foreignNativeDays(db) {
  if (!ready(db)) return [];
  return db
    .prepare(
      "SELECT day_id AS id,contract_id AS contractId,reason,updated_at AS updatedAt FROM native_day_contracts WHERE state='foreign' ORDER BY day_id",
    )
    .all();
}

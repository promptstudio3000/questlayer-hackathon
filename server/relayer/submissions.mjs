import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";
export const RELAY_SUBMISSIONS_SCHEMA = registerModuleSchema({
  name: "relay-submissions",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS relay_submissions(
 job_id TEXT NOT NULL, attempt INTEGER NOT NULL, hash TEXT NOT NULL UNIQUE,
 signed_tx TEXT NOT NULL, account_id TEXT NOT NULL, public_key TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'prepared', outcome TEXT, created_at INTEGER NOT NULL,
 PRIMARY KEY(job_id,attempt)
);`,
});
export function ensureRelaySubmissions(db) {
  ensureModuleVersion(db, RELAY_SUBMISSIONS_SCHEMA);
}

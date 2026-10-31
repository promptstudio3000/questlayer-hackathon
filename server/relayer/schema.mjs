import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";

// Managed player accounts and sponsored meta-transaction jobs. Amounts in
// yoctoNEAR are decimal TEXT because u128 exceeds SQLite integers.
export const MANAGED_ACCOUNTS_SCHEMA = registerModuleSchema({
  name: "managed-accounts",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS managed_accounts(
 account_id TEXT PRIMARY KEY,
 player_id TEXT NOT NULL UNIQUE REFERENCES players(id),
 slug TEXT NOT NULL UNIQUE,
 factory_id TEXT NOT NULL,
 network TEXT NOT NULL CHECK(network='testnet'),
 state TEXT NOT NULL CHECK(state IN ('creating','ready','failed')),
 funded_yocto TEXT NOT NULL DEFAULT '0' CHECK(funded_yocto GLOB '[0-9]*'),
 transaction_hash TEXT,
 error_code TEXT,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 ready_at INTEGER,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS managed_account_keys(
 account_id TEXT NOT NULL REFERENCES managed_accounts(account_id),
 public_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('device','recovery')),
 state TEXT NOT NULL CHECK(state IN ('pending','active','removing','removed')),
 label TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,public_key)
);
CREATE TABLE IF NOT EXISTS managed_account_funding(
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES managed_accounts(account_id),
 kind TEXT NOT NULL CHECK(kind IN ('initial','topup')),
 amount_yocto TEXT NOT NULL CHECK(amount_yocto GLOB '[0-9]*'),
 job_id TEXT,
 transaction_hash TEXT,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS relay_jobs(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 player_id TEXT NOT NULL REFERENCES players(id),
 account_id TEXT NOT NULL REFERENCES managed_accounts(account_id),
 kind TEXT NOT NULL CHECK(kind IN ('create-account','relay')),
 state TEXT NOT NULL CHECK(state IN ('queued','retrying','sent','confirmed','failed')),
 delegate_hash TEXT,
 delegate TEXT,
 call TEXT NOT NULL CHECK(json_valid(call)),
 receiver_id TEXT NOT NULL,
 method_name TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 run_after INTEGER NOT NULL,
 transaction_hash TEXT,
 result TEXT CHECK(result IS NULL OR json_valid(result)),
 error_code TEXT,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 confirmed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS relay_jobs_delegate_live ON relay_jobs(delegate_hash) WHERE state!='failed';
CREATE INDEX IF NOT EXISTS relay_jobs_account_order ON relay_jobs(account_id,state,seq);
CREATE INDEX IF NOT EXISTS relay_jobs_player_time ON relay_jobs(player_id,created_at DESC);
CREATE TABLE IF NOT EXISTS relay_budget(
 account_id TEXT NOT NULL REFERENCES managed_accounts(account_id),
 day TEXT NOT NULL,
 jobs INTEGER NOT NULL DEFAULT 0 CHECK(jobs>=0),
 topup_yocto TEXT NOT NULL DEFAULT '0' CHECK(topup_yocto GLOB '[0-9]*'),
 PRIMARY KEY(account_id,day)
);
CREATE TABLE IF NOT EXISTS relay_worker_lease(
 id INTEGER PRIMARY KEY CHECK(id=1),
 owner TEXT,
 until_ms INTEGER NOT NULL DEFAULT 0,
 last_success INTEGER,
 last_error TEXT
);
`,
});

const initialized = new WeakSet();
export function initializeManagedAccounts(db) {
  const version = ensureModuleVersion(db, MANAGED_ACCOUNTS_SCHEMA);
  if (!initialized.has(db)) {
    db.exec("INSERT OR IGNORE INTO relay_worker_lease(id) VALUES(1)");
    initialized.add(db);
  }
  return version;
}

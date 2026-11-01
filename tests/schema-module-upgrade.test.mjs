import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  registerModuleSchema,
  recordSchemaVersions,
  preflightDatabase,
  schemaStatus,
} from "../server/schema-compatibility.mjs";
import {
  MANAGED_ACCOUNTS_SCHEMA,
  initializeManagedAccounts,
} from "../server/relayer/schema.mjs";

const KNOWN = JSON.parse(
  readFileSync(new URL("../server/schema-known.json", import.meta.url), "utf8"),
);
const v1 = KNOWN.optional.find(
  (m) => m.name === "managed-accounts" && m.version === 1,
);

function v1Database(path, { ledger = true } = {}) {
  const db = openDatabase(path);
  db.exec(Object.values(v1.tables).join(";"));
  db.exec(Object.values(v1.indexes).join(";"));
  if (ledger) recordSchemaVersions(db);
  const player = createPlayer(db, "Testnet explorer");
  db.prepare(
    "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,'testnet','ready',1,1)",
  ).run("abc.factory.testnet", player, "abc", "factory.testnet");
  db.prepare(
    "INSERT INTO managed_account_keys VALUES(?,?,'device','active','first device',1,1)",
  ).run("abc.factory.testnet", "ed25519:key");
  return { db, player };
}
const temp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-upgrade-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const rows = (db) => ({
  accounts: JSON.stringify(db.prepare("SELECT * FROM managed_accounts").all()),
  keys: JSON.stringify(db.prepare("SELECT * FROM managed_account_keys").all()),
});

test("managed-accounts v2 is current and v1 stays recognizable", () => {
  assert.equal(MANAGED_ACCOUNTS_SCHEMA.version, 2);
  assert.match(
    MANAGED_ACCOUNTS_SCHEMA.tables.managed_accounts,
    /CHECK\(network IN \('testnet','mainnet'\)\)/,
  );
  assert.equal(MANAGED_ACCOUNTS_SCHEMA.upgrades[0].from, 1);
});

test("a recorded v1 database upgrades in place without touching rows", (t) => {
  const path = join(temp(t), "v1.sqlite");
  const { db } = v1Database(path);
  assert.equal(schemaStatus(db).schema.modules["managed-accounts"], 1);
  const before = rows(db);
  db.close();
  // Preflight of the untouched file still accepts the older version.
  const pre = preflightDatabase(path);
  assert.deepEqual(
    pre.modules.find((m) => m.name === "managed-accounts").version,
    1,
  );
  const again = openDatabase(path);
  t.after(() => again.close());
  assert.equal(initializeManagedAccounts(again), 2);
  assert.equal(schemaStatus(again).schema.modules["managed-accounts"], 2);
  assert.deepEqual(rows(again), before);
  assert.equal(
    again.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  // Idempotent: a second initialization changes nothing.
  assert.equal(initializeManagedAccounts(again), 2);
  assert.deepEqual(rows(again), before);
  // The widened CHECK accepts mainnet and still rejects anything else.
  const other = createPlayer(again, "Other explorer");
  again
    .prepare(
      "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,?,'creating',1,1)",
    )
    .run("def.factory.near", other, "def", "factory.near", "mainnet");
  assert.throws(
    () =>
      again
        .prepare(
          "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,?,'creating',1,1)",
        )
        .run("x.factory.near", createPlayer(again, "x"), "x", "f", "devnet"),
    /CHECK/,
  );
});

test("an unrecorded v1 database records and upgrades in one step", (t) => {
  const path = join(temp(t), "legacy.sqlite");
  const { db } = v1Database(path, { ledger: false });
  const before = rows(db);
  db.close();
  const again = openDatabase(path);
  t.after(() => again.close());
  assert.equal(initializeManagedAccounts(again), 2);
  assert.equal(schemaStatus(again).schema.modules["managed-accounts"], 2);
  assert.deepEqual(rows(again), before);
});

test("an upgrade rolls back with its owning transaction", (t) => {
  const { db } = v1Database(":memory:");
  t.after(() => db.close());
  db.exec("BEGIN IMMEDIATE");
  initializeManagedAccounts(db);
  db.exec("ROLLBACK");
  assert.equal(schemaStatus(db).schema.modules["managed-accounts"], 1);
  assert.match(
    db
      .prepare("SELECT sql FROM sqlite_master WHERE name='managed_accounts'")
      .get().sql,
    /CHECK\(network='testnet'\)/,
  );
});

test("a ledger that disagrees with the stored v1 shape is not upgraded", (t) => {
  const { db } = v1Database(":memory:");
  t.after(() => db.close());
  db.prepare(
    "UPDATE questlayer_schema_modules SET fingerprint='x' WHERE name='managed-accounts'",
  ).run();
  assert.throws(() => initializeManagedAccounts(db), /altered/);
});

test("a database holding another network's accounts is refused", (t) => {
  const { db } = v1Database(":memory:");
  t.after(() => db.close());
  initializeManagedAccounts(db);
  db.prepare("UPDATE managed_accounts SET network='mainnet'").run();
  assert.throws(
    () => initializeManagedAccounts(db),
    (error) => error.code === "NETWORK_MISMATCH",
  );
});

test("upgrade steps must be provable from a recorded older version", () => {
  const tables = MANAGED_ACCOUNTS_SCHEMA.sql;
  assert.throws(
    () =>
      registerModuleSchema({
        name: "managed-accounts",
        version: 3,
        sql: tables,
      }),
    /not recorded/,
  );
  assert.throws(
    () =>
      registerModuleSchema({
        name: "schema-test-upgrade",
        version: 2,
        sql: "CREATE TABLE IF NOT EXISTS schema_test_upgrade(id TEXT PRIMARY KEY);",
        upgrades: [{ from: 1, loosen: {} }],
      }),
    /recorded older version/,
  );
});

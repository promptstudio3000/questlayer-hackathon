import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
  preflightDatabase,
  inspectDatabaseSchema,
  schemaStatus,
  restorePreflight,
  recordSchemaVersions,
} from "../server/schema-compatibility.mjs";
import "../server/schema-catalog.mjs";
const KNOWN = JSON.parse(
  readFileSync(new URL("../server/schema-known.json", import.meta.url), "utf8"),
);
const plain = (v) => JSON.parse(JSON.stringify(v));
const sha = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-schema-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function contents(db) {
  return Object.fromEntries(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => [
        name,
        plain(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()),
      ]),
  );
}
function legacy(path, baseline) {
  const db = new DatabaseSync(path);
  for (const sql of Object.values(baseline.tables)) db.exec(sql);
  for (const sql of Object.values(baseline.indexes || {})) db.exec(sql);
  db.prepare(
    "INSERT INTO players(id,name,gold_u,xp,appearance,created_at) VALUES(?,?,?,?,?,?)",
  ).run("legacy-player", "Private explorer", 12345, 987, "{}", 1);
  db.exec("INSERT INTO treasury VALUES('coins',123,4,5),('zones',456,7,8)");
  db.exec(
    "INSERT INTO treasury_events VALUES('initial-demo-sponsor','demo-sponsor',123,456,1)",
  );
  return db;
}

test("new core records explicit version and bounded unrecorded source without creating creator storage", () => {
  const db = openDatabase(":memory:");
  try {
    assert.deepEqual(schemaStatus(db), {
      source: { buildId: "development-unrecorded", recorded: false },
      schema: { coreVersion: 1, modules: {} },
    });
    assert.equal(
      schemaStatus(db, { buildId: "qa-reviewed-source-v1" }).source.recorded,
      true,
    );
    assert.equal(
      schemaStatus(db, { buildId: "/private/secret/path" }).source.buildId,
      "development-unrecorded",
    );
    assert.deepEqual(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'creator_%'")
        .all(),
      [],
    );
    assert.equal(inspectDatabaseSchema(db).legacy, null);
  } finally {
    db.close();
  }
});
for (const baseline of KNOWN.core)
  test(`genuine unversioned core ${baseline.revision} upgrades atomically preserving existing rights and amounts`, (t) => {
    const path = join(temp(t), "legacy.sqlite");
    const old = legacy(path, baseline),
      before = contents(old),
      columns = Object.fromEntries(
        Object.keys(before).map((n) => [
          n,
          old
            .prepare(`PRAGMA table_info(${n})`)
            .all()
            .map((c) => c.name),
        ]),
      );
    old.close();
    assert.equal(preflightDatabase(path).coreVersion, 0);
    const db = openDatabase(path);
    try {
      assert.equal(schemaStatus(db).schema.coreVersion, 1);
      for (const [table, rows] of Object.entries(before))
        assert.deepEqual(
          plain(
            db
              .prepare(
                `SELECT ${columns[table].map((n) => `"${n}"`).join(",")} FROM ${table} ORDER BY rowid`,
              )
              .all(),
          ),
          rows,
          table,
        );
      assert.equal(db.prepare("SELECT xp FROM players").get().xp, 987);
      assert.equal(
        db.prepare("SELECT count(*) n FROM treasury_events").get().n,
        1,
      );
      assert.deepEqual(
        db
          .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'creator_%'")
          .all(),
        [],
      );
    } finally {
      db.close();
    }
    const first = sha(path);
    const again = openDatabase(path);
    again.close();
    assert.equal(
      sha(path),
      first,
      "reopening current schema must not rewrite data",
    );
  });

test("future user/core/module versions, foreign, altered and corrupt files fail before any bootstrap mutation", (t) => {
  const dir = temp(t);
  for (const kind of [
    "foreign",
    "corrupt",
    "future-user",
    "future-core",
    "unknown-module",
    "altered-core",
    "missing-index",
    "unknown-index",
  ]) {
    const path = join(dir, kind + ".sqlite");
    if (kind === "corrupt") writeFileSync(path, "not a SQLite database");
    else if (kind === "foreign") {
      const db = new DatabaseSync(path);
      db.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY,value TEXT)");
      db.close();
    } else {
      let db = openDatabase(path);
      db.close();
      db = new DatabaseSync(path);
      if (kind === "future-user") db.exec("PRAGMA user_version=99");
      if (kind === "future-core")
        db.exec(
          "UPDATE questlayer_schema_modules SET version=99 WHERE name='core'",
        );
      if (kind === "unknown-module")
        db.exec(
          "INSERT INTO questlayer_schema_modules VALUES('future-module',99,'future')",
        );
      if (kind === "missing-index") db.exec("DROP INDEX unique_open_listing");
      if (kind === "unknown-index")
        db.exec("CREATE INDEX unknown_schema_index ON players(name)");
      if (kind === "altered-core")
        db.exec("ALTER TABLE players ADD COLUMN unreviewed TEXT");
      db.close();
    }
    const before = sha(path),
      files = readdirSync(dir).sort();
    assert.throws(() => openDatabase(path));
    assert.equal(sha(path), before, kind);
    assert.deepEqual(
      readdirSync(dir).sort(),
      files,
      "no WAL files or side effects for rejected input",
    );
  }
});

test("an actual interrupted legacy bootstrap rolls back its preceding DDL and seeds", (t) => {
  const path = join(temp(t), "interrupted.sqlite");
  const old = legacy(path, KNOWN.core[0]);
  const before = contents(old),
    schema = old
      .prepare("SELECT name,sql FROM sqlite_master ORDER BY name")
      .all();
  old.close();
  const original = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
    if (sql.includes("ALTER TABLE presence ADD COLUMN arena"))
      throw new Error("Injected interrupted upgrade");
    return original.call(this, sql);
  });
  assert.throws(() => openDatabase(path), /Injected interrupted upgrade/);
  t.mock.restoreAll();
  const db = new DatabaseSync(path, { readOnly: true });
  assert.deepEqual(contents(db), before);
  assert.deepEqual(
    db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),
    schema,
  );
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 0);
  db.close();
  const retry = openDatabase(path);
  assert.equal(schemaStatus(retry).schema.coreVersion, 1);
  retry.close();
});

test("module registration is pure and initialization/versioning nest and roll back with the owning transaction", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const definition = registerModuleSchema({
    name: "schema-test-transaction",
    version: 1,
    sql: "CREATE TABLE IF NOT EXISTS schema_test_transaction(id TEXT PRIMARY KEY,player_id TEXT REFERENCES players(id));",
  });
  assert.equal(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='schema_test_transaction'",
      )
      .get(),
    undefined,
  );
  db.exec("BEGIN IMMEDIATE");
  ensureModuleVersion(db, definition);
  db.exec("ROLLBACK");
  assert.equal(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='schema_test_transaction'",
      )
      .get(),
    undefined,
  );
  assert.equal(schemaStatus(db).schema.modules[definition.name], undefined);
  ensureModuleVersion(db, definition);
  const before = contents(db);
  ensureModuleVersion(db, definition);
  assert.deepEqual(contents(db), before);
  db.prepare(
    "UPDATE questlayer_schema_modules SET version=99 WHERE name=?",
  ).run(definition.name);
  assert.throws(() => ensureModuleVersion(db, definition), /future/);
});

test("partial optional modules and private-schema drift cannot be adopted as known legacy", (t) => {
  const path = join(temp(t), "optional.sqlite"),
    db = openDatabase(path);
  const def = registerModuleSchema({
    name: "schema-test-pair",
    version: 1,
    sql: "CREATE TABLE IF NOT EXISTS schema_test_pair_a(id TEXT PRIMARY KEY);CREATE TABLE IF NOT EXISTS schema_test_pair_b(id TEXT PRIMARY KEY);",
  });
  db.exec("CREATE TABLE schema_test_pair_a(id TEXT PRIMARY KEY)");
  db.close();
  const before = sha(path);
  assert.throws(() => openDatabase(path), /Unsupported/);
  assert.equal(sha(path), before);
  assert.throws(() =>
    registerModuleSchema({
      name: "core",
      version: 1,
      sql: "CREATE TABLE IF NOT EXISTS forbidden(id TEXT);",
    }),
  );
  assert.throws(() =>
    registerModuleSchema({
      name: "unsafe-schema",
      version: 1,
      sql: "DROP TABLE players;",
    }),
  );
});

test("recording already initialized optional module versions changes no existing data or default enablement", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const optional = KNOWN.optional.find((m) => m.name === "social-blocks");
  db.exec(Object.values(optional.tables).join(";"));
  const player = createPlayer(db, "Private owner");
  db.prepare("INSERT INTO social_blocks VALUES(?,?,?)").run(
    player,
    createPlayer(db, "Private blocked"),
    1,
  );
  const before = contents(db);
  recordSchemaVersions(db);
  assert.equal(schemaStatus(db).schema.modules["social-blocks"], 1);
  for (const [n, rows] of Object.entries(before))
    if (n !== "questlayer_schema_modules")
      assert.deepEqual(contents(db)[n], rows);
  assert.deepEqual(
    db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'creator_%'")
      .all(),
    [],
  );
});

test("actual private snapshot and restore CLI preflight source/schema/config before isolated bootstrap", (t) => {
  const dir = temp(t),
    state = join(dir, "state"),
    app = join(dir, "app"),
    destination = join(app, "state-backups");
  mkdirSync(state);
  mkdirSync(app);
  symlinkSync(resolve("."), join(app, "current"), "dir");
  const db = openDatabase(join(state, "auratrail.sqlite"));
  createPlayer(db, "Private fixture");
  db.close();
  const config = "a".repeat(64);
  const report = JSON.parse(
    execFileSync(
      "python3",
      [
        resolve("deploy/backup-state.py"),
        "--state",
        state,
        "--destination",
        destination,
        "--build-id",
        "qa-reviewed-source-v1",
        "--config-sha256",
        config,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const file = join(destination, report.snapshotId, "database.sqlite"),
    before = sha(file);
  assert.equal(report.schemaCompatibility.coreVersion, 1);
  const result = restorePreflight(file, report, {
    expectedConfigDigest: config,
    expectedBuildId: "qa-reviewed-source-v1",
  });
  assert.equal(result.compatible, true);
  assert.equal(result.configurationVerified, true);
  assert.equal(result.sourceVerified, true);
  for (const invalid of [
    { expectedConfigDigest: "b".repeat(64) },
    { expectedBuildId: "other-source" },
  ])
    assert.throws(() => restorePreflight(file, report, invalid));
  assert.throws(() => restorePreflight(file, { ...report, format: 2 }));
  assert.throws(() =>
    restorePreflight(file, { ...report, databaseSha256: "0".repeat(64) }),
  );
  assert.throws(() =>
    restorePreflight(file, {
      ...report,
      schemaCompatibility: { fingerprint: "forged" },
    }),
  );
  assert.throws(() =>
    restorePreflight(file, report, { expectedConfigDigest: null }),
  );
  assert.throws(() =>
    restorePreflight(file, report, {
      expectedBuildId: "development-unrecorded",
    }),
  );
  assert.throws(() =>
    restorePreflight(file, {
      ...report,
      schemaCompatibility: { ...report.schemaCompatibility, coreVersion: 99 },
    }),
  );
  assert.throws(() =>
    restorePreflight(file, {
      ...report,
      schemaCompatibility: {
        ...report.schemaCompatibility,
        moduleVersions: { future: 99 },
      },
    }),
  );
  assert.equal(sha(file), before);
  const rehearsal = JSON.parse(
    execFileSync(
      process.execPath,
      [
        resolve("deploy/rehearse-restore.mjs"),
        app,
        destination,
        "--config-sha256=" + config,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  assert.equal(rehearsal.status, "ok");
  assert.equal(rehearsal.compatibility.compatible, true);
  assert.equal(rehearsal.compatibility.configurationVerified, true);
  assert.equal(rehearsal.liveApplicationStateChanged, false);
  assert.equal(rehearsal.chainReconciliationPerformed, false);
  assert.equal(sha(file), before);
});

test("active WAL preflight sees a future committed version without touching source DB/WAL/SHM", (t) => {
  const path = join(temp(t), "active.sqlite"),
    db = openDatabase(path);
  t.after(() => db.close());
  db.exec("UPDATE questlayer_schema_modules SET version=99 WHERE name='core'");
  const files = [path, path + "-wal", path + "-shm"],
    before = files.map(sha);
  assert.throws(() => openDatabase(path), /future/);
  assert.deepEqual(files.map(sha), before);
});

test("a concurrent last writer checkpoint between WAL discovery and copy retries cleanly", async (t) => {
  const fs = await import("node:fs"),
    { syncBuiltinESMExports } = await import("node:module");
  const path = join(temp(t), "checkpoint.sqlite"),
    db = openDatabase(path);
  createPlayer(db, "Committed WAL player");
  const original = fs.default.copyFileSync,
    temporaryDirectories = [];
  let checkpointed = false;
  t.mock.method(
    fs.default,
    "copyFileSync",
    function (source, destination, ...rest) {
      temporaryDirectories.push(resolve(destination, ".."));
      if (String(source).endsWith("-wal") && !checkpointed) {
        checkpointed = true;
        db.close();
      }
      return original.call(this, source, destination, ...rest);
    },
  );
  syncBuiltinESMExports();
  try {
    assert.equal(preflightDatabase(path).coreVersion, 1);
    assert.equal(checkpointed, true);
    for (const directory of temporaryDirectories)
      assert.equal(fs.existsSync(directory), false);
    const read = new DatabaseSync(path, { readOnly: true });
    assert.equal(read.prepare("SELECT count(*) n FROM players").get().n, 1);
    read.close();
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (db.isOpen) db.close();
  }
});

test("known legacy shape with a foreign application ID is rejected without DB/WAL/SHM mutation", (t) => {
  const directory = temp(t),
    path = join(directory, "foreign-application.sqlite");
  const db = legacy(path, KNOWN.core.at(-1));
  t.after(() => db.close());
  assert.equal(db.prepare("PRAGMA application_id").get().application_id, 0);
  assert.equal(preflightDatabase(path).legacy, KNOWN.core.at(-1).revision);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA application_id=123456789");
  const names = readdirSync(directory).sort();
  const files = [path, path + "-wal", path + "-shm"],
    before = files.map(sha);
  assert.throws(
    () => openDatabase(path),
    (error) =>
      error.code === "SCHEMA_INCOMPATIBLE" &&
      /application identifier/.test(error.message),
  );
  assert.deepEqual(files.map(sha), before);
  assert.deepEqual(readdirSync(directory).sort(), names);
  assert.equal(
    db.prepare("PRAGMA application_id").get().application_id,
    123456789,
  );
});

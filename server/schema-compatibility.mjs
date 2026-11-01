import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  openSync,
  readSync,
  closeSync,
  existsSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { createHash } from "node:crypto";
const known = JSON.parse(
  readFileSync(new URL("./schema-known.json", import.meta.url), "utf8"),
);
const registry = new Map();
const LEDGER = "questlayer_schema_modules";
const LEDGER_SQL = `CREATE TABLE IF NOT EXISTS questlayer_schema_modules(name TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version>0),fingerprint TEXT NOT NULL)`;
export const CORE_SCHEMA_VERSION = 1;
const fail = (message) => {
  const error = new Error(message);
  error.code = "SCHEMA_INCOMPATIBLE";
  throw error;
};
const normalize = (sql) => {
  const strings = [];
  return sql
    .replace(/'(?:[^']|'')*'/g, (v) => `__literal${strings.push(v) - 1}__`)
    .replace(/\bif\s+not\s+exists\b/gi, "")
    .replace(/[\s"`\[\]]/g, "")
    .toLowerCase()
    .replace(/__literal(\d+)__/g, (_, i) => strings[Number(i)])
    .replace(/;$/, "");
};
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const shape = (tables) =>
  Object.fromEntries(
    Object.entries(tables)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sql]) => [name, normalize(sql)]),
  );
const tableRows = (db) =>
  db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
const latest = known.core.at(-1),
  coreNames = new Set(known.core.flatMap((x) => Object.keys(x.tables)));
// schema-known.json may record several versions of one module; the newest is
// current and older ones stay recognizable so backups and not-yet-upgraded
// databases still pass preflight.
const newest = (list) => {
  const out = new Map();
  for (const m of list)
    if (!out.has(m.name) || out.get(m.name).version < m.version)
      out.set(m.name, m);
  return out;
};
const knownCurrent = newest(known.optional);
const olderVersions = (name, version) =>
  known.optional.filter((m) => m.name === name && m.version < version);
const modules = () => [...new Map([...knownCurrent, ...registry]).values()];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let savepoint = 0;
function transaction(db, work) {
  const name = `questlayer_schema_${++savepoint}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const value = work();
    db.exec(`RELEASE ${name}`);
    return value;
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
    throw error;
  }
}
// An upgrade step may only rewrite constraint text inside a module's own
// CREATE TABLE statements (for example widening a CHECK). Each step is proven
// at registration, without IO: applying its replacements to the recorded older
// shape must yield exactly the current shape, and indexes may not change.
// Steps run by rebuilding the table inside the owning transaction (see
// applyUpgrade); rows are copied unchanged, so data rewrites stay separate
// reviewed work.
function checkUpgrades(name, version, tables, indexes, upgrades) {
  if (!Array.isArray(upgrades) || upgrades.length > 8)
    fail("Invalid module upgrade list.");
  return upgrades.map(({ from, loosen }) => {
    const old = known.optional.find(
      (x) => x.name === name && x.version === from,
    );
    if (!old || !(from < version) || !loosen || typeof loosen !== "object")
      fail("Module upgrade must start from a recorded older version.");
    if (!same(Object.keys(old.tables).sort(), Object.keys(tables).sort()))
      fail("Module upgrade cannot add or remove tables.");
    if (!same(shape(old.indexes || {}), shape(indexes)))
      fail("Module upgrade cannot change indexes.");
    const edits = {};
    for (const [table, sql] of Object.entries(old.tables)) {
      let next = sql;
      const pairs = loosen[table] || [];
      for (const pair of pairs) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== "string" ||
          typeof pair[1] !== "string" ||
          !/^CHECK\(/.test(pair[0]) ||
          !/^CHECK\(/.test(pair[1]) ||
          next.split(pair[0]).length !== 2
        )
          fail("Module upgrade edits must replace one CHECK clause each.");
        next = next.replace(pair[0], pair[1]);
      }
      if (normalize(next) !== normalize(tables[table]))
        fail("Module upgrade does not produce the declared shape.");
      if (pairs.length) edits[table] = pairs.map((p) => [...p]);
    }
    if (Object.keys(loosen).some((t) => !Object.hasOwn(old.tables, t)))
      fail("Module upgrade names a table the module does not own.");
    return Object.freeze({
      from,
      old: old.tables,
      fingerprint: digest(shape(old.tables)),
      edits,
    });
  });
}
export function registerModuleSchema({ name, version, sql, upgrades = [] }) {
  if (
    name === "core" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof sql !== "string" ||
    sql.length > 100000
  )
    fail("Invalid module schema definition.");
  const statements = sql
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    !statements.length ||
    statements.some(
      (s) =>
        !/^CREATE\s+(?:(?:UNIQUE\s+)?INDEX|TABLE)\s+IF\s+NOT\s+EXISTS\s+[a-z_][a-z0-9_]*\b/i.test(
          s,
        ),
    )
  )
    fail(
      "Module schema must contain additive CREATE TABLE/INDEX statements only.",
    );
  const memory = new DatabaseSync(":memory:");
  let tables;
  try {
    for (const s of statements.filter((x) => /^CREATE\s+TABLE/i.test(x)))
      memory.exec(s);
    tables = Object.fromEntries(tableRows(memory).map((r) => [r.name, r.sql]));
  } finally {
    memory.close();
  }
  if (!Object.keys(tables).length) fail("Module schema must own tables.");
  const indexes = Object.fromEntries(
    statements
      .filter((s) => /^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(s))
      .map((s) => [
        s.match(/INDEX\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/i)[1],
        s,
      ]),
  );
  const recorded = known.optional.filter((x) => x.name === name);
  if (recorded.length && !recorded.some((x) => x.version === version))
    fail("Module schema version is not recorded in schema-known.json.");
  const definition = Object.freeze({
    name,
    version,
    sql,
    tables: Object.freeze(tables),
    indexes: Object.freeze(indexes),
    fingerprint: digest(shape(tables)),
    upgrades: Object.freeze(
      checkUpgrades(name, version, tables, indexes, upgrades),
    ),
  });
  const existing =
    registry.get(name) || recorded.find((x) => x.version === version);
  if (
    existing &&
    (existing.version !== version ||
      !same(shape(existing.tables), shape(tables)) ||
      !same(shape(existing.indexes || {}), shape(indexes)))
  )
    fail("Conflicting module schema registration.");
  for (const other of modules())
    if (
      other.name !== name &&
      Object.keys(tables).some(
        (t) => Object.hasOwn(other.tables, t) || coreNames.has(t),
      )
    )
      fail("Module tables overlap another owner.");
  registry.set(name, definition);
  return definition;
}
function moduleStates(actual) {
  const found = [];
  for (const definition of modules()) {
    const names = Object.keys(definition.tables),
      present = names.filter((n) => Object.hasOwn(actual, n));
    if (!present.length) continue;
    const matches = (tables) =>
      present.length === names.length &&
      present.every((n) => normalize(actual[n]) === normalize(tables[n]));
    const match = [
      definition,
      ...olderVersions(definition.name, definition.version).reverse(),
    ].find((candidate) => matches(candidate.tables));
    if (!match) fail(`Unsupported ${definition.name} table shape.`);
    found.push({
      ...match,
      fingerprint: match.fingerprint || digest(shape(match.tables)),
    });
  }
  return found;
}
export function inspectDatabaseSchema(db) {
  // All supported historical/current baselines use SQLite's unstamped ID 0.
  // A different application stamp requires a separately reviewed migration.
  if (db.prepare("PRAGMA application_id").get().application_id !== 0)
    fail("Unsupported database application identifier.");
  const integrity = db.prepare("PRAGMA integrity_check(1)").get();
  if (Object.values(integrity)[0] !== "ok")
    fail("SQLite integrity check failed.");
  const actual = Object.fromEntries(tableRows(db).map((r) => [r.name, r.sql]));
  const userVersion = db.prepare("PRAGMA user_version").get().user_version;
  if (userVersion !== 0 && userVersion !== CORE_SCHEMA_VERSION)
    fail("Unsupported database user version.");
  const names = Object.keys(actual).filter((n) => n !== LEDGER);
  if (!names.length) {
    if (actual[LEDGER] || userVersion) fail("Incomplete schema ledger.");
    return {
      coreVersion: 0,
      legacy: "empty",
      modules: [],
      recordedModuleVersions: {},
      fingerprint: digest({}),
    };
  }
  const core = Object.fromEntries(
    Object.entries(actual).filter(([n]) => coreNames.has(n)),
  );
  const baseline = known.core.find((v) => same(shape(core), shape(v.tables)));
  if (!baseline) fail("Database is not a supported QuestLayer core baseline.");
  const detected = moduleStates(actual),
    allowed = new Set([
      ...coreNames,
      LEDGER,
      ...modules().flatMap((m) => Object.keys(m.tables)),
    ]);
  if (names.some((n) => !allowed.has(n))) fail("Unrecognized database table.");
  const unsupported = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='view' OR type='trigger'",
    )
    .all();
  if (unsupported.length) fail("Unrecognized persistent view or trigger.");
  const actualIndexes = Object.fromEntries(
    db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name",
      )
      .all()
      .map((r) => [r.name, r.sql]),
  );
  const expectedIndexes = Object.assign(
    {},
    baseline.indexes,
    ...detected.map((m) => m.indexes || {}),
  );
  if (!same(shape(actualIndexes), shape(expectedIndexes)))
    fail("Missing, altered or unrecognized schema index.");
  const ledger = actual[LEDGER];
  if (ledger) {
    if (normalize(ledger) !== normalize(LEDGER_SQL))
      fail("Invalid schema ledger shape.");
    const rows = db.prepare(`SELECT * FROM ${LEDGER}`).all();
    const expected = [
      {
        name: "core",
        version: CORE_SCHEMA_VERSION,
        fingerprint: digest(shape(latest.tables)),
      },
      ...detected,
    ];
    if (!rows.some((r) => r.name === "core") || baseline !== latest)
      fail("Versioned core shape is incomplete.");
    for (const row of rows) {
      const def = expected.find((x) => x.name === row.name);
      if (
        !def ||
        row.version !== def.version ||
        row.fingerprint !== def.fingerprint
      )
        fail("Unknown future, altered or missing module version.");
    }
  } else if (userVersion !== 0) fail("Missing schema ledger.");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    fail("Database foreign-key integrity failed.");
  return {
    coreVersion: ledger ? CORE_SCHEMA_VERSION : 0,
    legacy: ledger ? null : baseline.revision,
    recordedModuleVersions: ledger
      ? Object.fromEntries(
          db
            .prepare(
              `SELECT name,version FROM ${LEDGER} WHERE name!='core' ORDER BY name`,
            )
            .all()
            .map((r) => [r.name, r.version]),
        )
      : {},
    modules: detected.map((m) => ({
      name: m.name,
      version: m.version,
      fingerprint: m.fingerprint,
    })),
    fingerprint: digest(shape(actual)),
  };
}
export function preflightDatabase(path) {
  // A last writer may checkpoint/remove WAL between discovery and copying.
  // Retry a bounded private snapshot, never open the original in mutable mode.
  for (let attempt = 0; attempt < 3; attempt++) {
    let directory,
      db,
      file = resolve(path),
      hadWal = false;
    try {
      hadWal = existsSync(file + "-wal");
      if (hadWal) {
        directory = mkdtempSync(join(tmpdir(), "questlayer-preflight-"));
        const copied = join(directory, "database.sqlite");
        copyFileSync(file, copied);
        chmodSync(copied, 0o600);
        copyFileSync(file + "-wal", copied + "-wal");
        chmodSync(copied + "-wal", 0o600);
        file = copied;
      }
      db = new DatabaseSync(
        directory ? file : pathToFileURL(file).href + "?immutable=1",
        { readOnly: true },
      );
      return inspectDatabaseSchema(db);
    } catch (error) {
      if (attempt === 2 || !(error.code === "ENOENT" || hadWal)) throw error;
    } finally {
      db?.close();
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  }
}
export function recordSchemaVersions(db) {
  return transaction(db, () => {
    const actual = Object.fromEntries(
      tableRows(db).map((r) => [r.name, r.sql]),
    );
    const detected = moduleStates(actual);
    const definitions = [
      {
        name: "core",
        version: CORE_SCHEMA_VERSION,
        fingerprint: digest(shape(latest.tables)),
      },
      ...detected,
    ];
    if (actual[LEDGER]) {
      if (normalize(actual[LEDGER]) !== normalize(LEDGER_SQL))
        fail("Invalid schema ledger shape.");
      for (const row of db.prepare(`SELECT * FROM ${LEDGER}`).all()) {
        const expected = definitions.find((d) => d.name === row.name);
        if (
          !expected ||
          row.version !== expected.version ||
          row.fingerprint !== expected.fingerprint
        )
          fail("Unknown future or altered module version.");
      }
    }
    db.exec(LEDGER_SQL);
    const get = db.prepare(`SELECT version FROM ${LEDGER} WHERE name=?`),
      put = db.prepare(`INSERT INTO ${LEDGER} VALUES(?,?,?)`);
    for (const definition of definitions)
      if (!get.get(definition.name))
        put.run(definition.name, definition.version, definition.fingerprint);
    if (
      db.prepare("PRAGMA user_version").get().user_version !==
      CORE_SCHEMA_VERSION
    )
      db.exec(`PRAGMA user_version=${CORE_SCHEMA_VERSION}`);
  });
}
// Rebuilds each edited table with ordinary SQL so it also works when SQLite's
// defensive mode forbids writable_schema (Node 24 default): copy rows aside,
// drop, recreate from the proven definition, copy back. Foreign keys stay
// enforced but deferred to the owning transaction's commit, and re-inserting
// the parent rows satisfies the children again. A table that another table
// references with an ON DELETE/UPDATE action is refused, because the drop
// would fire it. Callers verify the final shape afterwards.
function applyUpgrade(db, step, definition) {
  const tables = tableRows(db).map((r) => r.name);
  for (const table of Object.keys(step.edits))
    for (const other of tables)
      for (const fk of db.prepare(`PRAGMA foreign_key_list("${other}")`).all())
        if (
          fk.table === table &&
          (fk.on_delete !== "NO ACTION" || fk.on_update !== "NO ACTION")
        )
          fail(
            "Module upgrade cannot rebuild a table with referential actions.",
          );
  const deferred = db
    .prepare("PRAGMA defer_foreign_keys")
    .get().defer_foreign_keys;
  db.exec("PRAGMA defer_foreign_keys=ON");
  try {
    for (const table of Object.keys(step.edits)) {
      const aside = `questlayer_upgrade_${table}`;
      const before = db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n;
      db.exec(`CREATE TEMP TABLE "${aside}" AS SELECT * FROM main."${table}"`);
      db.exec(`DROP TABLE main."${table}"`);
      db.exec(definition.tables[table]);
      db.exec(`INSERT INTO main."${table}" SELECT * FROM temp."${aside}"`);
      db.exec(`DROP TABLE temp."${aside}"`);
      if (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n !== before)
        fail("Module upgrade changed the number of stored rows.");
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      fail("Database foreign-key integrity failed after module upgrade.");
  } finally {
    db.exec(`PRAGMA defer_foreign_keys=${deferred ? "ON" : "OFF"}`);
  }
  const integrity = db.prepare("PRAGMA integrity_check(1)").get();
  if (Object.values(integrity)[0] !== "ok")
    fail("SQLite integrity check failed after module upgrade.");
}
export function ensureModuleVersion(db, definition) {
  if (registry.get(definition.name) !== definition)
    fail("Register the module schema before initialization.");
  const actual = Object.fromEntries(tableRows(db).map((r) => [r.name, r.sql]));
  const row = actual[LEDGER]
    ? db.prepare(`SELECT * FROM ${LEDGER} WHERE name=?`).get(definition.name)
    : null;
  const names = Object.keys(definition.tables),
    present = names.filter((n) => Object.hasOwn(actual, n));
  if (present.length && present.length !== names.length)
    fail("Incomplete existing module.");
  const step =
    present.length &&
    definition.upgrades.find((u) =>
      names.every((n) => normalize(actual[n]) === normalize(u.old[n])),
    );
  if (step) {
    if (
      row &&
      (row.version !== step.from || row.fingerprint !== step.fingerprint)
    )
      fail("Unknown future or altered module version.");
    return transaction(db, () => {
      inspectDatabaseSchema(db);
      applyUpgrade(db, step, definition);
      if (row)
        db.prepare(
          `UPDATE ${LEDGER} SET version=?,fingerprint=? WHERE name=? AND version=?`,
        ).run(
          definition.version,
          definition.fingerprint,
          definition.name,
          step.from,
        );
      const after = Object.fromEntries(
        tableRows(db).map((r) => [r.name, r.sql]),
      );
      if (
        names.some(
          (n) => normalize(after[n]) !== normalize(definition.tables[n]),
        )
      )
        fail("Module upgrade did not reach its declared version.");
      recordSchemaVersions(db);
      inspectDatabaseSchema(db);
      return definition.version;
    });
  }
  if (
    present.some(
      (n) => normalize(actual[n]) !== normalize(definition.tables[n]),
    )
  )
    fail("Existing module does not match its declared version.");
  if (row) {
    for (const [name, sql] of Object.entries(definition.indexes || {})) {
      const index = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?")
        .get(name);
      if (!index || normalize(index.sql) !== normalize(sql))
        fail("Missing or altered module index.");
    }

    if (
      row.version !== definition.version ||
      row.fingerprint !== definition.fingerprint ||
      present.length !== names.length
    )
      fail("Unknown future or incomplete module version.");
    return definition.version;
  }
  return transaction(db, () => {
    inspectDatabaseSchema(db);
    db.exec(definition.sql);
    recordSchemaVersions(db);
    return definition.version;
  });
}
export function schemaStatus(
  db,
  { buildId = process.env.QUESTLAYER_BUILD_ID } = {},
) {
  const recorded =
    typeof buildId === "string" &&
    buildId !== "development-unrecorded" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(buildId);
  const rows = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(LEDGER)
    ? db.prepare(`SELECT name,version FROM ${LEDGER} ORDER BY name`).all()
    : [];
  return {
    source: {
      buildId: recorded ? buildId : "development-unrecorded",
      recorded,
    },
    schema: {
      coreVersion: rows.find((r) => r.name === "core")?.version || 0,
      modules: Object.fromEntries(
        rows
          .filter((r) => r.name !== "core")
          .slice(0, 32)
          .map((r) => [r.name, r.version]),
      ),
    },
  };
}
function fileDigest(path) {
  const hash = createHash("sha256"),
    buffer = Buffer.alloc(1024 * 1024),
    fd = openSync(path, "r");
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}
export function restorePreflight(
  path,
  metadata,
  { expectedConfigDigest, expectedBuildId } = {},
) {
  if (
    !metadata ||
    metadata.application !== "QuestLayer" ||
    metadata.format !== 1 ||
    metadata.integrity !== "ok"
  )
    fail("Unsupported backup manifest.");
  const validBuild = (value) =>
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value);
  if (
    metadata.sourceBuildId !== undefined &&
    !validBuild(metadata.sourceBuildId)
  )
    fail("Invalid snapshot source identifier.");
  if (
    expectedBuildId !== undefined &&
    (!validBuild(expectedBuildId) ||
      expectedBuildId === "development-unrecorded")
  )
    fail("A reviewed source identifier is required.");
  if (
    expectedConfigDigest !== undefined &&
    (typeof expectedConfigDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedConfigDigest))
  )
    fail("A reviewed public configuration digest is required.");
  if (
    metadata.publicConfigDigest !== undefined &&
    metadata.publicConfigDigest !== null &&
    (typeof metadata.publicConfigDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(metadata.publicConfigDigest))
  )
    fail("Invalid snapshot public configuration digest.");
  if (
    typeof metadata.databaseSha256 !== "string" ||
    metadata.databaseSha256 !== fileDigest(path)
  )
    fail("Backup database checksum does not match.");
  if (
    expectedConfigDigest !== undefined &&
    metadata.publicConfigDigest !== expectedConfigDigest
  )
    fail("Restore public configuration does not match.");
  if (
    expectedBuildId !== undefined &&
    metadata.sourceBuildId !== expectedBuildId
  )
    fail("Restore source identifier does not match.");
  const schema = preflightDatabase(path);
  if (
    metadata.schemaCompatibility &&
    (metadata.schemaCompatibility.fingerprint !== schema.fingerprint ||
      metadata.schemaCompatibility.coreVersion !== schema.coreVersion ||
      !same(
        metadata.schemaCompatibility.moduleVersions,
        schema.recordedModuleVersions,
      ))
  )
    fail("Backup schema fingerprint does not match its manifest.");
  return {
    compatible: true,
    schema,
    source: metadata.sourceBuildId || "legacy-unrecorded",
    sourceVerified: expectedBuildId !== undefined,
    configurationVerified: expectedConfigDigest !== undefined,
  };
}

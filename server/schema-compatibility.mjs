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
const modules = () => [
  ...new Map(
    [...known.optional, ...registry.values()].map((m) => [m.name, m]),
  ).values(),
];
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
export function registerModuleSchema({ name, version, sql }) {
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
  const definition = Object.freeze({
    name,
    version,
    sql,
    tables: Object.freeze(tables),
    indexes: Object.freeze(indexes),
    fingerprint: digest(shape(tables)),
  });
  const existing =
    registry.get(name) || known.optional.find((x) => x.name === name);
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
    if (
      present.length !== names.length ||
      present.some(
        (n) => normalize(actual[n]) !== normalize(definition.tables[n]),
      )
    )
      fail(`Unsupported ${definition.name} table shape.`);
    found.push({
      ...definition,
      fingerprint: definition.fingerprint || digest(shape(definition.tables)),
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

# W00 core/module schema and restore compatibility

31 October 2026. Local implementation and isolated tests only. No normal project
database, production host, RPC, signing capability or chain transaction was used.
This is a bounded SQLite compatibility boundary, not PostgreSQL/PostGIS migration,
offsite recovery or a passed W00/W13 release gate.

## Implemented boundary

`server/database.mjs` now preflights an existing database before any target
bootstrap DDL, seed or PRAGMA mutation. It recognizes six genuine unversioned core
schemas frozen from repository commits `a889641`, `4043f52`, `9d90a25`, `5405fbd`,
`20dc5bd` and `1907d3b`. `server/schema-known.json` contains their exact normalized
table/index definitions plus explicit supported optional-module definitions. It
does not accept an arbitrary database merely because one table is called players.

Unknown future user/core/module versions, unknown tables, partial modules, altered
columns/constraints/indexes, persistent views/triggers, corrupt SQLite and invalid
foreign-key relationships fail closed. Versioned core schema is version 1. The
`questlayer_schema_modules` ledger records module version and a schema fingerprint;
it contains no player content, paths, credentials or reward amounts. Existing
supported optional schemas are recorded as metadata, without rewriting business
rows. A module version is not permission to enable that feature.

Known legacy bootstrap runs as one write transaction, including its existing
additive upgrades, original demo seed and schema-version adoption. An injected
failure after preceding DDL/seed statements rolls the whole upgrade back. Schema
is checked again after acquiring the write transaction, preventing a stale
preflight from silently accepting a newer schema. WAL mode is set after a
successful commit. Existing economic/XP/ownership rules and legacy catalog
translation behavior are unchanged.

## Optional module API

```js
const definition = registerModuleSchema({ name: "feature-name", version: 1, sql });
ensureModuleVersion(db, definition);
```

Registration validates additive CREATE TABLE/INDEX declarations in memory and does
no target-database initialization. Initialization validates its declared shape,
then atomically applies DDL/version adoption using a savepoint, including when
nested inside the owning settlement transaction. A verified current module is a
no-write fast path. There is no WeakMap initialized flag that could survive a
rolled-back transaction. Future migrations require an explicit reviewed definition;
unknown versions are not automatically downgraded or coerced.

Adventure results and creator completion declare their own schemas through this
API. Their declared v1 shapes are also in central recognition so standalone
operators/workers can reopen a compatible database without importing every feature.
`schema-catalog.mjs` loads current feature declarations for restore validation.
Creator default-off still creates no creator tables. `recordSchemaVersions(db)`
records known optional constructors after application bootstrap; the coordinator
wires that call and the health projection in `server/index.mjs`.

`schemaStatus(db,{buildId})` returns bounded source/core/module metadata. A reviewed
`QUESTLAYER_BUILD_ID` or explicit build ID is shown as recorded; absent/invalid input
shows `development-unrecorded`. Git HEAD is not substituted for dirty working-tree
source identity. No local path, session, secret or contract key is exposed.

## Read-only source and WAL findings

Opening a WAL database with SQLite's ordinary read-only mode can create WAL/SHM
sidecars. Closed-file preflight therefore uses immutable reads. When WAL exists,
preflight reads a private copied database/WAL pair, so read locks/index rebuilding
touch only the temporary copy. Temporary copies are removed on all outcomes.

A concurrent last writer can checkpoint/remove WAL between existence checking and
copying. A real independent-result-worker test exposed that race. Preflight now
retries up to three private snapshots for transient WAL/copy failures, then fails
closed rather than accepting an uncertain snapshot. The actual writable open also
revalidates under its transaction. A deterministic regression checkpoints exactly
between the database and WAL copies and verifies retry, data preservation and no
temporary-directory leak. A separate future-version-in-WAL case verifies original
database, WAL and SHM hashes remain unchanged when rejected.

## Backup and isolated restore

The existing Python private backup keeps its database checksum, private file modes,
media/key handling, atomic completion and retention. Metadata additionally records
schema/module identity and fingerprint, `--build-id` (default
`development-unrecorded`) and optional `--config-sha256` of reviewed **public**
configuration. It neither loads runtime.env nor publishes configuration contents.

`restorePreflight(path,metadata,{expectedBuildId,expectedConfigDigest})` validates
the database checksum, supported manifest/schema and any supplied source/config
constraints before application bootstrap mutates a restored copy. A mismatched
expected source/config digest fails. `deploy/rehearse-restore.mjs` invokes this on
the untouched source snapshot before opening its isolated working copy; optional
`--config-sha256=<64 hex characters>` enforces the recorded public configuration.

Older snapshots without recorded build/config identity remain schema-compatible
when their frozen layout is supported, but explicitly return `sourceVerified:false`
and `configurationVerified:false`. No match is invented. A full restored-host
activation still requires reviewed actual configuration and native-chain/privacy
reconciliation. This tool performs an isolated-copy rehearsal, never activation,
live replacement, rollback of chain effects or automatic retransmission.

## Verification

- [`schema-tests.txt`](schema-tests.txt): **15/15 passed**, covering all six real
  legacy baselines, retained rows/amounts, no creator initialization, foreign/
  corrupt/future/altered/unknown-index inputs, unchanged rejected files/sidecars,
  interrupted upgrade/rollback/retry, nested module rollback and pure registration,
  exact module adoption, actual private backup/restore CLI, checksum/config/source
  mismatch, active WAL and concurrent checkpoint cleanup.
- [`full-suite-integration.txt`](full-suite-integration.txt): integration baseline
  **473/474 passed**. Its sole failure was an older test treating intentional new
  schema-metadata rows as changed business data. That assertion was corrected with
  coordinator authorization: every business table remains unchanged, and the exact
  seven expected core/social/creator version rows plus fingerprints are explicitly
  asserted. [`metadata-adoption-regression.txt`](metadata-adoption-regression.txt)
  records that previously failing scenario passing. The coordinator runs the
  canonical final combined suite after remaining UI changes.
- Adventure owner subsequently verified **41/41** focused result/selection cases,
  including independent concurrent result recovery and reopen after the WAL fix.
- `git diff --check` passed. No new dependencies or contract changes.

Full-host/offsite recovery, PostgreSQL concurrency, every financial incident,
post-snapshot deletion replay and real-device/account recovery remain separate
roadmap work. These schema checks do not establish physical completion, change
native policy or convert demo balances into real funds.

## Application identifier follow-up

The final review reproduced acceptance of an otherwise known schema carrying a
foreign nonzero SQLite `application_id`. All supported historical/current
baselines use ID 0; no legitimate nonzero stamp or migration was found. Preflight
now rejects every nonzero application identifier before integrity/bootstrap work,
without assigning a new identifier or introducing a stamp migration.
[`application-id-regression.txt`](application-id-regression.txt) records **16/16
schema tests passed**. The new genuine-legacy-shape regression commits the foreign
ID in active WAL and verifies unchanged database/WAL/SHM hashes and directory
contents after rejection. The coordinator reruns the full suite after this bounded
guard; the previous final combined run was 479/479 before this new test.

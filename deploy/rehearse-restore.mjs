// Opens an isolated private copy with the current app schema. Never restores live state.
import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  mkdtempSync,
  chmodSync,
  rmSync,
  existsSync,
  createReadStream,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, createPrivateKey } from "node:crypto";
const app = resolve(process.argv[2] || "/opt/ps3000/apps/auratrail"),
  root = resolve(process.argv[3] || join(app, "state-backups"));
assert.equal(root, join(app, "state-backups"));
assert.equal(statSync(root).mode & 0o077, 0);
const entries = readdirSync(root)
  .filter((name) => /^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(name))
  .sort()
  .reverse();
assert.ok(entries.length, "No completed snapshot");
const snapshot = join(root, entries[0]),
  metadata = JSON.parse(readFileSync(join(snapshot, "metadata.json"))),
  file = join(snapshot, "database.sqlite");
assert.equal(metadata.application, "QuestLayer");
assert.equal(metadata.integrity, "ok");
assert.equal(statSync(snapshot).mode & 0o077, 0);
assert.equal(statSync(file).mode & 0o077, 0);
const digest = createHash("sha256");
for await (const chunk of createReadStream(file)) digest.update(chunk);
assert.equal(digest.digest("hex"), metadata.databaseSha256);
let attestorValid = false;
for (const media of metadata.referencedMedia || []) {
  assert.match(media.file, /^image_[a-f0-9-]{1,80}\.jpg$/);
  const image = join(snapshot, "media", media.file);
  assert.equal(statSync(image).mode & 0o077, 0);
  assert.equal(
    createHash("sha256").update(readFileSync(image)).digest("hex"),
    media.sha256,
  );
}
if (metadata.awardAttestorIncluded) {
  const keyFile = join(snapshot, "award-attestor.pem");
  assert.equal(statSync(keyFile).mode & 0o077, 0);
  assert.equal(
    createPrivateKey(readFileSync(keyFile)).asymmetricKeyType,
    "ed25519",
  );
  attestorValid = true;
}
const temporary = mkdtempSync(join(root, ".restore-rehearsal-"));
chmodSync(temporary, 0o700);
let db;
try {
  const copy = join(temporary, "database.sqlite");
  assert.notEqual(copy, resolve("/var/lib/auratrail/auratrail.sqlite"));
  copyFileSync(file, copy);
  chmodSync(copy, 0o600);
  const { openDatabase, playerView } = await import(
    pathToFileURL(join(app, "current", "server", "database.mjs")).href
  );
  db = openDatabase(copy);
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  const names = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name),
    ),
    counts = {};
  for (const table of [
    "players",
    "wallet_links",
    "inventory",
    "native_awards",
    "history",
    "world_jobs",
    "world_blueprints",
  ]) {
    if (names.has(table))
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  }
  const first = db.prepare("SELECT id FROM players LIMIT 1").get();
  let projectionVerified = false;
  if (first) {
    const profile = playerView(db, first.id);
    assert.equal(profile.id, first.id);
    assert.ok(Array.isArray(profile.inventory));
    projectionVerified = true;
    db.exec("BEGIN");
    db.prepare("UPDATE players SET xp=xp+1 WHERE id=?").run(first.id);
    db.exec("ROLLBACK");
  }
  db.close();
  db = null;
  console.log(
    JSON.stringify({
      verifiedAt: new Date().toISOString(),
      status: "ok",
      snapshot: metadata.snapshotId,
      checksumMatches: true,
      privatePermissionsVerified: true,
      attestorValid,
      referencedMediaVerified: (metadata.referencedMedia || []).length,
      currentAppSchemaOpened: true,
      playerProjectionVerified: projectionVerified,
      isolatedWriteAndRollbackVerified: !!first,
      tableCounts: counts,
      liveApplicationStateChanged: false,
      chainReconciliationPerformed: false,
      offsiteCopyCreated: false,
    }),
  );
} finally {
  db?.close();
  if (existsSync(temporary))
    rmSync(temporary, { recursive: true, force: true });
}

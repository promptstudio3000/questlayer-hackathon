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
const app = resolve(process.argv[2] || "/opt/ps3000/apps/questlayer-hackathon"),
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
// Validate the untouched source before any application bootstrap can migrate it.
const schemaApi = await import(
  pathToFileURL(join(app, "current", "server", "schema-compatibility.mjs")).href
);
const catalog = join(app, "current", "server", "schema-catalog.mjs");
if (existsSync(catalog)) await import(pathToFileURL(catalog).href);
const expectedConfigDigest = process.argv
  .find((a) => a.startsWith("--config-sha256="))
  ?.slice("--config-sha256=".length);
const compatibility = schemaApi.restorePreflight(file, metadata, {
  expectedConfigDigest,
});
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
  assert.notEqual(copy, resolve("/var/lib/questlayer-hackathon/questlayer-hackathon.sqlite"));
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
    "native_days",
    "native_reward_claims",
    "native_progress",
    "native_enrollments",
    "native_vault_jobs",
    "social_note_meta",
    "social_note_operations",
    "social_media_retirements",
    "social_blocks",
    "social_reports",
    "social_audit",
  ]) {
    if (names.has(table))
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  }
  let socialRecovery = null;
  if (names.has("social_note_meta")) {
    const deleted = db
      .prepare("SELECT COUNT(*) n FROM social_note_meta WHERE state='deleted'")
      .get().n;
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) n FROM messages m JOIN social_note_meta s ON s.note_id=m.id
      WHERE s.state='deleted' AND (m.text!='' OR m.lat!=0 OR m.lng!=0 OR m.image IS NOT NULL OR m.author_fix IS NOT NULL)`,
        )
        .get().n,
      0,
      "Deleted note content reappeared in the restored snapshot",
    );
    socialRecovery = {
      deletedTombstonesVerified: deleted,
      blockRecordsPreserved: counts.social_blocks || 0,
      reportRecordsPreserved: counts.social_reports || 0,
      mediaRetirementsPreserved: counts.social_media_retirements || 0,
      lateDeletionsReplayed: false,
    };
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
  let nativeRecovery = null;
  if (process.argv.includes("--native")) {
    const load = async (relative) =>
      import(pathToFileURL(join(app, "current", relative)).href);
    const config = JSON.parse(
      readFileSync(join(app, "current", "dist", "native-rewards-testnet.json")),
    );
    for (const name of ["reward-attestor.pem", "reward-worker.json"]) {
      assert((metadata.nativeServiceKeysIncluded || []).includes(name));
      assert.equal(statSync(join(snapshot, name)).mode & 0o077, 0);
    }
    const { loadAwardSigner } = await load("server/native/award-vouchers.mjs"),
      signer = loadAwardSigner(join(snapshot, "reward-attestor.pem"));
    assert.equal(signer.publicKey, config.attestor);
    const { createNearProvider } = await load("server/near-provider.mjs"),
      provider = createNearProvider();
    const { rewardTransport, runRewardWorker } = await load(
      "server/native/reward-worker.mjs",
    );
    // Validate the restored restricted key, but never invoke the returned sender.
    await rewardTransport(
      provider,
      config.contractId,
      join(snapshot, "reward-worker.json"),
      config.codeHash,
    );
    const { NativeRewards } = await load("server/native/rewards.mjs"),
      native = new NativeRewards(db, provider, config, signer);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM native_reward_claims WHERE state!='confirmed'",
        )
        .get().n,
      0,
      "Choose a snapshot with a drained queue for this bounded rehearsal",
    );
    const accepted = db
      .prepare(
        "SELECT * FROM native_reward_claims WHERE account_id='questlayer-pilot-20261031.testnet' AND state='confirmed' ORDER BY seq LIMIT 1",
      )
      .get();
    assert(accepted, "Project pilot receipt missing from snapshot");
    db.prepare(
      "UPDATE native_reward_claims SET state='queued',amount=NULL,xp=NULL,transaction_hash=NULL,confirmed_at=NULL,run_after=0 WHERE id=?",
    ).run(accepted.id);
    db.prepare(
      "UPDATE native_worker_lease SET owner=NULL,until_ms=0 WHERE id=1",
    ).run();
    db.prepare("UPDATE native_vault_jobs SET next_check=?").run(
      Date.now() + 86400000,
    );
    let transmissions = 0;
    const result = await runRewardWorker(native, async () => {
      transmissions++;
      throw Error("Chain transmissions are disabled during restore rehearsal");
    });
    assert.equal(transmissions, 0);
    assert.equal(result.completed, 1);
    const recovered = db
      .prepare("SELECT * FROM native_reward_claims WHERE id=?")
      .get(accepted.id);
    assert.equal(recovered.state, "confirmed");
    assert.equal(recovered.amount, accepted.amount);
    assert.equal(recovered.xp, accepted.xp);
    nativeRecovery = {
      restoredAttestorMatches: true,
      restrictedWorkerKeyVerified: true,
      crashBeforeAcknowledgementRecovered: true,
      receiptsReconciled: 1,
      chainTransactionsSent: 0,
      liveDatabaseTouched: false,
    };
  }
  db.close();
  db = null;
  console.log(
    JSON.stringify({
      verifiedAt: new Date().toISOString(),
      status: "ok",
      snapshot: metadata.snapshotId,
      checksumMatches: true,
      compatibility,
      privatePermissionsVerified: true,
      attestorValid,
      referencedMediaVerified: (metadata.referencedMedia || []).length,
      currentAppSchemaOpened: true,
      playerProjectionVerified: projectionVerified,
      isolatedWriteAndRollbackVerified: !!first,
      tableCounts: counts,
      liveApplicationStateChanged: false,
      chainReconciliationPerformed: !!nativeRecovery,
      nativeRecovery,
      socialRecovery,
      offsiteCopyCreated: false,
    }),
  );
} finally {
  db?.close();
  if (existsSync(temporary))
    rmSync(temporary, { recursive: true, force: true });
}

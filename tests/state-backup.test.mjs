import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
const script = resolve("deploy/backup-state.py");
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-backup-")),
    state = join(directory, "state"),
    destination = join(directory, "snapshots");
  mkdirSync(state);
  const database = new DatabaseSync(join(state, "auratrail.sqlite"));
  database.exec(
    "PRAGMA journal_mode=WAL;CREATE TABLE sample(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO sample VALUES(1,'test state');",
  );
  t.after(() => {
    if (database.isOpen) database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const run = () =>
    JSON.parse(
      execFileSync(
        "python3",
        [script, "--state", state, "--destination", destination],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  return { state, destination, database, run };
}
test("consistent WAL snapshots include only private state artifacts and can be reopened", (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.state, "award-attestor.pem"),
    "fixture attestor; not a real key",
  );
  writeFileSync(
    join(f.state, "near-operator.json"),
    "excluded developer credentials fixture",
  );
  const report = f.run(),
    snapshot = join(f.destination, report.snapshotId);
  assert.equal(report.integrity, "ok");
  assert.equal(report.awardAttestorIncluded, true);
  assert.equal(report.playerWalletSigningKeysIncluded, false);
  assert.deepEqual(readdirSync(snapshot).sort(), [
    "award-attestor.pem",
    "database.sqlite",
    "metadata.json",
  ]);
  assert.equal(statSync(f.destination).mode & 0o077, 0);
  assert.equal(statSync(snapshot).mode & 0o077, 0);
  for (const path of readdirSync(snapshot))
    assert.equal(statSync(join(snapshot, path)).mode & 0o077, 0);
  copyFileSync(
    join(snapshot, "database.sqlite"),
    join(f.state, "restore-check.sqlite"),
  );
  const restored = new DatabaseSync(join(f.state, "restore-check.sqlite"));
  assert.equal(
    restored.prepare("SELECT value FROM sample WHERE id=1").get().value,
    "test state",
  );
  restored.exec("INSERT INTO sample VALUES(2,'restore-only change')");
  restored.close();
  assert.equal(
    f.database.prepare("SELECT COUNT(*) AS n FROM sample").get().n,
    1,
  );
});
test("failed snapshots leave a previously verified backup intact and remove pending files", (t) => {
  const f = fixture(t),
    first = f.run();
  f.database.close();
  f.database = null;
  writeFileSync(join(f.state, "auratrail.sqlite"), "not a database");
  assert.throws(f.run);
  const names = readdirSync(f.destination);
  assert.ok(names.includes(first.snapshotId));
  assert.ok(!names.some((n) => n.startsWith(".pending-")));
});
test("retention removes only owned expired snapshots and preserves the newest two", (t) => {
  const f = fixture(t);
  mkdirSync(f.destination, { mode: 0o700 });
  for (let i = 1; i <= 3; i++) {
    const snapshotId = `2000010${i}T000000Z-0000000${i}`,
      path = join(f.destination, snapshotId);
    mkdirSync(path);
    writeFileSync(
      join(path, "metadata.json"),
      JSON.stringify({
        application: "QuestLayer",
        format: 1,
        snapshotId,
        createdAt: `2000-01-0${i}T00:00:00+00:00`,
      }),
    );
  }
  const unknown = join(f.destination, "20000104T000000Z-00000004");
  mkdirSync(unknown);
  writeFileSync(
    join(unknown, "metadata.json"),
    JSON.stringify({ application: "Other project", format: 1 }),
  );
  const report = f.run();
  assert.equal(report.expiredSnapshotsRemoved, 2);
  assert.ok(readdirSync(f.destination).includes("20000103T000000Z-00000003"));
  assert.ok(readdirSync(f.destination).includes("20000104T000000Z-00000004"));
});

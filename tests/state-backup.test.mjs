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
test("referenced note images are privately preserved and unsafe media references fail closed", (t) => {
  const f = fixture(t),
    name = "image_12345678-1234-1234-1234-123456789abc.jpg",
    media = join(f.state, ".data", "media");
  mkdirSync(media, { recursive: true });
  writeFileSync(join(media, name), Buffer.from([255, 216, 255, 217]));
  f.database.exec("CREATE TABLE messages(image TEXT)");
  f.database
    .prepare("INSERT INTO messages(image) VALUES(?)")
    .run(`/api/media/${name}`);
  const report = f.run(),
    image = join(f.destination, report.snapshotId, "media", name);
  assert.equal(report.referencedMedia.length, 1);
  assert.deepEqual(readFileSync(image), readFileSync(join(media, name)));
  assert.equal(statSync(image).mode & 0o077, 0);
  f.database.exec(
    "UPDATE messages SET image='/api/media/../near-operator.json'",
  );
  assert.throws(f.run);
  assert.ok(readdirSync(f.destination).includes(report.snapshotId));
});

test("native attestor and scoped worker key are included privately without becoming player wallet keys", (t) => {
  const f = fixture(t);
  for (const name of ["reward-attestor.pem", "reward-worker.json"])
    writeFileSync(join(f.state, name), "test-only service capability", {
      mode: 0o600,
    });
  const r = f.run();
  const folder = readdirSync(f.destination).find((x) =>
    /^\d{8}T\d{6}Z-/.test(x),
  );
  const metadata = JSON.parse(
    readFileSync(join(f.destination, folder, "metadata.json")),
  );
  assert.deepEqual(metadata.nativeServiceKeysIncluded, [
    "reward-attestor.pem",
    "reward-worker.json",
  ]);
  assert.equal(metadata.playerWalletSigningKeysIncluded, false);
  for (const name of metadata.nativeServiceKeysIncluded)
    assert.equal(statSync(join(f.destination, folder, name)).mode & 0o077, 0);
});

test("the mainnet slice database is snapshotted by name and other names are refused", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-backup-mainnet-")),
    state = join(directory, "state"),
    destination = join(directory, "snapshots");
  mkdirSync(state);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(join(state, "questlayer-mainnet.sqlite"));
  database.exec(
    "CREATE TABLE sample(id INTEGER PRIMARY KEY);INSERT INTO sample VALUES(1);",
  );
  database.close();
  const run = (name) =>
    execFileSync(
      "python3",
      [
        script,
        "--state",
        state,
        "--database-name",
        name,
        "--destination",
        destination,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  const report = JSON.parse(run("questlayer-mainnet.sqlite"));
  assert.equal(report.integrity, "ok");
  const copy = new DatabaseSync(
    join(destination, report.snapshotId, "database.sqlite"),
  );
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM sample").get().n, 1);
  copy.close();
  assert.throws(() => run("../elsewhere.sqlite"), /Unknown state database/);
  // Without the name the testnet default is expected and absent here.
  assert.throws(
    () => run("questlayer-hackathon.sqlite"),
    /regular state database/,
  );
});

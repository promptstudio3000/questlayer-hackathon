import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  openDatabase,
  createPlayer,
  demoProgression,
} from "../server/database.mjs";
import { createCreatorRuntime } from "../server/creators/runtime.mjs";
import { creatorOperator } from "../server/creators/operator.mjs";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const ENV = {
  CREATOR_COMMUNITY_ENABLED: "1",
  CREATOR_POLICY_VERSION: "qa-only-restore-v1",
  CREATOR_XP_COMMITMENT: "200",
  CREATOR_MODERATORS: "qa-reviewer",
  CREATOR_COMPLETION_AUTHORITIES: "qa-validator",
};
const plain = (value) => JSON.parse(JSON.stringify(value));
function snapshot(db) {
  const schema = plain(
    db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all(),
  );
  const tables = Object.fromEntries(
    schema
      .filter((r) => r.type === "table")
      .map(({ name }) => [
        name,
        plain(
          db
            .prepare(
              `SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`,
            )
            .all(),
        ),
      ]),
  );
  return { schema, tables };
}
function backing(db) {
  return Object.fromEntries(
    [
      "players",
      "inventory",
      "history",
      "treasury",
      "treasury_events",
      "native_awards",
    ].map((name) => [
      name,
      plain(db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()),
    ]),
  );
}

test("existing private WAL backup restores creator publication/obligations and historical retries without duplicated rights", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-creator-restore-"));
  const state = join(directory, "state"),
    destination = join(directory, "snapshots");
  mkdirSync(state, { mode: 0o700 });
  const handles = [];
  t.after(() => {
    for (const db of handles) if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const open = (path) => {
    const db = openDatabase(path);
    handles.push(db);
    return db;
  };
  const db = open(join(state, "auratrail.sqlite"));
  const runtime = (db) =>
    createCreatorRuntime(db, {
      env: ENV,
      origin: "http://localhost",
      authenticate: () => null,
      clock: () => NOW,
    }).services;
  const { lifecycle: l, community: c } = runtime(db);
  const author = createPlayer(db, "Private account name", NOW),
    walker = createPlayer(db, "Solo walker", NOW),
    hidden = createPlayer(db, "Hidden account", NOW);
  db.prepare("UPDATE players SET xp=1000 WHERE id=?").run(author);
  const originalBacking = backing(db);
  const profileInput = {
    actor: author,
    operationId: "public-profile",
    expectedVersion: 0,
    profile: {
      displayName: "Riverkeeper",
      bio: "Free public stories.",
      public: true,
    },
    publicConsent: true,
  };
  const profileReceipt = c.saveProfile(profileInput);
  c.saveProfile({
    actor: hidden,
    operationId: "private-profile",
    expectedVersion: 0,
    profile: {
      displayName: "Private creator text",
      bio: "Must remain private.",
      public: false,
    },
    publicConsent: false,
  });
  const followingInput = {
    actor: walker,
    operationId: "follow",
    creatorId: author,
    following: true,
  };
  const followReceipt = c.setFollowing(followingInput);
  const approvals = [];
  for (const questId of ["closing-quest", "published-quest"]) {
    l.createDraft({
      actor: author,
      operationId: `draft:${questId}`,
      questId,
      draft: {
        title: `Reviewed ${questId}`,
        description: "Read these accepted public instructions.",
      },
    });
    l.submit({
      actor: author,
      operationId: `submit:${questId}`,
      questId,
      expectedVersion: 1,
      expectedPolicyVersion: ENV.CREATOR_POLICY_VERSION,
    });
    const input = {
      actor: "qa-reviewer",
      operationId: `approve:${questId}`,
      questId,
      expectedVersion: 2,
      decision: "approve",
      reason: "QA-only independent review.",
    };
    approvals.push({
      input,
      receipt: creatorOperator({ lifecycle: l, community: c }, "review", input),
    });
  }
  const startInput = {
    actor: walker,
    operationId: "start",
    questId: "closing-quest",
  };
  const startReceipt = l.start(startInput);
  l.revise({
    actor: author,
    operationId: "private-future-revision",
    questId: "closing-quest",
    expectedVersion: 3,
    draft: {
      title: "Private future draft",
      description:
        "These unreviewed changes must not replace accepted instructions.",
    },
  });
  const closeInput = {
    actor: author,
    operationId: "close",
    questId: "closing-quest",
    expectedVersion: 4,
  };
  const closeReceipt = l.close(closeInput);
  const expectedProgression = {
    earnedXp: 1000,
    lockedXp: 400,
    availableXp: 600,
    level: 3,
  };
  assert.deepEqual(demoProgression(db, author), expectedProgression);
  assert.equal(existsSync(join(state, "auratrail.sqlite-wal")), true);
  const before = snapshot(db);

  function backup(sourceState) {
    const metadata = JSON.parse(
      execFileSync(
        "python3",
        [
          resolve("deploy/backup-state.py"),
          "--state",
          sourceState,
          "--destination",
          destination,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
      ),
    );
    assert.equal(metadata.status, "ok");
    assert.equal(metadata.integrity, "ok");
    assert.equal(metadata.awardAttestorIncluded, false);
    assert.deepEqual(metadata.nativeServiceKeysIncluded, []);
    assert.equal(metadata.playerWalletSigningKeysIncluded, false);
    const folder = join(destination, metadata.snapshotId),
      file = join(folder, "database.sqlite");
    assert.deepEqual(readdirSync(folder).sort(), [
      "database.sqlite",
      "metadata.json",
    ]);
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      metadata.databaseSha256,
    );
    for (const path of [
      destination,
      folder,
      file,
      join(folder, "metadata.json"),
    ])
      assert.equal(statSync(path).mode & 0o077, 0);
    return file;
  }
  function restore(file, name) {
    const folder = join(directory, name);
    mkdirSync(folder, { mode: 0o700 });
    const filePath = join(folder, "auratrail.sqlite");
    copyFileSync(file, filePath);
    const restored = open(filePath);
    assert.deepEqual(plain(restored.prepare("PRAGMA integrity_check").all()), [
      { integrity_check: "ok" },
    ]);
    assert.deepEqual(
      plain(restored.prepare("PRAGMA foreign_key_check").all()),
      [],
    );
    return { db: restored, state: folder, ...runtime(restored) };
  }
  const firstBackup = backup(state),
    restored = restore(firstBackup, "restored");
  assert.deepEqual(snapshot(restored.db), before);
  assert.deepEqual(demoProgression(restored.db, author), expectedProgression);
  assert.deepEqual(restored.lifecycle.progression(author), {
    domain: "demo",
    ...expectedProgression,
  });
  assert.deepEqual(
    restored.community
      .listQuests(walker, { followingOnly: true })
      .items.map((q) => q.id),
    ["published-quest"],
  );
  assert.deepEqual(restored.community.myProfile(hidden), c.myProfile(hidden));
  assert.throws(
    () => restored.community.profile(walker, hidden),
    (e) => e.code === "CREATOR_NOT_FOUND",
  );
  assert(
    !JSON.stringify(restored.community.listCreators(walker)).includes(
      "Private creator text",
    ),
  );
  const accepted = restored.community.myParticipation(walker, "closing-quest");
  assert.equal(accepted.revision, 1);
  assert.equal(accepted.questState, "closing");
  assert.equal(accepted.state, "open");
  assert.equal(
    accepted.content.description,
    "Read these accepted public instructions.",
  );
  assert(!JSON.stringify(accepted).includes("Private future draft"));
  assert.equal(
    restored.community.myCreation(author, "closing-quest").latestState,
    "withdrawn",
  );
  assert.equal(restored.community.myParticipations(walker).items.length, 1);

  // Recovered receipts remain historical. Replays must not restore an old state,
  // re-open admission, allocate another commitment or change a public preference.
  assert.deepEqual(
    restored.community.saveProfile(profileInput),
    profileReceipt,
  );
  assert.deepEqual(
    restored.community.setFollowing(followingInput),
    followReceipt,
  );
  assert.deepEqual(restored.lifecycle.start(startInput), startReceipt);
  assert.deepEqual(restored.lifecycle.close(closeInput), closeReceipt);
  for (const { input, receipt } of approvals)
    assert.deepEqual(creatorOperator(restored, "review", input), receipt);
  assert.deepEqual(snapshot(restored.db), before);
  assert.throws(
    () =>
      restored.lifecycle.start({
        actor: hidden,
        operationId: "new-start-after-restore",
        questId: "closing-quest",
      }),
    (e) => e.code === "CREATOR_CONFLICT",
  );
  const finalizeInput = {
    actor: author,
    operationId: "finalize",
    questId: "closing-quest",
    expectedVersion: 5,
  };
  assert.throws(
    () => restored.lifecycle.finalize(finalizeInput),
    (e) => e.code === "CREATOR_OBLIGATIONS_OPEN",
  );
  assert.deepEqual(demoProgression(restored.db, author), expectedProgression);
  const resolutionInput = {
    actor: "qa-validator",
    operationId: "resolve",
    questId: "closing-quest",
    participant: walker,
    resolutionReference: "qa-independent-reference",
  };
  const resolutionReceipt = creatorOperator(
    restored,
    "resolve",
    resolutionInput,
  );
  const finalReceipt = restored.lifecycle.finalize(finalizeInput);
  assert.deepEqual(demoProgression(restored.db, author), {
    earnedXp: 1000,
    lockedXp: 200,
    availableXp: 800,
    level: 3,
  });
  assert.equal(
    restored.community.myParticipation(walker, "closing-quest").state,
    "resolved",
  );
  assert.equal(
    restored.community.myCreation(author, "closing-quest").state,
    "closed",
  );
  assert.deepEqual(backing(restored.db), originalBacking);
  // Completing the restored copy cannot affect the original live database.
  assert.deepEqual(snapshot(db), before);

  const afterRelease = snapshot(restored.db),
    second = restore(backup(restored.state), "restored-after-release");
  assert.deepEqual(snapshot(second.db), afterRelease);
  assert.deepEqual(
    creatorOperator(second, "resolve", resolutionInput),
    resolutionReceipt,
  );
  assert.deepEqual(second.lifecycle.finalize(finalizeInput), finalReceipt);
  for (const { input, receipt } of approvals)
    assert.deepEqual(creatorOperator(second, "review", input), receipt);
  assert.deepEqual(snapshot(second.db), afterRelease);
  assert.equal(
    second.db
      .prepare(
        "SELECT count(*) AS n FROM creator_xp_commitments WHERE released_at IS NULL",
      )
      .get().n,
    1,
  );
  assert.deepEqual(backing(second.db), originalBacking);
  assert.equal(demoProgression(second.db, walker).earnedXp, 0);
  assert.throws(
    () =>
      second.lifecycle.finalize({
        ...finalizeInput,
        operationId: "different-finalize",
      }),
    (e) => e.code === "CREATOR_STALE",
  );
});

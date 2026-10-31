import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { SocialContent } from "../server/social-content.mjs";

test("local operator review requires explicit target/reason/apply and records hide/restore decisions", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-moderator-")),
    path = join(dir, "notes.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(path);
  t.after(() => db.close());
  const author = createPlayer(db, "Author"),
    reader = createPlayer(db, "Reader");
  const content = new SocialContent(db);
  const note = await content.create(author, {
    clientId: "operator-fixture",
    text: "Synthetic note",
    lat: 49,
    lng: 13,
    arena: true,
    publicConsent: true,
    shareGps: false,
  });
  content.report(reader, note.id, {
    reason: "other",
    detail: "Synthetic review",
  });
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [
        resolve("server/cli/moderate-notes.mjs"),
        ...args,
        "--database",
        path,
        "--operator",
        "qa-operator",
      ],
      { encoding: "utf8" },
    );
  const queue = run("list");
  assert.equal(queue.status, 0, queue.stderr);
  assert.equal(JSON.parse(queue.stdout).reports.length, 1);
  assert.notEqual(
    run("hide", "--note", note.id, "--reason", "Fixture hidden").status,
    0,
  );
  assert.equal(
    content.list(reader, { lat: 49, lng: 13, arena: true }).messages.length,
    1,
  );
  assert.equal(
    run("hide", "--note", note.id, "--reason", "Fixture hidden", "--apply")
      .status,
    0,
  );
  assert.equal(
    content.list(reader, { lat: 49, lng: 13, arena: true }).messages.length,
    0,
  );
  assert.equal(
    run("restore", "--note", note.id, "--reason", "Fixture restored", "--apply")
      .status,
    0,
  );
  assert.equal(
    content.list(reader, { lat: 49, lng: 13, arena: true }).messages.length,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM social_audit WHERE actor_id='qa-operator'",
      )
      .get().n,
    2,
  );
  assert.throws(
    () =>
      content.moderate(author, {
        noteId: note.id,
        action: "hide",
        reason: "Pretend operator",
      }),
    /authorization/,
  );
});

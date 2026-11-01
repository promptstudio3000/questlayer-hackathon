import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { SocialContent } from "../server/social-content.mjs";
import { NativeSocialRecords } from "../server/native/social-records.mjs";
import { Moderation, moderationSuppression } from "../server/moderation.mjs";
import { TaskEvidence } from "../server/task-evidence.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import {
  inspectDatabaseSchema,
  recordSchemaVersions,
} from "../server/schema-compatibility.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const POLICY = { version: "qa-moderation-v1", xpCommitment: 200 };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-moderation-"));
  const db = openDatabase(":memory:");
  t.after(() => {
    if (db.isOpen) db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let now = NOW,
    n = 0;
  const clock = () => now;
  const author = createPlayer(db, "Author", NOW),
    viewer = createPlayer(db, "Viewer", NOW),
    other = createPlayer(db, "Other", NOW);
  db.prepare("UPDATE players SET xp=100000 WHERE id=?").run(author);
  const social = new SocialContent(db, { clock });
  // The records module owns social_record_publications; constructing it
  // registers its tables exactly as production does.
  new NativeSocialRecords(db, { query: async () => ({}) }, { clock });
  const creators = createCreatorServices(db, {
    policy: POLICY,
    clock,
    isModerator: (a) => a === "reviewer",
    isCompletionAuthority: () => false,
  });
  const evidence = new TaskEvidence(db, { directory: dir, clock });
  const moderation = new Moderation(db, {
    clock,
    authorizeOperator: (a) => a === "reviewer",
    creators,
    evidence,
  });
  const note = (text = "Public bench by the river.", image = null) => {
    const noteId = `message_${String(++n).padStart(8, "0")}-1111-1111-1111-111111111111`;
    db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)").run(
      noteId,
      author,
      text,
      49.75,
      13.38,
      image,
      null,
      now,
    );
    db.prepare("INSERT INTO social_note_meta VALUES(?,1,'published',?)").run(
      noteId,
      now,
    );
    return noteId;
  };
  const publishRecord = (noteId) =>
    db
      .prepare(
        "INSERT INTO social_record_publications VALUES(?,?,?,?,?,'confirmed',?,?)",
      )
      .run(
        noteId,
        `record_${noteId.slice(8)}`,
        "author.testnet",
        "note",
        JSON.stringify({ note_id: noteId, state: "published", text: "x" }),
        now,
        now,
      );
  return {
    db,
    dir,
    author,
    viewer,
    other,
    social,
    creators,
    evidence,
    moderation,
    note,
    publishRecord,
    op: () => `mod-${++n}`,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("unified queue groups note, record, quest and evidence reports for operators only", async (t) => {
  const f = fixture(t);
  const noteId = f.note();
  f.social.report(f.viewer, noteId, { reason: "spam" });
  f.social.report(f.other, noteId, { reason: "harassment", detail: "Rude." });
  const recordNote = f.note("Recorded bench.");
  f.publishRecord(recordNote);
  const recordReport = f.moderation.report(f.viewer, {
    kind: "record",
    targetId: recordNote,
    reason: "privacy",
    detail: "Shows a house number.",
  });
  assert.equal(recordReport.state, "open");
  assert.equal(
    f.moderation.report(f.viewer, {
      kind: "record",
      targetId: recordNote,
      reason: "privacy",
    }).replayed,
    true,
  );
  assert.throws(
    () =>
      f.moderation.report(f.author, {
        kind: "record",
        targetId: recordNote,
        reason: "spam",
      }),
    /own record/,
  );
  assert.throws(
    () =>
      f.moderation.report(f.viewer, {
        kind: "record",
        targetId: noteId,
        reason: "spam",
      }),
    /not found/,
  );
  assert.throws(() => f.moderation.queue("player"), /Operator authorization/);
  const queue = f.moderation.queue("reviewer");
  const byKind = Object.fromEntries(queue.items.map((i) => [i.kind, i]));
  assert.equal(byKind.note.reportCount, 2);
  assert.equal(byKind.note.state, "published");
  assert.deepEqual(byKind.note.actions, [
    "hide",
    "restore",
    "dismiss",
    "tombstone",
  ]);
  assert.equal(byKind.record.reports[0].detail, "Shows a house number.");
  assert.equal(byKind.record.state, "published");
});

test("hide, restore and tombstone notes resolve reports and extend a verifiable audit chain", async (t) => {
  const f = fixture(t);
  const noteId = f.note(
    "Visible text",
    "/api/media/image_11111111-1111-1111-1111-111111111111.jpg",
  );
  f.social.report(f.viewer, noteId, { reason: "spam", detail: "Ad." });
  await assert.rejects(
    f.moderation.decide("reviewer", {
      kind: "note",
      targetId: noteId,
      action: "hide",
      reason: "",
    }),
    /Moderation reason/,
  );
  await assert.rejects(
    f.moderation.decide("someone", {
      kind: "note",
      targetId: noteId,
      action: "hide",
      reason: "x",
    }),
    /Operator authorization/,
  );
  const hidden = await f.moderation.decide("reviewer", {
    kind: "note",
    targetId: noteId,
    action: "hide",
    reason: "Advertising.",
  });
  assert.equal(hidden.before, "published");
  assert.equal(hidden.after, "hidden");
  assert.equal(hidden.resolvedReports.length, 1);
  assert.equal(f.moderation.queue("reviewer").items.length, 0);
  assert.equal(
    f.moderation.queue("reviewer", { state: "resolved" }).items[0].targetId,
    noteId,
  );
  const restored = await f.moderation.decide("reviewer", {
    kind: "note",
    targetId: noteId,
    action: "restore",
    reason: "Appeal accepted.",
  });
  assert.equal(restored.after, "published");
  const tomb = await f.moderation.decide("reviewer", {
    kind: "note",
    targetId: noteId,
    action: "tombstone",
    reason: "Doxxing.",
  });
  assert.equal(tomb.after, "deleted");
  const row = f.db.prepare("SELECT * FROM messages WHERE id=?").get(noteId);
  assert.equal(row.text, "");
  assert.equal(row.image, null);
  assert.ok(
    f.db
      .prepare(
        "SELECT 1 FROM social_media_retirements WHERE image LIKE '/api/media/image_1111%'",
      )
      .get(),
  );
  assert.equal(moderationSuppression(f.db, "note", noteId), "tombstoned");
  await assert.rejects(
    f.moderation.decide("reviewer", {
      kind: "note",
      targetId: noteId,
      action: "restore",
      reason: "x",
    }),
    /cannot be restored/,
  );
  const audit = f.moderation.audit("reviewer", { targetId: noteId });
  assert.deepEqual(
    audit.entries.map((e) => e.action),
    ["tombstone", "restore", "hide"],
  );
  assert.equal(audit.entries[2].operator, "reviewer");
  assert.deepEqual(f.moderation.verifyAudit(), {
    ok: true,
    count: 3,
    head: audit.entries[0].hash,
  });
  // Any later edit of an audit row breaks the chain.
  f.db
    .prepare("UPDATE moderation_audit SET reason='edited' WHERE action='hide'")
    .run();
  assert.equal(f.moderation.verifyAudit().ok, false);
});

test("record moderation stops republishing and pinning; tombstone also clears the note", async (t) => {
  const f = fixture(t);
  const image = "/api/media/image_22222222-2222-2222-2222-222222222222.jpg";
  const noteId = f.note("Record text", image);
  f.publishRecord(noteId);
  f.db
    .prepare(
      "INSERT INTO social_record_media(image,sha256,cid,bytes,state,run_after,updated_at) VALUES(?,?,?,?,'pinning',0,?)",
    )
    .run(image, "a".repeat(64), "bafy", 10, NOW);
  f.moderation.report(f.viewer, {
    kind: "record",
    targetId: noteId,
    reason: "privacy",
  });
  const hidden = await f.moderation.decide("reviewer", {
    kind: "record",
    targetId: noteId,
    action: "hide",
    reason: "Privacy review.",
  });
  assert.equal(hidden.after, "hidden");
  assert.equal(
    f.db
      .prepare("SELECT state FROM social_note_meta WHERE note_id=?")
      .get(noteId).state,
    "hidden",
  );
  assert.equal(
    f.db
      .prepare("SELECT state FROM social_record_media WHERE image=?")
      .get(image).state,
    "unavailable",
  );
  assert.equal(moderationSuppression(f.db, "record", noteId), "hidden");
  const restored = await f.moderation.decide("reviewer", {
    kind: "record",
    targetId: noteId,
    action: "restore",
    reason: "Reviewed, fine.",
  });
  assert.equal(restored.after, "published");
  assert.equal(
    f.db
      .prepare("SELECT state FROM social_note_meta WHERE note_id=?")
      .get(noteId).state,
    "published",
  );
  const tomb = await f.moderation.decide("reviewer", {
    kind: "record",
    targetId: noteId,
    action: "tombstone",
    reason: "Confirmed privacy breach.",
  });
  assert.equal(tomb.after, "tombstoned");
  assert.equal(
    f.db
      .prepare("SELECT state FROM social_note_meta WHERE note_id=?")
      .get(noteId).state,
    "deleted",
  );
  const sup = f.db
    .prepare(
      "SELECT * FROM moderation_suppressions WHERE kind='record' AND target_id=?",
    )
    .get(noteId);
  assert.equal(sup.state, "tombstoned");
  assert.equal(sup.operator, "reviewer");
  assert.equal(sup.reason, "Confirmed privacy breach.");
  await assert.rejects(
    f.moderation.decide("reviewer", {
      kind: "record",
      targetId: noteId,
      action: "restore",
      reason: "x",
    }),
    /already tombstoned/,
  );
});

test("quest decisions suspend through creator lifecycle and review every open report", async (t) => {
  const f = fixture(t);
  const { lifecycle: l, community: c, safety: s } = f.creators;
  for (const actor of [f.author, f.viewer])
    c.saveProfile({
      actor,
      operationId: f.op(),
      expectedVersion: 0,
      profile: {
        displayName: actor === f.author ? "Keeper" : "Walker",
        bio: "Bio.",
        public: true,
      },
      publicConsent: true,
    });
  l.createDraft({
    actor: f.author,
    operationId: f.op(),
    questId: "park",
    draft: {
      title: "Reviewed public path",
      description: "Observe the park entrance from the footpath.",
    },
  });
  l.submit({
    actor: f.author,
    operationId: f.op(),
    questId: "park",
    expectedVersion: 1,
    expectedPolicyVersion: POLICY.version,
  });
  l.review({
    actor: "reviewer",
    operationId: f.op(),
    questId: "park",
    expectedVersion: 2,
    decision: "approve",
    reason: "QA.",
  });
  s.report({
    actor: f.viewer,
    operationId: f.op(),
    questId: "park",
    revision: 1,
    reason: "unsafe-place",
    detail: "Busy road.",
  });
  const item = f.moderation.queue("reviewer", { kinds: ["quest"] }).items[0];
  assert.equal(item.kind, "quest");
  assert.deepEqual(item.actions, ["hide", "dismiss"]);
  await assert.rejects(
    f.moderation.decide("reviewer", {
      kind: "quest",
      targetId: "park",
      action: "tombstone",
      reason: "x",
    }),
    /Use hide, dismiss/,
  );
  const result = await f.moderation.decide("reviewer", {
    kind: "quest",
    targetId: "park",
    action: "hide",
    reason: "Unsafe crossing.",
  });
  assert.equal(result.before, "published");
  assert.ok(["closing", "closed"].includes(result.after));
  assert.equal(
    f.db.prepare("SELECT status,decision FROM creator_reports").get().decision,
    "confirmed",
  );
  assert.equal(
    f.moderation.queue("reviewer", { kinds: ["quest"] }).items.length,
    0,
  );
  assert.equal(f.moderation.verifyAudit().ok, true);
});

test("evidence reports and decisions withhold, restore and erase the private file", async (t) => {
  const f = fixture(t);
  const image = `data:image/png;base64,${(
    await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer()
  ).toString("base64")}`;
  const photo = await f.evidence.upload(
    f.author,
    "claimant.testnet",
    {
      taskId: 3,
      open: true,
      sponsorId: "sponsor.testnet",
      arbiterId: "arbiter.testnet",
    },
    image,
  );
  assert.throws(
    () =>
      f.moderation.report(
        f.viewer,
        { kind: "evidence", targetId: photo.id, reason: "harassment" },
        { canSee: () => false },
      ),
    /not found/,
  );
  f.moderation.report(
    f.viewer,
    { kind: "evidence", targetId: photo.id, reason: "harassment" },
    { canSee: () => true },
  );
  const item = f.moderation.queue("reviewer", { kinds: ["evidence"] }).items[0];
  assert.equal(item.preview.sha256, photo.sha256);
  const withheld = await f.moderation.decide("reviewer", {
    kind: "evidence",
    targetId: photo.id,
    action: "hide",
    reason: "Review image.",
  });
  assert.equal(withheld.after, "withheld");
  assert.throws(
    () => f.evidence.open(f.author, "", photo.id, null),
    (e) => e.status === 451,
  );
  const restored = await f.moderation.decide("reviewer", {
    kind: "evidence",
    targetId: photo.id,
    action: "restore",
    reason: "Fine.",
  });
  assert.equal(restored.after, "staged");
  const erased = await f.moderation.decide("reviewer", {
    kind: "evidence",
    targetId: photo.id,
    action: "tombstone",
    reason: "Contains a bystander's face.",
  });
  assert.equal(erased.after, "erased");
  assert.equal(existsSync(join(f.dir, `${photo.id}.jpg`)), false);
});

test("moderation and evidence tables are recognized by schema preflight", (t) => {
  const f = fixture(t);
  recordSchemaVersions(f.db);
  const status = inspectDatabaseSchema(f.db);
  const names = status.modules.map((m) => m.name);
  assert.ok(names.includes("moderation"));
  assert.ok(names.includes("task-evidence"));
});

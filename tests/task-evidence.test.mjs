import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  utimesSync,
  statSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  TaskEvidence,
  EVIDENCE_POLICY,
  evidenceDigest,
  evidenceTaskView,
} from "../server/task-evidence.mjs";
import { evidenceCommitment } from "../src/task-evidence-photo.ts";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const DAY = 86400000;
const SPONSOR = "sponsor.testnet",
  ARBITER = "arbiter.testnet",
  CLAIMANT = "claimant.testnet";

async function photoData(color = "#336699", exif = false) {
  let img = sharp({
    create: { width: 80, height: 60, channels: 3, background: color },
  }).jpeg();
  if (exif) img = img.withExif({ IFD0: { Copyright: "secret-gps-owner" } });
  return `data:image/jpeg;base64,${(await img.toBuffer()).toString("base64")}`;
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-evidence-"));
  const db = openDatabase(":memory:");
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let now = NOW;
  const claimant = createPlayer(db, "Claimant", NOW),
    sponsor = createPlayer(db, "Sponsor", NOW),
    stranger = createPlayer(db, "Stranger", NOW);
  const evidence = new TaskEvidence(db, { directory: dir, clock: () => now });
  const task = (patch = {}) => ({
    taskId: 7,
    open: true,
    sponsorId: SPONSOR,
    arbiterId: ARBITER,
    settledAtMs: null,
    submissions: [],
    ...patch,
  });
  return {
    db,
    dir,
    evidence,
    claimant,
    sponsor,
    stranger,
    task,
    advance: (ms) => {
      now += ms;
    },
    now: () => now,
  };
}

test("client and server commit to the same evidence digest", () => {
  const fields = { text: "Bench photo", reference: "", photo: "a".repeat(64) };
  const expected = createHash("sha256")
    .update(
      JSON.stringify(
        evidenceCommitment(fields.text, fields.reference, fields.photo),
      ),
    )
    .digest("hex");
  assert.equal(evidenceDigest(fields), expected);
  // Without a photo the commitment is unchanged from the text-only flow.
  assert.equal(
    evidenceDigest({ text: "t", reference: "" }),
    createHash("sha256")
      .update(JSON.stringify({ text: "t", reference: "" }))
      .digest("hex"),
  );
});

test("uploads are re-encoded, private, metadata-free and only for open tasks", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.evidence.upload(
      f.claimant,
      CLAIMANT,
      f.task({ open: false }),
      await photoData(),
    ),
    /not accepting evidence/,
  );
  await assert.rejects(
    f.evidence.upload(f.sponsor, SPONSOR, f.task(), await photoData()),
    /cannot submit evidence/,
  );
  const photo = await f.evidence.upload(
    f.claimant,
    CLAIMANT,
    f.task(),
    await photoData("#336699", true),
  );
  assert.equal(photo.state, "staged");
  assert.equal(photo.expiresAt, NOW + EVIDENCE_POLICY.stagedTtlMs);
  const file = join(f.dir, `${photo.id}.jpg`);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const bytes = readFileSync(file);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), photo.sha256);
  assert.equal(bytes.includes(Buffer.from("secret-gps-owner")), false);
  assert.equal((await sharp(bytes).metadata()).exif, undefined);
});

test("sponsor and arbiter see a photo only after the chain commits its digest", async (t) => {
  const f = fixture(t);
  const photo = await f.evidence.upload(
    f.claimant,
    CLAIMANT,
    f.task(),
    await photoData(),
  );
  // Before submission: only the uploader.
  assert.equal(f.evidence.open(f.claimant, "", photo.id, null).role, "owner");
  assert.throws(
    () => f.evidence.open(f.sponsor, SPONSOR, photo.id, f.task()),
    /not found/,
  );
  assert.equal(f.evidence.list(f.sponsor, SPONSOR, f.task()).review.length, 0);
  const text = "Photo of the bench at the gate.";
  const wrong = f.task({
    submissions: [
      {
        submissionId: 0,
        claimantId: "someone-else.testnet",
        evidence: {
          text,
          reference: "",
          content_hash: evidenceDigest({
            text,
            reference: "",
            photo: photo.sha256,
          }),
        },
        appeal: null,
      },
    ],
  });
  assert.equal(f.evidence.list(f.sponsor, SPONSOR, wrong).review.length, 0);
  const committed = f.task({
    submissions: [
      {
        submissionId: 2,
        claimantId: CLAIMANT,
        evidence: {
          text,
          reference: "",
          content_hash: evidenceDigest({
            text,
            reference: "",
            photo: photo.sha256,
          }),
        },
        appeal: null,
      },
    ],
  });
  const review = f.evidence.list(f.sponsor, SPONSOR, committed).review;
  assert.equal(review.length, 1);
  assert.equal(review[0].state, "committed");
  assert.equal(review[0].submissionId, 2);
  assert.equal(review[0].expiresAt, NOW + EVIDENCE_POLICY.maxRetentionMs);
  assert.equal(
    f.evidence.open(f.sponsor, SPONSOR, photo.id, committed).role,
    "sponsor",
  );
  assert.equal(
    f.evidence.open(f.stranger, ARBITER, photo.id, committed).role,
    "arbiter",
  );
  assert.throws(
    () => f.evidence.open(f.stranger, "random.testnet", photo.id, committed),
    /not found/,
  );
  assert.equal(
    f.db
      .prepare("SELECT count(*) n FROM task_evidence_views WHERE photo_id=?")
      .get(photo.id).n,
    2,
  );
  // Settlement shortens retention to 30 days after the task settles.
  f.evidence.bind({ ...committed, settledAtMs: NOW + DAY });
  assert.equal(
    f.evidence.row(photo.id).expires_at,
    NOW + DAY + EVIDENCE_POLICY.afterSettlementMs,
  );
});

test("rate limits cap uploads per hour, per day and per task", async (t) => {
  const f = fixture(t);
  const data = await photoData();
  for (let i = 0; i < EVIDENCE_POLICY.perTask; i++)
    await f.evidence.upload(f.claimant, CLAIMANT, f.task(), data);
  await assert.rejects(
    f.evidence.upload(f.claimant, CLAIMANT, f.task(), data),
    /Remove an earlier photo/,
  );
  for (let i = EVIDENCE_POLICY.perTask; i < EVIDENCE_POLICY.perHour; i++)
    await f.evidence.upload(
      f.claimant,
      CLAIMANT,
      f.task({ taskId: 10 + i }),
      data,
    );
  await assert.rejects(
    f.evidence.upload(f.claimant, CLAIMANT, f.task({ taskId: 50 }), data),
    (e) => e.status === 429 && /hourly/.test(e.message),
  );
  let uploaded = EVIDENCE_POLICY.perHour;
  while (uploaded < EVIDENCE_POLICY.perDay) {
    f.advance(3600001);
    for (
      let i = 0;
      i < EVIDENCE_POLICY.perHour && uploaded < EVIDENCE_POLICY.perDay;
      i++
    )
      await f.evidence.upload(
        f.claimant,
        CLAIMANT,
        f.task({ taskId: 60 + uploaded++ }),
        data,
      );
  }
  f.advance(3600001);
  await assert.rejects(
    f.evidence.upload(f.claimant, CLAIMANT, f.task({ taskId: 120 }), data),
    (e) => e.status === 429 && /daily/.test(e.message),
  );
});

test("owner removal and retention erase files; orphans are cleaned after an hour", async (t) => {
  const f = fixture(t);
  const a = await f.evidence.upload(
    f.claimant,
    CLAIMANT,
    f.task(),
    await photoData(),
  );
  const b = await f.evidence.upload(
    f.claimant,
    CLAIMANT,
    f.task(),
    await photoData("#aa0000"),
  );
  assert.throws(() => f.evidence.remove(f.stranger, a.id), /not found/);
  assert.equal(f.evidence.remove(f.claimant, a.id).state, "deleted");
  assert.equal(existsSync(join(f.dir, `${a.id}.jpg`)), false);
  assert.throws(
    () => f.evidence.open(f.claimant, "", a.id, null),
    (e) => e.status === 410,
  );
  const orphan = join(
    f.dir,
    "evidence_99999999-9999-9999-9999-999999999999.jpg",
  );
  writeFileSync(orphan, "x");
  utimesSync(orphan, new Date(NOW - 7200000), new Date(NOW - 7200000));
  f.advance(EVIDENCE_POLICY.stagedTtlMs + 1);
  const pruned = f.evidence.prune();
  assert.deepEqual(pruned, { expired: 1, orphans: 1 });
  assert.equal(f.evidence.row(b.id).state, "expired");
  assert.equal(existsSync(join(f.dir, `${b.id}.jpg`)), false);
  assert.equal(existsSync(orphan), false);
});

test("task view only opens uploads when the wallet may submit or appeal", () => {
  const snapshot = {
    selectedTaskId: 4,
    tasks: [{ task_id: 4, sponsor_id: SPONSOR, settled_at_ms: null }],
    actions: { submit: false, appealSubmissionId: 1 },
    submissions: [
      {
        submission_id: 1,
        claimant_id: CLAIMANT,
        evidence: { text: "a", reference: "", content_hash: "0".repeat(64) },
        appeal: null,
      },
    ],
  };
  const view = evidenceTaskView(snapshot, 4, ARBITER);
  assert.equal(view.open, true);
  assert.equal(view.submissions[0].claimantId, CLAIMANT);
  assert.equal(
    evidenceTaskView({ ...snapshot, actions: null }, 4, ARBITER).open,
    false,
  );
  assert.throws(() => evidenceTaskView(snapshot, 5, ARBITER), /Task not found/);
});

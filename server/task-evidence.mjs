// Private photo evidence for sponsored tasks (W10.3).
//
// A claimant uploads a photo for one task. The server re-encodes it (no EXIF or
// GPS), stores it outside every public path and returns its SHA-256. The client
// commits that digest inside the on-chain evidence `content_hash`
// (sha256(JSON.stringify({text, reference, photo}))), so the chain holds only a
// hash and never the image. The photo becomes visible to the task sponsor and
// the disclosed arbiter only after the server finds an on-chain submission from
// the uploader whose content hash binds this exact photo. Nobody else can read
// it: there is no public URL, no listing and no pinning.
//
// Retention: an unbound photo is erased 24 hours after upload. A bound photo is
// erased 30 days after the task settles and never later than 60 days after
// upload. The uploader can erase it at any time; moderation can withhold or
// erase it. Erasure removes the file immediately; only the digest and a
// content-free row remain for the audit trail.
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  lstatSync,
} from "node:fs";
import { resolve } from "node:path";
import { assert, id } from "./domain.mjs";
import { sanitizeImage } from "./note-media.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "./schema-compatibility.mjs";

export const TASK_EVIDENCE_SCHEMA = registerModuleSchema({
  name: "task-evidence",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS task_evidence_photos(
 id TEXT PRIMARY KEY,
 player_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 task_id INTEGER NOT NULL CHECK(task_id>0),
 sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0),
 state TEXT NOT NULL CHECK(state IN ('staged','committed','withheld','deleted','expired','erased')),
 submission_id INTEGER,
 created_at INTEGER NOT NULL,
 committed_at INTEGER,
 expires_at INTEGER NOT NULL,
 closed_at INTEGER,
 close_reason TEXT
);
CREATE TABLE IF NOT EXISTS task_evidence_views(
 photo_id TEXT NOT NULL REFERENCES task_evidence_photos(id),
 viewer_player TEXT NOT NULL,
 viewer_account TEXT NOT NULL,
 role TEXT NOT NULL,
 viewed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS task_evidence_photos_rate ON task_evidence_photos(player_id,created_at);
CREATE INDEX IF NOT EXISTS task_evidence_photos_task ON task_evidence_photos(task_id,account_id,state);
CREATE INDEX IF NOT EXISTS task_evidence_photos_expiry ON task_evidence_photos(state,expires_at);
CREATE INDEX IF NOT EXISTS task_evidence_views_photo ON task_evidence_views(photo_id,viewed_at)`,
});

const HOUR = 3600000,
  DAY = 24 * HOUR;
export const EVIDENCE_POLICY = Object.freeze({
  stagedTtlMs: DAY,
  afterSettlementMs: 30 * DAY,
  maxRetentionMs: 60 * DAY,
  perHour: 6,
  perDay: 20,
  perTask: 3,
  maxActive: 5000,
  viewLogRetentionMs: 90 * DAY,
});
const PHOTO_ID = /^evidence_[a-f0-9-]{36}$/;
const LIVE = ["staged", "committed", "withheld"];

// The exact field order is part of the commitment; the client uses the same.
export function evidenceDigest({ text, reference = "", photo = "" }) {
  const value = photo ? { text, reference, photo } : { text, reference };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class TaskEvidence {
  constructor(db, { directory = ".data/evidence", clock = Date.now } = {}) {
    this.db = db;
    this.directory = resolve(directory);
    this.clock = clock;
    this.active = 0;
    ensureModuleVersion(db, TASK_EVIDENCE_SCHEMA);
  }
  file(photoId) {
    return PHOTO_ID.test(photoId || "")
      ? resolve(this.directory, `${photoId}.jpg`)
      : null;
  }
  row(photoId) {
    assert(PHOTO_ID.test(photoId || ""), "Photo evidence not found.", 404);
    const row = this.db
      .prepare("SELECT * FROM task_evidence_photos WHERE id=?")
      .get(photoId);
    assert(row, "Photo evidence not found.", 404);
    return row;
  }
  view(row, role = "owner") {
    return {
      id: row.id,
      taskId: row.task_id,
      accountId:
        role === "owner" || LIVE.includes(row.state) ? row.account_id : "",
      sha256: row.sha256,
      state: row.state,
      submissionId: row.submission_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      closedAt: row.closed_at,
      closeReason: row.close_reason,
      role,
    };
  }
  close(row, state, reason) {
    const path = this.file(row.id);
    this.db
      .prepare(
        "UPDATE task_evidence_photos SET state=?,closed_at=?,close_reason=? WHERE id=?",
      )
      .run(state, this.clock(), reason, row.id);
    if (path) rmSync(path, { force: true });
  }

  // ---- Claimant -----------------------------------------------------------
  // `task` is the caller's fresh view: {taskId, open, sponsorId, arbiterId,...}.
  async upload(player, accountId, task, image) {
    assert(
      task && task.open === true,
      "This task is not accepting evidence from this wallet now.",
      409,
    );
    assert(
      accountId !== task.sponsorId && accountId !== task.arbiterId,
      "Sponsors and the arbiter cannot submit evidence.",
      403,
    );
    const now = this.clock();
    const count = (since) =>
      this.db
        .prepare(
          "SELECT count(*) n FROM task_evidence_photos WHERE player_id=? AND created_at>?",
        )
        .get(player, since).n;
    assert(
      count(now - HOUR) < EVIDENCE_POLICY.perHour,
      "You reached the hourly photo limit. Try again later.",
      429,
    );
    assert(
      count(now - DAY) < EVIDENCE_POLICY.perDay,
      "You reached the daily photo limit. Try again tomorrow.",
      429,
    );
    assert(
      this.db
        .prepare(
          "SELECT count(*) n FROM task_evidence_photos WHERE player_id=? AND task_id=? AND state IN('staged','committed','withheld')",
        )
        .get(player, task.taskId).n < EVIDENCE_POLICY.perTask,
      "Remove an earlier photo for this task before adding another.",
      409,
    );
    assert(
      this.db
        .prepare(
          "SELECT count(*) n FROM task_evidence_photos WHERE state IN('staged','committed','withheld')",
        )
        .get().n < EVIDENCE_POLICY.maxActive,
      "Photo evidence storage is full. Try again later.",
      503,
    );
    const clean = await sanitizeImage(image, this, {
      busy: "Photo processing is busy. Please retry shortly.",
    });
    const sha256 = createHash("sha256").update(clean).digest("hex");
    const photoId = id("evidence");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeFileSync(this.file(photoId), clean, { mode: 0o600, flag: "wx" });
    try {
      this.db
        .prepare(
          `INSERT INTO task_evidence_photos(id,player_id,account_id,task_id,sha256,bytes,state,created_at,expires_at)
         VALUES(?,?,?,?,?,?,'staged',?,?)`,
        )
        .run(
          photoId,
          player,
          accountId,
          task.taskId,
          sha256,
          clean.length,
          now,
          now + EVIDENCE_POLICY.stagedTtlMs,
        );
    } catch (error) {
      rmSync(this.file(photoId), { force: true });
      throw error;
    }
    return this.view(this.row(photoId));
  }
  remove(player, photoId) {
    const row = this.row(photoId);
    assert(row.player_id === player, "Photo evidence not found.", 404);
    if (LIVE.includes(row.state)) this.close(row, "deleted", "owner");
    return this.view(this.row(photoId));
  }

  // ---- Binding and access -------------------------------------------------
  // Promote staged photos of this task whose digest an on-chain submission
  // from the same wallet commits to, and shorten retention once settled.
  bind(task) {
    const now = this.clock();
    const staged = this.db
      .prepare(
        "SELECT * FROM task_evidence_photos WHERE task_id=? AND state='staged'",
      )
      .all(task.taskId);
    for (const row of staged)
      for (const s of task.submissions || []) {
        if (s.claimantId !== row.account_id) continue;
        const bound = [s.evidence, s.appeal].some(
          (e) =>
            e &&
            e.content_hash ===
              evidenceDigest({
                text: e.text,
                reference: e.reference,
                photo: row.sha256,
              }),
        );
        if (!bound) continue;
        this.db
          .prepare(
            "UPDATE task_evidence_photos SET state='committed',submission_id=?,committed_at=?,expires_at=? WHERE id=? AND state='staged'",
          )
          .run(
            s.submissionId,
            now,
            row.created_at + EVIDENCE_POLICY.maxRetentionMs,
            row.id,
          );
        break;
      }
    if (Number.isSafeInteger(task.settledAtMs))
      this.db
        .prepare(
          "UPDATE task_evidence_photos SET expires_at=min(expires_at,?) WHERE task_id=? AND state IN('committed','withheld')",
        )
        .run(task.settledAtMs + EVIDENCE_POLICY.afterSettlementMs, task.taskId);
  }
  role(player, accountId, row, task) {
    if (row.player_id === player) return "owner";
    if (!accountId || !task || task.taskId !== row.task_id) return null;
    if (accountId === task.sponsorId) return "sponsor";
    if (accountId === task.arbiterId) return "arbiter";
    return null;
  }
  list(player, accountId, task) {
    this.bind(task);
    const reviewer =
      !!accountId &&
      (accountId === task.sponsorId || accountId === task.arbiterId);
    const own = this.db
      .prepare(
        "SELECT * FROM task_evidence_photos WHERE task_id=? AND player_id=? ORDER BY created_at DESC LIMIT 20",
      )
      .all(task.taskId, player)
      .map((row) => this.view(row, "owner"));
    const review = reviewer
      ? this.db
          .prepare(
            "SELECT * FROM task_evidence_photos WHERE task_id=? AND state IN('committed','withheld') AND player_id!=? ORDER BY submission_id,created_at LIMIT 64",
          )
          .all(task.taskId, player)
          .map((row) =>
            this.view(
              row,
              accountId === task.sponsorId ? "sponsor" : "arbiter",
            ),
          )
      : [];
    return { taskId: task.taskId, policy: EVIDENCE_POLICY, own, review };
  }
  open(player, accountId, photoId, task) {
    const row = this.row(photoId);
    if (task) this.bind(task);
    const current = this.row(photoId);
    const role = this.role(player, accountId, current, task);
    assert(role, "Photo evidence not found.", 404);
    if (role !== "owner")
      assert(
        current.state === "committed",
        current.state === "withheld"
          ? "This photo is withheld while moderation reviews it."
          : "Photo evidence not found.",
        current.state === "withheld" ? 451 : 404,
      );
    else
      assert(
        ["staged", "committed"].includes(current.state),
        current.state === "withheld"
          ? "This photo is withheld while moderation reviews it."
          : "This photo was erased.",
        current.state === "withheld" ? 451 : 410,
      );
    const path = this.file(photoId);
    assert(path && existsSync(path), "This photo was erased.", 410);
    if (role !== "owner")
      this.db
        .prepare("INSERT INTO task_evidence_views VALUES(?,?,?,?,?)")
        .run(photoId, player, accountId, role, this.clock());
    return { path, role, photo: this.view(current, role) };
  }

  // ---- Moderation hooks (called inside the moderation transaction) -------
  describe(photoId) {
    const row = this.row(photoId);
    const views = this.db
      .prepare("SELECT count(*) n FROM task_evidence_views WHERE photo_id=?")
      .get(photoId).n;
    return {
      state: row.state,
      preview: {
        taskId: row.task_id,
        accountId: row.account_id,
        submissionId: row.submission_id,
        sha256: row.sha256,
        file: LIVE.includes(row.state) ? this.file(row.id) : null,
        views,
      },
      authorId: row.player_id,
    };
  }
  moderate(photoId, action) {
    const row = this.row(photoId);
    if (action === "hide") {
      assert(
        ["staged", "committed"].includes(row.state),
        "Only stored photos can be withheld.",
        409,
      );
      this.db
        .prepare(
          "UPDATE task_evidence_photos SET state='withheld',close_reason=? WHERE id=?",
        )
        .run(row.state, photoId);
      return "withheld";
    }
    if (action === "restore") {
      assert(
        row.state === "withheld",
        "Only withheld photos can be restored.",
        409,
      );
      const back = row.close_reason === "staged" ? "staged" : "committed";
      this.db
        .prepare(
          "UPDATE task_evidence_photos SET state=?,close_reason=NULL WHERE id=?",
        )
        .run(back, photoId);
      return back;
    }
    if (action === "tombstone") {
      if (LIVE.includes(row.state)) this.close(row, "erased", "moderation");
      return "erased";
    }
    return row.state;
  }

  // ---- Retention ----------------------------------------------------------
  prune({ limit = 200 } = {}) {
    const now = this.clock();
    const due = this.db
      .prepare(
        "SELECT * FROM task_evidence_photos WHERE state IN('staged','committed','withheld') AND expires_at<=? ORDER BY expires_at LIMIT ?",
      )
      .all(now, limit);
    for (const row of due) this.close(row, "expired", "retention");
    this.db
      .prepare("DELETE FROM task_evidence_views WHERE viewed_at<?")
      .run(now - EVIDENCE_POLICY.viewLogRetentionMs);
    // Files without a live row (for example after a crash between write and
    // insert) are removed once they are an hour old.
    let orphans = 0;
    if (existsSync(this.directory)) {
      const live = this.db.prepare(
        "SELECT 1 FROM task_evidence_photos WHERE id=? AND state IN('staged','committed','withheld')",
      );
      for (const name of readdirSync(this.directory).slice(0, 1000)) {
        const photoId = name.replace(/\.jpg$/, "");
        const path = this.file(photoId);
        if (!path || live.get(photoId)) continue;
        try {
          if (lstatSync(path).mtimeMs < now - HOUR) {
            rmSync(path, { force: true });
            orphans++;
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    return { expired: due.length, orphans };
  }
}

// Turn a NativeTasks snapshot into the minimal view this module needs.
export function evidenceTaskView(snapshot, taskId, arbiterId) {
  const task = snapshot?.tasks?.find((t) => t.task_id === taskId);
  assert(task, "Task not found.", 404);
  const actions = snapshot.selectedTaskId === taskId ? snapshot.actions : null;
  return {
    taskId,
    sponsorId: task.sponsor_id,
    arbiterId,
    settledAtMs: task.settled_at_ms,
    open:
      !!actions &&
      (actions.submit === true ||
        (actions.appealSubmissionId !== null &&
          actions.appealSubmissionId !== undefined)),
    submissions: (snapshot.selectedTaskId === taskId
      ? snapshot.submissions || []
      : []
    ).map((s) => ({
      submissionId: s.submission_id,
      claimantId: s.claimant_id,
      evidence: s.evidence,
      appeal: s.appeal,
    })),
  };
}

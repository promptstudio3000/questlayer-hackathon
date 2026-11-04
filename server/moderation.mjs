// One operator moderation queue for every kind of player content (W10.4).
//
// Kinds:
//   note     public map notes (reports live in social_reports)
//   record   NEAR Social records of a note (reports live here)
//   quest    creator quests (reports live in creator_reports)
//   evidence private sponsored-task photos (reports live here)
//
// Flow: a player reports -> an operator reviews the grouped queue -> the
// operator hides, restores, dismisses or tombstones the target. Report counts
// never hide anything automatically. Every decision appends a row to a
// hash-chained audit log, so a later edit or deletion of a row is detectable
// with `verifyAudit`. Operator authority never comes from an HTTP request; the
// local CLI supplies it (server/cli/moderate.mjs).
import { createHash } from "node:crypto";
import { assert, id } from "./domain.mjs";
import { REPORT_REASONS, isSocialBlocked } from "./social-content.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "./schema-compatibility.mjs";

export const MODERATION_SCHEMA = registerModuleSchema({
  name: "moderation",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS moderation_reports(
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('record','evidence')),
 target_id TEXT NOT NULL,
 reporter_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 detail TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('open','resolved')),
 created_at INTEGER NOT NULL,
 resolved_at INTEGER,
 UNIQUE(kind,target_id,reporter_id)
);
CREATE TABLE IF NOT EXISTS moderation_suppressions(
 kind TEXT NOT NULL CHECK(kind IN ('note','record','quest','evidence')),
 target_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('hidden','tombstoned')),
 reason TEXT NOT NULL,
 operator TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(kind,target_id)
);
CREATE TABLE IF NOT EXISTS moderation_audit(
 seq INTEGER PRIMARY KEY,
 id TEXT NOT NULL UNIQUE,
 operator TEXT NOT NULL,
 kind TEXT NOT NULL,
 target_id TEXT NOT NULL,
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 before_state TEXT NOT NULL,
 after_state TEXT NOT NULL,
 reports TEXT NOT NULL CHECK(json_valid(reports)),
 created_at INTEGER NOT NULL,
 prev_hash TEXT NOT NULL,
 hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS moderation_reports_queue ON moderation_reports(state,created_at,id);
CREATE INDEX IF NOT EXISTS moderation_reports_rate ON moderation_reports(reporter_id,created_at);
CREATE INDEX IF NOT EXISTS moderation_audit_target ON moderation_audit(kind,target_id,seq)`,
});

export const MODERATION_KINDS = ["note", "record", "quest", "evidence"];
export const MODERATION_ACTIONS = {
  note: ["hide", "restore", "dismiss", "tombstone"],
  record: ["hide", "restore", "dismiss", "tombstone"],
  quest: ["hide", "dismiss"],
  evidence: ["hide", "restore", "dismiss", "tombstone"],
};
const GENESIS = "0".repeat(64);
const DAY = 86400000;

// Cheap read for other modules (records prepare, pin worker): no schema setup.
export function moderationSuppression(db, kind, targetId) {
  const exists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='moderation_suppressions'",
    )
    .get();
  return exists
    ? (db
        .prepare(
          "SELECT state FROM moderation_suppressions WHERE kind=? AND target_id=?",
        )
        .get(kind, targetId)?.state ?? null)
    : null;
}

function line(value, label, max, optional = false) {
  assert(
    typeof value === "string" &&
      value.length <= max &&
      (optional || value.trim().length > 0) &&
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
    `${label} must contain ${optional ? "up to" : "1–"}${max} characters.`,
  );
  return value.trim();
}
function auditHash(prev, row) {
  return createHash("sha256")
    .update(
      prev +
        JSON.stringify([
          row.id,
          row.operator,
          row.kind,
          row.target_id,
          row.action,
          row.reason,
          row.before_state,
          row.after_state,
          row.reports,
          row.created_at,
        ]),
    )
    .digest("hex");
}
const has = (db, table) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);

export class Moderation {
  constructor(
    db,
    {
      clock = Date.now,
      authorizeOperator = () => false,
      creators = null,
      evidence = null,
    } = {},
  ) {
    this.db = db;
    this.clock = clock;
    this.authorizeOperator = authorizeOperator;
    this.creators = creators;
    this.evidence = evidence;
    ensureModuleVersion(db, MODERATION_SCHEMA);
  }
  operator(actor) {
    assert(
      typeof actor === "string" &&
        /^[A-Za-z0-9_.@-]{1,80}$/.test(actor) &&
        this.authorizeOperator(actor) === true,
      "Operator authorization is required.",
      403,
    );
  }
  transaction(run) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = run();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // ---- Player reports for records and evidence -----------------------------
  // `canSee(player)` lets the caller enforce kind-specific visibility first.
  report(
    player,
    { kind, targetId, reason, detail = "" } = {},
    { canSee } = {},
  ) {
    assert(
      typeof player === "string" &&
        this.db.prepare("SELECT 1 FROM players WHERE id=?").get(player),
      "Sign in to report content.",
      401,
    );
    assert(["record", "evidence"].includes(kind), "Choose what to report.");
    assert(
      typeof targetId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(targetId),
      "Content not found.",
      404,
    );
    assert(REPORT_REASONS.includes(reason), "Choose a report reason.");
    const text = line(detail ?? "", "Report details", 500, true);
    return this.transaction(() => {
      const old = this.db
        .prepare(
          "SELECT id,state FROM moderation_reports WHERE kind=? AND target_id=? AND reporter_id=?",
        )
        .get(kind, targetId, player);
      if (old) return { ...old, replayed: true };
      if (kind === "record") {
        const note = this.db
          .prepare(
            "SELECT m.player_id FROM messages m WHERE m.id=? AND EXISTS(SELECT 1 FROM social_record_publications p WHERE p.note_id=m.id AND p.kind='note' AND p.state='confirmed')",
          )
          .get(targetId);
        assert(note, "Public record not found.", 404);
        assert(
          note.player_id !== player,
          "Use Remove for your own record.",
          409,
        );
        assert(
          !isSocialBlocked(this.db, player, note.player_id),
          "Public record not found.",
          404,
        );
      } else {
        assert(canSee?.(player) === true, "Photo evidence not found.", 404);
      }
      const recent = this.db
        .prepare(
          "SELECT count(*) n FROM moderation_reports WHERE reporter_id=? AND created_at>?",
        )
        .get(player, this.clock() - DAY).n;
      assert(
        recent < 20,
        "The daily report limit is reached. Try again tomorrow.",
        429,
      );
      const reportId = id("modreport");
      this.db
        .prepare(
          "INSERT INTO moderation_reports VALUES(?,?,?,?,?,?,'open',?,NULL)",
        )
        .run(reportId, kind, targetId, player, reason, text, this.clock());
      return { id: reportId, state: "open", replayed: false };
    });
  }

  // ---- Queue ---------------------------------------------------------------
  queue(actor, { state = "open", kinds = MODERATION_KINDS, limit = 50 } = {}) {
    this.operator(actor);
    assert(
      ["open", "resolved"].includes(state) &&
        Array.isArray(kinds) &&
        kinds.every((k) => MODERATION_KINDS.includes(k)) &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 100,
      "Invalid moderation queue request.",
    );
    const items = [];
    const group = (kind, rows, describe) => {
      const map = new Map();
      for (const r of rows) {
        const g = map.get(r.target) || {
          kind,
          targetId: r.target,
          reports: [],
          firstReportedAt: r.created_at,
        };
        g.reports.push({
          id: r.id,
          reason: r.reason,
          detail: r.detail,
          reportedAt: r.created_at,
          ...(r.version ? { version: r.version } : {}),
        });
        g.firstReportedAt = Math.min(g.firstReportedAt, r.created_at);
        map.set(r.target, g);
      }
      for (const g of map.values()) {
        let described;
        try {
          described = describe(g.targetId);
        } catch {
          described = { state: "missing", preview: null };
        }
        items.push({
          ...g,
          reportCount: g.reports.length,
          state: described.state,
          preview: described.preview,
          actions: MODERATION_ACTIONS[kind],
        });
      }
    };
    if (kinds.includes("note") && has(this.db, "social_reports"))
      group(
        "note",
        this.db
          .prepare(
            "SELECT id,note_id AS target,reason,detail,created_at FROM social_reports WHERE state=? ORDER BY created_at,id LIMIT 500",
          )
          .all(state),
        (t) => this.describe("note", t),
      );
    for (const kind of ["record", "evidence"])
      if (kinds.includes(kind) && (kind !== "evidence" || this.evidence))
        group(
          kind,
          this.db
            .prepare(
              "SELECT id,target_id AS target,reason,detail,created_at FROM moderation_reports WHERE kind=? AND state=? ORDER BY created_at,id LIMIT 500",
            )
            .all(kind, state),
          (t) => this.describe(kind, t),
        );
    if (kinds.includes("quest") && has(this.db, "creator_reports"))
      group(
        "quest",
        this.db
          .prepare(
            "SELECT id,quest_id AS target,reason,detail,created_at,version FROM creator_reports WHERE status=? ORDER BY created_at,id LIMIT 500",
          )
          .all(state === "open" ? "open" : "reviewed"),
        (t) => this.describe("quest", t),
      );
    items.sort(
      (a, b) =>
        a.firstReportedAt - b.firstReportedAt ||
        a.targetId.localeCompare(b.targetId),
    );
    return { state, items: items.slice(0, limit), total: items.length };
  }

  describe(kind, targetId) {
    if (kind === "note" || kind === "record") {
      const note = this.db
        .prepare(
          `SELECT m.id,m.text,m.image,m.lat,m.lng,m.player_id,s.state FROM messages m
        JOIN social_note_meta s ON s.note_id=m.id WHERE m.id=?`,
        )
        .get(targetId);
      assert(note, "Note not found.", 404);
      const suppression = moderationSuppression(this.db, kind, targetId);
      if (kind === "note")
        return {
          state: note.state,
          authorId: note.player_id,
          preview: {
            text: note.text,
            image: note.image,
            lat: note.lat,
            lng: note.lng,
          },
        };
      const publication = has(this.db, "social_record_publications")
        ? this.db
            .prepare(
              "SELECT account_id,kind,record FROM social_record_publications WHERE note_id=? AND state='confirmed' ORDER BY confirmed_at DESC LIMIT 1",
            )
            .get(targetId)
        : null;
      return {
        state:
          suppression ||
          (publication?.kind === "tombstone" ? "removed" : "published"),
        authorId: note.player_id,
        noteState: note.state,
        preview: {
          accountId: publication?.account_id ?? null,
          record: publication ? JSON.parse(publication.record) : null,
          note: { text: note.text, image: note.image },
        },
      };
    }
    if (kind === "quest") {
      const quest = this.db
        .prepare(
          "SELECT id,author,state,version FROM creator_quests WHERE id=?",
        )
        .get(targetId);
      assert(quest, "Creator quest not found.", 404);
      return {
        state: quest.state,
        authorId: quest.author,
        preview: { version: quest.version },
      };
    }
    assert(this.evidence, "Photo evidence is not configured.", 503);
    return this.evidence.describe(targetId);
  }

  // ---- Decisions -----------------------------------------------------------
  async decide(actor, { kind, targetId, action, reason, operationId } = {}) {
    this.operator(actor);
    assert(MODERATION_KINDS.includes(kind), "Choose a content kind.");
    assert(
      MODERATION_ACTIONS[kind].includes(action),
      `Use ${MODERATION_ACTIONS[kind].join(", ")} for ${kind} content.`,
    );
    assert(
      typeof targetId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(targetId),
      "Content not found.",
      404,
    );
    const why = line(reason, "Moderation reason", 500);
    this.pending = { operator: actor, reason: why };
    if (kind === "quest")
      return this.decideQuest(actor, targetId, action, why, operationId);
    return this.transaction(() => {
      const before = this.describe(kind, targetId);
      let after;
      if (kind === "note") after = this.applyNote(targetId, before, action);
      else if (kind === "record")
        after = this.applyRecord(actor, targetId, before, action, why);
      else after = this.evidence.moderate(targetId, action);
      const reports = this.resolveReports(kind, targetId, action);
      return this.appendAudit({
        operator: actor,
        kind,
        targetId,
        action,
        reason: why,
        before: before.state,
        after,
        reports,
      });
    });
  }
  applyNote(noteId, before, action) {
    assert(
      before.state !== "deleted",
      "Removed notes cannot be restored or moderated.",
      409,
    );
    const now = this.clock();
    if (action === "dismiss") return before.state;
    if (action === "tombstone") {
      const image = before.preview.image;
      if (image)
        this.db
          .prepare("INSERT OR IGNORE INTO social_media_retirements VALUES(?,?)")
          .run(image, now);
      this.db
        .prepare(
          "UPDATE messages SET text='',lat=0,lng=0,image=NULL,author_fix=NULL WHERE id=?",
        )
        .run(noteId);
      this.db
        .prepare(
          "UPDATE social_note_meta SET state='deleted',updated_at=? WHERE note_id=?",
        )
        .run(now, noteId);
      this.suppress("note", noteId, "tombstoned");
      return "deleted";
    }
    const next = action === "hide" ? "hidden" : "published";
    this.db
      .prepare(
        "UPDATE social_note_meta SET state=?,updated_at=? WHERE note_id=?",
      )
      .run(next, now, noteId);
    if (action === "hide") this.suppress("note", noteId, "hidden");
    else this.unsuppress("note", noteId);
    return next;
  }
  applyRecord(actor, noteId, before, action) {
    assert(
      before.state !== "tombstoned",
      "This record is already tombstoned.",
      409,
    );
    if (action === "dismiss") return before.state;
    if (action === "restore") {
      assert(
        before.state === "hidden",
        "Only hidden records can be restored.",
        409,
      );
      this.unsuppress("record", noteId);
      if (
        before.noteState === "hidden" &&
        !moderationSuppression(this.db, "note", noteId)
      )
        this.db
          .prepare(
            "UPDATE social_note_meta SET state='published',updated_at=? WHERE note_id=?",
          )
          .run(this.clock(), noteId);
      return "published";
    }
    // Hide and tombstone both stop the app from showing, republishing or
    // pinning the record. The chain copy under the author's own account cannot
    // be erased by the operator; the record view says so.
    const media = before.preview.note.image;
    if (media && has(this.db, "social_record_media"))
      this.db
        .prepare(
          "UPDATE social_record_media SET state='unavailable',last_error='Withdrawn by moderation.',updated_at=? WHERE image=?",
        )
        .run(this.clock(), media);
    if (action === "hide") {
      if (before.noteState === "published")
        this.db
          .prepare(
            "UPDATE social_note_meta SET state='hidden',updated_at=? WHERE note_id=?",
          )
          .run(this.clock(), noteId);
      this.suppress("record", noteId, "hidden");
      return "hidden";
    }
    if (before.noteState !== "deleted")
      this.applyNote(
        noteId,
        { state: before.noteState, preview: before.preview.note },
        "tombstone",
      );
    this.suppress("record", noteId, "tombstoned");
    return "tombstoned";
  }
  async decideQuest(actor, questId, action, why, operationId) {
    assert(
      this.creators,
      "Creator moderation needs the creator services enabled.",
      503,
    );
    const op = (suffix) =>
      `${(operationId || id("modop")).slice(0, 48)}-${suffix}`.slice(0, 64);
    const before = this.describe("quest", questId);
    const open = this.db
      .prepare(
        "SELECT id,version FROM creator_reports WHERE quest_id=? AND status='open' ORDER BY created_at,id",
      )
      .all(questId);
    if (action === "hide" && !["closed", "closing"].includes(before.state)) {
      this.creators.lifecycle.suspend({
        actor,
        operationId: op("suspend"),
        questId,
        expectedVersion: before.preview.version,
        reason: why,
      });
    }
    open.forEach((r, i) =>
      this.creators.safety.reviewReport({
        actor,
        operationId: op(`r${i}`),
        reportId: r.id,
        expectedVersion: r.version,
        decision: action === "hide" ? "confirmed" : "dismissed",
        reason: why,
      }),
    );
    if (action === "hide")
      this.transaction(() => this.suppress("quest", questId, "hidden"));
    return this.transaction(() =>
      this.appendAudit({
        operator: actor,
        kind: "quest",
        targetId: questId,
        action,
        reason: why,
        before: before.state,
        after: this.describe("quest", questId).state,
        reports: open.map((r) => r.id),
      }),
    );
  }
  suppress(kind, targetId, state) {
    this.db
      .prepare(
        `INSERT INTO moderation_suppressions VALUES(?,?,?,?,?,?)
       ON CONFLICT(kind,target_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,operator=excluded.operator,updated_at=excluded.updated_at`,
      )
      .run(
        kind,
        targetId,
        state,
        this.pending?.reason || "",
        this.pending?.operator || "",
        this.clock(),
      );
  }
  unsuppress(kind, targetId) {
    this.db
      .prepare(
        "DELETE FROM moderation_suppressions WHERE kind=? AND target_id=?",
      )
      .run(kind, targetId);
  }
  resolveReports(kind, targetId, action) {
    const now = this.clock();
    if (kind === "note") {
      const ids = this.db
        .prepare(
          "SELECT id FROM social_reports WHERE note_id=? AND state='open' ORDER BY created_at,id",
        )
        .all(targetId)
        .map((r) => r.id);
      this.db
        .prepare(
          `UPDATE social_reports SET state='resolved',updated_at=?${action === "tombstone" ? ",detail=''" : ""} WHERE note_id=? AND state='open'`,
        )
        .run(now, targetId);
      return ids;
    }
    const ids = this.db
      .prepare(
        "SELECT id FROM moderation_reports WHERE kind=? AND target_id=? AND state='open' ORDER BY created_at,id",
      )
      .all(kind, targetId)
      .map((r) => r.id);
    this.db
      .prepare(
        `UPDATE moderation_reports SET state='resolved',resolved_at=?${action === "tombstone" ? ",detail=''" : ""} WHERE kind=? AND target_id=? AND state='open'`,
      )
      .run(now, kind, targetId);
    return ids;
  }
  appendAudit({
    operator,
    kind,
    targetId,
    action,
    reason,
    before,
    after,
    reports,
  }) {
    const last = this.db
      .prepare("SELECT hash FROM moderation_audit ORDER BY seq DESC LIMIT 1")
      .get();
    const row = {
      id: id("modaudit"),
      operator,
      kind,
      target_id: targetId,
      action,
      reason,
      before_state: String(before),
      after_state: String(after),
      reports: JSON.stringify(reports),
      created_at: this.clock(),
    };
    const prev = last?.hash ?? GENESIS;
    const hash = auditHash(prev, row);
    this.db
      .prepare(
        `INSERT INTO moderation_audit(id,operator,kind,target_id,action,reason,before_state,after_state,reports,created_at,prev_hash,hash)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        operator,
        kind,
        targetId,
        action,
        reason,
        row.before_state,
        row.after_state,
        row.reports,
        row.created_at,
        prev,
        hash,
      );
    return {
      auditId: row.id,
      kind,
      targetId,
      action,
      before: row.before_state,
      after: row.after_state,
      resolvedReports: reports,
      hash,
    };
  }

  // ---- Audit trail ---------------------------------------------------------
  audit(actor, { kind, targetId, limit = 50 } = {}) {
    this.operator(actor);
    assert(
      Number.isSafeInteger(limit) && limit > 0 && limit <= 500,
      "Invalid audit request.",
    );
    const where = [],
      args = [];
    if (kind) {
      assert(MODERATION_KINDS.includes(kind), "Choose a content kind.");
      where.push("kind=?");
      args.push(kind);
    }
    if (targetId) {
      where.push("target_id=?");
      args.push(targetId);
    }
    return {
      entries: this.db
        .prepare(
          `SELECT * FROM moderation_audit ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`,
        )
        .all(...args, limit)
        .map((r) => ({ ...r, reports: JSON.parse(r.reports) })),
    };
  }
  verifyAudit() {
    let prev = GENESIS,
      count = 0;
    for (const row of this.db
      .prepare("SELECT * FROM moderation_audit ORDER BY seq")
      .all()) {
      if (row.prev_hash !== prev || auditHash(prev, row) !== row.hash)
        return { ok: false, count, brokenAt: row.id };
      prev = row.hash;
      count++;
    }
    return { ok: true, count, head: prev };
  }
}

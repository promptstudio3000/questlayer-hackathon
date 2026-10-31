import { randomUUID } from "node:crypto";
import { assert, hash, id, point, validateFix } from "./domain.mjs";

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "unsafe-place",
  "privacy",
  "other",
];
const LEASE_MS = 60000;
const initializedBlocks = new WeakSet();
export function initSocialBlocks(db) {
  if (initializedBlocks.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS social_blocks (
    actor_id TEXT NOT NULL REFERENCES players(id), target_id TEXT NOT NULL REFERENCES players(id),
    created_at INTEGER NOT NULL, PRIMARY KEY(actor_id,target_id), CHECK(actor_id!=target_id));
    CREATE INDEX IF NOT EXISTS social_blocks_target ON social_blocks(target_id,actor_id);`);
  initializedBlocks.add(db);
}
export function isSocialBlocked(db, first, second) {
  initSocialBlocks(db);
  return !!db
    .prepare(
      `SELECT 1 FROM social_blocks WHERE
    (actor_id=? AND target_id=?) OR (actor_id=? AND target_id=?)`,
    )
    .get(first, second, second, first);
}
export function initSocialContent(db) {
  initSocialBlocks(db);
  db.exec(`CREATE TABLE IF NOT EXISTS social_note_meta (
    note_id TEXT PRIMARY KEY REFERENCES messages(id), arena INTEGER NOT NULL CHECK(arena IN(0,1)),
    state TEXT NOT NULL CHECK(state IN('published','hidden','deleted')), updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS social_note_operations (
      player_id TEXT NOT NULL REFERENCES players(id), client_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN('processing','failed','complete','abandoned')), lease_id TEXT,
      lease_until INTEGER, note_id TEXT REFERENCES messages(id), created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY(player_id,client_id));
    CREATE INDEX IF NOT EXISTS social_note_operations_rate ON social_note_operations(player_id,created_at);
    CREATE TABLE IF NOT EXISTS social_reports (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES messages(id), reporter_id TEXT NOT NULL REFERENCES players(id),
      reason TEXT NOT NULL, detail TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('open','resolved')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(note_id,reporter_id));
    CREATE TABLE IF NOT EXISTS social_audit (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS social_audit_actor ON social_audit(actor_id,created_at);
    INSERT OR IGNORE INTO social_note_meta(note_id,arena,state,updated_at)
      SELECT id,1,'published',created_at FROM messages;`);
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
function operationId(value) {
  assert(
    typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value),
    "Invalid note operation ID.",
  );
  return value;
}
function mediaPath(value) {
  return (
    typeof value === "string" &&
    /^\/api\/media\/image_[a-f0-9-]+\.jpg$/.test(value)
  );
}
function transaction(db, run) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export class SocialContent {
  constructor(db, { clock = Date.now, authorizeOperator = () => false } = {}) {
    this.db = db;
    this.clock = clock;
    this.authorizeOperator = authorizeOperator;
    initSocialContent(db);
  }
  player(player) {
    assert(
      typeof player === "string" &&
        this.db.prepare("SELECT 1 FROM players WHERE id=?").get(player),
      "Sign in to use map notes.",
      401,
    );
  }
  audit(actor, action, target, reason = "") {
    this.db
      .prepare("INSERT INTO social_audit VALUES (?,?,?,?,?,?)")
      .run(id("audit"), actor, action, target, reason, this.clock());
  }
  note(noteId) {
    assert(
      typeof noteId === "string" && noteId.length <= 100,
      "Note not found.",
      404,
    );
    const row = this.db
      .prepare(
        `SELECT m.*,p.name AS author,s.arena,s.state FROM messages m
      JOIN players p ON p.id=m.player_id JOIN social_note_meta s ON s.note_id=m.id WHERE m.id=?`,
      )
      .get(noteId);
    assert(row, "Note not found.", 404);
    return row;
  }
  list(player, input) {
    this.player(player);
    const { lat, lng } = point(input);
    assert(typeof input.arena === "boolean", "Choose the note map mode.");
    const rows = this.db
      .prepare(
        `SELECT m.*,p.name AS author,s.arena,s.state FROM messages m
      JOIN players p ON p.id=m.player_id JOIN social_note_meta s ON s.note_id=m.id
      WHERE s.state='published' AND s.arena=? AND m.lat BETWEEN ? AND ? AND m.lng BETWEEN ? AND ?
      AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE
        (b.actor_id=? AND b.target_id=m.player_id) OR (b.target_id=? AND b.actor_id=m.player_id))
      ORDER BY m.created_at DESC,m.id DESC LIMIT 50`,
      )
      .all(
        input.arena ? 1 : 0,
        lat - 0.025,
        lat + 0.025,
        lng - 0.04,
        lng + 0.04,
        player,
        player,
      );
    return {
      messages: rows.map((row) => ({
        ...row,
        arena: !!row.arena,
        own: row.player_id === player,
        author_fix: row.author_fix ? JSON.parse(row.author_fix) : null,
      })),
    };
  }
  operation(player, clientId) {
    this.player(player);
    operationId(clientId);
    const row = this.db
      .prepare(
        "SELECT * FROM social_note_operations WHERE player_id=? AND client_id=?",
      )
      .get(player, clientId);
    if (!row) return { found: false };
    if (row.state === "abandoned") return { found: true, state: "abandoned" };
    if (row.note_id)
      return {
        found: true,
        id: row.note_id,
        state: this.note(row.note_id).state,
      };
    return {
      found: true,
      state:
        row.state === "processing" && row.lease_until > this.clock()
          ? "processing"
          : "retryable",
      retryAfterMs: Math.max(0, (row.lease_until || 0) - this.clock()),
    };
  }
  abandonOperation(player, clientId) {
    this.player(player);
    operationId(clientId);
    return transaction(this.db, () => {
      const old = this.db
        .prepare(
          "SELECT * FROM social_note_operations WHERE player_id=? AND client_id=?",
        )
        .get(player, clientId);
      if (old?.note_id)
        return {
          found: true,
          id: old.note_id,
          state: this.note(old.note_id).state,
        };
      if (!old) {
        const count = this.db
          .prepare(
            "SELECT count(*) AS n FROM social_note_operations WHERE player_id=? AND created_at>?",
          )
          .get(player, this.clock() - 86400000).n;
        assert(
          count < 50,
          "The daily note operation limit is reached. Try again tomorrow.",
          429,
        );
        this.db
          .prepare(
            "INSERT INTO social_note_operations VALUES(?,?,'','abandoned',NULL,NULL,NULL,?,?)",
          )
          .run(player, clientId, this.clock(), this.clock());
      } else
        this.db
          .prepare(
            "UPDATE social_note_operations SET state='abandoned',lease_id=NULL,lease_until=NULL,updated_at=? WHERE player_id=? AND client_id=?",
          )
          .run(this.clock(), player, clientId);
      if (old?.state !== "abandoned")
        this.audit(player, "note-operation-abandoned", clientId);
      return { found: true, state: "abandoned" };
    });
  }
  normalize(input) {
    assert(input && typeof input === "object", "Enter a map note.");
    operationId(input.clientId);
    point(input);
    assert(
      input.publicConsent === true,
      "Confirm that this note and its map anchor will be public.",
    );
    assert(
      typeof input.arena === "boolean" && typeof input.shareGps === "boolean",
      "Choose the map mode and GPS sharing preference.",
    );
    const text = line(input.text, "A note", 500),
      image = input.image || null;
    assert(
      image === null ||
        (typeof image === "string" &&
          image.length <= 1400000 &&
          /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
            image,
          )),
      "Use a JPG, PNG or WebP image smaller than 1 MB.",
    );
    let fix = null;
    if (input.shareGps) {
      assert(
        !input.arena,
        "Demo movement cannot be published as the author's GPS.",
      );
      point(input.fix);
      assert(
        Number.isFinite(input.fix.accuracy) &&
          input.fix.accuracy >= 0 &&
          input.fix.accuracy <= 35 &&
          Number.isSafeInteger(input.fix.timestamp),
        "A current, accurate GPS fix is required.",
      );
      fix = {
        lat: input.fix.lat,
        lng: input.fix.lng,
        accuracy: input.fix.accuracy,
        timestamp: input.fix.timestamp,
      };
    }
    const record = {
      text,
      lat: input.lat,
      lng: input.lng,
      arena: input.arena,
      shareGps: input.shareGps,
      fix,
      imageHash: image ? hash(image) : null,
      publicConsent: true,
    };
    return {
      ...record,
      clientId: input.clientId,
      image,
      requestHash: hash(JSON.stringify(record)),
    };
  }
  async create(
    player,
    input,
    { storeImage, removeImage = async () => {}, assertSession = () => {} } = {},
  ) {
    this.player(player);
    assertSession();
    const value = this.normalize(input),
      now = this.clock(),
      leaseId = randomUUID();
    const claim = transaction(this.db, () => {
      const old = this.db
        .prepare(
          "SELECT * FROM social_note_operations WHERE player_id=? AND client_id=?",
        )
        .get(player, value.clientId);
      if (old) {
        assert(
          old.state !== "abandoned",
          "This note operation was abandoned and cannot be published.",
          409,
          "NOTE_ABANDONED",
        );
        assert(
          old.request_hash === value.requestHash,
          "This note operation already has different content. Check its receipt first.",
          409,
        );
        if (old.note_id)
          return {
            id: old.note_id,
            state: this.note(old.note_id).state,
            replayed: true,
          };
        assert(
          old.state !== "processing" || old.lease_until <= now,
          "This note is still being prepared. Check its receipt before retrying.",
          409,
          "NOTE_PROCESSING",
        );
      }
      if (value.fix) validateFix(value.fix, value.fix, now);
      if (!old) {
        const count = this.db
          .prepare(
            "SELECT count(*) AS n FROM social_note_operations WHERE player_id=? AND created_at>?",
          )
          .get(player, now - 86400000).n;
        assert(
          count < 50,
          "The daily note limit is reached. Try again tomorrow.",
          429,
        );
        const recent = this.db
          .prepare(
            "SELECT count(*) AS n FROM social_note_operations WHERE player_id=? AND created_at>?",
          )
          .get(player, now - 3600000).n;
        assert(recent < 10, "Please wait before publishing more notes.", 429);
        this.db
          .prepare(
            "INSERT INTO social_note_operations VALUES(?,?,?,'processing',?,?,NULL,?,?)",
          )
          .run(
            player,
            value.clientId,
            value.requestHash,
            leaseId,
            now + LEASE_MS,
            now,
            now,
          );
      } else
        this.db
          .prepare(
            "UPDATE social_note_operations SET state='processing',lease_id=?,lease_until=?,updated_at=? WHERE player_id=? AND client_id=?",
          )
          .run(leaseId, now + LEASE_MS, now, player, value.clientId);
      return null;
    });
    if (claim) return claim;
    let image = null,
      committed = false;
    try {
      if (value.image) {
        assert(
          typeof storeImage === "function",
          "Photo upload is unavailable. Keep your note and try again.",
          503,
        );
        image = await storeImage(value.image);
        assert(
          mediaPath(image),
          "The photo processor returned an invalid image.",
          503,
        );
      }
      assertSession();
      this.player(player);
      const result = transaction(this.db, () => {
        const op = this.db
          .prepare(
            "SELECT * FROM social_note_operations WHERE player_id=? AND client_id=?",
          )
          .get(player, value.clientId);
        assert(
          op?.state === "processing" &&
            op.lease_id === leaseId &&
            op.lease_until > this.clock(),
          "The note preparation expired. Check its receipt before retrying.",
          409,
          "NOTE_EXPIRED",
        );
        const noteId = id("message");
        this.db
          .prepare(
            "INSERT INTO messages(id,player_id,text,lat,lng,image,author_fix,created_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            noteId,
            player,
            value.text,
            value.lat,
            value.lng,
            image,
            value.fix ? JSON.stringify(value.fix) : null,
            this.clock(),
          );
        this.db
          .prepare("INSERT INTO social_note_meta VALUES(?,?,'published',?)")
          .run(noteId, value.arena ? 1 : 0, this.clock());
        this.db
          .prepare(
            "UPDATE social_note_operations SET state='complete',note_id=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE player_id=? AND client_id=? AND lease_id=?",
          )
          .run(noteId, this.clock(), player, value.clientId, leaseId);
        this.audit(player, "note-published", noteId);
        return { id: noteId, state: "published", replayed: false };
      });
      committed = true;
      return result;
    } catch (error) {
      this.db
        .prepare(
          "UPDATE social_note_operations SET state='failed',lease_id=NULL,lease_until=NULL,updated_at=? WHERE player_id=? AND client_id=? AND lease_id=? AND state='processing'",
        )
        .run(this.clock(), player, value.clientId, leaseId);
      throw error;
    } finally {
      if (image && !committed) {
        try {
          await removeImage(image);
        } catch {
          /* Orphan cleanup retries unreferenced files. */
        }
      }
    }
  }
  remove(player, noteId) {
    this.player(player);
    return transaction(this.db, () => {
      const note = this.note(noteId);
      assert(
        note.player_id === player,
        "Only the author can remove this note.",
        403,
      );
      const removedImage = note.image;
      if (note.state !== "deleted") {
        this.db
          .prepare(
            "UPDATE messages SET text='',lat=0,lng=0,image=NULL,author_fix=NULL WHERE id=?",
          )
          .run(noteId);
        this.db
          .prepare(
            "UPDATE social_note_meta SET state='deleted',updated_at=? WHERE note_id=?",
          )
          .run(this.clock(), noteId);
        this.db
          .prepare(
            "UPDATE social_reports SET state='resolved',detail='',updated_at=? WHERE note_id=?",
          )
          .run(this.clock(), noteId);
        this.audit(player, "note-deleted", noteId);
      }
      return { id: noteId, state: "deleted", removedImage };
    });
  }
  report(player, noteId, input) {
    this.player(player);
    assert(
      input && REPORT_REASONS.includes(input.reason),
      "Choose a report reason.",
    );
    const detail = line(input.detail ?? "", "Report details", 500, true);
    return transaction(this.db, () => {
      const note = this.note(noteId);
      assert(note.player_id !== player, "Use Remove for your own note.", 409);
      const old = this.db
        .prepare(
          "SELECT id,state FROM social_reports WHERE note_id=? AND reporter_id=?",
        )
        .get(noteId, player);
      if (old) return { ...old, replayed: true };
      assert(
        note.state === "published" &&
          !isSocialBlocked(this.db, player, note.player_id),
        "Note not found.",
        404,
      );
      const count = this.db
        .prepare(
          "SELECT count(*) AS n FROM social_reports WHERE reporter_id=? AND created_at>?",
        )
        .get(player, this.clock() - 86400000).n;
      assert(
        count < 20,
        "The daily report limit is reached. Try again tomorrow.",
        429,
      );
      const reportId = id("report");
      this.db
        .prepare("INSERT INTO social_reports VALUES(?,?,?,?,?,'open',?,?)")
        .run(
          reportId,
          noteId,
          player,
          input.reason,
          detail,
          this.clock(),
          this.clock(),
        );
      this.audit(player, "note-reported", noteId, input.reason);
      return { id: reportId, state: "open", replayed: false };
    });
  }
  blocks(player) {
    this.player(player);
    return {
      blocks: this.db
        .prepare(
          `SELECT b.target_id AS playerId,p.name,b.created_at AS createdAt
      FROM social_blocks b JOIN players p ON p.id=b.target_id WHERE b.actor_id=? ORDER BY b.created_at DESC LIMIT 200`,
        )
        .all(player),
    };
  }
  setBlock(player, target, blocked) {
    this.player(player);
    this.player(target);
    assert(
      player !== target && typeof blocked === "boolean",
      "Choose another player to block or unblock.",
    );
    return transaction(this.db, () => {
      const exists = !!this.db
        .prepare("SELECT 1 FROM social_blocks WHERE actor_id=? AND target_id=?")
        .get(player, target);
      if (exists === blocked) return { playerId: target, blocked };
      const recent = this.db
        .prepare(
          "SELECT count(*) AS n FROM social_audit WHERE actor_id=? AND action IN('player-blocked','player-unblocked') AND created_at>?",
        )
        .get(player, this.clock() - 3600000).n;
      assert(
        recent < 100,
        "Please wait before changing more player blocks.",
        429,
      );
      if (blocked) {
        const n = this.db
          .prepare("SELECT count(*) AS n FROM social_blocks WHERE actor_id=?")
          .get(player).n;
        assert(
          n < 200,
          "Your block list is full. Remove an old block first.",
          409,
        );
        this.db
          .prepare("INSERT INTO social_blocks VALUES(?,?,?)")
          .run(player, target, this.clock());
      } else
        this.db
          .prepare("DELETE FROM social_blocks WHERE actor_id=? AND target_id=?")
          .run(player, target);
      this.audit(
        player,
        blocked ? "player-blocked" : "player-unblocked",
        target,
      );
      return { playerId: target, blocked };
    });
  }
  mediaAllowed(player, path) {
    this.player(player);
    if (!mediaPath(path)) return false;
    return !!this.db
      .prepare(
        `SELECT 1 FROM messages m JOIN social_note_meta s ON s.note_id=m.id
      WHERE m.image=? AND s.state='published' AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE
        (b.actor_id=? AND b.target_id=m.player_id) OR (b.target_id=? AND b.actor_id=m.player_id)) LIMIT 1`,
      )
      .get(path, player, player);
  }
  operator(actor) {
    assert(
      typeof actor === "string" &&
        actor.length > 0 &&
        actor.length <= 100 &&
        this.authorizeOperator(actor) === true,
      "Operator authorization is required.",
      403,
    );
  }
  reports(actor, { state = "open", limit = 50 } = {}) {
    this.operator(actor);
    assert(
      ["open", "resolved"].includes(state) &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 100,
      "Invalid report queue request.",
    );
    return {
      reports: this.db
        .prepare(
          `SELECT r.*,m.text,m.lat,m.lng,m.image,m.player_id AS authorId,s.state AS noteState,s.arena
      FROM social_reports r JOIN messages m ON m.id=r.note_id JOIN social_note_meta s ON s.note_id=m.id
      WHERE r.state=? ORDER BY r.created_at,r.id LIMIT ?`,
        )
        .all(state, limit),
    };
  }
  moderate(actor, input) {
    this.operator(actor);
    assert(
      input && ["hide", "restore", "dismiss"].includes(input.action),
      "Choose hide, restore or dismiss.",
    );
    const reason = line(input.reason, "Moderation reason", 500);
    return transaction(this.db, () => {
      const note = this.note(input.noteId);
      assert(
        note.state !== "deleted",
        "Removed notes cannot be restored or moderated.",
        409,
      );
      const next =
        input.action === "hide"
          ? "hidden"
          : input.action === "restore"
            ? "published"
            : note.state;
      if (next !== note.state)
        this.db
          .prepare(
            "UPDATE social_note_meta SET state=?,updated_at=? WHERE note_id=?",
          )
          .run(next, this.clock(), note.id);
      this.db
        .prepare(
          "UPDATE social_reports SET state='resolved',updated_at=? WHERE note_id=? AND state='open'",
        )
        .run(this.clock(), note.id);
      this.audit(actor, `note-${input.action}`, note.id, reason);
      return { id: note.id, state: next };
    });
  }
}

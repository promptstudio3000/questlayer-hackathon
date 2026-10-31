import { atomic } from "../database.mjs";
import { id } from "../domain.mjs";
import {
  creatorAssert as fail,
  creatorKey as key,
  creatorInteger as integer,
  creatorText as text,
  createCreatorOperations,
} from "./operations.mjs";

export const CREATOR_REPORT_REASONS = [
  "unsafe-place",
  "abuse",
  "misleading",
  "other",
];

// Explicit opt-in additive storage. Existing creator rows and receipts are not
// rewritten; disabled runtime construction never calls this initializer.
export function createCreatorSafety(
  db,
  { community, clock = Date.now, isModerator = () => false },
) {
  atomic(db, () =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS creator_reports(
      id TEXT PRIMARY KEY, quest_id TEXT NOT NULL, revision INTEGER NOT NULL,
      reporter TEXT NOT NULL REFERENCES players(id), reason TEXT NOT NULL,
      detail TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('open','reviewed')),
      version INTEGER NOT NULL CHECK(version>0), created_at INTEGER NOT NULL,
      reviewed_at INTEGER, reviewed_by TEXT, decision TEXT, review_reason TEXT,
      FOREIGN KEY(quest_id,revision) REFERENCES creator_revisions(quest_id,revision),
      UNIQUE(quest_id,reporter));
    CREATE INDEX IF NOT EXISTS creator_report_queue ON creator_reports(status,created_at,id);
    CREATE INDEX IF NOT EXISTS creator_report_actor_rate ON creator_reports(reporter,created_at);
    CREATE INDEX IF NOT EXISTS creator_operation_actor_rate ON creator_operations(actor,command,created_at);
  `),
  );
  const operation = createCreatorOperations(db, { clock });
  const hasSocialAudit = () =>
    !!db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='social_audit'",
      )
      .get();
  const ownBlock = (actor, target) =>
    db
      .prepare("SELECT 1 FROM social_blocks WHERE actor_id=? AND target_id=?")
      .get(actor, target);
  const acceptedAuthor = (actor, target) =>
    db
      .prepare(
        `SELECT 1 FROM creator_participations a
    JOIN creator_quests q ON q.id=a.quest_id WHERE a.participant=? AND q.author=? LIMIT 1`,
      )
      .get(actor, target);
  function reportView(row) {
    return {
      questId: row.quest_id,
      revision: row.revision,
      reason: row.reason,
      status: row.status,
      reportedAt: row.created_at,
    };
  }
  return {
    myBlocks(actor, { limit = 20, cursor = "" } = {}) {
      community.myProfile(actor);
      integer(limit, 1);
      fail(
        limit <= 50,
        "Use a Community page of at most 50 entries.",
        "CREATOR_INPUT",
        400,
      );
      if (cursor !== "") key(cursor);
      const rows = db
        .prepare(
          `SELECT b.target_id AS id,
        CASE WHEN p.public=1 AND NOT EXISTS(SELECT 1 FROM social_blocks reverse
          WHERE reverse.actor_id=b.target_id AND reverse.target_id=b.actor_id)
          THEN p.display_name ELSE NULL END AS displayName
        FROM social_blocks b LEFT JOIN creator_profiles p ON p.player_id=b.target_id
        WHERE b.actor_id=? AND b.target_id>? ORDER BY b.target_id LIMIT ?`,
        )
        .all(actor, cursor, limit + 1);
      return {
        domain: "demo",
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
    setBlocked({ actor, operationId, creatorId, blocked }) {
      key(creatorId);
      fail(
        typeof blocked === "boolean" && creatorId !== actor,
        "Choose another creator and a block preference.",
        "CREATOR_INPUT",
        400,
      );
      return operation(
        "setCreatorBlocked",
        actor,
        operationId,
        { creatorId, blocked },
        (now) => {
          community.myProfile(actor);
          const exists = !!ownBlock(actor, creatorId);
          if (blocked && !exists && !acceptedAuthor(actor, creatorId))
            community.profile(actor, creatorId);
          const recent = db
            .prepare(
              `SELECT count(*) n FROM creator_operations
          WHERE actor=? AND command='setCreatorBlocked' AND created_at>?`,
            )
            .get(actor, now - 3600000).n;
          fail(
            recent < 100,
            "Please wait before changing more creator blocks.",
            "CREATOR_RATE_LIMIT",
            429,
          );
          if (exists !== blocked) {
            const sharedAudit = hasSocialAudit();
            if (sharedAudit) {
              const socialRecent = db
                .prepare(
                  `SELECT count(*) n FROM social_audit WHERE actor_id=?
              AND action IN('player-blocked','player-unblocked') AND created_at>?`,
                )
                .get(actor, now - 3600000).n;
              fail(
                socialRecent < 100,
                "Please wait before changing more player blocks.",
                "CREATOR_RATE_LIMIT",
                429,
              );
            }
            if (blocked) {
              const active = db
                .prepare(
                  "SELECT count(*) n FROM social_blocks WHERE actor_id=?",
                )
                .get(actor).n;
              fail(
                active < 200,
                "Your block list is full. Remove an old block first.",
                "CREATOR_BLOCK_LIMIT",
              );
              db.prepare("INSERT INTO social_blocks VALUES(?,?,?)").run(
                actor,
                creatorId,
                now,
              );
            } else
              db.prepare(
                "DELETE FROM social_blocks WHERE actor_id=? AND target_id=?",
              ).run(actor, creatorId);
            if (sharedAudit)
              db.prepare("INSERT INTO social_audit VALUES(?,?,?,?,?,?)").run(
                id("audit"),
                actor,
                blocked ? "player-blocked" : "player-unblocked",
                creatorId,
                "",
                now,
              );
          }
          return { creatorId, blocked };
        },
      );
    },
    report({ actor, operationId, questId, revision, reason, detail }) {
      key(questId);
      integer(revision, 1);
      fail(
        CREATOR_REPORT_REASONS.includes(reason),
        "Choose a creator report reason.",
        "CREATOR_INPUT",
        400,
      );
      const explanation = text(detail, 1000, { optional: true });
      return operation(
        "reportCreatorQuest",
        actor,
        operationId,
        { questId, revision, reason, detail: explanation },
        (now) => {
          community.myProfile(actor);
          const accepted = db
            .prepare(
              "SELECT revision FROM creator_participations WHERE quest_id=? AND participant=?",
            )
            .get(questId, actor);
          if (accepted?.revision !== revision) {
            const visible = community.publicQuest(actor, questId);
            fail(
              visible.revision === revision,
              "Creator quest not found.",
              "CREATOR_NOT_FOUND",
              404,
            );
          }
          fail(
            !db
              .prepare(
                "SELECT 1 FROM creator_reports WHERE quest_id=? AND reporter=?",
              )
              .get(questId, actor),
            "You already reported this quest. Your original report remains recorded.",
            "CREATOR_ALREADY_REPORTED",
          );
          const recent = db
            .prepare(
              "SELECT count(*) n FROM creator_reports WHERE reporter=? AND created_at>?",
            )
            .get(actor, now - 86400000).n;
          fail(
            recent < 20,
            "The daily creator report limit is reached. Try again tomorrow.",
            "CREATOR_RATE_LIMIT",
            429,
          );
          const reportId = id("creator_report");
          db.prepare(
            `INSERT INTO creator_reports VALUES(?,?,?,?,?,?,'open',1,?,NULL,NULL,NULL,NULL)`,
          ).run(reportId, questId, revision, actor, reason, explanation, now);
          return {
            report: reportView(
              db
                .prepare("SELECT * FROM creator_reports WHERE id=?")
                .get(reportId),
            ),
          };
        },
      );
    },
    reviewReport({
      actor,
      operationId,
      reportId,
      expectedVersion,
      decision,
      reason,
    }) {
      key(reportId);
      integer(expectedVersion, 1);
      fail(
        ["confirmed", "dismissed"].includes(decision),
        "Choose confirmed or dismissed.",
        "CREATOR_INPUT",
        400,
      );
      const explanation = text(reason, 1000);
      return operation(
        "reviewCreatorReport",
        actor,
        operationId,
        { reportId, expectedVersion, decision, reason: explanation },
        (now) => {
          const row = db
            .prepare(
              `SELECT r.*,q.author FROM creator_reports r JOIN creator_quests q ON q.id=r.quest_id WHERE r.id=?`,
            )
            .get(reportId);
          fail(row, "Creator report not found.", "CREATOR_NOT_FOUND", 404);
          fail(
            isModerator(actor) === true &&
              actor !== row.reporter &&
              actor !== row.author,
            "Independent moderation authority is required.",
            "CREATOR_FORBIDDEN",
            403,
          );
          fail(
            row.version === expectedVersion,
            "The creator report changed. Refresh before reviewing.",
            "CREATOR_STALE",
          );
          fail(
            row.status === "open",
            "This creator report was already reviewed.",
          );
          db.prepare(
            `UPDATE creator_reports SET status='reviewed',version=version+1,reviewed_at=?,reviewed_by=?,decision=?,review_reason=? WHERE id=?`,
          ).run(now, actor, decision, explanation, reportId);
          return {
            report: {
              id: reportId,
              questId: row.quest_id,
              revision: row.revision,
              status: "reviewed",
              version: expectedVersion + 1,
              decision,
              reason: explanation,
              reviewedAt: now,
            },
          };
        },
      );
    },
  };
}

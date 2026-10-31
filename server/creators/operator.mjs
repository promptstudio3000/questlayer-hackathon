import {
  creatorAssert as fail,
  creatorFields,
  creatorInteger,
} from "./operations.mjs";

export function creatorAudit(db, { limit = 50 } = {}) {
  creatorInteger(limit, 1);
  fail(
    limit <= 100,
    "Use an audit limit of at most 100.",
    "CREATOR_INPUT",
    400,
  );
  const initialized = !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_quests'",
    )
    .get();
  if (!initialized)
    return {
      domain: "demo",
      initialized: false,
      pendingReviews: [],
      openParticipations: [],
      activeCommitments: [],
      openReports: [],
      safetyActions: [],
      pendingCompletions: [],
    };
  return {
    domain: "demo",
    initialized: true,
    limit,
    pendingCompletions: db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_completion_submissions'",
      )
      .get()
      ? db
          .prepare(
            "SELECT s.id,s.quest_id AS questId,s.participant,s.revision,s.attempt,s.version,s.evidence,s.submitted_at AS submittedAt,r.content FROM creator_completion_submissions s JOIN creator_revisions r ON r.quest_id=s.quest_id AND r.revision=s.revision WHERE s.state='pending' ORDER BY s.submitted_at,s.id LIMIT ?",
          )
          .all(limit)
          .map((s) => ({
            ...s,
            content: JSON.parse(s.content),
            decisionWarning:
              s.attempt === 3
                ? "Rejection resolves this obligation as NOT completed, with no completion receipt or reward."
                : "Rejection permits another private attempt.",
          }))
      : [],
    openReports: db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_reports'",
      )
      .get()
      ? db
          .prepare(
            `SELECT r.id,r.quest_id AS questId,r.revision,r.reporter,r.reason,r.detail,r.status,r.version,
        r.created_at AS reportedAt,q.author,q.state AS questState,q.version AS questVersion,v.content
        FROM creator_reports r JOIN creator_quests q ON q.id=r.quest_id
        JOIN creator_revisions v ON v.quest_id=r.quest_id AND v.revision=r.revision
        WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT ?`,
          )
          .all(limit)
          .map((row) => ({ ...row, content: JSON.parse(row.content) }))
      : [],
    safetyActions: db
      .prepare(
        `SELECT actor,operation_id AS operationId,command,receipt FROM creator_operations
      WHERE command IN('suspendCreatorQuest','reviewCreatorReport') ORDER BY created_at DESC,rowid DESC LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({ ...row, receipt: JSON.parse(row.receipt) })),
    pendingReviews: db
      .prepare(
        `SELECT q.id,q.author,q.version,q.latest_revision AS revision,r.content,r.policy_version
      FROM creator_quests q JOIN creator_revisions r ON r.quest_id=q.id AND r.revision=q.latest_revision
      WHERE r.state='pending_review' ORDER BY q.updated_at,q.id LIMIT ?`,
      )
      .all(limit)
      .map((r) => ({ ...r, content: JSON.parse(r.content) })),
    openParticipations: db
      .prepare(
        `SELECT quest_id,participant,revision,started_at FROM creator_participations
      WHERE state='open' ORDER BY started_at,quest_id,participant LIMIT ?`,
      )
      .all(limit),
    activeCommitments: db
      .prepare(
        `SELECT quest_id,author,amount,policy_version,locked_at FROM creator_xp_commitments
      WHERE released_at IS NULL ORDER BY locked_at,quest_id LIMIT ?`,
      )
      .all(limit),
  };
}

// This function has no HTTP route. The local operator process supplies trusted
// configured capabilities; a player cannot select its own authority in an API body.
export function creatorOperator(services, command, input) {
  fail(
    services,
    "Creator services must be explicitly enabled.",
    "CREATOR_DISABLED",
    409,
  );
  if (command === "review") {
    creatorFields(input, [
      "actor",
      "operationId",
      "questId",
      "expectedVersion",
      "decision",
      "reason",
    ]);
    return services.lifecycle.review(input);
  }
  if (command === "resolve") {
    creatorFields(input, [
      "actor",
      "operationId",
      "questId",
      "participant",
      "resolutionReference",
    ]);
    return services.lifecycle.resolve(input);
  }
  if (command === "review-completion") {
    creatorFields(input, [
      "actor",
      "operationId",
      "submissionId",
      "expectedVersion",
      "decision",
      "reason",
      ...(Object.hasOwn(input, "acknowledgeNotCompleted")
        ? ["acknowledgeNotCompleted"]
        : []),
    ]);
    return services.completion.review(input);
  }
  if (command === "suspend") {
    creatorFields(input, [
      "actor",
      "operationId",
      "questId",
      "expectedVersion",
      "reason",
    ]);
    return services.lifecycle.suspend(input);
  }
  if (command === "review-report") {
    creatorFields(input, [
      "actor",
      "operationId",
      "reportId",
      "expectedVersion",
      "decision",
      "reason",
    ]);
    return services.safety.reviewReport(input);
  }
  fail(
    false,
    "Supported operator commands are review, resolve, suspend and review-report.",
    "CREATOR_INPUT",
    400,
  );
}

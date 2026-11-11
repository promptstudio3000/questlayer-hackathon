import { randomUUID } from "node:crypto";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import {
  creatorAssert as fail,
  creatorKey as key,
  creatorInteger as integer,
  creatorText as text,
  createCreatorOperations,
} from "./operations.mjs";
import {
  OBSERVATION_POLICY,
  observationRequirement,
  CREATOR_AWARD_ADAPTER,
} from "./completion-policy.mjs";

export const CREATOR_COMPLETION_SCHEMA = registerModuleSchema({
  name: "creator-completion",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS creator_completion_submissions(
 id TEXT PRIMARY KEY,quest_id TEXT NOT NULL,participant TEXT NOT NULL,revision INTEGER NOT NULL,
 attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 3),policy_version TEXT NOT NULL,
 evidence TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','accepted','rejected')),
 version INTEGER NOT NULL CHECK(version>0),submitted_at INTEGER NOT NULL,reviewed_at INTEGER,reviewed_by TEXT,feedback TEXT,
 FOREIGN KEY(quest_id,participant) REFERENCES creator_participations(quest_id,participant),
 FOREIGN KEY(quest_id,revision) REFERENCES creator_revisions(quest_id,revision),UNIQUE(quest_id,participant,attempt));
CREATE UNIQUE INDEX IF NOT EXISTS creator_completion_pending ON creator_completion_submissions(quest_id,participant) WHERE state='pending';
CREATE TABLE IF NOT EXISTS creator_completion_receipts(
 id TEXT PRIMARY KEY,quest_id TEXT NOT NULL,participant TEXT NOT NULL,revision INTEGER NOT NULL,
 submission_id TEXT NOT NULL UNIQUE REFERENCES creator_completion_submissions(id),receipt TEXT NOT NULL,completed_at INTEGER NOT NULL,
 FOREIGN KEY(quest_id,participant) REFERENCES creator_participations(quest_id,participant),UNIQUE(quest_id,participant));
`,
});

export function createCreatorCompletion(
  db,
  {
    clock = Date.now,
    isCompletionAuthority = () => false,
    // Host hook, inside the review transaction: the creator's XP for an accepted completion.
    onCompleted = null,
  } = {},
) {
  ensureModuleVersion(db, CREATOR_COMPLETION_SCHEMA);
  const operation = createCreatorOperations(db, { clock });
  function accepted(actor, questId) {
    key(actor);
    key(questId);
    const p = db
      .prepare(
        `SELECT a.*,q.author,r.content FROM creator_participations a JOIN creator_quests q ON q.id=a.quest_id JOIN creator_revisions r ON r.quest_id=a.quest_id AND r.revision=a.revision WHERE a.quest_id=? AND a.participant=?`,
      )
      .get(questId, actor);
    fail(p, "Your accepted quest was not found.", "CREATOR_NOT_FOUND", 404);
    return p;
  }
  function submissionView(s) {
    return {
      id: s.id,
      attempt: s.attempt,
      revision: s.revision,
      state: s.state,
      version: s.version,
      evidence: s.evidence,
      submittedAt: s.submitted_at,
      reviewedAt: s.reviewed_at,
      feedback: s.feedback,
    };
  }
  function read(actor, questId) {
    const p = accepted(actor, questId),
      content = JSON.parse(p.content);
    const requirement = content.requirement
      ? observationRequirement(content.requirement)
      : null;
    const attempts = db
      .prepare(
        "SELECT * FROM creator_completion_submissions WHERE quest_id=? AND participant=? ORDER BY attempt",
      )
      .all(questId, actor);
    const receipt = db
      .prepare(
        "SELECT receipt FROM creator_completion_receipts WHERE quest_id=? AND participant=?",
      )
      .get(questId, actor);
    const latest = attempts.at(-1);
    return {
      domain: "demo",
      questId,
      revision: p.revision,
      requirement,
      policy: requirement ? OBSERVATION_POLICY : null,
      legacy: !requirement,
      state: receipt
        ? "completed"
        : latest?.state === "pending"
          ? "pending"
          : latest?.state === "rejected"
            ? p.state === "resolved"
              ? "rejected-final"
              : "rejected"
            : p.state === "resolved"
              ? "legacy-resolved"
              : "ready",
      canSubmit:
        !!requirement &&
        p.state === "open" &&
        latest?.state !== "pending" &&
        attempts.length < OBSERVATION_POLICY.maxAttempts,
      attempts: attempts.map(submissionView),
      receipt: receipt ? JSON.parse(receipt.receipt) : null,
      rewardStatus: "not-configured",
    };
  }
  return {
    read,
    submit({
      actor,
      operationId,
      questId,
      revision,
      evidence,
      privateConsent,
    }) {
      integer(revision, 1);
      const explanation = text(evidence, OBSERVATION_POLICY.maxEvidenceChars);
      fail(
        privateConsent === true,
        "Confirm private evidence submission first.",
        "CREATOR_INPUT",
        400,
      );
      return operation(
        "submitCreatorCompletion",
        actor,
        operationId,
        { questId, revision, evidence: explanation, privateConsent: true },
        (now) => {
          const state = read(actor, questId),
            p = accepted(actor, questId);
          fail(
            !state.legacy,
            "This accepted legacy revision has no declared observation requirement. It remains available for independent legacy resolution.",
            "CREATOR_COMPLETION_LEGACY",
            409,
          );
          fail(
            p.author !== actor,
            "Authors cannot submit their own completion.",
            "CREATOR_FORBIDDEN",
            403,
          );
          fail(
            state.revision === revision,
            "Submit evidence for your accepted revision.",
            "CREATOR_STALE_REVISION",
            409,
          );
          fail(
            state.canSubmit,
            "A review is pending, completion is settled, or the published attempt limit is reached.",
            "CREATOR_COMPLETION_STATE",
            409,
          );
          const id = `creator_submission_${randomUUID()}`;
          db.prepare(
            "INSERT INTO creator_completion_submissions VALUES(?,?,?,?,?,?,?,'pending',1,?,NULL,NULL,NULL)",
          ).run(
            id,
            questId,
            actor,
            revision,
            state.attempts.length + 1,
            OBSERVATION_POLICY.version,
            explanation,
            now,
          );
          return { completion: read(actor, questId) };
        },
      );
    },
    review({
      actor,
      operationId,
      submissionId,
      expectedVersion,
      decision,
      reason,
      acknowledgeNotCompleted = false,
    }) {
      key(submissionId);
      integer(expectedVersion, 1);
      const feedback = text(reason, 1000);
      fail(
        ["accept", "reject"].includes(decision),
        "Choose accept or reject.",
        "CREATOR_INPUT",
        400,
      );
      return operation(
        "reviewCreatorCompletion",
        actor,
        operationId,
        {
          submissionId,
          expectedVersion,
          decision,
          reason: feedback,
          acknowledgeNotCompleted: acknowledgeNotCompleted === true,
        },
        (now) => {
          const s = db
            .prepare(
              "SELECT s.*,q.author FROM creator_completion_submissions s JOIN creator_quests q ON q.id=s.quest_id WHERE s.id=?",
            )
            .get(submissionId);
          fail(s, "Completion submission not found.", "CREATOR_NOT_FOUND", 404);
          fail(
            actor !== s.author &&
              actor !== s.participant &&
              isCompletionAuthority(actor) === true,
            "Independent configured completion authority is required.",
            "CREATOR_FORBIDDEN",
            403,
          );
          fail(
            s.version === expectedVersion,
            "The submission changed. Read its current version.",
            "CREATOR_STALE_VERSION",
            409,
          );
          fail(
            s.state === "pending",
            "Only pending submissions can be reviewed.",
            "CREATOR_COMPLETION_STATE",
            409,
          );
          const p = accepted(s.participant, s.quest_id);
          fail(
            p.state === "open" && p.revision === s.revision,
            "The accepted obligation changed.",
            "CREATOR_COMPLETION_STATE",
            409,
          );
          observationRequirement(JSON.parse(p.content).requirement);
          fail(
            decision !== "reject" ||
              s.attempt !== OBSERVATION_POLICY.maxAttempts ||
              acknowledgeNotCompleted === true,
            "Final rejection resolves this participation as NOT completed, without a receipt or reward. Confirm with acknowledgeNotCompleted:true.",
            "CREATOR_TERMINAL_CONFIRMATION",
            409,
          );
          db.prepare(
            "UPDATE creator_completion_submissions SET state=?,version=version+1,reviewed_at=?,reviewed_by=?,feedback=? WHERE id=?",
          ).run(
            decision === "accept" ? "accepted" : "rejected",
            now,
            actor,
            feedback,
            s.id,
          );
          let receipt = null;
          if (decision === "accept") {
            receipt = {
              id: `creator_completion_${randomUUID()}`,
              version: 1,
              domain: "demo",
              source: "creator",
              questId: s.quest_id,
              participant: s.participant,
              revision: s.revision,
              submissionId: s.id,
              state: "completed",
              template: OBSERVATION_POLICY.template,
              validationPolicyVersion: s.policy_version,
              completedAt: now,
              validation: OBSERVATION_POLICY.attests,
              rewardStatus: CREATOR_AWARD_ADAPTER.status,
              awardAdapterVersion: CREATOR_AWARD_ADAPTER.version,
              reward: CREATOR_AWARD_ADAPTER.settleInTransaction(),
            };
            db.prepare(
              "INSERT INTO creator_completion_receipts VALUES(?,?,?,?,?,?,?)",
            ).run(
              receipt.id,
              s.quest_id,
              s.participant,
              s.revision,
              s.id,
              JSON.stringify(receipt),
              now,
            );
          }
          // The creator's XP for another explorer finishing their quest.
          if (receipt)
            onCompleted?.({
              questId: s.quest_id,
              author: s.author,
              participant: s.participant,
              title: JSON.parse(p.content).title,
              now,
            });
          if (receipt || s.attempt === OBSERVATION_POLICY.maxAttempts)
            db.prepare(
              "UPDATE creator_participations SET state='resolved',resolved_at=?,resolved_by=?,resolution_reference=? WHERE quest_id=? AND participant=?",
            ).run(
              now,
              actor,
              receipt?.id || `declined:${s.id}`,
              s.quest_id,
              s.participant,
            );
          return { completion: read(s.participant, s.quest_id) };
        },
      );
    },
    pending({ limit = 50 } = {}) {
      integer(limit, 1);
      fail(
        limit <= 100,
        "Use at most 100 pending reviews.",
        "CREATOR_INPUT",
        400,
      );
      return db
        .prepare(
          "SELECT s.*,q.author,r.content FROM creator_completion_submissions s JOIN creator_quests q ON q.id=s.quest_id JOIN creator_revisions r ON r.quest_id=s.quest_id AND r.revision=s.revision WHERE s.state='pending' ORDER BY s.submitted_at,s.id LIMIT ?",
        )
        .all(limit)
        .map((s) => ({
          ...submissionView(s),
          questId: s.quest_id,
          participant: s.participant,
          author: s.author,
          requirement: JSON.parse(s.content).requirement,
        }));
    },
  };
}

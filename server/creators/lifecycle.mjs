import { atomic } from "../database.mjs";
import { levelFor } from "../domain.mjs";
import { observationRequirement } from "./completion-policy.mjs";
import {
  creatorAssert as fail,
  creatorKey as key,
  creatorInteger as integer,
  creatorText as text,
  createCreatorOperations,
} from "./operations.mjs";

const content = (value) => {
  fail(
    value &&
      ["description,title", "description,requirement,title"].includes(
        Object.keys(value).sort().join(),
      ),
    "Use free quest title, description and an optional supported requirement.",
    "CREATOR_INPUT",
    400,
  );
  return {
    title: text(value.title, 100),
    description: text(value.description, 4000),
    ...(Object.hasOwn(value, "requirement")
      ? { requirement: observationRequirement(value.requirement) }
      : {}),
  };
};
// Explicit opt-in demo adapter. The host initializes this only with reviewed
// configuration; identities and authority predicates come from trusted adapters.
export function createCreatorLifecycle(
  db,
  {
    policy,
    isModerator = () => false,
    isCompletionAuthority = () => false,
    authorizeAdmission = () => true,
    clock = Date.now,
  } = {},
) {
  fail(
    policy && Object.keys(policy).sort().join() === "version,xpCommitment",
    "An explicit versioned XP policy is required.",
    "CREATOR_POLICY",
    400,
  );
  const configuredPolicy = {
    version: key(policy.version),
    xpCommitment: integer(policy.xpCommitment, 1),
  };
  fail(
    db.prepare("PRAGMA foreign_keys").get().foreign_keys === 1,
    "Creator storage requires foreign keys.",
    "CREATOR_STORAGE",
    500,
  );
  atomic(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS creator_policies(
        version TEXT PRIMARY KEY, xp_commitment INTEGER NOT NULL CHECK(xp_commitment>0));
      CREATE TABLE IF NOT EXISTS creator_quests(
        id TEXT PRIMARY KEY, author TEXT NOT NULL REFERENCES players(id),
        state TEXT NOT NULL CHECK(state IN ('draft','pending_review','rejected','published','closing','closed')),
        version INTEGER NOT NULL, latest_revision INTEGER NOT NULL,
        published_revision INTEGER, policy_version TEXT REFERENCES creator_policies(version),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS creator_revisions(
        quest_id TEXT NOT NULL REFERENCES creator_quests(id), revision INTEGER NOT NULL,
        content TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('draft','pending_review','approved','rejected','withdrawn')),
        policy_version TEXT REFERENCES creator_policies(version), reviewed_by TEXT, reason TEXT,
        PRIMARY KEY(quest_id,revision));
      CREATE TABLE IF NOT EXISTS creator_xp_commitments(
        quest_id TEXT PRIMARY KEY REFERENCES creator_quests(id),
        author TEXT NOT NULL REFERENCES players(id), amount INTEGER NOT NULL CHECK(amount>0),
        policy_version TEXT NOT NULL REFERENCES creator_policies(version),
        locked_at INTEGER NOT NULL, released_at INTEGER);
      CREATE INDEX IF NOT EXISTS creator_active_xp ON creator_xp_commitments(author) WHERE released_at IS NULL;
      CREATE TABLE IF NOT EXISTS creator_participations(
        quest_id TEXT NOT NULL, participant TEXT NOT NULL REFERENCES players(id), revision INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('open','resolved')), started_at INTEGER NOT NULL,
        resolved_at INTEGER, resolved_by TEXT, resolution_reference TEXT,
        PRIMARY KEY(quest_id,participant),
        FOREIGN KEY(quest_id,revision) REFERENCES creator_revisions(quest_id,revision));
      CREATE TABLE IF NOT EXISTS creator_operations(
        actor TEXT NOT NULL, operation_id TEXT NOT NULL, command TEXT NOT NULL,
        fingerprint TEXT NOT NULL, receipt TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(actor,operation_id));
    `);
    const existing = db
      .prepare("SELECT xp_commitment FROM creator_policies WHERE version=?")
      .get(configuredPolicy.version);
    fail(
      !existing || existing.xp_commitment === configuredPolicy.xpCommitment,
      "An existing XP policy version cannot change.",
      "CREATOR_POLICY",
    );
    if (!existing)
      db.prepare("INSERT INTO creator_policies VALUES (?,?)").run(
        configuredPolicy.version,
        configuredPolicy.xpCommitment,
      );
  });

  function player(id) {
    const row = db.prepare("SELECT xp FROM players WHERE id=?").get(key(id));
    fail(row, "Creator player not found.", "CREATOR_NOT_FOUND", 404);
    integer(row.xp);
    return row;
  }
  function progression(author) {
    const earnedXp = player(author).xp;
    const lockedXp = db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS xp
      FROM creator_xp_commitments WHERE author=? AND released_at IS NULL`,
      )
      .get(author).xp;
    integer(lockedXp);
    fail(
      lockedXp <= earnedXp,
      "Creator XP accounting needs reconciliation.",
      "CREATOR_XP_INVARIANT",
      503,
    );
    const availableXp = earnedXp - lockedXp;
    return {
      domain: "demo",
      earnedXp,
      lockedXp,
      availableXp,
      level: levelFor(availableXp),
    };
  }
  function quest(id) {
    const row = db
      .prepare("SELECT * FROM creator_quests WHERE id=?")
      .get(key(id));
    fail(row, "Creator quest not found.", "CREATOR_NOT_FOUND", 404);
    return row;
  }
  function revision(id, number) {
    const row = db
      .prepare(
        "SELECT * FROM creator_revisions WHERE quest_id=? AND revision=?",
      )
      .get(id, number);
    fail(row, "Creator revision not found.", "CREATOR_NOT_FOUND", 404);
    return { ...row, content: JSON.parse(row.content) };
  }
  function participation(id, participant) {
    return (
      db
        .prepare(
          "SELECT * FROM creator_participations WHERE quest_id=? AND participant=?",
        )
        .get(key(id), key(participant)) ?? null
    );
  }
  function readQuest(id) {
    const row = quest(id);
    return {
      ...row,
      latest: revision(id, row.latest_revision),
      published:
        row.published_revision === null
          ? null
          : revision(id, row.published_revision),
      commitment:
        db
          .prepare("SELECT * FROM creator_xp_commitments WHERE quest_id=?")
          .get(id) ?? null,
      openParticipations: db
        .prepare(
          "SELECT count(*) AS n FROM creator_participations WHERE quest_id=? AND state='open'",
        )
        .get(id).n,
    };
  }
  function authorOwns(row, actor) {
    fail(
      row.author === actor,
      "Only the author can change this quest.",
      "CREATOR_FORBIDDEN",
      403,
    );
  }
  function moderator(row, actor) {
    fail(
      actor !== row.author && isModerator(actor) === true,
      "Independent moderation authority is required.",
      "CREATOR_FORBIDDEN",
      403,
    );
  }
  function version(row, expectedVersion) {
    integer(expectedVersion, 1);
    fail(
      row.version === expectedVersion,
      "The creator quest changed. Refresh before continuing.",
      "CREATOR_STALE",
    );
  }
  function touch(id, state, now) {
    db.prepare(
      "UPDATE creator_quests SET state=?,version=version+1,updated_at=? WHERE id=?",
    ).run(state, now, id);
  }
  const operation = createCreatorOperations(db, { clock });
  function publicationQuote(actor, questId) {
    const row = quest(questId);
    authorOwns(row, actor);
    const policyVersion = row.policy_version ?? configuredPolicy.version;
    const xp = db
      .prepare("SELECT xp_commitment FROM creator_policies WHERE version=?")
      .get(policyVersion).xp_commitment;
    return {
      domain: "demo",
      policyVersion,
      xpCommitment: xp,
      additionalLockedXp: row.published_revision === null ? xp : 0,
      expectedVersion: row.version,
      canSubmit:
        ["draft", "published"].includes(row.state) &&
        revision(questId, row.latest_revision).state === "draft",
      progression: progression(actor),
    };
  }
  function result(id) {
    const row = readQuest(id);
    return { quest: row, progression: progression(row.author) };
  }

  return {
    // Private service reads; these are not public discovery serializers.
    progression,
    readQuest,
    participation,
    publicationQuote,
    createDraft({ actor, operationId, questId, draft }) {
      key(questId);
      const validated = content(draft);
      return operation(
        "createDraft",
        actor,
        operationId,
        { questId, draft: validated },
        (now) => {
          player(actor);
          fail(
            !db.prepare("SELECT 1 FROM creator_quests WHERE id=?").get(questId),
            "Creator quest identity already exists.",
          );
          db.prepare(
            "INSERT INTO creator_quests VALUES (?,?,'draft',1,1,NULL,NULL,?,?)",
          ).run(questId, actor, now, now);
          db.prepare(
            "INSERT INTO creator_revisions VALUES (?,1,?,'draft',NULL,NULL,NULL)",
          ).run(questId, JSON.stringify(validated));
          return result(questId);
        },
      );
    },
    revise({ actor, operationId, questId, expectedVersion, draft }) {
      const validated = content(draft);
      return operation(
        "revise",
        actor,
        operationId,
        { questId, expectedVersion, draft: validated },
        (now) => {
          const row = quest(questId);
          authorOwns(row, actor);
          version(row, expectedVersion);
          fail(
            ["draft", "rejected", "published"].includes(row.state),
            "This quest cannot be edited now.",
          );
          fail(
            revision(questId, row.latest_revision).state !== "pending_review",
            "Withdraw the pending review before editing.",
          );
          const next = integer(row.latest_revision + 1, 1);
          db.prepare(
            "INSERT INTO creator_revisions VALUES (?,?,?,'draft',NULL,NULL,NULL)",
          ).run(questId, next, JSON.stringify(validated));
          db.prepare(
            "UPDATE creator_quests SET latest_revision=? WHERE id=?",
          ).run(next, questId);
          touch(
            questId,
            row.state === "published" ? "published" : "draft",
            now,
          );
          return result(questId);
        },
      );
    },
    submit({
      actor,
      operationId,
      questId,
      expectedVersion,
      expectedPolicyVersion,
    }) {
      return operation(
        "submit",
        actor,
        operationId,
        { questId, expectedVersion, expectedPolicyVersion },
        (now) => {
          const row = quest(questId);
          authorOwns(row, actor);
          version(row, expectedVersion);
          fail(
            ["draft", "published"].includes(row.state),
            "This quest cannot enter review now.",
          );
          fail(
            revision(questId, row.latest_revision).state === "draft",
            "Only a draft revision can enter review.",
          );
          fail(
            key(expectedPolicyVersion) ===
              (row.policy_version ?? configuredPolicy.version),
            "The XP quote changed. Review the current publication policy.",
            "CREATOR_POLICY_CHANGED",
          );
          db.prepare(
            "UPDATE creator_revisions SET state='pending_review',policy_version=? WHERE quest_id=? AND revision=?",
          ).run(
            row.policy_version ?? configuredPolicy.version,
            questId,
            row.latest_revision,
          );
          touch(
            questId,
            row.state === "published" ? "published" : "pending_review",
            now,
          );
          return result(questId);
        },
      );
    },
    withdrawReview({ actor, operationId, questId, expectedVersion }) {
      return operation(
        "withdrawReview",
        actor,
        operationId,
        { questId, expectedVersion },
        (now) => {
          const row = quest(questId);
          authorOwns(row, actor);
          version(row, expectedVersion);
          fail(
            ["pending_review", "published"].includes(row.state) &&
              revision(questId, row.latest_revision).state === "pending_review",
            "No withdrawable creator review exists.",
          );
          db.prepare(
            "UPDATE creator_revisions SET state='withdrawn' WHERE quest_id=? AND revision=?",
          ).run(questId, row.latest_revision);
          touch(
            questId,
            row.state === "published" ? "published" : "draft",
            now,
          );
          return result(questId);
        },
      );
    },
    review({ actor, operationId, questId, expectedVersion, decision, reason }) {
      fail(
        ["approve", "reject"].includes(decision),
        "Invalid moderation decision.",
        "CREATOR_INPUT",
        400,
      );
      const explanation = text(reason, 1000);
      return operation(
        "review",
        actor,
        operationId,
        { questId, expectedVersion, decision, reason: explanation },
        (now) => {
          const row = quest(questId);
          moderator(row, actor);
          version(row, expectedVersion);
          const candidate = revision(questId, row.latest_revision);
          fail(
            ["pending_review", "published"].includes(row.state) &&
              candidate.state === "pending_review",
            "No reviewable creator revision exists.",
          );
          if (decision === "approve" && row.published_revision === null) {
            const xp = db
              .prepare(
                "SELECT xp_commitment FROM creator_policies WHERE version=?",
              )
              .get(candidate.policy_version).xp_commitment;
            fail(
              progression(row.author).availableXp >= xp,
              "The author no longer has enough available XP to publish.",
              "CREATOR_INSUFFICIENT_XP",
            );
            db.prepare(
              "INSERT INTO creator_xp_commitments VALUES (?,?,?,?,?,NULL)",
            ).run(questId, row.author, xp, candidate.policy_version, now);
            db.prepare(
              "UPDATE creator_quests SET policy_version=? WHERE id=?",
            ).run(candidate.policy_version, questId);
          }
          db.prepare(
            "UPDATE creator_revisions SET state=?,reviewed_by=?,reason=? WHERE quest_id=? AND revision=?",
          ).run(
            decision === "approve" ? "approved" : "rejected",
            actor,
            explanation,
            questId,
            row.latest_revision,
          );
          if (decision === "approve")
            db.prepare(
              "UPDATE creator_quests SET published_revision=? WHERE id=?",
            ).run(row.latest_revision, questId);
          touch(
            questId,
            decision === "approve" || row.published_revision !== null
              ? "published"
              : "rejected",
            now,
          );
          return result(questId);
        },
      );
    },
    start({ actor, operationId, questId }) {
      return operation("start", actor, operationId, { questId }, (now) => {
        const row = quest(questId);
        player(actor);
        fail(
          row.state === "published",
          "This creator quest is not accepting new starts.",
        );
        fail(
          row.author !== actor,
          "Authors cannot validate their own participation.",
          "CREATOR_FORBIDDEN",
          403,
        );
        fail(
          authorizeAdmission(actor, questId) === true,
          "This creator quest is not accepting your participation.",
          "CREATOR_NOT_FOUND",
          404,
        );
        fail(
          !participation(questId, actor),
          "This player already started this stable quest.",
          "CREATOR_ALREADY_STARTED",
        );
        db.prepare(
          "INSERT INTO creator_participations VALUES (?,?,?,'open',?,NULL,NULL,NULL)",
        ).run(questId, actor, row.published_revision, now);
        return { participation: participation(questId, actor) };
      });
    },
    resolve({ actor, operationId, questId, participant, resolutionReference }) {
      key(participant);
      const reference = key(resolutionReference);
      return operation(
        "resolve",
        actor,
        operationId,
        { questId, participant, resolutionReference: reference },
        (now) => {
          const row = quest(questId);
          const accepted = participation(questId, participant);
          if (accepted) {
            const saved = db
              .prepare(
                "SELECT content FROM creator_revisions WHERE quest_id=? AND revision=?",
              )
              .get(questId, accepted.revision);
            fail(
              !JSON.parse(saved.content).requirement,
              "Structured participation requires independent completion review; legacy resolve cannot bypass it.",
              "CREATOR_COMPLETION_REQUIRED",
              409,
            );
          }
          fail(
            actor !== row.author &&
              actor !== participant &&
              isCompletionAuthority(actor) === true,
            "Independent completion authority is required.",
            "CREATOR_FORBIDDEN",
            403,
          );
          fail(
            participation(questId, participant)?.state === "open",
            "No open participation exists.",
          );
          db.prepare(
            "UPDATE creator_participations SET state='resolved',resolved_at=?,resolved_by=?,resolution_reference=? WHERE quest_id=? AND participant=?",
          ).run(now, actor, reference, questId, participant);
          return { participation: participation(questId, participant) };
        },
      );
    },
    close({ actor, operationId, questId, expectedVersion }) {
      return operation(
        "close",
        actor,
        operationId,
        { questId, expectedVersion },
        (now) => {
          const row = quest(questId);
          authorOwns(row, actor);
          version(row, expectedVersion);
          fail(
            !["closing", "closed"].includes(row.state),
            "This quest is already closing or closed.",
          );
          db.prepare(
            "UPDATE creator_revisions SET state='withdrawn' WHERE quest_id=? AND state IN ('draft','pending_review')",
          ).run(questId);
          // Finalization checks obligations and releases XP under one write lock.
          touch(
            questId,
            row.published_revision === null ? "closed" : "closing",
            now,
          );
          return result(questId);
        },
      );
    },
    suspend({ actor, operationId, questId, expectedVersion, reason }) {
      const explanation = text(reason, 1000);
      return operation(
        "suspendCreatorQuest",
        actor,
        operationId,
        { questId, expectedVersion, reason: explanation },
        (now) => {
          const row = quest(questId);
          moderator(row, actor);
          version(row, expectedVersion);
          fail(row.state !== "closed", "This creator quest is already closed.");
          db.prepare(
            "UPDATE creator_revisions SET state='withdrawn' WHERE quest_id=? AND state IN ('draft','pending_review')",
          ).run(questId);
          touch(
            questId,
            row.published_revision === null ? "closed" : "closing",
            now,
          );
          return {
            ...result(questId),
            suspension: {
              reason: explanation,
              moderator: actor,
              at: now,
              previousState: row.state,
              previousVersion: row.version,
            },
          };
        },
      );
    },
    finalize({ actor, operationId, questId, expectedVersion }) {
      return operation(
        "finalize",
        actor,
        operationId,
        { questId, expectedVersion },
        (now) => {
          const row = quest(questId);
          authorOwns(row, actor);
          version(row, expectedVersion);
          fail(row.state === "closing", "This quest is not closing.");
          fail(
            readQuest(questId).openParticipations === 0,
            "Existing participant obligations must be resolved before XP is released.",
            "CREATOR_OBLIGATIONS_OPEN",
          );
          const released = db
            .prepare(
              "UPDATE creator_xp_commitments SET released_at=? WHERE quest_id=? AND released_at IS NULL",
            )
            .run(now, questId);
          fail(
            released.changes === 1,
            "The creator commitment needs reconciliation.",
            "CREATOR_XP_INVARIANT",
            503,
          );
          touch(questId, "closed", now);
          return result(questId);
        },
      );
    },
  };
}

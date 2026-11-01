// Operator preview controls for AI content (W11).
//
// Operator authority comes only from local access to the protected database
// (server/cli/ai-operator.mjs); there is no HTTP route for these actions.
// Operators can preview a future city day and AI quest drafts before anything
// is published. Draft previews become proposals with distinct states:
// previewed -> approved | rejected. Approval never publishes: an approved
// proposal is published through the normal creator flow and review. Every
// action appends to a hash-chained audit log.
import { createHash } from "node:crypto";
import { assert, id } from "../domain.mjs";
import { atomic } from "../database.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { liveCityById } from "../spatial/city-pack.mjs";
import { effectiveCityPack } from "../spatial/place-safety.mjs";
import { localDateStart } from "../spatial/calendar.mjs";
import { buildCityPlan } from "../world-planner.mjs";
import { AI_OPERATIONS_SCHEMA } from "./guide.mjs";
import { createQuestDrafter } from "./quest-drafts.mjs";

const OPERATOR = /^[A-Za-z0-9_.@-]{1,80}$/;
const sha = (s) => createHash("sha256").update(s).digest("hex");

export function createAiOperations(
  db,
  { operator, env = process.env, clock = Date.now, drafter = null } = {},
) {
  assert(typeof operator === "string" && OPERATOR.test(operator), "Use an explicit operator audit name.", 403);
  ensureModuleVersion(db, AI_OPERATIONS_SCHEMA);
  const drafts = drafter || createQuestDrafter(db, { env, clock });

  function record(action, target, detail) {
    const prev =
      db.prepare("SELECT hash FROM ai_operator_audit ORDER BY seq DESC LIMIT 1").get()?.hash || "genesis";
    const row = {
      id: id("aiaudit"),
      operator,
      action,
      target,
      detail: JSON.stringify(detail),
      created_at: clock(),
      prev_hash: prev,
    };
    row.hash = sha(JSON.stringify(row));
    db.prepare(
      "INSERT INTO ai_operator_audit(id,operator,action,target,detail,created_at,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?)",
    ).run(row.id, row.operator, row.action, row.target, row.detail, row.created_at, row.prev_hash, row.hash);
    return row.id;
  }

  // Preview of a city day as the planner would build it today, with operator
  // closures applied. Nothing is stored or published.
  function previewDay({ cityId, day }) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(day || ""), "Use a local date YYYY-MM-DD.");
    const live = liveCityById(cityId);
    assert(live, "Choose a live city.", 404);
    const pack = effectiveCityPack(db, live);
    const start = localDateStart(day, pack.timezone);
    assert(start > clock() - 86400_000, "Preview today or a future day.");
    const plan = buildCityPlan(pack, day);
    const preview = {
      cityId: plan.cityId,
      day,
      sourceHash: plan.sourceHash,
      closedPlaces: pack.systemPlacePolicy?.closed || [],
      diagnostics: plan.diagnostics,
      zones: plan.zones.map((z) => ({
        slot: z.slot,
        name: z.name,
        sector: z.sector,
        tier: z.tier,
        sourceId: z.sourceId,
        opensAt: z.opensAt,
        closesAt: z.closesAt,
        targets: z.targets.length,
        activities: (z.questActivities || []).map((q) => q.activity?.templateId || q.kind),
      })),
      published: false,
    };
    record("preview-day", `${cityId}:${day}`, { sourceHash: plan.sourceHash, zones: preview.zones.length });
    return preview;
  }

  async function proposeDraft(input) {
    const suggestion = await drafts.draft({ ...input, actor: `operator:${operator}` });
    const proposal = {
      id: id("aiprop"),
      state: "previewed",
      cityId: suggestion.place.cityId,
      candidateId: suggestion.place.candidateId,
      template: suggestion.draft.place.template,
      content: suggestion.draft,
      provenance: suggestion.provenance,
    };
    atomic(db, () => {
      db.prepare(
        "INSERT INTO ai_proposals(id,city_id,candidate_id,template,content,provenance,state,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        proposal.id,
        proposal.cityId,
        proposal.candidateId,
        proposal.template,
        JSON.stringify(proposal.content),
        JSON.stringify(proposal.provenance),
        "previewed",
        operator,
        clock(),
      );
      record("preview-draft", proposal.id, { outputHash: suggestion.provenance.outputHash, source: suggestion.provenance.source });
    });
    return { ...proposal, warnings: suggestion.warnings, published: false };
  }

  function list({ state, limit = 50 } = {}) {
    assert(!state || ["previewed", "approved", "rejected"].includes(state), "Unknown proposal state.");
    assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 200, "Use a limit between 1 and 200.");
    return db
      .prepare(
        `SELECT * FROM ai_proposals ${state ? "WHERE state=?" : ""} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...(state ? [state, limit] : [limit]))
      .map((r) => ({ ...r, content: JSON.parse(r.content), provenance: JSON.parse(r.provenance) }));
  }

  function decide({ proposalId, action, reason }) {
    assert(["approve", "reject"].includes(action), "Use approve or reject.");
    assert(typeof reason === "string" && reason.trim().length >= 3 && reason.length <= 500, "Give a reason (3 to 500 characters).");
    return atomic(db, () => {
      const row = db.prepare("SELECT * FROM ai_proposals WHERE id=?").get(proposalId);
      assert(row, "Proposal not found.", 404);
      assert(row.state === "previewed", "This proposal was already decided.", 409);
      const state = action === "approve" ? "approved" : "rejected";
      db.prepare("UPDATE ai_proposals SET state=?,decided_by=?,reason=?,decided_at=? WHERE id=? AND state='previewed'").run(
        state,
        operator,
        reason.trim(),
        clock(),
        proposalId,
      );
      record(action, proposalId, { reason: reason.trim() });
      return {
        id: proposalId,
        state,
        published: false,
        next:
          state === "approved"
            ? "Publish it through the creator flow (save as a draft, submit for review). Approval does not publish."
            : "Rejected proposals are kept for the audit trail.",
      };
    });
  }

  function audit({ limit = 100 } = {}) {
    return db.prepare("SELECT * FROM ai_operator_audit ORDER BY seq DESC LIMIT ?").all(limit);
  }

  return { previewDay, proposeDraft, list, decide, audit };
}

// Re-computes the audit chain; returns the first broken row or null.
export function verifyAiAudit(db) {
  let prev = "genesis";
  for (const r of db.prepare("SELECT * FROM ai_operator_audit ORDER BY seq").all()) {
    const { seq, hash, ...rest } = r;
    if (rest.prev_hash !== prev || sha(JSON.stringify({ id: rest.id, operator: rest.operator, action: rest.action, target: rest.target, detail: rest.detail, created_at: rest.created_at, prev_hash: rest.prev_hash })) !== hash)
      return { seq, id: r.id };
    prev = hash;
  }
  return null;
}

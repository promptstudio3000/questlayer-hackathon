// Explicit browser interaction fixture for the actual CreatorCommunity component.
// Requests stay in memory. This does not publish, lock XP or resolve real players.
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CreatorCommunity } from "../src/CreatorCommunity";
import { createCreatorClient } from "../src/creator-community-client";
import type {
  CreatorCommunityView,
  CreatorCompletionState,
  CreatorParticipation,
  OwnedCreatorQuest,
} from "../src/creator-community-types";
import type { Player } from "../src/types";
import "../src/style.css";
import "../src/play-ui.css";

const query = new URLSearchParams(location.search),
  scenario = query.get("state") || "community";
const fault = query.get("fault");
let blocked =
  scenario === "safety-blocked" || scenario === "safety-blocked-accepted";
const reports = new Map<string, object>(),
  lostReplies = new Set<string>();
const author =
  scenario === "mine" ||
  scenario === "editor" ||
  scenario === "pending" ||
  scenario === "closing" ||
  scenario === "rejected" ||
  scenario === "profile" ||
  scenario === "completion-editor";
const completionScenario = scenario.startsWith("completion");
const fixtureRequirement = {
  template: "observation-v1" as const,
  policyVersion: "creator-observation-v1" as const,
  prompt:
    "Compare two shapes in an imagined riverside scene. This fixture requires no travel.",
};
const actor = author
  ? "fixture-author"
  : query.get("actor") === "other"
    ? "fixture-other-walker"
    : "fixture-walker";
const profile = {
  id: actor,
  displayName: author ? "Riverkeeper" : "",
  bio: author ? "Small stories along the public riverside paths." : "",
  public: author,
  version: author ? 1 : 0,
};
const quests: OwnedCreatorQuest[] = [
  {
    id: "river-ghosts",
    state: "published",
    version: 4,
    latestRevision: 1,
    latestState: "approved",
    publishedRevision: 1,
    draft: {
      title: "Riverbank expedition",
      description:
        "Follow the public riverside path. Find the date on the bridge plaque without stepping into the road. Return to the park entrance and compare the two stone carvings.",
    },
    lockedXp: 200,
    openParticipations: 1,
  },
  {
    id: "tower-tales",
    state: "draft",
    version: 1,
    latestRevision: 1,
    latestState: "draft",
    publishedRevision: null,
    draft: {
      title: "The tower's quiet clue",
      description:
        "Look for three carved symbols from the public square. Stay on the footpath and describe the order you see.",
    },
    lockedXp: 0,
    openParticipations: 0,
  },
];
if (scenario === "pending")
  Object.assign(quests[1], {
    state: "pending_review",
    latestState: "pending_review",
    version: 2,
  });
if (scenario === "closing")
  Object.assign(quests[0], { state: "closing", openParticipations: 1 });
if (scenario === "rejected")
  Object.assign(quests[1], {
    state: "rejected",
    latestState: "rejected",
    version: 3,
    latestReviewReason:
      "The second clue needs a reviewed public interaction point. Do not ask players to cross the road.",
  });
const participations = new Map<string, CreatorParticipation>();
if (completionScenario) quests[0].draft.requirement = fixtureRequirement;
if (
  scenario === "accepted" ||
  scenario === "safety-blocked-accepted" ||
  (completionScenario && !author)
)
  participations.set("river-ghosts", {
    domain: "demo",
    questId: "river-ghosts",
    revision: 1,
    state: "open",
    questState: completionScenario ? "published" : "closing",
    content: {
      title: "Riverbank expedition",
      description: quests[0].draft.description,
      ...(completionScenario ? { requirement: fixtureRequirement } : {}),
    },
    rewardStatus: "not-configured",
    creator: {
      id: "fixture-author",
      displayName: blocked ? null : "Riverkeeper",
    },
  });
const completionAttempts: CreatorCompletionState["attempts"] = [];
let completionReceipt: CreatorCompletionState["receipt"] = null;
if (
  [
    "completion-pending",
    "completion-rejected",
    "completion-final-attempt",
    "completion-terminal",
    "completion-completed",
  ].includes(scenario)
) {
  const count =
    scenario === "completion-terminal"
      ? 3
      : scenario === "completion-final-attempt"
        ? 2
        : 1;
  for (let i = 1; i <= count; i++)
    completionAttempts.push({
      id: `fixture-submission-${i}`,
      attempt: i,
      revision: 1,
      state:
        scenario === "completion-pending"
          ? "pending"
          : scenario === "completion-completed"
            ? "accepted"
            : "rejected",
      version: scenario === "completion-pending" ? 1 : 2,
      evidence:
        "Fixture private observation: a circular leaf contrasts with a rectangular railing.",
      submittedAt: Date.now() - 10000,
      reviewedAt: scenario === "completion-pending" ? null : Date.now(),
      feedback:
        scenario === "completion-pending"
          ? null
          : "Synthetic independent feedback: describe the two shapes clearly.",
    });
  if (scenario === "completion-completed")
    completionReceipt = {
      id: "creator_completion_fixture",
      version: 1,
      source: "creator",
      questId: "river-ghosts",
      revision: 1,
      completedAt: Date.now(),
      rewardStatus: "not-configured",
      reward: { xp: 0, gold: 0, item: null },
    };
  if (["completion-completed", "completion-terminal"].includes(scenario))
    participations.get("river-ghosts")!.state = "resolved";
}
function completionView(id: string): CreatorCompletionState {
  const part = participations.get(id)!;
  const requirement = part.content.requirement || null;
  const latest = completionAttempts.at(-1);
  return {
    domain: "demo",
    questId: id,
    revision: part.revision,
    legacy: !requirement,
    requirement,
    policy: requirement
      ? {
          version: "creator-observation-v1",
          maxAttempts: 3,
          maxEvidenceChars: 1000,
          attests: "Independent private-text review; not physical presence.",
        }
      : null,
    state: completionReceipt
      ? "completed"
      : latest?.state === "pending"
        ? "pending"
        : latest?.state === "rejected"
          ? part.state === "resolved"
            ? "rejected-final"
            : "rejected"
          : part.state === "resolved"
            ? "legacy-resolved"
            : "ready",
    canSubmit:
      !!requirement &&
      part.state === "open" &&
      latest?.state !== "pending" &&
      completionAttempts.length < 3,
    attempts: completionAttempts,
    receipt: completionReceipt,
    rewardStatus: "not-configured",
  };
}
const receipts = new Map<string, object>();
let following = scenario === "following";
const result = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (message: string, status = 409) =>
  result({ error: message, code: "FIXTURE_CREATOR_STATE" }, status);
const progression = () => {
  const lockedXp = author ? quests.reduce((sum, q) => sum + q.lockedXp, 0) : 0;
  return {
    domain: "demo",
    earnedXp: 1000,
    lockedXp,
    availableXp: 1000 - lockedXp,
    level: 1 + Math.floor(Math.sqrt((1000 - lockedXp) / 100)),
  };
};
const publicQuest = (quest: OwnedCreatorQuest) => ({
  ...(completionScenario ? { requirement: fixtureRequirement } : {}),
  id: quest.id,
  revision: quest.publishedRevision || 1,
  title:
    quest.id === "river-ghosts" ? "Riverbank expedition" : quest.draft.title,
  description:
    quest.id === "river-ghosts"
      ? "Follow the public riverside path. Read the date on the bridge plaque from the footpath and return to the park entrance."
      : quest.draft.description,
  creator: { id: "fixture-author", displayName: "Riverkeeper" },
  access: "free",
  rewardStatus: "not-configured",
  domain: "demo",
});
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input), location.origin),
    path = url.pathname.slice("/api/creator-community".length);
  const body = init?.body ? JSON.parse(String(init.body)) : {},
    method = init?.method || "GET";
  if (method !== "GET" && query.get("delay") === "1")
    await new Promise((resolve) => setTimeout(resolve, 1500));
  if (scenario === "error" && path !== "/status")
    return fail(
      "Fixture: the creator service is temporarily unavailable. Your entered text is retained.",
      503,
    );
  if (method === "GET") {
    if (path === "/status")
      return result({
        enabled: scenario !== "disabled",
        domain: "demo",
        native: false,
        rewards: "not-configured",
        policy:
          scenario === "disabled"
            ? null
            : { version: "fixture-only-200-xp", xpCommitment: 200 },
        reviewConfigured: true,
        completionConfigured: true,
      });
    if (path === "/me")
      return result({ domain: "demo", profile, progression: progression() });
    if (path.endsWith("/completion")) {
      const id = path.split("/")[2];
      return participations.has(id)
        ? result(completionView(id))
        : fail("Your accepted quest was not found.", 404);
    }
    if (path === "/me/blocks")
      return result({
        domain: "demo",
        items: blocked
          ? [
              {
                id: "fixture-author",
                displayName: fault === "hidden-name" ? null : "Riverkeeper",
              },
            ]
          : [],
        nextCursor: null,
      });
    if (path === "/me/quests")
      return result({
        domain: "demo",
        items: author ? quests : [],
        nextCursor: null,
      });
    if (path.startsWith("/me/quests/")) {
      const q = quests.find((q) => q.id === decodeURIComponent(path.slice(11)));
      return author && q
        ? result(q)
        : fail("Your creation was not found.", 404);
    }
    if (path === "/me/participations")
      return result({
        domain: "demo",
        items: [...participations.values()].map((p) => ({
          ...p,
          creator: {
            id: "fixture-author",
            displayName: blocked ? null : "Riverkeeper",
          },
        })),
        nextCursor: null,
      });
    if (path === "/creators")
      return result({
        domain: "demo",
        items: blocked
          ? []
          : [
              {
                id: "fixture-author",
                displayName: "Riverkeeper",
                bio: "Small stories along the public riverside paths.",
              },
            ],
        nextCursor: null,
      });
    if (path.startsWith("/creators/") && blocked)
      return fail(
        "This creator is not publicly visible. Manage your own blocks in My creations.",
        404,
      );
    if (path.startsWith("/creators/"))
      return result({
        domain: "demo",
        id: "fixture-author",
        displayName: "Riverkeeper",
        bio: "Small stories along the public riverside paths.",
        following,
      });
    if (path === "/quests")
      return result({
        domain: "demo",
        items:
          blocked ||
          scenario === "empty" ||
          (url.searchParams.get("following") === "true" && !following)
            ? []
            : quests.filter((q) => q.state === "published").map(publicQuest),
        nextCursor: null,
      });
    const match = path.match(
      /^\/quests\/([^/]+)(?:\/(participation|publication-quote))?$/,
    );
    if (match) {
      const q = quests.find((q) => q.id === decodeURIComponent(match[1]));
      if (match[2] === "participation")
        return participations.has(match[1])
          ? result({
              ...participations.get(match[1]),
              creator: {
                id: "fixture-author",
                displayName: blocked ? null : "Riverkeeper",
              },
            })
          : fail("Your quest participation was not found.", 404);
      if (!q) return fail("Quest not found.", 404);
      if (match[2] === "publication-quote")
        return author
          ? result({
              domain: "demo",
              policyVersion: "fixture-only-200-xp",
              xpCommitment: 200,
              additionalLockedXp: q.lockedXp ? 0 : 200,
              expectedVersion: q.version,
              canSubmit: q.latestState === "draft",
              progression: progression(),
            })
          : fail("Only the author can read this quote.", 403);
      return q.state === "published" && !blocked && scenario !== "accepted"
        ? result(publicQuest(q))
        : fail("This public quest is no longer visible.", 404);
    }
    return fail("Unsupported fixture read.", 404);
  }
  if (receipts.has(body.operationId))
    return result(receipts.get(body.operationId));
  if (
    (path.endsWith("/reports") && fault === "report-error") ||
    (path.endsWith("/block") && fault === "block-error")
  )
    return fail(
      "Fixture: this safety action has not been confirmed. Retry after the service is available.",
      503,
    );
  if (path.endsWith("/completion") && fault === "completion-error")
    return fail(
      "Fixture: observation was not confirmed. Your text is retained.",
      503,
    );
  let value: object = {};
  if (method === "POST" && path.endsWith("/completion")) {
    const id = path.split("/")[2],
      state = participations.has(id) ? completionView(id) : null;
    if (
      !state?.canSubmit ||
      body.revision !== state.revision ||
      !body.privateConsent ||
      !body.evidence?.trim() ||
      body.evidence.length > 1000
    )
      return fail("The private observation cannot be submitted in this state.");
    completionAttempts.push({
      id: `fixture-submission-${completionAttempts.length + 1}`,
      attempt: completionAttempts.length + 1,
      revision: state.revision,
      state: "pending",
      version: 1,
      evidence: body.evidence,
      submittedAt: Date.now(),
      reviewedAt: null,
      feedback: null,
    });
    value = { completion: completionView(id) };
  } else if (method === "PUT" && path.endsWith("/block")) {
    if (author) return fail("You cannot block yourself.", 400);
    blocked = body.blocked;
    value = { creatorId: "fixture-author", blocked };
  } else if (method === "POST" && path.endsWith("/reports")) {
    const id = decodeURIComponent(path.split("/")[2]),
      part = participations.get(id),
      q = quests.find((q) => q.id === id);
    if (
      !q ||
      (!part && blocked) ||
      body.revision !== (part?.revision || q.publishedRevision)
    )
      return fail(
        "This report revision is no longer available. Refresh before continuing.",
        404,
      );
    if (
      !["unsafe-place", "abuse", "misleading", "other"].includes(body.reason) ||
      typeof body.detail !== "string" ||
      body.detail.length > 1000
    )
      return fail(
        "Choose a reason and keep optional context within 1,000 characters.",
        400,
      );
    if (reports.has(id))
      return result(
        {
          error:
            "You already reported this quest. The earlier report remains in the private queue.",
          code: "CREATOR_ALREADY_REPORTED",
        },
        409,
      );
    const report = {
      questId: id,
      revision: body.revision,
      reason: body.reason,
      status: "open",
      reportedAt: Date.now(),
    };
    reports.set(id, report);
    value = { report };
  } else if (method === "PUT" && path === "/profile") {
    if (body.expectedVersion !== profile.version)
      return fail("The profile changed. Refresh before saving.");
    if (body.profile.public && !body.publicConsent)
      return fail("Confirm public profile publication first.");
    Object.assign(profile, body.profile, { version: profile.version + 1 });
    value = { profile };
  } else if (method === "PUT" && path.endsWith("/follow")) {
    following = body.following;
    value = { following };
  } else if (method === "POST" && path === "/quests") {
    if (!author)
      return fail("Fixture creation is available in the author scenario.", 403);
    if (quests.some((q) => q.id === body.questId))
      return fail(
        "This stable quest identity already exists. Open My creations to recover it.",
      );
    const q: OwnedCreatorQuest = {
      id: body.questId,
      state: "draft",
      version: 1,
      latestRevision: 1,
      latestState: "draft",
      publishedRevision: null,
      draft: body.draft,
      lockedXp: 0,
      openParticipations: 0,
    };
    quests.push(q);
    value = { quest: q };
  } else {
    const match = path.match(
      /^\/quests\/([^/]+)\/(revisions|submit|withdraw-review|close|finalize|participation)$/,
    );
    const q =
      match && quests.find((q) => q.id === decodeURIComponent(match[1]));
    if (!match || !q) return fail("Unsupported fixture action.", 404);
    if (match[2] === "participation") {
      if (author) return fail("The author cannot start their own quest.");
      const part = participations.get(q.id) || {
        domain: "demo" as const,
        questId: q.id,
        revision: q.publishedRevision || 1,
        state: "open" as const,
        questState: q.state,
        content: {
          title: publicQuest(q).title,
          description: publicQuest(q).description,
        },
        rewardStatus: "not-configured" as const,
        creator: {
          id: "fixture-author",
          displayName: blocked ? null : "Riverkeeper",
        },
      };
      participations.set(q.id, part);
      value = { participation: part };
    } else {
      if (!author || body.expectedVersion !== q.version)
        return fail("The quest changed. Refresh before continuing.");
      if (match[2] === "revisions") {
        q.latestRevision++;
        q.latestState = "draft";
        q.draft = body.draft;
        if (q.state !== "published") q.state = "draft";
      }
      if (match[2] === "submit") {
        if (body.expectedPolicyVersion !== "fixture-only-200-xp")
          return fail("Review the current publication quote first.");
        q.latestState = "pending_review";
        if (q.state !== "published") q.state = "pending_review";
      }
      if (match[2] === "withdraw-review") {
        q.latestState = "withdrawn";
        if (q.state !== "published") q.state = "draft";
      }
      if (match[2] === "close") {
        q.state = q.publishedRevision === null ? "closed" : "closing";
      }
      if (match[2] === "finalize") {
        if (q.openParticipations)
          return fail("Participant obligations must be resolved first.");
        q.state = "closed";
        q.lockedXp = 0;
      }
      q.version++;
      value = { quest: q };
    }
  }
  const receipt = {
    domain: "demo",
    operationId: body.operationId,
    command: "fixture-only",
    ...value,
  };
  receipts.set(body.operationId, structuredClone(receipt));
  if (
    ((fault === "report-lost" && path.endsWith("/reports")) ||
      (fault === "completion-lost" && path.endsWith("/completion")) ||
      (fault === "block-lost" && path.endsWith("/block"))) &&
    !lostReplies.has(body.operationId)
  ) {
    lostReplies.add(body.operationId);
    throw new TypeError(
      "Fixture: the action committed but its response was lost. Retry the same terms to recover the receipt.",
    );
  }
  return result(receipt);
};
function Review() {
  const initial: CreatorCommunityView =
    scenario === "completion-editor"
      ? { page: "edit", questId: "river-ghosts" }
      : completionScenario
        ? { page: "quest", questId: "river-ghosts" }
        : scenario === "safety-blocked"
          ? { page: "blocked" }
          : scenario.startsWith("safety")
            ? { page: "quest", questId: "river-ghosts" }
            : scenario === "profile"
              ? { page: "profile" }
              : ["editor", "pending", "rejected"].includes(scenario)
                ? { page: "edit", questId: "tower-tales" }
                : scenario === "closing"
                  ? { page: "edit", questId: "river-ghosts" }
                  : scenario === "accepted"
                    ? { page: "participations" }
                    : author
                      ? { page: "mine" }
                      : scenario === "following"
                        ? { page: "following" }
                        : { page: "community" };
  const [view, setView] = useState(initial);
  const client = useMemo(
    () => createCreatorClient({ playerId: actor, fetcher }),
    [],
  );
  return (
    <main className="creator-fixture-main">
      <p className="creator-fixture-label">
        Interaction fixture · simulated API only. No real publication, XP
        locking or rewards.
        {query.get("delay") === "1" && " Simulated request delay is active."}
      </p>
      <CreatorCommunity
        player={{ id: actor } as Player}
        client={client}
        view={view}
        onViewChange={setView}
      />
    </main>
  );
}
const style = document.createElement("style");
style.textContent = `body{overflow:auto!important;height:auto!important;min-height:100dvh;background:#FCFAFF}.creator-fixture-main{max-width:640px;padding:16px;margin:0 auto;box-sizing:border-box}.creator-fixture-label{font:14px/1.5 system-ui;color:#665577;margin:0}.creator-fixture-main .creator-community{margin-top:16px;padding-top:16px}${query.get("text") === "large" ? ".creator-community p,.creator-community small,.creator-community button,.creator-community label,.creator-community input,.creator-community textarea,.creator-community select,.creator-community summary,.creator-community span{font-size:32px!important}.creator-community h2,.creator-community h3,.creator-community h4{font-size:40px!important}" : ""}`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Review />
  </React.StrictMode>,
);

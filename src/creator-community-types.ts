export type CreatorCommunityView =
  | {
      page:
        | "community"
        | "following"
        | "creators"
        | "mine"
        | "participations"
        | "blocked"
        | "profile";
    }
  | { page: "quest"; questId: string }
  | { page: "creator"; creatorId: string }
  | { page: "edit"; questId: string | null };

export function parseCreatorCommunityView(
  value: unknown,
): CreatorCommunityView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = (x: unknown): x is string =>
    typeof x === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(x);
  if (
    typeof v.page === "string" &&
    [
      "community",
      "following",
      "creators",
      "mine",
      "participations",
      "blocked",
      "profile",
    ].includes(v.page) &&
    Object.keys(v).join() === "page"
  )
    return {
      page: v.page as
        | "community"
        | "following"
        | "creators"
        | "mine"
        | "participations"
        | "blocked"
        | "profile",
    };
  const keys = Object.keys(v).sort().join();
  if (keys === "page,questId" && v.page === "quest" && id(v.questId))
    return { page: "quest", questId: v.questId };
  if (keys === "creatorId,page" && v.page === "creator" && id(v.creatorId))
    return { page: "creator", creatorId: v.creatorId };
  if (
    keys === "page,questId" &&
    v.page === "edit" &&
    (v.questId === null || id(v.questId))
  )
    return { page: "edit", questId: v.questId };
  return null;
}
export type CreatorCapability = {
  enabled: boolean;
  domain: "demo";
  native: false;
  rewards: "not-configured";
  policy: { version: string; xpCommitment: number } | null;
  reviewConfigured?: boolean;
  completionConfigured?: boolean;
};
export function parseCreatorCapability(
  value: unknown,
): CreatorCapability | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.enabled !== "boolean" ||
    v.domain !== "demo" ||
    v.native !== false ||
    v.rewards !== "not-configured"
  )
    return null;
  const p = v.policy as Record<string, unknown> | null;
  if (
    v.enabled &&
    (!p ||
      typeof p.version !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(p.version) ||
      !Number.isSafeInteger(p.xpCommitment) ||
      Number(p.xpCommitment) <= 0)
  )
    return null;
  return {
    enabled: v.enabled,
    domain: "demo",
    native: false,
    rewards: "not-configured",
    policy: v.enabled
      ? {
          version: p!.version as string,
          xpCommitment: p!.xpCommitment as number,
        }
      : null,
    reviewConfigured: v.reviewConfigured === true,
    completionConfigured: v.completionConfigured === true,
  };
}
export type CreatorProfile = { id: string; displayName: string; bio: string };
export type MyCreatorProfile = CreatorProfile & {
  public: boolean;
  version: number;
};
export type CreatorProgression = {
  domain: "demo";
  earnedXp: number;
  lockedXp: number;
  availableXp: number;
  level: number;
};
export type CreatorMe = {
  domain: "demo";
  profile: MyCreatorProfile;
  progression: CreatorProgression;
};
export type PublicCreatorQuest = {
  requirement?: CreatorObservationRequirement;
  id: string;
  revision: number;
  title: string;
  description: string;
  creator: { id: string; displayName: string };
  access: "free";
  rewardStatus: "not-configured";
  domain: "demo";
};
export type OwnedCreatorQuest = {
  id: string;
  state:
    | "draft"
    | "pending_review"
    | "rejected"
    | "published"
    | "closing"
    | "closed";
  version: number;
  latestRevision: number;
  latestState?:
    "draft" | "pending_review" | "approved" | "rejected" | "withdrawn";
  publishedRevision: number | null;
  draft: {
    title: string;
    description: string;
    requirement?: CreatorObservationRequirement;
  };
  lockedXp: number;
  openParticipations: number;
  latestReviewReason?: string | null;
};
export type CreatorParticipation = {
  domain: "demo";
  questId: string;
  revision: number;
  state: "open" | "resolved";
  questState: string;
  content: {
    title: string;
    description: string;
    requirement?: CreatorObservationRequirement;
  };
  rewardStatus: "not-configured";
  creator?: { id: string; displayName: string | null };
};
export type CreatorObservationRequirement = {
  template: "observation-v1";
  policyVersion: "creator-observation-v1";
  prompt: string;
};
export type CreatorCompletionState = {
  domain: "demo";
  questId: string;
  revision: number;
  legacy: boolean;
  requirement: CreatorObservationRequirement | null;
  policy: {
    version: string;
    maxAttempts: number;
    maxEvidenceChars: number;
    attests: string;
  } | null;
  state:
    | "ready"
    | "pending"
    | "rejected"
    | "rejected-final"
    | "completed"
    | "legacy-resolved";
  canSubmit: boolean;
  attempts: Array<{
    id: string;
    attempt: number;
    revision: number;
    state: "pending" | "accepted" | "rejected";
    version: number;
    evidence: string;
    submittedAt: number;
    reviewedAt: number | null;
    feedback: string | null;
  }>;
  receipt: {
    id: string;
    version: number;
    source: string;
    questId: string;
    revision: number;
    completedAt: number;
    rewardStatus: "not-configured";
    reward: { xp: 0; gold: 0; item: null };
  } | null;
  rewardStatus: "not-configured";
};
export type CreatorPage<T> = {
  domain: "demo";
  items: T[];
  nextCursor: string | null;
};
export type CreatorPublicationQuote = {
  domain: "demo";
  policyVersion: string;
  xpCommitment: number;
  additionalLockedXp: number;
  expectedVersion: number;
  canSubmit: boolean;
  progression: CreatorProgression;
};
export type BlockedCreator = { id: string; displayName: string | null };
export type CreatorReportReason =
  "unsafe-place" | "abuse" | "misleading" | "other";
export type CreatorReportTarget = {
  questId: string;
  revision: number;
  title: string;
};
export function creatorReportTarget(
  quest?: PublicCreatorQuest | null,
  participation?: CreatorParticipation | null,
): CreatorReportTarget | null {
  if (quest && participation && quest.id !== participation.questId) return null;
  const source = participation || quest;
  if (!source || source.domain !== "demo") return null;
  const questId = participation ? participation.questId : quest!.id;
  const title = participation ? participation.content.title : quest!.title;
  if (
    typeof questId !== "string" ||
    typeof title !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(questId) ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1
  )
    return null;
  return {
    questId,
    revision: source.revision,
    title,
  };
}

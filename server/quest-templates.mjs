import { assert, distance, hash, point } from "./domain.mjs";
import { contains } from "./spatial/city-pack.mjs";

export const QUEST_POLICY = "zone-quests-v1";
export const QUEST_POLICY_START_DAY = "2026-11-02";
const VERSION = 1;
const MIN_TARGET_GAP_M = 55;

// These are requirements the existing evidence service can actually enforce.
// Reward amounts and tier eligibility remain owned by the world/economy service.
const TEMPLATES = [
  {
    id: "path-visit",
    kind: "visit",
    icon: "visit",
    title: "Path discovery",
    objective: "Reach the marked path and confirm your visit.",
    actionLabel: "Confirm visit",
    stepLabels: ["Reach the marker"],
    evidenceKind: "point-proximity",
    distinctTargets: 1,
    rewardConstraint:
      "Personal XP once; any funded shared GOLD prize pays once.",
  },
  {
    id: "ordered-trail",
    kind: "route",
    icon: "trail",
    title: "Three-stop trail",
    objective: "Visit three marked stops in order.",
    actionLabel: "Record stop",
    stepLabels: ["Start the trail", "Find the next stop", "Reach the finish"],
    evidenceKind: "ordered-proximity",
    distinctTargets: 3,
    rewardConstraint:
      "Personal XP once after the final stop; no additional GOLD allocation.",
  },
  {
    id: "return-trail",
    kind: "route",
    icon: "return",
    title: "There and back",
    objective: "Visit two further stops, then return to your starting marker.",
    actionLabel: "Record stop",
    stepLabels: [
      "Mark your start",
      "Reach the second stop",
      "Reach the third stop",
      "Return to the start",
    ],
    evidenceKind: "ordered-proximity",
    distinctTargets: 3,
    rewardConstraint:
      "Personal XP once after returning; no additional GOLD allocation.",
  },
  {
    id: "cosmetic-chest",
    kind: "chest",
    icon: "chest",
    title: "Path chest",
    objective:
      "Reach the chest and open it. An Aura may remain in its edition.",
    actionLabel: "Open chest",
    stepLabels: ["Reach the chest"],
    evidenceKind: "point-proximity",
    distinctTargets: 1,
    rewardConstraint:
      "Personal XP once; a cosmetic Aura only while edition supply remains.",
  },
];

// POI quests in street cells (docs/WORLDS-PLAN.md C.3/C.4, task W6). They
// validate like path-visit and the ordered trail, but their targets come from
// the checked POI file (safety "ok", snapped to a public path), never from a
// zone polygon, and a category hunt takes its stops in any order.
const POI_TEMPLATES = [
  {
    id: "poi-visit",
    kind: "visit",
    icon: "visit",
    title: "Place visit",
    objective: "Reach the marked public spot next to this place and confirm your visit.",
    actionLabel: "Confirm visit",
    stepLabels: ["Reach the marker"],
    evidenceKind: "point-proximity",
    distinctTargets: 1,
    rewardConstraint: "Personal XP once. No GOLD or NEAR prize.",
  },
  {
    id: "poi-category-hunt",
    kind: "route",
    icon: "trail",
    title: "Place hunt",
    objective: "Visit three places of one kind in this area today, in any order.",
    actionLabel: "Record stop",
    stepLabels: ["Find one", "Find another", "Find the last one"],
    evidenceKind: "unordered-proximity",
    distinctTargets: 3,
    rewardConstraint:
      "Personal XP once after the last stop. No GOLD or NEAR prize.",
  },
];

const SAFETY = {
  access: "mapped-paths-only",
  routing: "straight-line-only",
  instruction:
    "Stay on open public paths. Skip a stop if access is blocked or unsafe.",
  fieldReview: "pending",
};

export function questTemplateCatalog() {
  return {
    policy: QUEST_POLICY,
    version: VERSION,
    activationDay: QUEST_POLICY_START_DAY,
    scope:
      "New, unprepared demo city days and new native-city-v2 days; published native-city-v1 days stay unchanged.",
    templates: TEMPLATES.map((t) => ({
      ...t,
      stepLabels: [...t.stepLabels],
      status: "implemented",
      scope: "zone",
      modes: ["demo-arena", "demo-gps"],
      nativePolicy:
        t.id === "ordered-trail"
          ? ["native-city-v1", "native-city-v2"]
          : ["native-city-v2"],
      safety: { ...SAFETY },
      durationMinutes: null,
      durationReason: "No verified walking route or field timing is available.",
    })).concat(
      POI_TEMPLATES.map((t) => ({
        ...t,
        stepLabels: [...t.stepLabels],
        status: "implemented",
        scope: "street-cell",
        modes: ["demo-gps"],
        nativePolicy: [],
        safety: { ...SAFETY },
        durationMinutes: null,
        durationReason:
          "No verified walking route or field timing is available.",
      })),
    ),
    planned: [
      {
        id: "landmark-clue",
        status: "planned",
        requires:
          "Reviewed landmark facts, authored clues and an answer policy.",
      },
      {
        id: "geocache",
        status: "planned",
        requires:
          "Approved accessible cache sites, permission and replay-safe evidence.",
      },
      {
        id: "photo-observation",
        status: "planned",
        requires:
          "Private media handling, review, appeals and a defined evidence policy.",
      },
    ],
    evidenceLimit:
      "A GPS receipt records accepted coordinates; it does not prove physical presence, a walked route or an observation.",
  };
}

function template(id) {
  const result =
    TEMPLATES.find((t) => t.id === id) ||
    POI_TEMPLATES.find((t) => t.id === id);
  assert(result, "Unknown quest template.");
  return result;
}

function activity(t, targets, policy = QUEST_POLICY) {
  return {
    templateId: t.id,
    version: VERSION,
    policy,
    icon: t.icon,
    objective: t.objective,
    actionLabel: t.actionLabel,
    steps: targets.map((p, index) => ({
      index,
      label: t.stepLabels[index] || `Reach stop ${index + 1}`,
      point: { lat: p.lat, lng: p.lng },
    })),
    evidence: {
      kind: t.evidenceKind,
      attests:
        t.evidenceKind === "unordered-proximity"
          ? "Accepted coordinates near each stop, in any order."
          : t.kind === "route"
            ? "Accepted checkpoint coordinates in order."
            : "Accepted coordinates near the target.",
      doesNotAttest:
        "Physical presence, the path walked, an observation or a photograph.",
      observationRequired: false,
    },
    safety: { ...SAFETY },
    distanceLowerBoundM: Math.floor(
      targets.slice(1).reduce((sum, p, i) => sum + distance(targets[i], p), 0),
    ),
    distanceBasis: "straight-line-between-stops",
    durationMinutes: null,
    rewardConstraint: t.rewardConstraint,
  };
}

/**
 * Activity for a POI quest (W6). Targets are the POIs' public-path check-in
 * points; the caller has already checked spacing and safety.
 */
export function poiQuestActivity(templateId, targets, { objective, policy } = {}) {
  const t = template(templateId);
  assert(
    Array.isArray(targets) && targets.length === t.distinctTargets,
    "The POI template needs its exact number of targets.",
  );
  const result = activity(
    t,
    targets.map((p) => point(p)),
    policy || QUEST_POLICY,
  );
  if (objective) result.objective = objective;
  return result;
}

export function instantiateQuestTemplate(templateId, zone) {
  const t = template(templateId);
  assert(
    zone?.geometry?.type === "Polygon",
    "A quest needs its published zone polygon.",
  );
  assert(
    Array.isArray(zone.targets) && zone.targets.length >= t.distinctTargets,
    "The template needs more mapped path targets.",
  );
  // A single-target visit uses the second mapped path point when one exists,
  // so it never shares the return-trail start/finish and each confirmation
  // happens at a different place in the zone.
  const ordered =
    t.distinctTargets === 1 && zone.targets.length > 1
      ? zone.targets.slice(1)
      : zone.targets;
  const distinct = ordered.slice(0, t.distinctTargets).map((p) => {
    point(p);
    assert(contains(zone.geometry, p), "A quest target is outside its zone.");
    return { lat: p.lat, lng: p.lng };
  });
  for (let i = 0; i < distinct.length; i++)
    for (let j = i + 1; j < distinct.length; j++)
      assert(
        distance(distinct[i], distinct[j]) >= MIN_TARGET_GAP_M,
        "Quest targets are too close for separate confirmations.",
      );
  const targets =
    t.id === "return-trail" ? [...distinct, distinct[0]] : distinct;
  return {
    kind: t.kind,
    title: t.title,
    description: t.objective,
    target: { ...targets.at(-1) },
    checkpoints: t.kind === "route" ? targets.map((p) => ({ ...p })) : [],
    activity: activity(t, targets),
  };
}

export function zoneQuestTemplates(zone, { cityId, day }) {
  assert(
    typeof cityId === "string" && cityId.length > 0,
    "A city identity is required.",
  );
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isInteger(zone.slot),
    "A day and city slot are required.",
  );
  // The shared city/day selects the first pattern; slot parity guarantees variety.
  // Player identity, current GPS and request order never enter this selection.
  const parity =
    parseInt(hash(`${QUEST_POLICY}:${cityId}:${day}`).slice(0, 8), 16) % 2;
  const route =
    (parity + zone.slot) % 2 === 0 ? "ordered-trail" : "return-trail";
  return ["path-visit", route, "cosmetic-chest"].map((id) =>
    instantiateQuestTemplate(
      id,
      id === "cosmetic-chest" ? { ...zone, targets: [zone.targets[1]] } : zone,
    ),
  );
}

// Legacy rows are described from their saved requirements, never regenerated.
export function describeStoredQuest(q, metadata = {}) {
  if (metadata.activity) return structuredClone(metadata.activity);
  const targets = q.kind === "route" ? metadata.checkpoints || [] : [q];
  const id =
    q.kind === "route"
      ? "ordered-trail"
      : q.kind === "chest"
        ? "cosmetic-chest"
        : "path-visit";
  return activity(template(id), targets, "legacy-demo-v2");
}

// Response-only enrichment. Never add this object to a hashed manifest body.
// v1 quests have no template and stay three ordered checkpoints; v2 quests
// name the template they were published with.
export function describeNativeQuest(q) {
  if (q.template) {
    const t = template(q.template);
    const result = activity(t, q.targets, "native-city-v2");
    if (t.kind === "chest")
      result.objective = "Reach the chest and open it for the zone prize.";
    result.rewardConstraint =
      t.kind === "chest"
        ? "Personal XP once; the first opener takes any funded zone prize. No item is minted."
        : "Personal XP once; any funded shared GOLD prize pays once. Observations are optional.";
    return result;
  }
  const result = activity(
    template("ordered-trail"),
    q.targets,
    "native-city-v1",
  );
  result.objective = `Visit ${q.targets.length} marked stops in order.`;
  result.rewardConstraint =
    "Personal XP once; any funded shared GOLD prize pays once. Observations are optional.";
  return result;
}

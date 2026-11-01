import { hash } from "../domain.mjs";
import { PLZEN, sampleCityPaths } from "../spatial/city-pack.mjs";
import { NETWORK } from "./network.mjs";
export const NATIVE_POLICY = "native-city-v1";
const THEMES = [
  [
    "Garden time capsule",
    "Notice an old detail, a recent change and a place worth preserving.",
  ],
  [
    "Canopy and light",
    "Compare the trees, the shade and an opening in the canopy.",
  ],
  [
    "Three views of the park",
    "Find a wide view, a small detail and a different perspective.",
  ],
  [
    "Quiet corners",
    "Compare the sounds at three public-path stops. Keep to open paths.",
  ],
  [
    "Textures of the trail",
    "Look for three different natural textures without collecting or disturbing anything.",
  ],
  [
    "The colour walk",
    "Find a colour at each stop and notice how the landscape changes.",
  ],
];
export function nativeManifest(
  plan,
  treasury,
  coinPoints = sampleCityPaths(PLZEN),
) {
  const cap = 6n * 10n ** 21n;
  const available = (bucket) => BigInt(treasury[bucket].available);
  const coinBudget = available("coins") < cap ? available("coins") : cap;
  const zoneBudget = available("zones") < cap ? available("zones") : cap;
  const unit = coinBudget / BigInt(coinPoints.length);
  if (unit === 0n) return null;
  const weights = plan.zones.reduce(
    (n, z) => n + (z.tier === 3 ? 2 : z.tier === 2 ? 1 : 0),
    0,
  );
  const quests = plan.zones.map((z, i) => ({
    index: i,
    name: z.name,
    sector: z.sector,
    title: THEMES[i][0],
    prompt: THEMES[i][1],
    requirement:
      "Visit three marked checkpoints in order. Observation prompts are optional; only GPS checkpoints are attested.",
    targets: z.targets,
    tier: z.tier,
    reward: (
      (zoneBudget * BigInt(z.tier === 3 ? 2 : z.tier === 2 ? 1 : 0)) /
      BigInt(weights)
    ).toString(),
    xp: 80,
    opensAt: z.opensAt,
    closesAt: z.closesAt,
  }));
  const body = {
    version: 1,
    policy: NATIVE_POLICY,
    id: `plzen-${plan.day}-v1`,
    day: plan.day,
    cityId: plan.cityId,
    timezone: plan.timezone,
    startsAt: plan.startsAt,
    endsAt: plan.endsAt,
    sourceHash: plan.sourceHash,
    coinUnit: unit.toString(),
    coins: coinPoints,
    quests,
    fieldReview: "pending",
    evidence: "browser GPS attestation; spoofing resistance not established",
  };
  return { ...body, hash: hash(JSON.stringify(body)) };
}
export function publicationArgs(m) {
  return {
    day_id: m.id,
    starts_at: String(m.startsAt),
    ends_at: String(m.endsAt),
    manifest_hash: m.hash,
    coin_count: m.coins.length,
    coin_unit: m.coinUnit,
    quests: m.quests.map((q) => ({
      reward: q.reward,
      xp: q.xp,
      opens_at: String(q.opensAt),
      closes_at: String(q.closesAt),
      tier: q.tier,
    })),
  };
}
export function rewardMessage(contractId, c) {
  return `QuestLayer native reward v1\nNetwork: ${NETWORK}\nContract: ${contractId}\nReceipt: ${c.receipt_id}\nDay: ${c.day_id}\nKind: ${c.kind}\nIndex: ${c.index}\nReceiver: ${c.receiver_id}\nReceived: ${c.received_at}\nEvidence: ${c.evidence_hash}`;
}

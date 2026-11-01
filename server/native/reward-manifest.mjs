import { assert, hash, point } from "../domain.mjs";
import { PLZEN, sampleCityPaths } from "../spatial/city-pack.mjs";
import { NETWORK } from "./network.mjs";
import { nativeInteger } from "./staking-pool.mjs";
export const NATIVE_POLICY = "native-city-v1";
export function nativeDayId(cityId, day) {
  assert(
    typeof cityId === "string" && /^[a-z][a-z0-9-]{0,24}$/.test(cityId),
    "Invalid native city id.",
  );
  assert(
    typeof day === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      Number.isFinite(Date.parse(day)) &&
      new Date(day).toISOString().slice(0, 10) === day,
    "Invalid native local date.",
  );
  return `${cityId}-${day}-v1`;
}
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
  coinPoints = plan.cityId === PLZEN.id ? sampleCityPaths(PLZEN) : null,
  { budget = null, funding = null } = {},
) {
  const dayId = nativeDayId(plan.cityId, plan.day);
  assert(
    plan.zones.length === 6,
    "Native v1 requires six suitable city slots; reduced map coverage cannot be published to this contract.",
    503,
  );
  assert(
    Array.isArray(coinPoints) && coinPoints.length <= 8192,
    "Supply bounded public-path coins from this city pack.",
    503,
  );
  if (!coinPoints.length) return null;
  coinPoints.forEach(point);
  const cap = 6n * 10n ** 21n;
  const available = (bucket) => nativeInteger(treasury[bucket].available);
  // An explicit budget comes from the allocation (server/native/allocation.mjs);
  // without one a single city takes the capped available funds, as in v1.
  const capped = (bucket) =>
    budget
      ? nativeInteger(budget[bucket])
      : available(bucket) < cap
        ? available(bucket)
        : cap;
  const coinBudget = capped("coins");
  const zoneBudget = capped("zones");
  assert(
    coinBudget <= cap &&
      zoneBudget <= cap &&
      coinBudget <= available("coins") &&
      zoneBudget <= available("zones"),
    "Allocated day budget exceeds the cap or the available treasury.",
    503,
  );
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
    id: dayId,
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
    // Only yield-backed days carry the field, so sponsor-funded manifests and
    // their hashes stay byte-for-byte what v1 published.
    ...(funding
      ? { funding: funding.source, fundingEvidence: funding.evidence }
      : {}),
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
// The durable body is the publication intent. A retry must never re-price it
// from newer funds, a changed CityPack or a replacement worker's defaults.
export function storedNativeManifest(row) {
  const manifest = JSON.parse(row.body),
    { hash: stored, ...body } = manifest;
  assert(
    manifest.id === row.id &&
      manifest.day === row.day &&
      stored === row.hash &&
      hash(JSON.stringify(body)) === stored,
    "Native manifest integrity error.",
    503,
  );
  return manifest;
}
export function nativePublicationMatches(
  manifest,
  day,
  { closed = false } = {},
) {
  if (
    !day ||
    day.manifest_hash !== manifest.hash ||
    day.closed !== closed ||
    day.storage_reserved !== true
  )
    return false;
  const expected = publicationArgs(manifest);
  if (
    ["starts_at", "ends_at", "coin_count", "coin_unit"].some(
      (key) => String(day[key]) !== String(expected[key]),
    )
  )
    return false;
  if (
    !Array.isArray(day.quests) ||
    day.quests.length !== expected.quests.length
  )
    return false;
  if (
    expected.quests.some((q, index) =>
      Object.keys(q).some(
        (key) => String(day.quests[index]?.[key]) !== String(q[key]),
      ),
    )
  )
    return false;
  return (
    Number.isSafeInteger(day.claims_limit) &&
    day.claims_limit > 0 &&
    day.claims_limit <= 256 &&
    Number.isSafeInteger(day.claims_accepted) &&
    day.claims_accepted >= 0 &&
    day.claims_accepted <= day.claims_limit
  );
}
export function rewardMessage(contractId, c) {
  return `QuestLayer native reward v1\nNetwork: ${NETWORK}\nContract: ${contractId}\nReceipt: ${c.receipt_id}\nDay: ${c.day_id}\nKind: ${c.kind}\nIndex: ${c.index}\nReceiver: ${c.receiver_id}\nReceived: ${c.received_at}\nEvidence: ${c.evidence_hash}`;
}

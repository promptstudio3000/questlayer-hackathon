import { assert, hash, point } from "../domain.mjs";
import { cityById, sampleCityPaths } from "../spatial/city-pack.mjs";
import { NETWORK } from "./network.mjs";
import { nativeInteger } from "./staking-pool.mjs";
import { instantiateQuestTemplate } from "../quest-templates.mjs";
import { pickStreetFinds } from "../street-finds.mjs";
export const NATIVE_POLICY = "native-city-v1";
export const NATIVE_POLICY_V2 = "native-city-v2";
// First local date that a publisher prepares as a v2 day by default. Days that
// already have a stored manifest (any version) keep it; NATIVE_MANIFEST_V2_FROM
// overrides the date, and "off" keeps every new day on v1.
export const NATIVE_V2_START_DAY = "2026-11-03";
export const NATIVE_MANIFEST_VERSIONS = [1, 2];
export function nativeDayId(cityId, day, version = 1) {
  assert(
    NATIVE_MANIFEST_VERSIONS.includes(version),
    "Unknown native manifest version.",
  );
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
  return `${cityId}-${day}-v${version}`;
}
/** Which manifest version a not-yet-prepared local date is created with. */
export function nativeManifestVersion(day, from = NATIVE_V2_START_DAY) {
  if (from === null || from === "off") return 1;
  assert(
    typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from),
    "NATIVE_MANIFEST_V2_FROM must be YYYY-MM-DD or off.",
    503,
  );
  return day >= from ? 2 : 1;
}
/** Every possible id of one city's local date, oldest version first. */
export function nativeDayIds(cityId, day) {
  return NATIVE_MANIFEST_VERSIONS.map((v) => nativeDayId(cityId, day, v));
}
/**
 * The stored manifest row of a city's local date, whichever version it was
 * prepared as. A publisher only ever prepares one version per date.
 */
export function nativeDayRow(db, cityId, day, { published = false } = {}) {
  const ids = nativeDayIds(cityId, day);
  return (
    db
      .prepare(
        `SELECT * FROM native_days WHERE id IN (${ids.map(() => "?").join(",")})${published ? " AND state='published'" : ""} ORDER BY id LIMIT 1`,
      )
      .get(...ids) || null
  );
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
  coinPoints = cityById(plan.cityId)
    ? sampleCityPaths(cityById(plan.cityId))
    : null,
  { budget = null, funding = null, version = 1 } = {},
) {
  const dayId = nativeDayId(plan.cityId, plan.day, version);
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
  const reward = (z) =>
    (
      (zoneBudget * BigInt(z.tier === 3 ? 2 : z.tier === 2 ? 1 : 0)) /
      BigInt(weights)
    ).toString();
  if (version === 2)
    return manifestV2(plan, dayId, unit, coinPoints, reward, funding);
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
// v2 quest templates. Each is enforced by the same ordered-checkpoint
// attestation as v1 (a visit or chest is one checkpoint, a return trail ends on
// its first stop). XP stays inside the contract's 500 per-quest bound; GOLD is
// the same tier-weighted zone budget as v1, so a day's payout exposure does not
// change with the mechanic.
export const NATIVE_V2_TEMPLATES = {
  "path-visit": {
    xp: 40,
    requirement:
      "Reach the marked path stop. Only the GPS checkpoint is attested.",
  },
  "ordered-trail": {
    xp: 80,
    requirement:
      "Visit three marked stops in order. Only GPS checkpoints are attested.",
  },
  "return-trail": {
    xp: 100,
    requirement:
      "Visit two further stops, then return to your start. Only GPS checkpoints are attested.",
  },
  "cosmetic-chest": {
    xp: 50,
    requirement:
      "Reach the chest and open it. The first opener takes any funded zone prize; no item is minted.",
  },
};
const V2_ROTATION = [
  "path-visit",
  "ordered-trail",
  "return-trail",
  "cosmetic-chest",
];
/** Deterministic from the shared city/day only; slot order guarantees variety. */
export function nativeV2Templates(cityId, day, count = 6) {
  const offset =
    parseInt(hash(`${NATIVE_POLICY_V2}:${cityId}:${day}`).slice(0, 8), 16) %
    V2_ROTATION.length;
  return Array.from(
    { length: count },
    (_, i) => V2_ROTATION[(offset + i) % V2_ROTATION.length],
  );
}
function v2Targets(templateId, zone) {
  // A visit and a chest in the same zone never share a stop with each other or
  // with the trail start: the visit uses stop 2, the chest stop 3.
  const source =
    templateId === "cosmetic-chest"
      ? { ...zone, targets: [zone.targets[2] || zone.targets[0]] }
      : zone;
  try {
    return instantiateQuestTemplate(templateId, source).activity.steps.map(
      (s) => ({ ...s.point }),
    );
  } catch {
    return null;
  }
}
function manifestV2(plan, dayId, unit, coinPoints, reward, funding) {
  const templates = nativeV2Templates(plan.cityId, plan.day, plan.zones.length);
  const quests = plan.zones.map((z, i) => {
    let templateId = templates[i],
      targets = z.geometry ? v2Targets(templateId, z) : null;
    // A zone whose stops cannot carry the chosen mechanic keeps the v1 walk.
    if (!targets) {
      templateId = "ordered-trail";
      targets = z.targets.map((p) => ({ lat: p.lat, lng: p.lng }));
    }
    targets.forEach(point);
    const t = NATIVE_V2_TEMPLATES[templateId];
    return {
      index: i,
      name: z.name,
      sector: z.sector,
      template: templateId,
      title: THEMES[i][0],
      prompt: THEMES[i][1],
      requirement: t.requirement,
      targets,
      tier: z.tier,
      reward: reward(z),
      xp: t.xp,
      opensAt: z.opensAt,
      closesAt: z.closesAt,
    };
  });
  // Street finds are highlighted coins: same index and same coin unit. Rewards
  // v2 records them at publication and pays find XP instead of coin XP; they
  // add no new GOLD.
  const finds = [
    ...pickStreetFinds(
      coinPoints.map((p, i) => ({ id: `${dayId}:coin:${i}`, ...p })),
    ),
  ]
    .map((id) => Number(id.split(":coin:")[1]))
    .sort((a, b) => a - b);
  const body = {
    version: 2,
    policy: NATIVE_POLICY_V2,
    id: dayId,
    day: plan.day,
    cityId: plan.cityId,
    timezone: plan.timezone,
    startsAt: plan.startsAt,
    endsAt: plan.endsAt,
    sourceHash: plan.sourceHash,
    coinUnit: unit.toString(),
    coins: coinPoints,
    finds,
    quests,
    fieldReview: "pending",
    evidence: "browser GPS attestation; spoofing resistance not established",
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
    // Ignored by the v1 contract (unknown argument); rewards v2 stores it.
    ...(m.finds?.length ? { finds: m.finds } : {}),
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
  // A v2 contract reports the finds it holds. None means a v1 contract or a
  // day published before the upgrade (backfilled by record_day_finds);
  // finds it does hold must be exactly the manifest's.
  if (
    Array.isArray(day.finds) &&
    day.finds.length &&
    JSON.stringify(day.finds) !== JSON.stringify(manifest.finds || [])
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

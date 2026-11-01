// "Fuel the city": staking presented as a game decision. Pure helpers so the
// tier and share numbers are testable. Amounts arrive as yoctoNEAR strings;
// the player sees GOLD (1 NEAR = 1,000 GOLD) and test NEAR for deposits.

const YOCTO = 10n ** 24n;
export const TIER_THRESHOLDS_GOLD = [
  { tier: 2, gold: 50_000 },
  { tier: 3, gold: 100_000 },
] as const;

export type FuelPosition = {
  id: string;
  account_id: string;
  pool: string;
  contribution_bps: number;
  state: string;
  position: Record<string, string | number | boolean> | null;
};

export type FuelTone = "pending" | "ready" | "failed" | "active" | "unlocking";

/** Player-facing state of one position, in the DESIGN.md vocabulary. */
export function fuelStatus(p: FuelPosition): { tone: FuelTone; label: string } {
  const s = p.position;
  if (!s) {
    if (p.state === "failed") return { tone: "failed", label: "Setup failed" };
    if (p.state === "created")
      return { tone: "pending", label: "Finish setup to add fuel" };
    return { tone: "pending", label: "Setting up…" };
  }
  if (s.owner_pending !== "0" || s.game_pending !== "0")
    return { tone: "pending", label: "Transfer on its way" };
  if (s.stage === "unlocking")
    return { tone: "unlocking", label: "Coming back to you" };
  if (s.stage !== "idle") return { tone: "pending", label: "Pool is working…" };
  if (s.owner_credit !== "0")
    return { tone: "ready", label: "Ready to withdraw" };
  if (s.exit_requested) return { tone: "unlocking", label: "Exit requested" };
  return BigInt(String(s.principal || "0")) > 0n
    ? { tone: "active", label: "Fueling the city" }
    : { tone: "ready", label: "Ready for fuel" };
}

function yoctoToGold(v: bigint): number {
  return Number((v * 1000n * 1000n) / YOCTO) / 1000;
}

/** Weighted stake of one position in GOLD: principal × contribution share. */
export function weightedGold(p: FuelPosition): number {
  const s = p.position;
  if (!s || s.exit_requested) return 0;
  const principal = BigInt(String(s.principal || "0"));
  return yoctoToGold((principal * BigInt(p.contribution_bps)) / 10_000n);
}

export function tierFor(weighted: number): number {
  let tier = 1;
  for (const t of TIER_THRESHOLDS_GOLD) if (weighted >= t.gold) tier = t.tier;
  return tier;
}

export function nextTier(weighted: number) {
  const next = TIER_THRESHOLDS_GOLD.find((t) => weighted < t.gold);
  return next ? { tier: next.tier, missingGold: next.gold - weighted, gold: next.gold } : null;
}

export type FuelSummary = {
  myWeightedGold: number;
  myStakeNear: number;
  cityWeightedGold: number | null;
  stakers: number | null;
  /** Share of the city's fuel that is yours, 0..1, or null when unknown. */
  share: number | null;
  tier: number;
  next: ReturnType<typeof nextTier>;
};

export function summarizeFuel(
  positions: FuelPosition[],
  city: { weightedStake?: string | null; stakers?: number | null } | null,
): FuelSummary {
  const myWeightedGold = positions.reduce((n, p) => n + weightedGold(p), 0);
  const myStakeNear =
    Number(
      positions.reduce(
        (n, p) =>
          n + (p.position ? BigInt(String(p.position.principal || "0")) : 0n),
        0n,
      ) / 10n ** 21n,
    ) / 1000;
  const cityWeightedGold = city?.weightedStake
    ? yoctoToGold(BigInt(city.weightedStake))
    : null;
  const share =
    cityWeightedGold && cityWeightedGold > 0
      ? Math.min(1, myWeightedGold / cityWeightedGold)
      : null;
  return {
    myWeightedGold,
    myStakeNear,
    cityWeightedGold,
    stakers: city?.stakers ?? null,
    share,
    tier: tierFor(myWeightedGold),
    next: nextTier(myWeightedGold),
  };
}

/** What a deposit would add, before it is sent. */
export function previewFuel(
  summary: FuelSummary,
  amountNear: number,
  contributionPct: number,
) {
  const added = amountNear * 1000 * (contributionPct / 100);
  const after = summary.myWeightedGold + added;
  return { addedGold: added, afterGold: after, tierAfter: tierFor(after) };
}

export const CONTRIBUTION_CHOICES = [
  { pct: 25, label: "Light", hint: "Keep most of your yield" },
  { pct: 50, label: "Balanced", hint: "Half fuels the city" },
  { pct: 100, label: "All in", hint: "All yield fuels the city" },
] as const;

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
  const partial = BigInt(String(s.partial_exit ?? "0"));
  if (s.stage === "unlocking")
    return {
      tone: "unlocking",
      label: partial > 0n ? "Part of your stake is coming back" : "Coming back to you",
    };
  if (s.stage !== "idle")
    return {
      tone: "pending",
      label: partial > 0n ? "Taking part of your stake out…" : "Pool is working…",
    };
  if (s.owner_credit !== "0")
    return { tone: "ready", label: "Ready to withdraw" };
  if (s.exit_requested) return { tone: "unlocking", label: "Exit requested" };
  if (typeof s.pending_contribution_bps === "number")
    return {
      tone: "pending",
      label: `Switching to ${s.pending_contribution_bps / 100} % after settlement`,
    };
  return BigInt(String(s.principal || "0")) > 0n
    ? { tone: "active", label: "Fueling the city" }
    : { tone: "ready", label: "Ready for fuel" };
}

function yoctoToGold(v: bigint): number {
  return Number((v * 1000n * 1000n) / YOCTO) / 1000;
}

/** The contribution in force: v2 vaults can change it, so the live state wins. */
export function contributionBps(p: FuelPosition): number {
  const live = p.position?.contribution_bps;
  return typeof live === "number" ? live : p.contribution_bps;
}

/** Weighted stake of one position in GOLD: principal × contribution share. */
export function weightedGold(p: FuelPosition): number {
  const s = p.position;
  if (!s || s.exit_requested) return 0;
  const principal = BigInt(String(s.principal || "0"));
  return yoctoToGold((principal * BigInt(contributionBps(p))) / 10_000n);
}

/**
 * Only vault v2 has request_partial_exit and set_contribution. Factory
 * positions created before the upgrade stay v1, so the app offers these
 * actions only where the live state says version 2.
 */
export function isVaultV2(p: FuelPosition): boolean {
  return p.position?.version === 2;
}

const MIN_POSITION = 10n ** 21n;
const big = (v: unknown) => BigInt(String(v ?? "0"));
const mulBps = (v: bigint, bps: number) =>
  (v / 10_000n) * BigInt(bps) + ((v % 10_000n) * BigInt(bps)) / 10_000n;
const near = (v: bigint) => Number((v * 1000n) / YOCTO) / 1000;

export type PartialExitQuote =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** test NEAR the owner gets back (the principal taken out). */
      receiveNear: number;
      /** The game's share of gain so far, settled at today's rate. */
      cityFeeNear: number;
      remainingNear: number;
      goldAfter: number;
      tierAfter: number;
    };

/**
 * Mirrors the vault: the request takes `amount` of principal, settles the
 * game's share of the gain so far, and must leave at least 0.001 test NEAR.
 */
export function quotePartialExit(
  p: FuelPosition,
  amountYocto: string,
  summary: FuelSummary,
): PartialExitQuote {
  const s = p.position;
  if (!s || !isVaultV2(p))
    return { ok: false, reason: "This stake predates partial withdrawals; use a full exit." };
  if (s.stage !== "idle" || s.exit_requested)
    return { ok: false, reason: "Wait until the current operation finishes." };
  if (big(s.partial_exit) > 0n)
    return { ok: false, reason: "A partial withdrawal is already on its way." };
  const amount = BigInt(amountYocto),
    principal = big(s.principal);
  if (amount < MIN_POSITION || amount + MIN_POSITION > principal)
    return {
      ok: false,
      reason: "Leave at least 0.001 test NEAR staked, or use a full exit.",
    };
  const total = big(s.staked) + big(s.unstaked),
    gain = total > big(s.high_water_basis) ? total - big(s.high_water_basis) : 0n,
    fee = mulBps(gain, contributionBps(p)),
    remaining = principal - amount;
  const goldAfter =
    summary.myWeightedGold -
    weightedGold(p) +
    yoctoToGold((remaining * BigInt(contributionBps(p))) / 10_000n);
  return {
    ok: true,
    receiveNear: near(amount),
    cityFeeNear: near(fee),
    remainingNear: near(remaining),
    goldAfter,
    tierAfter: tierFor(goldAfter),
  };
}

export type ContributionQuote =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** True when earned gain settles at the old rate first (a harvest). */
      settlesFirst: boolean;
      oldPct: number;
      newPct: number;
      goldAfter: number;
      tierAfter: number;
    };

/** Mirrors set_contribution: earned gain is never re-priced. */
export function quoteContribution(
  p: FuelPosition,
  newBps: number,
  summary: FuelSummary,
): ContributionQuote {
  const s = p.position;
  if (!s || !isVaultV2(p))
    return { ok: false, reason: "This stake predates share changes; exit and start a new one." };
  if (!Number.isInteger(newBps) || newBps < 0 || newBps > 10_000)
    return { ok: false, reason: "Choose a share between 0 and 100 %." };
  if (s.stage !== "idle" || s.exit_requested)
    return { ok: false, reason: "Wait until the current operation finishes." };
  if (big(s.partial_exit) > 0n)
    return { ok: false, reason: "Wait for the partial withdrawal to finish." };
  const current = contributionBps(p),
    waiting = typeof s.pending_contribution_bps === "number";
  if (newBps === current && !waiting)
    return { ok: false, reason: "This is already your share." };
  if (waiting && newBps === s.pending_contribution_bps)
    return { ok: false, reason: "This change is already waiting." };
  const total = big(s.staked) + big(s.unstaked),
    gain = total > big(s.high_water_basis) ? total - big(s.high_water_basis) : 0n,
    principal = big(s.principal);
  const goldAfter =
    summary.myWeightedGold -
    weightedGold(p) +
    yoctoToGold((principal * BigInt(newBps)) / 10_000n);
  return {
    ok: true,
    settlesFirst: mulBps(gain, current) > 0n,
    oldPct: current / 100,
    newPct: newBps / 100,
    goldAfter,
    tierAfter: tierFor(goldAfter),
  };
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

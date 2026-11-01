// "Today's pot": what backs the rewards a player can still find today.
// Pure functions so the numbers are testable without a browser. Practice
// numbers come from the practice ledger (/api/dashboard); test-network numbers
// come from the audited rewards treasury (/api/native/distribution) and the
// economy snapshot (/api/native/economy). The two are never added together.

export const GOLD_PER_NEAR = 1000n;
const YOCTO = 10n ** 24n;
const PRACTICE_UNIT = 1_000_000; // micro-GOLD per GOLD (server/domain.mjs)

export type PotSource = "sponsor" | "yield" | "sponsor-and-yield";

export type TodaysPot = {
  ledger: "practice" | "test-network";
  /** Whole GOLD published for today's map, or null when the ledger cannot say. */
  fundedGold: number | null;
  /** Practice only: top-ups the practice fund received today (sponsor or simulated yield). */
  toppedUpGold: number | null;
  /** Whole GOLD still unclaimed on today's map. */
  leftGold: number;
  source: PotSource;
  /** Share of all reward funding that came from realized yield, 0..1, or null. */
  yieldShare: number | null;
  /** True only when the treasury audit returned "verified". */
  booksChecked: boolean;
  date: string;
};

type PracticeBucket = {
  bucket: string;
  available_u: number;
  reserved_u: number;
  paid_u: number;
};
type PracticeEvent = {
  kind: string;
  coins_u: number;
  zones_u: number;
  created_at: number;
};
export type PracticeDashboard = {
  buckets: PracticeBucket[];
  events: PracticeEvent[];
};

type DistributionDay = {
  id: string;
  chain: string;
  unclaimedCoins?: string;
  unwonPrizes?: string;
};
type DistributionCheck = {
  name: string;
  ok: boolean;
  dates?: { date: string; chainCoins: string; chainZones: string }[];
};
export type Distribution = {
  status: string;
  checks?: DistributionCheck[];
  days?: DistributionDay[];
  totals?: { funded: string };
};
export type EconomyFunding = {
  treasury?: { data: { funded: string } | null };
  staking?: {
    data: { totals: { realizedGameYieldPaid: string } | null } | null;
  };
};

/** Local calendar date (YYYY-MM-DD) in the city's time zone. */
export function localDate(now: number, timeZone = "Europe/Prague"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** yoctoNEAR decimal string → whole display GOLD (1 NEAR = 1,000 GOLD), rounded down. */
export function yoctoToGold(value: string | undefined | null): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const milli = (BigInt(value) * GOLD_PER_NEAR * 1000n) / YOCTO;
  return Number(milli) / 1000;
}

function sourceFrom(yieldPart: bigint, total: bigint): PotSource {
  if (yieldPart <= 0n) return "sponsor";
  if (yieldPart >= total) return "yield";
  return "sponsor-and-yield";
}

export function practicePot(
  dashboard: PracticeDashboard,
  now: number,
  timeZone?: string,
): TodaysPot {
  const date = localDate(now, timeZone);
  const reserved = dashboard.buckets.reduce((n, b) => n + b.reserved_u, 0);
  const today = dashboard.events.filter(
    (e) => localDate(e.created_at, timeZone) === date,
  );
  const fundedToday = today.reduce((n, e) => n + e.coins_u + e.zones_u, 0);
  const anyYield = dashboard.events.some((e) => e.kind.includes("yield"));
  return {
    ledger: "practice",
    // The practice ledger does not record what each day's map reserved, so it
    // reports today's top-ups instead of pretending to know a day budget.
    fundedGold: null,
    toppedUpGold: today.length ? fundedToday / PRACTICE_UNIT : null,
    leftGold: reserved / PRACTICE_UNIT,
    // The practice fund opens with a sponsor contribution; simulated yield tops it up.
    source: anyYield ? "sponsor-and-yield" : "sponsor",
    yieldShare: null,
    booksChecked: false,
    date,
  };
}

export function nativePot(
  distribution: Distribution,
  economy: EconomyFunding | null,
  now: number,
  timeZone?: string,
): TodaysPot {
  const date = localDate(now, timeZone);
  const totals = distribution.checks
    ?.find((c) => c.name === "date-totals-match-publications")
    ?.dates?.find((d) => d.date === date);
  const todays = (distribution.days || []).filter(
    (d) => d.chain === "open" && d.id.includes(`-${date}-v`),
  );
  const left = todays.reduce(
    (n, d) => n + BigInt(d.unclaimedCoins || "0") + BigInt(d.unwonPrizes || "0"),
    0n,
  );
  const funded = totals
    ? BigInt(totals.chainCoins) + BigInt(totals.chainZones)
    : null;
  const allFunded = BigInt(
    economy?.treasury?.data?.funded || distribution.totals?.funded || "0",
  );
  const yieldPaid = BigInt(
    economy?.staking?.data?.totals?.realizedGameYieldPaid || "0",
  );
  const share =
    allFunded > 0n
      ? Math.min(1, Number((yieldPaid * 1000n) / allFunded) / 1000)
      : null;
  return {
    ledger: "test-network",
    fundedGold: funded === null ? null : yoctoToGold(funded.toString()),
    toppedUpGold: null,
    leftGold: yoctoToGold(left.toString()),
    source: sourceFrom(yieldPaid, allFunded),
    yieldShare: share,
    booksChecked: distribution.status === "verified",
    date,
  };
}

export function sourceLabel(pot: TodaysPot): string {
  if (pot.ledger === "practice")
    return pot.source === "sponsor"
      ? "Sponsor fund"
      : "Sponsor fund + practice yield";
  if (pot.source === "yield") return "Staking yield";
  if (pot.source === "sponsor") return "Sponsor";
  const pct = pot.yieldShare === null ? null : Math.round(pot.yieldShare * 100);
  return pct ? `Sponsor + staking yield (${pct} %)` : "Sponsor + staking yield";
}

export function formatPotGold(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 10 ? 3 : value < 1000 ? 1 : 0,
  }).format(value);
}

import { YOCTO_PER_GOLD } from "./gold-units.ts";
import { tr } from "./i18n.ts";
import { useSyncExternalStore } from "react";
import { ApiError } from "./api";

// Read model for "Today's pot" and the "How rewards are funded" page.
// Sources: GET /api/native/economy (server/native/economy.mjs) and
// GET /api/native/distribution (server/native/distribution.mjs). Both are
// public, identity-free reads. Every amount shown comes from one of these
// responses; nothing is summed, forecast or filled in with zero.

type Read<T> = {
  status: string;
  observedAt: string | null;
  data: T | null;
};
type Bucket = { available: string; reserved: string; awarded: string };
export type EconomyResponse = {
  status: string;
  goldPerNear?: number;
  treasury: Read<{
    policy?: string;
    buckets: { coins: Bucket; zones: Bucket };
    funded: string;
    available: string;
    reserved: string;
    fundingLabel?: string;
    excludes?: string[];
  }>;
  staking: Read<{
    complete: boolean;
    totals: { realizedGameYieldPaid: string } | null;
    outlook?: { reason?: string };
  }>;
};
type DateTotal = {
  date: string;
  ok?: boolean;
  chainCoins?: string;
  chainZones?: string;
};
export type DistributionCheck = {
  name: string;
  ok: boolean;
  // Present on "date-totals-match-publications": what was published per date.
  dates?: DateTotal[];
};
export type DistributionDay = {
  id: string;
  chain: string;
  unclaimedCoins?: string;
  unwonPrizes?: string;
};
export type DistributionResponse = {
  status: string;
  observedAt?: number;
  failed?: string[];
  checks: DistributionCheck[];
  days?: DistributionDay[];
};

export type SourceRead<T> =
  | { state: "ready"; value: T }
  // 503 / not configured: the host runs without the funded ledger.
  | { state: "off" }
  // Network or unexpected failure: we could not ask.
  | { state: "failed"; offline: boolean };

export type RewardFundingSnapshot = {
  loading: boolean;
  checkedAt: number | null;
  economy: SourceRead<EconomyResponse> | null;
  distribution: SourceRead<DistributionResponse> | null;
};

// 1 GOLD = the smallest QGOLD unit: 10^15 of the native smallest unit at the
// vault's starting rate (src/gold-units.ts).
const UNITS_PER_GOLD = YOCTO_PER_GOLD;
const INTEGER = /^\d{1,40}$/;
export function isAmount(value: unknown): value is string {
  return typeof value === "string" && INTEGER.test(value);
}
const grouping = new Intl.NumberFormat("en-US");
/** Exact GOLD value of an integer-unit decimal string, trailing zeros trimmed. */
export function goldExact(value: string): string {
  const units = BigInt(value);
  const whole = units / UNITS_PER_GOLD;
  const fraction = (units % UNITS_PER_GOLD)
    .toString()
    .padStart(15, "0")
    .replace(/0+$/, "");
  return grouping.format(whole) + (fraction ? "." + fraction : "");
}
/** Compact whole GOLD value; marks rounding with "≈". */
export function goldCompact(value: string): string {
  const units = BigInt(value);
  const step = UNITS_PER_GOLD;
  const rounded = ((units + step / 2n) / step) * step;
  const text = goldExact(rounded.toString());
  return rounded === units ? text : `≈ ${text}`;
}

// City days are keyed by the Plzeň local date (server/domain.mjs dayKey).
export function cityDayKey(now = Date.now(), timeZone = "Europe/Prague") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function dayDate(id: string): string | null {
  return /-(\d{4}-\d{2}-\d{2})-v\d+$/.exec(id)?.[1] ?? null;
}
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export type BooksState = "checked" | "drift" | "unchecked";
export type FundingSource =
  | { kind: "sponsor" } // realized yield received is exactly zero
  | { kind: "mixed"; yieldReceived: string } // some realized yield received
  | { kind: "unknown" }; // staking totals could not be read completely
export type OpenDay = {
  id: string;
  date: string | null;
  today: boolean;
  coinsLeft: string;
  prizesLeft: string;
  // Published (funded) for this date, when the audit reports per-date totals.
  coinsFunded: string | null;
  prizesFunded: string | null;
};
export type PotView =
  | { kind: "loading" }
  | { kind: "practice" }
  | { kind: "failed"; offline: boolean }
  | {
      kind: "ready";
      stale: boolean;
      treasury: EconomyResponse["treasury"]["data"];
      treasuryObservedAt: string | null;
      source: FundingSource;
      outlookReason: string | null;
      books: BooksState;
      checks: DistributionCheck[];
      booksObservedAt: number | null;
      openDays: OpenDay[] | null;
      today: OpenDay | null;
    };

function validTreasury(
  t: EconomyResponse["treasury"]["data"],
): t is NonNullable<EconomyResponse["treasury"]["data"]> {
  return (
    !!t &&
    isAmount(t.funded) &&
    isAmount(t.available) &&
    isAmount(t.reserved) &&
    ["coins", "zones"].every((k) => {
      const b = t.buckets?.[k as "coins" | "zones"];
      return (
        !!b &&
        isAmount(b.available) &&
        isAmount(b.reserved) &&
        isAmount(b.awarded)
      );
    })
  );
}

export function potView(
  snapshot: RewardFundingSnapshot,
  now = Date.now(),
): PotView {
  const { economy, distribution } = snapshot;
  if (!economy || !distribution) return { kind: "loading" };
  const economyData = economy.state === "ready" ? economy.value : null;
  const treasuryRead =
    economyData &&
    economyData.treasury?.status !== "unavailable" &&
    validTreasury(economyData.treasury?.data ?? null)
      ? economyData.treasury
      : null;
  const audit =
    distribution.state === "ready" &&
    distribution.value.status !== "unavailable"
      ? distribution.value
      : null;
  if (!treasuryRead && !audit) {
    if (economy.state === "failed" || distribution.state === "failed")
      return {
        kind: "failed",
        offline:
          (economy.state === "failed" && economy.offline) ||
          (distribution.state === "failed" && distribution.offline),
      };
    return { kind: "practice" };
  }
  const stakingRead = economyData?.staking;
  const yieldPaid =
    stakingRead &&
    stakingRead.status === "observed" &&
    stakingRead.data?.complete &&
    isAmount(stakingRead.data.totals?.realizedGameYieldPaid)
      ? stakingRead.data.totals!.realizedGameYieldPaid
      : null;
  const source: FundingSource =
    yieldPaid === null
      ? { kind: "unknown" }
      : BigInt(yieldPaid) === 0n
        ? { kind: "sponsor" }
        : { kind: "mixed", yieldReceived: yieldPaid };
  const todayKey = cityDayKey(now);
  const dateTotals = new Map<string, DateTotal>();
  for (const check of audit?.checks || [])
    if (Array.isArray(check.dates))
      for (const row of check.dates)
        if (row && typeof row.date === "string") dateTotals.set(row.date, row);
  const openDays = audit
    ? (audit.days || [])
        .filter(
          (d) =>
            d.chain === "open" &&
            isAmount(d.unclaimedCoins) &&
            isAmount(d.unwonPrizes),
        )
        .map((d) => {
          const date = dayDate(d.id);
          const total = date ? dateTotals.get(date) : undefined;
          return {
            id: d.id,
            date,
            today: date === todayKey,
            coinsLeft: d.unclaimedCoins!,
            prizesLeft: d.unwonPrizes!,
            coinsFunded: isAmount(total?.chainCoins) ? total.chainCoins : null,
            prizesFunded: isAmount(total?.chainZones) ? total.chainZones : null,
          };
        })
    : null;
  return {
    kind: "ready",
    stale: treasuryRead?.status === "stale",
    treasury: treasuryRead?.data ?? null,
    treasuryObservedAt: treasuryRead?.observedAt ?? null,
    source,
    outlookReason:
      typeof stakingRead?.data?.outlook?.reason === "string"
        ? stakingRead.data.outlook.reason
        : null,
    books: !audit
      ? "unchecked"
      : audit.status === "verified"
        ? "checked"
        : audit.status === "drift"
          ? "drift"
          : "unchecked",
    checks: audit?.checks || [],
    booksObservedAt:
      typeof audit?.observedAt === "number" ? audit.observedAt : null,
    openDays,
    today: openDays?.find((d) => d.today) ?? null,
  };
}

// Plain names for the six checks in server/native/distribution.mjs.
export const CHECK_NAMES: Record<string, string> = {
  get "ledger-conservation"() { return tr("Every funded GOLD is accounted for"); },
  get "coin-reservations-explained"() { return tr("Coins set aside match the open days"); },
  get "zone-reservations-explained"() { return tr("Prizes set aside match the open days"); },
  get "open-days-match-manifests"() { return tr("Open days match their published plan"); },
  get "receipts-within-chain-claims"() { return tr("Receipts never exceed accepted claims"); },
  get "account-covers-liabilities"() { return tr("The reward account holds enough to pay"); },
  get "date-totals-match-publications"() { return tr("Each day's funded total matches what was published"); },
};
// Plain names for treasury.excludes in server/native/economy.mjs.
export const EXCLUDED_NAMES: Record<string, string> = {
  "player principal": "Explorers' own staked deposits",
  get "operating top-ups"() { return tr("Money that keeps the game running"); },
  get "receipt storage fees"() { return tr("Fees for storing reward receipts"); },
};

// One shared store so the Explore element and the page read the same answer.
const FRESH_MS = 60_000;
let snapshot: RewardFundingSnapshot = {
  loading: false,
  checkedAt: null,
  economy: null,
  distribution: null,
};
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();
function publish(next: Partial<RewardFundingSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}
async function read<T>(path: string): Promise<SourceRead<T>> {
  try {
    const response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 503 || response.status === 404)
      return { state: "off" };
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object")
      throw new ApiError("Unexpected answer.", "", response.status);
    return { state: "ready", value: body as T };
  } catch {
    return {
      state: "failed",
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
    };
  }
}
export function refreshRewardFunding(force = false): Promise<void> {
  if (inFlight) return inFlight;
  const failed =
    snapshot.economy?.state === "failed" ||
    snapshot.distribution?.state === "failed";
  if (
    !force &&
    !failed &&
    snapshot.checkedAt !== null &&
    Date.now() - snapshot.checkedAt < FRESH_MS
  )
    return Promise.resolve();
  publish({ loading: true });
  inFlight = Promise.all([
    read<EconomyResponse>("/native/economy"),
    read<DistributionResponse>("/native/distribution"),
  ])
    .then(([economy, distribution]) =>
      publish({ economy, distribution, loading: false, checkedAt: Date.now() }),
    )
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useRewardFunding(): RewardFundingSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

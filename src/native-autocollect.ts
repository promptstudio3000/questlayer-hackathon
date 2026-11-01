import type { Fix } from "./types";
import type { NativeGameState, NativeReceipt } from "./native-game-types";
import { NEAR_NETWORK } from "./near-network.ts";

export type NativeAutoStatus =
  | "off"
  | "inactive"
  | "offline"
  | "hidden"
  | "wallet"
  | "unjoined"
  | "loading"
  | "unavailable"
  | "paused"
  | "expired"
  | "gps_required"
  | "gps_inaccurate"
  | "gps_stale"
  | "pending"
  | "collecting"
  | "walking"
  | "cooldown"
  | "day_limit"
  | "account_limit"
  | "review"
  | "storage";
export type NativeAutoConfirmed = {
  count: number;
  amount: string;
  xp: number;
  accountId: string;
  dayId: string;
  receiptIds: string[];
};
export type NativeAutoView = {
  enabled: boolean;
  status: NativeAutoStatus;
  message: string;
  pending: number;
  retryAt: number | null;
  confirmed: { count: number; amount: string; xp: number };
};
export type NativeAutoInput = {
  playerId?: string;
  accountId: string;
  linked: boolean;
  nativeMode: boolean;
  active: boolean;
  arena: boolean;
  visible: boolean;
  online: boolean;
  fix: Fix | null;
  state: NativeGameState | null;
};
export type NativeCoinSubmission = {
  accountId: string;
  dayId: string;
  kind: "coin";
  index: number;
  mode: "gps";
  fix: Fix;
};
type JournalEntry = {
  index: number;
  id: string | null;
  confirmed: boolean;
  owned: boolean;
  notified: boolean;
};
type Session = {
  key: string;
  accountId: string;
  dayId: string;
  contractId: string;
  minimumFixAt: number;
  entries: Map<number, JournalEntry>;
  baseline: boolean;
  enabled: boolean;
  retryAt: number;
  failures: number;
  blocked: NativeAutoStatus | null;
  blockedFix: number | null;
  confirmed: NativeAutoView["confirmed"];
  batch: NativeAutoConfirmed | null;
  flushAt: number;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const messages: Record<NativeAutoStatus, string> = {
  off: "Collect as you walk is off",
  inactive: "Return to the map to collect",
  offline: "Waiting for a connection",
  hidden: "Paused while the app is hidden",
  wallet: "Link a NEAR wallet to collect",
  unjoined: "Join native expeditions first",
  loading: "Refreshing the native day",
  unavailable: "Native collection is not available",
  paused: "Native collection is paused",
  expired: "Waiting for the next native day",
  gps_required: "Enable GPS to collect",
  gps_inaccurate: "Waiting for more accurate GPS",
  gps_stale: "Waiting for a fresh GPS fix",
  pending: "Waiting for coin confirmations",
  collecting: "Recording a coin visit",
  walking: "Walk closer to a street coin",
  cooldown: "Waiting before the next visit",
  day_limit: "Today's native pilot is full",
  account_limit: "Today's 100-coin limit reached",
  review: "Check your native receipts before continuing",
  storage: "Automatic collection needs available browser storage",
};
const integer = (n: unknown): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0;
const exactAmount = (n: unknown): n is string =>
  typeof n === "string" && /^(0|[1-9]\d{0,77})$/.test(n);
const distance = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) => {
  const r = Math.PI / 180,
    x = (b.lat - a.lat) * r,
    y = (b.lng - a.lng) * r;
  const h =
    Math.sin(x / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(y / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
};
const validPoint = (p: { lat: number; lng: number }) =>
  Number.isFinite(p.lat) &&
  Math.abs(p.lat) <= 85 &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lng) <= 180;

/** A foreground-only scheduler. The server remains the authority for every award. */
export function createNativeAutoCollector(options: {
  submit: (input: NativeCoinSubmission) => Promise<NativeReceipt>;
  refresh: () => Promise<void>;
  storage: Storage | null;
  clock?: () => number;
  onChange?: (view: NativeAutoView) => void;
  onConfirmed?: (delta: NativeAutoConfirmed) => void;
}) {
  const clock = options.clock || Date.now;
  let input: NativeAutoInput | null = null,
    session: Session | null = null;
  let flight: Session | null = null,
    disposed = false,
    storageReady = !!options.storage;
  let lastView = "",
    nextSubmission = 0,
    lastObservation: NativeGameState | null = null;
  const persist = (s: Session) => {
    try {
      if (!options.storage) throw Error("Storage unavailable");
      options.storage.setItem(
        s.key,
        JSON.stringify({
          version: 1,
          entries: [...s.entries.values()].map(
            ({ owned: _, ...entry }) => entry,
          ),
        }),
      );
      return true;
    } catch {
      storageReady = false;
      return false;
    }
  };
  const createSession = (i: NativeAutoInput, dayId: string) => {
    const contractId = i.state?.contractId || "";
    const s: Session = {
      key: `questlayer:native-autocollect:v1:${JSON.stringify([i.playerId, NEAR_NETWORK, contractId, i.accountId, dayId])}`,
      accountId: i.accountId,
      dayId,
      contractId,
      minimumFixAt: session
        ? Math.max(clock(), (i.fix?.timestamp || 0) + 1)
        : 0,
      entries: new Map(),
      baseline: false,
      enabled: false,
      retryAt: 0,
      failures: 0,
      blocked: null,
      blockedFix: null,
      confirmed: { count: 0, amount: "0", xp: 0 },
      batch: null,
      flushAt: 0,
    };
    try {
      const saved = options.storage?.getItem(s.key);
      if (saved) {
        const data = JSON.parse(saved);
        if (
          data.version !== 1 ||
          !Array.isArray(data.entries) ||
          data.entries.length > 512
        )
          throw Error("Invalid journal");
        for (const e of data.entries) {
          if (
            !integer(e.index) ||
            (e.id !== null && typeof e.id !== "string") ||
            typeof e.confirmed !== "boolean"
          )
            throw Error("Invalid journal entry");
          // Restored history is always silent. The new session has its own opt-in.
          s.entries.set(e.index, {
            index: e.index,
            id: e.id,
            confirmed: e.confirmed,
            owned: false,
            notified: true,
          });
        }
      }
      persist(s);
    } catch {
      storageReady = false;
    }
    return s;
  };
  const matchingReceipt = (s: Session, r: NativeReceipt) =>
    r.accountId === s.accountId &&
    r.dayId === s.dayId &&
    r.kind === "coin" &&
    integer(r.index) &&
    typeof r.id === "string" &&
    !!r.id;
  const acceptReceipt = (s: Session, r: NativeReceipt, baseline = false) => {
    if (!matchingReceipt(s, r)) return false;
    let e = s.entries.get(r.index);
    const before = JSON.stringify(e);
    const wasUncertain = !!e && !e.id;
    if (e?.id && e.id !== r.id) {
      s.blocked = "review";
      return false;
    }
    if (!e) {
      if (s.entries.size >= 512) return false;
      e = {
        index: r.index,
        id: r.id,
        confirmed: false,
        owned: false,
        notified: true,
      };
      s.entries.set(r.index, e);
    }
    e.id = r.id;
    if (wasUncertain) s.failures = 0;
    if (r.state === "confirmed") {
      e.confirmed = true;
      if (baseline || !e.owned) e.notified = true;
      if (!e.notified && exactAmount(r.amount) && integer(r.xp)) {
        // Commit the seen marker before delivering any feedback, even if the UI throws.
        e.notified = true;
        if (persist(s) && session === s && !disposed) {
          s.batch ||= {
            count: 0,
            amount: "0",
            xp: 0,
            accountId: s.accountId,
            dayId: s.dayId,
            receiptIds: [],
          };
          s.batch.count++;
          s.batch.amount = (
            BigInt(s.batch.amount) + BigInt(r.amount)
          ).toString();
          s.batch.xp += r.xp;
          s.batch.receiptIds.push(r.id);
          s.flushAt ||= clock() + 2000;
        }
      }
    }
    return before !== JSON.stringify(e) ? persist(s) : true;
  };
  const pendingCount = () => {
    const s = session;
    if (!s) return 0;
    const locallyPending = [...s.entries.values()].filter(
      (e) => !e.confirmed,
    ).length;
    const current = input?.state;
    const c =
      current?.accountId === s.accountId &&
      current.day?.id === s.dayId &&
      current.contractId === s.contractId
        ? current.collection
        : undefined;
    // Retain known local pending receipts through an unavailable observation.
    // The availability guard independently blocks collection until it recovers.
    return Math.max(
      locallyPending,
      integer(c?.pendingCoinsToday) ? c.pendingCoinsToday : 0,
    );
  };
  const gate = (): NativeAutoStatus | null => {
    const i = input,
      s = session,
      now = clock();
    if (!s?.enabled) return "off";
    if (!i?.nativeMode || !i.active) return "inactive";
    if (!i.visible) return "hidden";
    if (!i.online) return "offline";
    if (!i.playerId || !i.accountId || !i.linked) return "wallet";
    if (!storageReady) return "storage";
    const state = i.state,
      day = state?.day,
      c = state?.collection;
    if (
      !state ||
      state.accountId !== s.accountId ||
      state.network !== NEAR_NETWORK ||
      state.contractId !== s.contractId ||
      !day ||
      day.id !== s.dayId
    )
      return "loading";
    if (!state.enrolled) return "unjoined";
    if (
      !Number.isFinite(state.generatedAt) ||
      state.generatedAt > now + 2000 ||
      now - state.generatedAt > 30000
    )
      return "loading";
    if (
      !Number.isFinite(day.startsAt) ||
      !Number.isFinite(day.endsAt) ||
      now < day.startsAt ||
      now >= day.endsAt
    )
      return "expired";
    if (c?.paused || s.blocked === "paused") return "paused";
    if (
      !integer(day.claimsAccepted) ||
      !integer(day.claimsLimit) ||
      !c ||
      !integer(c.coinsAcceptedToday) ||
      !integer(c.pendingCoinsToday) ||
      !integer(c.coinLimit)
    )
      return "unavailable";
    if (day.claimsAccepted >= day.claimsLimit || s.blocked === "day_limit")
      return "day_limit";
    const accepted = [...s.entries.values()].filter(
      (e) => e.id && !e.id.startsWith("claimed:"),
    ).length;
    if (
      Math.max(c.coinsAcceptedToday, accepted) >= Math.min(100, c.coinLimit) ||
      s.blocked === "account_limit"
    )
      return "account_limit";
    if (state.status !== "ready" || c.available !== true) return "unavailable";
    if (s.blocked) return s.blocked;
    if (i.arena || !i.fix || !validPoint(i.fix)) return "gps_required";
    if (
      !Number.isFinite(i.fix.accuracy) ||
      i.fix.accuracy < 0 ||
      i.fix.accuracy > 35
    )
      return "gps_inaccurate";
    if (
      !Number.isFinite(i.fix.timestamp) ||
      i.fix.timestamp < s.minimumFixAt ||
      i.fix.timestamp > now + 2000 ||
      now - i.fix.timestamp > 15000 ||
      (s.blockedFix !== null && i.fix.timestamp <= s.blockedFix)
    )
      return "gps_stale";
    if (flight) return "collecting";
    if (pendingCount() >= 3) return "pending";
    if (now < Math.max(s.retryAt, nextSubmission)) return "cooldown";
    return null;
  };
  const candidate = () => {
    const i = input,
      s = session;
    if (!i?.fix || !i.state?.day || !s) return null;
    const uncertain = [...s.entries.values()].find((e) => !e.id);
    return (
      i.state.day.coins
        .filter(
          (coin) =>
            integer(coin.index) &&
            validPoint(coin) &&
            !s.entries.get(coin.index)?.id &&
            (!uncertain || coin.index === uncertain.index) &&
            distance(i.fix!, coin) <= 35,
        )
        .sort(
          (a, b) =>
            distance(i.fix!, a) - distance(i.fix!, b) || a.index - b.index,
        )[0] || null
    );
  };
  const view = (): NativeAutoView => {
    const status = gate() || "walking";
    return {
      enabled: !!session?.enabled,
      status,
      message: messages[status],
      pending: pendingCount(),
      retryAt:
        session?.enabled && Math.max(session.retryAt, nextSubmission) > clock()
          ? Math.max(session.retryAt, nextSubmission)
          : null,
      confirmed: {
        ...(session?.confirmed || { count: 0, amount: "0", xp: 0 }),
      },
    };
  };
  const emit = () => {
    if (disposed) return;
    const v = view(),
      serialized = JSON.stringify(v);
    if (serialized !== lastView) {
      lastView = serialized;
      options.onChange?.(v);
    }
  };
  const flush = () => {
    const s = session;
    if (!s?.batch || clock() < s.flushAt || !input?.visible || !input.online)
      return;
    const batch = s.batch;
    s.batch = null;
    s.flushAt = 0;
    s.confirmed = {
      count: s.confirmed.count + batch.count,
      amount: (BigInt(s.confirmed.amount) + BigInt(batch.amount)).toString(),
      xp: s.confirmed.xp + batch.xp,
    };
    try {
      options.onConfirmed?.(batch);
    } catch {
      /* Presentation failure must not replay a confirmed award. */
    }
  };
  return {
    update(next: NativeAutoInput) {
      if (disposed) return;
      const previous = input;
      input = next;
      const knownDay =
        next.state?.accountId === next.accountId
          ? next.state.day?.id
          : undefined;
      if (
        !session ||
        previous?.playerId !== next.playerId ||
        previous?.accountId !== next.accountId ||
        (knownDay &&
          (knownDay !== session.dayId ||
            next.state?.contractId !== session.contractId))
      ) {
        session = createSession(next, knownDay || "");
        lastObservation = null;
      }
      const s = session;
      if (
        next.state !== lastObservation &&
        knownDay &&
        next.state?.accountId === s.accountId &&
        knownDay === s.dayId
      ) {
        for (const r of next.state.receipts) acceptReceipt(s, r, !s.baseline);
        s.baseline = true;
        lastObservation = next.state;
      }
      flush();
      emit();
    },
    setEnabled(enabled: boolean) {
      if (disposed || !session) return;
      // A click is bound to the currently linked/enrolled account and known day.
      session.enabled = !!(
        enabled &&
        input?.playerId &&
        input.linked &&
        input.state?.enrolled &&
        input.state.accountId === session.accountId &&
        session.dayId
      );
      if (session.enabled) {
        session.blocked = null;
        session.failures = 0;
      }
      emit();
    },
    getView: view,
    async tick() {
      if (disposed) return;
      flush();
      if (gate()) {
        emit();
        return;
      }
      const i = input!,
        s = session!,
        coin = candidate();
      if (!coin) {
        emit();
        return;
      }
      const previous = s.entries.get(coin.index);
      if (!previous)
        s.entries.set(coin.index, {
          index: coin.index,
          id: null,
          confirmed: false,
          owned: true,
          notified: false,
        });
      if (!persist(s)) {
        if (!previous) s.entries.delete(coin.index);
        emit();
        return;
      }
      // Copy the evidence. A later input mutation can never alter this request.
      const request: NativeCoinSubmission = {
        accountId: s.accountId,
        dayId: s.dayId,
        kind: "coin",
        index: coin.index,
        mode: "gps",
        fix: { ...i.fix! },
      };
      flight = s;
      nextSubmission =
        clock() +
        Math.max(
          3000,
          Number.isFinite(i.state?.collection?.minimumIntervalMs)
            ? i.state!.collection.minimumIntervalMs
            : 3000,
        );
      emit();
      try {
        const receipt = await options.submit(request);
        if (!matchingReceipt(s, receipt) || receipt.index !== coin.index) {
          s.blocked = "review";
          return;
        }
        acceptReceipt(s, receipt);
        s.failures = 0;
      } catch (error) {
        const e = error as { status?: number; code?: string };
        const code = e?.code;
        // Known rejection cannot become a pending receipt. Uncertain network/5xx
        // responses retain the intent until a snapshot or idempotent retry resolves it.
        if (
          !previous &&
          ((e?.status && e.status >= 400 && e.status < 500) ||
            code === "NATIVE_PAUSED")
        )
          s.entries.delete(coin.index);
        if (code === "NATIVE_ALREADY_CLAIMED") {
          // A tombstone also prevents retrying this shared coin from a stale map.
          s.entries.set(coin.index, {
            index: coin.index,
            id: `claimed:${coin.index}`,
            confirmed: true,
            owned: false,
            notified: true,
          });
        } else if (code === "NATIVE_ACCOUNT_LIMIT") s.blocked = "account_limit";
        else if (code === "NATIVE_DAY_LIMIT") s.blocked = "day_limit";
        else if (code === "NATIVE_PAUSED") s.blocked = "paused";
        else if (
          [
            "GPS_ACCURACY",
            "GPS_STALE",
            "OUT_OF_RANGE",
            "NATIVE_LOCATION_SPEED",
          ].includes(code || "")
        ) {
          if (!previous) s.entries.delete(coin.index);
          s.blockedFix = request.fix.timestamp;
          s.retryAt = clock() + 5000;
        } else if (e?.status === 429) {
          if (!previous) s.entries.delete(coin.index);
          s.retryAt = clock() + (code === "NATIVE_PACING" ? 5000 : 60000);
        } else if (e?.status && e.status >= 400 && e.status < 500)
          s.blocked = "review";
        else {
          // An uncertain response may already have a durable receipt. Retry only
          // that same index, after a bounded delay and fresh authoritative reads.
          s.failures++;
          s.retryAt = clock() + Math.min(120000, 15000 * 2 ** (s.failures - 1));
          if (s.failures >= 3) s.blocked = "review";
        }
        persist(s);
      } finally {
        flight = null;
        // Account/day switches cannot refresh or announce the previous account.
        if (session === s && !disposed) {
          try {
            await options.refresh();
          } catch {
            /* The next snapshot will report availability. */
          }
          flush();
          emit();
        }
      }
    },
    dispose() {
      disposed = true;
      session = null;
      input = null;
    },
  };
}

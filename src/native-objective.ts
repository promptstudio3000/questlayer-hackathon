import type {
  NativeGameState,
  NativeQuest,
  NativeReceipt,
} from "./native-game-types";
import type { Point } from "./types";

export type NativeObjective = {
  version: 1;
  network: "testnet";
  playerId: string;
  accountId: string | null;
  contractId: string;
  dayId: string;
  manifestHash: string;
  kind: "quest" | "coin";
  index: number;
};
export type NativeObjectiveView = {
  status:
    | "empty"
    | "waiting"
    | "unavailable"
    | "expired"
    | "not-nearby"
    | "active"
    | "recorded"
    | "pending"
    | "confirmed";
  label: string;
  message: string;
  target: (Point & { label: string }) | null;
  quest: NativeQuest | null;
  receipt: NativeReceipt | null;
};
export const nativeObjectiveKey = (
  playerId: string,
  accountId: string | null,
) => `questlayer.native-objective.v1:${JSON.stringify([playerId, accountId])}`;
export const nativeAccountKey = (playerId: string) =>
  `questlayer.native-account.v1:${encodeURIComponent(playerId)}`;
export function restoreNativeAccount(raw: string | null, linked: string[]) {
  return raw && linked.includes(raw) ? raw : linked[0] || "";
}
const identifier = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 512;
const validIndex = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const validPoint = (v: Point) =>
  v &&
  Number.isFinite(v.lat) &&
  Math.abs(v.lat) <= 85 &&
  Number.isFinite(v.lng) &&
  Math.abs(v.lng) <= 180;
export function parseNativeObjective(
  raw: string | null,
  playerId: string,
  accountId: string | null,
): NativeObjective | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const v = JSON.parse(raw);
    if (
      !v ||
      v.version !== 1 ||
      v.network !== "testnet" ||
      v.playerId !== playerId ||
      v.accountId !== accountId ||
      !identifier(v.playerId) ||
      (v.accountId !== null && !identifier(v.accountId)) ||
      !identifier(v.contractId) ||
      !identifier(v.dayId) ||
      !identifier(v.manifestHash) ||
      !["quest", "coin"].includes(v.kind) ||
      !validIndex(v.index)
    )
      return null;
    return {
      version: 1,
      network: "testnet",
      playerId,
      accountId,
      contractId: v.contractId,
      dayId: v.dayId,
      manifestHash: v.manifestHash,
      kind: v.kind,
      index: v.index,
    };
  } catch {
    return null;
  }
}
// Match the existing foreground collection freshness bound. Stored navigation is
// never a location fix, checkpoint count, eligibility decision or reward receipt.
export function nativeSnapshotFresh(
  state: NativeGameState | null,
  now: number,
) {
  return (
    !!state &&
    Number.isFinite(state.generatedAt) &&
    state.generatedAt <= now + 2000 &&
    now - state.generatedAt <= 30000
  );
}
export function nativeVisitReadReason(
  state: NativeGameState | null,
  accountId: string,
  now: number,
): string {
  if (!nativeSnapshotFresh(state, now) || !state)
    return "Refresh the current testnet state before recording visits";
  if (state.network !== "testnet" || state.accountId !== accountId)
    return "Refresh the selected testnet account before recording visits";
  if (
    state.status !== "ready" ||
    !state.day ||
    !Number.isFinite(state.day.startsAt) ||
    !Number.isFinite(state.day.endsAt)
  )
    return "Waiting for the published testnet day";
  if (now < state.day.startsAt) return "The testnet day is not open yet";
  if (now >= state.day.endsAt) return "Today's native day has ended";
  if (!state.collection.available || state.collection.paused)
    return "Native visits are paused or not yet available";
  return "";
}
export function makeNativeObjective(
  playerId: string,
  accountId: string | null,
  state: NativeGameState | null,
  kind: "quest" | "coin",
  index: number,
  now: number,
): NativeObjective | null {
  if (
    !playerId ||
    !state ||
    state.network !== "testnet" ||
    state.accountId !== accountId ||
    !nativeSnapshotFresh(state, now) ||
    state.status !== "ready" ||
    !identifier(state.contractId) ||
    !identifier(state.day?.id) ||
    !identifier(state.day?.hash) ||
    !validIndex(index)
  )
    return null;
  if (
    kind === "quest"
      ? !state.day.quests.some((q) => q.index === index)
      : !state.day.coins.some((c) => c.index === index)
  )
    return null;
  return {
    version: 1,
    network: "testnet",
    playerId,
    accountId,
    contractId: state.contractId,
    dayId: state.day.id,
    manifestHash: state.day.hash,
    kind,
    index,
  };
}
export function resolveNativeObjective(
  reference: NativeObjective | null,
  playerId: string,
  accountId: string | null,
  state: NativeGameState | null,
  error: string,
  now: number,
): NativeObjectiveView {
  const empty = { target: null, quest: null, receipt: null };
  const label =
    reference?.kind === "coin" ? "Saved street coin" : "Saved testnet walk";
  const view = (
    status: NativeObjectiveView["status"],
    message: string,
  ): NativeObjectiveView => ({ status, label, message, ...empty });
  if (!reference) return view("empty", "");
  if (
    reference.playerId !== playerId ||
    reference.accountId !== accountId ||
    reference.network !== "testnet"
  )
    return view(
      "unavailable",
      "This selection belongs to another player or account. Choose a current adventure.",
    );
  if (error || !state)
    return view(
      "waiting",
      error
        ? "Could not refresh this adventure. Your selection is saved; refresh to retry."
        : "Loading the current testnet adventure…",
    );
  if (state.status === "not-configured")
    return view(
      "waiting",
      "Testnet adventures are not configured. Your selection is saved.",
    );
  if (
    state.network !== "testnet" ||
    state.accountId !== accountId ||
    state.contractId !== reference.contractId
  )
    return view(
      "unavailable",
      "The account or reward contract has changed. Choose a current adventure.",
    );
  if (!nativeSnapshotFresh(state, now))
    return view(
      "waiting",
      "The adventure data is out of date. Refresh before continuing.",
    );
  const day = state.day;
  if (day?.id === reference.dayId && day.hash !== reference.manifestHash)
    return view(
      "unavailable",
      "The published adventure no longer matches this selection. Refresh or choose another.",
    );
  const quest =
    day?.id === reference.dayId && reference.kind === "quest"
      ? day.quests.find((q) => q.index === reference.index) || null
      : null;
  const receipt =
    state.receipts.find(
      (r) =>
        r.dayId === reference.dayId &&
        r.accountId === accountId &&
        r.kind === reference.kind &&
        r.index === reference.index,
    ) || null;
  const currentLabel = quest?.title || label;
  if (receipt)
    return {
      ...view(
        receipt.state === "confirmed" ? "confirmed" : "pending",
        receipt.state === "confirmed"
          ? "Reward confirmed. View the durable receipt in Wallet."
          : receipt.state === "retrying"
            ? "Your visit is saved. Confirmation is retrying; check your receipt."
            : "Your visit is saved. Waiting for chain confirmation.",
      ),
      label: currentLabel,
      quest,
      receipt,
    };
  if (!day || state.status !== "ready")
    return view(
      "waiting",
      "Waiting for the published testnet day. Your selection is saved.",
    );
  if (day.id !== reference.dayId || day.endsAt <= now)
    return view(
      "expired",
      "This adventure's day has ended. Existing receipts remain in Wallet; choose another discovery.",
    );
  if (reference.kind === "coin") {
    const coin = day.coins.find((c) => c.index === reference.index);
    if (!coin)
      return view(
        "not-nearby",
        "This coin is absent from the current nearby view. It may be farther away or already collected.",
      );
    if (!validPoint(coin))
      return view(
        "unavailable",
        "This coin's current location is unavailable. Refresh to retry.",
      );
    return {
      ...view(
        "active",
        state.collection.paused || !state.collection.available
          ? "Native visits are paused · Open coin"
          : "NEAR testnet · Open coin",
      ),
      label: "Street coin",
      target: { lat: coin.lat, lng: coin.lng, label: "Street coin" },
    };
  }
  if (!quest || !quest.targets.length || !validIndex(quest.checkpoint))
    return view(
      "unavailable",
      "This walk is no longer in the published day. Choose another discovery.",
    );
  if (quest.checkpoint >= quest.targets.length)
    return {
      ...view(
        "recorded",
        "Walk recorded. Check Wallet for the reward's confirmation state.",
      ),
      label: quest.title,
      quest,
    };
  if (quest.closesAt <= now)
    return {
      ...view(
        "expired",
        "This walk is closed. Existing receipts remain in Wallet; choose another discovery.",
      ),
      label: quest.title,
      quest,
    };
  const target = quest.targets[quest.checkpoint];
  if (!validPoint(target))
    return view(
      "unavailable",
      "The current checkpoint location is unavailable. Refresh to retry.",
    );
  return {
    ...view(
      "active",
      `Stop ${quest.checkpoint + 1} of ${quest.targets.length} · ${quest.opensAt > now ? "Opens later" : quest.tier > state.access.tier ? `Requires Tier ${quest.tier}` : state.collection.paused || !state.collection.available ? "Native visits are paused" : "NEAR testnet"}`,
    ),
    label: quest.title,
    quest,
    target: {
      ...target,
      label: `${quest.title} · stop ${quest.checkpoint + 1}`,
    },
  };
}

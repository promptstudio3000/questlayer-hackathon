export type PickupConfirmation = {
  coinId: string;
  value: number;
  xp: number;
  alreadyClaimed?: boolean;
};
export type PickupTotals = {
  count: number;
  amount: number;
  xp: number;
  capped: boolean;
};
export const emptyPickupTotals = (): PickupTotals => ({
  count: 0,
  amount: 0,
  xp: 0,
  capped: false,
});

export function demoPickupScope(
  playerId?: string,
  worldId?: string,
  arena = true,
) {
  return playerId && worldId ? JSON.stringify([playerId, worldId, arena]) : "";
}

/** Presentation only: confirmed replies enter here; no request or balance mutation. */
export function createPickupFeedback(
  scope: string,
  { delay = 5000, capacity = 2048 } = {},
) {
  const seen = new Set<string>();
  let totals = emptyPickupTotals();
  let pending = emptyPickupTotals();
  let due: number | null = null;
  return {
    scope,
    snapshot: () => ({ ...totals }),
    confirm(expectedScope: string, reply: PickupConfirmation, now: number) {
      if (
        !scope ||
        expectedScope !== scope ||
        totals.capped ||
        !reply ||
        (reply.alreadyClaimed !== undefined &&
          reply.alreadyClaimed !== false) ||
        typeof reply.coinId !== "string" ||
        !reply.coinId ||
        reply.coinId.length > 256 ||
        !Number.isSafeInteger(reply.value) ||
        reply.value < 0 ||
        !Number.isSafeInteger(reply.xp) ||
        reply.xp < 0 ||
        !Number.isFinite(now) ||
        seen.has(reply.coinId)
      )
        return false;
      if (
        seen.size >= capacity ||
        !Number.isSafeInteger(totals.amount + reply.value) ||
        !Number.isSafeInteger(totals.xp + reply.xp)
      ) {
        totals = { ...totals, capped: true };
        return false;
      }
      seen.add(reply.coinId);
      totals = {
        count: totals.count + 1,
        amount: totals.amount + reply.value,
        xp: totals.xp + reply.xp,
        capped: false,
      };
      pending = {
        count: pending.count + 1,
        amount: pending.amount + reply.value,
        xp: pending.xp + reply.xp,
        capped: false,
      };
      due ??= now + delay;
      return true;
    },
    flush(now: number, allowed: boolean) {
      if (due === null || !Number.isFinite(now) || now < due) return null;
      const batch = pending;
      pending = emptyPickupTotals();
      due = null;
      // Suppressed bursts never become a delayed celebration after reconnect.
      return allowed ? batch : null;
    },
    quiet() {
      pending = emptyPickupTotals();
      due = null;
    },
  };
}

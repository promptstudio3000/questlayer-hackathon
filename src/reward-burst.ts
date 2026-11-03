// Floating reward feedback over the map (coins, street finds, quests, level
// ups). Presentation only: callers pass amounts the server already confirmed.
export type RewardBurstTone = "coin" | "find" | "quest" | "level";
export type RewardBurst = {
  id: number;
  tone: RewardBurstTone;
  title: string;
  detail?: string;
  /** Timestamp after which the burst is removed. */
  until: number;
};
const LIFETIME: Record<RewardBurstTone, number> = {
  coin: 1400,
  find: 2400,
  quest: 3200,
  level: 3600,
};
/** At most this many bursts float at once; the oldest coin chips go first. */
export const MAX_BURSTS = 4;

let next = 1;
export function pushBurst(
  list: readonly RewardBurst[],
  burst: Omit<RewardBurst, "id" | "until">,
  now: number,
): RewardBurst[] {
  const live = list.filter((b) => b.until > now);
  // Coins in a burst merge into one chip instead of stacking.
  if (burst.tone === "coin") {
    const last = live.at(-1);
    if (last?.tone === "coin")
      return [
        ...live.slice(0, -1),
        { ...last, ...burst, id: next++, until: now + LIFETIME.coin },
      ];
  }
  const out = [...live, { ...burst, id: next++, until: now + LIFETIME[burst.tone] }];
  while (out.length > MAX_BURSTS) {
    const i = out.findIndex((b) => b.tone === "coin");
    out.splice(i >= 0 ? i : 0, 1);
  }
  return out;
}
export const burstLifetime = (tone: RewardBurstTone) => LIFETIME[tone];

// Floating reward feedback over the map (coins, street finds, quests, level
// ups). Presentation only: callers pass amounts the server already confirmed.
export type RewardBurstTone = "coin" | "xp" | "find" | "quest" | "level";
import type { ChainRef } from "./chain-proof";
export type RewardBurst = {
  id: number;
  /** On-chain proof of this reward (the icon shows its stage). */
  chain?: ChainRef | null;
  tone: RewardBurstTone;
  /** XP chips: the gained amount; chips close together merge and add up. */
  amount?: number;
  title: string;
  detail?: string;
  /** Timestamp after which the burst is removed. */
  until: number;
};
const LIFETIME: Record<RewardBurstTone, number> = {
  coin: 1400,
  xp: 1400,
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
  // Coins in a burst merge into one chip instead of stacking; XP chips add up.
  if (burst.tone === "coin" || burst.tone === "xp") {
    let i = live.length - 1;
    while (i >= 0 && live[i].tone !== burst.tone) i--;
    if (i >= 0) {
      const merged = { ...live[i], ...burst, id: next++, until: now + LIFETIME[burst.tone] };
      if (burst.tone === "xp") {
        merged.amount = (live[i].amount ?? 0) + (burst.amount ?? 0);
        merged.title = `+${merged.amount.toLocaleString("en-US")} XP`;
      }
      return [...live.slice(0, i), ...live.slice(i + 1), merged];
    }
  }
  const out = [...live, { ...burst, id: next++, until: now + LIFETIME[burst.tone] }];
  while (out.length > MAX_BURSTS) {
    const i = out.findIndex((b) => b.tone === "coin" || b.tone === "xp");
    out.splice(i >= 0 ? i : 0, 1);
  }
  return out;
}
export const burstLifetime = (tone: RewardBurstTone) => LIFETIME[tone];

/** Short XP readout for the HUD bubble: 980, 1.2k, 12k, 1.2M (never wraps on a 360 px phone). */
export function compactXp(value: number) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (n < 1000) return String(n);
  const [div, unit] = n < 1e6 ? [1e3, "k"] : [1e6, "M"];
  const v = n / div;
  const text = v < 10 ? (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, "") : String(Math.floor(v));
  return text + unit;
}

// In-game GOLD is the smallest QGOLD unit (owner, 11 Nov 2026): QGOLD has 6
// decimals on chain, so 1 QGOLD = 1,000,000 GOLD and every in-game amount is a
// whole number. Amounts that the server keeps in yoctoNEAR are shown in the
// same GOLD at the vault's starting rate (0.001 NEAR per QGOLD), so
// 1 GOLD ≈ 1 nanoNEAR and 1 NEAR = 1,000,000,000 GOLD.
export const QGOLD_UNITS = 1_000_000;
export const YOCTO_PER_GOLD = 10n ** 15n;
const grouping = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Whole GOLD for an amount in GOLD units (micro-QGOLD). */
export function formatGold(units: number): string {
  return grouping.format(Number.isFinite(units) ? Math.round(units) : 0);
}

/** Whole GOLD for a yoctoNEAR amount (rounded down, so nothing is overstated). */
export function goldFromYocto(yocto: string | bigint): string {
  let v: bigint;
  try {
    v = BigInt(yocto || 0);
  } catch {
    return "–";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  return `${neg ? "−" : ""}${grouping.format(v / YOCTO_PER_GOLD)}`;
}

/** Exact GOLD for a yoctoNEAR amount: whole GOLD plus any remainder, trimmed. */
export function goldExactFromYocto(yocto: string | bigint): string {
  const v = BigInt(yocto),
    fraction = (v % YOCTO_PER_GOLD).toString().padStart(15, "0").replace(/0+$/, "");
  return grouping.format(v / YOCTO_PER_GOLD) + (fraction ? "." + fraction : "");
}

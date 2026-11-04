// Pure QGOLD vault quotes for /economy (mirrors server/qgold/market-math.mjs).
export const QGOLD_ONE = 10n ** 6n;
const BPS = 10000n;

export type ExitPath = "near_instant" | "near_queue" | "lst";

/** QGOLD received for `near` yocto at R + feeBps (the vault rounds the same way). */
export function buyQuote(near: bigint, rate: bigint, feeBps = 100): bigint {
  if (near <= 0n || rate <= 0n) return 0n;
  return (near * QGOLD_ONE) / ((rate * (BPS + BigInt(feeBps))) / BPS);
}

/** NEAR yocto received for `qgold` units at R − feeBps. */
export function sellQuote(qgold: bigint, rate: bigint, feeBps = 100): bigint {
  const gross = (qgold * rate) / QGOLD_ONE;
  return gross - (gross * BigInt(feeBps) + BPS - 1n) / BPS;
}

/** Parses "1.5" into base units with `decimals` places. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!new RegExp(`^\\d{1,9}(\\.\\d{1,${decimals}})?$`).test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0"));
}


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

/** QGOLD typed in the game's unit ("967500000", "967.5M", "1.2B") as token base units. */
export function parseQgoldUnits(text: string): bigint | null {
  const m = /^(\d{1,15}(?:\.\d{1,9})?)([kmb]?)$/i.exec(text.replace(/[\s,_\u00a0]/g, ""));
  if (!m) return null;
  const [w, f = ""] = m[1].split(".");
  const zeros = { "": 0, k: 3, m: 6, b: 9 }[m[2].toLowerCase() as "" | "k" | "m" | "b"];
  if (f.length > zeros) return null;
  return BigInt(w + f.padEnd(zeros, "0"));
}

/** Parses "1.5" into base units with `decimals` places. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!new RegExp(`^\\d{1,9}(\\.\\d{1,${decimals}})?$`).test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0"));
}


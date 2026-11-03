// Exact yoctoNEAR formatting for the /economy page. Amounts stay strings and
// BigInt end to end: no float ever touches a ledger value.
const YOCTO_DIGITS = 24;

/** Exact decimal NEAR string for a yoctoNEAR integer string, trailing zeros trimmed. */
export function exactNear(yocto: string | null | undefined): string {
  if (!yocto || !/^\d+$/.test(yocto)) return "—";
  const padded = yocto.replace(/^0+(?=\d)/, "").padStart(YOCTO_DIGITS + 1, "0");
  const whole = padded.slice(0, -YOCTO_DIGITS);
  const frac = padded.slice(-YOCTO_DIGITS).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Short, honest NEAR label: up to `digits` decimals, but tiny amounts keep
 * their first significant digits instead of rounding to 0.
 */
export function shortNear(yocto: string | null | undefined, digits = 4): string {
  const exact = exactNear(yocto);
  if (exact === "—") return exact;
  const [whole, frac = ""] = exact.split(".");
  if (!frac) return whole;
  if (whole !== "0") return trim(`${whole}.${frac.slice(0, digits)}`);
  const lead = frac.match(/^0*/)![0].length;
  if (lead < digits) return trim(`0.${frac.slice(0, digits)}`);
  return trim(`0.${frac.slice(0, lead + 3)}`);
}

const trim = (s: string) => s.replace(/\.?0+$/, "") || "0";

/** Price of one stNEAR in NEAR from a 24-decimal fixed-point price. */
export function priceLabel(price: string | null | undefined): string {
  return shortNear(price, 6);
}

export function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : "—";
}

export function shortAccount(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 28 ? `${id.slice(0, 12)}…${id.slice(-12)}` : id;
}

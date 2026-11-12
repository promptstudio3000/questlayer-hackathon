// One currency on screen (owner, 12 Nov 2026): amounts the player stakes or
// pays are shown in the same QGOLD as rewards and prices: the game counts the
// smallest QGOLD unit, 1 NEAR = 1,000,000,000 (src/gold-units.ts). Display only:
// the payment itself still leaves in NEAR and the signing window shows that.
const QGOLD_PER_NEAR = 1_000_000_000;

/** "2B", "250M", "1.5K" for a NEAR amount. */
export function qgoldOfNear(near: number | string): string {
  const q = Number(near) * QGOLD_PER_NEAR;
  if (!Number.isFinite(q)) return "–";
  const cut = (v: number) => String(Math.round(v * 100) / 100);
  if (Math.abs(q) >= 1e9) return `${cut(q / 1e9)}B`;
  if (Math.abs(q) >= 1e6) return `${cut(q / 1e6)}M`;
  if (Math.abs(q) >= 1e3) return `${cut(q / 1e3)}K`;
  return cut(q);
}

/** Server lines such as "Stake 2 NEAR (~5 €)" read in QGOLD. */
export function nearTextInQgold(text: string): string {
  return text.replace(/(\d+(?:[.,]\d+)?) NEAR\b/g, (_, n: string) => `${qgoldOfNear(n.replace(",", "."))} QGOLD`);
}

/** A price typed in QGOLD ("50000000", "50 000K", "50M", "1.5B") as NEAR yocto. 1M to 1,000B QGOLD. */
export function parseQgoldPrice(input: string): string {
  const m = /^(\d+(?:[.,]\d+)?)([kmb]?)$/i.exec(input.replace(/[\s\u00a0_]/g, ""));
  if (!m) throw Error("Enter a QGOLD amount.");
  const unit = { "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] ?? 1;
  const q = Math.round(Number(m[1].replace(",", ".")) * unit);
  if (!Number.isSafeInteger(q) || q < 1_000_000 || q > 1_000_000_000_000) throw Error("Choose a price between 1M and 1,000B QGOLD.");
  return (BigInt(q) * 10n ** 15n).toString();
}

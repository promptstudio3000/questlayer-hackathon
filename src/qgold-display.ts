// One currency on screen (owner, 12 Nov 2026): amounts the player stakes or
// pays are shown in QGOLD at 1 QGOLD = 1 microNEAR. This is display only:
// the payment itself still leaves in NEAR and the signing window shows that.
const QGOLD_PER_NEAR = 1_000_000;

/** "2M", "250K", "1.5M" for a NEAR amount. */
export function qgoldOfNear(near: number | string): string {
  const q = Number(near) * QGOLD_PER_NEAR;
  if (!Number.isFinite(q)) return "–";
  const cut = (v: number) => String(Math.round(v * 100) / 100);
  if (Math.abs(q) >= 1e6) return `${cut(q / 1e6)}M`;
  if (Math.abs(q) >= 1e3) return `${cut(q / 1e3)}K`;
  return cut(q);
}

/** Server lines such as "Stake 2 NEAR (~5 €)" read in QGOLD. */
export function nearTextInQgold(text: string): string {
  return text.replace(/(\d+(?:[.,]\d+)?) NEAR\b/g, (_, n: string) => `${qgoldOfNear(n.replace(",", "."))} QGOLD`);
}

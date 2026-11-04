// Small helpers shared by App.tsx and the lazily loaded wallet screens.
import type { ReactNode } from "react";
import { GOLD } from "./api";
import { tr } from "./i18n";
import { GameObjectArt } from "./game-object-art";
export function distanceLabel(m: number) {
  if (!Number.isFinite(m)) return "";
  if (m < 1000) return tr("{0} m away", { 0: Math.round(m / 10) * 10 });
  return tr("{0} km away", { 0: (m / 1000).toFixed(m < 10000 ? 1 : 0) });
}
export function units(v: string) {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * GOLD) : 0;
}
export function CoinIcon() {
  return (
    <span className="gold-icon" aria-hidden="true">
      <GameObjectArt kind="coin" size={20} />
    </span>
  );
}
export function Badge({
  children,
  tone = "purple",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}


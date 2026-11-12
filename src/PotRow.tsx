import { useEffect, useState } from "react";
import { ArrowsLeftRight, CaretDown } from "@phosphor-icons/react";
import { api } from "./api";
import { GameObjectArt } from "./game-object-art";
import { InfoTip } from "./InfoTip";
import { TodaysPot } from "./RewardFunding";
import { goldCompact, isAmount, potView, useRewardFunding } from "./reward-funding";
import { tr } from "./i18n";
import type { Point } from "./types";

type CoinCounts = { radiusM: number; near: number | null; global: number };
const SCOPE_KEY = "questlayer.coinScope";

/**
 * One compact line above "Places today" (Lubos, 10 Nov 2026): coins still on
 * the map within 10 km (or everywhere) and what is left in today's pot. The
 * full pot card with its books check opens under the chevron.
 */
export function PotRow({ worldId, position, onOpen }: { worldId: string | null; position: Point; onOpen: () => void }) {
  const [counts, setCounts] = useState<CoinCounts | null>(null);
  const [scope, setScope] = useState<"near" | "global">(() => {
    try {
      return localStorage.getItem(SCOPE_KEY) === "global" ? "global" : "near";
    } catch {
      return "near";
    }
  });
  const [open, setOpen] = useState(false);
  const pot = potView(useRewardFunding());
  // About 500 m of movement before the count is read again.
  const lat = Math.round(position.lat * 200) / 200,
    lng = Math.round(position.lng * 200) / 200;
  useEffect(() => {
    let live = true;
    const read = () =>
      api<CoinCounts>(`/world/coin-counts?${new URLSearchParams({ ...(worldId ? { id: worldId } : {}), lat: String(lat), lng: String(lng) })}`)
        .then((c) => { if (live) setCounts(c); })
        .catch(() => { /* the row keeps the last count */ });
    void read();
    const timer = setInterval(read, 60_000);
    return () => { live = false; clearInterval(timer); };
  }, [worldId, lat, lng]);
  const chooseScope = (next: "near" | "global") => {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  };
  const coins = counts ? (scope === "near" ? counts.near : counts.global) : null;
  const left =
    pot.kind === "ready" && pot.today && isAmount(pot.today.coinsLeft) && isAmount(pot.today.prizesLeft)
      ? goldCompact(String(BigInt(pot.today.coinsLeft) + BigInt(pot.today.prizesLeft)))
      : null;
  return (
    <div className="pot-row">
      <div className="pot-row-main">
        <GameObjectArt kind="coin" size={28} />
        <span className="pot-row-stat">
          <b>{tr("{0} coins", { 0: coins == null ? "…" : coins.toLocaleString("en-US") })}</b>
          <button
            type="button"
            className="pot-row-scope"
            aria-label={scope === "near" ? tr("Show coins everywhere") : tr("Show coins within 10 km")}
            onClick={() => chooseScope(scope === "near" ? "global" : "near")}
          >
            {scope === "near" ? tr("within 10 km") : tr("everywhere")}
            <ArrowsLeftRight size={12} weight="bold" aria-hidden="true" />
          </button>
        </span>
        <span className="pot-row-sep" aria-hidden="true" />
        <span className="pot-row-stat">
          <b>{left == null ? "— QGOLD" : `${left} QGOLD`}</b>
          <small>{tr("Today's pot")}</small>
        </span>
        <span className="pot-row-spacer" />
        <InfoTip label={tr("Today's pot")}>
          {tr("Every coin and prize on the map is backed by today's funded pot: realized staking yield and sponsors, checked against the books.")}
        </InfoTip>
        <button
          type="button"
          className="pot-row-more"
          aria-expanded={open}
          aria-label={open ? tr("Hide pot details") : tr("Show pot details")}
          onClick={() => setOpen((v) => !v)}
        >
          <CaretDown size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="pot-row-detail">
          <TodaysPot practice onOpen={onOpen} />
        </div>
      )}
    </div>
  );
}

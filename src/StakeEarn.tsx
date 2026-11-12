// Profile → Stake (owner request, 10–12 Nov 2026): one screen. The small
// wallet line on top, the tier ladder, the stake form (src/FuelTheCity.tsx)
// and the idea as a small animated picture.
import { useEffect, useState, type ReactNode } from "react";
import { Flame, MapTrifold, Vault } from "@phosphor-icons/react";
import { api, gold as fmtGold } from "./api";
import { CoinIcon } from "./app-bits";
import { GameObjectArt } from "./game-object-art";
import { Ghost } from "./Ghost";
import { prefersReducedMotion } from "./feedback";
import { tr } from "./i18n";
import type { StakeCard } from "./StakeToday";
import { goldCompact, potView, refreshRewardFunding, useRewardFunding } from "./reward-funding";
import "./profile-journey.css";

/** Moving dots along one path; nothing moves when motion is reduced. */
function Flow({ path, color, delays, still }: { path: string; color: string; delays: number[]; still: boolean }) {
  return (
    <>
      <path d={path} fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" />
      {delays.map((d) =>
        still ? null : (
          <circle key={d} r="4.5" fill={color} opacity="0">
            <animateMotion dur="2.4s" begin={`${d}s`} repeatCount="indefinite" path={path} />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="2.4s" begin={`${d}s`} repeatCount="indefinite" />
          </circle>
        ),
      )}
    </>
  );
}

/**
 * The idea in one picture: your NEAR goes into the vault and stays yours;
 * validators pay yield; part comes back to you, part fuels the prize pool
 * that becomes coins on the map for everyone.
 */
export function StakeStory({ sharePct }: { sharePct: number }) {
  const still = prefersReducedMotion();
  return (
    <section className="stake-story" aria-labelledby="stake-story-title">
      <h2 id="stake-story-title">{tr("Your NEAR works while you explore")}</h2>
      <div className="stake-story-art" style={{ position: "relative" }}>
        <svg viewBox="0 0 320 120" role="img" aria-label={tr("Your stake goes into the vault, its yield goes back to you and into the prize pool")}>
          <Flow path="M66 44 L134 44" color="#b892ff" delays={[0, 0.8, 1.6]} still={still} />
          <Flow path="M184 36 Q222 0 256 36" color="#ffd76a" delays={[0.4, 1.6]} still={still} />
          <Flow path="M134 58 Q100 112 66 58" color="#7ef0b5" delays={[1, 2.2]} still={still} />
          <circle cx="160" cy="44" r="28" fill="#ffd76a" className="stake-vault-glow" opacity="0.4" />
          <text x="252" y="12" textAnchor="middle" fill="#ffd76a" fontSize="11" fontWeight="700">{sharePct} %</text>
          <text x="100" y="98" textAnchor="middle" fill="#7ef0b5" fontSize="11" fontWeight="700">{100 - sharePct} %</text>
        </svg>
        <span className="stake-story-node" style={{ left: "12.5%" }}>
          <Ghost color="#ffffff" />
          <small>{tr("You")}</small>
        </span>
        <span className="stake-story-node" style={{ left: "50%" }}>
          <Vault size={40} weight="duotone" aria-hidden="true" />
          <small>{tr("Vault")}</small>
        </span>
        <span className="stake-story-node" style={{ left: "87.5%" }}>
          <GameObjectArt kind="chest" size={40} />
          <small>{tr("Prize pool")}</small>
        </span>
      </div>
      <ol>
        <li>
          <b>{tr("Stake")}</b>
          {tr("Your NEAR stays yours")}
        </li>
        <li>
          <b>{tr("Earn")}</b>
          {tr("Validators pay yield")}
        </li>
        <li>
          <b>{tr("Share")}</b>
          {tr("Part becomes map coins and opens Tier places")}
        </li>
      </ol>
    </section>
  );
}

const STEPS = ["none", "staker", "tier2", "tier3"] as const;
export type StakerStep = (typeof STEPS)[number];

/** Free → Staker → Tier 2 → Tier 3 on one bar, with where you are and what's next. */
export function TierLadder({
  step,
  progress,
  next,
  numbers,
  loading,
  children,
}: {
  step: StakerStep;
  /** Values still loading: the card keeps its shape and shows placeholders. */
  loading?: boolean;
  /** Extra rows inside the card, e.g. the prize pool share of the yield. */
  children?: ReactNode;
  /** 0..1 toward the next step. */
  progress: number;
  next: string;
  numbers: [string, ReactNode][];
}) {
  const here = STEPS.indexOf(step);
  const names = [tr("Free"), tr("Staker"), tr("Tier {0}", { 0: 2 }), tr("Tier {0}", { 0: 3 })];
  const fill = here >= 3 ? 100 : ((here + Math.max(0, Math.min(1, progress))) / 3) * 100;
  return (
    <section className="tier-card" aria-labelledby="tier-card-title" aria-busy={loading || undefined}>
      <div className="tier-card-head">
        <span id="tier-card-title">{tr("Your tier")}</span>
        {loading ? <b className="skeleton-text" aria-hidden="true">{names[1]}</b> : <b>{names[here]}</b>}
      </div>
      <div
        className="tier-ladder"
        role="progressbar"
        aria-label={tr("Your tier")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={loading ? 0 : Math.round(fill)}
        aria-valuetext={names[here]}
      >
        <span className="tier-ladder-track" />
        <span className="tier-ladder-fill" style={{ width: `${loading ? 0 : fill}%` }} />
        <ol aria-hidden="true">
          {names.map((n, i) => (
            <li key={n} className={i < here ? "on" : i === here ? "here" : ""} style={{ left: `${(i / 3) * 100}%` }}>
              <i>{i >= 2 ? i : ""}</i>
              {n}
            </li>
          ))}
        </ol>
      </div>
      <p className="tier-card-next">{loading ? <span className="skeleton-text">{next}</span> : next}</p>
      <dl className="tier-card-numbers">
        {numbers.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{loading ? <span className="skeleton-text" aria-label={tr("Loading…")}>0.000</span> : v}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}

type PendingQgold = { accountId: string | null; units: number; awaitingAccount?: boolean };
const nearOf = (yocto: bigint) => Number(yocto / 10n ** 21n) / 1000;

/**
 * The top of Profile → Stake (owner request, 12 Nov 2026: Earnings merged in,
 * kept minimal): my QGOLD, the GOLD that went onto the map today and, once
 * there is a stake, the yield it kept for me. Nothing technical here.
 */
export function StakeWallet({ refreshKey, staked }: { refreshKey: string; staked: boolean }) {
  const [pending, setPending] = useState<PendingQgold | null>(null),
    [balance, setBalance] = useState<number | null>(null),
    [kept, setKept] = useState<number | null>(null);
  const pot = potView(useRewardFunding());
  useEffect(() => {
    void refreshRewardFunding();
  }, []);
  useEffect(() => {
    let live = true;
    void api<PendingQgold>("/qgold/pending")
      .then(async (p) => {
        if (!live) return;
        setPending(p);
        if (!p.accountId) return setBalance(0);
        const a = await api<{ balance: string | null }>(`/qgold/account?account=${encodeURIComponent(p.accountId)}`);
        if (live) setBalance(Number(a.balance || 0));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [refreshKey]);
  useEffect(() => {
    if (!staked) return;
    let live = true;
    void api<StakeCard>("/keeper/stake").then(
      (card) => {
        if (!live) return;
        let total = 0n;
        for (const v of card.accounts.flatMap((a) => a.vaults))
          try {
            total += BigInt(v.totals?.retained || "0");
          } catch {}
        setKept(nearOf(total));
      },
      () => live && setKept(null),
    );
    return () => {
      live = false;
    };
  }, [refreshKey, staked]);
  const today = pot.kind === "ready" ? pot.today : null;
  const onMap = today?.coinsFunded ?? today?.coinsLeft ?? null;
  return (
    <dl className="stake-wallet">
      <div>
        <dt>{tr("Your QGOLD")}</dt>
        <dd>
          <CoinIcon /> {balance === null ? "…" : fmtGold(balance, 6)}
          {!!pending?.units && !pending.awaitingAccount && (
            <small>{tr("+{0} with the next payout", { 0: fmtGold(pending.units, 6) })}</small>
          )}
        </dd>
      </div>
      <div>
        <dt>
          <MapTrifold size={14} weight="duotone" aria-hidden="true" /> {tr("On the map today")}
        </dt>
        <dd>{onMap === null ? "–" : `${goldCompact(onMap)} GOLD`}</dd>
      </div>
      {staked && (
        <div>
          <dt>
            <Flame size={14} weight="duotone" aria-hidden="true" /> {tr("From your stake")}
          </dt>
          <dd>{kept === null ? "–" : `${kept.toLocaleString("en-US", { maximumFractionDigits: 3 })} NEAR`}</dd>
        </div>
      )}
    </dl>
  );
}

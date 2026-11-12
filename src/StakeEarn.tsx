// Profile → Stake (owner request, 10–12 Nov 2026): one screen. The small
// wallet line on top, the tier ladder, the stake form (src/FuelTheCity.tsx)
// and the loop as one numbered, animated picture.
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
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
import "./stake-story.css";

const QGOLD = "QGOLD";
const VB_W = 340;
const VB_H = 290;
const YOU = { x: 60, y: 70 };
const VAULT = { x: 280, y: 70 };
const POOL = { x: 280, y: 222 };
const MAP = { x: 60, y: 222 };
const C = { stake: "#c4a3ff", pool: "#ffd76a", mine: "#7ef0b5", coin: "#ffb347", back: "#b9c4ff" };

type FlowProps = {
  step: number;
  path: string;
  color: string;
  delays: number[];
  still: boolean;
  marker: string;
  badge?: [number, number];
};

/** One arrowed lane with dots moving along it; nothing moves when motion is reduced. */
function Flow({ step, path, color, delays, still, marker, badge }: FlowProps) {
  return (
    <g className="ss-flow" style={{ "--i": step - 1 } as CSSProperties}>
      <path className="ss-lane" d={path} fill="none" stroke={color} strokeWidth="3" strokeDasharray="1 7" strokeLinecap="round" markerEnd={`url(#${marker})`} />
      {still
        ? null
        : delays.map((d) => (
            <circle key={d} r="4.5" fill={color} opacity="0">
              <animateMotion dur="2.4s" begin={`${d}s`} repeatCount="indefinite" path={path} />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.8;1" dur="2.4s" begin={`${d}s`} repeatCount="indefinite" />
            </circle>
          ))}
      {badge && (
        <g className="ss-badge">
          <circle cx={badge[0]} cy={badge[1]} r="9.5" fill="#2a0f5c" stroke={color} strokeWidth="2" />
          <text x={badge[0]} y={badge[1] + 3.8} textAnchor="middle" fill={color} fontSize="11" fontWeight="800">{step}</text>
        </g>
      )}
    </g>
  );
}

const at = (p: { x: number; y: number }) => ({ left: `${(p.x / VB_W) * 100}%`, top: `${(p.y / VB_H) * 100}%` });

/**
 * The whole loop in one picture (owner request, 12 Nov 2026):
 * 1 you stake into your vault and the stake stays yours; 2 validators pay
 * yield, the chosen part fills the prize pool and the rest is yours; 3 the
 * pool becomes coins and prizes on the map; 4 explorers collect them on the
 * map (never from the vault); 5 what nobody collects returns to the pool.
 * The picture and the list share numbers, and a slow spotlight walks 1 → 5.
 */
export function StakeStory({ sharePct }: { sharePct: number }) {
  const still = prefersReducedMotion();
  const id = useId().replace(/:/g, "");
  const rest = Math.max(0, 100 - sharePct);
  const heads: [string, string][] = Object.entries(C);
  const steps: [string, string, string][] = [
    [C.stake, tr("Stake"), tr("Your stake sits in your vault and stays yours.")],
    [
      C.pool,
      tr("Yield"),
      rest > 0
        ? tr("Validators pay yield: {0} % fills the prize pool, {1} % is yours.", { 0: sharePct, 1: rest })
        : tr("Validators pay yield. All of it fills the prize pool."),
    ],
    [C.pool, tr("Rewards"), tr("Every day the pool becomes coins and prizes on the map.")],
    [C.coin, tr("Collect"), tr("You collect QGOLD on the map, not from the vault.")],
    [C.back, tr("Left over"), tr("What nobody collects returns to the pool.")],
  ];
  return (
    <section className={`stake-story${still ? " is-still" : ""}`} aria-labelledby="stake-story-title">
      <h2 id="stake-story-title">{tr("Your stake works while you explore")}</h2>
      <div className="stake-story-body">
        <div className="stake-story-art">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            role="img"
            aria-label={tr("You stake into your vault. Its yield fills the prize pool. The pool puts rewards on the map. You collect them there. Uncollected rewards return to the pool.")}
          >
            <defs>
              {heads.map(([k, color]) => (
                <marker key={k} id={`${id}-${k}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.6" markerHeight="3.6" orient="auto-start-reverse">
                  <path d="M1 1 L9 5 L1 9 Z" fill={color} />
                </marker>
              ))}
            </defs>

            <circle cx={VAULT.x} cy={VAULT.y} r="34" fill={C.pool} className="stake-vault-glow" opacity="0.35" />
            {[YOU, VAULT, POOL, MAP].map((n, i) => (
              <circle key={i} cx={n.x} cy={n.y} r="30" className="ss-disc" />
            ))}
            {still
              ? null
              : [0, 1, 2].map((i) => (
                  <text key={i} x={VAULT.x + 22 + i * 8} y={VAULT.y - 22} fill={C.mine} fontSize="13" fontWeight="800" opacity="0">
                    +
                    <animate attributeName="opacity" values="0;1;0" dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
                    <animate attributeName="y" values={`${VAULT.y - 16};${VAULT.y - 36}`} dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
                  </text>
                ))}

            <Flow step={1} path="M95 60 L242 60" color={C.stake} delays={[0, 0.8, 1.6]} still={still} marker={`${id}-stake`} badge={[170, 60]} />
            {rest > 0 && <Flow step={2} path="M248 86 Q170 124 96 88" color={C.mine} delays={[0.6, 1.8]} still={still} marker={`${id}-mine`} />}
            <Flow step={2} path="M280 105 L280 184" color={C.pool} delays={[0.3, 1.5]} still={still} marker={`${id}-pool`} badge={[280, 146]} />
            <Flow step={3} path="M245 212 L98 212" color={C.pool} delays={[0, 0.8, 1.6]} still={still} marker={`${id}-pool`} badge={[170, 212]} />
            <Flow step={4} path="M60 187 L60 108" color={C.coin} delays={[0.3, 1.5]} still={still} marker={`${id}-coin`} badge={[60, 146]} />
            <Flow step={5} path="M92 238 Q170 276 244 240" color={C.back} delays={[0.6, 1.8]} still={still} marker={`${id}-back`} badge={[170, 257]} />

            <g className="ss-words" fontSize="11.5" fontWeight="700">
              <text x={YOU.x} y="30" textAnchor="middle" className="ss-name">{tr("You")}</text>
              <text x={VAULT.x} y="30" textAnchor="middle" className="ss-name">{tr("Vault")}</text>
              <text x={MAP.x} y="268" textAnchor="middle" className="ss-name">{tr("Map")}</text>
              <text x={POOL.x} y="268" textAnchor="middle" className="ss-name">{tr("Prize pool")}</text>
              <text x="170" y="45" textAnchor="middle" fill={C.stake}>{tr("Stake")}</text>
              {rest > 0 && (
                <text x="170" y="122" textAnchor="middle" fill={C.mine}>{tr("{0} % yours", { 0: rest })}</text>
              )}
              <text x="264" y="143" textAnchor="end" fill={C.pool}>{tr("Yield")}</text>
              <text x="264" y="158" textAnchor="end" fill={C.pool} fontSize="13" fontWeight="800">{sharePct} %</text>
              <text x="170" y="197" textAnchor="middle" fill={C.pool}>{tr("Rewards")}</text>
              <text x="76" y="143" fill={C.coin}>{tr("Collect")}</text>
              <text x="76" y="158" fill={C.coin} fontSize="13" fontWeight="800">{QGOLD}</text>
              <text x="170" y="281" textAnchor="middle" fill={C.back}>{tr("Left over")}</text>
            </g>
          </svg>
          <span className="stake-story-node" style={at(YOU)}>
            <Ghost color="#ffffff" />
          </span>
          <span className="stake-story-node" style={at(VAULT)}>
            <Vault size={38} weight="duotone" aria-hidden="true" />
          </span>
          <span className="stake-story-node" style={at(POOL)}>
            <GameObjectArt kind="chest" size={38} />
          </span>
          <span className="stake-story-node" style={at(MAP)}>
            <MapTrifold size={38} weight="duotone" aria-hidden="true" />
          </span>
        </div>
        <ol>
          {steps.map(([color, title, text], i) => (
            <li key={i} style={{ "--i": i, "--c": color } as CSSProperties}>
              <i aria-hidden="true">{i + 1}</i>
              <span>
                <b>{title}</b>
                {text}
              </span>
            </li>
          ))}
        </ol>
      </div>
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
        <dd>{onMap === null ? "–" : `${goldCompact(onMap)} QGOLD`}</dd>
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

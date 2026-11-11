// Profile → Stake (owner request, 10 Nov 2026): one screen with a two-way
// switch. "Stake" explains the idea with a small animated picture, shows the
// tier ladder and holds the stake form (src/FuelTheCity.tsx). "Earnings" shows
// what the explorer earned: QGOLD from the map and what their stake kept.
import { useEffect, useState, type ReactNode } from "react";
import { Flame, MapTrifold, Vault, Wallet } from "@phosphor-icons/react";
import { api, gold as fmtGold } from "./api";
import { CoinIcon } from "./app-bits";
import { GameObjectArt } from "./game-object-art";
import { Ghost } from "./Ghost";
import { prefersReducedMotion } from "./feedback";
import { tr } from "./i18n";
import type { Journey } from "./CharacterJourney";
import type { StakeCard } from "./StakeToday";
import { FuelCard } from "./FuelCard";
import "./profile-journey.css";

export type StakeView = "stake" | "earnings";

export function StakeEarnSwitch({
  value,
  onChange,
}: {
  value: StakeView;
  onChange: (v: StakeView) => void;
}) {
  return (
    <div className="stake-earn-switch" role="group" aria-label={tr("Stake")}>
      <button type="button" aria-pressed={value === "stake"} onClick={() => onChange("stake")}>
        <Flame size={20} weight="duotone" aria-hidden="true" />
        {tr("Stake")}
      </button>
      <button type="button" aria-pressed={value === "earnings"} onClick={() => onChange("earnings")}>
        <Wallet size={20} weight="duotone" aria-hidden="true" />
        {tr("Earnings")}
      </button>
    </div>
  );
}

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
}: {
  step: StakerStep;
  /** 0..1 toward the next step. */
  progress: number;
  next: string;
  numbers: [string, ReactNode][];
}) {
  const here = STEPS.indexOf(step);
  const names = [tr("Free"), tr("Staker"), tr("Tier {0}", { 0: 2 }), tr("Tier {0}", { 0: 3 })];
  const fill = here >= 3 ? 100 : ((here + Math.max(0, Math.min(1, progress))) / 3) * 100;
  return (
    <section className="tier-card" aria-labelledby="tier-card-title">
      <div className="tier-card-head">
        <span id="tier-card-title">{tr("Your tier")}</span>
        <b>{names[here]}</b>
      </div>
      <div
        className="tier-ladder"
        role="progressbar"
        aria-label={tr("Your tier")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill)}
        aria-valuetext={names[here]}
      >
        <span className="tier-ladder-track" />
        <span className="tier-ladder-fill" style={{ width: `${fill}%` }} />
        <ol aria-hidden="true">
          {names.map((n, i) => (
            <li key={n} className={i < here ? "on" : i === here ? "here" : ""} style={{ left: `${(i / 3) * 100}%` }}>
              <i>{i >= 2 ? i : ""}</i>
              {n}
            </li>
          ))}
        </ol>
      </div>
      <p className="tier-card-next">{next}</p>
      <dl className="tier-card-numbers">
        {numbers.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type PendingQgold = { accountId: string | null; units: number; awaitingAccount?: boolean };
const nearOf = (yocto: bigint) => Number(yocto / 10n ** 21n) / 1000;

/** Earnings: the QGOLD balance, what's on its way and where it came from. */
export function EarningsPanel({
  refreshKey,
  onLink,
  children,
}: {
  refreshKey: string;
  /** Prepares the explorer account when QGOLD has nowhere to go yet. */
  onLink?: () => void;
  children?: ReactNode;
}) {
  const [pending, setPending] = useState<PendingQgold | null>(null),
    [balance, setBalance] = useState<number | null>(null),
    [journey, setJourney] = useState<Journey | null>(null),
    [kept, setKept] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void api<PendingQgold>("/qgold/pending")
      .then(async (p) => {
        if (!live) return;
        setPending(p);
        if (!p.accountId) return;
        const a = await api<{ balance: string | null }>(`/qgold/account?account=${encodeURIComponent(p.accountId)}`);
        if (live) setBalance(Number(a.balance || 0));
      })
      .catch(() => undefined);
    void api<Journey>("/me/journey").then((j) => live && setJourney(j), () => undefined);
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
  }, [refreshKey]);
  return (
    <>
      <div className="earn-hero">
        <span>{tr("QGOLD")}</span>
        <div>
          <CoinIcon />
          <strong>{balance === null ? (pending && !pending.accountId ? "0" : "…") : fmtGold(balance, 6)}</strong>
        </div>
        <small>
          {pending?.accountId
            ? tr("On your NEAR account {0}", { 0: pending.accountId })
            : tr("Sign in with a NEAR account to receive QGOLD.")}
        </small>
        {!!pending?.units && (
          <small className="earn-pending">
            {pending.awaitingAccount
              ? tr("{0} QGOLD collected waits for your NEAR account.", { 0: fmtGold(pending.units, 6) })
              : tr("+{0} QGOLD arrives with the next payout, within minutes.", { 0: fmtGold(pending.units, 6) })}
          </small>
        )}
        {pending && !pending.accountId && onLink && (
          <button type="button" className="secondary-button earn-link" onClick={onLink}>
            <Wallet size={18} aria-hidden="true" /> {tr("Activate my account")}
          </button>
        )}
      </div>
      <dl className="earn-sources">
        <div>
          <dt>
            <MapTrifold size={16} weight="duotone" aria-hidden="true" /> {tr("From the map")}
          </dt>
          <dd>
            {journey ? fmtGold(journey.stats.goldEarnedU) : "…"} GOLD
            <small>{tr("Coins, quests and tasks")}</small>
          </dd>
        </div>
        <div>
          <dt>
            <Flame size={16} weight="duotone" aria-hidden="true" /> {tr("From your stake")}
          </dt>
          <dd>
            {kept === null ? "–" : kept.toLocaleString("en-US", { maximumFractionDigits: 3 })} NEAR
            <small>{tr("Yield kept for you")}</small>
          </dd>
        </div>
      </dl>
      <FuelCard refreshKey={refreshKey} />
      {children}
    </>
  );
}

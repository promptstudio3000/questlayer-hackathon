import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowsClockwise,
  CheckCircle,
  Clock,
  Flame,
  WarningCircle,
} from "@phosphor-icons/react";
import { api } from "./api";
import {
  CONTRIBUTION_CHOICES,
  contributionBps,
  fuelStatus,
  summarizeFuel,
  type FuelPosition,
} from "./city-fuel";
import { NativeStaking, type VaultSnapshot } from "./NativeStaking";
import { StakeToday } from "./StakeToday";
import { StakeStory, TierLadder, type StakerStep } from "./StakeEarn";
import { STAKER_SUGGEST_NEAR, takeStakePrefill } from "./LockedChip";
import { parseTestNear, type VaultRequest } from "./native-vault-quote";
import type { Player } from "./types";
import "./fuel-the-city.css";
import "./fuel-stake.css";
import { tr } from "./i18n";

type StakerGates = { minNear: string; suggestNear: string; priceEur: number | null; access: { step: string; staker: boolean } };

/** "~5 €" for a NEAR amount, only when the server has a reference price. */
export function eurHint(near: number, priceEur: number | null | undefined): string | null {
  if (!priceEur || !(near > 0)) return null;
  const v = near * priceEur;
  return `~${v < 10 ? String(Math.round(v * 2) / 2) : Math.round(v)} €`;
}

type CityStaking = {
  staking?: {
    data: {
      totals: { weightedStake: string } | null;
      stakers: number | null;
    } | null;
  };
};

const fmt = (n: number, max = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(n);
const nearOf = (yocto: unknown) => {
  try {
    return Number(BigInt(String(yocto ?? "0")) / 10n ** 21n) / 1000;
  } catch {
    return 0;
  }
};
const big = (v: unknown) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Gas headroom kept on top of the setup and the stake. */
const GAS_HEADROOM = 5n * 10n ** 22n;
const TEST_NEAR_FAUCET = "https://near-faucet.io/";

/** The account's spendable balance in yoctoNEAR, read straight from the chain (null when unknown). */
async function readBalance(accountId: string): Promise<bigint | null> {
  try {
    const config = await api<{ rpcUrl?: string }>("/config");
    if (!config.rpcUrl) return null;
    const r = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "balance",
        method: "query",
        params: { request_type: "view_account", finality: "final", account_id: accountId },
      }),
    });
    const body = (await r.json()) as { result?: { amount?: string; locked?: string } };
    return body.result?.amount ? BigInt(body.result.amount) : null;
  } catch {
    return null;
  }
}

type Outcome =
  | { kind: "idle" }
  | { kind: "pending" | "done" | "failed"; text: string };

/** Where the explorer's one stake stands, read from their vault positions. */
export type StakePhase =
  | { kind: "none" }
  | { kind: "setup"; position: FuelPosition }
  | { kind: "empty"; position: FuelPosition }
  | { kind: "busy"; position: FuelPosition }
  | { kind: "staked"; position: FuelPosition }
  | { kind: "returning"; position: FuelPosition }
  | { kind: "ready"; position: FuelPosition };

/**
 * One stake per explorer (owner request, 11 Nov 2026): stake once, then the
 * only move left is taking it back out. The first position that holds money
 * wins; an empty, finished vault is reused for a new stake.
 */
export function stakePhase(positions: FuelPosition[]): StakePhase {
  const live = positions.filter((p) => p.state !== "failed");
  const withMoney = live.find((p) => {
    const s = p.position;
    return s && (big(s.principal) > 0n || big(s.owner_credit) > 0n || big(s.owner_pending) > 0n || s.stage !== "idle");
  });
  if (withMoney) {
    const s = withMoney.position!;
    if (big(s.owner_credit) > 0n && big(s.owner_pending) === 0n && s.stage === "idle")
      return { kind: "ready", position: withMoney };
    if (s.exit_requested || s.stage === "unlocking" || s.stage === "awaiting_cash" || big(s.owner_pending) > 0n)
      return { kind: "returning", position: withMoney };
    if (s.stage !== "idle") return { kind: "busy", position: withMoney };
    return { kind: "staked", position: withMoney };
  }
  const empty = live.find((p) => p.position && !p.position.exit_requested);
  if (empty) return { kind: "empty", position: empty };
  const setup = live.find((p) => !p.position);
  if (setup) return { kind: "setup", position: setup };
  return { kind: "none" };
}

/**
 * Profile → Stake. The layout shows at once; numbers fill in as the chain
 * answers. One stake, one button: "Stake 2 NEAR" sets up the personal vault
 * when needed and stakes in the same tap. Afterwards the only action is
 * withdrawing. The pool is global (docs/GLOBAL-TREASURY.md).
 */
export function FuelTheCity({
  player,
  account,
  managed,
  onConnect,
  onTransaction,
}: {
  player: Player;
  /** The account that signs: the invisible account when ready, else the first linked one. */
  account: string;
  /** True when the account is the invisible one, so nothing pops up. */
  managed: boolean;
  cityName?: string;
  onConnect: () => void;
  onTransaction: (r: VaultRequest) => Promise<boolean>;
}) {
  const [vaults, setVaults] = useState<VaultSnapshot | null>(null),
    [city, setCity] = useState<CityStaking | null>(null),
    [readError, setReadError] = useState(""),
    [amount, setAmount] = useState(() => takeStakePrefill() || STAKER_SUGGEST_NEAR),
    [gates, setGates] = useState<StakerGates | null>(null),
    [contribution, setContribution] = useState(50),
    [confirmExit, setConfirmExit] = useState(false),
    [balance, setBalance] = useState<bigint | null>(null),
    [copied, setCopied] = useState(false),
    [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const accountRef = useRef(account);
  accountRef.current = account;

  async function readVaults(): Promise<VaultSnapshot | null> {
    try {
      const v = await api<VaultSnapshot>(
        "/native/vaults" + (accountRef.current ? "?account=" + encodeURIComponent(accountRef.current) : ""),
      );
      setVaults(v);
      setReadError("");
      return v;
    } catch (e) {
      setReadError((e as Error).message);
      return null;
    }
  }
  // Each read fills its own part: the slow prize pool total never holds up the stake button.
  useEffect(() => {
    void readVaults();
    setBalance(null);
    if (account) void readBalance(account).then(setBalance);
  }, [account]);
  useEffect(() => {
    let live = true;
    api<CityStaking>("/native/economy").then(
      (c) => live && setCity(c),
      () => undefined,
    );
    api<StakerGates>("/staker/gates").then(
      (g) => live && setGates(g),
      () => undefined,
    );
    // A locked chip tapped while this sheet is open prefills it too.
    const onOpen = () => {
      const near = takeStakePrefill();
      if (near) setAmount(near);
    };
    window.addEventListener("questlayer:open-stake", onOpen);
    return () => {
      live = false;
      window.removeEventListener("questlayer:open-stake", onOpen);
    };
  }, []);

  const positions = (vaults?.positions || []) as FuelPosition[];
  const summary = summarizeFuel(positions, {
    weightedStake: city?.staking?.data?.totals?.weightedStake,
    stakers: city?.staking?.data?.stakers,
  });
  const phase = stakePhase(positions);
  const fixedPct =
    phase.kind !== "none"
      ? contributionBps(phase.position) / 100
      : null;
  const pct = fixedPct ?? contribution;
  const busy = outcome.kind === "pending";
  const loading = !vaults && !readError;
  const notConfigured = vaults?.status === "not-configured";
  const stakeNear = Number(amount) || Number(STAKER_SUGGEST_NEAR);
  const eur = eurHint(stakeNear, gates?.priceEur);
  const setupNear = vaults?.config ? nearOf(vaults.config.setup_deposit) : null;
  let stakeYocto = 0n;
  try {
    stakeYocto = BigInt(parseTestNear(amount));
  } catch {
    stakeYocto = 0n;
  }

  async function sign(request: Omit<VaultRequest, "accountId">): Promise<boolean> {
    return onTransaction({ ...request, accountId: account });
  }

  /** Waits until the factory shows the vault as ready (create registers it in the same transaction). */
  async function waitForVault(match: (p: FuelPosition) => boolean): Promise<FuelPosition | null> {
    for (let i = 0; i < 20; i++) {
      const snap = await readVaults();
      const p = ((snap?.positions || []) as FuelPosition[]).find(match);
      if (p?.position) return p;
      if (p?.state === "failed") return null;
      if (p?.state === "created") return p;
      await wait(3000);
    }
    return null;
  }

  /** One tap: set up the vault when there is none, then stake. */
  async function stake() {
    if (!account) return onConnect();
    let deposit: string;
    try {
      deposit = parseTestNear(amount);
    } catch (e) {
      setOutcome({ kind: "failed", text: (e as Error).message });
      return;
    }
    const fail = (text = tr("It didn't go through. Nothing was taken; try again.")) => {
      setOutcome({ kind: "failed", text });
      void readVaults();
      void readBalance(account).then(setBalance);
    };
    try {
      const snap = (await readVaults()) || vaults;
      if (!snap?.config) return fail(tr("Staking can't be read right now."));
      let now = stakePhase((snap.positions || []) as FuelPosition[]);
      if (now.kind === "none") {
        setOutcome({ kind: "pending", text: tr("Step 1 of 2 · setting up your vault…") });
        const known = new Set(snap.positions.map((p) => p.id));
        const ok = await sign({
          action: "create",
          poolId: snap.pools[0]?.id,
          contributionBps: contribution * 100,
          setupDeposit: snap.config.setup_deposit,
        });
        if (!ok) return fail();
        const p = await waitForVault((x) => !known.has(x.id));
        if (!p) return fail(tr("Your vault is still being set up. Check again in a minute."));
        now = p.position ? { kind: "empty", position: p } : { kind: "setup", position: p };
      }
      if (now.kind === "setup") {
        setOutcome({ kind: "pending", text: tr("Step 1 of 2 · finishing your vault…") });
        const ok = await sign({ action: "register", vaultId: now.position.account_id, positionId: now.position.id });
        if (!ok) return fail();
        const id = now.position.id;
        const p = await waitForVault((x) => x.id === id && x.state !== "registering");
        if (!p?.position) return fail(tr("Your vault is still being set up. Check again in a minute."));
        now = { kind: "empty", position: p };
      }
      if (now.kind !== "empty") {
        setOutcome({ kind: "idle" });
        return;
      }
      setOutcome({ kind: "pending", text: tr("Step 2 of 2 · staking {0} NEAR…", { 0: amount }) });
      const ok = await sign({ action: "deposit", vaultId: now.position.account_id, amount: deposit });
      if (!ok) return fail();
      setOutcome({ kind: "done", text: tr("Staked. It counts after about two epochs; then you are a Staker.") });
      await readVaults();
    } catch (e) {
      fail((e as Error).message);
    }
  }

  async function run(request: Omit<VaultRequest, "accountId">, pending: string, done: string) {
    setOutcome({ kind: "pending", text: pending });
    try {
      const ok = await sign(request);
      setOutcome(ok ? { kind: "done", text: done } : { kind: "failed", text: tr("It didn't go through. Nothing was taken; try again.") });
    } catch (e) {
      setOutcome({ kind: "failed", text: (e as Error).message });
    }
    setConfirmExit(false);
    await readVaults();
    if (account) void readBalance(account).then(setBalance);
  }

  // Where the explorer stands on Free → Staker → Tier 2 → Tier 3.
  const stakerMin = Number(gates?.minNear || STAKER_SUGGEST_NEAR) || 2;
  const ladderStep: StakerStep =
    summary.tier >= 3 ? "tier3" : summary.tier === 2 ? "tier2" : gates?.access.staker ? "staker" : "none";
  const ladderProgress =
    ladderStep === "none"
      ? summary.myStakeNear / stakerMin
      : summary.next
        ? (summary.myWeightedGold - (ladderStep === "tier2" ? 50_000 : 0)) /
          (summary.next.gold - (ladderStep === "tier2" ? 50_000 : 0))
        : 1;
  const ladderNext =
    ladderStep === "none"
      ? summary.myStakeNear > 0
        ? tr("Your stake counts after about two epochs (1–2 days). Then you are a Staker.")
        : tr("Stake {0} NEAR to become a Staker.", { 0: stakerMin })
      : summary.next
        ? tr("{0} GOLD more fuel opens Tier {1} places.", { 0: fmt(summary.next.missingGold), 1: summary.next.tier })
        : tr("Every place on the map is open to you.");

  const principal = "position" in phase ? nearOf(phase.position.position?.principal) : 0;
  const credit = "position" in phase ? nearOf(phase.position.position?.owner_credit) : 0;
  const status = "position" in phase && phase.position.position ? fuelStatus(phase.position) : null;
  const canStake = phase.kind === "none" || phase.kind === "setup" || phase.kind === "empty";
  // What one tap costs from here: the vault setup the first time, the stake, a little gas.
  const needYocto =
    (phase.kind === "none" && vaults?.config ? big(vaults.config.setup_deposit) : 0n) + stakeYocto + GAS_HEADROOM;
  const short = canStake && account && balance !== null && balance < needYocto;
  async function copyAccount() {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="fuel" aria-labelledby="fuel-title">
      <h2 id="fuel-title" className="sr-only">{tr("Stake")}</h2>

      <TierLadder
        step={ladderStep}
        progress={ladderProgress}
        next={ladderNext}
        loading={loading || !gates}
        numbers={[
          [tr("Staked"), `${fmt(summary.myStakeNear, 3)} NEAR`],
          [tr("Your share"), summary.share === null ? "–" : `${fmt(summary.share * 100, 1)} %`],
          [tr("Explorers"), summary.stakers ?? "–"],
        ]}
      >
        <div className="fuel-ratio">
          <span className="fuel-ratio-label">
            <Flame size={16} weight="duotone" aria-hidden="true" /> {tr("Yield to the prize pool")}
          </span>
          {fixedPct !== null ? (
            <b className="fuel-ratio-fixed">{fixedPct} %</b>
          ) : (
            <div className="fuel-ratio-choice" role="radiogroup" aria-label={tr("How much yield fuels the prize pool")}>
              {CONTRIBUTION_CHOICES.map((c) => (
                <button
                  key={c.pct}
                  type="button"
                  role="radio"
                  aria-checked={contribution === c.pct}
                  title={c.hint}
                  disabled={busy || !canStake}
                  onClick={() => setContribution(c.pct)}
                >
                  {c.pct} %
                </button>
              ))}
            </div>
          )}
          <small>
            {tr("The rest of the yield is yours. More to the prize pool climbs the tiers faster.")}
          </small>
        </div>
      </TierLadder>

      <div className="fuel-action" aria-live="polite">
        {notConfigured ? (
          <p className="fuel-state">{tr("Fueling isn't open on this server yet. You can keep exploring for free.")}</p>
        ) : canStake ? (
          <>
            <button
              className="primary-button fuel-stake-button"
              disabled={busy || !!short || (!!vaults?.config && vaults.config.created >= vaults.config.capacity && phase.kind === "none")}
              onClick={() => void stake()}
            >
              {busy && outcome.kind === "pending" ? outcome.text : tr("Stake {0} NEAR", { 0: amount })}
              {eur && !busy ? <small>{eur}</small> : null}
              <Flame size={20} aria-hidden="true" />
            </button>
            {short && (
              <div className="fuel-short" role="status">
                <p>
                  {tr("You have {0} test NEAR; this needs about {1}. Send test NEAR to your explorer account, then check again.", {
                    0: fmt(nearOf(balance!.toString()), 2),
                    1: fmt(nearOf(needYocto.toString()), 2),
                  })}
                </p>
                <code>{account}</code>
                <div className="fuel-short-buttons">
                  <button type="button" className="secondary-button" onClick={() => void copyAccount()}>
                    {copied ? tr("Copied") : tr("Copy address")}
                  </button>
                  <a className="secondary-button" href={TEST_NEAR_FAUCET} target="_blank" rel="noreferrer">
                    {tr("Get test NEAR")}
                  </a>
                  <button type="button" className="secondary-button" onClick={() => void readBalance(account).then(setBalance)}>
                    <ArrowsClockwise size={18} aria-hidden="true" /> {tr("Check again")}
                  </button>
                </div>
              </div>
            )}
            <p className="fuel-paid">
              {tr("One stake. It stays yours: you can only withdraw it, which takes about 1–7 days.")}{" "}
              {phase.kind === "none" && setupNear !== null
                ? tr("First time only: {0} test NEAR sets up your personal vault and is not returned.", { 0: fmt(setupNear, 2) })
                : null}{" "}
              {!account
                ? tr("Your explorer account is prepared first.")
                : managed
                  ? tr("Paid from your balance, no popup.")
                  : tr("Your NEAR wallet asks you to approve.")}
            </p>
          </>
        ) : (
          <>
            <div className="fuel-mine">
              <div>
                <span>{phase.kind === "ready" ? tr("Back and ready") : tr("Your stake")}</span>
                <b>{fmt(phase.kind === "ready" ? credit : principal, 3)} NEAR</b>
              </div>
              {status && (
                <span className={`fuel-chip fuel-${status.tone}`}>
                  {status.tone === "failed" ? (
                    <WarningCircle size={14} aria-hidden="true" />
                  ) : status.tone === "active" || status.tone === "ready" ? (
                    <CheckCircle size={14} aria-hidden="true" />
                  ) : (
                    <Clock size={14} aria-hidden="true" />
                  )}
                  {status.label}
                </span>
              )}
            </div>
            {phase.kind === "staked" &&
              (confirmExit ? (
                <div className="fuel-confirm">
                  <p>
                    {tr("Your whole stake starts coming back now. It stops counting toward your tier at once and arrives after about 1–7 days (4 epochs).")}
                  </p>
                  <div className="fuel-confirm-buttons">
                    <button className="secondary-button" disabled={busy} onClick={() => setConfirmExit(false)}>
                      {tr("Keep staking")}
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          { action: "exit", vaultId: phase.position.account_id },
                          tr("Requesting your withdrawal…"),
                          tr("Withdrawal requested. Your NEAR is unstaking; it shows here when it's back."),
                        )
                      }
                    >
                      {busy && outcome.kind === "pending" ? outcome.text : tr("Withdraw {0} NEAR", { 0: fmt(principal, 3) })}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="secondary-button" disabled={busy} onClick={() => setConfirmExit(true)}>
                  <ArrowDown size={18} aria-hidden="true" /> {tr("Withdraw")}
                </button>
              ))}
            {phase.kind === "busy" && <p className="fuel-paid">{tr("The pool is confirming your last step. This takes a moment.")}</p>}
            {phase.kind === "returning" && (
              <p className="fuel-paid">
                {phase.position.position?.stage === "unlocking"
                  ? tr("Unstaking: it unlocks at epoch {0} (now {1}). The game moves it back for you; then withdraw it here.", {
                      0: String(phase.position.position?.unlock_epoch),
                      1: String(phase.position.position?.epoch),
                    })
                  : tr("Your stake is on its way back. The game moves it along for you; then withdraw it here.")}
              </p>
            )}
            {phase.kind === "ready" && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    { action: "withdraw", vaultId: phase.position.account_id },
                    tr("Withdrawing…"),
                    tr("Withdrawn to your balance."),
                  )
                }
              >
                <ArrowDown size={20} aria-hidden="true" />
                {busy && outcome.kind === "pending" ? outcome.text : tr("Withdraw {0} NEAR to my balance", { 0: fmt(credit, 3) })}
              </button>
            )}
            {(phase.kind === "returning" || phase.kind === "busy") && (
              <button className="secondary-button" disabled={busy} onClick={() => void readVaults()}>
                <ArrowsClockwise size={18} aria-hidden="true" /> {tr("Check again")}
              </button>
            )}
          </>
        )}
        {readError && !vaults && (
          <div className="fuel-state fuel-failed" role="alert">
            <WarningCircle size={20} aria-hidden="true" />
            <span>
              {tr("Staking can't be read right now.")} {readError}
            </span>
            <button className="secondary-button" onClick={() => void readVaults()}>
              {tr("Try again")}
            </button>
          </div>
        )}
        {outcome.kind === "done" && (
          <p className="fuel-state fuel-ready" role="status">
            <CheckCircle size={20} aria-hidden="true" /> {outcome.text}
          </p>
        )}
        {outcome.kind === "failed" && (
          <p className="fuel-state fuel-failed" role="alert">
            <WarningCircle size={20} aria-hidden="true" /> {outcome.text}
          </p>
        )}
      </div>

      {canStake ? (
        <StakeStory sharePct={pct} />
      ) : (
        <details className="stake-story-more">
          <summary>{tr("How staking works")}</summary>
          <StakeStory sharePct={pct} />
        </details>
      )}

      {!canStake && <StakeToday />}

      <details className="play-details fuel-advanced">
        <summary>
          <ArrowsClockwise size={18} aria-hidden="true" /> {tr("Vault details")}
        </summary>
        <NativeStaking player={player} onConnect={onConnect} onTransaction={onTransaction} />
      </details>
    </section>
  );
}

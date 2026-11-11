// "Your stake today" (GAME-LOOPS P0-3): what the player's vaults retained and
// gave to the prize pool today, the E+2 countdown in real epochs, the one-time
// maturity / tier ceremony and the Keeper's inner vault. Data comes from
// server/npc/keeper-vault.mjs (Keeper sheet, or GET /api/keeper/stake).
import { useEffect, useState } from "react";
import { api } from "./api";
import LockedChip from "./LockedChip";
import "./stake-today.css";
import { tr } from "./i18n";
import { ChainLink } from "./ChainLink";

export interface StakeVault {
  vault: string;
  pool: string;
  state: string;
  contributionPercent?: number | null;
  principal?: string;
  maturity: {
    state: "mature" | "pending" | "uncounted" | "refreshing" | "exiting" | "empty" | "setup" | "failed";
    mature?: string | null;
    pending?: string | null;
    byEpoch?: number | null;
    epochsLeft?: number | null;
    hoursLeft?: number | null;
  };
  totals?: { retained: string; given: string; givenPaid: string; inPool: string };
  today?: { retained: string; given: string; inPool: string; since: number; sinceYesterday: boolean };
}
export interface StakeCeremony {
  id: string;
  accountId: string;
  kind: "matured" | "tier";
  tier: number | null;
  amount: string | null;
  epoch: number | null;
  createdAt: number;
}
export interface StakeCard {
  epoch: number | null;
  epochHours: number;
  maturityEpochs: number;
  tier: number;
  nextTier: { tier: number; missing: string } | null;
  hasPosition: boolean;
  accounts: { accountId: string; tier: number; vaults: StakeVault[] }[];
  coins: { dayId: string; coinUnit: string; coinCount: number; funding: string; backed: number; givenPaid: string } | null;
  ceremonies: StakeCeremony[];
  patron: { title: string; since: number } | null;
  rank?: PatronRank | null;
  staker?: { step: "none" | "staker" | "tier2" | "tier3"; staker: boolean; matured: string; maturing: string; minNear: string; priceEur: number | null };
  stakeToday?: { open: boolean; missing: string[]; stakeNear: string };
  inner: {
    open: boolean;
    gate: { step?: string; tier?: number; level: number } | null;
    have: { step?: string; tier: number; level: number };
    missing: string[];
    stakeNear?: string;
    chapters: { title: string; text?: string; locked?: boolean }[];
    /** Patron's Path: progress through the patron quest lines (P1-1). */
    path?: {
      done: number;
      of: number;
      story: { title: string; text?: string; locked?: boolean }[];
      edition: { id: string; name: string | null; available: boolean; earned: boolean };
      /** What the next step and the Aura need (staker gates: step AND level). */
      next?: { key: string; open: boolean; missing: string[]; stakeNear?: string } | null;
      auraGate?: { key: string; open: boolean; missing: string[] } | null;
    };
  };
  linked?: number;
}

/** Patron rank 1–5 (GAME-LOOPS P1-2): matured patron epochs, no decay. */
export interface PatronRank {
  rank: number;
  name: string | null;
  epochs: number;
  growing: boolean;
  staker: boolean;
  step: "staker" | "tier2" | "tier3";
  next: { rank: number; name: string; epochs: number; left: number } | null;
  ladder: { rank: number; name: string; epochs: number }[];
  rankUp: { rank: number; name: string } | null;
}

const GOLD = 10n ** 21n; // 1 GOLD = 0.001 NEAR
export function gold(yocto: string | null | undefined, digits = 3): string {
  let v: bigint;
  try {
    v = BigInt(yocto || "0");
  } catch {
    return "–";
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const scale = 10n ** BigInt(digits);
  const n = Number((v * scale) / GOLD) / Number(scale);
  return `${neg ? "−" : ""}${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
}
const sumField = (card: StakeCard, pick: (v: StakeVault) => string | undefined) =>
  card.accounts
    .flatMap((a) => a.vaults)
    .reduce((t, v) => {
      try {
        return t + BigInt(pick(v) || "0");
      } catch {
        return t;
      }
    }, 0n)
    .toString();
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function ceremonyText(c: StakeCeremony, card: StakeCard) {
  if (c.kind === "tier")
    return {
      title: tr("Tier {0} is yours", { 0: c.tier }),
      text: tr("Your matured stake opened Tier {0} places on the map.{1}", { 0: c.tier, 1: card.patron ? ` You now wear the "${card.patron.title}" title, and it stays yours.` : "" }),
    };
  return {
    title: tr("Your fuel has matured"),
    text: tr("{0} GOLD of new stake now fuels the prize pool{1}.", { 0: gold(c.amount), 1: c.epoch != null ? ` (epoch ${c.epoch})` : "" }),
  };
}

export function StakeCeremonies({ card, onSeen }: { card: StakeCard; onSeen: (id: string) => void }) {
  if (!card.ceremonies.length) return null;
  return (
    <div className="stake-ceremony" role="status" aria-live="polite">
      {card.ceremonies.map((c) => {
        const t = ceremonyText(c, card);
        return (
          <div key={c.id} className="stake-ceremony-item">
            <span className="stake-ceremony-seal" aria-hidden="true">✦</span>
            <div>
              <strong>{t.title}</strong>
              <p>{t.text}</p>
            </div>
            <button type="button" onClick={() => onSeen(c.id)}>{tr("Thank the Keeper")}</button>
          </div>
        );
      })}
    </div>
  );
}

function maturityLine(v: StakeVault, card: StakeCard) {
  const m = v.maturity;
  switch (m.state) {
    case "pending":
      return m.byEpoch != null
        ? tr("{0} GOLD matures by epoch {1} at the latest (now {2}{3}).", { 0: gold(m.pending), 1: m.byEpoch, 2: card.epoch, 3: m.epochsLeft ? `, ${m.epochsLeft} epoch${m.epochsLeft === 1 ? "" : "s"} ≈ ${m.hoursLeft} h` : ", any moment" })
        : tr("{0} GOLD is still maturing (E+{1}).", { 0: gold(m.pending), 1: card.maturityEpochs });
    case "mature":
      return tr("All {0} GOLD has matured and fuels the prize pool.", { 0: gold(v.principal) });
    case "uncounted":
      return tr("At 0 % prize pool share this stake earns only for you and does not count toward a tier. It still makes you a Staker once it has matured.");
    case "refreshing":
      return tr("The vault is waiting for its pool to be read again; maturity shows after the next refresh.");
    case "exiting":
      return tr("Exit requested: this stake no longer counts toward a tier.");
    case "setup":
      return tr("Vault setup is not finished yet.");
    case "failed":
      return tr("Vault setup failed. Open Manage stakes to get the deposit back.");
    default:
      return tr("No stake in this vault.");
  }
}

export const seenRank = (rank: number) => api<{ seen: boolean }>(`/keeper/rank/${rank}/seen`, {});

function PatronRankUp({ rank, onSeen }: { rank: PatronRank; onSeen: () => void }) {
  if (!rank.rankUp) return null;
  return (
    <div className="stake-ceremony" role="status" aria-live="polite">
      <div className="stake-ceremony-item">
        <span className="stake-ceremony-seal" aria-hidden="true">{"✦".repeat(Math.min(rank.rankUp.rank, 3))}</span>
        <div>
          <strong>{tr("Patron rank")}{" "}{rank.rankUp.rank}: {rank.rankUp.name}</strong>
          <p>
            {rank.epochs === 1 ? tr("1 epoch") : tr("{0} epochs", { 0: rank.epochs })} {" "}{tr("of matured fuel kept the prize pool lit. The rank is yours to keep, even if you withdraw later.")}</p>
        </div>
        <button type="button" onClick={onSeen}>{tr("Thank the Keeper")}</button>
      </div>
    </div>
  );
}

/** Rank ladder: five pips, the current name and what the next step needs. */
export function PatronRankLadder({ rank }: { rank: PatronRank }) {
  const epochHint = (n: number) => `${n} epoch${n === 1 ? "" : "s"}`;
  return (
    <div className="patron-rank" aria-label={tr("Patron rank {0} of 5", { 0: rank.rank })}>
      <ol className="patron-rank-pips">
        {rank.ladder.map((step) => (
          <li key={step.rank} className={step.rank <= rank.rank ? "on" : ""} title={`${step.name}: ${epochHint(step.epochs)}`}>
            <span aria-hidden="true">{step.rank}</span>
            <span className="sr-only">{step.rank <= rank.rank ? tr("{0} (earned)", { 0: step.name }) : step.name}</span>
          </li>
        ))}
      </ol>
      <p className="stake-note">
        {rank.rank ? tr("Patron rank {0} · {1}. ", { 0: rank.rank, 1: rank.name }) : rank.staker ? tr("Rank 0 · Staker. ") : tr("No patron rank yet. ")}
        {rank.next
          ? rank.growing
            ? tr("{0} more of holding your matured stake makes you {1}.", { 0: epochHint(rank.next.left), 1: rank.next.name })
            : tr("It grows with every epoch you hold matured stake{0}; {1} needs {2} in all.", { 0: rank.step === "staker" ? "" : ` at ${rank.step === "tier2" ? "Tier 2" : "Tier 3"}`, 1: rank.next.name, 2: epochHint(rank.next.epochs) })
          : tr("The highest rank. It stays yours.")}
        {rank.rank > 0 && !rank.growing && rank.next ? tr(" Your rank stays; it only pauses.") : ""}
      </p>
    </div>
  );
}

export function StakeTodayCard({ card, onSeen, onRankSeen }: { card: StakeCard; onSeen?: (id: string) => void; onRankSeen?: () => void }) {
  const vaults = card.accounts.flatMap((a) => a.vaults);
  const withData = vaults.filter((v) => v.today);
  const since = withData.length ? Math.min(...withData.map((v) => v.today!.since)) : null;
  const fromYesterday = withData.some((v) => v.today!.sinceYesterday);
  return (
    <section className="stake-today" aria-labelledby="stake-today-title">
      {onSeen && <StakeCeremonies card={card} onSeen={onSeen} />}
      {onRankSeen && card.rank && <PatronRankUp rank={card.rank} onSeen={onRankSeen} />}
      <header>
        <h3 id="stake-today-title">{tr("Your stake")}</h3>
        {card.patron && <span className="stake-patron">✦ {card.patron.title}</span>}
        {card.rank && card.rank.name && (
          <span className="stake-patron stake-rank">
            {tr("Rank")}{" "}{card.rank.rank} · {card.rank.name}
          </span>
        )}
      </header>
      {card.rank && (card.rank.rank > 0 || card.hasPosition) && <PatronRankLadder rank={card.rank} />}
      {!card.hasPosition ? (
        <>
          <p>{tr("No stake yet. A small stake matures in")}{" "}{card.maturityEpochs} {" "}{tr("epochs (about")}{" "}{card.maturityEpochs * card.epochHours} {" "}{tr("h) and then fuels the prize pool.")}</p>
          {card.stakeToday && !card.stakeToday.open && (
            <LockedChip
              label={tr("Your stake today")}
              perk={tr("Daily numbers from your vault and the Keeper's inner vault")}
              gate={{ step: "staker", missing: card.stakeToday.missing, stakeNear: card.stakeToday.stakeNear }}
            />
          )}
        </>
      ) : (
        <>
          {card.stakeToday && !card.stakeToday.open ? (
            <LockedChip
              label={tr("Today's numbers")}
              perk={tr("What your vault kept for you and gave to the prize pool today")}
              gate={{ step: "staker", missing: card.stakeToday.missing, stakeNear: card.stakeToday.stakeNear }}
            />
          ) : (
          <>
          <dl className="stake-today-numbers">
            <div>
              <dt>{tr("Kept for you")}</dt>
              <dd>+{gold(sumField(card, (v) => v.today?.retained))} GOLD</dd>
            </div>
            <div>
              <dt>{tr("Given to the prize pool")}</dt>
              <dd>+{gold(sumField(card, (v) => v.today?.given))} GOLD</dd>
            </div>
            <div>
              <dt>{tr("Growing in the pool")}</dt>
              <dd>{gold(sumField(card, (v) => v.totals?.inPool))} GOLD</dd>
            </div>
          </dl>
          {since != null && (
            <p className="stake-note">
              {fromYesterday ? tr("Since the Keeper's last reading ({0}).", { 0: new Date(since).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) }) : tr("Counting from {0}, the Keeper's first reading today.", { 0: time(since) })} {" "}{tr("Yield arrives when the vault is harvested, so some days show 0.")}</p>
          )}
          {card.coins && (
            <p className="stake-coins">
              {card.coins.funding === "realized_yield"
                ? tr("Your vaults have paid {0} GOLD into the global prize pool: the value of {1} of today's {2} coins. The coins stay shared, first come first served.", { 0: gold(card.coins.givenPaid), 1: card.coins.backed, 2: card.coins.coinCount })
                : tr("Today's {0} coins are sponsor-funded. The {1} GOLD your vaults paid in waits in the pot for coming days.", { 0: card.coins.coinCount, 1: gold(card.coins.givenPaid) })}
            </p>
          )}
          </>
          )}
          <ul className="stake-maturity">
            {vaults.map((v) => (
              <li key={v.vault} className={`stake-${v.maturity.state}`}>
                {v.maturity.state === "pending" && v.maturity.epochsLeft != null && (
                  <span className="stake-countdown" aria-hidden="true">E−{v.maturity.epochsLeft}</span>
                )}
                {maturityLine(v, card)}{" "}
                {/^[a-z0-9._-]+$/.test(v.vault) && <ChainLink chain={{ account: v.vault }} />}
              </li>
            ))}
          </ul>
          <p className="stake-note">
            {card.tier > 1 ? tr("Tier {0}", { 0: card.tier }) : card.staker?.staker ? tr("Staker") : tr("Free explorer")}
            {card.nextTier ? tr(" · {0} GOLD more matured fuel opens Tier {1}.", { 0: gold(card.nextTier.missing, 0), 1: card.nextTier.tier }) : tr(" · every place on the map is open to you.")}
          </p>
        </>
      )}
    </section>
  );
}

export function InnerVault({ card }: { card: StakeCard }) {
  const { inner } = card;
  return (
    <section className={`inner-vault${inner.open ? " open" : ""}`} aria-labelledby="inner-vault-title">
      <h3 id="inner-vault-title">{inner.open ? tr("The inner vault") : tr("🔒 The inner vault")}</h3>
      {inner.open ? (
        <p className="stake-note">{tr("Patrons only. Stories, never better odds.")}</p>
      ) : (
        <LockedChip
          label={tr("The inner vault")}
          perk={tr("Patron story chapters")}
          gate={{ step: inner.gate?.step, level: inner.gate?.level, missing: inner.missing, stakeNear: inner.stakeNear }}
        />
      )}
      <ol>
        {inner.chapters.map((c) => (
          <li key={c.title} className={c.locked ? "locked" : ""}>
            <strong>{c.title}</strong>
            {c.text && <p>{c.text}</p>}
          </li>
        ))}
      </ol>
      {inner.path && <PatronPath path={inner.path} open={inner.open} />}
    </section>
  );
}

function PatronPath({ path, open }: { path: NonNullable<StakeCard["inner"]["path"]>; open: boolean }) {
  const reward = path.edition.earned
    ? tr("You wear the {0} Aura.", { 0: path.edition.name })
    : path.edition.available
      ? tr("Finish it for the {0} Aura (cosmetic, once per player).", { 0: path.edition.name })
      : tr("Finish it for the patron edition Aura (cosmetic, arrives with the next collectibles upgrade).");
  return (
    <div className="patron-path" aria-label={tr("Patron's Path")}>
      <h4>
        {tr("Patron's Path ·")}{" "}{path.done}/{path.of}
      </h4>
      <p className="stake-note">
        {path.next && !path.next.open
          ? tr("Next step needs: {0}. ", { 0: path.next.missing.join(" · ") })
          : open || path.next?.open
            ? tr("Take a patron walk from a quest giver or a patron chapter from a storyteller, one each per day. ")
            : tr("Patron walks and chapters open for stakers. ")}
        {reward}
        {path.auraGate && !path.auraGate.open && !path.edition.earned ? tr(" The Aura needs: {0}.", { 0: path.auraGate.missing.join(" · ") }) : ""}
      </p>
      <ol>
        {path.story.map((c) => (
          <li key={c.title} className={c.locked ? "locked" : ""}>
            <strong>{c.title}</strong>
            {c.text && <p>{c.text}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export const seenCeremony = (id: string) => api<{ seen: boolean }>(`/keeper/ceremonies/${encodeURIComponent(id)}/seen`, {});

/** Self-loading card for Profile → Stake. Stays hidden when the host has no Keeper vault. */
export function StakeToday() {
  const [card, setCard] = useState<StakeCard | null>(null);
  useEffect(() => {
    let live = true;
    api<StakeCard>("/keeper/stake").then(
      (c) => live && setCard(c),
      () => live && setCard(null),
    );
    return () => {
      live = false;
    };
  }, []);
  if (!card) return null;
  const seen = (id: string) =>
    void seenCeremony(id).finally(() => setCard((c) => (c ? { ...c, ceremonies: c.ceremonies.filter((x) => x.id !== id) } : c)));
  const rankSeen = () => {
    const r = card.rank?.rankUp?.rank;
    if (r) void seenRank(r).finally(() => setCard((c) => (c?.rank ? { ...c, rank: { ...c.rank, rankUp: null } } : c)));
  };
  return <StakeTodayCard card={card} onSeen={seen} onRankSeen={rankSeen} />;
}

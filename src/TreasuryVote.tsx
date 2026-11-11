// Community → "Treasury vote": explorers at level 3+ who played this week vote
// on the weekly treasury mix (and any extra vote of the week) on the treasury
// DAO, a Sputnik DAO on NEAR. The vote is signed by the explorer account, so
// there is no wallet popup. Server: server/native/treasury-dao.mjs,
// docs/TREASURY-DAO.md. Hidden on hosts without the DAO.
import { useCallback, useEffect, useState } from "react";
import { Bank, CheckCircle, Star } from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import { tr } from "./i18n";
import { closesLabel } from "./CommunityBonusVote";

export type DaoOption = {
  proposalId: number;
  option: string;
  label: string;
  recommended: boolean;
  approvals: number;
  mine: boolean;
};
export type DaoPoll = {
  poll: string;
  kind: "mix" | "extra";
  title: string;
  closesAt: number | null;
  open: boolean;
  winner: string;
  voters: number;
  options: DaoOption[];
};
export type DaoView = {
  dao: string;
  exists: boolean;
  explorers?: number;
  rule: { minLevel: number; activeDays: number };
  weeklyMix?: DaoPoll | null;
  extras?: DaoPoll[];
  adopted?: { option: string; targets: { staked?: number; lst: number; stable: number; near: number } } | null;
  me?: { account: string; member: boolean } | null;
};

const pct = (bps: number) => Math.round(bps / 100);
export const mixLabel = (t: { staked?: number; lst: number; stable: number; near: number }) =>
  `${pct((t.staked ?? 0) + t.lst)} / ${pct(t.stable)} / ${pct(t.near)}`;

export function TreasuryVote({
  account,
  vote,
  notify,
}: {
  /** The player's explorer account, or null while it is not ready. */
  account: string | null;
  /** Signs act_proposal(VoteApprove) on the DAO with the explorer account. */
  vote: (dao: string, proposalId: number) => Promise<boolean>;
  notify?: (message: string, error?: boolean) => void;
}) {
  const [view, setView] = useState<DaoView | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const q = account ? "?account=" + encodeURIComponent(account) : "";
      setView(await api<DaoView>("/treasury/dao" + q));
    } catch (error) {
      if (error instanceof ApiError && error.code === "TREASURY_DAO_DISABLED") setHidden(true);
    }
  }, [account]);
  useEffect(() => {
    void load();
  }, [load]);

  if (hidden || !view?.exists) return null;
  const polls = [view.weeklyMix, ...(view.extras || [])].filter((p): p is DaoPoll => !!p);
  if (!polls.length) return null;
  const member = !!view.me?.member;

  async function cast(p: DaoPoll, o: DaoOption) {
    setBusy(o.proposalId);
    try {
      if (await vote(view!.dao, o.proposalId)) {
        notify?.(tr("Vote saved on chain."));
        // The chain view is cached for a short while; show the vote right away.
        setView((v) =>
          v && {
            ...v,
            weeklyMix: v.weeklyMix && mark(v.weeklyMix, p.poll, o.proposalId),
            extras: v.extras?.map((x) => mark(x, p.poll, o.proposalId)),
          },
        );
      }
    } catch (error) {
      notify?.(error instanceof Error ? error.message : tr("Could not save your vote."), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="bonus-vote treasury-vote" open aria-labelledby="treasury-vote-title">
      <summary>
        <h2 id="treasury-vote-title">
          <Bank size={20} aria-hidden /> {tr("Treasury vote")}
        </h2>
        {view.weeklyMix?.closesAt && view.weeklyMix.open && (
          <p className="bonus-vote-meta">
            <span>{closesLabel(view.weeklyMix.closesAt)}</span>
          </p>
        )}
      </summary>
      <p>{tr("Explorers choose how the shared treasury is held. The council carries out the result.")}</p>
      {view.adopted && (
        <p className="bonus-vote-winners">
          <Star size={18} weight="fill" aria-hidden /> {tr("In force now: {0}", { 0: mixLabel(view.adopted.targets) })}
        </p>
      )}
      {!member && <p className="bonus-vote-note">{tr("Reach level 3 and play this week to vote. New voters join once a day.")}</p>}
      {polls.map((p, i) => {
        const voted = p.options.some((o) => o.mine);
        return (
          <section key={p.poll} aria-label={p.title}>
            {i === 1 && <h3>{tr("Other votes this week")}</h3>}
            {p.kind === "extra" && <p className="bonus-vote-note">{p.title}</p>}
            <ul className="bonus-vote-list">
              {p.options.map((o) => (
                <li key={o.proposalId} className={o.mine ? "is-mine" : undefined}>
                  <span className="bonus-vote-title">
                    <b>{o.label}</b>
                    <small>
                      {o.approvals === 1 ? tr("1 vote") : tr("{0} votes", { 0: o.approvals })}
                      {o.recommended ? ` · ${tr("Recommended")}` : ""}
                    </small>
                  </span>
                  <button
                    type="button"
                    className={o.mine ? "bonus-vote-button voted" : "bonus-vote-button"}
                    aria-pressed={o.mine}
                    aria-label={tr("Vote for {0}", { 0: o.label })}
                    disabled={busy !== null || !member || !p.open || voted || !account}
                    onClick={() => void cast(p, o)}
                  >
                    {o.mine ? (
                      <>
                        <CheckCircle size={18} weight="fill" aria-hidden /> {tr("Voted")}
                      </>
                    ) : (
                      tr("Vote")
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="bonus-vote-note">
        <a href="/treasury#dao">{tr("See the treasury DAO")}</a>
      </p>
    </details>
  );
}

function mark(p: DaoPoll, poll: string, proposalId: number): DaoPoll {
  if (p.poll !== poll) return p;
  return {
    ...p,
    options: p.options.map((o) => (o.proposalId === proposalId ? { ...o, mine: true, approvals: o.approvals + 1 } : o)),
  };
}

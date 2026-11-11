// The weekly treasury vote on /treasury (docs/TREASURY-DAO.md). Anyone sees the
// tally; a signed-in explorer at level 3+ who played this week votes right here.
// The vote is signed by the explorer's own account (device key, sponsored), so
// there is no wallet popup. Without a session the card links to the game.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Clock, Lock, Star, UsersThree } from "@phosphor-icons/react";
import { api, ApiError } from "../api";
import { useInvisibleAccount } from "../useInvisibleAccount";
import { explorerAccountMessage } from "../explorer-account";
import { NEAR_NETWORK, onNearNetwork } from "../near-network";

type Targets = { staked?: number; lst: number; stable: number; near: number };
const staking = (t: Targets) => (t.staked ?? 0) + t.lst;
export type VoteOption = { proposalId: number; option: string; label: string; recommended: boolean; approvals: number; mine?: boolean; targets?: Targets };
export type VotePoll = { poll: string; kind: string; title: string; closesAt: number | null; open: boolean; winner: string; voters: number; options: VoteOption[] };
export type VoteView = {
  dao: string;
  exists: boolean;
  rule: { minLevel: number; activeDays: number };
  weeklyMix?: VotePoll | null;
  extras?: VotePoll[];
  adopted?: { option: string; targets: Targets } | null;
  me?: { account: string; member: boolean } | null;
};

type Viewer =
  | { state: "loading" }
  | { state: "guest" }
  | { state: "player"; playerId: string; account: string | null; accountState: string | null };

/** "closes in 4 d 6 h" style countdown for the poll. */
export function closesIn(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((at - now) / 1000));
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  if (d) return `closes in ${d} d ${h} h`;
  if (h) return `closes in ${h} h ${m} min`;
  return `closes in ${Math.max(1, m)} min`;
}

function MixStrip({ t }: { t: Targets }) {
  return (
    <span className="tr-strip" aria-label={`${staking(t) / 100} % staked, ${t.stable / 100} % stables, ${t.near / 100} % reserve`}>
      <span className="tr-c1" style={{ flexGrow: staking(t) }} />
      <span className="tr-c2" style={{ flexGrow: t.stable }} />
      <span className="tr-c3" style={{ flexGrow: t.near }} />
    </span>
  );
}

function mark(p: VotePoll | null | undefined, poll: string, proposalId: number) {
  if (!p || p.poll !== poll) return p;
  return { ...p, voters: p.voters + 1, options: p.options.map((o) => (o.proposalId === proposalId ? { ...o, mine: true, approvals: o.approvals + 1 } : o)) };
}

export default function TreasuryVoteCard({ initial }: { initial: VoteView }) {
  const [view, setView] = useState<VoteView>(initial);
  const [viewer, setViewer] = useState<Viewer>({ state: "loading" });
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const playerId = viewer.state === "player" ? viewer.playerId : null;
  const invisible = useInvisibleAccount(playerId);

  // Who is looking: a game session on this browser, and its explorer account.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { player } = await api<{ player: { id: string } }>("/me");
        let account: string | null = null,
          accountState: string | null = null;
        try {
          const a = await api<{ enabled: boolean; account: { accountId: string; state: string } | null }>("/account");
          account = a.account?.state === "ready" ? a.account.accountId : null;
          accountState = a.enabled ? (a.account?.state ?? "none") : "unavailable";
        } catch {
          /* no explorer account yet */
        }
        if (live) setViewer({ state: "player", playerId: player.id, account, accountState });
      } catch {
        if (live) setViewer({ state: "guest" });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // With an account, read the tally again with this explorer's own votes.
  const account = viewer.state === "player" ? viewer.account : null;
  const reload = useCallback(async () => {
    if (!account) return;
    try {
      setView(await api<VoteView>("/treasury/dao?account=" + encodeURIComponent(account)));
    } catch {
      /* keep the public tally */
    }
  }, [account]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const polls = [view.weeklyMix, ...(view.extras ?? [])].filter((p): p is VotePoll => !!p);
  const member = !!view.me?.member;

  async function cast(p: VotePoll, o: VoteOption) {
    if (!playerId) return;
    setBusy(o.proposalId);
    setNote(null);
    try {
      if (!onNearNetwork(view.dao)) throw Error("The treasury vote is on another network.");
      const { signer, reason } = await invisible.ensureSigner();
      if (!signer) throw Error(explorerAccountMessage(reason));
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: signer.accountId,
          receiverId: view.dao,
          actions: [{ type: "FunctionCall", params: { methodName: "act_proposal", args: { id: o.proposalId, action: "VoteApprove", proposal: "Vote" }, gas: "50000000000000", deposit: "0" } }],
        },
        { playerId },
      );
      // The chain view is cached for a short while; show the vote right away.
      setView((v) => ({ ...v, weeklyMix: mark(v.weeklyMix, p.poll, o.proposalId), extras: v.extras?.map((x) => mark(x, p.poll, o.proposalId)!) }));
      setNote({ text: "Vote saved on chain. Thank you!" });
    } catch (error) {
      setNote({ text: error instanceof ApiError || error instanceof Error ? error.message : "Could not save your vote.", bad: true });
    } finally {
      setBusy(null);
    }
  }

  const gate =
    viewer.state === "loading" ? null : viewer.state === "guest" ? (
      <p className="tr-vote-gate">
        <Lock size={18} aria-hidden="true" />
        <span>
          Explorers at level {view.rule.minLevel}+ who played in the last {view.rule.activeDays} days vote here. <a href="/">Open the game</a> on this device to sign in.
        </span>
      </p>
    ) : !viewer.account ? (
      <p className="tr-vote-gate">
        <Lock size={18} aria-hidden="true" />
        <span>Your explorer account opens with your first find. Collect a coin or finish a quest, then vote here.</span>
      </p>
    ) : !member ? (
      <p className="tr-vote-gate">
        <Lock size={18} aria-hidden="true" />
        <span>
          Reach level {view.rule.minLevel} and play this week to vote. New voters join once a day.
        </span>
      </p>
    ) : null;

  if (!polls.length) return <p className="eco-muted">This week's vote opens with the next morning run.</p>;

  return (
    <div className="tr-vote">
      {gate}
      {polls.map((p, i) => {
        const most = Math.max(1, ...p.options.map((o) => o.approvals));
        const total = p.options.reduce((s, o) => s + o.approvals, 0);
        const voted = p.options.some((o) => o.mine);
        return (
          <section key={p.poll} className="tr-poll" aria-label={p.title}>
            <header className="tr-poll-head">
              <h3>{i === 0 && p.kind === "mix" ? "How should the treasury be held this week?" : p.title}</h3>
              <p className="tr-poll-meta">
                <span>
                  <Clock size={16} aria-hidden="true" /> {p.open && p.closesAt ? closesIn(p.closesAt) : "closed"}
                </span>
                <span>
                  <UsersThree size={16} aria-hidden="true" /> {p.voters} {p.voters === 1 ? "voter" : "voters"}
                </span>
              </p>
            </header>
            <ul className="tr-options">
              {p.options.map((o) => {
                const lead = o.option === p.winner && total > 0;
                const share = total ? Math.round((o.approvals / total) * 100) : 0;
                return (
                  <li key={o.proposalId} className={["tr-option", o.mine ? "is-mine" : "", lead ? "is-lead" : ""].join(" ").trim()}>
                    <div className="tr-option-top">
                      <span className="tr-option-name">
                        <b>{o.label.replace(/\s+\d+\s*\/\s*\d+\s*\/\s*\d+$/, "")}</b>
                        {o.targets ? <small>{`${staking(o.targets) / 100} % staked · ${o.targets.stable / 100} % stables · ${o.targets.near / 100} % reserve`}</small> : null}
                      </span>
                      <span className="tr-option-tags">
                        {o.recommended ? (
                          <span className="tr-tag" title="Gets one automatic vote, so it wins when nobody votes">
                            <Star size={14} weight="fill" aria-hidden="true" /> Recommended
                          </span>
                        ) : null}
                        {view.adopted?.option === o.option ? <span className="tr-tag tr-tag-live">In force</span> : null}
                      </span>
                    </div>
                    {o.targets ? <MixStrip t={o.targets} /> : null}
                    <div className="tr-option-bottom">
                      <span className="tr-tally" aria-hidden="true">
                        <span style={{ width: `${(o.approvals / most) * 100}%` }} />
                      </span>
                      <span className="tr-option-count">
                        {o.approvals} {o.approvals === 1 ? "vote" : "votes"} · {share} %
                      </span>
                      {member && account ? (
                        <button
                          type="button"
                          className={o.mine ? "tr-vote-btn voted" : "tr-vote-btn"}
                          aria-pressed={!!o.mine}
                          aria-label={`Vote for ${o.label}`}
                          disabled={busy !== null || !p.open || voted}
                          onClick={() => void cast(p, o)}
                        >
                          {o.mine ? (
                            <>
                              <CheckCircle size={18} weight="fill" aria-hidden="true" /> Voted
                            </>
                          ) : busy === o.proposalId ? (
                            "Signing…"
                          ) : (
                            "Vote"
                          )}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {note ? (
        <p className={note.bad ? "tr-vote-note bad" : "tr-vote-note"} role="status">
          {note.text}
        </p>
      ) : null}
      <p className="eco-small eco-muted">
        <span className="tr-legend-inline">
          <i className="tr-c1" /> staked NEAR <i className="tr-c2" /> stablecoins <i className="tr-c3" /> NEAR reserve
        </span>
      </p>
    </div>
  );
}

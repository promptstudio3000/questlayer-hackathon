// Community → "Tomorrow's creator bonus": explorers who played this week pick
// up to a few community quests whose creators share tomorrow's bonus.
// Server: server/creators/bonus-vote.mjs. The panel stays hidden on hosts
// where the vote or creator quests are not enabled.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Star, Trophy } from "@phosphor-icons/react";
import { api, ApiError } from "./api";

export type BonusCandidate = {
  questId: string;
  title: string | null;
  votes: number;
  mine: boolean;
  own: boolean;
};
export type BonusBallot = {
  day: string;
  closesAt: number;
  eligible: boolean;
  reason: "ACCOUNT_NOT_READY" | "NOT_ACTIVE" | null;
  votesLeft: number;
  policy: { votesPerExplorer: number; winners: number };
  candidates: BonusCandidate[];
  today: { winners: string[]; gated: boolean } | null;
};

const HIDDEN_CODES = new Set(["BONUS_VOTE_DISABLED", "CREATORS_DISABLED"]);

export function bonusVoteReason(ballot: BonusBallot): string | null {
  if (ballot.eligible) return null;
  return ballot.reason === "ACCOUNT_NOT_READY"
    ? "Your explorer profile is still being set up. You can vote in a moment."
    : "Play this week to vote: pick up a coin or join a community quest.";
}

export function closesLabel(closesAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.ceil((closesAt - now) / 60000));
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h > 0
    ? `Voting closes in ${h} h ${m} min`
    : `Voting closes in ${m} min`;
}

export function CommunityBonusVote({
  playerId,
  notify,
}: {
  playerId: string;
  notify?: (message: string, error?: boolean) => void;
}) {
  const [ballot, setBallot] = useState<BonusBallot | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBallot(await api<BonusBallot>("/creators/bonus-vote"));
    } catch (error) {
      if (error instanceof ApiError && HIDDEN_CODES.has(error.code || ""))
        setHidden(true);
    }
  }, []);
  useEffect(() => {
    setBallot(null);
    setHidden(false);
    void load();
  }, [playerId, load]);

  if (hidden || !ballot) return null;
  const titles = new Map(
    ballot.candidates.map((c) => [c.questId, c.title || "Community quest"]),
  );
  const winners = ballot.today?.gated ? ballot.today.winners : [];
  const reason = bonusVoteReason(ballot);

  async function toggle(c: BonusCandidate) {
    setBusy(c.questId);
    try {
      const next = await api<BonusBallot>("/creators/bonus-vote", {
        questId: c.questId,
        ...(c.mine ? { action: "unvote" } : {}),
      });
      setBallot(next);
      notify?.(
        c.mine
          ? "Vote taken back."
          : `Voted for ${c.title || "this quest"}. ${next.votesLeft} left.`,
      );
    } catch (error) {
      notify?.(
        error instanceof Error ? error.message : "Could not save your vote.",
        true,
      );
      void load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bonus-vote" aria-labelledby="bonus-vote-title">
      <h2 id="bonus-vote-title">
        <Trophy size={24} aria-hidden /> Tomorrow's creator bonus
      </h2>
      <p>
        Pick up to {ballot.policy.votesPerExplorer} community quests you
        enjoyed. The top {ballot.policy.winners} share tomorrow's creator bonus.
      </p>
      <p className="bonus-vote-meta">
        <span>{closesLabel(ballot.closesAt)}</span>
        {ballot.eligible && (
          <span aria-live="polite">
            {ballot.votesLeft} of {ballot.policy.votesPerExplorer} votes left
          </span>
        )}
      </p>
      {reason && <p className="bonus-vote-note">{reason}</p>}
      {winners.length > 0 && (
        <p className="bonus-vote-winners">
          <Star size={18} weight="fill" aria-hidden /> Today's bonus quests:{" "}
          {winners.map((id) => titles.get(id) || "Community quest").join(", ")}
        </p>
      )}
      {ballot.candidates.length === 0 ? (
        <p className="bonus-vote-note">
          No community quests to vote on yet. Check back once creators publish
          one.
        </p>
      ) : (
        <ul className="bonus-vote-list">
          {ballot.candidates.map((c) => {
            const label = c.title || "Community quest";
            const disabled =
              busy !== null ||
              c.own ||
              !ballot.eligible ||
              (!c.mine && ballot.votesLeft === 0);
            return (
              <li key={c.questId} className={c.mine ? "is-mine" : undefined}>
                <span className="bonus-vote-title">
                  <b>{label}</b>
                  <small>
                    {c.votes === 1 ? "1 vote" : `${c.votes} votes`}
                    {c.own ? " · Your quest" : ""}
                  </small>
                </span>
                {!c.own && (
                  <button
                    type="button"
                    className={
                      c.mine ? "bonus-vote-button voted" : "bonus-vote-button"
                    }
                    aria-pressed={c.mine}
                    aria-label={
                      c.mine
                        ? `Take back vote for ${label}`
                        : `Vote for ${label}`
                    }
                    disabled={disabled}
                    onClick={() => void toggle(c)}
                  >
                    {c.mine ? (
                      <>
                        <CheckCircle size={18} weight="fill" aria-hidden />{" "}
                        Voted
                      </>
                    ) : (
                      "Vote"
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

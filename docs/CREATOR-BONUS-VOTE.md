# Community vote on the daily creator bonus (W08, testnet pilot)

Active explorers choose which community quests earn the next UTC day's creator
round ("daily creator bonus"). Module: `server/creators/bonus-vote.mjs`
(schema module `creator-bonus-vote` v1, created lazily on first use).

## Rules

- **Who votes:** a player with a verified NEAR account (`wallet_links`) and real
  play in the last `CREATOR_BONUS_ACTIVE_DAYS` (default 7): a non-welcome history
  event, a claimed coin or a creator-quest participation.
- **What:** published creator quests that moderation has not hidden. Never your
  own quest. Up to `CREATOR_BONUS_VOTES_PER_EXPLORER` (default 3) votes per
  ballot, one per quest; a vote can be taken back until the ballot closes.
- **When:** during UTC day D-1 the ballot for day D is open. It closes at
  00:00 UTC on D and is tallied once; the stored tally is final.
- **Winners:** the top `CREATOR_BONUS_WINNERS` (default 3) quests; ties go to the
  quest that reached its count first. Fewer than `CREATOR_BONUS_MIN_VOTERS`
  (default 1) distinct voters means no winners.

## Effect on creator money

While day D's round is open on chain, the creator-money publisher records likes
and completions only for D's winners. Support for other quests stays queued
(`last_error` says "Held") and is retried at the next UTC midnight, so it lands
in a round where its quest wins, or in a day without a vote (which gates
nothing). The contract counts each player's support once, so nothing is lost.
Gating follows the round open on chain, so a held like never leaks into
yesterday's round while it is still being finalized.

## API

- `GET /api/creators/bonus-vote` → ballot: `day`, `closesAt`, `eligible`,
  `reason` (`ACCOUNT_NOT_READY` | `NOT_ACTIVE`), `votesLeft`, `candidates[]`
  (`questId`, `title`, `votes`, `mine`, `own`), `today` (today's result).
- `POST /api/creators/bonus-vote` `{ questId, action?: "unvote" }`.
- `GET /api/native/creators` includes `bonusVote` (today's result).

## Limits

Server-side policy only: the creators contract cannot verify the tally, so this
is an operator-trusted testnet pilot. Mainnet hosts never mount it
(constructor refuses `mainnet`). `CREATOR_BONUS_VOTE=0` turns it off on
testnet. Player UI: Community tab → "Tomorrow's creator bonus" (`src/CommunityBonusVote.tsx`, lazy chunk), checked by `npm run e2e:bonus-vote`.

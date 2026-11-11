# Treasury dashboard (/treasury)

A public page that shows where the game's money sits, how it earns and how
that yield becomes coins on the map, and where explorers vote on the weekly
treasury mix. English only (like /economy), reading needs no sign-in, its own lazy chunk (`src/economy/TreasuryPage.tsx`), so the game's
first screen does not grow.

## Data

Read in parallel, each section degrades on its own when an endpoint is off:

| Endpoint | Used for |
|---|---|
| `GET /api/treasury/mix` | total, 50/40/10 mix now vs target, protocol exposure vs the 40 % cap, next run |
| `GET /api/economy/ledger` | prize pool funded/paid, realized yield, stNEAR growth, daily budget by date (yield vs treasury), audit checks, trade fees |
| `GET /api/economy/qgold` | vault backing, R and its history, buy/sell price, Rhea pool, keeper ask ladder, exit caps, fees table |
| `GET /api/map/rewards/day` | today's map split by formula component (votes 50, demand 20, random 15, potential 10, stake 5), cells, pioneer reserve |

## Layout (11 Nov 2026: hero card + tabs)

The page is short first. On top a hero card shows the one number that matters
(NEAR held in the treasury, USD, a strip of the current mix) and three small
stats (QGOLD backing, R, yield earned). Below it sticky tabs split the rest so
each topic is its own screen. The tab is kept in the URL hash (`#vote`,
`#flow` …); old anchors still work (`#dao` and `#tr-dao` open Vote, `#tr-mix`
Overview, `#tr-budget` Money flow, `#tr-fees` QGOLD, `#tr-safety` Safety).

1. **Overview**: the TL;DR as four icon rows, a "This week's vote is open"
   card that jumps to Vote, the mix donut (outer ring now, inner ring target)
   with one row per bucket and the next run, and today's map tiles.
2. **Vote**: the weekly treasury mix vote, playable on this page
   (`src/economy/TreasuryVoteCard.tsx`). Each option shows its mix strip,
   votes and share, Recommended and In force tags. A browser with a game
   session and a ready explorer account in the Explorers role votes right here:
   `act_proposal(VoteApprove)` signed by the explorer's device key, sponsored,
   no wallet popup. Others see why they cannot vote yet (sign in, first find,
   level 3 + played this week). Below it "Who decides": mix in force, today's
   run, explorer voters, council, the three steps, the decision log.
3. **Money flow**: animated diagram (tap a box), step list, daily budget bars
   (from yield vs from the treasury) and today's formula split.
4. **QGOLD**: R, supply, burns, pool, R and pool price over time, prices
   around R, exit meter, fees table, vault fees and insurance.
5. **Model**: the simulator (`simulate()` in `src/economy/treasury-model.ts`).
6. **Safety**: safety rules, exposure per protocol vs the 40 % cap, prize pool
   funded, insurance fund and the live prize pool audit.

The vote card reads `GET /api/me`, `GET /api/account` and
`GET /api/treasury/dao?account=` for the viewer; the page itself reads only the
public endpoints above plus `GET /api/treasury/dao`.

## Rules

- Never mention the hackathon or judges on the page; QGOLD is a game currency,
  not an investment (tests/treasury-page.test.mjs enforces copy and endpoints).
- Charts are inline SVG drawn at their real width; no chart library.

## Who decides (11 Nov 2026)

The Vote tab (`#vote`, old `#dao`) reads `GET /api/treasury/dao`: the Sputnik DAO account, council size and threshold, Explorer voters,
the mix in force, today's run, this week's mix vote with approvals per option, extra votes and the decision log
([TREASURY-DAO.md](TREASURY-DAO.md)).


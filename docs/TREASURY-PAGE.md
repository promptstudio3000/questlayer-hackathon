# Treasury dashboard (/treasury)

A public page that shows where the game's money sits, how it earns and how
that yield becomes coins on the map, and where explorers vote on the weekly
treasury mix. English only (like /economy), reading needs no sign-in, its own lazy chunk (`src/economy/TreasuryPage.tsx`), so the game's
first screen does not grow.

## Data

Read in parallel, each section degrades on its own when an endpoint is off:

| Endpoint | Used for |
|---|---|
| `GET /api/treasury/mix` | total, mix now vs the DAO target (staked / stables / reserve), protocol exposure vs the 40 % cap, next run |
| `GET /api/economy/ledger` | prize pool funded/paid, realized yield, stNEAR growth, daily budget by date (yield vs treasury), audit checks, trade fees |
| `GET /api/economy/qgold` | vault backing, R and its history, buy/sell price, Rhea pool, keeper ask ladder, exit caps, fees table |
| `GET /api/map/rewards/day` | today's map split by formula component (votes 50, demand 20, random 15, potential 10, stake 5), cells, pioneer reserve |

## Layout (11 Nov 2026, second pass: on-chain pots, swap, FAQ)

The page is short first and every number can be checked by a click.

- **Headline** (`Pots` in `src/economy/TreasuryExplain.tsx`): the sum of the
  three on-chain accounts that hold the game's NEAR, each a row linked to the
  NEAR explorer: the treasury (`/api/treasury/mix` total, operator account),
  the prize pool (rewards contract, ledger `treasury.liquid`) and the QGOLD
  vault (`vault.backing`). A strip shows their sizes.
- **Three stats** with an "i" button each: the treasury's blended yearly rate
  (staked NEAR at `STAKING_APR` per network, an estimate: testnet 9.5 % = about
  9.8 % gross validator rate less a 3 % pool fee; stablecoins at Rhea's live
  supply rate; liquid staking 0 on testnet because its price is frozen), the
  yield per day at that rate, and R.
- **Swap card** (`src/economy/QgoldExchange.tsx`, also on /economy): buy QGOLD
  at R + 1 % or sell at R − 1 % (instant or queued), the player's balance from
  `GET /api/qgold/account`, signed with the game key on this device. Purple
  buttons always use white text (`--on-action`). Desktop: beside the headline;
  phone: under the stats.
- Info buttons (`InfoTip`) explain a number in place; Escape or a tap outside
  closes them.

Below it sticky tabs split the rest so
each topic is its own screen. The tab is kept in the URL hash (`#vote`,
`#flow` …); old anchors still work (`#dao` and `#tr-dao` open Vote, `#tr-mix`
Overview, `#tr-budget` Money flow, `#tr-fees` QGOLD, `#tr-safety` Safety).

1. **Overview**: an animated four-step loop (treasury → daily yield → QGOLD →
   spent and burned), a "This week's vote is open" card that jumps to Vote,
   **Where the treasury is heading** (12-month projection at today's rate: the
   treasury stays, the yield band grows; straight line, labelled an estimate),
   the mix donut (outer ring now, inner ring target) with one row per bucket
   and the next run, the **treasury history**, the **How it works** FAQ
   accordion (what the treasury is, what pays the map, what backs QGOLD, why
   stablecoins, why burns raise R, swapping back, who decides, how to check
   it, with explorer links) and today's map tiles.
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


## Treasury history (11 Nov 2026)

`GET /api/treasury/history?days=90` returns `{ buckets, points: [{ day, at,
total, buckets: { staked, lst, stable, near }, source }] }`, oldest first, yocto
strings. `server/native/treasury-history.mjs` keeps one row per UTC day in the
`treasury_history` table: every live read of the treasury mix (the endpoint,
the page, an hourly timer) stores the newest view of the day. Days before the
recorder existed are seeded from the public records (`stnear-treasury` first
deposit, each `treasury-mix` run's before and after). Totals only, no player
data.

The public history starts on 1 Nov 2026: 31 Oct was a one-off pilot test
(owner, 11 Nov). `treasury-history` drops earlier days and the public ledger
(`publishedDays`, `confirmedPayouts` in `server/native/public-ledger.mjs`)
lists days and claims from `PUBLIC_HISTORY_START` on; on-chain totals are
unchanged.

## Plain names (12 Nov 2026)

The page never shows a bare "R": it says **backing per QGOLD** (vault NEAR ÷
QGOLD supply). Names that still need a word of context (validator, liquid
staking tokens, stablecoins, Rhea / Rhea Lend, NEAR reserve, keeper, council,
Sputnik DAO, insurance fund, utilization) carry an info button with the
explanation from `GLOSSARY` in `src/economy/TreasuryExplain.tsx` (`Term`,
`InfoTip`).

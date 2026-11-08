# Treasury dashboard (/treasury)

A public, read-only page that shows where the game's money sits, how it earns
and how that yield becomes coins on the map. English only (like /economy), no
sign-in, its own lazy chunk (`src/economy/TreasuryPage.tsx`), so the game's
first screen does not grow.

## Data

Read in parallel, each section degrades on its own when an endpoint is off:

| Endpoint | Used for |
|---|---|
| `GET /api/treasury/mix` | total, 50/40/10 mix now vs target, protocol exposure vs the 40 % cap, next run |
| `GET /api/economy/ledger` | prize pool funded/paid, realized yield, stNEAR growth, daily budget by date (yield vs treasury), audit checks, trade fees |
| `GET /api/economy/qgold` | vault backing, R and its history, buy/sell price, Rhea pool, keeper ask ladder, exit caps, fees table |
| `GET /api/map/rewards/day` | today's map split by formula component (votes 50, demand 20, random 15, potential 10, stake 5), cells, pioneer reserve |

## Sections

1. Headline tiles: treasury, prize pool, QGOLD backing, R, insurance fund, realized yield.
2. Money flow: animated diagram (fees → treasury → yield → daily budget → QGOLD
   vault → players → burns/fees, plus insurance and Rhea pool). Tap a box to
   highlight its flows and read what it does. On phones it becomes a step list.
   Animation stops under `prefers-reduced-motion`.
3. Treasury mix donut (outer ring now, inner ring target) and exposure bars.
4. Daily map budget bars (from yield vs from the treasury) with a table view,
   and today's formula split (outline = weight, fill = effective share after
   unused shares are redistributed; votes show "voting not open yet" until
   stream 7 ships).
5. QGOLD backing: R and pool price over time, prices around R, instant exit meter.
6. Model: sliders for treasury size, mix, yields, fees per day and in-game burn
   rate; `simulate()` in `src/economy/treasury-model.ts` follows the approved
   rules (only yield is spent, principal stays, fees keep 90 % in the treasury
   and 10 % in insurance, mints carry their NEAR so R never falls, burns raise R).
7. Fees table and safety rules with the live prize pool audit.

## Rules

- Never mention the hackathon or judges on the page; QGOLD is a game currency,
  not an investment (tests/treasury-page.test.mjs enforces copy and endpoints).
- Charts are inline SVG drawn at their real width; no chart library.

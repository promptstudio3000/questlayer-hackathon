# Keeper's inner vault (GAME-LOOPS P0-3)

The Keeper NPC (`strazce-brany`) now gives a staker something to see and look forward to. It only reads vault
state; it never signs, moves funds or changes a chance. Code: `server/npc/keeper-vault.mjs`,
`src/StakeToday.tsx`; tests: `tests/keeper-vault.test.mjs`.

## What the player sees

- **Your stake today** (Keeper sheet and Fuel the city / Profile → Stake): GOLD kept for you and given to the city
  since the Keeper's last reading before today (or its first reading today), plus what is still growing in the pool.
  If today's coins are yield-funded, the card says how many of today's coins your realized city payments equal in
  value. That is attribution only: the coins stay shared and first come, first served.
- **E+2 countdown** in real epochs. The vault contract counts a deposit toward tier only from the second epoch after
  it, but does not expose tranche epochs. The Keeper records the epoch it first saw a new, not-yet-mature deposit and
  shows "matures by epoch X at the latest". At 0 % city share a stake never counts toward tier; the card says so.
- **Ceremonies**: one-time cards when a deposit matures and when the account reaches Tier 2 or Tier 3. The first
  tier ceremony gives the cosmetic patron title, which stays after a withdrawal (no decay, D29).
- **Inner vault**: patron story chapters, gated by tier (default Tier 2; owner decision 1 Nov: tier only, an optional level gate is configurable). Locked players see
  the chapter titles and what is missing. Lures are things to read or wear, never odds, payouts or multipliers.

- **Patron rank 1–5** (GAME-LOOPS P1-2, `server/npc/patron-rank.mjs`): grows by one for every epoch the player
  spends at the patron tier (default Tier 2) on matured, unwithdrawn stake. Depositing more does not speed it up;
  holding does. Default ladder: Spark 1, Ember 4, Lantern 14, Beacon 28, Hearthfire 60 epochs (12 h each, so about
  0.5, 2, 7, 14 and 30 days). No decay or streak penalty (D29): an exit only pauses growth, the rank stays. The Keeper
  reads vaults when the card opens, so epochs between two readings are credited when both readings were at patron
  tier and the weighted stake did not shrink (a shrink or a pause credits only the current epoch; one gap is capped
  at `KEEPER_RANK_GAP_MAX`). A one-time rank-up ceremony shows the highest new rank. Cosmetic only: it never
  changes odds, payouts, damage or tiers.

## API

- `POST /api/actors/:id/keeper {encounter}`: the old lines plus `stake` (the card, ceremonies, inner vault).
- `GET /api/keeper/stake`: the same card without the market lines (no encounter needed).
- `POST /api/keeper/ceremonies/:id/seen`: closes a ceremony.
- `POST /api/keeper/rank/:rank/seen`: closes the patron rank-up ceremony. The card carries `rank` (rank, name,
  epochs, growing, next, ladder, rankUp).

## Settings (all optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `KEEPER_VAULT_ENABLED` | on | `0` turns the card, ceremonies and inner vault off |
| `KEEPER_INNER_TIER` | `2` | Tier needed for the inner vault (1–3) |
| `KEEPER_INNER_LEVEL` | `1` | Optional level gate for the inner vault (1 = none) |
| `KEEPER_MATURITY_EPOCHS` | `2` | Epochs shown in the countdown (mirror of the contract rule) |
| `KEEPER_EPOCH_HOURS` | `12` | Hours per epoch for the time estimate |
| `KEEPER_PATRON_TITLE` | `Patron of the Gate` | Cosmetic title from the first tier ceremony |
| `KEEPER_CEREMONIES` | on | `0` stops new ceremonies |
| `KEEPER_INNER_PATH` | built-in | JSON file `[{title, text}]` (max 12) replacing the chapters |
| `KEEPER_TIMEZONE` | `Europe/Prague` | Day boundary for "today" |
| `KEEPER_RANK_ENABLED` | on | `0` turns the patron rank off |
| `KEEPER_RANK_EPOCHS` | `1,4,14,28,60` | Patron epochs for ranks 1–5 (five rising integers) |
| `KEEPER_RANK_NAMES` | `Spark,Ember,Lantern,Beacon,Hearthfire` | Five rank names (max 24 chars each) |
| `KEEPER_RANK_TIER` | `2` | Tier at which an epoch counts toward the rank |
| `KEEPER_RANK_GAP_MAX` | `14` | Most epochs credited for one gap between readings |

Tables (`keeper-vault` schema module) appear on the first Keeper visit: `keeper_vault_watch`,
`keeper_stake_days`, `keeper_ceremonies`; the `keeper-patron-rank` module adds `keeper_patron_rank` and
`keeper_patron_rank_ups`.

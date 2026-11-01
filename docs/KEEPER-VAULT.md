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

## API

- `POST /api/actors/:id/keeper {encounter}`: the old lines plus `stake` (the card, ceremonies, inner vault).
- `GET /api/keeper/stake`: the same card without the market lines (no encounter needed).
- `POST /api/keeper/ceremonies/:id/seen`: closes a ceremony.

## Settings (all optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `KEEPER_VAULT_ENABLED` | on | `0` turns the card, ceremonies and inner vault off |
| `STAKER_GATES_JSON` | table | The inner vault and stake-today gates (`keeper_inner`, `stake_today`, default Staker + L2) live in `server/data/staker-gates.json`; `KEEPER_INNER_TIER`/`KEEPER_INNER_LEVEL` are no longer read |
| `STAKER_MIN_NEAR` | `2` | Matured stake that makes a player a Staker (patron rank 0) |
| `NEAR_PRICE_EUR` / `NEAR_PRICE_FEED` | feed | Reference price for "~5 €" labels; `off` shows NEAR only |
| `KEEPER_MATURITY_EPOCHS` | `2` | Epochs shown in the countdown (mirror of the contract rule) |
| `KEEPER_EPOCH_HOURS` | `12` | Hours per epoch for the time estimate |
| `KEEPER_PATRON_TITLE` | `Patron of the Gate` | Cosmetic title from the first tier ceremony |
| `KEEPER_CEREMONIES` | on | `0` stops new ceremonies |
| `KEEPER_INNER_PATH` | built-in | JSON file `[{title, text}]` (max 12) replacing the chapters |
| `KEEPER_TIMEZONE` | `Europe/Prague` | Day boundary for "today" |

Tables (`keeper-vault` schema module) appear on the first Keeper visit: `keeper_vault_watch`,
`keeper_stake_days`, `keeper_ceremonies`.

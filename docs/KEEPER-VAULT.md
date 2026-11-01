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
| `KEEPER_INNER_TIER` | `2` | Tier needed for the inner vault (1–3) |
| `KEEPER_INNER_LEVEL` | `1` | Optional level gate for the inner vault (1 = none) |
| `KEEPER_MATURITY_EPOCHS` | `2` | Epochs shown in the countdown (mirror of the contract rule) |
| `KEEPER_EPOCH_HOURS` | `12` | Hours per epoch for the time estimate |
| `KEEPER_PATRON_TITLE` | `Patron of the Gate` | Cosmetic title from the first tier ceremony |
| `KEEPER_CEREMONIES` | on | `0` stops new ceremonies |
| `KEEPER_INNER_PATH` | built-in | JSON file `[{title, text}]` (max 12) replacing the chapters |
| `KEEPER_TIMEZONE` | `Europe/Prague` | Day boundary for "today" |

Tables (`keeper-vault` schema module) appear on the first Keeper visit: `keeper_vault_watch`,
`keeper_stake_days`, `keeper_ceremonies`.

## Patron quest lines (GAME-LOOPS P1-1)

Code: `server/npc/patron-path.mjs`, `server/npc/offers.mjs`; tests: `tests/patron-path.test.mjs`.

- A player whose matured stake reaches **Tier 2** (tier only, no level gate) gets one **patron walk** per day from each
  quest giver: two stops that end in a Tier 2+ zone. Each storyteller offers one **patron chapter** per day, set in a
  Tier 2+ zone. Both sit outside the regular daily caps and outside the storyteller's chapter sets.
- They pay the same XP as any line (20 per stop + 10, chapters 15), the walk's Aura from the ordinary chest
  entitlement, and the stops pay their zone's ordinary prize. No bonus XP, odds or payouts.
- Each turned-in patron line is a step on the **Patron's Path** (3 steps, counted across all NPCs). Each step reveals
  the next chapter of the patron story; the third earns the NPC-only **patron edition** Aura once per player.
- The edition joins the catalog with the next shared collectibles upgrade. Until then the path still counts, and a
  player who already finished it gets the Aura on their next patron line after the upgrade.
- The Keeper's inner vault shows the path (`inner.path`: done/of, revealed story, edition) to everyone, locked or not.
  Progress and the edition stay after a withdrawal (D29).
- Free players keep seeing the greyed "Patron walk" / "Patron chapter" chips (P0-2).

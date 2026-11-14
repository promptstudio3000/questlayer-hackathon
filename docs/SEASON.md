# Hackathon season

GAME-LOOPS P1-3 (owner decision 1 Nov 2026, settled in no-ask mode): a two-week season frame
until **30 Nov 2026 23:59:59 UTC** (extended 14 Nov 2026; players see it as "Season of First Light") with a cosmetic leaderboard, a season mark and Aura for everyone
who reaches the goal, and a meter of the reward pot that funded the season.

## Rules

- **Counts only play:** hunts (monster wins and landed weekly-boss hits), zone visits (distinct zones
  reached, demo `quest_progress`/`quest_claims` or native `native_progress` of an enrolled account) and
  NPC lines (quest-giver lines and storyteller chapters turned in). Never GOLD, NEAR, stake, trades or
  purchases.
- **Points:** hunt 1, visit 2, NPC line 3 (`SEASON_POINTS`). Goal 30 points (`SEASON_GOAL`).
- **Cosmetic ranks:** Explorer (any points), Season finisher (goal), Trailblazer (2× goal), Season legend
  (3× goal). A rank changes how the row looks and nothing else: no XP, GOLD, odds, damage or payout.
- **No streak, no decay.** Missing days costs nothing.
- **Season mark:** `POST /api/season/claim` once the goal is reached, until the season ends. It writes a
  `season_finishers` row and a history entry, and awards the season Aura (catalog `source: "season"`,
  id from `SEASON_AURA`, default `season`) once that edition ships. Finishers who claimed earlier collect
  the Aura with the same call. The Aura goes through the shared once-per-player ledger
  (`earned_editions`).
- **Frozen after the end:** standings only count rows created inside the window, so the final board stays
  as it was at 23:59:59 UTC.
- **Public data:** the leaderboard shows display names, points, counts and titles, never player ids.

## Season pot meter

The meter sums the budgets (coin units × coins + zone prizes) of reward days **published on NEAR** whose
day falls inside the season, split by funding source (`realized_yield` vs sponsor). Trader sweeps into
the rewards treasury are shown next to it but not added, because swept NEAR only reaches players through
later published days and would otherwise be counted twice. Days quarantined as `foreign`
(`native_day_contracts`, PR #81) are excluded when that table exists. The target is
`SEASON_POT_TARGET_NEAR` (default 1 NEAR, shown in GOLD).

## API

| Route | Auth | Returns |
| --- | --- | --- |
| `GET /api/season` | optional | phase, window, goal, points, top 20, your row when signed in, pot meter |
| `POST /api/season/claim` | required | the same view after recording the mark (idempotent) |

`/api/health` shows `season: {status, id, phase, endsAt, goal, aura}`.

## Settings

| Variable | Default |
| --- | --- |
| `SEASON` | on, except mainnet (off) |
| `SEASON_ID` | `hackathon-2026` (never reuse) |
| `SEASON_NAME` | `Season of First Light` |
| `SEASON_STARTS_AT` / `SEASON_ENDS_AT` | `2026-11-01T00:00:00Z` / `2026-11-30T23:59:59Z` |
| `SEASON_GOAL` | 30 |
| `SEASON_POINTS` | `hunt:1,visit:2,line:3` |
| `SEASON_POT_TARGET_NEAR` | 1 |
| `SEASON_AURA` | `season` |

## Season Aura (next step)

The edition row (catalog, art, `contracts/collectibles` AURA_EDITIONS + CLAIM_ONLY_EDITIONS with the
`earned:season:` prefix) lands in a follow-up on top of the L5–L10 editions (PR #82) and ships in **one
shared collectibles upgrade** with the patron edition: Docker WASM build, `contracts/wasm-sha256.json`,
re-review in docs/COLLECTIBLES-REVIEW.md, then the testnet code upgrade (N5 process). Until then the
season mark is recorded and the Aura is collected later with the same claim.

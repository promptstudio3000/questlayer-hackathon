# Daily board of three goals

Game-loop proposal P0-5 (`docs/GAME-LOOPS.md`): every session gets a target. The
board shows three small goals picked from today's world. Finishing all of them pays
a small XP bonus once per world day. **No streak, no penalty**: skipping a day
costs nothing and nothing carries over (rule D29: not energy, not a streak).

## Player view

- Top bar chip `0/3` next to GOLD. It turns green when every goal is done.
- Tapping it opens "Today's board": the goals with progress bars, the bonus, how
  many explorers finished today and when the next board starts (local midnight of
  the world, `manifest.endsAt`).
- "Claim +50 XP" appears when all goals are done. The bonus is paid once per world
  day and shows in history as "Today's board complete".

## Goals

Progress is read from rows the game already writes, so the board cannot pay for
something that did not happen and needs no hooks in other features.

| Kind | Counts | Needs |
| --- | --- | --- |
| `coins` | coins collected on today's worlds (practice and GPS) | always |
| `finds` | street finds among those coins | always |
| `quest` | quests finished on today's worlds | quests in today's world |
| `monster` | monster wins today (`monster_rewards` `win:*`) | actors on |
| `npc` | different NPCs talked to or tasks taken today | actors on |
| `boss` | landed hits on the weekly boss today | actors on |

The board takes the preferred goals in order and skips any that cannot be played
today (for example monsters when actors are off), then tops up from the fallback
list. A claimed board keeps the goals it was claimed with.

Coins collected in NEAR play (on-chain pickups) are not counted yet; monsters and
NPCs count in both modes.

## Settings (runtime environment)

Every default can change without a code release.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DAILY_BOARD` | on (testnet), off (mainnet) | `0` off, `1` on |
| `DAILY_BOARD_GOALS` | `coins:10,monster:1,npc:1` | preferred goals, `kind:target` |
| `DAILY_BOARD_FALLBACK` | `finds:2,quest:1,coins:20` | used when a preferred goal can't be played |
| `DAILY_BOARD_SIZE` | `3` | goals on the board, 1–5 |
| `DAILY_BOARD_BONUS_XP` | `50` | bonus for a full board, 0–1000 |

Invalid values stop the server at start with a clear message. `/api/health`
reports `dailyBoard` with the active settings.

## API

- `GET /api/daily-board?worldId=` → goals, progress, `complete`, `claimed`,
  `bonusXp`, `finishedToday`, `resetsAt`, `streak: false`.
- `POST /api/daily-board/claim {worldId}` → pays the bonus once (409
  `BOARD_INCOMPLETE` until every goal is done; a repeat returns `alreadyClaimed`).

Storage: schema module `daily-board` v1, table `daily_board_claims` (one row per
explorer and world day).

## Test world (`TEST_SEED=1`)

Seed explorers Vera, Tomas and Jana finish the board 7, 11 and 16 hours into every
world day, so "explorers finished today" grows during the day. They get no XP.
`TEST_SEED` also turns monsters and NPCs on, so the default three goals are
playable. Removing the seed deletes their rows with the rest of `seed-*`.

Covered by `tests/daily-board.test.mjs`.

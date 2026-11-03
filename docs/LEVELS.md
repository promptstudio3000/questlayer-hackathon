# Levels to L10 (GAME-LOOPS P0-1)

Source of truth: `server/data/level-table.json`, read by the server (`server/levels.mjs`) and the client
(`src/levels.ts`, refreshed from `GET /api/levels`). The curve is unchanged: level n starts at 100·(n−1)² XP.
Every level unlocks one thing to do or wear. Nothing in the table changes odds, damage, GOLD or payouts.

| Level | XP | Unlock | State |
| --- | --- | --- | --- |
| 1 | 0 | Free zones, street coins, monsters, NPC talk | live |
| 2 | 100 | Northern Lights Aura | live (native claim) |
| 3 | 400 | Moonwake Aura | live (native claim) |
| 4 | 900 | Sunlit Aura | live (native claim) |
| 5 | 1,600 | Silver level ring (`value`: silver) | live |
| 6 | 2,500 | Second altar offering per day (`value`: 2) | live |
| 7 | 3,600 | One more quest line per NPC and day (`value`: +1) | live |
| 8 | 4,900 | One more storyteller chapter on offer (`value`: +1) | live |
| 9 | 6,400 | "Pathfinder" title on the profile (`value`) | live |
| 10 | 8,100 | Golden level ring (`value`: gold) | live |

Staker content opens by step AND level (owner decision 1 Nov 23:47 UTC, replacing "tier only"): Staker (2 NEAR
matured) + L2 opens the Keeper's inner vault, the stake today numbers and patron chapter 1; Staker + L4 the rest of
the patron line, the patron Aura and patron trader rates; Tier 2 + L6 the Tier 2 quest lines and the boss arena
seat; Tier 3 + L8 the wandering rare's patron option. These gates live in `server/data/staker-gates.json`
(`docs/GAME-LOOPS.md` §5), not in this level table, and change nothing about odds, damage or payouts.
`coming` entries (none by default) are shown as previews and do nothing until their feature ships (then flip `status` to `live`).

## Configuration

- `LEVEL_TABLE_FILE=/path/table.json` replaces the bundled table (same shape; validated at start, the server
  refuses a table off the XP curve, with gaps or unknown unlock kinds). Use it to change titles, values or status.
- `LEVEL_ITEM_EDITIONS=1` (set in the testnet unit `deploy/questlayer-hackathon.service`, never in the mainnet unit) turns on the level item editions (approved by the owner 1 Nov): L5 Silver Stride,
  L6 Altar Kindle, L7 Wayfarer's Compass, L8 Storyteller's Quill, L9 Pathfinder Laurel, L10 Summit Crown. Each is a
  level-only Aura (`earned:level:` claim, `CLAIM_ONLY_EDITIONS`), claimed like the L2–L4 Auras. Order: collectibles
  upgrade (`scripts/upgrade-collectibles-editions-testnet.mjs`), then the flag. Until the deployed contract lists an
  edition in `supported_editions`, its milestone shows as unavailable.

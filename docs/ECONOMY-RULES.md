# Economy rules (readable summary of the implemented numbers)

Updated 1 November 2026. One page that states every number the game economy uses today, where it lives in
code, and which numbers are versioned proposals rather than live behavior. Hackathon judges can read this
instead of the source; developers change the value here and in the pointed file together.

## Units

| Rule | Value | Source |
| --- | --- | --- |
| Display denomination | 1 NEAR = 1,000 GOLD; GOLD is not a token | `IMPLEMENTATION-PLAN.md` |
| Practice ledger integer unit | 1 GOLD = 1,000,000 micro-GOLD | `server/domain.mjs:3` |
| Native integer unit | yoctoNEAR (10^-24 NEAR), decimal strings only | `server/native/*.mjs` |

## Income and allocation

| Rule | Value | Source |
| --- | --- | --- |
| Income that may fund rewards | only realized, received, attributable yield or explicit sponsor funding | `contracts/rewards`, `docs/NATIVE-REWARDS-AND-VAULT.md` |
| Split of each eligible receipt | 50 % street coins / 50 % zones; odd unit to zones | `server/game.mjs` (`contracts/game` `fund_rewards` is retired on 10 November 2026) |
| Proposed creator share (not live) | 10 % creators, then 45 / 45 | `CREATOR-ECONOMY-PLAN.md` |
| Unclaimed backing after expiry | returns to the same bucket, never to players | `server/world.mjs`, rewards contract |

## Street coins

| Rule | Value | Source |
| --- | --- | --- |
| Coin value (practice) | 0.01 GOLD | `server/domain.mjs:4` |
| Backing before publication | every published coin is reserved from the coin bucket first | `server/world.mjs:160-175` |
| Claim | first valid collector wins; coin disappears for everyone; replays return the original receipt | `server/game.mjs`, `tests/game.test.mjs` |
| Native coin claim | server attests the visit, the reward worker relays `claim`; the player pays no gas | `server/native/reward-worker.mjs` |

## Zones and activities

| Rule | Value | Source |
| --- | --- | --- |
| Daily zones in Plzeň | 6 slots, 3 Free / 2 Tier 2 / 1 Tier 3, disjoint polygons | `docs/WORLD-GENERATION.md`, `server/world-planner.mjs` |
| Shared zone prize | With map rewards on (default): the cell's daily zone budget, split over Plzeň's reviewed zones in the cell or the cell's POI zones, paid out on chain (owner, 13 Nov 2026). Only with `MAP_REWARDS=off` the old practice prizes (Tier 3 5,000, Tier 2 1,000 GOLD) apply | `server/map-rewards/service.mjs`, `server/world.mjs` |
| Personal XP per activity | from the quest template (visit 50 XP; route and chest per template) | `server/quest-templates.mjs` |
| Shared prize vs personal XP | personal XP once per account; the shared prize pays once, to the first valid receipt | `docs/GAME-RULES.md` E14, E15 |
| Activity windows | all-day, three-hour and one-hour openings in one published schedule | `server/spatial/calendar.mjs` |

## Progression

| Rule | Value | Source |
| --- | --- | --- |
| Level curve | level n requires 100·(n−1)² XP (100, 400, 900 …) | `server/native/progression.mjs:8-27`, `src/App.tsx` HUD |
| Level rewards (native) | L2 Northern Lights (polar), L3 Moonwake (moon), L4 Sunlit (gold); each once per account | `server/native/progression.mjs` |
| Aura supply | capped per edition in the collectibles contract | `contracts/collectibles/src/lib.rs` |
| Progression ownership | account-bound; selling an avatar does not move XP | `docs/GAME-RULES.md` E18 |

## Access tiers and staking (pilot)

| Rule | Value | Source |
| --- | --- | --- |
| Tiers | Free < 50,000 GOLD; Tier 2 ≥ 50,000; Tier 3 ≥ 100,000 weighted stake | `server/domain.mjs:24` |
| Weight | stake × chosen contribution (0–100 % of yield) | `server/game.mjs`, vault pilot fixed per position |
| Maturity | deposit in epoch E, eligible E+2; practice uses 30 s | `server/game.mjs`, `contracts/vault` |
| Withdrawal | requestable any time; settles with pool liquidity (est. 1–7 days); practice uses 60 s | same |

## Practice-only numbers (never native defaults)

| Rule | Value | Source |
| --- | --- | --- |
| Welcome credit | none: a new explorer starts with 0 GOLD (the 120,000 practice faucet was removed 10 Nov 2026) | `server/database.mjs` `createPlayer` |
| Practice quest examples | 1,000 / 5,000 GOLD prizes | `server/world.mjs:179` |
| QA creator commitment | 200 XP, test fixtures only | `docs/CREATOR-INTEGRATION-2026-10-31.md` |

## Relayer sponsorship (E2, see `docs/RELAYER.md`)

Sponsored: account creation funding, gas for allowlisted calls, storage deposits for securing an Aura and the
public profile, within daily caps. Not sponsored: market purchases, transfers of NEAR, anything outside the allowlist.

## Proposals (not implemented)

- **Pay now with future yield**: open a paid creator quest before earning the GOLD by pledging the realized yield of
  your own staking position; principal stays locked until paid, at most about 10 years and 50 % of principal.
  Prizes stay backed only by received money. See `docs/YIELD-CREDIT-PROPOSAL.md`.

## Fast-forward for judges

`npm run funding:simulate` runs the treasury/exit model over several epochs and writes a trace under `output/`. A
UI "watch a week in a minute" page is planned under Profile → Advanced → Game economy (E3).

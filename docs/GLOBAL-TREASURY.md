# One global treasury and prize pool

Decision (Lubos, 2 Nov 2026): reward money and the treasury are **global**. Cities and places decide
*where* rewards appear on the map; they never own a budget, a pot or a share of yield. Per-city money
would strand funds in quiet cities and starve busy ones, and every new city would need its own funding.

## Audit: where city scoping lived

| Area | Before | Now |
| --- | --- | --- |
| Rewards contract treasury (`contracts/rewards`) | Already one treasury with two buckets (coins, zones); a per-date cap across all cities. | Unchanged. This is the global prize pool. |
| Vault yield (`contracts/vault`, factory) | Already paid to the one rewards contract (`game_paid`). Only the label said "city share". | Unchanged on chain; UI says "prize pool share". |
| stNEAR treasury (PR #100) | Harvests growth into the one rewards contract as `sponsor`. | Unchanged; one treasury, no city split. |
| Creator paid access (`contracts/creators`) | 20 % to one `treasury_receiver`. UI said "city reward pot". | UI says "global prize pool". |
| Sponsor funding (`fund_rewards`) | Global receipts. UI said "for the city". | UI says "the global prize pool". |
| Daily budget split (`server/native/allocation.mjs`) | Global budget split by **fixed operator weights** between `NATIVE_FUNDED_CITIES` (default: only the publisher's city). | Split by **player demand** between every live city (below). |
| Copy (How it works, Fuel the city, Stake today, Keeper) | "the city's prize pot", "fuels the city", "city share". | "the global prize pool", "Fuel the prize pool", "prize pool share". |

## Rules

1. **One pool.** All money that can become a reward (staking yield, stNEAR growth, sponsor receipts,
   the creator 20 % share) lands in the single rewards contract treasury
   (`questlayer-rewards-20261101b.testnet` on testnet). No contract, file or API keeps a per-city balance.
2. **One daily budget.** Each bucket's budget for a local date is `min(cap, available × NATIVE_DAILY_SHARE_BPS)`,
   with the existing per-date cap across all cities enforced on chain. Adding a city never adds money.
3. **Demand places it on the map.** `NATIVE_BUDGET_SPLIT=demand` (default): each eligible city weighs
   `1 + distinct players with a native claim there in the 7 local dates before the day`, capped at 1000.
   The window ends the day before, so a published day's split never moves. The floor of 1 keeps a new city
   visible; it is not a guaranteed budget.
4. **Nothing is stranded.** Integer rounding leftovers are never reserved, and coins or zone prizes nobody
   collects return to the same global `available` balance when `close_day` runs.
   In yield-backed mode the same holds for the yield budget: a closed day keeps only what its players were
   awarded (confirmed claims) against the realized yield, so the unclaimed part is free yield again.
5. **Eligibility.** By default every live city in `server/data/cities.json` is eligible.
   `NATIVE_FUNDED_CITIES` stays as an optional allowlist; its weights apply only with
   `NATIVE_BUDGET_SPLIT=weights` (the old fixed split, kept as an operator fallback).

6. **Yield-backed days drip.** With `NATIVE_YIELD_BACKED_DAYS=1` a city day may spend only realized
   staking yield (the vaults' `game_paid`), and only one drip of what is free: `free / NATIVE_YIELD_DRIP_DAYS`
   (default 7), split 50/50 into coins and zones. A vault settles its yield every few epochs, so without the
   drip the first day took everything and the following dates had nothing to publish (2026-11-07 was never
   published). Each coin gets `coin budget / coins` in whole yoctoNEAR; a date whose drip is smaller than one
   yocto per coin is not published and is listed in `/api/health` → `unfundedDays`. The testnet unit
   (`deploy/questlayer-hackathon.service`) sets the flag since 11 Nov 2026. The map-wide coin budget
   (`server/map-rewards/`) still follows the per-date cap, not the yield.

With one live city (Plzeň today) the result is byte-identical to before: it receives the full global
budget. The difference shows once a second city goes live.

## What the yield vault and stNEAR treasury must keep

- Pay into the one rewards contract via `fund_rewards`; no city id, city weights or per-city sub-balances
  in state, config or public records.
- Copy says "global prize pool" or "treasury", never "city pot".

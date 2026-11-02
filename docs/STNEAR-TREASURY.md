# Global treasury in stNEAR (testnet)

One global prize pool / treasury for the whole game, never split per city.
How the daily budget is shared between cities is decided later by
`server/native/allocation.mjs`, not here.

The sponsor treasury (the operator wallet `questlayer-dev-20261101.testnet`
that funds reward days) holds its capital as **stNEAR** from Meta Pool
(`meta-v2.pool.testnet`) instead of idle NEAR. stNEAR grows against NEAR every
epoch. Once a day a worker on the owner's Mac sells **only that growth** and
funds the rewards contract with it.

## How a day works

1. Read the stNEAR balance and `get_st_near_price`. Value = balance × price.
2. Growth = value − principal. The principal is the NEAR deposited (minus any
   withdrawals), kept in `.data/stnear-treasury.json`.
3. Skip when growth is under `STNEAR_MIN_HARVEST_NEAR` (default 0.01 NEAR;
   growth then waits for another day), when the instant-exit fee from
   `get_near_amount_sell_stnear` is above `STNEAR_MAX_FEE_BPS` (default 100 =
   1 %), when today's receipt already exists, or when "growth" is above
   `STNEAR_MAX_HARVEST_BPS` of the treasury (default 2 %, a guard against a
   lost principal record selling capital).
4. `liquid_unstake(st_near_to_burn = growth / price, min_expected_near = quote − 0.5 %)`.
   Shares round down, so the remaining stNEAR is always worth at least the principal.
5. `fund_rewards(source: "sponsor", receipt_id: "stnear-yield-YYYY-MM-DD")` on
   `questlayer-rewards-20261101b.testnet`, attaching the NEAR received plus the
   0.005 NEAR sponsor storage fee (paid from the operator's liquid NEAR, so
   players get the whole yield). The contract refuses a second receipt with
   the same id, so a day can never be funded twice.

The receipt is a **sponsor** receipt, not `realized_yield`: `realized_yield`
is reserved for approved vault contracts. The `stnear-yield-` label makes the
source visible on chain and in the public record.

Price risk: stNEAR's price in NEAR only rises in normal operation. If it ever
fell (slashing), value < principal means no growth and no harvest until it
recovers; principal is never sold by `harvest`.

## Commands (Mac, repo folder, operator key in `.data/`)

```
node scripts/stnear-treasury-testnet.mjs status
node scripts/stnear-treasury-testnet.mjs deposit 2 [--dry-run]   # min 1 NEAR
node scripts/stnear-treasury-testnet.mjs harvest --dry-run
node scripts/stnear-treasury-testnet.mjs harvest
node scripts/stnear-treasury-testnet.mjs fund-pending           # retry funding after a failed step 5
node scripts/stnear-treasury-testnet.mjs withdraw 1 [--dry-run]  # take principal back out
bash scripts/install-stnear-harvest-mac.sh   # daily 06:30 LaunchAgent (--remove to undo)
```

Each command writes `public/stnear-treasury-testnet.json` (deposits, harvests
and transactions, never keys). With `STNEAR_RECORD_PUSH=1` (set by the
LaunchAgent) it is also copied to `/var/lib/questlayer-hackathon/` on the VPS;
otherwise the next `scripts/deploy-vps.sh` carries it.

## Read API

`GET /api/treasury/stnear` (signed-in players): live stNEAR balance, price,
value, principal, growth, total harvested and the last 14 deposits/harvests.
503 `TREASURY_NOT_STAKED` until the first deposit is recorded.

## Sizing

At testnet's ~2.8 NEAR operator balance a 2 NEAR deposit grows by roughly
0.0003 NEAR a day, so with the 0.01 NEAR minimum a harvest lands about every
few weeks. Bigger capital, or the mainnet treasury, harvests daily. Mainnet
(`meta-pool.near`) is wired in `TREASURY_TOKENS` but the script is testnet only.

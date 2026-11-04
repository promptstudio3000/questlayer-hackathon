# QGOLD token page and market keeper (testnet)

Stream 2 of the QGOLD build plan (`/mnt/project-files/tokenomics/QGOLD-BUILD-PLAN.md`). The design is in the
approved doc "QGOLD: návrh ekonomiky". Testnet only.

## What it is

- **Token page**: the QGOLD section at the top of `/economy`
  (`src/economy/QgoldSection.tsx`). It reads `GET /api/economy/qgold` (`server/qgold/token-page.mjs`, cached 30 s).
  - Shows R, the buy and sell prices (R + 1 % and R − 1 %), supply, burns, backing and what it is held in, the
    insurance fund, the exit paths with the instant limit left today, the exit queue, the Rhea pool, the keeper
    record, the fees and a chart of R against the pool price.
  - Buy and sell sign with this browser's game account key (`src/economy/qgold-trade.ts`, lazy-loaded): a payable
    `deposit({min_out})`, and `redeem({amount, path, min_out})` with 1 yocto.
  - Before the vault exists the page shows the rules only (`status: "vault-pending"`), with no made-up numbers.
- **Rhea pool**: QGOLD/wNEAR simple pool on `ref-finance-101.testnet`, 0.3 % fee. It opens at the vault buy price
  R + 1 %. `scripts/qgold-rhea-pool-testnet.mjs` creates it on the Mac and writes
  `public/native-qgold-pool-testnet.json`.
- **Keeper** (`server/qgold/keeper.mjs`, pure math in `server/qgold/market-math.mjs`):
  - Every market action happens at one of **12 times a day, one in each 2 h slot**.
  - **Commit-reveal:** the keeper stores sha256 of a secret salt for today and tomorrow. The times are
    sha256(salt ‖ random_value of the first final NEAR block after the commitment ‖ day ‖ slot). The salt and the
    seed are published after the day, and `verifySchedule` checks them. The keeper cannot choose its times, and
    nobody can trade ahead of them.
  - **At each time, in this order:**
    1. Inverse buy and burn while the pool price is under R. It is capped at 5 % of the pool's NEAR a day and by
       `QGOLD_INVERSE_BUDGET_YOCTO`.
    2. Buyback and burn from 20 % of the fees while the price is under 1.1 R.
    3. Sale while the price is over 1.1 R. The keeper buys QGOLD at the vault for R + 1 % (fully backed) and sells
       it in the pool. The sale pushes the spot price down by (ref − 1.1 R) / 24, where ref = min(spot, 24 h
       time-weighted average). It never goes below 1.1 R, and the total is at most 2 % of supply a day.
  - **Off** while the pool holds less than 500 NEAR (`QGOLD_KEEPER_MIN_POOL_NEAR` overrides this on testnet).
  - **Ask ladder at 1.1 / 1.2 / 1.3 R:** each rung is 0.5 % of supply, inside the daily 2 %. It is computed and
    published on the page now. Signed NEP-141 Intents sell orders follow once QGOLD exists, so the verifier can hold
    the keeper's QGOLD.
  - **Dry run by default.** It records `simulated` actions. It sends transactions only with
    `QGOLD_KEEPER_EXECUTE=1` and `QGOLD_KEEPER_KEY_PATH` (a service key file, mode 600, on the VPS).
  - Tables: `qgold_keeper_days`, `qgold_keeper_actions` and `qgold_snapshots` (a reading every 10 minutes for the
    chart and the 24 h average).

## Vault interface (agreed with the vault stream)

`public/native-qgold-vault-testnet.json` holds `{network, vaultContract, tokenContract (same account), decimals: 6, methods}`.

- `get_state()` returns these fields as strings: `supply`, `backing`, `rate` (yocto per whole QGOLD), `r_peak`,
  `reserve_near`, `lsts[{token, amount, near_value}]`, `insurance`, `burned_total`, `fees_total`,
  `exit{instant_used_24h, instant_cap_24h, queue_pending, queue_count}`, `account_cap_24h`, `safe_window_ms`,
  `paused`, `pause_until`.
- Buy: payable `deposit({min_out, receiver_id?})` at R + 1 %.
- Sell: `redeem({amount, path: near_instant|near_queue|lst, min_out})` with 1 yocto. It burns the caller's QGOLD first.
- `claim_exit({exit_id})` and `ft_burn({amount, memo})`. The keeper pays the 1 % like everyone else.

## Turning it on (testnet)

1. The vault stream deploys and commits `public/native-qgold-vault-testnet.json`. Then the page shows live numbers
   and the dry-run keeper starts recording after the next VPS deploy.
2. Mac: `node scripts/qgold-rhea-pool-testnet.mjs` (plan), then `--create --near 5`. Commit the pool manifest and
   deploy the VPS.
3. Keeper trading (Lubos approved on 4 Nov):
   - `QGOLD_KEEPER_MIN_POOL_NEAR=5` in runtime.env, so the keeper is active on the 5 NEAR testnet pool.
   - On the Mac, `node scripts/qgold-keeper-testnet.mjs` prints the plan; `--create` sets up the keeper.
     - It creates `qgold-keeper.<operator>.testnet` with 3 NEAR and a full-access key in `.data/qgold-keeper.json`.
     - It registers the keeper on wNEAR, QGOLD and Rhea.
   - `bash scripts/install-qgold-keeper-vps.sh` copies the key to `/var/lib/questlayer-hackathon/qgold-keeper.json`.
     Restart or deploy afterwards.
   - With the key in place the keeper trades. `QGOLD_KEEPER_EXECUTE=0` turns trading off and keeps the record.
   - Inverse buys spend the keeper's own NEAR above a 1 NEAR reserve unless `QGOLD_INVERSE_BUDGET_YOCTO` is set.
   - The keeper never touches treasury or player money.

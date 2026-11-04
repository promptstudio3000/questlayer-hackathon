# Public prize pool ledger (`/economy`)

A read-only public page that shows the one global prize pool and how money
moves through it. No sign-in, no actions, no player ids.

- Page: `src/economy/EconomyPage.tsx` (lazy chunk, route `/economy`), linked
  from the last chapter of `/how-it-works`.
- Data: `GET /api/economy/ledger` (`server/native/public-ledger.mjs`), cached
  60 s, composed only from facts the server already publishes:
  - **Treasury** totals and liquid balance from the last distribution audit
    (`nativeRewards.lastAudit`, the same as `/api/native/distribution`).
  - **Audit** status and each check (name + ok only).
  - **Realized yield** from `readYieldBacking` (vault `game_paid` paying this
    rewards contract), exact yocto, with what yield-paid days already use.
  - **stNEAR** from `/api/treasury/stnear`, including the honest
    `yieldStatus` (`price-flat` on testnet: Meta Pool testnet keeps one price,
    so no growth to harvest).
  - **Daily budget** per date across cities and **published days** with the
    publish transaction (`native_days.transaction_hash`).
  - **Payouts**: confirmed `native_reward_claims` (count, exact total, last
    50 with claim transaction). The NEAR account is public on chain anyway;
    the internal player id is never returned.
  - **Yield cycle proof** from `public/native-yield-cycle-proof.json`, with an
    explorer link per flush.
  - **Trade fee** (`tradeFees`) from `public/native-intents-fees-testnet.json`,
    written by `scripts/intents-fees-testnet.mjs`: the 2 % P2P fee on the
    NEAR Intents verifier and each sweep into the prize pool (withdraw and
    `fund_rewards` transactions). Only finished sweeps count in `swept`.
- Every amount is a yoctoNEAR string; the page formats with BigInt-safe string
  math (`src/economy/format.ts`) and never rounds small yield to zero.
- Each source fails on its own: a host without native rewards or with RPC
  trouble still answers and says which part it cannot show.
- Copy rules: "global prize pool", never per-city pots; never mention events
  or presentations (`tests/economy-ledger.test.mjs`).

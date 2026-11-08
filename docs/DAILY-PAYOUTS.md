# Daily QGOLD payouts

Every backed map coin pays real QGOLD. Instead of one on-chain receipt per coin
(which capped claims at 240 a day), the server sums what each account earned on
a day and the rewards contract pays every account once, from one Merkle root.

Updated 6 November 2026: finalized settlement and restart recovery are prepared in
source. This update is not a deployment record. Release prerequisites are in
`docs/QGOLD-NIGHTLY-PAYOUT-FIX-2026-11-06.md`.

Contract: `contracts/rewards/src/payouts.rs` (rewards contract,
`questlayer-rewards-20261101b.testnet`). Server helper:
`server/payouts/payout-tree.mjs`.

## Prepared Atlas UTC rewards (candidate, not publicly activated)

`server/global-reward-worker.mjs` implements a separate, opt-in testnet path for
already prepared Atlas zones. `native.config.globalRewards.enabled` remains off
until a release supplies exact reviewed Rewards/QGOLD code hashes, the QGOLD
account, a complete list of finalized funding transactions and a bounded worker
key containing the four `WORLD_CHAIN_METHODS` in addition to existing methods.
Every funding event is read from a successful Rewards receipt on testnet; yield
and sponsorship remain distinct. Missing history, an old contract, incomplete
zone potential or unavailable RPC prevents activation. No default reward budget
or QGOLD balance is treated as game income.

Before a UTC day opens, actual prepared zone objects receive integer yoctoNEAR
allocations under the unchanged weight and cap policy. The worker saves the
exact allocation before `reserve_world_day`, then activates it only after a
matching finalized chain observation. A lost reply resumes the same root.
The first valid GPS completion earns each shared prize; everyone retains personal
XP. Completion and the exact source-attributed right commit in the same game
transaction. No wallet confirmation or financial RPC interrupts gameplay.

`record_world_earned` keeps monotonic cumulative amounts. `close_world_day` runs
after the UTC end plus the existing GPS freshness interval, releasing only
unearned funding. Earned dust and unlinked rights survive. A reserved day that
never activated locally is not retrospectively offered to players and releases
its wholly unearned reservation after its evidence window.

`move_world_to_payout` transfers original reserved amounts from sorted source
days into an immutable account payout without charging the shared date cap a
second time. The exact-NEAR adapter uses `mint_with_carry_for`: token units are
calculated at the actual receipt-time ratio; the fractional NEAR remains a
covered account/minter liability, excluded from token backing and free cash.
`get_game_conversion(minter_id,memo)` retains the actual conversion independently
of transaction-response delivery. The worker confirms both the paid bitmap and
that receipt before consuming the original source lots. Retry delays are bounded
at 15 minutes, with at most 32 leaf attempts per pass; one failed account does not
consume all later accounts' attempt slots.

This candidate does not change current public deployment records. QGOLD's
existing council threshold and 48-hour upgrade timelock remain mandatory.
Prepared coins, NPC stock, chests and collectible reservations remain outside the
Atlas adapter; their absence is never displayed as a funded promise.

## Flow

1. After the local day ends, the server totals each account's backed earnings in
   yoctoNEAR (`buildPayoutDay`). Accounts are sorted by name; leaf `index` is the
   position. Amounts below `PAYOUT_MIN_YOCTO` (1e16 yocto) carry to the next
   day, because the vault cannot mint below one QGOLD unit.
2. `publish_payout_day(day_id, root, leaves, coins_yocto, zones_yocto)`
   (publisher only) commits the root and reserves the total from the coin and
   zone buckets. It counts against the same per-date cap as city and map days
   (`max(0.1 NEAR, 10 % of a bucket's funding)`). Day id
   `payout-YYYY-MM-DD-v<n>`.
3. `claim_payout(day_id, claims)` (anyone, at most 10 leaves per transaction)
   rebuilds each leaf, checks it against the root, sets its bit and calls the
   QGOLD vault's `mint_for(account)` with exactly the leaf's NEAR. The vault
   registers the holder itself and mints at R with no fee.
   - A leaf already paid or in flight is skipped (`false` in the result), so a
     retried batch never pays twice.
   - If the vault refuses (paused, below one unit), the callback clears the bit
     and returns the NEAR to the day; the same leaf can be claimed again.
   - The NEAR is drawn from the coin reservation first, then the zone one.
4. The private callback records each successful mint in a separate paid bitmap.
   `get_payout_progress(day_id, indexes)` distinguishes `unclaimed`, `pending` and
   `paid`; the claimed bitmap alone is not proof of payment.
5. `close_payout_day(day_id)` (publisher, at least 3 days after publication)
   requires every leaf to be paid and no pending mint. It returns surplus funding
   and deletes the claim bitmap; the paid bitmap remains readable for recovery.
   The grace period never expires an earned player's right.

## Server worker (`server/payouts/worker.mjs`)

Runs inside the reward worker when `MAP_PAYOUTS=1` (testnet) and the worker key
holds all 10 methods. Each pass:

1. **Prepare** yesterday's day once (`payout_days`, local Europe/Prague date):
   every claimed map coin (`map_coin_meta`) and funded cell-zone prize
   (`cellZone` quests) of a GPS world, collected before midnight, with a value,
   not in `payout_items` and not already sent as `claim_map`, by a player with a
   `wallet_links` account. Each is priced at `value_u × R / 10⁶` yoctoNEAR, R
   being the rate its map day was planned with (`summary.budget.rateYocto`).
   Totals per account plus last night's `payout_carry` go into
   `buildPayoutDay`; the new carry replaces the old.
2. **Acquire** a database lease. Renew/check ownership before and after network
   work and inside each database write. An expired process cannot acknowledge
   its successor's work. The same exact leaf is also idempotent on chain.
3. **Publish/reconcile** the exact root, leaf count and coin/zone reservations
   using fresh FINAL reads. Neither a hash nor a "Day exists" error proves a
   matching publication. The contract must advertise finalized settlement support.
4. **Reconcile** up to 1,024 unresolved leaves per pass. Only an exact `paid`
   status creates a durable `payout_confirmations` row. Pending or unknown status
   stays pending for the player. Missing/invalid views never trigger a blind retry.
5. **Claim** only leaves observed as `unclaimed`, at most 10 leaves per transaction
   and 10 batches per pass by default. Persist submission intent before sending.
   On timeout/restart, read the same leaf's state before retrying. Retry delays are
   bounded at 15 minutes; there is no five-attempt abandonment of an earned right.
6. **Close** only a fully paid day after `PAYOUT_GRACE_MS`, then confirm its closed
   state. The contract independently enforces the same condition.

`payout_claims.state='sent'` means submitted/uncertain, not paid. Confirmations are
kept in a separate additive table; no existing claim identity or database constraint
is rewritten. `payout_worker_lease` coordinates instances sharing the database.
Both schemas are registered for reopen/restore recognition. A transaction hash is
retained when available, but correctness does not depend on receiving one.

Coins of a player without an account are not assigned and join the first
payout after the account exists. While payouts run, the map-day worker only
records the day budget (`budgetOnly`), so `claim_map` never pays the same coin.
`GET /api/qgold/pending` (the player's waiting QGOLD: `yocto`, micro-QGOLD `units`, `awaitingAccount`, `accountId`) and
`payouts` in `GET /api/map/rewards/day` show the state.
The status API's existing `sent` count now counts confirmed payments. Pending totals
include submitted, failed, unconfirmed and carried items. Original carried items
follow the day that eventually includes their account's leaf, so they disappear
only once that leaf is confirmed. Their coin funding attribution is preserved.
There are no extra wallet confirmations, gameplay limits or changed reward rates.

## Leaf and tree

```
leaf = sha256("payout|<day_id>|<index>|<account_id>|<amount_yocto>")   (hex)
```

Sorted-pair sha256 tree with the odd node carried up, the same tree as
`server/chain-ledger/merkle.mjs` and the map days. A proof is the list of
sibling hashes. The account is part of the leaf, so a proof can never be
redirected to another account, and a forged amount fails the proof.

## Storage and limits

- Per day: the root, totals, settlement counters and claimed/paid bitmaps in
  32-byte chunks of 256 leaves. No receipt per account, so there is no per-day claim limit;
  a day can pay up to 262,144 accounts.
- Publication requires the contract balance to cover both bitmaps on top
  of everything owed (same rule as other days).
- Accounting: each claim moves NEAR from `reserved` to `awarded` and `pending`;
  the callback books it as `withdrawn` (paid) or undoes it. The contract's
  conservation check runs after every step.

## Views

`get_payout_day(day_id)`, `payout_claimed(day_id, indexes)` (max 1024),
`get_payout_progress(day_id, indexes)` (max 1024), `get_payout_config()`.
Progress returns the root, leaf count, closed flag, paid/pending counts and the
requested statuses in order. A missing settlement record returns `null`, never
invented success. The config exposes `settlement_status: true`.

## Keys and deploy

The reward worker key still needs `publish_payout_day`, `claim_payout` and
`close_payout_day` next to its 7 native and map methods
(`allowedWorkerMethods` accepts exactly 4, 7 or 10). New methods are read-only and
need no additional signing permissions. This repair does not run or alter deployment
scripts, keys or WASM hashes. The release requires the contract and worker together,
reviewed bytecode pins and reconciliation of any already published days before
upgrade. A pre-change pending callback must not be crossed blindly by an upgrade.

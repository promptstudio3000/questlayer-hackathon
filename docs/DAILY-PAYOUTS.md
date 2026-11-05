# Daily QGOLD payouts

Every backed map coin pays real QGOLD. Instead of one on-chain receipt per coin
(which capped claims at 240 a day), the server sums what each account earned on
a day and the rewards contract pays every account once, from one Merkle root.

Contract: `contracts/rewards/src/payouts.rs` (rewards contract,
`questlayer-rewards-20261101b.testnet`). Server helper:
`server/payouts/payout-tree.mjs`.

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
4. `close_payout_day(day_id)` (publisher, 3 days after publication) returns the
   unclaimed rest to the available buckets and deletes the bitmap.

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
2. **Publish** pending days (`publish_payout_day`); a refusal keeps the day
   pending and retries next pass ("Day exists" counts as published).
3. **Claim** queued leaves of published days, 10 per transaction, with backoff;
   proof or day errors fail the leaf, others retry up to 5 times.
4. **Close** a day `PAYOUT_GRACE_MS` after publication.

Coins of a player without an account are not assigned and join the first
payout after the account exists. While payouts run, the map-day worker only
records the day budget (`budgetOnly`), so `claim_map` never pays the same coin.
`GET /api/qgold/pending` (the player's waiting QGOLD: `yocto`, micro-QGOLD `units`, `awaitingAccount`, `accountId`) and
`payouts` in `GET /api/map/rewards/day` show the state.

## Leaf and tree

```
leaf = sha256("payout|<day_id>|<index>|<account_id>|<amount_yocto>")   (hex)
```

Sorted-pair sha256 tree with the odd node carried up, the same tree as
`server/chain-ledger/merkle.mjs` and the map days. A proof is the list of
sibling hashes. The account is part of the leaf, so a proof can never be
redirected to another account, and a forged amount fails the proof.

## Storage and limits

- Per day: the root, totals and a bitmap of claimed leaves in 32-byte chunks of
  256 leaves. No receipt per account, so there is no per-day claim limit;
  a day can pay up to 262,144 accounts.
- Publication requires the contract balance to cover the bitmap storage on top
  of everything owed (same rule as other days).
- Accounting: each claim moves NEAR from `reserved` to `awarded` and `pending`;
  the callback books it as `withdrawn` (paid) or undoes it. The contract's
  conservation check runs after every step.

## Views

`get_payout_day(day_id)`, `payout_claimed(day_id, indexes)` (max 1024),
`get_payout_config()`.

## Keys and deploy

The reward worker key needs `publish_payout_day`, `claim_payout` and
`close_payout_day` next to its 7 native and map methods
(`allowedWorkerMethods` accepts exactly 4, 7 or 10). On the Mac,
`node scripts/deploy-qgold-testnet.mjs --reviewed` upgrades the rewards contract
in place, grants the key the methods and records the new hash.

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
3. `claim_payout(day_id, claims)` (anyone, at most 8 leaves per transaction)
   rebuilds each leaf, checks it against the root, sets its bit and calls the
   QGOLD vault's `mint_for(account)` with exactly the leaf's NEAR. The vault
   registers the holder itself and mints at R with no fee.
   - A leaf already paid or in flight is skipped (`false` in the result), so a
     retried batch never pays twice.
   - If the vault refuses (paused, below one unit), the callback clears the bit
     and returns the NEAR to the day; the same leaf can be claimed again.
   - The NEAR is drawn from the coin reservation first, then the zone one.
   - Each issued mint records an attempt (nonce, time, account, coin/zone split);
     the callback must carry that nonce. See "Callback recovery".
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

1. **Prepare** a payout round. With `PAYOUT_ROUND_MINUTES` > 0 (testnet
   default 5) a round runs once that many minutes have passed since the last
   stored one, for everything collected up to one minute ago; its `payout_days.date`
   holds the local cutoff (`YYYY-MM-DDTHH:MM`) and its contract id is the next
   free `payout-<date>-v<n>`. A round with no leaf over the minimum writes
   nothing and the rewards wait for a later round. With `PAYOUT_ROUND_MINUTES=0`
   it is yesterday's day once after midnight (local Europe/Prague date). A round
   or day takes every claimed map coin (`map_coin_meta`) and funded cell-zone
   prize (`cellZone` quests) and, on the Test Layer only, each explorer's one-time
   welcome grant (`starter_grants`, ref `starter:<player>`, kind zone, `TEST_STARTER_QGOLD`),
   of a GPS world or of the city demo (the demo pays
   the same backed coins; only movement differs), collected before the cutoff, with a value,
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
5. **Claim** only leaves observed as `unclaimed`, at most 8 leaves per transaction
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

## Gas

Measured on 9 November 2026 with actual release WASM (local `cargo build`, not the
reproducible Docker artifact) of this branch's Rewards and QGOLD on a local NEAR
sandbox 2.14.0 (protocol 88), `tests/sandbox/qgold.integration.mjs`, all ten
scenarios passing. Maximum burnt gas per receipt in those fixtures:

| Receipt | Observed TGas | Allocated TGas |
| --- | ---: | ---: |
| `mint_for` (daily payout) | 2.2578 | 15 (`MINT_GAS`) |
| `mint_with_carry_for` (world payout) | 2.9666 | 15 (`MINT_GAS`) |
| `on_payout` after a paid mint | 2.5755 | 10 (`CALLBACK_GAS`) |
| `on_payout` after a refused mint | 2.7126 | 10 (`CALLBACK_GAS`) |
| `mint_for` (withdraw) | 2.2416 | 30 |
| `on_withdraw` | 2.0298 | 20 |
| `claim_payout` parent, 8 leaves (own receipt only) | 13.9661 | 20 + 6 per leaf reserved |

The earlier allowances (14 TGas mint, 6 TGas callback, 15 TGas `on_withdraw`) left the
payout callback only about 2.2x its measured cost. The new ones keep about 5x on the
mints and 3.7x on `on_payout`. Each leaf also makes the parent prepay the execution
fees of its two receipts, so ten leaves at the new allowances exceed the 280 TGas the
worker attaches (observed: "Exceeded the prepaid gas"). `PAYOUT_MAX_BATCH` is therefore
8 in the contract and in `server/payouts/payout-tree.mjs`. `claim_payout` refuses,
before any state change, a batch whose attached gas is below
`20 + leaves x (15 + 10 + 6)` TGas (268 for 8 leaves). The game wallet attaches
100 TGas to `withdraw`, enough for its 30 + 20.

These are fixture measurements, not capacity limits: proofs were short and accounts
few. A maximum-depth proof (18 siblings) adds hashing to the parent only. The
reconcile receipts (`get_game_conversion` view, `on_payout_reconciled`) were not
exercised on the sandbox because a callback cannot be made to run out of gas there
without a test-only build; they are covered by unit tests only.

## Callback recovery

A callback receipt that fails, for example out of gas, reverts its own changes. The
mint may have succeeded or failed, but the leaf stays `pending` (blocking
`close_payout_day`), or the player's `pending` withdrawal blocks every later
`withdraw`. `contracts/rewards/src/reconcile.rs` settles such an attempt from recorded
state, never by a blind reset:

- Every leaf claim and every withdrawal records an attempt: a contract-wide nonce,
  the issue time and exactly what the callback books (account and coin/zone split, or
  amount). Views: `get_payout_attempt(day_id, index)`,
  `get_withdrawal_attempt(account_id)`; `get_payout_config` adds `mint_tgas`,
  `callback_tgas` and `reconcile_after_ms`.
- The callback must carry the attempt's nonce and consumes the record. A late,
  duplicate or stale callback (for example the first attempt's callback after a
  reopened leaf was claimed again) fails its nonce check and changes nothing.
  Callbacks without a nonce are accepted only where no record exists, which keeps
  mints issued by the previous code settleable after an upgrade.
- An attempt can be reconciled only after `RECONCILE_AFTER_MS` (1 day); mint and
  callback receipts execute within a few blocks.
- **World payout leaves** (`mint_with_carry_for`): anyone calls
  `reconcile_payout(day_id, index)`. It reads QGOLD
  `get_game_conversion(rewards, "world payout <day_id>:<index>")`. A receipt whose
  account and `depositedYocto` match the leaf books it paid; no receipt books it
  failed and reopens the leaf. QGOLD keeps receipts for 30 days
  (`RECEIPT_RETENTION_MS`), so the permissionless path is open only within 29 days
  of the claim (`RECEIPT_EVIDENCE_MS`). A mismatching or unreadable receipt panics
  and leaves the attempt pending. QGOLD also refuses a second conversion with the
  same memo.
- **Daily payout leaves and withdrawals** (`mint_for`) leave no on-chain receipt.
  Only the owner may settle them, with `owner_reconcile_payout(day_id, index,
  minted)` and `owner_reconcile_withdrawal(account_id, minted)`, after reading the
  finalized mint receipt (the transaction's `receipts_outcome`). The contract
  enforces timing, nonce and state and books exactly the recorded amount once; it
  cannot verify the owner's `minted` statement. A false `minted: false` would let
  that one amount be paid again, so this path relies on the owner, which already
  holds the deployment key on testnet. The owner may also settle a world leaf, but
  only once the receipt window has passed.
- Nothing is paid by a reconcile: `minted` books the recorded amount as withdrawn,
  not minted reopens the leaf (or restores the player's credit) for an ordinary
  retry. Reward amounts, rates and treasury accounting are unchanged; the
  conservation check runs after every step.
- Attempts are new `LookupMap`s (`native-payout-attempts`, `native-withdraw-attempts`,
  `native-callback-nonce`); the root state layout is unchanged and no migration is
  needed. Attempts issued before the upgrade have no record and cannot be
  reconciled here: drain pending callbacks before upgrading.
- The worker does not call the reconcile methods yet, and its function-call key
  does not include them.

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
`get_payout_progress(day_id, indexes)` (max 1024), `get_payout_config()`,
`get_payout_attempt(day_id, index)`, `get_withdrawal_attempt(account_id)`.
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

## Rewards-only M4 upgrade (prepared 10 November 2026, not yet run)

`scripts/deploy-qgold-testnet.mjs` deploys rewards only together with a QGOLD upgrade, so the PR #240
build (`questlayer_rewards` `3e6e8be9…`, code hash `5Ci3cxE7KL9QnNRomx1ddrajeDKGdbwQygX5DadH1q1h`)
has its own code-only path: `scripts/upgrade-rewards-m4-testnet.mjs` (dry run by default,
`--execute` to send, `--network testnet` required). It needs the reproducible WASM
(`npm run contracts:docker` or the CI artifact via `--wasm-dir`) and a checkout whose manifest
carries the factory v3 record (`bc8331e6`).

Pre-flight (every check is read-only; the dry run lists all blockers and exits 1):

- WASM equals the pin; the live code hash equals the manifest; no method is dropped; the M4
  methods are new; the account can pay storage for the new code and the world budget's liquid
  backing stays non-negative; the three new storage prefixes are empty.
- No mint callback in flight. `claim_payout` and `withdraw` both add the minted amount to
  `get_treasury().pending` and only `on_payout`/`on_withdraw` take it out, so `pending == "0"`
  proves that no payout leaf and no withdrawal is outstanding, for every day and account. Per-day
  `pending_leaves` must agree. The server must also be quiet: no queued native claim, no reward
  worker error, a verified distribution audit with nothing reconciling, no payout day still sending,
  and not 00:00–00:59 Europe/Prague (the nightly payout run). `--no-server` relies on the chain
  proof alone. `pending` is read again right before the deploy.
- A snapshot to `output/qa/rewards-m4-upgrade/`: `get_config`, `get_treasury`, `get_payout_config`,
  `get_world_budget`, every open city and map day, payout days and their progress, world days and
  date totals around today, and the raw `STATE` bytes.

With `--execute` it backs up the live WASM to `.data/contract-backups/`, deploys (signed by the
rewards account with the operator key), and requires the new snapshot to equal the old one except
`get_payout_config` (`max_batch` 10 → 8, new `mint_tgas` 15, `callback_tgas` 10,
`reconcile_after_ms` 86400000) and the balance-derived world-budget fields. It then moves the old
record to `previousDeployments` in `public/native-rewards-testnet.json`, writes the new hashes
(also `globalRewards.rewardsCodeHash`) and a `callbackRecoveryUpgrade` record, and moves the
`testnetDeploymentsNotFromThisBuild` entry to the history path so `scripts/check-wasm-hashes.mjs`
stays green. The worker key is not changed.

```
node scripts/upgrade-rewards-m4-testnet.mjs --network testnet
node scripts/upgrade-rewards-m4-testnet.mjs --network testnet --execute
```

After it: commit both files and deploy the app (until then native collection sees a code hash it
does not pin), then set `REWARDS_CODE` in the VPS cron copy of `sync-world-funding.py` to the
printed code hash; that script asserts manifest `codeHash` = `globalRewards.rewardsCodeHash` =
`REWARDS_CODE`. A run that stopped after the deploy is finished with `--deploy-tx <hash>`.
Rollback: redeploy the backup while `pending` is 0 and revert the manifest commit. The old code
neither reads nor clears attempt records, so roll back only before any payout claim or withdrawal
under the new code.

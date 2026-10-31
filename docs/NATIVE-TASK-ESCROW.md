# Native sponsored-task escrow — testnet pilot v1

This is a bounded W08/W10 implementation slice, not completion of the Community,
creator economy, moderation or production launch milestones. The implementation
is `contracts/tasks`, package `questlayer-tasks`, using the workspace-pinned NEAR
SDK. Existing game, staking, reward, market and collectible contracts are unchanged.

## Funding and trust boundary

Each published task holds its sponsor's exact reward in native NEAR. It has no
connection to player principal, yield, street coins, zone budgets, earned XP,
creator XP commitments, paid access, donations or creator-fund rounds. The pilot
does not award XP or items. A player needs no stake or tier to submit evidence.
GOLD remains a display denomination: 1 NEAR = 1,000 GOLD, with no separate token.

The sponsor is also the initial reviewer in this pilot. A separate immutable
arbiter is named at initialization. The arbiter cannot create tasks or submit
claims; a sponsor cannot claim their own task. These account restrictions do not
prove that different accounts belong to different humans. Arbitration is a
trusted human decision, not cryptographic verification of real-world truth.

There is no owner, administrative fund transfer, configurable fee, pause,
confiscation or upgrade method. This is meaningful only if deployment removes
all access keys from the initialized contract account before accepting funds.
An account retaining a full-access key can replace code. Verify deployed code
hash, initialization and the empty access-key list independently. The separate
arbiter account retains its own signing authority; losing it triggers the
published timeout policy instead of an administrative recovery function.

## Published numerical pilot policy

All values below belong to immutable `sponsored-tasks-testnet-v1`. They are
bounded testnet parameters, not approved mainnet economics or service guarantees.

| Parameter | Pilot v1 value |
| --- | --- |
| Network | Named `.testnet` contract and arbiter accounts only |
| Task capacity | 128 tasks for the lifetime of this deployment |
| Submission capacity | 32 per task, one submission per claimant account |
| Reward | Positive integer yoctoNEAR, at most 1 test NEAR |
| Task storage funding | 0.05 test NEAR, additional to the reward |
| Submission storage funding | 0.05 test NEAR per accepted submission |
| Initial deadline | At least 1 hour and at most 14 days after creation |
| Sponsor review cutoff | Submission deadline + 48 hours |
| Rejection appeal window | 24 hours from rejection, capped at deadline + 72 hours |
| Unreviewed evidence appeal | From deadline + 48 hours until deadline + 72 hours |
| Arbitration cutoff | Deadline + 120 hours |
| List page size | At most 50 tasks or 32 submissions |

Storage funding is explicitly nonrefundable pilot storage funding, not part of
the advertised prize. It is not deducted from the winner's reward. There is no
storage-withdrawal or operator-spending method. Empty slots are not reservations:
accepted evidence permanently occupies one of the 32 receipt positions. The
lifetime cap is deliberate; closed tasks and submissions remain readable and
are not recycled. Funding storage is a real testnet cost; onboarding must display
it before asking the wallet to sign.

At the tested NEAR storage price of 10^19 yoctoNEAR per byte, each 0.05 NEAR
contribution backs 5,000 bytes. Strict UTF-8 byte bounds apply before writes.
The maximum-length unit fixture measured 1,441 bytes for a task plus its
sponsor-scoped operation key, and 2,599 additional bytes for an evidence record,
full rejection/appeal/arbitration lifecycle, settlement credit and pending
withdrawal. Each allocation retains more than 2,000 bytes of margin. Fixed
contract code and base state must be separately prefunded at deployment; the
approximately 231 KiB WASM itself is not paid from rewards. Storage costs are
protocol-dependent; this estimate is not a future protocol guarantee.

## Evidence order and settlement

1. Publication locks the reward and immutable task terms. `client_id` identifies
   a sponsor's creation attempt and cannot be reused, even after closure.
2. Evidence receives a sequential submission ID when the NEAR call executes.
   There is no gameplay reservation, new task start payment or off-chain
   evidence-order promise. The pilot uses contract receipt order, not upload
   timestamps supplied by a client. Network inclusion ordering remains observable
   and is not a proof that the earliest physical upload was included first.
3. The sponsor must review `review_cursor` before reviewing the next receipt.
   Rejection advances this cursor. Approval closes further submissions and
   creates a candidate. A first receipt that is approved can settle immediately;
   later pending submissions cannot defeat that earlier valid winner.
4. An earlier rejection blocks a later approved candidate while its appeal
   window is still open, even if the claimant has not filed an appeal yet.
   An earlier pending or appealed receipt also blocks the candidate. Approval
   of a later receipt never quietly extinguishes these earlier rights.
5. Only the claimant can appeal. A rejection can be appealed once during its
   window. An unreviewed receipt can be appealed during the post-review window.
   Only the configured arbiter can resolve an appeal, once, before its cutoff.
   An arbiter's rejection is final and cannot be appealed again in this pilot.
6. Unreviewed evidence without an appeal expires at deadline + 72 hours.
   Unresolved appealed evidence expires at deadline + 120 hours. Expiry means
   the receipt cannot win under this policy; it does not mean the physical work
   was false. An absent arbiter can therefore cause a legitimate claimant to
   lose the prize. This tradeoff must be shown before participation.
7. Anyone can finalize. The contract walks receipts in order, stops at a live
   earlier right, and credits the earliest approved unblocked recipient. With
   no winning receipt, it refunds the sponsor only after submissions are closed
   and every remaining right has expired or been resolved. At the final cutoff,
   no unresolved receipt can indefinitely lock the reward.

All action cutoffs are exclusive: `now < cutoff`. Pending-evidence appeals open
at `now >= review cutoff`. Deadlines use chain timestamp milliseconds. A call at
exactly the cutoff cannot submit, review, appeal or arbitrate as applicable.

Cancellation immediately closes new submissions. It preserves already submitted
evidence, the original review/appeal deadlines and any approved candidate. A
cancelled task with no evidence refunds immediately; cancellation with pending
rights does not refund. Cancellation after settlement and repeated finalization
are harmless no-ops. A live task with no evidence cannot be finalized into a
refund before its deadline unless the sponsor cancels it.

## Withdrawal and conservation

Settlement writes a persistent pull credit, not an immediate transfer. Credits
are payable only to their owning account. `withdraw` transfers that account's
entire current credit with an explicit 1 yoctoNEAR wallet confirmation. A unique
monotonic withdrawal ID, account and exact amount bind the private callback.
Only one withdrawal per account can be pending. New task credits can arrive
while an older withdrawal is pending without being overwritten.

A failed transfer restores the exact withdrawn credit. A successful transfer
moves it to paid accounting. Old, duplicate or mismatched callbacks cannot clear
a newer pending operation or recreate a credit. Repeated zero-credit withdrawal
fails before any accounting change. Finalization never creates a zero-value
credit because task rewards must be positive.

The contract checks both identities after each monetary transition:

```
reward deposits = open escrow + account credits + pending withdrawals + withdrawn
reward deposits = open escrow + cumulative awarded + cumulative refunded
```

`awarded` and `refunded` are settlement attribution counters; do not add them a
second time to the liability identity. Storage funding and the 1 yoctoNEAR
withdrawal confirmations are separately tracked and never included as reward
income. Plain transfers to the contract account and initial deployment funding
are operational subsidy outside these application-ledger deposits.

The callback still relies on NEAR receipt execution and enough attached gas.
There is intentionally no administrator method to assert that an unobserved
transfer succeeded or recover a genuinely lost callback. Use the tested gas
budget, monitor final receipts, and include cross-receipt failure tests before
any non-pilot deployment. Failed transfer and stale callback branches have unit
coverage; this does not simulate every possible protocol/runtime outage.

## Public content and privacy

Only public bounded summaries, references, SHA-256 commitments and a coarse area
label belong in this contract. There is no exact-coordinate or binary-media
field. Descriptions, evidence summaries, references, claimant accounts and times
are public and permanent; hiding a task in the app cannot erase them. A hash
can still be linkable and does not encrypt its source. The contract validates
bounds and hash syntax, not the truth of the content or whether a user embeds
sensitive information in free text.

Private photos, actual GPS, protected answers and signed access URLs must remain
in the application's access-controlled evidence store. Publish a neutral `urn:`
reference and integrity hash for that content. HTTPS/IPFS references are also
accepted for material deliberately made public. The contract never fetches or
validates a referenced URL; render URLs and user text safely in the client.
Application moderation, attachment sanitation, private evidence access and an
available arbiter process remain separate W10 acceptance work.

## ABI

Amounts use decimal strings (`U128`); IDs and timestamps use JSON integers.
Task IDs begin at 1 and submission IDs at 0. Reference strings may be empty or
start with `https://`, `ipfs://` or `urn:`. All string bounds are UTF-8 byte lengths.

| Method | Arguments | Attached deposit | Result |
| --- | --- | --- | --- |
| `new` | `arbiter_id` | 0 | Initialized contract |
| `create_task` | `client_id`, `title`, `description`, `reference`, `content_hash`, `area`, `reward_yocto`, `due_at_ms` | Exact reward + task storage funding | Task view |
| `submit_evidence` | `task_id`, `text`, `reference`, `content_hash` | Exact submission storage funding | Submission view |
| `review_submission` | `task_id`, `submission_id`, `approved`, `reason` | 0 | Task view |
| `appeal_submission` | `task_id`, `submission_id`, `text`, `reference`, `content_hash` | 0 | Submission view |
| `resolve_appeal` | `task_id`, `submission_id`, `approved`, `reason` | 0 | Task view |
| `cancel_task` | `task_id` | 0 | Task view |
| `finalize_task` | `task_id` | 0 | Task view, possibly unchanged while rights remain live |
| `withdraw` | none | 1 yoctoNEAR, at least 35 Tgas | Transfer and private callback promise |
| `on_withdraw` | `account_id`, `withdrawal_id`, `amount_yocto` | Private callback only | Boolean transfer success; false for stale/mismatched callbacks |
| `get_config` | none | View | Immutable policy configuration |
| `get_tasks` | optional `from_index` (default 1), `limit` (default 20, capped 50) | View | Task views |
| `get_task` | `task_id` | View | Task view or null |
| `get_submissions` | `task_id`, optional `from_index` (default 0), `limit` (default/cap 32) | View | Submission views; missing task fails |
| `get_account` | `account_id` | View | Credit and optional pending withdrawal |
| `get_totals` | none | View | Separate ledger totals and conservation flag |

Bounds: `client_id` 1–64 ASCII letters/digits/underscore/hyphen; title 1–96 bytes;
description/evidence/appeal text 1–512; reference 0–256; content hash exactly 64
lowercase hex characters; area 1–80; review/resolution reason 1–256. Nonempty text
must contain non-whitespace and rejects control characters except newlines.

A duplicate creation ID or evidence submission fails atomically. The runtime
refunds an attached deposit when its call fails; the contract does not charge a
second reward or storage contribution. After an ambiguous wallet response, read
final state for the sponsor's `client_id` or claimant receipt before requesting
another transaction. Review and appeal retries cannot repeat a settlement.

Task view fields:

```
task_id, client_id, sponsor_id, title, description, reference, content_hash, area,
reward_yocto, due_at_ms, created_at_ms, review_ends_at_ms, appeal_ends_at_ms,
resolve_ends_at_ms, status, cancelled, submission_count, review_cursor,
candidate_id, winner_id, settled_at_ms
```

Task status is `open`, `closing`, `awarded` or `refunded`. `closing` includes a
cancelled task, an approved candidate with outstanding earlier rights, or an
elapsed submission deadline. It does not mean a payout or refund is available.

Submission view fields:

```
submission_id, claimant_id, submitted_at_ms, status,
evidence: {text, reference, content_hash}, reviewed_at_ms, review_reason,
appeal_until_ms, appeal: {text, reference, content_hash} | null,
resolved_at_ms, resolution_reason
```

Submission status is `pending`, `rejected`, `approved`, `appealed` or `expired`.
Expiry is derived at read time. A later approved submission may still lose to
an earlier approved recipient: only task `winner_id` and settled status establish
a reward. `appeal_until_ms` on pending evidence is its ultimate deadline, not
permission to appeal before the sponsor review cutoff.

Account view: `{account_id, credit_yocto, pending_withdrawal}`. A pending withdrawal
is `{withdrawal_id, amount_yocto}` or null. An unknown account returns zero credit
without creating state.

Totals: `reward_deposits_yocto`, `open_escrow_yocto`, `credits_yocto`,
`pending_withdrawals_yocto`, `withdrawn_yocto`, `awarded_yocto`, `refunded_yocto`,
`storage_funding_yocto`, `operating_funding_yocto`, `task_count`, `conserved`.
Events use `EVENT_JSON`, standard `questlayer_tasks`, version `1.0.0`.

## Verification and remaining delivery gates

Run:

```sh
cargo test --manifest-path contracts/Cargo.toml -p questlayer-tasks
cargo build --manifest-path contracts/Cargo.toml -p questlayer-tasks --target wasm32-unknown-unknown --release
scripts/build-contracts.sh --test
```

The new crate is part of the existing workspace build, preserving vault/factory
build ordering. Contract tests cover receipt ordering, existing appeal rights,
valid/invalid/absent arbitration, cancellation, all cutoffs, expired evidence,
role checks, replay, exact funding, fixed capacities, maximum storage growth,
withdrawal failure/retry/stale callbacks and concurrent credit during withdrawal.

A successful local build is not proof of deployment. Deployment metadata and
transaction evidence must be written only after actual finalized testnet checks.
An independently reviewed financial/security assessment, physical-world evidence
validation, moderation/support availability, mobile-wallet behavior and a real
multi-party dispute pilot remain open. No mainnet readiness is claimed.

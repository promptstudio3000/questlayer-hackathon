# Nightly QGOLD settlement repair

Prepared 6 November 2026 on `weekend/security-nightly-payouts`, based on integration
commit `e9160028637cda7785cae02acd9ea3e299525c17`. **Local code and tests only; no
commit, push, merge, deployment, signing or live-state inspection.** The user's
explicit request authorizes this financial repair. No deployment script, access key,
WASM hash, dependency, CI rule or reward-rate configuration is changed.

This is separate from the previously prepared individual-withdrawal correction on
`weekend/security-qgold-withdrawal`. Both repairs are needed if the deployed source
has both defects. This branch does not silently include or replace that earlier work.

## Problem and resulting behavior

The former worker considered the transaction hash from `claim_payout` sufficient
to mark every leaf sent. The contract starts independent mint/callback receipts,
so some mints can fail after that successful submission. Failed leaves were reopened
on chain but excluded from worker retries and the player's pending balance. After
three days, closing the day could permanently release the backing for unpaid rights.
The former claimed bitmap could not distinguish a pending mint from a completed one.

The repair adds a separate finalized paid bitmap and per-day pending/paid counters.
The new read-only progress method returns `unclaimed`, `pending` or `paid` for each
requested index, bound to the root and leaf count. `PayoutDay` and root `Rewards`
serialization, payout proofs, recipients, amounts and signing permissions are unchanged.
New settlement metadata lives under separate storage prefixes.

The worker persists submission intent before sending, then uses fresh FINAL views
of the configured rewards contract to reconcile the same immutable leaf identity.
Only `paid` creates a durable local confirmation. An unknown response can be retried
only after a valid `unclaimed` observation; the contract also rejects a duplicate
mint if the first submission executes later. A pending mint is never resubmitted.
Missing or incompatible status is not interpreted as success or permission to retry.

| Situation | Result |
| --- | --- |
| Successful outer transaction, child mint still pending | Keep reward pending; poll its final status |
| One child fails, another succeeds | Confirm the paid leaf; retry only the failed leaf |
| Reply lost after mint succeeds | Recover from finalized paid state without minting again |
| Restart before storing the transaction hash | Read the same published commitment and leaf states |
| Temporary RPC outage or more than five failures | Retain the right; retry with capped backoff |
| Two workers or an expired owner returning late | Database lease fences local writes; chain identity prevents duplicate payment |
| Old pending day reaches the work limit | Rotate days by last update so later days continue |
| Grace period ends with pending/unpaid leaves | Keep the day and its backing open, even on a direct close call |
| Closure response is lost | Read the closed state; final paid bits remain queryable |
| Small reward carries across nights | Keep its original player/item attribution and attach it to the eventual paid leaf |

Playing, XP, collection, daily reward values and the existing sponsored flow are
unchanged. Players receive no new wallet confirmations, timers, claim caps or
approval steps. The pending API now retains submitted, uncertain, failed and carried
items until confirmed. The existing public `sent` day count counts confirmed payments.

## Implementation boundaries

- `contracts/rewards/src/payouts.rs`: paid/pending status, duplicate callback guards,
  two-bitmap storage allowance, finalized status views and all-paid closure guard.
  Only an actual failed mint receipt reopens a leaf; an unread successful response
  is successful. Mint and callback promises are explicitly detached from the batch's
  immediate return value.
- `server/payouts/worker.mjs`: exact publication verification, bounded reconciliation,
  durable intent and confirmation, lease ownership checks, retries and pending sums.
  It retains the existing tables and adds `payout_confirmations` and
  `payout_worker_lease` through the existing schema registry. It never creates a
  replacement payout day to bypass an unresolved leaf.
- `server/native/reward-worker.mjs`: supplies fresh finalized contract reads.
- `server/schema-known.json`: records payout and settlement schemas so independent
  reopen/restore preflight recognizes their tables. No existing schema is rewritten.
- `docs/DAILY-PAYOUTS.md` and the daily-payout wiki chapter: describe the corrected
  lifecycle and distinguish prepared source from verified deployment.

## Regression evidence

Three initial regression tests failed against the original worker for the intended
reasons: pending credit disappeared after a hash; a failed child was not retried;
an unresolved day was sent for closure. Their assertions pass with the repair.

The added recovery suite exercises partial callbacks, lost publish/claim/close
replies, commitment mismatch, missing status, incompatible contracts, repeated
failures beyond five attempts, concurrent workers, stale-owner fencing, a delayed
first submission arriving after a successor's payment, bounded paging, fairness
between days and actual closing/reopening of a synthetic SQLite fixture. The game
flow tests also cover a player's sub-minimum rewards across two real prepared map
days until confirmation. Synthetic chain adapters do not claim to execute WASM.

Rust tests exercise actual contract methods and SDK host storage with mocked receipt
results: successful and failed callback accounting, prevention of premature closure,
retry after the grace period, retained final status, duplicate callbacks and absent
settlement metadata. A callback host-gas check covers the added host operations;
compiled WASM instruction costs and actual receipt scheduling remain release gates.

Final test counts and patch digest are recorded in the delivered `verification.json`.
Observed checks on the prepared source:

| Check | Result |
| --- | --- |
| Initial three regression cases against the original worker | All three failed for the intended defects |
| Complete native contract workspace | 365 passed, 0 failed; doc tests passed |
| Focused payout, schema, wiki and native reward checks | 84 passed, 0 failed |
| Application suite excluding three mainnet test files | 1,272 passed; one HTTP test initially ran before the web build was ready |
| That HTTP test after the build completed | Passed |
| Rewards contract combining this repair with the earlier withdrawal patch in an isolated source copy | 65 passed, 0 failed |
| Final application build, bundle budget and wiki check | Passed |

There are 17 added application tests (16 recovery cases plus the carried-reward
game flow) and five added contract tests, alongside strengthened existing cases.
The earlier withdrawal patch also passes a dry application check against this
checkout; it was not applied to this branch.

The native test suite uses the pinned Rust toolchain and a separate temporary target.
The factory's existing embedded vault WASM is only an unchanged test input; no WASM
was rebuilt. Node 24 dependencies were installed with `npm ci --offline --ignore-scripts
--no-audit --no-fund`. Application tests exclude the three `mainnet-*.test.mjs` files;
the prohibited `test:mainnet` command and composite `npm run check` are not run.
No CI or release approval is implied by local passing tests.

## Safe owner-operated release sequence — not executed

1. **Review and combine the required fixes.** Confirm the integration base and
   include the earlier individual-withdrawal patch where needed. Keep each diff
   reviewable. The repository's Protected paths job requires the owner to add
   `owner-approved`; no agent adds it or bypasses the guard.
2. **Inventory before upgrade.** Verify the actual rewards/QGOLD accounts, code
   hashes, minter permission, publisher authority and worker methods. Capture a
   private consistent database/chain checkpoint, every published payout day and
   its full receipt outcomes. Repository documentation is not live-state evidence.
3. **Do not cross old in-flight callbacks blindly.** Days published before this
   patch lack settlement metadata. They deliberately return unknown status; the
   worker will not guess paid/unclaimed from their old bitmap. Finish/reconcile
   those days and drain every old callback before activating this contract change.
   A direct upgrade with such callbacks still pending is unsafe. Already closed
   days with unresolved rights require a separately reviewed receipt-based recovery;
   do not reset records, rewrite roots, seed confirmations from `sent`, or republish
   their obligations under another day ID. No state-migration shortcut is supplied.
4. **Build and rehearse actual WASM.** The owner must produce the reproducible
   artifact and reviewed digest. In an isolated NEAR runtime, run a ten-leaf batch
   with actual QGOLD: force a child failure, restart after sending, overlap workers,
   delay a reply, recover and verify exactly one mint per successful leaf. Measure
   both success/failure callback gas with the real binary, maximum proof/batch sizes,
   and storage growth across bitmap boundaries. Provision separate operating storage
   for both bitmaps; never take it from promised rewards.
5. **Coordinate contract and worker.** Keep gameplay and collection available while
   coordinating financial workers. Deploy the reviewed contract on the verified
   existing account and update all reviewed bytecode pins together; never disable
   hash checks. Start the matching worker with the same durable payout database and
   existing limited signing methods. No extra signing permission is required by the
   new views. Do not let the old worker mark new submissions as paid during rollout.
6. **Canary and verify.** Use a small owner-controlled testnet payout. Check its
   exact commitment, pending status, mint receipt, paid status, local confirmation,
   pending balance and treasury conservation. Force one safe isolated failure and
   retry; prove a repeat request does not mint again. Confirm an unpaid day refuses
   closure even after grace, and a fully paid closed day remains recoverable.
7. **Monitor and recover forward.** Alert on oldest pending age, absent status,
   commitment conflicts, repeated mint failures, lease loss and unreconciled backing.
   Unknown status or a failed canary stops financial activation, not unrelated solo
   play. Keep durable earned receipts. Do not roll back to the old worker, restore
   a database over finalized chain effects or resend an uncertain obligation under
   a different identity.

## Explicit limits

A successful mint followed by a catastrophically failing callback (for example
actual WASM out-of-gas) remains pending rather than being paid again. It requires
receipt-based owner recovery; this patch does not invent an unsafe public reset.
A contract upgrade, malicious publisher or lost database is not made harmless by
a worker lease. Full deployed-state reconciliation, actual-WASM gas/upgrade rehearsal,
independent contract review and required CI remain outstanding. No mainnet, VPS or
production endpoint was used for this work.

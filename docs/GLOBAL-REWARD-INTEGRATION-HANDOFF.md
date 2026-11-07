# Owner handoff: prepared Atlas regions and exact UTC rewards

Updated 7 November 2026. The owner explicitly authorized testnet finance/contract
work and public testnet deployment. Mainnet, key disclosure, CI/dependency changes
and the owner-only approval label remain outside that exception.

## Shipped source and public runtime

PR #211 was owner-approved and merged as `f984e6b212e179aed5ede8fce1d8097be068e944`.
The public testnet runs that source in release `20261107T152644Z`. The November 7
day is imported in full: two owners, ten polygon zones and 277 quests in France
and Luxembourg. This is partial EU coverage, not complete EU or global play.

- Real OSM polygons, paths and exclusions feed automatic Atlas zones, visits and
  three-stop hunts. Prepared regional packages import cooperatively into the game;
  player arrival does not select or create their contents. Plzen retains six slots.
- `server/global-rewards.mjs` records fixed integer yoctoNEAR rights in the GPS
  completion transaction, with original funding source, bucket, object and UTC
  day. Everyone earns personal XP; each funded zone has one shared first winner.
  No wallet or deposit is required to explore or earn an unlinked right.
- `server/global-reward-worker.mjs` persists a plan before reservation, confirms
  the exact on-chain root before activation, synchronizes earned totals, releases
  only unearned reservations and moves original liabilities into account payouts.
  Lease fencing, bounded per-leaf retries and persistent conversion observations
  recover lost replies without double reserving or paying twice.
- Rewards gains `get_world_budget`, `get_world_day`, `reserve_world_day`,
  `record_world_earned`, `close_world_day`, and `move_world_to_payout`.
  These use namespaced state and the existing shared treasury/date cap.
- QGOLD gains `mint_with_carry_for`, `get_mint_carry` and
  `get_game_conversion`. Whole-token units use the actual receipt-time ratio;
  fractional NEAR remains a covered account/minter liability, separate from token
  backing and free cash. Existing minting and the state layout are unchanged.
- Adventure receipts expose the original fixed NEAR and its remaining/conversion
  state. The wallet balance/pending UI owned by the other workstream is untouched.

The public Atlas day currently awards personal XP, without monetary activation.
Coins, NPCs, chests and collectible stock
are not implemented by the Atlas runtime adapter and must not be advertised.

## Verified locally

- 71 Rewards and 30 QGOLD Rust tests pass using locked dependencies.
- Ten actual-WASM local NEAR scenarios pass: the nine callback/payout recovery
  regressions plus pre-opening world reservation, immutable replay, exact unused
  release, unchanged date accounting, failed mint/retry and durable NEAR carry.
- Real EU day from the collector: two prepared owners, ten polygon zones and 277
  quests. Isolated runtime validation and HTTP/browser journeys pass for France
  and Luxembourg, including GPS range rejection and idempotent completion.
- Screens cover 360/390 px, short landscape, desktop and enlarged text. GPS is
  simulated; physical iOS/Android access and device behavior remain unverified.

## Finalized operations and remaining release gates

The authorized existing opaque signer submitted these testnet operations without
printing or copying its key:

- Rewards deployment: `3kc5oS6HEyp5X3cxvuhZYDED1VR71mkLoevnPaioQBma`.
  Final code hash `2JEVdTubVxUMt5v9bqrzH6VG7myeSroByRroyKQRDpgT`;
  treasury and configuration remained unchanged.
- Existing bounded worker permission extension:
  `7dKjY7HRy9ZBgEi1aFdn1RNTXAMua7UKvynpfdce3iGr`. Same key, receiver
  and allowance; fourteen reviewed methods, no new privileged key.
- QGOLD proposal 1: `JsRFAYdTj8NAfr2WD4pQZZ1meRgJ92uZXdCLb6AUr3o`.
  Superseded after the owner merged sponsored lifetime storage registration.
  Proposal 1 was cancelled by `3FUjjXLfY7VZDS8s1ggau1TBTFixnPBMEcfvReVQ3yhJ`.
- Current QGOLD proposal **2**: `GgXTWDQ3W6jFRD4HcQJo1EZernvQ9K1hFJ2My563ewGN`.
  Approved exact SHA `d0fd8cc4e3dc110036b73613b9775d46ba87b7b1d1660367144b94893bbdd95f`,
  from successful CI run 42388575618 and the owner-merged source.
  Earliest execution **2026-11-09 17:21:10.054 UTC** (18:21 Prague).
  All ten local actual-WASM scenarios passed again with this exact artifact.
  QGOLD has not yet been upgraded; its active hash remains unchanged.

Archival RPC verifies all three received funding transactions: 0.2 test NEAR
sponsorship and 0.000007071903508359582359 test NEAR realized yield. Their sum
matches `get_treasury.funded`; prior obligations are still deducted by the worker.
Proofs and public deployment observations are in
`output/qa/global-release/runtime-20261107/`. No forecast or test default is income.

Remaining gates:

1. After the timelock, apply only proposal 2's reviewed artifact using
   `output/qa/global-release/owner-world-operations.mjs --apply-ready-qgold`
   with the authorized opaque signer. Coordinate a writer maintenance window;
   verify FINAL code hash, unchanged financial state/council/minters, audit and
   `get_state.exact_game_mint === 1`. Before maturity the wrapper returns without
   loading a key or sending a transaction.
2. Review and install `runtime-20261107/sync-world-funding.py` as the bounded
   fifteen-minute operational input refresh. A dry run reconciled all sources; repeat against proposal 2 records before installing.
   It never signs, reads keys or allocates rewards. It enables the adapter only
   after the exact QGOLD code/proposal and bounded worker permission are verified.
   NearBlocks supplies discovery hints; finalized RPC receipts prove amounts.
   Its cache and newest-100-receipt scan fail closed if the inventory is incomplete.
3. Reserve a complete new day before UTC opening, then verify actual earned-right
   accounting and account conversion. Earliest possible monetary day is November
   10, assuming the upgrade and content preparation succeed. Open XP-only days
   cannot acquire retrospective monetary promises.

The atomic publisher runs every two minutes and exposes validated immutable
copies through `/var/lib/questlayer-prepared-eu`, read-only at
`/run/questlayer-eu-days` for the DynamicUser service. Original private source
permissions are preserved. Replays are accepted; changed published manifests are
refused. Consistent database backups, prior release/assets and source-aware
fallback are retained. Public HTTPS health and both prepared region reads passed;
no simulated financial claims were sent to the public game.

## Collector operations

Active acquisition/preparation is EU-only: 141 Geofabrik leaf extracts cover all
27 member codes, including Cyprus. Non-EU files and earlier pilots are preserved;
completion does not automatically widen the selection. New source data affects
unbuilt days, never an already published date.

At 17:05 UTC on November 7, ten cells had passed isolated runtime acceptance
(74 polygons, 954 quests). Only the earlier two-cell day is public today. The
collector freezes tomorrow after 23:30 UTC. Approximately 12 GB remained on the
VPS; both jobs pause at the 8 GiB floor without deleting collected data.

A source-specific neighborhood fingerprint avoids invalidating distant regions.
Indexed work receives three turns per new-extraction turn; extraction explicitly
limits libosmium's pool to two threads. Missing restricted shells, conflicting
identities and invalid geometry remain blocked rather than being dropped.
Resource pressure persists a resumable wait instead of claiming a ready day.
The scoped supervisor records interrupted steps after its own child has exited,
under the collector recovery lock. Timeouts receive persistent backoff; after
three failed attempts a region is explicitly rejected and its next neighbor can
continue. Resource pauses do not reject regions. Existing accepted cells, days
and source files remain intact. A changed/live writer or completed step is never
rewritten by recovery. The operational helper and offline regression are in
`output/qa/global-release/runtime-20261107/run-playable-step.py` and `tests/world-collector-supervisor.test.mjs`.

On Agent Zero, read-only Git helpers leaked two persistent `cat-file` subprocesses
per request. Four helpers now close Repo in `finally`, including early/error
returns. Sixty repeated real version reads produced zero new Git processes.
A hash-checked lifecycle guard restores only that exact reviewed repair if an old
container image returns; a new upstream file requires review. Existing datasets,
collector processes, MapOS and unrelated services were not deleted or modified.

## Rollback compatibility

A prior application build does not recognize the new optional schema; do not
point its binary at a database containing accepted global rights and expect it
to boot. Retain a source-aware compatible fallback release and preserve all new
rows. A database rewind after accepted claims or chain activity is unsafe.
Similarly, after the QGOLD carry method has accepted funds, the prior QGOLD code
does not account for those liabilities: an automatic old-WASM rollback is not a
valid recovery plan. A reviewed forward repair must retain the carry and receipt
namespaces. Resolve this operational gate before any public upgrade.

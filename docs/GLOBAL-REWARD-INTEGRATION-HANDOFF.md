# Owner handoff: prepared Atlas regions and exact UTC rewards

Updated 7 November 2026. The owner explicitly authorized testnet finance/contract
work and public testnet deployment. Mainnet, key disclosure, CI/dependency changes
and the owner-only approval label remain outside that exception.

## Implemented candidate

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

These are source changes, not public activation. No new public contract hash or
public reward promise has been recorded. Coins, NPCs, chests and collectible stock
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

## Concrete release gates

1. Open the candidate PR into `claude/upbeat-gauss-5czir7`. The owner alone adds
   `owner-approved`; the agent never sets it or bypasses Protected paths. All CI
   must pass and the owner merges before the public release.
2. Upgrade the existing Rewards testnet account to the reviewed artifact through
   an owner-controlled opaque signer. Check finalized code hash and protocol
   compatibility. Do not read, export or recreate signing keys.
3. Submit QGOLD's exact `Upgrade` proposal for the pinned artifact, obtain its
   configured council approval and honor its existing 172800000 ms timelock.
   After maturity, apply that exact code and verify FINAL code hash, unchanged
   council/minters and `get_state.exact_game_mint === 1`.
4. Extend only the existing bounded Rewards worker key with
   `reserve_world_day`, `record_world_earned`, `move_world_to_payout`,
   `close_world_day`; preserve the existing allowance and receiver restrictions.
5. Complete the received-funding transaction inventory. A sponsor record exists
   but public transaction-history requests timed out in this run; the inventory
   has **not** been proven to match `get_treasury.funded`. Never treat that
   incomplete inventory, a cap, QGOLD backing or forecast yield as free money.
6. Update actual deployment records only after finalized upgrades. Add
   `globalRewards` to the Rewards configuration with `enabled: true`, exact
   `rewardsCodeHash`, `qgoldContractId`, `qgoldCodeHash`, and
   `fundingTransactions: [{hash, signerId}, ...]`. Missing evidence fails closed.
7. Mount the collector's EU `eu-days` directory read-only for the game and set
   `GLOBAL_ACTIVITY_DAYS_DIR` to it. Mount private requirements outside the public
   static root. The loader continuously imports immutable completed days.
   The collector freezes tomorrow after 23:30 UTC; reserve before UTC opening.
   An already opened XP-only day cannot acquire retrospective money promises.
8. Roll out with backup, retained prior release and health/game/reward smoke
   checks. Confirm the public build, complete day import, exact reservation,
   source budget and actual successful account conversion. Until then do not
   call the candidate publicly playable or financially activated.

## Collector operations

Active acquisition/preparation is EU-only: 141 Geofabrik leaf extracts cover all
27 member codes, including Cyprus. Non-EU files and earlier pilots are preserved;
completion does not automatically widen the selection. New source data affects
unbuilt days, never an already published date.

A source-specific neighborhood fingerprint avoids invalidating distant regions.
Indexed work receives three turns per new-extraction turn; extraction explicitly
limits libosmium's pool to two threads. Missing restricted shells, conflicting
identities and invalid geometry remain blocked rather than being dropped.
Resource pressure persists a resumable wait instead of claiming a ready day.

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

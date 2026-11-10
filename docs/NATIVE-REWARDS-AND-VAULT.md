# Native testnet funding and expeditions — W05 / W06

Implementation in progress, 31 October 2026. This document defines the new experimental boundary; it does not close either roadmap milestone. All amounts are native test NEAR, using integer yoctoNEAR. GOLD is a display denomination, never a new token. The existing demo ledger stays separate.

## Contracts and authority

`questlayer-rewards` is a new versioned deployment. It does not overwrite the original accounting proof or consume its old balances. It accepts explicit sponsor receipts and, only from owner-approved vaults, realized-yield receipts. Each receipt is allocated 50/50 to street and zone buckets, with odd units going to zones. Each daily manifest has exactly six city slots, bounded coin supply and backed reservations. Free-zone quests award XP only. Unclaimed backing returns to the same bucket, never new income.

A limited publisher capability may publish/close manifests, relay signed claims and request maintenance on approved vaults. It cannot transfer funds, deploy code, add keys or withdraw player credit. A separate Ed25519 game attestor validates location, tier, consent and durable receipt order. Its authority is limited by the contract's finite backed supply, fixed published rewards and recipient-bound receipts. A compromised attestor could misallocate those testnet rewards; a signature is not a trustless GPS proof. It has no authority over player stake. Contract governance retains a local project deployment key for this unaudited testnet iteration; that authority is not a player-custody guarantee or a reviewed mainnet upgrade policy.

Withdrawals belong to the authenticated NEAR predecessor, require one yoctoNEAR and always pay that same account. Failed transfers restore the exact credit. Publication/claim pause never disables withdrawal. A repeated receipt returns its original result; changing its contents fails. Shared coins pay once, while a zone awards personal XP once per account and its cash prize once globally. Detailed private location evidence stays off chain, but a public claim transaction can still link the wallet to a known activity. Enrollment must explain that linkage.

## Isolated staking position

`questlayer-vault` has one immutable beneficiary, one reviewed testnet pool and one contribution fraction selected at deployment (0–100%). Separate vault accounts prevent one player's new unstake from resetting another player's unlock. The initial release allows the three protocol-probed validator pools, not arbitrary strategies. Pool code and key status are checked again before creating a live position. This is an interface/source review, not an independent audit.

Only the beneficiary may deposit, request a full exit or withdraw liquid owner credit. Anyone can refresh or progress an existing operation, harvest an observed gain, or flush confirmed game yield to the immutable treasury. No maintenance call chooses a payout recipient. Deposits are blocked during an operation; an exit requested while a harvest is unlocking queues behind that sealed operation. The owner immediately loses tier eligibility on requesting exit. The contribution fraction is fixed per vault in this first implementation; changing it requires exiting and opening another position. Partial exits and arbitrary pool switching remain separate work; self-service creation is implemented through the factory described below.

Each deposit increases the cash-flow-adjusted high-water basis and creates an E+2 tranche. Existing mature tranches survive top-ups. Initial tier calculation conservatively uses mature principal at the last observed loss-adjusted stake value, excluding retained profit; stale observations fail closed. This is explicitly narrower than the final active-value tier policy, which remains open.

There are no transferred provisional fee shares. A harvest only requests unstaking an estimate of the game share of gain above the high-water basis. After at least four confirmation epochs and the pool's own release flag, the vault requests withdrawal. The reference pool schedules a detached NEAR transfer, so successful method completion alone is insufficient. A later pool view must show zero unstaked balance and the vault balance must cover the recorded pre-withdrawal cash floor plus the exact expected amount. Unrelated excess cash never becomes new yield.

At cash receipt, recompute gain against the remaining pool stake plus that exact incoming amount. Vested game yield is `min(received, max(total - high_water, 0) × contribution)`. Any part no longer supported by gain belongs to the beneficiary. Advance the high-water basis to `max(old_basis, total) - received`. This makes loss recovery non-chargeable and prevents charging retained profit twice. A completed full exit allocates only gain to the game and returns the rest to the owner, then closes that position's basis. Future losses cannot undo already realized/paid historical yields; staking principal is not guaranteed.

The prototype serializes its asynchronous state with nonces and private callbacks. Normal pool/read/transfer failure has a retryable state. Catastrophic callback exhaustion or protocol-incompatible behavior still requires a reviewed recovery mechanism before deposits with monetary value. Factory-created keyless positions are implemented; independent catastrophic-recovery review remains a release gate.

## Daily world and worker

Use the immutable prepared city/day geography: six dispersed Plzeň zones and bounded public-path coins. A separate native manifest commits exact coin and quest rewards. The daily worker prepares and publishes today/tomorrow, constrained by already liquid contract balances. It never converts demo GOLD or estimated yield. Scarce backing reduces future publication, not an existing promise.

A consented linked account submits fresh GPS checkpoint receipts. An ordered three-stop task works alone; optional observation prompts make each place useful to explore without claiming that a typed answer is verified. A separate testnet rehearsal proof may use synthetic locations on project-owned accounts, and must never be described as physical walking verification. Public arena movement cannot issue native rewards.

A durable outbox stores signed claim contents before transmission. The worker looks up the authoritative receipt before every retry, so crash-after-send-before-ack recovers the original result. Quests preserve acceptance order within their manifest. A day can close only after its grace period and after all accepted local receipts have reconciled; a failed/unresolved receipt blocks release. SQLite remains a bounded single-service adapter, with a lease for overlapping runs; PostgreSQL/multi-host operation remains open.

## Sources and remaining gates

Protocol references: [official staking pool](https://github.com/near/core-contracts/tree/master/staking-pool), [asynchronous calls](https://docs.near.org/smart-contracts/anatomy/crosscontract), [private callbacks](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks). Sources are evidence, not a deployment permission.

Required evidence: Rust financial/callback/adversarial tests, server outbox retry and GPS/tier isolation tests, live funded coin/XP/withdrawal proof, live pool deposit plus epoch-delayed exit, scoped access-key inspection, exact deployed code hashes, VPS health, and actual browser states. Independent financial review, complete live yield/exit timing, physical GPS/device testing, full native tiers and personal-wallet/device journeys remain explicit gates. Self-service creation and actual API settlement are evidenced in the live pilot artifact.


## Self-service testnet positions

The keyless vault factory `questlayer-vaults-20261031.testnet` embeds the reviewed vault bytecode. Its `create_position` binds the caller as immutable beneficiary, one supported testnet validator and a fixed 0–100% game contribution. Successful children have no access keys. The API checks factory and child code hashes, ownership, policy and absence of child keys. The browser independently binds the returned transaction to the chosen receiver, method, arguments and exact integer deposit before asking the wallet to sign.

The pilot requires **3.52 test NEAR setup**, explicitly separate from stake: 3.5 remains in the child's currently non-withdrawable storage/operation reserve, and 0.02 pays for the factory record. A failed child deployment leaves a retryable 3.5 beneficiary refund; failed treasury registration can be retried without redeploying a position. Capacity is 32 positions in total and four per beneficiary. These are testnet operating limits, not the final product's onboarding cost or capacity. The factory governance key remains local; the application receives no FullAccess key. Existing keyless children cannot be upgraded through a factory owner action.

Wallet now supports creating a position, selecting a pool and contribution, staking an exact amount, reading actual state, requesting a full exit, and withdrawing confirmed owner credit. Partial exits, changing contribution within a live position, total-NAV tier accounting and independent audit remain open. The initial tier policy conservatively counts mature principal, adjusts for observed loss, excludes exiting positions and fails closed on stale observations. Funds have no monetary value on testnet.

## Receipt storage and operating funds

Reward backing cannot also pay for receipt storage. Before publishing each day, the contract checks its native account balance against outstanding reward obligations, chain storage, a separate gas guard and **256 pre-funded receipt slots** of 1,024 bytes. A successful first claim consumes one slot; duplicate claims are idempotent. The contract bounds receipt/day IDs, checks actual storage growth, and releases unused slot reservations when closing a day. A namespaced lookup map adds this bookkeeping without changing the deployed contract's state layout; already-published unclaimed pilot days were explicitly backfilled by the owner.

The 256-receipt cap applies across all players, to both native coins and completed walks. Server admission also counts pending receipts, so accepted rights have capacity before relaying. The UI discloses the cap. The 6,000 mapped street candidates and six citywide zones remain, while demo play is unaffected. Publication stops if separate operating funding is insufficient. A **2 test NEAR operating top-up**, transferred from the project's faucet-funded factory account, is excluded from `funded` game treasury accounting. Native rewards start from the separately labeled 0.2 test NEAR sponsor grant; no accrued or hypothetical validator yield is relabeled as cash.

## Deployment and recovery

Build with `bash scripts/build-contracts.sh`: compile the vault first, then the factory embedding that artifact. The worker has a restricted FunctionCall key for `publish_day`, `close_day`, `claim`, and `maintain_vault` on the rewards contract only, initially capped at 0.4 test NEAR gas allowance. Its Ed25519 receipt attestor is a separate key. These two service credentials are installed privately on the VPS and included in private state snapshots. No player or operator FullAccess wallet key is uploaded.

The worker uses a database lease, durable accepted claims, on-chain receipt reconciliation before retry, immutable day hashes, same-bucket rollover and independent vault maintenance. The local area plan regenerates at Europe/Prague midnight; the native worker publishes today and tomorrow from the prepared city plan. Accepted claim order is preserved. A code rollback does **not** rewind the database after native side effects. Disaster recovery requires restoring the accepted queue and reconciling chain receipts; a bounded private-copy rehearsal now recovers a confirmed claim without resubmitting it; full host-replacement disaster recovery remains open. Expired gas allowance, unavailable RPC and funding/storage exhaustion remain visible operating states requiring maintenance.

Live deposit/exit and native settlement evidence is produced by `scripts/prove-native-pilot.mjs` against the deployed API, with project-owned test accounts and explicitly synthetic GPS. It does not prove a physical walk, anti-spoofing, personal-wallet approval, mature yield or the final validator exit. Those gates remain separate.


## Recorded live outcome

At 2026-10-31T12:49:35Z the public API rehearsal confirmed a factory-created keyless position, a 0.01 test NEAR pool deposit, a full exit queued for epoch 5402, unchanged unlock under repeated requests, rejection of a non-beneficiary exit, three contextual checkpoints, one idempotent shared coin, 82 native XP and actual withdrawal of 0.000001 test NEAR. At observation the epoch was 5398 and the pool explicitly reported `can_withdraw: false`; no full-exit or realized-yield completion is claimed. All GPS points were synthetic fixtures. The native reward came from the labeled sponsor grant. See `public/native-pilot-proof.json`.

Snapshot `20261031T125419Z-0ff09c92` contains the two native receipts and both restricted service credentials. The isolated native rehearsal reset one confirmed receipt to its crash-before-ack state, then recovered its original amount and XP from the live testnet without invoking a sender. See `output/qa/W05-W06-native/restore-rehearsal.txt` and `deploy/rehearse-restore.mjs --native`.


## Public funding storage guard

Public sponsors must attach their intended reward grant **plus 0.005 test NEAR** for the bounded funding record. `get_config.sponsor_storage_fee` exposes that amount. The fee is excluded from `funded` and the 50/50 game buckets; its event field is explicit. A 64-byte receipt-ID limit and a measured storage-growth assertion keep the record within its paid allowance. Tiny donations without that fee are rejected atomically, so public callers cannot fill storage using funds reserved for existing players.

All funding, including approved realized-yield deposits, also checks actual storage, outstanding reward liabilities, all reserved native receipt slots and the operating guard before committing. Insufficient operating capacity rejects the incoming funding rather than spending promised backing. A rejected vault flush restores the vault's game credit through its existing callback and can be retried after an operating top-up. Existing principal, claims and balances are unchanged by this compatible code upgrade. The additional live probe contributes only 0.000002 test NEAR of reward income; its separate 0.005 test NEAR storage fee is never called yield.

## v2 upgrade (1 November 2026): street-find XP, partial exit, adjustable contribution

- **Rewards v2.** `publish_day` takes an optional `finds` list (≤ 60 unique coin indexes,
  from manifest v2). Collecting a find pays the same coin unit and **15 XP** instead of 2;
  it adds no GOLD and no reservation. `get_day` returns `finds`, `find_xp` and `coin_xp`.
  `record_day_finds` (publisher, once per day) backfills a v2 day published before the
  upgrade, only for coins nobody has collected, so no receipt is re-priced.
- **Vault v2.** `request_partial_exit(amount)` (beneficiary, 1 yocto) unstakes `amount`
  of principal plus the game's share of the gain so far; the remaining position keeps at
  least 0.001 test NEAR. The fee settles at the current rate exactly as in a harvest, and
  principal is taken from the oldest tranches first. `set_contribution(bps)` (beneficiary,
  1 yocto) never re-prices earned gain: if that gain carries a fee at the old rate, a
  harvest settles it first and the new rate applies when its cash arrives; otherwise it
  applies at once from today's value. `get_state` reports `partial_exit` and
  `pending_contribution_bps`.
- **Migration.** Both contracts keep their deployed state layouts byte for byte (tests
  `v1_state_reads_without_migration` and `v1_state_mid_cycle_reads_without_migration`);
  new data lives under new storage keys, so the upgrade is a plain code deploy.
- **Upgrade.** `node scripts/upgrade-rewards-v2-testnet.mjs --upgrade-reviewed` on the
  machine with the operator key. Existing keyless factory positions stay v1; the factory
  is upgraded only while it has created none.
- **App.** Profile → Fuel the prize pool shows "Change your stake" only when a position's live
  `get_state.version` is 2: "Take some out" (quote: principal back, city's settled share
  of earned gain, what stays staked, fuel and tier after) and "City share of your yield"
  (quote: applies now, or after earned gain settles at the old rate). `/native/vaults/prepare`
  accepts `partial` and `contribution` only for an idle v2 position; the relayer and the
  transaction confirmation allowlist `request_partial_exit({amount})` and
  `set_contribution({contribution_bps})` with exactly those arguments and 1 yocto, and the
  confirmation also requires live state version 2. A returned `false` is shown as not
  completed (for example, a change that waits on a fee that cannot be unstaked yet).

## v3 vault (9 November 2026): stuck-operation recovery, harvest limits, settled basis

Review findings H5 and M1–M3 of the November contract review. `get_state.version` stays 2
(the app keys partial exit and contribution change on it); the new fields are additive.

- **Recovery (H5).** `recover_stuck()` (anyone, no deposit) settles an operation whose
  callback never ran, once it has been pending for 2 epochs (`recoverable_at_epoch` in
  `get_state`; `busy_since` records the start of every operation and payout). Nothing is
  paid by it. A lost owner payout, game flush or pool deposit is judged from the account
  balance against the floor recorded when it was issued: back at the floor plus the amount
  means refunded (credit restored), at the floor means delivered (`owner_paid`/`game_paid`/
  stake recorded, the tranche dated now). A lost pool read returns to its origin stage, a
  lost unstake goes to `unlocking` for 4 epochs and a lost `withdraw_all` to `awaiting_cash`;
  the next pool read then re-derives the truth: the "withdraw" read sends a position whose
  `withdraw_all` already ran to the cash check, ends an operation whose unstake never ran,
  and the "cash" read re-issues a `withdraw_all` the pool still shows as unstaked. The late
  callback, if it ever runs, fails its nonce or stage check and changes nothing. `unlocking`
  and `awaiting_cash` are not stuck states and stay with `advance`. Payout callbacks now get
  30 TGas instead of 15.
- **Harvest limits (M2).** A permissionless `harvest` unstakes only a fee of at least
  0.001 test NEAR (`min_harvest`) and starts no earlier than 4 epochs after the previous
  harvest cashed (`next_harvest_epoch`); it returns `false` otherwise. Exits, partial exits
  and contribution changes settle any amount. The reward worker reads both fields.
- **Settled basis (M1).** At cash the basis advances only by the gain whose fee the cash
  actually settled (`settled = min(gain, ceil(game_share / contribution))`), then drops by
  the cash taken out. Gain that grew during the unlock stays chargeable at the next harvest
  instead of being forgiven; fees, rates and tiers are unchanged.
- **Empty position (M3).** When the pool reports zero staked and zero unstaked for a vault
  with principal (a loss took the rest), the exit closes the position at once instead of
  waiting for cash forever; `request_partial_exit` is measured against the observed stake
  as well as principal, so it can no longer unstake everything.
- **Storage.** `Vault` keeps its deployed layout byte for byte; the new fields live in the
  `vault-ext-v2` record, which reads both the v2 and the v3 layout
  (`v2_extension_record_reads_with_the_new_fields`). A standalone vault with an operator
  key is upgraded by a plain code deploy.
- **Keyless children cannot be upgraded.** Factory children have no access keys and no
  upgrade method; the factory embeds the vault WASM at build time. Existing children keep
  the code they were deployed with (v1 or v2) and cannot receive these fixes. New children
  get them only from a factory that embeds this vault. The reproducible WASM hashes in
  `contracts/wasm-sha256.json` are pinned from the CI build.

### Factory v3 rollout (prepared 9 November 2026, not yet run)

Rewards does not hold a configurable factory: `register_factory_vault` on
`questlayer-rewards-<gen>` accepts children only from `questlayer-vaults-<gen>`, derived from its
own account name, and no owner call repoints it. A factory under a new account name would create
children that can never register (they stay `created`; the server lists only `ready` ones). So
the v3 generation reuses the pinned account `questlayer-vaults-20261101b.testnet`: it still has
its operator key, it has created **0** positions (read on 9 November) and the factory source and
state layout are unchanged, so its code is replaced in place. The rewards contract needs no call;
new children register exactly as before and start on vault v3. If the factory has created any
position by then, the script stops: a v3 generation would then need a new rewards generation or a
reviewed rewards change, because the server pins one vault code hash per factory.

`scripts/rollout-vault-factory-v3-testnet.mjs` (dry run by default, `--execute` to send, testnet
only, `--network testnet` required):

1. Checks the vault and factory WASM against `contracts/wasm-sha256.json` (Docker build or the CI
   artifact via `--wasm-dir`) and that the factory bytes embed the vault bytes.
2. Checks the binding (rewards name ⇒ factory name, factory `rewards`), the live rewards and
   factory code hashes against `public/native-rewards-testnet.json`, `created == 0` and the
   factory balance for the new code.
3. With `--execute`: backs up the deployed factory WASM to `.data/contract-backups/`, checks
   `created` again, deploys, and requires `get_config` to be unchanged except `vault_sha256`, which
   must equal the pinned vault build.
4. Moves the old factory record to `factoryHistory` in `public/native-rewards-testnet.json`
   (kept, never deleted), writes the new `codeHash`, `wasmSha256`, `vaultCodeHash` and
   `vaultWasmSha256`, and moves the matching `testnetDeploymentsNotFromThisBuild` entries in
   `contracts/wasm-sha256.json` to the history paths so `scripts/check-wasm-hashes.mjs` stays green.

Between the deploy and the app deploy carrying the new manifest, the server sees a factory code
hash it does not pin and answers vault creation with 503 (fail closed). The standalone treasury
vault `questlayer-vault-20261101b.testnet` (v2, operator key) is not touched by this script.
Rollback: redeploy the backed-up WASM to the factory while it still has created no position and
revert the manifest commit.

### First v3 position smoke test (prepared 10 November 2026, not yet run)

On 10 November the factory runs the pinned v3 build (`5mn94vZF…`, embedded vault `357c3b57…`,
code hash `4bnUo5Bn…`) with `created: 0`; the record is commit `bc8331e6`. The manifest on the
operator's checkout must carry that record (and the app must serve it) before the smoke test, or
the server answers the position with 503.

`scripts/smoke-vault-v3-position-testnet.mjs` (dry run by default, `--execute` to send,
`--network testnet` required) does what the app does for a player, from a dedicated sub-account
of the operator (`vault-smoke-v3.<operator>`, key in `.data/vault-smoke-v3.json`, chmod 600,
created before the account and never printed):

1. Read-only checks: factory code and embedded vault equal `contracts/wasm-sha256.json`, the
   manifest factory record equals both, the factory points at the rewards account, capacity is
   left, the setup deposit equals the manifest, and the pool passes the server's readiness check.
2. Creates the sub-account with 3.901 test NEAR (exact setup deposit 3.52 + minimum stake 0.001 +
   0.1 margin + 0.28 that NEAR locks for 280 TGas prepaid at the pessimistic gas price), or tops it up.
3. `create_position(pool_id, contribution_bps)` with the setup deposit and 280 TGas. It summarizes
   the receipts: the child's first receipt (create, transfer, deploy, `new` with 25 TGas) and the
   rewards `register_factory_vault` receipt must succeed. A position left `created` is registered
   with `register_position`, as the app retries.
4. Checks the child: pinned vault code hash, no access keys, factory state `ready`, and
   `get_state` with version 2, the v3 fields (`busy_since`, `recoverable_at_epoch`, `min_harvest`,
   `next_harvest_epoch`, `recovery_policy` …`-v3`), owner, pool, rewards and contribution.
5. `deposit_and_stake` with 0.001 test NEAR (`--stake`, `--no-stake`), then principal and staked
   equal the stake and the stage is idle.
6. Signs in to the server as the smoke account (NEP-413; creates one explorer there) and requires
   `GET /api/native/vaults?account=` to list the child `ready` with its state. `--no-server` skips it.

A rerun with the same `--label` verifies the existing position instead of creating another. The
result goes to `output/qa/vault-v3-smoke/`.

Exit and cost: `request_exit` (1 yocto), about 4 epochs of pool unlock, `advance` until
`owner_credit > 0`, then `withdraw_owner` (1 yocto) returns the stake to the smoke account. The
3.5 test NEAR child reserve stays in the keyless child (no key, no delete method), 0.02 stays with
the factory, and the position keeps one of the factory's 32 slots. Delete the smoke account only
after the stake is withdrawn, if at all.

```
node scripts/smoke-vault-v3-position-testnet.mjs --network testnet
node scripts/smoke-vault-v3-position-testnet.mjs --network testnet --execute
```

The rewards contract upgrade that goes with PR #240 is a separate script; see
"Rewards-only M4 upgrade" in `docs/DAILY-PAYOUTS.md`.

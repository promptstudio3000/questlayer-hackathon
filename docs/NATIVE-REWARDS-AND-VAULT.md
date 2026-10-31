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

The prototype serializes its asynchronous state with nonces and private callbacks. Normal pool/read/transfer failure has a retryable state. Catastrophic callback exhaustion or protocol-incompatible behavior still requires a reviewed recovery mechanism before player deposits/mainnet. Keyless immutable deployment and independent recovery tests are release gates, not assumptions from successful unit tests.

## Daily world and worker

Use the immutable prepared city/day geography: six dispersed Plzeň zones and bounded public-path coins. A separate native manifest commits exact coin and quest rewards. The daily worker prepares and publishes today/tomorrow, constrained by already liquid contract balances. It never converts demo GOLD or estimated yield. Scarce backing reduces future publication, not an existing promise.

A consented linked account submits fresh GPS checkpoint receipts. An ordered three-stop task works alone; optional observation prompts make each place useful to explore without claiming that a typed answer is verified. A separate testnet rehearsal proof may use synthetic locations on project-owned accounts, and must never be described as physical walking verification. Public arena movement cannot issue native rewards.

A durable outbox stores signed claim contents before transmission. The worker looks up the authoritative receipt before every retry, so crash-after-send-before-ack recovers the original result. Quests preserve acceptance order within their manifest. A day can close only after its grace period and after all accepted local receipts have reconciled; a failed/unresolved receipt blocks release. SQLite remains a bounded single-service adapter, with a lease for overlapping runs; PostgreSQL/multi-host operation remains open.

## Sources and remaining gates

Protocol references: [official staking pool](https://github.com/near/core-contracts/tree/master/staking-pool), [asynchronous calls](https://docs.near.org/smart-contracts/anatomy/crosscontract), [private callbacks](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks). Sources are evidence, not a deployment permission.

Required evidence: Rust financial/callback/adversarial tests, server outbox retry and GPS/tier isolation tests, live funded coin/XP/withdrawal proof, live pool deposit plus epoch-delayed exit, scoped access-key inspection, exact deployed code hashes, VPS health, and actual browser states. Independent financial review, complete live yield/exit timing, physical GPS/device testing, full native tiers and public self-service staking stay explicit until demonstrated.


## Self-service testnet positions

The keyless vault factory `questlayer-vaults-20261031.testnet` embeds the reviewed vault bytecode. Its `create_position` binds the caller as immutable beneficiary, one supported testnet validator and a fixed 0–100% game contribution. Successful children have no access keys. The API checks factory and child code hashes, ownership, policy and absence of child keys. The browser independently binds the returned transaction to the chosen receiver, method, arguments and exact integer deposit before asking the wallet to sign.

The pilot requires **3.52 test NEAR setup**, explicitly separate from stake: 3.5 remains in the child's currently non-withdrawable storage/operation reserve, and 0.02 pays for the factory record. A failed child deployment leaves a retryable 3.5 beneficiary refund; failed treasury registration can be retried without redeploying a position. Capacity is 32 positions in total and four per beneficiary. These are testnet operating limits, not the final product's onboarding cost or capacity. The factory governance key remains local; the application receives no FullAccess key. Existing keyless children cannot be upgraded through a factory owner action.

Wallet now supports creating a position, selecting a pool and contribution, staking an exact amount, reading actual state, requesting a full exit, and withdrawing confirmed owner credit. Partial exits, changing contribution within a live position, total-NAV tier accounting and independent audit remain open. The initial tier policy conservatively counts mature principal, adjusts for observed loss, excludes exiting positions and fails closed on stale observations. Funds have no monetary value on testnet.

## Receipt storage and operating funds

Reward backing cannot also pay for receipt storage. Before publishing each day, the contract checks its native account balance against outstanding reward obligations, chain storage, a separate gas guard and **256 pre-funded receipt slots** of 1,024 bytes. A successful first claim consumes one slot; duplicate claims are idempotent. The contract bounds receipt/day IDs, checks actual storage growth, and releases unused slot reservations when closing a day. A namespaced lookup map adds this bookkeeping without changing the deployed contract's state layout; already-published unclaimed pilot days were explicitly backfilled by the owner.

The 256-receipt cap applies across all players, to both native coins and completed walks. Server admission also counts pending receipts, so accepted rights have capacity before relaying. The UI discloses the cap. The 6,000 mapped street candidates and six citywide zones remain, while demo play is unaffected. Publication stops if separate operating funding is insufficient. A **2 test NEAR operating top-up**, transferred from the project's faucet-funded factory account, is excluded from `funded` game treasury accounting. Native rewards start from the separately labeled 0.2 test NEAR sponsor grant; no accrued or hypothetical validator yield is relabeled as cash.

## Deployment and recovery

Build with `bash scripts/build-contracts.sh`: compile the vault first, then the factory embedding that artifact. The worker has a restricted FunctionCall key for `publish_day`, `close_day`, `claim`, and `maintain_vault` on the rewards contract only, initially capped at 0.4 test NEAR gas allowance. Its Ed25519 receipt attestor is a separate key. These two service credentials are installed privately on the VPS and included in private state snapshots. No player or operator FullAccess wallet key is uploaded.

The worker uses a database lease, durable accepted claims, on-chain receipt reconciliation before retry, immutable day hashes, same-bucket rollover and independent vault maintenance. The local area plan regenerates at Europe/Prague midnight; the native worker publishes today and tomorrow from the prepared city plan. Accepted claim order is preserved. A code rollback does **not** rewind the database after native side effects. Disaster recovery requires restoring the accepted queue and reconciling chain receipts; a full disaster rehearsal after this native rollout is still required. Expired gas allowance, unavailable RPC and funding/storage exhaustion remain visible operating states requiring maintenance.

Live deposit/exit and native settlement evidence is produced by `scripts/prove-native-pilot.mjs` against the deployed API, with project-owned test accounts and explicitly synthetic GPS. It does not prove a physical walk, anti-spoofing, personal-wallet approval, mature yield or the final validator exit. Those gates remain separate.

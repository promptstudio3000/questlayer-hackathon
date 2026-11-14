# Native integration status and next release gates

> **Superseded (14 Nov 2026).** This is a dated record kept as history. Units and numbers here are out of date (the game uses QGOLD, 1 NEAR = 1B QGOLD). The current description is the [README](../README.md) and the in-game wiki at `/wiki`.

Reviewed 31 October 2026. This document records implementation and read-only evidence for W05/W06, with dependencies on W03, W04 and W07. It does not close a roadmap milestone or authorize a mainnet release. Product amounts below are **test NEAR**, with no monetary value. One NEAR displays as 1,000 GOLD; GOLD is not a separate token.

## What this change implements

`server/native/economy.mjs` adds a public read model, `NativeEconomy`, for the Game economy surface. The read model neither signs transactions nor changes contracts, rewards, tiers or wallet authority. A companion worker liveness fix is described below. Construction takes the existing `NativeRewards` instance:

```js
const nativeEconomy = new NativeEconomy(nativeRewards);
// GET /api/native/economy, using the application's normal API error handling:
const body = await nativeEconomy.snapshot();
```

The read model observes the configured rewards contract, the configured factory and its ready positions, the one existing project vault, and their allowlisted validator pools. It binds all chain queries to **one finalized block** and checks every response against that block. It checks configured bytecode hashes, factory binding, immutable vault beneficiary/pool/rewards, keyless factory children, and keyless allowlisted pools. Legacy project-vault governance is deliberately distinct from a factory child's keyless ownership.

Requests share a 30-second cache and one in-flight refresh. At most 33 positions are admitted; position observation has four concurrent tasks. Individual RPC waits and the complete chain observation have time budgets. Underlying provider calls cannot be cancelled by this adapter; a timed-out call is ignored, and the deadline prevents new position queries from extending the refresh indefinitely. Worker reads use bounded queries, expose only counters and timestamps, and never return player IDs, wallet links, coordinates, claim payloads, signatures or raw internal errors.

All amounts are decimal integer strings in **yoctoNEAR**. UI formatting must preserve integer arithmetic; do not convert a whole balance through JavaScript `Number` before denomination/rounding.

## Response semantics

| Field                                                       | Meaning                                                                                | Display rule                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `status`                                                    | Chain observation: observed, partial, stale or unavailable                             | Worker health has its own status; chain success does not imply worker success.                                       |
| `treasury.status`, `staking.status`                         | Observation quality for that section                                                   | A stale value retains its original time and block. Unavailable data is `null`, not zero.                             |
| `staking.data.coverage`                                     | Known, successfully observed, unavailable and pending-creation positions               | Never present an observed subtotal as the complete registry.                                                         |
| `staking.data.totals`                                       | Complete aggregate of verified vault contract fields                                   | `null` if any known ready position cannot be read/verified.                                                          |
| `totals.principal`                                          | Recorded principal in all ready positions, including exits still in progress           | Do not label it active stake or earned income.                                                                       |
| `totals.weightedStake`                                      | Confirmed tier-eligible weighted value under the current conservative policy           | Excludes exiting/stale positions and immature tranches; it can be zero while funds are staked.                       |
| `stakers`, `contributingStakers`                            | Distinct beneficiaries of non-exiting positions with positive recorded principal       | The latter also requires a nonzero contribution fraction. Neither is a count of all app accounts.                    |
| `poolBalances`, `pools`                                     | Independently read current pool stake/unstaked balances and validator reward fee       | Never substitute the vault's older cached pool reading for a failed current pool query.                              |
| `coverage.staleVaultPoolObservations`                       | Vault accounting observations older than the contract's one-epoch allowance            | Fresh chain access does not make an old accounting observation fresh.                                                |
| `totals.ownerCredit`, `ownerPending`, `ownerPaid`           | Owner-withdrawable, transfer-pending, and historical owner payments                    | These include principal/retained entitlement; they are not game yield.                                               |
| `totals.gameCredit`, `gamePending`, `realizedGameYieldPaid` | Realized game yield still in the vault, being transferred, or historically paid        | Do not add these balances to treasury available funds; in-flight callbacks can overlap observations.                 |
| `treasury.data.available`                                   | Reward funds not yet reserved                                                          | This is the only aggregate shown as available for new publication; it is not the raw account balance.                |
| `reserved`, `owed`, `pending`, `withdrawn`                  | Published backing, claimable player credit, transfers in flight, and completed payouts | Every obligation retains its own phase.                                                                              |
| `buckets.coins`, `buckets.zones`                            | Separate policy buckets with available/reserved/awarded history                        | `awarded` is cumulative history, not an extra liability to add again.                                                |
| `apy`, `outlook`                                            | No defensible attributable history yet                                                 | Values are explicitly `null`; daily/week/month/quarter/year estimates are not fabricated from sponsor funds or dust. |
| `worker`                                                    | Last completed pass, its age, pending/retry/due counts and attention flags             | A fresh pass does not prove every pending claim was settled. Capped counts are lower-bound samples.                  |

Treasury admission requires the exact conservation identity:

```text
coins.available + coins.reserved + zones.available + zones.reserved
  + owed + pending + withdrawn = funded
```

The module rejects an inconsistent observation. Raw account balance, storage funding, operating top-ups and staking principal never enter this calculation. Funding source attribution is intentionally conservative: cumulative game yield paid by the observed registered vaults is available separately; the module does not infer that every other funding unit must be a sponsor receipt without a complete indexed receipt history.

Exit phases distinguish epoch unlocking, waiting for the pool's release flag, readiness to request withdrawal, waiting for actual pool cash, owner credit ready, pending owner transfer, queued exit, and completed exit. These are operational states, not guaranteed dates. A ready pool withdrawal still requires maintenance followed by actual cash confirmation. A ready owner credit requires the beneficiary's wallet action.

## Worker liveness correction

Source review found that pausing reward claims, or failing to relay the oldest accepted receipt, aborted `runRewardWorker` before existing vault maintenance. `server/native/reward-worker.mjs` now separates the settlement pass from the maintenance pass under the same durable lease. Paused publication remains paused, failed receipts remain in order, and their original error remains visible; eligible maintenance can still progress an already-requested exit. An unresolved accepted receipt still prevents closing its day. No later receipt overtakes a failed earlier receipt.

Global publisher/attestor identity checks and the existing restricted transport/key guards remain prerequisites. Maintenance additionally verifies each configured vault's bytecode, child keyless ownership, beneficiary, immutable rewards receiver and allowlisted pool before sending only the existing `maintain_vault` action. A code/key/strategy mismatch records a retryable maintenance failure and sends no maintenance action. The beneficiary's deposit/exit/withdrawal authority, contract bytecode, operator keys and financial policies are unchanged.

The worker reports a settlement failure even when independent maintenance succeeded; a successful maintenance operation is not relabeled as successful reward settlement. This fix does not introduce a new automatic transaction type or complete the still-unmatured live exit.

## Read-only testnet evidence

The new module successfully queried finalized block **275604994**, hash `5XVRgAYo49zcQ7GX41615Dvb7DW6G8rbHjtvfwyMA2pB`, at **2026-10-31T13:27:24.596Z**. The probe loaded only `public/native-rewards-testnet.json` and public RPC views. It read no keys, signed no transaction and changed no chain state. It did not connect to the VPS database, so its local worker section correctly reported unavailable.

| Observation                       | Result                                                              |
| --------------------------------- | ------------------------------------------------------------------- |
| Registry coverage                 | Two ready positions; both verified and both pool positions observed |
| Recorded principal                | 0.11 test NEAR, including the 0.01 position already exiting         |
| Current pool staked balance       | `99999999999999999999998` yoctoNEAR, approximately 0.1 test NEAR    |
| Current pool unstaked balance     | `10000000000000000000003` yoctoNEAR, approximately 0.01 test NEAR   |
| Active contributors               | One; the other position is exiting                                  |
| Mature weighted tier stake        | Zero                                                                |
| Actual realized game yield paid   | Zero                                                                |
| Exit readiness                    | Current epoch 5398; unlock epoch 5402; pool `can_withdraw: false`   |
| Observed validator reward fee     | 9/100 of validator rewards, not 9% APY                              |
| Treasury funding                  | 0.200002 test NEAR                                                  |
| Available reward funding          | 0.176002 test NEAR                                                  |
| Reserved rewards                  | 0.023999 test NEAR                                                  |
| Claimable/pending player payments | Zero / zero                                                         |
| Historical withdrawals            | 0.000001 test NEAR                                                  |
| Conservation                      | Passed                                                              |

The exit **cannot advance yet at this observation**. No yield cycle or returned principal is claimed. One-yocto-scale differences are rounding/accounting observations, not evidence of a sustainable daily yield. Previously recorded gameplay proofs used synthetic location fixtures; this financial read does not turn them into physical walking evidence.

## Recommended next implementation gates

### 1. Finish the existing native economic loop before adding another strategy

The immediate critical path is the existing keyless position, not a lending integration. After epoch maturity, observe `can_withdraw`, let the restricted maintenance worker request pool withdrawal, confirm the detached cash receipt, then have the beneficiary withdraw the exact owner credit. Reconcile principal, net gain, retained share, game credit and actual treasury funding at each transition. Exercise a failed pool call, interrupted callback and failed recipient transfer without resetting an older unlock.

The official staking-pool implementation uses a four-epoch unlock allowance and exposes the current release flag. Wall-clock estimates are not a replacement for those conditions. [NEAR staking-pool source](https://github.com/near/core-contracts/blob/master/staking-pool/src/lib.rs).

NEAR cross-contract calls are asynchronous and independent: a callback must explicitly handle failure, and success of the initiating method is not proof that all subsequent work succeeded. This supports retaining the existing cash-confirmation boundary and requires an independent catastrophic-callback/recovery review before monetary deposits. [NEAR cross-contract calls](https://docs.near.org/smart-contracts/anatomy/crosscontract).

**Exit evidence:** a complete live testnet deposit → mature attributable gain → harvested liquid game share → backed reward → player withdrawal, plus actual principal return. A faucet sponsor and a synthetic GPS walk do not satisfy that entire gate.

### 2. Complete native identity and recovery as a player journey

Keep the existing native wallet connector as the working path. Current official documentation supports `@hot-labs/near-connect`, testnet selection and capability-filtered message/transaction signing. Use one shared connector instance, bind returned quotes to the intended receiver/action/amount, and verify browser wallet callbacks and cancellation on actual devices. [NEAR Wallet Login](https://docs.near.org/web3-apps/tutorials/wallet-login).

A local WebAuthn login is not automatically a NEAR signing account. Do not label it a recoverable wallet until it signs a real operation, recovers on an independent supported device, and revokes a lost credential. The server continues to hold no player seed or encrypted seed backup. Function-call keys are scoped to a receiver/methods/gas allowance and cannot attach NEAR; they are therefore suitable for bounded operational actions, not a universal substitute for user-approved deposits or withdrawal signatures. Exhausted allowances must remain visible. [NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys).

**Exit evidence:** one new user, one existing wallet user and a recovery user complete native account linking, a signed action, reconnection, withdrawal and recovery. Document actual wallet/device combinations instead of claiming generic passkey support.

### 3. Add narrowly sponsored actions only after the authorization boundary is tested

NEP-366 meta-transactions are a useful next integration for low-value onboarding: users sign the inner action and a relayer pays execution costs. Build a bounded allowlist, nonce/expiry validation, per-user/per-day subsidy caps, abuse throttling and a separate operating budget. Reject arbitrary calls and attached value. Do not sponsor stake principal or market payments from game rewards. The contract must continue binding ownership to the authenticated predecessor. [NEAR meta-transactions](https://docs.near.org/protocol/transactions/meta-tx).

This is a proposal, not part of the economy read model or a newly deployed relay. Existing reward submission already has its own restricted publisher/attestor model; avoid presenting that operator-signed path as a user-signed meta-transaction.

### 4. Connect receipts to the complete gameplay result

W06 still needs one player journey that connects native coin/quest completion, durable receipt, native XP/profile, earned collectible, actual equipment and withdrawal. Native balances must not inherit demo XP/item promises. Preserve personal XP rights separately from the shared first valid cash prize. Rehearse restart/reconnect while a receipt is pending; chain receipt reconciliation remains authoritative.

Real field evidence, useful reusable quest templates and clear current activity states are product gates alongside settlement. GPS attestation is not trustless proof of presence. Validate reachable public checkpoints and physical phone behavior before expanding native reward exposure.

### 5. Finish factory/product accounting before lending pools or higher limits

Remaining W05 product work includes partial exits, contribution changes with settlement boundaries, pool changes without resetting older exits, final active-value/retained-profit tiers, and a viable reviewed storage/operating cost model. The current immutable contribution, full exit, conservative mature-principal tiers and 3.52-test-NEAR setup are pilot constraints. They cannot silently become the final onboarding economics.

Persist an attributable, cash-flow-adjusted observation/receipt history before publishing estimated daily yield or forecasts. Separate earned-but-staked estimates, actual realized income, sponsor grants, same-bucket rollover and operating funding. Additional lending/liquid-staking strategies require their own share-price, liquidity, loss, permissions and recovery review; a headline APY is insufficient.

### 6. Keep Aura trading and canonical Intents separate until their acceptance tests pass

The canonical Intents verifier is `intents.near` and has no official testnet deployment. A local or self-deployed compatibility environment must remain labeled experimental. [NEAR Intents deployment](https://docs.near-intents.org/integration/verifier-contract/introduction).

The verifier supports NEP-171 deposits and requires wNEAR rather than direct native NEAR deposits. This makes a signed Aura-for-wNEAR order plausible at the protocol level, but it does not prove NFT solver liquidity, wallet compatibility or an integrated marketplace. Finish escrow, cancellation/expiry, transfer failure and recoverable withdrawals on the native market path first; add a small separately reviewed canonical mainnet proof only when authorized. Base-owned Aavegotchi appearances never become sellable native Aura inventory. [Intents deposits](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits).

### 7. Release readiness remains a separate operational gate

Existing native proofs and the isolated receipt-recovery rehearsal are useful but do not establish full host replacement. Restore accepted pending rights and service capabilities on a replacement environment, reconcile every receipt before retry, and verify paused publication still permits rightful withdrawal. Review governance, key rotation, payout exposure, storage/gas reserves and incident handling independently before mainnet.

Creator funding/escrow/disputes, social image storage/moderation and paid access remain their own roadmap work; this read model does not settle or fund them. Enabling creator allocation must apply its reviewed versioned split only to new income, preserving current 50/50 obligations.

## Verification and limits of this change

`node --test tests/native-economy.test.mjs` covers 15 cases: exact integer aggregation, treasury conservation, independent current pool readings, missing positions, stale snapshots, initial outage, wrong network, mixed anchors, stale vault observations, actual exit phases, bytecode/keyless checks, public-data minimization, cached single-flight refresh, bounded queue sampling and RPC timeout.

`node --test tests/native-rewards.test.mjs tests/native-economy.test.mjs` passes **26 tests**. Four new worker cases cover paused claims with an existing exit, a failed oldest receipt with another accepted receipt behind it, global identity mismatch, and changed vault code/keys/strategy/beneficiary. They verify maintenance progress without claim reordering, premature day closure or bypassed authority. All previous native reward tests, including crash-before-ack reconciliation, still pass.

This child change owns the read model, worker correction, their tests and this document. Route registration, rendered UI evidence, full application checks and any deployment are coordinated separately by the parent task. No physical iOS/Android device, wallet approval, native transaction, full yield cycle or new strategy was verified by this change.

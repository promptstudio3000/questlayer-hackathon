# Financial security review and remediation order

6 November 2026. Source review and local tests; **no production inspection or
deployment**. The patch based on `e9160028637cda7785cae02acd9ea3e299525c17` repairs
only A01 below. Findings about runtime exposure remain conditional on actual
deployment, configuration and authorities. No evidence of a deliberately hidden
backdoor was established; this review cannot certify absence of one.

## Scope and evidence

The review covered authority/callback/accounting paths across the 15 workspace
contracts (`game`, `collectibles`, `market`, `rewards`, `vault`, `vault-factory`,
`tasks`, `creators`, `npc-games`, `badges`, `yield-vault`, `ledger`, `soulbound-ft`,
`qgold`, `qgold-escrow`), with deeper tracing of QGOLD withdrawals and the associated
worker, market, relayer, identity and burn-confirmation boundaries. This is not a
formal verification or a completed independent line-by-line audit of every path.

The original 360 native Rust contract tests and 115 focused Node financial/security
tests passed despite A01. A local reproducer then exercised repeated mint requests
and credit restoration using the actual rewards methods and SDK mock runtime.
Regression tests now fail against the original callback and pass with the repair.
Other findings below are source-confirmed paths or explicitly labelled design
risks; they have not been exploited on a network. No keys, private configuration,
live databases, production state or mainnet were accessed.

## Prioritized work

| Priority | Finding | Consequence | Concrete next delivery |
| --- | --- | --- | --- |
| P0 critical | A01 reward credit restored after a successful QGOLD mint | Repeated payment of one reward; drain of available rewards NEAR | Local callback repair and regression tests prepared; owner release/reconciliation gates remain |
| P1 high | A02 nightly payout marks submission as payment | Failed child mints can disappear from retries and player pending balance | Durable per-leaf finalization and retry/recovery tests |
| P1 high | A03 funding confirmation does not bind full escrow terms/state | Off-chain rights can activate against different or already-refunded collateral | Canonical agreement matching plus lifecycle-aware receipt verification |
| P1 high | A04 keeper has no durable operation lease/journal | Duplicate trades and uncounted partial spending | Unique operation claim, step journal and reconciliation before retry |
| P1 high | A05 sponsored burn confirmation rejects delegated transactions | Tokens burned without purchase credit; user retry can burn again | Delegate-aware verified receipts and durable purchase intent |
| P1 high, conditional financial exposure | A06 sponsored token registration is refundable to the recipient | Escrow operating reserve can subsidize repeated cash-out | Preserve sponsor ownership of refunds and bound lifetime sponsorship |
| P2 medium | A07 persistent escrow records and permissionless dispute slots | Storage exhaustion or blocked task settlement | Fund/limit storage and validate bounded dispute eligibility/timeouts |
| P2 high-impact design risk | A08 device holds an origin-readable full-access key | Compromised same-origin code can bypass relayer spending limits | Scope gameplay signing capability and isolate higher-value authorization |
| P2 medium/high, configuration-dependent | A09 per-account relayer subsidy caps lack a service-wide spending boundary | Sybil accounts can exhaust operating funds | Atomic global treasury budget and preflight known failures |

Priorities describe implementation order, not a claim that any deployed treasury
has suffered loss. P1 financial routes should not be expanded before their fixes.
Gameplay, movement, XP, legitimate accrued rights and established reward rates
should remain unchanged by those fixes.

## A01 — successful mint misclassified as failure

Sources: [rewards withdrawal/callback](../contracts/rewards/src/lib.rs), methods
`withdraw`/`on_withdraw`; [QGOLD](../contracts/qgold/src/lib.rs), `mint_for`.

The callback used a zero-length bounded read followed by `is_ok()`, while minting
returns non-empty JSON. SDK `TooLong` means successful execution with an unread
payload, not a failed transfer. Credit was recreated after money had left rewards.
Anyone with positive credited rewards can call the contract directly; relayer
limits and a hidden UI button do not protect the contract. Internal arithmetic
invariants still hold while the physical backing has been spent. QGOLD itself
receives backing for each mint; the loss is in the funding treasury.

The correction and seven new tests are included in this branch. See the
[release procedure](QGOLD-WITHDRAWAL-FIX-2026-11-06.md), including the explicit
warning that `rewards.paused` leaves withdrawal enabled and that old erroneous
credits require receipt-based investigation, not blind retries or balance resets.

## A02 — payout worker loses failed asynchronous settlements

Sources: [worker](../server/payouts/worker.mjs), `runPayoutWorker` and `pendingPayout`;
[transport](../server/native/reward-worker.mjs), `rewardTransport`;
[contract](../contracts/rewards/src/payouts.rs), `claim_payout` and `on_payout`.

`claim_payout` returns which leaves started and schedules child mint/callback
receipts. A top-level success/hash does not establish each child's successful mint.
The worker changes the batch from `queued` to `sent` after receiving the hash and
does not reconcile those leaves. The contract reopens failed leaves, but the worker
does not retry `sent`; the player's pending sum includes only `queued`. After the
grace period the worker closes the day regardless of unresolved leaves. A published
day also treats a `Day exists` error as confirmation without comparing the root.

Fix: persist submitted receipt identity; reconcile final child outcomes plus
authoritative per-leaf state; mark paid only on an exact successful mint; retry only
proven failures; retain unknown outcomes for reconciliation; compare every existing
day commitment before accepting it. Coordinate day closure with outstanding rights
and preserve/reissue an unpaid obligation once if closure has already occurred.
Required tests: child failure inside successful batch, partial success, lost response,
restart after submit, two workers, conflicting root and grace-period boundary.
Player impact: automatic background recovery, accurate pending reward, no new prompt.

## A03 — incomplete escrow funding binding

Source: [market chain adapter](../server/market/chain.mjs), `fundingMatches`,
`markFunded`, `runEscrowWorker` and `checkFunding`.

Matching checks participants and some amounts, but task deadlines, Secret identity,
transfer conditions/expiry and lifecycle/remaining collateral are not fully bound.
An agreement created directly on chain with the expected ID can have materially
different terms; a funded-then-refunded record still matches those limited fields.
The worker can then activate the associated off-chain right without its intended
escrow protection. State-only matching must also handle legitimate fast completion;
simply rejecting all terminal records would strand valid paid operations.

Fix: persist canonical immutable funding terms and verify every relevant field;
verify the initial funding receipt and subsequent payout/refund lifecycle; activate
only the right supported by that evidence. Tests must include wrong deadline,
Secret ID, condition and expiry; cancelled/refunded-before-confirmation records;
already legitimately settled records; concurrent activation and replay. Preserve
the existing single sponsored funding action.

## A04 — keeper duplicates and partial losses escape limits

Source: [keeper](../server/qgold/keeper.mjs), schema, `dueSlot`, `tick`, `execute`,
`record`, `sums`.

`running` is local to one process. The action table has no unique day/slot/kind claim;
it records after the multi-transaction action. Two instances or a crash after a
trade and before the record can execute the slot twice. Buy-and-burn wraps NEAR,
swaps and burns in separate transactions. A later failure drops earlier transaction
hashes from the durable record; `sums` excludes `failed` actions even when money was
already spent. Daily and buyback limits therefore undercount actual spending.

Fix: reserve an operation and budget atomically with a unique identity; add a
recoverable lease; durably journal each intended step and observed final receipt;
reconcile unknown submissions before resending. Count already committed/spent funds
regardless of later burn failure. Tests: two instances, crash at each boundary,
successful swap/failed burn, lost RPC reply and lease takeover. Keep the keeper
disabled or single-instance with conservative reserves until fixed; single-instance
operation alone does not solve crash recovery. No player interaction is required.

## A05 — delegated QGOLD burn is rejected after burning

Sources: [burn confirmer](../server/gold-spend/qgold-burn.mjs), `confirmQgoldBurn`;
[client purchase wrapper](../src/qgold-burn.ts), `withQgoldBurn`;
[relayer policy](../server/relayer/policy.mjs), `ft_burn` allowance.

The sponsored explorer path uses a delegated transaction, whose outer signer is the
relayer and outer receiver is the player account. The confirmer instead requires
the outer signer to be a linked player and outer receiver to be the token contract.
A valid relayed burn is thus rejected before purchase credit is stored. The browser
retries only `BURN_PENDING`; a fresh purchase attempt prepares another burn.

Fix: verify the exact delegated sender, target, method, amount, purpose and successful
receipt ancestry to the token's burn event; retain direct-wallet verification. Bind
both paths to one durable purchase intent so an uncertain result resumes the same
burn. Tests: real delegated outcome shape, direct outcome, forged/unrelated event,
failed child receipt, lost confirmation response and repeated purchase intent.
Do not weaken this to accepting any event with the player's name.

## A06 — sponsorship can be redeemed as native NEAR

Sources: [escrow](../contracts/qgold-escrow/src/lib.rs), `withdraw_for`;
[token storage](../contracts/qgold/src/lib.rs), `storage_deposit`, `storage_unregister`.

Permissionless `withdraw_for` sponsors token registration for a credited account.
The QGOLD record assigns the storage deposit to that holder even when escrow paid;
after emptying the token balance, the holder can unregister and receive the native
deposit. The source permits cycling small transfers/credits and re-registering.
This is a concrete subsidy ownership problem; net profitability, gas costs and live
reserve exposure have not been measured. Existing-holder registration refunds go
back to escrow and are not the vulnerable case.

Fix: preserve who owns a sponsored storage refund (or use an explicitly
nonrefundable sponsored record), account for lifetime grants and cap the sponsorship
reserve globally. Preserve legitimate player-funded storage refunds and automatic
registration. Test sponsor/holder/refund ownership, unregister/re-register cycles,
tiny transfers, existing holders and failed payout recovery with actual FT receipts.

## A07 — storage growth and dispute denial of service

Source: [escrow](../contracts/qgold-escrow/src/lib.rs), persistent agreement maps,
open-count accounting and `open_dispute`.

Finished agreement records are retained without a corresponding per-record native
storage charge; a cap on concurrently open agreements does not cap historical
records. Repeated small funded agreements consume the contract's storage reserve.
Separately, an unassigned task allows any caller naming itself as worker to reserve
a dispute slot without a previously accepted proof or an opening deadline check.
Unrelated accounts can block slots/refunds until a moderator acts.

Fix: budget state growth before accepting obligations, compact settled records while
retaining replay protection, and apply bounded sponsorship for normal players.
Require an eligible task participation/proof reference for a dispute, with a fair
deadline and bounded resolution process. Do not remove legitimate appeals or require
extra wallet confirmations. Tests: repeated closed agreements, reserve exhaustion,
unrelated dispute caller, after-deadline dispute and moderator timeout.
NEAR's [storage security guidance](https://docs.near.org/smart-contracts/security/storage)
explains why unbounded subsidized state can lock operating balances.

## A08 — device signing is a full-access trust boundary

Sources: [device key store](../src/player-key.ts) and
[managed accounts](../server/relayer/accounts.mjs), `finalize`.

The browser stores a readable signing secret in IndexedDB, and account creation adds
that public key as FullAccess. Same-origin script compromise can therefore take the
key and bypass the server relayer policy entirely. This review did not establish an
XSS exploit or theft. It is a high-impact architecture risk, not a hidden server
backdoor. A nonextractable browser key alone would not stop malicious same-origin
code from asking that key to sign.

Fix: design limited gameplay capabilities and separate higher-value authorization
and recovery; isolate signer trust, constrain script supply and test origin/session
boundaries. Ordinary game actions should remain seamless. Prove the actual NEAR
permission/deposit constraints before promising that a function-call key supports
every existing sponsored action.

## A09 — relayer sponsor budget is not a treasury-wide boundary

Sources: [policy](../server/relayer/policy.mjs), storage-class sponsored deposits;
[accounts](../server/relayer/accounts.mjs), funded account creation.

Account-level caps limit one identity, not the entire sponsor treasury. A failed
call can refund its sponsored attached deposit to the player; policy accepts some
calls whose contract signature/eligibility checks subsequently fail. Repeated new
accounts amplify that exposure, including their initial sponsored balance. Actual
loss depends on service configuration, account-creation controls and available funds.

Fix: atomically reserve a global operating budget, prevalidate known signatures and
eligibility before sponsorship, minimize refundable overpayment and reconcile refunds.
Use service-side abuse signals and reserve alerts; keep free solo play available if
financial sponsorship must wait. Tests: multiple accounts at the global cap, concurrent
reservations, failed-call refunds, retries and account-creation bursts.

## Authority and remaining review gates

The owner/publisher/attestor/oracle and QGOLD council/guardian are explicit privileged
roles. Compromising an attestor can misallocate bounded rewards; a signature does not
prove GPS truth. The council can approve upgrades. A FullAccess deployment key, if
present on chain, can bypass a contract's upgrade timelock. Keylessness and production
role thresholds cannot be inferred from source or wiki claims. Check actual access
keys and bytecode before a value-bearing release. Repeated guardian pauses also need
governance review; a per-call pause maximum is not necessarily a lifetime maximum.

Remaining deeper work includes yield-vault callback/accounting interleavings, detached
token transfer outcomes, contract storage/gas bounds at maximum data sizes, dependency
advisories and supply-chain review, historical receipt reconciliation, production
worker configuration and independent audit. Existing tests are evidence of tested
cases, not proof that all these gates pass. No changes for A02–A09 are included in
the narrow withdrawal patch.

# QGOLD reward withdrawal correction and release procedure

Prepared 6 November 2026. **Local source repair only; not deployed.**

Base: `e9160028637cda7785cae02acd9ea3e299525c17` on
`origin/claude/upbeat-gauss-5czir7`. Repair branch:
`weekend/security-qgold-withdrawal`. The user's explicit request authorizes this
specific contract repair and regression tests. No other financial code, dependency,
deployment record, signing script, WASM or pinned hash is changed. The wider
[audit and remediation order](SECURITY-AUDIT-2026-11-06.md) is a separate backlog.

## Failure and correction

`Rewards::withdraw` reserves the player's credit and attaches that amount of NEAR
to the configured QGOLD vault's `mint_for`. That method synchronously mints and
returns a JSON `U128` containing the number of token shares.

The previous `on_withdraw` used `promise_result_checked(0, 0).is_ok()`. A successful
receipt containing even one return byte yields `PromiseError::TooLong` at a
zero-byte read limit. The callback therefore restored the spent reward credit.
Another withdrawal could mint again against the same earned reward. The internal
conservation equation still balanced: it did not measure the NEAR already sent.

The patch treats **only `PromiseError::Failed` as a failed mint**. A successful
receipt is settled even when its response is not loaded. This matches the pinned
SDK's [documented result semantics](https://docs.rs/near-sdk/latest/near_sdk/enum.PromiseError.html)
(5.30.0 when checked) and the pattern already used by other contracts in this tree.
The returned token-share amount is deliberately not compared with the NEAR credit:
these are different units. No unbounded result bytes are allocated.

The trusted boundary remains the configured QGOLD contract: its mint is synchronous
and reverts atomically on failure. The patch does not claim to validate arbitrary
replacement vault code. An SDK or QGOLD upgrade must re-review this boundary.

### State transitions

| Event | Player credit | Pending | Withdrawn |
| --- | --- | --- | --- |
| Start withdrawal of A | subtract A | reserve A | unchanged |
| Mint succeeds, including non-empty JSON result | unchanged | clear A | add A |
| Mint fails | restore A | clear A | unchanged |
| New reward B arrives while A is pending | add B | keep A | unchanged |

This is a callback-only behavior correction. State layout, public methods, callback
arguments, gas allowances, economic rates, account ownership and reward amounts are
unchanged. No state migration is included. Pending withdrawals use the same callback
signature. Native tests call the existing contract methods rather than a parallel
model of the calculation.

## Player experience

- Keep the current sponsored signing and withdrawal flow; add no wallet prompt,
  CAPTCHA, daily claim cap, cooldown, stake requirement or manual approval.
- Continue play and reward accrual while one withdrawal is pending. New credit is
  retained and can be withdrawn after that operation completes.
- A genuinely failed mint restores exactly its reserved credit for retry. Replaying
  an earned-reward receipt does not earn it again.
- Keep independent nightly Merkle payouts, token redemption, market, staking and
  game services unchanged. Their audit findings need separate repairs.

## Regression evidence

Seven new tests cover successful JSON `U128` mint settlement, rejection of another
withdrawal of the same credit, new earnings during a pending success, new earnings
during a failed mint followed by retry, rejection of overlapping withdrawals and
duplicate success/failure callbacks. The existing paused-withdrawal retry test now
uses a real serialized `U128` response instead of an unrealistic empty result.

Successful response coverage includes empty bytes, a share amount different from
the NEAR amount and the maximum serialized `U128`. The response-size check itself
is asserted to return `TooLong`, proving that the regression exercises the SDK path
which caused the bug. These are native SDK VM tests; they do not execute a deployed
QGOLD contract or prove receipt scheduling/gas limits in a network runtime.

| Check | Observed result |
| --- | --- |
| Unmodified workspace contract baseline | 360 passed, 0 failed |
| New/updated withdrawal tests against the vulnerable callback | 6 failed, 3 passed; expected red result |
| Repaired rewards contract | 60 passed, 0 failed |
| Repaired workspace contract suite | 367 passed, 0 failed across 15 crates (plus passing doc-test suites) |
| Focused server financial/security baseline | 115 passed, 0 failed |
| Application build and bundle budget | Passed |
| Full application suite, initial restricted run | 1,259 passed; 13 failed when local HTTP listeners were denied |
| Targeted HTTP rerun with local listener access | 38 passed, 0 failed; covers 12 of the 13 initially failing cases |
| Wiki check after the documentation update | 6 passed, 0 failed; stamps regenerated |

The remaining local mocked `mainnet-slice` server-boot test was not rerun under
expanded permissions because mainnet work is outside this task. Its initial failure
was the denied local HTTP listener; no real mainnet endpoint or signing credential
was used. The full application suite and required CI are therefore **not claimed
green**. The protected-path PR job was not evaluated: this is an uncommitted patch,
and that job compares commits, not working-tree changes.

The earlier isolated reproducer issued three mock `mint_for` receipts from one
credited reward while the original callback restored the full credit each time.
It is diagnostic evidence, not a test of on-chain exploitation. There was no RPC,
signing, secret access or production-state inspection.

Run the focused native suite from the repair checkout with the pinned Rust toolchain:

```sh
cargo test --locked --offline --manifest-path contracts/Cargo.toml -p questlayer-rewards
```

For the broader local run, dependencies were installed from the lockfile using
Node 24 and `npm ci --offline --ignore-scripts --no-audit --no-fund`. Build, bundle
budget and application tests are checked separately. The composite `npm run check`
includes the explicitly prohibited `test:mainnet` command and was not run. No check
or dependency was changed to work around that restriction. Contract native tests
use a separate temporary target directory. The factory's pre-existing embedded
vault WASM is an unchanged test input, not a newly built or verified release artifact.

## Safe release procedure — owner-operated, not executed

### 1. Identify the affected deployment and history

Before signing anything, the owner must verify the intended network, rewards
account, current bytecode, configured QGOLD account, approved minter relationship,
upgrade authority, access-key permissions and worker code-hash expectations. Repository
records and local source are not proof of the running deployment. Save a private
pre-release state/receipt checkpoint and outstanding-operation inventory.

At a finalized checkpoint, reconcile withdrawals against complete receipt chains:
the original caller/amount, the vault mint receipt and event, the refund on a real
failure, and the rewards callback. Include in-flight operations and every affected
code version. Use the NEAR amount sent, not the QGOLD share amount, for rewards
accounting. Reconcile all treasury buckets, obligations and the liquid/storage/gas
balance, not only the player's `withdrawn` field or the arithmetic `check()`.

**Do not assume the patch removes credits that the old callback already restored.**
For each account, distinguish genuine new earnings, successful prior payouts,
unpaid rights, actual failed receipts and ambiguous pending receipts. Keep this
review receipt-based and restricted; do not erase balances or add migration code
based on an assumption that real users exist. If there are inconsistent test/pilot
balances, the owner must resolve those exact rights and any treasury shortfall in a
separately reviewed operation before reopening affected payouts. That repair is
not included here.

### 2. Contain the affected financial route, if necessary

`rewards.paused` stops claims/publication but **does not stop `withdraw`**. Disabling
a button or relayer method also does not stop direct on-chain calls. Neither is
sufficient containment of a deployed vulnerable contract.

Prefer promptly deploying the verified callback correction on the existing rewards
account. If history is unresolved, a narrowly scoped on-chain withdrawal hold would
need a separately reviewed owner change; this patch contains no hold or new admin
power. A QGOLD-wide emergency pause has wider effects on minting, transfers, burns
and redemption. Do not describe it as a zero-impact fix. GPS exploration and solo
play should stay available; communicate any actual financial delay accurately.

### 3. Build and rehearse before a live upgrade

1. Review the minimal production diff and regression tests on the integration
   branch, resolving any newer changes in the same callback.
2. Have the owner run the approved reproducible WASM build, record its digest and
   complete the required deployment-manifest/hash review in a separate release
   change. Native tests alone do not produce a deployable artifact. Existing hashes
   deliberately remain untouched by this work.
3. Rehearse with actual rewards and QGOLD WASM in an isolated NEAR runtime: fund a
   claim above the mint minimum, withdraw, observe exactly one mint and successful
   callback, reject a repeated withdrawal, then earn and withdraw a fresh reward.
4. Force mint failure (for example a missing minter permission in that isolated
   setup), verify one exact refund/credit restoration, restore permission and retry.
   Exercise a new reward arriving while the original withdrawal is pending.
5. Rehearse an upgrade with a pending mint callback and verify state readability,
   unchanged ABI and enough callback gas. Separately force callback failure and
   document recovery: this patch does not add recovery from out-of-gas callbacks.
6. Complete required CI/reproducible-build checks. The protected `contracts/` change
   requires the owner to add `owner-approved` under the repository's guard rules.
   No agent should add the label or weaken the guard.

### 4. Coordinate the upgrade and resume

Record a finalized cutoff and reconcile worker submissions so uncertain operations
are not resent. Keep gameplay services available. Use the same rewards account and
existing state; do not initialize a replacement treasury or reset reward records.
The actual deployment transaction must be prepared against the verified upgrade
authority, not guessed from a source file.

Coordinate every consumer that pins rewards bytecode (worker and transaction
verification): switch to the independently verified new artifact identity with the
upgrade. Never disable hash validation to make the worker start. Handle pre-upgrade
receipts by their actual executed code, not by relabelling them as the new release.

After finalization, verify deployed bytecode and authorities, then run one small
owner-controlled testnet canary. Confirm the full receipt chain, exact NEAR debit,
single QGOLD mint, cleared pending credit and correct withdrawn amount. Repeating
the same claim/withdrawal must not mint again; a newly earned claim must work.
Monitor pending age, mint/callback failures and treasury reconciliation through the
first normal payout cycle. Resume any affected automated financial operations only
after these checks pass; no player reconfirmation is added.

### 5. Failure response

Never roll back to the vulnerable callback, replay a transaction with unknown
outcome or restore an old off-chain database over finalized chain effects. Keep
the affected financial route contained, retain new gameplay receipts and repair
forward. Failed canary, wrong bytecode, unexplained backing/credit mismatch or a
stuck callback blocks financial release. It does not justify deleting earned
rights or turning off unrelated solo gameplay.

## Remaining release gates

No live deployment/hash/access-key inspection, incident-history reconciliation,
WASM build, isolated cross-contract upgrade rehearsal, physical-device test or
production rollout was performed. No commit, push or PR is implied. This document
is a concrete handoff for the owner, not an assertion that the deployment is safe
or that the wider financial audit is complete.

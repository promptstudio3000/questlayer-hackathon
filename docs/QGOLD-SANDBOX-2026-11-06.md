# QGOLD repairs: actual-WASM sandbox evidence

> Follow-up, 9 November 2026: the callback gas allowances were raised and the claim
> batch reduced from 10 to 8 leaves (see `docs/DAILY-PAYOUTS.md`, "Gas" and
> "Callback recovery"). The harness now runs an eight-leaf batch and pauses QGOLD
> alternately as council member and guardian, because QGOLD's pause cooldown no
> longer lets one account pause twice in seven days. The table below is the
> original 6 November record.

Verified locally on 6 November 2026. Both prepared repairs were applied together
to base `e9160028637cda7785cae02acd9ea3e299525c17` on isolated branch
`weekend/security-qgold-sandbox`. No public deployment, production state, real
signing key, deployment record, dependency lock, CI rule or canonical WASM pin was
changed. This follow-up supersedes the **unexecuted sandbox-test gate** in the two
earlier repair reports; their other release gates remain applicable.

The changes in this follow-up are an opt-in integration harness and this report.
The two existing repairs required no further contract or worker change after the
actual-WASM tests. Gameplay, reward amounts and player confirmations are unchanged.

## Verified scenarios

All nine scenarios passed with real Rewards and QGOLD WASM on a local NEAR node:

| Scenario | Observed result |
| --- | --- |
| Successful withdrawal returning real JSON U128 | Credit and pending become zero; repeated withdrawal is rejected; replaying the signed gameplay receipt creates no new credit or QGOLD |
| QGOLD mint failure during withdrawal | The real paused QGOLD contract rejects the mint; credit returns; another gameplay coin can still be earned; after unpause the accumulated credit is paid once |
| Worker killed after a ten-leaf payout but before saving its response | All ten real mint receipts finalize; local confirmations are still absent; the restarted process reconciles them without submitting another payout; direct replay also creates no tokens |
| Mint failure followed by worker death | Both coin and zone reservations are restored exactly; unpaid items remain visible; after unpause and restart the same leaves settle once |
| Worker killed after durable intent but before submission | The replacement process sees unclaimed leaves and completes the retained obligations |
| Worker killed after publication before recording its response | The replacement verifies the existing commitment and resumes without republishing |
| Two simultaneous worker processes with independent outboxes | A barrier makes both observe the same unclaimed leaves; both submit; the contract pays each leaf once; both databases reconcile |
| Partly completed day | The worker records the already paid leaf and submits only the outstanding index |
| Overdue unpaid day | Real sandbox time advances approximately 12.4002 days; premature closure fails without changing reservations; later payment succeeds, closure succeeds, paid status survives and replay is rejected |

The successful run used 19 worker processes, including four actual `SIGKILL`
interruptions. Workers use the unmodified `runPayoutWorker` and reopen the same
synthetic SQLite file. Only transport response delivery and process lifetime are
fault-injected. Lease expiry is tested by advancing the worker's scheduling clock
three minutes; blockchain methods, final views, balances and receipt outcomes are
not mocked. QGOLD mint failure is induced by its real guardian pause, not a token
stub. Test signers exist only for freshly generated local genesis accounts and
are passed to children over IPC. Test accounts ending in `.testnet` satisfy the
existing contract guard; their provider is asserted to be loopback on a private
`test-chain-*` sandbox, never public testnet.

The original Rewards WASM is a negative control: the same first scenario fails
after a successful mint because credit incorrectly remains `10000000000000000000`
yoctoNEAR and withdrawn stays zero. Its hash exactly matches the repository's
original reproducible artifact. This establishes that the regression test detects
the original bug rather than merely exercising a successful call.

## Artifacts and runtime

| Artifact | SHA-256 |
| --- | --- |
| Combined repaired Rewards WASM, 399,526 bytes | `3a31a1370a3a3bcff34a46adf84061119e530c4b28a618099dcc9eb415c7a4ad` |
| Unchanged QGOLD WASM, 370,615 bytes | `4d65564d6f575fc62858b656fd72f2973ad9a564c508cb20cdf1a2bd397f069e` |
| Original Rewards negative control, 392,344 bytes | `cac54fdc555d9e5e0033e7c6c578118a1e128fd114ff42e101b9b9cc96610f36` |

Build: Docker `rust:1.97.0`, `linux/amd64`, locked Cargo dependencies, release
profile and repository-equivalent path remapping. Image digest:
`sha256:b92b8c8574f8f3b207fcb0912fb3e2de4041580b5934d90312d53938c9a038a9`.
QGOLD and the original Rewards control reproduce their existing canonical pins.
The candidate Rewards hash is evidence only; `contracts/wasm-sha256.json` is unchanged.

Runtime: official `near-sandbox` helper 0.3.4, NEAR sandbox 2.14.0, protocol 88,
Node 24.21.0 and the project's existing near-api-js 7.4.0. The helper is installed
in a separate temporary directory, without changing project dependencies.

**Compatibility gate:** the helper's default sandbox 2.13.4 rejects the current
WASM during linking. The locked SDK includes the universal-account host import,
which requires protocol 88. Version 2.14.0/protocol 88 executes the same unmodified
WASM successfully. Check the eventual target protocol before deployment. See the
[SDK host requirement](https://docs.rs/near-sdk/5.30.0/near_sdk/env/fn.promise_batch_action_universal_state_init.html)
and [official nearcore 2.14.0 release](https://github.com/near/nearcore/releases/tag/2.14.0).
This is compatibility of the existing SDK build, not a protocol change introduced
by these two repairs. No public network status was queried.

Observed maximum receipt gas within these fixtures:

| Operation | Observed Tgas | Allocated Tgas |
| --- | ---: | ---: |
| QGOLD mint in nightly payout | 2.0210 | 14 |
| Successful payout callback | 2.3026 | 6 |
| Failed payout callback | 2.4315 | 6 |
| Ten-leaf parent receipt, excluding child receipts | 13.7287 | 280 transaction budget, including child allocation |

The callbacks completed and reconciled their state. These measurements cover the
tested batches, names and proofs; they are not maximum-capacity gas estimates.

Other verification: 65 Rewards Rust tests passed; the complete `npm test` pass has
1,289 passing tests and zero failures, including all 19 payout worker/recovery
cases. Application build and bundle budget passed (205 KB gzip first-load JS).
The separate `test:mainnet` repeat and composite `npm run check` were not invoked.
No CI approval is implied.

## Reproduce locally

Apply both repair patches and the sandbox-test patch to an isolated checkout, or
apply the supplied combined patch to the named base. Use Node 24+ and `npm ci`.
The harness is opt-in under `tests/sandbox/`; it does not add a binary download or
blockchain process to ordinary `npm test`.

Install the test helper separately:

```sh
SANDBOX_TOOLS="$(mktemp -d /tmp/questlayer-sandbox-tools.XXXXXX)"
npm install --prefix "$SANDBOX_TOOLS" --ignore-scripts --no-audit --no-fund --save-exact near-sandbox@0.3.4
```

Build only the two contracts into a separate artifact directory. This does not
run repository deploy/signing scripts or update bytecode pins:

```sh
QGOLD_ARTIFACTS="$(mktemp -d /tmp/questlayer-qgold-wasm.XXXXXX)"
docker run --rm --platform linux/amd64 \
  -v "$PWD:/build:ro" -v "$QGOLD_ARTIFACTS:/artifacts" -w /build \
  rust:1.97.0 bash -c '
    rustup target add wasm32-unknown-unknown &&
    CARGO_HOME=/artifacts/cargo \
    RUSTFLAGS="--remap-path-prefix=/artifacts/cargo=/cargo --remap-path-prefix=/usr/local/rustup=/rustup --remap-path-prefix=/build=/build" \
    cargo build --locked --manifest-path contracts/Cargo.toml \
      -p questlayer-rewards -p questlayer-qgold \
      --target wasm32-unknown-unknown --release --target-dir /artifacts/target
  '
node tests/sandbox/qgold.integration.mjs \
  "$SANDBOX_TOOLS/node_modules/near-sandbox/dist/esm/index.mjs" \
  "$QGOLD_ARTIFACTS/target/wasm32-unknown-unknown/release" \
  /tmp/questlayer-qgold-sandbox-result.json
```

On this macOS arm64 machine the official binary needed `DYLD_LIBRARY_PATH=/usr/lib`
on the final Node command to use the existing system liblzma. Nothing was installed
into system directories. The harness starts and tears down the local node; its
WASM inputs are checked for the binary magic and recorded by digest. It removes
synthetic databases and sandbox account data on completion. Reports contain no keys.

For the negative control, export the base revision's `contracts/` and
`rust-toolchain.toml` to a separate temporary source directory, build with the same
recipe, then pass that artifact directory to the same harness. A nonzero exit at
the first account-credit assertion is expected for the original Rewards artifact.

## Remaining deployment gates

1. Review the combined contract and worker changes against the eventual integration
   head; run the required CI/owner review, produce the approved artifact and update
   release pins only through the existing release process. No commit, push, PR,
   merge or public deployment was performed here.
2. Verify target protocol 88 support, exact accounts/bytecode, minter permissions,
   restricted worker-key methods and separate operating storage. Sandbox accounts
   use fresh full-access test keys; production key restrictions were not exercised.
3. Inventory outstanding withdrawals and payout days. Drain and reconcile old
   callbacks before upgrade. Pre-repair payout days lack settlement metadata;
   unknown status must not be guessed, reset or republished. An upgrade over actual
   historical state has not been rehearsed by this fresh-genesis suite.
4. Complete maximum-size proof/bitmap-boundary/storage testing before treating
   this as a capacity certification. An out-of-gas or missing callback remains
   pending and requires a separately reviewed receipt-based recovery; these tests
   induce mint failure, not callback exhaustion. A single batch with a mixture of
   failed and successful mint receipts remains covered by mocked regression tests,
   while the real-WASM suite separately covers all-failed batches and partly paid days.
5. Coordinate the matching contract and worker, preserve the same durable database,
   run a small owner-controlled canary and monitor pending age, mismatched commitments,
   failure receipts and treasury conservation. Keep ordinary gameplay/collection
   available and retain earned rights; add no player confirmations. Never roll
   back to the known-vulnerable withdrawal code or the old premature-close worker.

The sandbox result establishes the specified local failure/restart/replay behavior.
It does not certify the whole contract system, live deployment state, actual devices,
or every possible fault combination.

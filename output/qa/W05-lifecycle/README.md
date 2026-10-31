# Staking lifecycle observation and worker takeover hardening

31 October 2026. W05/W06 follow-up. No contract, published manifest, reward allocation or player signing key changed.

## Observed testnet state

Run `node scripts/verify-staking-lifecycle.mjs` to reproduce the read-only report. It loads only public deployment manifests, checks testnet and reviewed code, pins all contract/pool reads to one finalized block, and bounds the reads. It does not load a signer or send a transaction. The process exits nonzero for incomplete coverage or an invalid reconciliation.

The saved observation at block **275621063**, `2026-10-31T16:00:40.735Z`, reports:

- Both registered positions and their pool balances were observed.
- The pilot `v0.questlayer-vaults-20261031.testnet` remains at epoch **5399**, awaiting **5402**. Its pool `canWithdraw` is **false**.
- Pilot owner credit and owner paid are both **0**. Aggregate realized game yield paid is **0**. The live exit cycle and genuine yield-to-game transfer are still incomplete.
- Treasury funding is **0.200002 test NEAR**. Available + reserved + owed + pending + withdrawn equals funded, under the unchanged **50/50-v1** policy. Existing sponsor funding is not evidence of realized staking income.

`read-only-proof.json` records the exact block hash, position state, separate pool state, aggregate coverage and treasury amounts. The next live gate is actual pool release after epoch 5402, keeper completion of pool withdrawal, beneficiary withdrawal, and attributable realized yield received by the game. Epoch maturity alone is insufficient; this report does not forecast a wall-clock deadline or pretend to complete the live cycle.

## Implemented worker correction

| Before | After | Why |
| --- | --- | --- |
| A lease was renewed before an asynchronous read, but its result could later trigger a transaction after another worker took ownership. | Every worker send checks current ownership immediately before and after the asynchronous send. | A late lookup must not start a new send under an expired lease. |
| Several hash, retry, day and maintenance writes did not recheck ownership after asynchronous work. | The ownership renewal and each durable result/retry write are committed in one SQLite transaction. | A stale process cannot overwrite a successor's confirmed receipt, job state or day reconciliation. |
| The outer timer catch could unconditionally overwrite worker health. | Leased-run failures keep their existing owner-bound handling. Transport initialization failures only update idle/expired health that has not received a newer success. | Preserve a successor's newer status. |

Changes: `server/native/reward-worker.mjs`. Five new takeover cases in `tests/native-rewards.test.mjs` cover expired receipt reads, late send completion, publication, closure and successful/failing vault lookups. **44 focused tests passed**, including existing treasury conservation, pool/vault, pause/maintenance and receipt-ordering checks (`worker-tests.txt`).

A transaction already in flight cannot be cancelled by a SQLite lease. On-chain stable receipt IDs and the existing contract state machines remain necessary for replay protection; the next owner reconciles their actual state. No database lock is held across a network call. This fix does not claim a live crash-recovery exercise, physical wallet approval, partial-exit support, callback-loss recovery or independent contract audit. No production deployment was performed by this subtask.

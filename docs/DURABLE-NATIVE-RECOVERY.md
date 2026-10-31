# Durable native transaction recovery

31 October 2026. Implemented browser recovery slice of W03/W12; not native passkey account recovery or a global spending lock.

## Behavior

`src/confirmed-native-transaction.ts` keeps reviewed, unresolved NEAR testnet operations in `localStorage`, scoped to the QuestLayer player. Reloading or closing a tab no longer intentionally removes them. Before opening a wallet, the client reserves the operation under a same-origin Web Lock, obtains a finalized pre-sign checkpoint from the authenticated server, and persists that checkpoint. A matching unresolved operation is checked instead of signed again; a different unresolved operation for that wallet blocks a new signature.

The lock covers short journal reads/writes and the final reservation recheck plus wallet invocation; it is released before awaiting wallet dialogs or RPC calls. Other tabs can inspect the reservation while the first tab waits. Missing Web Locks, inaccessible/corrupted storage, conflicting migration data or failed persistence stop signing. A post-broadcast storage failure retains the original reservation and returns the actual transaction hash to the caller. The wallet receives a clone of the frozen reviewed transaction; callers cannot mutate the queued signing input.

The checkpoint travels as `afterBlock` on later confirmation requests. The server must reject an execution at or before that block; the client does not infer time from its own clock. Existing old-session receipts without a checkpoint remain legacy records and do not acquire an invented historical anchor. A failed checkpoint lookup releases only the unchanged, unsubmitted reservation because the wallet has not yet been called. If another tab removes or changes that reservation during the lookup, this operation cannot subsequently open the wallet.

## Migration and concurrency

`initializePendingNativeTransactions(context)` reads the old session journal and durable journal under the same lock. Matching records merge without weakening an existing checkpoint; different unresolved records remain. Conflicting IDs, hashes, checkpoints or terms fail without deleting either source. Session data is removed only after the merged durable representation has been written and read back. Old tabs still running a previous release do not participate in the new locking protocol; close/update them before relying on cross-tab coordination.

Every later mutation re-reads the current journal under the lock and compares immutable operation identity, terms, checkpoint and hash. Late errors or confirmations cannot overwrite a changed record or resurrect one already reconciled. Confirmation success alone removes a submitted record. Explicit final failures still require the user's balance/item review and a fresh server verification. Unknown outcomes have no blind discard action.

## Recovery file API

- `exportPendingNativeTransactions(context): Promise<string>` exports all this player's pending records, including missing-hash reservations, with a versioned testnet envelope.
- `importPendingNativeTransactions(context, jsonText, linkedAccounts): Promise<{imported,total}>` requires the same player and linked signer accounts. The file and journal are bounded; existing records are not evicted.
- Imports never open a wallet or authorize a transaction. Imported phase labels are reset to unresolved states. The ordinary server verifier must establish outcomes again.
- Exact repeated records are idempotent. Conflicting identity/hash/terms/checkpoint or unsupported fields fail before the merge writes anything. Importing a legacy copy cannot remove a newer local checkpoint.
- `readPendingNativeTransactions(playerId, storage?)` is a synchronous display read. Call initialization before relying on migrated records. UI updates should watch both `questlayer:native-pending` and matching browser `storage` events.

The recovery file includes account IDs, hashes, contract methods and **submitted or planned transaction arguments**, which may include profile or task text. It excludes wallet keys, seeds, browser cookies and error diagnostics. Keep it as a private receipt backup; it is not a seed phrase, wallet export or proof that an operation succeeded. Only import your own backup.

## Limits

Clearing website data, a browser eviction/private session, a different origin/profile or another device can remove or isolate this local journal. Downloaded recovery files permit explicit import after signing in to the same player and linking the signer, but do not synchronize spending across devices. A modified import file cannot authorize chain spending; it can create unresolved records requiring investigation. A legacy no-checkpoint receipt can match an older identical transaction, so wallet history must be reviewed carefully. No timing safeguard can establish that the user did not initiate another independent transaction elsewhere.

No code in this module stores a signing key or asks a server to sign. Nothing here establishes independent native passkey recovery, a hardware-device acceptance result or final on-chain settlement without the verifier. Real Safari/iOS, Chrome/Android, browser-eviction and wallet-return journeys remain explicit device acceptance work.

## Tests

`tests/confirmed-native-transaction.test.mjs` has 28 passing cases, including exact final receipts, ambiguous and cancelled wallet results, concurrent reservations, durable default storage, missing lock support, migration/corruption/quota/conflicts, safe export/import, forged imported phase, linked-player boundaries, queued input mutation, changed-record races, checkpoint persistence and pre-sign failure, legacy compatibility and no wallet opening after a reservation was reconciled during checkpoint lookup. These are deterministic module tests, not real wallet transactions.

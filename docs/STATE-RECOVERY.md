# Private state snapshots and recovery rehearsal

## Deployed scope

QuestLayer has a dedicated daily `questlayer-state-backup.timer`, scheduled at 03:20 UTC with up to ten minutes of jitter. The oneshot job has no network access, a private temporary directory, a 256 MiB memory limit, 25% CPU quota and a 120-second service timeout. It reads the game's state and writes only its own private snapshot directory. It does not restart the game or connect to a chain.

Snapshots live under `/opt/ps3000/apps/auratrail/state-backups`. The directory and each snapshot are mode 0700; snapshot files are mode 0600. They are outside every public static directory and are not copied into releases or local evidence files.

A snapshot contains:

- A consistent SQLite online backup, including committed WAL data. Its standalone file is checked with SQLite integrity verification and SHA-256.
- The bounded NFT award-attestor key, when present. This is a project NFT-issuance capability, not a player's NEAR account key.
- The native reward attestor and bounded FunctionCall worker key, when present. Neither is a player or operator FullAccess wallet key. Both are kept private and restricted to the configured testnet rewards contract.
- Images referenced by the snapshotted map-note records. Only this app's bounded, regular JPEG files are copied; path escapes, symlinks, missing images and oversized files fail the snapshot. Unreferenced upload leftovers are omitted.
- Private metadata with file checksums and completion status. It contains no raw profile, message or location values.

Player wallet seeds and signing keys are not part of the app state. The local developer operator file is never scanned or copied. Runtime API settings are outside this snapshot scope and require their own operator-controlled recovery.

## Publication, retention and failure

The process uses a lock and a private pending directory. Only a verified, complete snapshot is renamed into the completed set. A failed backup removes its own pending files and keeps earlier verified snapshots. Retention only recognizes this application's explicitly marked snapshot directories. Expired snapshots older than fourteen days are removed after a new successful snapshot; at least the newest two remain. Unknown folders are preserved.

Use `bash scripts/install-vps-maintenance.sh` to install or update the managed helper and units. It preserves previous copies of these own-app maintenance files. It runs a first snapshot before enabling the timer. Normal application releases leave this independently installed helper intact; rerun the maintenance installer after changing backup code.

The timer and snapshots stay on the same VPS. This is not an offsite or whole-host disaster recovery system.

## Recorded isolated rehearsal

The first deployed snapshot was `20261031T073259Z-c124f9f1`. `deploy/rehearse-restore.mjs` verified its checksum, private permissions and valid Ed25519 attestor. It copied only the database into a private temporary directory, opened it through the current application's database module, projected a player profile/inventory and performed an isolated write followed by rollback. Temporary rehearsal files were removed. Live application state was unchanged.

The recorded rehearsal contained four players, one linked wallet, six inventory items and the persisted world jobs/blueprints. Evidence: `output/qa/W13-recovery/live-restore-rehearsal.json`. These are aggregate observations, not a publication of player records. A newer rehearsal also verifies any referenced image checksums.

Tests cover WAL consistency, private permissions, reopen/write independence, failure without losing the previous snapshot, bounded retention and referenced-image safety. Browser-wallet, hardware-wallet and physical GPS gates remain separate.

## Before a real recovery

This script rehearses an isolated copy. It never replaces production state. An actual restore must stop writers, select and verify a concrete snapshot, restore its database and referenced media, then reconcile native claim/market state against finalized chain state. A database restore cannot undo an NFT transfer or native payment. Review session expiry and revocation rather than blindly reviving old capabilities. Do not enable real-value operations until that complete recovery procedure and financial reconciliation are independently reviewed.

Remaining operations work includes offsite storage chosen by the operator, actionable failure monitoring, restore drills across an actual host replacement, and complete release-candidate acceptance. W13.4 is building, not passed.


## Native receipt recovery, 31 October 2026

After native settlement, snapshot `20261031T125419Z-0ff09c92` included two funded-day manifests, two confirmed native receipts, the player's checkpoint progress, consent and two vault-maintenance records. `deploy/rehearse-restore.mjs ... --native` verified the restored attestor against the deployed public key and checked the worker's actual restricted FunctionCall permission. On an isolated database copy it reset one project pilot receipt to queued with no stored result or transaction hash, then ran the actual reconciler with a sender that cannot transmit. The existing chain receipt restored its original amount and XP: one recovery, zero transmissions, no live database mutation. Evidence: `output/qa/W05-W06-native/restore-rehearsal.txt`.

This closes a bounded crash-before-ack rehearsal. It does not establish offsite availability, full host replacement, personal-wallet recovery or reconciliation of every possible financial incident. Code rollback now preserves the current database so finalized chain effects cannot be silently erased by restoring an older application snapshot.

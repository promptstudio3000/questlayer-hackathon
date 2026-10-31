# QuestLayer — durable receipt recovery, worker ownership and coherent media backups

31 October 2026. This slice advances W03/W05/W06/W10/W12/W13 without marking a complete milestone passed. Testnet only; contracts, economy ratios, published worlds and signing custody are unchanged.

## Before / after / why

| Player or operator problem | Implemented behavior | Sources |
| --- | --- | --- |
| Closing a tab lost its unfinished wallet-operation journal; independent tabs could reserve concurrently. | Durable browser journal, lossless legacy migration and short Web Locks around read/modify/write and wallet invocation. Missing storage/locks stop signing. | `src/confirmed-native-transaction.ts` |
| Moving browsers had no safe way to carry receipt references. | Compact Wallet recovery disclosure with bounded private receipt export/import, same-player/linked-wallet checks and explicit confirmation. Loading a file never signs or trusts imported status. | `src/PendingNativeTransactions.tsx`, `docs/DURABLE-NATIVE-RECOVERY.md` |
| A manually chosen old receipt with identical arguments could resolve a newer unknown request. | Fresh finalized pre-sign block persisted before wallet invocation; all eight flows reject receipts included at/before it. Legacy records keep their stated limit. | `server/native/transaction-anchor.mjs`, both confirmation verifiers |
| Invalid final statuses could be mistaken for clearable failures. | Strict outcome structure, explicit boolean callback type, current linked ownership and session checks on both success and errors. | Confirmation tests and the shared API route |
| An RPC could return after a worker lost its lease. | Sends and durable result/retry writes check ownership; late responses cannot overwrite successor receipts, maintenance state or health. | `server/native/reward-worker.mjs`, `tests/native-rewards.test.mjs` |
| Removing an old photo could break a backup that had already snapshotted its reference. | Public access disappears immediately; atomic media retirement delays unlinking beyond the backup window. Bounded cleanup and snapshot deadlines preserve private backup consistency. | `server/social-content.mjs`, `server/note-media.mjs`, `deploy/backup-state.py` |

The UI alternatives were an always-visible operations dashboard versus a compact recovery disclosure with pending items when needed. The latter keeps normal Wallet use short. Reviewed terms and request date remain available for a missing-hash/legacy investigation. New controls use the existing icons, 48px targets and 16/14px text.

## Validation

- Full application suite: **299 tests passed**. Build/TypeScript passed; see `tests.txt` and `build.txt`.
- New cases cover migration/corrupt conflicts, two callers, failed writes, frozen signing input, safe import, late response ownership, pre-sign checkpoint failure, old receipt rejection, malformed callback/status handling, worker takeover, and image deletion concurrent with an earlier database snapshot.
- [Live checkpoint proof](live-anchor-proof.json) independently confirms an existing project withdrawal, accepts a reconstructed earlier boundary and rejects the receipt at its own block and after a current pre-sign checkpoint. **No new transaction was signed or sent by this proof.** It is not an actual new wallet approval journey.
- [Live staking reconciliation](../W05-lifecycle/read-only-proof.json): finalized block 275621063; epoch 5399, unlock 5402, pool cannot withdraw, owner paid 0, realized game yield paid 0. Sponsor-funded treasury 0.200002 test NEAR reconciles. A future unlock is not a completed exit or received yield.
- Contract sources did not change. The previous 100 Rust test result is historical, not a fresh contract test run for this slice.
- [Browser fixture observations and screenshots](../W03-durable-recovery/README.md) cover 360/390px, landscape, desktop, enlarged text and cross-tab confirmation. Synthetic receipts do not establish personal wallet or physical-device behavior. Actual browser download persistence remains unverified.

## Deployment and restore rehearsal

- Release **20261031T161600Z** is deployed to [QuestLayer](https://questlayer.promptstudio3000.com/). The previous deployment was backed up under the same tag. [Deployment log](deployment.txt).
- [Public verification](public-verification.json) matches the built HTML and bundle `/assets/index-C4wmYYs6.js`, reports healthy service/worker state and confirms all five checked protected routes reject unauthenticated requests. [Guest Wallet screenshot](public-wallet.jpg); no personal wallet connection or new signature.
- QuestLayer's private backup maintenance script was updated and completed successfully. The timer remains scheduled; no unrelated service was changed. [Maintenance installation](backup-install.txt).
- The isolated native restore rehearsal passed against snapshot **20261031T161628Z-18877263**: checksums, private permissions, schema, profile handling, rollback, service attestor and scoped worker-key validation. It replayed one already-confirmed project receipt in an isolated copy with **zero chain transmissions**. [Rehearsal report](restore-rehearsal.txt).
- The live database was not replaced and no offsite copy was made. Social tables were present but empty in that snapshot, so there is no live deleted-note replay proof. Concurrent media-deletion/backup behavior is covered by local tests. The first focused HTTP test attempt could not bind its local port in the restricted execution context; the subsequent full suite passed all 299 tests.

## Boundaries

Closing a normal tab no longer intentionally erases receipts. Clearing/evicting site data, private browsing, a different origin/profile and older already-running clients remain limitations. Import requires the same recovered QuestLayer player and linked wallet. The file can include planned/submitted profile or task text; it contains no wallet seed, private key or cookies and should be kept private. This is not native passkey account recovery, cross-device synchronization or a global spending lock.

No new callback is treated as safely failed merely because it is unknown. An explicit final failure may still leave changed balances/credit and requires review before reconciliation. An unresolved wallet outcome with no discoverable hash still needs wallet/provider investigation.

Note deletion revokes application access immediately. Retired originals stay private until bounded cleanup runs after 24 hours; older private backups and copies downloaded by others are independent. Current snapshot retention normally removes copies older than 14 days while keeping the newest two. Restoring an older snapshot requires reconciling later deletions, moderation and chain receipts before public use. This rehearsal does not replace the live database or constitute a full-host/offsite restore.

Physical Safari/iOS and Chrome/Android keyboard, GPS, wallet-return and independent passkey recovery remain open. Full live exit/yield cycles, private sponsored evidence, canonical Intents, creator rights and the complete V1 acceptance matrix remain in [V1 remaining](../../../docs/V1-REMAINING.md).

# QuestLayer — public notes, moderation and native receipt recovery

31 October 2026. English runtime and documentation. This is an implemented slice of W03/W05/W07/W10, not a completed V1 or physical-device acceptance.

## Before / after / why

| Before | After | Why / source |
| --- | --- | --- |
| Notes used a single long form, unversioned writes and unrestricted image URLs. | Browse/compose/blocked views, explicit public pin/photo/time consent, optional fresh GPS, operation receipts and permanent abandonment; media reads follow current visibility. | An uncertain upload must not become a duplicate or bypass a block. `src/MapNotes.tsx`, `server/social-content.mjs`, `server/note-media.mjs`. |
| There was no note reporting, owner removal or bilateral block policy. | Owner tombstones, private reports, block/unblock, local authorized review and audit records. Counts alone never hide a note. | Preserve understandable participant and operator rights. `server/social-content.mjs`, `server/cli/moderate-notes.mjs`. |
| Presence could outlive a block or stopped sharing while appearance RPC was pending. | Authentication, leases and bilateral blocks are rechecked after asynchronous work; current coordinates and identity-matched appearances are returned. | Avoid a late response revealing revoked presence. `server/presence.mjs`, `tests/presence-read.test.mjs`. |
| Several wallet flows treated optimistic execution or a false callback as success. | Seven non-task flows use exact finalized receipt and executed/current-code verification with method-specific outcomes; the eighth (sponsored tasks) uses its existing reviewed keyless-contract verifier through the same recovery journal. | A compensated transfer must not look paid. `server/native/transaction-confirmation.mjs`, `src/confirmed-native-transaction.ts`. |
| A lost wallet response could lead to another signing attempt. | A bounded per-player/account session journal reserves the operation before the wallet opens, saves its hash, survives reload and checks the same receipt. | Avoid repeating a deposit while its outcome is unknown. `src/PendingNativeTransactions.tsx`. |

## Verification

- All **268 application tests passed**, including HTTP integration against an isolated temporary database, media sanitization/orphan cleanup, operator authorization, durable note recovery, presence races and native confirmation/recovery. See `tests.txt`.
- Build and TypeScript passed (`build.txt`). A final small navigation adjustment removes the extra Community back link while composing; build was repeated after that change. Contract sources were unchanged; the previous 100 Rust tests were not rerun for this web/service slice.
- [Live read-only receipt evidence](../W03-native-confirmation/read-only-proof.json): seven existing project transactions confirmed, including NFT listing/cancellation/purchase/seller withdrawal, SocialDB profile, earned Aura and factory creation. Altered gas was rejected. An older reward receipt was deliberately rejected because its executed contract code differs from the current reviewed version. No new transaction, signature or payment was made.
- The actual position still reported epoch 5399, unlock epoch 5402, no available withdrawal and zero realized game yield paid. There is no new yield, exit-cycle or mainnet claim.

## Rendered checks

The local fixtures use synthetic in-memory responses, not production writes or wallet signatures. Browser checks exercised publication, a response lost after save (one visible note), block/hide, receipt survival after reload, confirmation, and explicit revalidation before clearing a failed receipt. Labels initially inherited an 11px global rule; scoped styles corrected them to 16px. Tested widths include 360/390, 844×390 landscape, desktop and an enlarged-text fixture. Layout observations and images are in this directory. Enlarged fixture sizing is not native OS accessibility scaling.

The deployed application's note list and compose form were inspected with the existing QA guest, at desktop and 390px. No production note, photo, report or block was submitted. The public map/identity were preserved. The form scrolls within its panel with no horizontal document overflow. Physical phone keyboard, GPS, camera and wallet-return behavior remain open.

## Data and rights boundaries

- New notes explicitly publish the chosen map anchor, text/photo and server time. Extra author GPS is separately optional; an anchor can itself reveal a real location. Demo/physical notes are separate; old unclassified notes conservatively remain in the arena.
- Photos accept bounded still JPG/PNG/WebP, remove original metadata, normalize orientation, cap dimensions/output size and bound concurrent decoding. Files are created privately and served only through current note permission checks with `private,no-store`. Deleted notes lose public content/GPS/media; orphan cleanup retries unreferenced files after a 24-hour grace period. Referenced hidden media remains for operator restoration. Already downloaded copies cannot be erased.
- Reports are private to the local operator queue. `server/cli/moderate-notes.mjs` requires an existing protected database, explicit operator audit name and explicit target/reason/apply for mutations. No browser-supplied operator identity enables moderation. This is not a staffed moderation operation or unsafe-place closure system.
- Notes are app-hosted, not SocialDB/IPFS publications. They are not protected sponsored-task evidence. Public block controls do not establish global anonymity or prevent a new account from seeing public content.
- The wallet journal stores only reviewed transaction terms and references in this browser tab/session; no wallet private key or seed. Unknown missing-hash outcomes require checking wallet history. Closing/clearing the session loses this local aid; it is not a global or cross-device spending lock. A final failed transaction may still have changed balances or left a recoverable credit.
- Demo/native ledgers, the 50/50 game buckets, sponsored-task escrow and existing published days remain separate. Creator XP commitments, paid access, creator allocations and canonical Intents remain unfinished.

## Deployment

Release **20261031T155058Z** is live on `https://questlayer.promptstudio3000.com/`. See `deployment-final.txt`, `server-state.txt` and `public-verification.json` for service health, protected routes and the exact served build. Previous runtime and private database backups remain on the same VPS. The remaining product gates are in [V1 remaining](../../../docs/V1-REMAINING.md).

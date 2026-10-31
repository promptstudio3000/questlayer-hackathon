# Native map, progression, recovery and inventory delivery

31 October 2026. Experimental testnet; no monetary-value tokens. No contract bytecode change in this delivery.

| Before | After | Why |
| --- | --- | --- |
| Native walks lived beside a demo-oriented map | Explicit NEAR map projects the actual published native day | Prevent demo targets/balances from masquerading as native rights |
| Native contract XP did not unlock game cosmetics | Finalized, pinned XP unlocks deterministic once-only level 2/3/4 Aura grants | Connect walks/coins with actual inventory rights |
| Guest/wallet sessions had no recovery overview | Own session list, fresh NEP413 verification, revocation and retained-cookie rotation | Support independent wallet recovery without server-held player keys |
| Inventory led with setup and explanations | Character, two equipped slots, collection and selected-item actions first | Reduce clutter and make equipment discoverable |
| In-flight polls could swallow a fresh update | One sequential read plus an awaited bounded follow-up | Avoid stale accounts or delayed checkpoint feedback |

Verification: `tests.txt` records 168/168 passing application tests, including finalized-state/replay/expiry/code-signer guards, current-cookie copying, revoked/in-flight sessions, wrong origin/purpose/account, database rollback/restart, map manifest integrity, amount/quote bindings and asynchronous account refresh races. `build.txt` records a successful production build. The historical 69 Rust tests belong to the preceding unchanged contract release.

Rendered checks use the in-app desktop browser at 360×640, 390×844, 844×390 and 1280×720. A 390×640 iframe fixture additionally forces 32px body-control text as an enlarged-text approximation; this is not physical-device or native browser-zoom evidence. Native wallet cancellation and missing-XP states are deliberate fixture scenarios, not actual transactions. The demo listing error keeps 12.5 GOLD entered; Tab reaches the listing action, Escape closes the modal and restores the selected-item trigger. No horizontal overflow was observed in the ordinary narrow/landscape checks.

Screenshots include the actual application inventory, item listing failure, short-landscape keyboard focus and enlarged-text fixture. Physical Safari/iOS, Chrome/Android, real GPS, anti-spoofing and newcomer field play remain unverified. Native auto-collection, richer native quest policy, passkey-native signing, complete yield/withdrawal lifecycle, canonical Intents and creator/community rights remain in `docs/V1-REMAINING.md`.

## Live testnet proof and deployment

Source commit `6e5d669` was deployed as release `20261031T142510Z`, with a private pre-deployment backup and healthy worker. A follow-up corrects native zone paint colors, guest labels and reload mode continuity; its final release is recorded in `deployment-final.txt`.

The project pilot completed nine confirmed synthetic-GPS street coin receipts, moving native XP from 82 to 100. It minted level-2 Aura `aura:polar:3`, proved zero-deposit replay creates no second NFT, equipped the owned token Above and selected its native outfit through the actual application API. One 0.05-test-NEAR mint deposit was attached, plus normal gas; equipment and replay attached zero. No personal wallet or demo XP was used.

Fresh NEP413 recovery revoked four other pilot sessions, retained one with a new cookie and rejected the copied prior cookie (HTTP 401). The proof ran through a temporary loopback-only QA service on the VPS and an SSH tunnel. Signing attestors stayed on the VPS and the project wallet key stayed local. The regular public worker processed the shared accepted-receipt ledger; there is no isolated ledger to lose or merge. The QA service and tunnel were stopped after the proof.

Evidence: `public/native-progression-proof.json` and `output/qa/W04-W06-progression/native-progression-proof.json`. These prove protocol integration with simulated coordinates, not physical visits, mobile-wallet approval, anti-spoofing or mainnet readiness.

The map follow-up passed both focused map tests; the final production build includes the public proof. Native coin tap → coin card and native zone → its checkpoint card were exercised in the actual browser. The initial local signer mismatch correctly refused the live rehearsal before visits; no signing key was exported to bypass it.

## Final release confirmation

Runtime source `5a84004` is deployed as `20261031T144514Z`. The service is active/running, reports zero automatic restarts and about 95 MB of memory; the temporary QA service is inactive. The public worker reports no error and no queued receipts. The public proof returns HTTP 200; an unauthenticated session-list request returns HTTP 401. Native mode persists through a browser reload. Final public screenshots show the inventory and the actual painted native checkpoint zone. Reward acknowledgements render at 16px with the semantic secondary text color; the dark compact objective uses a light readable secondary color.

The latest pool observation is still epoch 5398 versus unlock epoch 5402. Realized game yield remains zero. No completed pool withdrawal/yield-cycle claim is made. See `public-verification.json`, `server-state.json`, and `deployment-final.txt`.

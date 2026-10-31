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

Deployment and live synthetic-GPS proof results are appended after verification; source implementation alone does not establish either result.

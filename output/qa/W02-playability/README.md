# Playability, reusable quests and native operations evidence

31 October 2026. Local Chromium-based in-app browser inspection; no physical iOS/Android device, personal wallet signature or physical GPS claim was performed. Product text and records are English. The three delegated slices were integrated by the coordinating agent.

## Before / after / why

| Observed/source problem | Delivered change | Purpose |
| --- | --- | --- |
| Published Wallet stacked an expedition introduction, capacity/tier prose, staking setup and the full demo economy. `before-wallet.png` records the old surface. | Separate Rewards / Staking / Demo sections. Testnet walks moved to Explore. | Each screen has a specific player action, and demo credit never implies native buying power. |
| Zone selection rendered three complete quest forms, including when the recommendation targeted the third chest. | One selected activity, a compact alternative picker and map markers that select the matching activity. | A recommendation opens the actual next action. |
| Native board was below setup paragraphs and exposed all walks together. | One walk, progress stops, primary map/check-in action, concise prerequisite and collapsed alternatives/receipt details. | Find an objective before reading operations. |
| All position actions had equal weight. | Read-only summary; deliberate Manage/Create disclosures with cost/acknowledgement at creation. | Preserve financial meaning while reducing noise. |
| Game fund occupied primary navigation and notes/tasks were scattered. | Community contains existing notes/tasks; Game economy is under Wallet and Settings. | Prioritize exploration and collection while keeping transparency accessible. |
| Economy could be understood only through raw native details. | Confirmed aggregate observations, explicit missing/stale states and conserved 50/50 buckets. | Never confuse principal, sponsorship, pending transfers or forecasts with spendable yield. |
| Final route stop and reward were separate transactions. | One atomic final transition, with rollback and successful retry tests. | Prevent a completed route from being stranded without its reward. |
| Paused/failed claim pass stopped vault maintenance. | Independently verified maintenance runs under the same lease; original claim ordering/errors remain. | Existing withdrawals can progress while settlement needs attention. |

The alternatives considered were another always-open stacked panel, a modal wizard for every action, and deliberate inline disclosures. The latter preserves context without introducing repeated navigation. Original financial/privacy disclosures remain at relevant decisions.

## Automated and HTTP verification

- `npm test`: **139/139 passed**. Includes 15 native economy tests, paused/failed settlement maintenance, malicious vault changes, deterministic template generation, native-v1 hash fixtures, return-fix replay rejection and injected final-receipt failure recovery.
- `npm run build`: TypeScript and production build pass. No dependency added.
- Contract source/bytecode did not change. The previous release's 69 Rust tests are historical evidence, not claimed as rerun for this slice.
- HTTP `/api/quest-templates`: four implemented templates with explicit policy activation/scope. `/api/native/economy`: verified and treasury conservation true. See `http-observation.json`; it contains aggregates, no private keys, player session or GPS trail.
- Existing native manifest hashes remain pinned by tests. New return-trail content applies only to unprepared demo plans from 2 November 2026; already-issued worlds retain their requirements.

## Browser interaction evidence

Observed in local app and controlled development fixtures:

- Guest demo entry, selected recommended chest, explicitly simulated movement, actual server-confirmed 80 XP/Aura result, equip and matching map appearance.
- Testnet board loads real public testnet data. Show next stop returns to a compact map objective; Open task restores the same walk.
- 360×640: the primary native action measured 262×48 CSS px, within the panel/viewport. No page horizontal overflow. Body16px, secondary14px; computed secondary ink rgb(102,85,119).
- 390×844: map/board and separate wallet surfaces reviewed. Non-map details can intentionally cover the map.
- 844×390: deliberate economy detail remains scrollable; 1280×720 desktop review is separate from phone evidence.
- Controlled staking fixture: 390×420 reduced-height viewport with body/control text at32px. Invalid `-1` disables Stake and explains the error. Valid `0.025` survives simulated wallet cancellation. This is a larger-text/keyboard-space simulation, not a physical keyboard or browser-zoom proof.
- Setup disclosure shows3.52 test NEAR, separates storage reserve/fee from stake and requires acknowledgement before Create is enabled. Fixture signing is stubbed and transfers no funds.
- No personal wallet was connected and GPS permission was not granted. Linked-wallet physical receipt, wallet switching and hardware flows therefore retain their explicit acceptance gates.

Screenshots record named states. Development fixture values are clearly labeled as examples and are not included in the production build.

## Remaining limits

This release does not close W02 or the full native lifecycle. Required follow-up includes physical Safari/iOS and Chrome/Android, actual assistive-technology checks, newcomer playtests, real public-path access, native XP/level integration, wardrobe/market/form consistency, full realized-yield/withdrawal proof and independent security review. See `docs/V1-REMAINING.md` for the implementation order.

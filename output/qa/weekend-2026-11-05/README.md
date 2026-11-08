# Weekend implementation evidence — 5 November 2026

Local work based on `e9160028637cda7785cae02acd9ea3e299525c17` after fetching the integration branch.
PR #206 is already merged. This delivery has not been pushed, merged or deployed. Existing untracked artwork and
`public/treasury-mix-testnet.json` were preserved. Financial changes in the fetched base were retained.

Implementation commit: `68497805f5a0505f8dd1a6e70cb1393661a52d59`. Machine summary: `verification.json`.

## Implemented behavior

The map is home. The avatar opens Profile, two small shortcuts open Inventory and Community, and one objective
holds the next action. Screens use the available viewport while the map keeps its camera and selection. A confirmed
completion releases its finished target on return. Install offers keep clear of the map tools and demo controls and wait while content owns the screen. The demo controls remain open in one row, with 48px buttons,
a Run toggle and a collapse action; GPS play never renders them. Target distance appears by the objective.

Inventory keeps a four-column collection with a smaller character/equipment summary. Profile has Character, Badges,
Stake, Rewards and Settings; help links live in Settings. Community has Quests, Tasks, Local chat, Places and Creators.
Local chat remains the existing public nearby-note feed with its existing consent, privacy and moderation rules.
NPCs and monsters use full-screen encounters. Unsent NPC text is scoped to the explorer, world and actor and survives a return or reload; successful sending clears only its submitted revision. Rune tracing supports arrows and Space/Enter; submitted results use
server responses, retries keep the recorded inputs and the completion callback is deduplicated by challenge ID.

## Before / After / Why

Source findings are changes in code; observed behavior refers only to the local browser runs below.

| Before (source + baseline observation) | After (local observation) | Why / source |
| --- | --- | --- |
| Four-item navigation, expanded controls and several competing map layers | Two shortcuts, one objective, one-row demo controls; no overlapping essential controls at the checked sizes | [src/App.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/App.tsx), [src/map-objective.ts](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/map-objective.ts), [src/phone-map.css](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/phone-map.css), [src/DemoControls.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/DemoControls.tsx), [src/demo-controls.css](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/demo-controls.css) |
| Large character card before collection | Compact character/equipment summary before the existing four-column collection | [src/inventory-game.css](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/inventory-game.css) |
| Profile/menu information split across locations | Five profile tabs; avatar opens Profile; Help and sharing in Settings | [src/screens.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/screens.tsx), [src/BadgeBook.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/BadgeBook.tsx), [src/ScreenTabs.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/ScreenTabs.tsx) |
| Notes label and some blank unavailable screens | Local chat label, authored unavailable/empty illustrations and retry states | [src/MapNotes.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/MapNotes.tsx), [src/CreatorCommunity.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/CreatorCommunity.tsx), [src/lazy-panels.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/lazy-panels.tsx) |
| NPC modal sizing overrode the full-screen shell | Full-screen NPC with short greeting, portrait, 48px actions and visible error recovery | [src/Dialog.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/Dialog.tsx), [src/NpcSheet.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/NpcSheet.tsx), [src/npc-sheet.css](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/npc-sheet.css) |
| Rune tracing required a pointer; repeated input could race completion | Keyboard cursor uses the same sampled coordinates; in-flight guard, retry and completion deduplication | [src/MonsterChallenge.tsx](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/MonsterChallenge.tsx), [src/monster-challenge.ts](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/monster-challenge.ts) |
| Stored fallback titles participate in historical world hashes | Improved titles only at display time; stored plans retain their exact historical hashes | [src/quest-copy.ts](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/quest-copy.ts), [server/landmark-clue.mjs](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/server/landmark-clue.mjs) |
| Old runtime/wiki claims conflated deployment and implementation | Dated public checkpoint and separate local work; 22 reviewed chapters with corrected descriptions | [docs/STATUS.md](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/docs/STATUS.md), [src/wiki/chapters.ts](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/src/wiki/chapters.ts) |

[Baseline map](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/output/qa/weekend-2026-11-05/before/phone-390-map.png) · [Current map](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/output/qa/weekend-2026-11-05/phone-390-map.png) ·
[Inventory](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/output/qa/weekend-2026-11-05/phone-390-inventory.png) · [Profile](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/output/qa/weekend-2026-11-05/phone-390-profile.png) ·
[Community](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/output/qa/weekend-2026-11-05/phone-390-community.png) · [NPC ready](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/output/qa/weekend-2026-11-05/encounters/npc-ready.png) ·
[NPC retry](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/output/qa/weekend-2026-11-05/encounters/npc-failed.png) · [Confirmed monster result](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/output/qa/weekend-2026-11-05/encounters/monster-confirmed.png)

## Status of all 16 tasks

| Task | Delivered changes | Evidence |
| --- | --- | --- |
| U1 | Map home, compact HUD, unified objective priority, two shortcuts, full-screen navigation; one-row controls per owner review | `report.json`, four viewport screenshot sets; [tests/map-objective.test.mjs](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/tests/map-objective.test.mjs) |
| U2 | Smaller hero/equipment, four columns retained, existing short item details and equipment flows | Inventory screenshots and first-session equip checks |
| U5 | Five profile sections, settings within two taps, Help links and badges in pages of 12 | Profile screenshots, language scans, keyboard/Escape checks; largest default phone section is 1,140px at 844px viewport height |
| U6 | Five community sections, Local chat name and meaningful unavailable/empty states | Community screenshots and all five tabs in every language |
| U3 | Short NPC presentation, full screen, accessible tabs, initial failure retry | `encounters/report.json`, `npc-failed.png`, `npc-ready.png`, `npc-accepted.png`, keyboard/enlarged text captures |
| U4 | Five challenge formats, keyboard tracing, submission retry and result deduplication; reduced-motion cues | `minigames/report.json`, real API quiz in `encounters/report.json` |
| G1 | Eight additional quiz questions and shorter English/Czech NPC lines | Text-only content diff; existing quiz/persona validators |
| G2 | More natural landmark prompts and display-only fallback quest titles | Landmark/world-layer tests, including pinned historical plan hashes |
| U7 | Shared lazy-panel loading/error states, illustrated empty states, badge retry and NPC/monster recovery; drafts retained | Local-chat offline/resume and welcome lost-response checks; NPC retry and draft restoration |
| T1 | Landmark invalid inputs/date boundaries/privacy/replay persistence and server-scored keyboard trace paths | [tests/weekend-game-boundaries.test.mjs](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/tests/weekend-game-boundaries.test.mjs); coverage run |
| T2 | Real local NPC errand acceptance and monster quiz with server-confirmed result | [scripts/e2e-encounters.mjs](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/scripts/e2e-encounters.mjs), synthetic positions + real local API/UI |
| P1 | Daily board, season and landmark UI deferred from welcome | Initial JS 206 → 201 KB gzip; 690 → 673 KB raw; CSS 36 → 35 KB gzip; unchanged budget |
| Q1 | All new text translated, unused menu keys removed, every main tab checked in all languages | 2,934 / 2,934 keys in each of ten dictionaries; language report |
| W1 | All 22 chapters reviewed; corrections include level power, ledger state, payouts, Local chat, account routes, counts and unsupported assurances | Wiki checks and stamps; source pointers in each chapter |
| D1 | Current public health separated from local implementation and dated historical reports | [docs/STATUS.md](/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON/docs/STATUS.md), `public-health.json` (read-only GET, 21:57 UTC) |
| A1 | Focus/return/Escape, RTL arrow keys, contrast corrections, 48px map controls, enlarged text, reduced motion and keyboard viewport checks | Axe scans and geometry in `report.json`; encounter and first-session scans |

## Verification scope

All stateful runs use throwaway databases and a clean temporary working directory without the project's `.env` or
existing application data. Relayer/native attestations are disabled; the RPC points at an unused loopback port.
Public production access was limited to a read-only GET of `/api/health`.

- `npm ci` with Node 24.21.0; no dependency or lockfile changes.
- `npm run check`: build, unchanged bundle budget, application tests and mainnet configuration tests with fakes.
- Coverage run: 1,278 application tests; 92.58% lines, 84.30% branches, 89.51% functions overall. This is a measured
  snapshot, not a claimed percentage improvement. Landmark clue reaches 100% lines; objective priority 100%.
- `node scripts/e2e-weekend.mjs`: Chromium at 360×780, 390×844, 844×390 and 1440×900; real basemap loaded,
  full-screen/inert-map checks, no page overflow, essential 48px controls, one-row pad and Escape/focus return.
- Axe checks cover the map and all 13 primary tabs at 390px, with zero serious/critical findings in the final scan.
- `node scripts/e2e-minigames.mjs`: all five formats with keyboard and emulated touch. Deterministic clocks and
  actual server scorers validate rhythm, trace and memory. Duel transport is a fixture; it checks input/response UI,
  not live duel settlement. The separate quiz journey uses the real local API and confirms one result.
- `node scripts/e2e-encounters.mjs`: initial NPC response lost, retry, errand accepted; real quiz victory confirmed.
- `npm run e2e:languages`: all 11 UI languages × 15 screens, no detected overflow or untranslated visible keys;
  Arabic uses RTL. English/Czech copy and new translations were reviewed; no native-speaker certification claimed.
- Enlarged text uses 200% computed text sizes. Simulated denied GPS stays in the arena; an inaccurate fix is displayed honestly and removes manual movement. Shorter viewports simulate keyboard occlusion; these are not
  measurements of real iOS/Android soft keyboards.

## Final command summaries

| Check | Result |
| --- | --- |
| `npm run check` | PASS: 1,278/1,278 application tests; mainnet configuration pass 1,109 passed / 19 skipped; build and unchanged bundle budget passed |
| Protected paths, base `e916002` | PASS; no protected source/dependency/CI changes |
| First session — phone-390 | PASS, Chromium |
| First session — iPhone 15 profile | PASS, WebKit; install offer clears controls and yields to full-screen content |
| First session — Pixel 7 profile | PASS, Chromium |
| All five minigames × keyboard/touch | PASS, 10 combinations; ready-state captures at all four sizes |
| Real local NPC/quiz journey | PASS, including lost response, accepted errand, restored unsent text, keyboard viewport and enlarged text |
| Languages | PASS, 11 languages × 15 screens; 2,934 complete keys per dictionary |
| UI matrix | PASS, 360/390/short landscape/desktop; 14 map/main-tab axe scans with no violations; map camera, GPS denial/inaccuracy, drafts, 48px controls and two-height profile checks |
| Wiki | PASS, 22 chapters; source review matrix in `wiki-review.json`; phone layout checked |

The integration branch was fetched again before delivery and still points to the same `e916002` base.
The local preview is available at http://127.0.0.1:8788 with an independent test database.
Raw command logs are in `logs/`; browser reports and screenshots are beside this file.

Proposal-only items: none in the agreed local implementation scope. Owner composition review and the device/release
gates below remain separate from implementation.

## Remaining limitations and separate decisions

- Physical iOS Safari and Android Chrome, real GPS permission/accuracy transitions and on-device touch/keyboard
  behavior remain unverified. Browser profiles and synthetic positions do not replace these hardware checks.
- Default 3D rendering performance on physical phones and geography/access in the field require separate review.
- The deterministic duel response fixture does not prove network duel settlement; existing server tests cover its
  rules, and the real API journey here proves quiz settlement only.
- No economic terms, public API, data format, contracts, keys, deploy scripts, dependencies or CI were changed.
  Financial paths were not exercised against the public host. A healthy endpoint is not a financial audit.
- No PR, push, merge or deployment was performed. CI and owner review remain separate from these local checks.

# QuestLayer compact guidance — implementation review

The three approved UI parts are implemented on stacked weekend branches. Merge order: activity clarity (#219), first-play guide (#220), encounter help. Every PR targets `claude/upbeat-gauss-5czir7`. No merge or deployment was performed. Original checkout changes were preserved in their original worktree.

Open [the screen gallery](review.html) for rendered UI, rather than the earlier generated concepts.

## Implemented

- Explore is directly reachable from compact navigation. Actual Visit, Trail, There and back, Place hunt, Landmark clue and Chest choices appear above details. Inspecting a place leaves the current adventure intact; Start / Show on map commits a new objective.
- New explorers without a deep link get one skippable illustrated guide. Continue enables brief translated tips; Skip/Escape keeps them quiet. Returning sessions do not reopen it. Automatic pickup requests and queued wearable moments wait until the guide closes. Help can reopen the guide without enabling teaching, and can toggle first-time tips.
- Teaching lives inside existing objectives and native disclosures. Browser/player-scoped preferences acknowledge topics separately for GPS and demo controls. Teaching cannot prove completion, unlock an item or grant a reward. Automatic copy does not call AI.
- NPCs expose two current offers directly, preview actual steps before acceptance and return to the confirmed unfinished quest. The compact original portrait and complete name fit beside one another on phones. All other offers, services, drafts and provenance remain accessible.
- Quiz, rhythm, rune path, memory and duel have optional local examples before a real start. A known format retains direct start. Question controls reopen examples manually. No help opens automatically during timed play. Boss help explains shared progress and offers examples without sending a strike.
- Confirmed Aura results explain their cosmetic role, retain ownership freshness checks, and preserve the durable receipt and optional equip/share actions. Offline, distance, footprint, closed and GPS reasons stay visible independently of teaching preferences.

## Before / After / Why

| Before (source and previously observed UI) | Implemented after | Why / owning source |
| --- | --- | --- |
| Place choices were below Learn more and lists mostly described XP visits. | Actual activity kinds and visible choices precede detail. | Discover the next playable action. `src/activity-view.ts`, `src/QuestBrief.tsx`, `src/App.tsx` |
| Browsing could clear the selected adventure while a direction target remained. | Browsing is a separate temporary view; explicit Start selects a new adventure. | Preserve the next step on close/reload. `src/App.tsx` |
| Compact first-session text was hidden and guide text depended on an AI response. | Prepared translated copy inside the objective; one-time topic preferences. | Explain the action immediately and stay quiet afterward. `src/FirstSession.tsx`, `src/learning-store.ts`, `src/activity-help.ts` |
| New account creation immediately entered the map. | One illustrated, skippable guide before map interaction. | Explain explore → solve → wear without mandatory paging. `src/GameIntro.tsx` |
| NPC greeting added a generic Continue before task choices. | Current offers appear beside a smaller original portrait, with previewed steps. | Shorten the path to a real task. `src/NpcSheet.tsx`, `src/npc-sheet.css` |
| Selecting a mini-game created the server attempt before teaching. | A local example precedes the explicit Start challenge for an unfamiliar format. | Learning consumes neither the real timer nor a try. `src/MonsterChallenge.tsx`, `src/ChallengeExample.tsx`, `src/BossFight.tsx` |
| Optional securing/sharing remained an automatic coach step. | First adventure ends with equipment; receipt history retains deliberate optional sharing. | Keep the solo loop focused. `src/App.tsx`, `src/AdventureResults.tsx` |

## Verification

- `npm run check`: build, unchanged bundle budget, 1562 application tests passed; 1380 isolated guard tests passed, 19 skipped. No real chain operation was used. First screen: 210 KB gzip JS, 694 KB raw, 35 KB gzip CSS; unchanged limits passed.
- `scripts/e2e-learning.mjs`: Continue, Skip/Escape, reload, manual Help, focus return, quiet experienced flow, zero reward/AI-guide requests at 360/390, short landscape and desktop. Additional final 390 runs confirm deep-link creation is uninterrupted and reloading an unfinished introduction restores a usable, quiet session. Enlarged text and reduced-height input are simulations.
- `scripts/e2e-intro-pickups.mjs`: an explicitly synthetic UI coin at spawn sends zero requests while the intro is open and resumes only after Continue. Every resulting claim is intercepted and aborted; no reward request reaches the server. The introduction remains the only modal.
- `scripts/e2e-compact-guidance.mjs`: actual isolated App/API at 360/390/844×390/1440×900. Activity selection sends zero claims; browsing/reload preserves the same next step. Serious/critical 390 accessibility and 48px essential-control checks passed.
- `scripts/e2e-encounters.mjs`: actual isolated server accepted an NPC errand and supplied the unfinished target; message draft reload, reduced-height input, enlarged text, four widths and a 390×664 greeting passed. A real quiz response confirmed one win. Original portrait stays contained.
- `scripts/e2e-challenge-learning.mjs`: actual encounter components with explicit synthetic browser responses. All five examples send zero POSTs; explicit start sends one. Known-format bypass, manual question controls, focus return, no teaching during a running challenge, and boss examples without a strike passed. Chromium tests keyboard and emulated touch for all five formats. WebKit tests keyboard for all five and touch for four (trace touch is Chromium-only in the harness). English, Czech and Arabic examples were checked; reduced motion, enlarged text and 360/390/landscape/desktop were included.
- `scripts/e2e-linear-adventures.mjs`: real local claim → confirmed receipt → equip → identical durable replay at all four widths; inaccurate GPS, outside-footprint, offline, failed claim and explicit retry, zone entry/exit and uncertainty, confirmed wearable pickup and no reload replay passed.
- `npm run e2e:first-session -- --device=phone-390`: complete final local journey passed, including optional sharing from History and existing collection/community flows. `e2e:world` passed Brno, a village and an empty spot; `e2e:bonus-vote` passed after explicitly continuing through the new introduction.
- `npm run e2e:languages`: all 11 languages, 16 screens each, clean after introduction integration. All 3005 current UI keys have translations in all ten dictionaries with zero unused keys. Mini-game render checks above supplement this screen suite.
- Wiki chapters were reviewed and stamped. Local protected-path checks pass. Scripts, screenshots and JSON reports are retained here.

## Evidence provenance and remaining checks

`guide/`, `final-guide/`, `final-map/`, `final-results/`, `final-first-session/` and `final-world/` show the actual local App/API with disposable players and synthetic locations where applicable. `encounters/npc-*` and `monster-*` use the real local encounter API; `example-*`, `before-start-*`, `boss-help-*` use real components and synthetic browser responses to establish that practice cannot start a real attempt. These are implemented screens, not generated mockups.

Physical Safari/iOS and Chrome/Android phones, a real software-keyboard resize and a five-person newcomer study remain unverified. No usability score or real-device performance result is claimed. The human study and any later tuning remain follow-up work.

The remote Protected paths check is currently absent from these PR check lists. The integration branch contains its workflow, but the repository default `main` returned 404 for that workflow path. The trusted local guard passes; CI files were left untouched under the handoff rules. The owner needs to restore the remote guard before merging. Other remote results are tracked on the PRs.

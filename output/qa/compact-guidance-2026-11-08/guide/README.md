# First-play guide and compact help

Implemented UI, not concept art. Actual isolated App/API with disposable local explorers and no wallet or public host.

| Before | After | Why / source |
| --- | --- | --- |
| Account creation entered the map without a concise explanation. | One skippable illustrated screen, manual reopening in Help. Restored sessions and deep links stay uninterrupted. | `src/GameIntro.tsx`, `src/App.tsx` |
| First-session help depended on an AI guide response and was hidden by compact layout. | One translated sentence inside the objective, separate GPS/demo topics. | `src/FirstSession.tsx`, `src/activity-help.ts`, `src/phone-map.css` |
| Teaching and the optional secure/share step stayed automatic. | Browser/player preferences remember acknowledged topics; Skip keeps automatic coaching quiet. Sharing remains available from reward history. | `src/learning-store.ts`, `src/useLearning.ts` |
| Activity explanations lived in long details. | How this works opens inline, without another overlay. | `src/ActivityHelp.tsx`, `src/QuestBrief.tsx` |

## Verified

- `npm run check`: 1559 application tests passed; 1377 isolated guard tests passed, 19 skipped; build and unchanged bundle budget passed.
- Five storage tests cover restored sessions, Skip, per-player and movement separation, malformed and blocked browser storage.
- `scripts/e2e-learning.mjs`: Continue, Skip/Escape, reload, manual Help, focus return and zero claim/AI-guide requests at 360, 390, 844×390 and 1440×900. 390 serious/critical accessibility scan passed.
- Enlarged-text and reduced-height input captures are browser simulations. Reduced motion was enabled for interaction runs.
- Full first-session and language journeys are run again with the completed combined change; their final results are recorded in the encounter delivery evidence.

## Limits

No physical iOS/Android phone, real keyboard resize, human newcomer study or production deployment was used. Teaching preferences prove no gameplay completion or reward.

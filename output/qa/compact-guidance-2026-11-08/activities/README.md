# Activity clarity — local verification

Player problem: discovering another place erased the active objective, and the other activities at a place were hidden in secondary information.

| Before (source and local observation) | After | Why / owning source |
| --- | --- | --- |
| Opening discoveries cleared the saved selection. | Browsing and inspecting a place are temporary; Start/Show on map selects the adventure. | Preserve the player's next action — `src/App.tsx`. |
| Alternative activities were inside Learn more. | A visible activity picker precedes the detail. | Make current gameplay variety discoverable — `src/QuestBrief.tsx`. |
| All places looked like XP visits. | Place rows name their actual activity categories. | Explain the choice — `src/activity-view.ts`. |
| The compact objective only said In progress. | It shows the server's next stop and truthful straight-line distance; survives reload. | Keep the next action legible — `src/App.tsx`. |

Validation: Node 24, `npm ci`, `npm run check` passed (1554 application tests; 1372 mainnet-guard tests passed and 19 skipped). These guard tests do not access or verify mainnet. The existing welcome bundle budget passed unchanged.

`node scripts/e2e-compact-guidance.mjs` passed on Chromium at 360×780, 390×844, 844×390 and 1440×900. It uses the actual local App/API with disposable explorers. Browsing another place and reload retained the selected activity and checkpoint. Starting submitted zero claim/checkpoint requests. The 390px map passed the serious/critical accessibility and essential 48px target checks. Images and `verification.json` record those runs.

No game rules, rewards, dependencies, signing state or deployment were changed. No physical iOS/Android testing or newcomer study is claimed.

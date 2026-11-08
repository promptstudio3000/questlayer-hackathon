## What and why

<!-- One task from docs/HANDOFF-WEEKEND.md (task id, e.g. U2), the player problem, the scope. -->

## Checklist

- [ ] Branch `weekend/<task-id>-<slug>`, base `claude/upbeat-gauss-5czir7`, one task per PR
- [ ] No file under a protected path (`node .github/scripts/protected-paths.mjs --base origin/claude/upbeat-gauss-5czir7` passes)
- [ ] `npm run check` passes locally; all CI jobs green
- [ ] Mechanism changed → chapter in `src/wiki/chapters.ts` updated and `npm run wiki:stamp` run
- [ ] Player text in English, translated keys added (`npm run i18n:keys`)
- [ ] No mention of the hackathon or judges on public pages
- [ ] UI change: screenshots at 360 px, 390 px, short landscape and desktop attached

## Verification

<!-- Commands run, screenshots, what is still unverified (real devices). -->

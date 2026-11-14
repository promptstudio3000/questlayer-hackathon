## What and why

<!-- The player problem and the scope of this change. -->

## Checklist

- [ ] Base `claude/upbeat-gauss-5czir7`, one task per PR
- [ ] No file under a protected path (`node .github/scripts/protected-paths.mjs --base origin/claude/upbeat-gauss-5czir7` passes)
- [ ] `npm run check` passes locally; all CI jobs green
- [ ] Mechanism changed → chapter in `src/wiki/chapters.ts` updated and `npm run wiki:stamp` run
- [ ] Player text in English, translated keys added (`npm run i18n:keys`)
- [ ] No mention of the hackathon or judges on public pages
- [ ] UI change: screenshots at 360 px, 390 px, short landscape and desktop attached

## Verification

<!-- Commands run, screenshots, what is still unverified (real devices). -->

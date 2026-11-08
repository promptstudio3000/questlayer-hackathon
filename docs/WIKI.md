# Project wiki (/wiki)

The wiki at `/wiki` is the project's know-how center: every mechanism that is in force, explained in
chapters with diagrams, charts and small simulators. It is public and read-only, English only, and loads
as its own lazy chunk (the game never downloads it).

Code: `src/wiki/` (`chapters.ts` content, `diagrams.tsx` pictures, `viz.tsx` SVG primitives, `WikiPage.tsx`
layout, `wiki.css`). Route in `src/main.tsx`. Related public pages: `/how-it-works` (player intro),
`/economy` (public ledger) and `/treasury` (treasury dashboard); the wiki links to all three.

## Rule: a mechanism change is not done until its chapter is

Every change that adds or changes a mechanism (rules, numbers, contracts, money paths, workers,
integrations) updates the matching chapter in `src/wiki/chapters.ts` in the same pull request.

CI enforces this through `tests/wiki.test.mjs` (part of `npm test`), using `scripts/wiki-check.mjs`:

1. Every path in a chapter's `sources` must exist.
2. Every `docs/*.md` must be a source of some chapter, or be listed in `docs/wiki-coverage.json`
   `notMechanisms` (plans, audits, hand-offs, reports). A new mechanism doc therefore has to be placed.
3. `docs/wiki-stamps.json` stores a hash of every `docs/*.md` source. When such a doc changes, the test
   fails until the chapter has been reviewed and the hashes are recorded again.

The workflow:

```sh
# 1. change the mechanism and its doc in docs/
# 2. update the chapter text (and its `updated` date) in src/wiki/chapters.ts
npm run wiki:stamp   # 3. record the reviewed docs
npm run wiki:check   # optional: the same check the test runs
```

Only stamp after reading the chapter against the change. A stamp without a review defeats the point.

## Content rules

- Numbers that live in rules files are imported, never copied: the level table, staker gates, GOLD
  prices, Aura catalog, place badges and city registry come straight from `server/data/`.
- Live diagrams read public endpoints only (`/api/treasury/mix`, `/api/economy/qgold`) and fall back to
  the documented targets.
- Every chapter has an honest status: live, partly live, built but switched off, or planned.
- Never mention events or presentations, and never include secrets, keys, private hosts or file paths of
  key material. The test checks the copy for event words.
- Markup inside chapter text is limited to `**bold**`, `` `code` `` and `[label](/path)`.
- New pictures: add a `VizId` in `chapters.ts` and a component in `diagrams.tsx`, preferably built from
  the primitives in `viz.tsx` (Flow, Sequence, LineChart, Bars, StackBar, Donut, Timeline24). Motion is
  CSS only and stops under reduced motion.

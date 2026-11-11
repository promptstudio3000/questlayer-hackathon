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

## Chapter shape: short first

Every chapter reads in three layers, so the page stays short and a reader gets the point without scrolling:

1. **TL;DR** (`tldr`): one or two sentences, 60–320 characters, that say what the mechanism does for a player.
2. **Key numbers** (`keyFacts`): two to four tiles of `[value, label]`, a value short enough for a tile
   (≤ 24 characters) and a label of at most 60.
3. **One picture** (`hero`): the diagram, animation or simulator that explains the mechanism best.

Everything else is a detail block in `blocks`, folded under **More details** (native `<details>`, keyboard
operable). Prefer short lists and tables to paragraphs there too. The top of the page carries the TL;DR of
the whole game (`BigPicture` in `src/wiki/scenes.tsx`). Search opens the details of every matching chapter;
**Open all details** unfolds the whole page. `tests/wiki.test.mjs` enforces the limits above.

## Content rules

- Numbers that live in rules files are imported, never copied: the level table, staker gates, GOLD
  prices, Aura catalog, place badges and city registry come straight from `server/data/`.
- Live diagrams read public endpoints only (`/api/treasury/mix`, `/api/economy/qgold`) and fall back to
  the documented targets.
- Every chapter has an honest status: live, partly live, built but switched off, or planned.
- Never mention events or presentations, and never include secrets, keys, private hosts or file paths of
  key material. The test checks the copy for event words.
- Markup inside chapter text is limited to `**bold**`, `` `code` `` and `[label](/path)`.
- New pictures: add a `VizId` in `chapters.ts` and register a component in `diagrams.tsx`, preferably built
  from the primitives in `viz.tsx` (Flow, Sequence, LineChart, Bars, StackBar, Donut, Timeline24) or as an
  authored scene in `scenes.tsx` (phone screen, screen map). Flow edges marked `flow` carry moving tokens.
  Motion explains a flow or a state, uses CSS or SVG animation only, and stops under reduced motion (the
  system setting and the game's own motion preference): `useMotion()` skips moving parts entirely.
- Game objects (coin, chest, explorer) use the game's authored art; utility icons use Phosphor.

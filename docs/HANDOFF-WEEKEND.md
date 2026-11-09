# Weekend hand-off for other coding agents (7–9 November 2026)

This page is for coding agents other than the owner's Claude threads (Cursor, Codex, Gemini, Copilot and
similar) working on QuestLayer while the owner's Claude limit is spent. It lists the guardrails (hard rules),
how to deliver a change, and a prioritized task list with acceptance criteria. Read `AGENTS.md` first; it
still applies in full.

Owner: Lubos (`@promptstudio3000`). Main integration branch: `claude/upbeat-gauss-5czir7`. Public testnet host:
https://questlayer.promptstudio3000.com (read-only for you: `GET /api/health`, the game in a browser).

## 1. Hard rules (never break these)

If a task seems to need any of the following, **stop and leave a note in the PR description**. Do not work
around a rule.

1. **No contract changes.** Do not edit anything under `contracts/` (including `contracts/wasm-sha256.json`
   and `Cargo.lock`) or `rust-toolchain.toml`. Do not rebuild or re-pin WASM hashes.
2. **No deploy, signing or chain scripts.** Do not edit or run `scripts/deploy-*`, `scripts/upgrade-*`,
   `scripts/install-*`, `scripts/migrate-*`, `scripts/prove-*`, `scripts/verify-*`, `scripts/topup-*`,
   any `scripts/*testnet*`, `scripts/*mainnet*`, `scripts/*operator*`, `scripts/lib/`, `scripts/deploy-vps.sh`
   or anything in `deploy/`. Do not deploy to the VPS. Do not SSH anywhere.
3. **No keys, secrets or production state.** Never create, read, print or commit `runtime.env`, `.env`,
   `.data/`, `.near-credentials/`, `held-keys/`, `*.pem`, `*.key`, SQLite files, NEAR private keys
   (`ed25519:` + ~88 chars), seed phrases or API keys (Ollama, NEAR AI, Anthropic, OpenAI). Local
   development needs none of them.
4. **No mainnet.** Nothing that targets mainnet: no `--mainnet`, no `NEAR_NETWORK=mainnet`, no edits to
   mainnet records or `test:mainnet`.
5. **No money, reward or economy changes.** Do not change how GOLD/QGOLD, XP, levels, rewards, fees, staking
   gates, payouts, the treasury, the market escrow or the relayer work. Protected code: `server/native/`,
   `server/payouts/`, `server/qgold/`, `server/relayer/`, `server/market/`, `server/chain-ledger/`,
   `server/identity/`, `server/creators/`, `server/map-rewards/`, `server/gold-spend/`, `server/operator/`,
   `server/fair-play.mjs`, `server/levels.mjs`, `server/staker-gates.mjs`, `server/database.mjs`, and the
   numbers in `server/data/level-table.json`, `staker-gates.json`, `gold-spend.json`, `aura-catalog.json`,
   `cities.json`, `place-badges.json`. A UI change may display these values; it may not change them.
6. **No deployment records.** Do not edit `public/native-*.json`, `public/*testnet*.json`,
   `public/*mainnet*.json` or any `public/*proof*.json`.
7. **No CI, rules or dependency changes.** Do not edit `.github/` (workflows, this guard, CODEOWNERS), `AGENTS.md`,
   `GEMINI.md`, this hand-off, `package.json`
   or `package-lock.json`. No new npm packages. Do not skip, delete or weaken a test or a budget to get green.
8. **No old-data paths.** There are no real players yet. Never write "V2", "legacy" or migration code for old
   data; improve things in place.
9. **Not in flight elsewhere.** Leave these alone, the owner's Claude threads own them: wallet QGOLD balance
   and pending UI (PR #204), market funding and Secrets settlement, removal of practice GOLD, free-text chat
   between players (not approved), NPC trader prices.

The **Protected paths** CI job (`.github/workflows/guard.yml`, rules in `.github/scripts/protected-paths.mjs`)
lists every protected path a PR touches (rules 1, 2, 5, 6 and 7, plus sign-in, session and signing code:
`server/index.mjs`, the signing vault, `src/player-key.ts`, `src/qgold-burn.ts`, the native transaction
helpers) so the owner sees them in review, and fails when a PR adds something that looks like a secret. Since
9 Nov 2026 the owner no longer requires an `owner-approved` label; the hard rules above still bind outside
agents, and the owner reviews their PRs before merging. Never use a `claude/` branch name (those are the
owner's Claude threads).

## 2. Product rules every change keeps

- **English** is the default game language. All new player text is written in English and added to the
  translation files (`src/i18n/*.json`; run `npm run i18n:keys` to see missing keys). Code, comments and docs
  are English.
- **Never mention the hackathon or judges** on public pages (`/`, `/how-it-works`, `/economy`, `/treasury`,
  `/wiki`, the game itself).
- **Wiki rule.** A change that adds or changes a mechanism updates its chapter in `src/wiki/chapters.ts` in
  the same PR, then runs `npm run wiki:stamp` (see `docs/WIKI.md`). `tests/wiki.test.mjs` fails otherwise.
  Stamp only after you re-read the chapter against your change. A pure visual change needs no chapter edit.
- **Phone budget.** First-screen JS stays under the budget in `scripts/check-bundle-budget.mjs` (220 KB gzip,
  about 704 KB raw; MapLibre, three.js and near-api-js never in the first load). New UI lazy-loads
  (`src/lazy-panels.tsx`). Never raise the budget.
- **Game design rules** (owner decisions): real play is GPS only; the demo pad is the only non-GPS movement
  (no click-to-move); arrows are relative to facing; lures tell what to do or wear, never odds or payouts;
  daily board has 3 goals and no streaks; money is global (one treasury, no per-city pots); no betting or paid
  chance of any kind; NPC dialogs are short and game-like with a portrait.
- `AGENTS.md` "Game and UI rules" 1–12 and "Required delivery evidence" apply to every UI change: 48 px touch
  targets, 16 px body text, safe areas, focus and Escape in dialogs, reduced motion, Phosphor icons, authored
  game art instead of emoji.

## 3. How to deliver a change

1. `git fetch origin claude/upbeat-gauss-5czir7 && git checkout -b weekend/<task-id>-<slug> origin/claude/upbeat-gauss-5czir7`
   (example: `weekend/u2-inventory-grid`). One task per branch and PR.
2. `npm ci` (Node 24+), `npm run dev`, open http://127.0.0.1:5173. The solo demo needs no wallet or key.
3. Make the change. Keep it inside the files the task lists; if you must touch a file another task owns,
   keep that edit small and say so in the PR.
4. Before pushing: `npm run check` (build, budget, all tests, mainnet guard tests) and
   `node .github/scripts/protected-paths.mjs --base origin/claude/upbeat-gauss-5czir7`. For UI work also run
   `npm run e2e:first-session -- --device=phone-390` (needs `npx playwright install chromium`) and, if you
   changed text, `npm run e2e:languages`.
5. Open a PR **into `claude/upbeat-gauss-5czir7`** (never into `main`, never push to the integration branch
   directly). Fill in `.github/pull_request_template.md`. Attach screenshots at 360 px, 390 px, a short
   landscape viewport and desktop for UI changes.
6. Wait for **every** CI job to be green (Application checks, first-session ×3, languages, contracts,
   reproducible-contracts, clean-clone, Protected paths). Fix your change, never the check.
7. The owner merges (or tells you to). Rebase on the integration branch before merge if it moved; resolve
   conflicts in favour of what is already merged.
8. No deploy. Merged work goes to the testnet host when the owner deploys it.

## 4. Prioritized task list

Order: P0 first. Tasks in the same wave touch different files, so they can run in parallel, one agent each.
"Files" is the expected scope, not permission to touch protected paths.

### P0: what a player sees in the first ten minutes

**U1. Map HUD and top bar polish.** Make the map screen read as a game: level ring with progress, compact
GOLD/XP, map tools and demo pad not covering the character on a 360 px phone.
Files: `src/HudXpRing.tsx`, `src/hud.css`, `src/phone-map.css`, `src/demo-controls.css`, `src/DemoControls.tsx`.
Figma: QUESTLAYER-2026 (https://www.figma.com/design/8lOYVwOBOPDjoLItCJPR2q/QUESTLAYER-2026?node-id=17-2),
frames "map", "hud profile pill", "demo pad". Apply any open Figma comments on those frames.
Accept: at 360 and 390 px the character and the next objective are visible with the sheet collapsed; every
control ≥ 48 px; no element overlaps the safe area; `e2e:first-session` green on all three devices; before/after
screenshots in the PR.

**U2. Inventory as a game grid.** Four-column square slots with rarity frames, empty slots to fill the row,
tap opens a short item detail; hero card with Above/Below equipment slots and level progress on top.
Files: `src/Inventory.tsx`, `src/inventory-game.css`, `src/inventory.css`, `src/OriginalItemGallery.tsx`.
Figma frames "inventory items", "item detail", "wardrobe". Background:
`docs/UI-SIMPLIFICATION.md`.
Accept: two items fit on one phone screen without scrolling past explanations; keyboard and screen-reader
labels on each slot; item detail closes with Escape and returns focus; no change to item data or ownership.

**U3. NPC sheets (storyteller, quest giver, trader, keeper).** Match the Figma NPC frames: portrait, one
short line, two or three clear actions, task list with state chips.
Files: `src/NpcSheet.tsx`, `src/npc-sheet.css`, `src/npc-i18n.ts`, `src/ActorSheet.tsx`, `src/actors.css`.
Do not change trader prices, stock or rewards (server).
Accept: each NPC type has a loading, ready, too far, done and failed state with an action or reason
(`AGENTS.md` rule 5); dialog fits a 390 × 664 viewport without inner scroll for the greeting.

**U4. Monster challenges.** Polish the guardian choice, quiz, rhythm, duel, boss, roamer and laser-beamer
screens to the Figma frames "monster …".
Files: `src/MonsterChallenge.tsx`, `src/BossFight.tsx`, `src/monster-challenge.css`, `src/monster-challenge.ts`.
Accept: every challenge can be finished with touch only and with keyboard only; reduced-motion respected;
result screen shows the server-confirmed result once.

**Q1. Translations complete.** Run `npm run i18n:keys`; add every missing key in all `src/i18n/*.json`
languages (English source stays the truth). Natural phrasing, no machine-literal UI.
Files: `src/i18n/*.json` only.
Accept: `npm run e2e:languages` green (no untranslated English, no overflow, Arabic right-to-left).

**W1. Wiki accuracy pass.** Read each chapter in `src/wiki/chapters.ts` against its `sources` and fix stale
statements and numbers (numbers come from `server/data/` imports, never copied). Add missing chapters for
mechanisms merged since 4 November (daily payouts, QGOLD escrow, task market, player cards) if absent.
Files: `src/wiki/*`, `docs/wiki-stamps.json` (via `npm run wiki:stamp`).
Accept: `npm test` green; each edited chapter's `updated` date set; no hackathon mention; `/wiki` renders on a
390 px phone without sideways scroll.

### P1: depth of play and robustness

**G1. Monster quiz and NPC content.** Add more quiz questions and NPC lines (English, Czech places where it
fits, safe for all ages). Content only.
Files: `server/data/monster-quiz.json`, `server/data/personas/`, `server/data/actors/` (texts only).
Accept: existing validators and tests green; no reward, price or odds fields changed (diff shows text only).

**G2. Landmark clues and quest flavour.** Improve the fallback quest titles and clue texts players see when
the nightly AI batch is missing.
Files: `server/quest-templates.mjs` (text), `server/landmark-clue.mjs` (text), `docs/QUEST-FLAVOUR.md`.
Accept: tests green; titles read naturally in English and are translatable.

**U5. Profile and settings tabs.** Profile as a game screen with tabs (Character, Badges, Stake, Rewards,
Settings), long explanations behind an info button.
Files: `src/NativeProfile.tsx`, `src/screens.tsx`, `src/ScreenTabs.tsx`, `src/screen-tabs.css`, `src/BadgeBook.tsx`,
`src/badges.css`. Leave wallet balances and staking amounts as they are (display only).
Accept: no screen longer than two phone heights; settings reachable in two taps; screenshots in PR.

**U6. Community screens.** Tabs Quests, Tasks, Notes, Creators per Figma frames "community …".
Files: `src/CreatorCommunity.tsx`, `src/creator-community.css`, `src/MapNotes.tsx`, `src/map-notes.css`.
Accept: each tab has a real empty state with authored art and one next action; feeds keep keyboard access.

**U7. Empty, loading, offline and error states.** Sweep every panel for blank or text-only states; use
`src/EmptyState.tsx` and existing art (ghost, chest, coin, Aura).
Files: `src/EmptyState.tsx`, `src/empty-state.css`, `src/offline-gate.css`, small edits in panels (say which).
Accept: list of states covered in the PR, each with a screenshot.

**T1. Tests for non-money code.** Raise coverage of game code that has no protected status: daily board,
landmark clue, POI quests, actors, NPC dialog, season, world planner. Find gaps with
`node --test --experimental-test-coverage tests/*.test.mjs`.
Files: new `tests/*.test.mjs` only (plus pure helper exports if needed, called out in the PR).
Accept: new tests pass with `--test-concurrency=4`, no network, no wall-clock flakiness (pin clocks, as in
`tests/fair-play.test.mjs`).

**T2. E2E journeys for NPCs and monsters.** Extend `scripts/e2e-world-journeys.mjs` (or a new
`scripts/e2e-*.mjs` run locally) with: open an NPC, accept an errand, finish a monster quiz.
Accept: runs green locally on `phone-390`; screenshots saved under `E2E_SHOTS`. Note: adding it to CI needs the
owner (workflow change).

### P2: if time remains

**P1. First-load weight.** Find what still loads on the welcome screen and lazy-load it.
Accept: `npm run budget` reports a lower JS number than before; no visual change on the welcome screen.

**D1. Status page refresh.** Update `docs/STATUS.md` from the public `GET /api/health` and merged PRs since
3 November. Facts only, with evidence column.

**A1. Accessibility audit.** axe scan of every tab at 390 px (the e2e already runs axe on the first session);
fix contrast, labels and focus order outside the money flows.

## 5. Where things are

- Rules and design: `AGENTS.md`, `DESIGN.md`, `docs/GAME-RULES.md`, `docs/GAME-LOOPS.md`, `docs/design-tokens.json`.
- Current state: `docs/STATUS.md`, `/api/health` on the testnet host, `/wiki`.
- Figma: QUESTLAYER-2026, link above. It holds captures of every app screen (start, map, discoveries, zone,
  daily board, NPCs, monsters, inventory, market, community, profile, settings, economy, how it works) with the
  owner's comments; frame names in the tasks are approximate, find the frame by its screen. No Figma access?
  Use `DESIGN.md` and the running app.
- Local test world: the solo demo seeds itself; `docs/TEST-SEED.md` describes the testnet bots (do not run
  them against the public host).

## 6. When the owner's Claude threads come back

Each merged weekend PR stays as is. Open PRs are reviewed by a Claude thread or the owner. Leave in each PR
description what is done, what is proposal-only, what was verified and what still needs real devices
(`AGENTS.md`, last section), so the next session can continue without asking.

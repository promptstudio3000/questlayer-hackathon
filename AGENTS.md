# questlayer-hackathon development rules

The canonical repository/project name is `questlayer-hackathon`; the game brand is QuestLayer.
Read `docs/CLOUD-DEVELOPMENT.md` for cloud setup and legacy identifier boundaries.
Use `npm ci` with Node.js 24+, then `npm run check`. Do not access production state or signing keys to develop the demo.

## Agents other than the owner's Claude threads

Cursor, Codex, Gemini, Copilot and any other coding agent: read `docs/HANDOFF-WEEKEND.md` before any change.
Its hard rules are not negotiable: no changes to `contracts/` or WASM hashes, deploy/signing/chain scripts,
money and reward server code, economy numbers, deployment records, CI or dependencies; never touch keys,
`runtime.env`, secrets or mainnet; no VPS deploys. One task per `weekend/<task-id>-<slug>` branch, PR into
`claude/upbeat-gauss-5czir7`, all CI green including the Protected paths job. That job lists protected
paths for review and fails only on committed secrets; no `owner-approved` label is needed (owner, 9 Nov 2026).

## Product and design context

Read `ROADMAP.md`, the active milestone and `docs/GAME-RULES.md` before implementation.
Read `docs/WORLD-GENERATION.md` for spatial/world changes: Plzeň has six citywide
slots, varied non-overlapping polygons and real transfers; H3 cells cannot create
additional sets. Numerical starting values are versioned tuning proposals.

Read `DESIGN.md` before changing any player-facing surface. For a redesign, also read
`docs/UI-UX-IMPROVEMENT-PLAN.md`. Research provenance and adoption decisions live in
`docs/UI-UX-RESEARCH.md`; proposed values live in `docs/design-tokens.json`.

The user has explicitly prioritized game design, mobile usability, craft and an
Aavegotchi-native visual identity. Treat these as acceptance criteria alongside
correctness. A feature is incomplete if a player cannot understand its purpose,
action and result. The goal is a coherent, authored game with recognizable character,
not a generic dashboard with game illustrations.

## Working agreements

- The project wiki at `/wiki` (`src/wiki/`, rules in `docs/WIKI.md`) describes every mechanism in
  force. Any change that adds or changes a mechanism updates its chapter in `src/wiki/chapters.ts` in
  the same pull request, then runs `npm run wiki:stamp`. `tests/wiki.test.mjs` fails otherwise.

- Product text, source comments and repository documentation use English. Discussion
  with the user may use Czech.
- Preserve the accepted economy and integration boundaries in `IMPLEMENTATION-PLAN.md`
  and `CREATOR-ECONOMY-PLAN.md`. A visual redesign does not authorize changing rewards,
  tiers, ownership, XP accounting or financial settlement.
- Keep demo GOLD, real testnet balances and Base-owned appearances distinguishable.
  Never erase disclosures to make a screen look cleaner.
- Preserve existing work. Do not commit, publish or deploy solely because a design
  document or local preview is complete.
- External repositories and skill files are research material until deliberately
  adopted. Do not run their installers, copy their agent instructions wholesale or
  add dependencies merely because a social post recommends them.

## Game and UI rules

1. Design the next playable action first: locate a discovery, understand its
   requirement, complete it, see the confirmed result and use the item.
2. The first useful adventure must work solo without a connected wallet or deposit.
3. Preserve real geography and the distinction between arena movement and GPS.
   Straight-line distance is not a verified walking route.
4. On a phone, keep the map and character readable; use a compact objective and a
   deliberate sheet state rather than shrinking the desktop panel.
5. Give each interaction state a clear action or reason: loading, ready, too far,
   inaccurate GPS, pending, succeeded, already claimed, expired, offline and failed.
6. Use semantic design tokens. New proposed tokens are not the current implementation;
   adopt them in one scoped change and verify their actual rendered contrast.
7. Use Aavegotchi's character, expressive pixel craft, deep purple, bright accent and
   collectible identity intentionally. Keep operational text crisp. Preserve original
   verified appearances; record sources and permissions for distributed artwork.
8. Use Phosphor for utility icons consistently. Use authored game assets for chest,
   coin, Aura and quest objects; do not substitute random Unicode or emoji glyphs.
9. Essential phone controls have at least a 48 CSS px effective target. Body and
   input text start at 16px; secondary text at 14px; reserve 12px for nonessential
   annotations. Respect safe areas, browser zoom and enlarged text.
10. Use native controls or a single established accessible primitive system for
    dialogs/sheets. Preserve keyboard access, visible focus, Escape, focus return,
    proper labels and alternatives to drag-only interactions.
11. Motion explains an action or state. Frequent actions must not wait for animation.
    Prefer CSS/WAAPI; introduce a library only for a demonstrated interaction need.
    Reduced motion includes MapLibre camera movement, not only CSS.
12. Confirm rewards from server responses. Celebrate once, preserve a durable receipt
    and make retry/idempotency safe. Never imply an item or shared reward is available
    when current data does not establish it.

## Required delivery evidence for UI changes

- State the player problem and scope before implementing; compare compositions when
  changing hierarchy. Use realistic names, amounts and error states.
- Inspect the running UI. Review code findings in a Before / After / Why table with
  file pointers; distinguish source findings from observed behavior and proposals.
- Capture affected states at phone widths 360 and 390, a short landscape viewport,
  and desktop. Include keyboard-open and enlarged-text cases for affected forms.
- Run checks appropriate to changes. UI behavior needs interaction checks, not just
  a successful build. Economy changes additionally require the existing invariants.
- Test Safari/iOS and Chrome/Android on real devices before calling mobile behavior
  verified. If unavailable, explicitly report the remaining hardware checks.
- Report implemented behavior, proposal-only behavior, verification and remaining
  limitations separately. Do not invent usability scores or performance results.

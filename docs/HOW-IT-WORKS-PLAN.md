# "How it works" one-pager: plan

2 November 2026. Owner request: a "How it works" link in onboarding that opens a one-page, animated explanation
of the main principles of the game and how to join. The page is also used when QuestLayer is shown to an audience,
so it must read well on a projector and on a phone, but the page itself never mentions events or presentations.

This document is the plan. The implementation lives in `src/how-it-works/` and is described in section 7.

## 1. Goal and audience

| Reader | Arrives from | Needs to leave knowing |
| --- | --- | --- |
| Newcomer on a phone | The welcome screen link "How it works" | What they will do outside, that it is free to start, and the one button to begin |
| Crypto-curious player | A shared link `/how-it-works` | What staking adds (about 5 € / 2 NEAR to become a Staker), that the NEAR stays theirs and only its yield funds prizes |
| Aavegotchi / NEAR native | A shared link, a big screen | Auras and editions are collectibles on NEAR, badges are POAP-like, NPCs and traders keep the world alive, seasons give a rhythm |
| Someone watching over a shoulder (big screen) | Scrolled by another person | Each chapter makes sense from its headline and animation alone, in about 10 seconds |

One sentence the page must land: **Walk your real city, collect and wear things that are yours, and if you want
more, stake a little NEAR: your stake stays yours and its yield grows one global prize pool shared by every city.**

## 2. Principles for the page

1. **One idea per screen.** Every chapter has a short headline, at most two short sentences, one animated scene and
   at most three fact chips. Details live in the game, not here.
2. **Motion explains a mechanic** (AGENTS.md rule 11). Each animation shows cause and effect: walking produces coins,
   XP fills a ring, a deposit matures and unlocks chips. No decoration loops that do not teach anything.
3. **Honest numbers only.** Every number comes from the live rules: level curve 100·(n−1)² XP and
   `server/data/level-table.json`, staker gates from `server/data/staker-gates.json`, season points from
   `docs/SEASON.md`, badge rules from `docs/BADGES.md`. Nothing that implies guaranteed income.
4. **Play first.** The first call to action is "Start exploring" (free, no wallet). Staking is shown as an optional
   later step, introduced gradually, exactly as the game introduces it.
5. **Accessible and calm.** All text is real text, the page works without JavaScript animation, keyboard navigation
   between chapters works, and reduced motion (system setting or the in-game Motion setting) shows every scene in its
   final state.
6. **No event wording.** The page talks about the game only.

## 3. Scenario (chapter by chapter)

The page is a vertical story of nine chapters plus a hero and a closing call to action. A chapter rail on the side
(desktop) or a thin progress bar on top (phone) shows where you are; each rail dot is a link.

| # | Chapter | Headline (draft) | Scene and animation | Fact chips |
| --- | --- | --- | --- | --- |
| 0 | Hero | "Your city is the game board." | The ghost floats over a stylised street grid; three coins pop out of the street one after another; a soft parallax on scroll. Buttons: Start exploring, See how it works (scrolls). | Free to start · No wallet needed · Phone in your pocket |
| 1 | Walk and collect | "Walk. Every street hides something." | A dotted route draws itself (SVG stroke), the ghost travels along it, coins and a sparkle find pop up as it passes; a GOLD counter and an XP counter tick up. | Street coins · Sparkle finds · Real GPS, honest distance |
| 2 | Daily zones and chests | "Six new zones every day." | A map tile with six zone shapes fading in one by one (3 free, 2 Tier 2, 1 Tier 3, locked ones dimmed); a chest at the free zone shakes and opens; an Aura rises out of it. | 3 free · 2 Tier 2 · 1 Tier 3 · Trails and chests |
| 3 | Levels | "Level up to 10. Every level opens something." | An XP ring fills, the level number counts up, and a ladder of L1 to L10 lights level by level with its unlock. | Level n at 100·(n−1)² XP · No pay-to-win |
| 4 | Collectibles and editions | "Wear what you earn. Own it on NEAR." | A row of Aura cards deals in; one flips to show "Edition · supply capped"; the ghost tries the Aura on (above and below slots). A "Practice → Secured on NEAR" switch animates. | Supply-capped editions · Above and below slots · Trade on the market |
| 5 | Badges | "Collect the places you have really been." | A map with pins at peaks, viewpoints and landmarks; when the ghost reaches one, a medal stamps down with a bounce. A second row shows a creator-made badge (place, event, quest). | 69+ notable places · POAP-like player badges · Soulbound, never sold |
| 6 | NPCs, monsters and traders | "The city is alive." | NPC cards slide in (storyteller, quest giver, trader, keeper) with speech bubbles; a monster card shakes when "attacked"; a trader shows "3 → 1 trade-up". | Quest lines · Monster duels · Weekly boss · Traders |
| 7 | Staking | "Stake a little. Unlock a lot more." | A NEAR coin drops into the vault; an epoch track runs E, E+1, E+2; at E+2 the Staker badge lights up and locked chips unlock one after another along the ladder (Staker + L2, Staker + L4, Tier 2 + L6, Tier 3 + L8). A pot meter rises with "yield". | From 2 NEAR (about 5 €) · Your NEAR stays yours · Only yield funds prizes · Unlocks to do and wear, never better odds |
| 8 | Seasons | "Seasons give every week a goal." | A season bar fills with three kinds of points (hunt 1, visit 2, NPC line 3) to the goal of 30; rank titles appear (Explorer, Season finisher, Trailblazer, Season legend); a pot meter fills. | Points for play, never money · Cosmetic ranks · A season Aura for finishers |
| 9 | Fair play | "Fair by design." | Four principle tiles flip in. | Looks, not power · No betting · Prizes from real yield or sponsors · Play free first |
| 10 | How to join | "Start in under a minute." | A three-step stepper with a moving highlight: pick a name, walk to your first coin, open your first chest and wear your Aura. Then two optional steps: secure it on NEAR, become a Staker. Big Start exploring button. | No sign-up · No deposit · Secure later |

## 4. Use cases

| ID | Use case | Flow | Done when |
| --- | --- | --- | --- |
| U1 | Newcomer wants to understand before naming the ghost | Welcome screen → "How it works" link → reads → "Start exploring" | They are back on the welcome screen with focus on the name field, nothing lost |
| U2 | Player already in the game wants a refresher | Profile → Settings → "How it works" (or direct `/how-it-works`) → "Back to the game" | They return to the map as they left it (a normal page navigation; the app restores its tab from history) |
| U3 | Someone opens a shared link | `/how-it-works` cold load | The page renders without an account, without the map bundle, and starts on the hero |
| U4 | Big screen, keyboard only | Arrow Down / Page Down / Space step chapter by chapter; Home and End jump; rail dots are links | Each step lands a chapter at the top and its animation plays once |
| U5 | Reduced motion | System setting or in-game Motion = reduce | All scenes render in their final state, no autoplay movement, the page is still complete |
| U6 | Slow or offline | The page is part of the app shell bundle chunk; no API is required | Static content renders; nothing waits on the network |
| U7 | Deep link to a chapter | `/how-it-works#staking` | The page opens at that chapter |

## 5. Animation system and how to build it

**No new dependency.** The game already prefers CSS and WAAPI (AGENTS.md rule 11), so the page uses:

- **Scroll reveal with `IntersectionObserver`.** Each chapter gets `data-inview="true"` once 35 % of it is
  visible. All scene animations are CSS keyframes gated by `[data-inview="true"]`, so they play once when the
  chapter arrives and never block reading. The state is sticky (it does not replay on scroll back) to keep the
  page calm.
- **Staggered children** via a CSS custom property `--i` per element (`animation-delay: calc(var(--i) * 120ms)`).
- **SVG path drawing** for the route (`stroke-dasharray` + `stroke-dashoffset`), and the ghost travels along the
  same path with CSS `offset-path` (falls back to a simple translate where unsupported).
- **Number counters** (GOLD, XP, level, season points) use one small `requestAnimationFrame` hook that eases from
  0 to the target once the chapter is in view; screen readers get the final value only (`aria-hidden` on the
  ticking copy, a visually hidden final value).
- **Hero parallax**: a single `scroll` listener with `requestAnimationFrame`, transform only, disabled under reduced
  motion.
- **Chapter navigation**: `scroll-snap-type: y proximity` on large screens, a keydown handler for Arrow / Page /
  Space / Home / End that scrolls to the next chapter, rail dots as anchor links with `aria-current`.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` and `html[data-motion="reduce"]` (the in-game
  Motion setting from `src/feedback.ts`) both turn every animation off and show final states; counters jump to
  their value.
- **Only transform and opacity animate**, so scenes stay at 60 fps on phones. No layout-affecting animation.

Art comes from the game itself so the page looks like the game: the ghost (`Ghost`, `AuraArt`), authored Aura
sprites (`AuraSprite`), and pixel game objects (`GameObjectArt`: coin, chest, discovery). Phosphor icons for
utility glyphs. No emoji.

## 6. Technical shape

- **Route**: `/how-it-works`. The server already serves `index.html` for unknown extensionless paths and the
  service worker treats it as the app shell, so no server change is needed. `src/main.tsx` checks the path and
  renders the page instead of the app.
- **Bundle**: the page is a lazily imported chunk (`src/how-it-works/HowItWorks.tsx` + `how-it-works.css`), so the
  welcome screen budget (`npm run budget`) is unchanged.
- **Links in**: the welcome screen ("How it works", next to the start note) and Profile → Settings.
- **Links out**: "Start exploring" and "Back to the game" go to `/`.
- **Data**: the level ladder reads the bundled level table (`DEFAULT_LEVEL_TABLE` in `src/levels.ts`), the staker
  ladder reads `server/data/staker-gates.json` at build time, so numbers follow the rules files.
- **Tests**: a unit test checks that the page's chapter list, level ladder and staker ladder match the rules
  files and that every chapter has an id for deep links; the build and the bundle budget prove the page stays out
  of the first load.

## 7. Implementation checklist

| Step | State |
| --- | --- |
| Plan (this document) | done |
| Route in `src/main.tsx`, lazy chunk | done |
| Page with 11 sections, scenes and counters | done |
| Reduced motion and keyboard chapter navigation | done |
| Links from the welcome screen and Settings | done |
| Unit test against the rules files | done |
| Screenshots at 390 px and desktop | done (`output/qa/how-it-works/`) |
| Real-device check (iOS Safari, Android Chrome) | open, with the rest of the device pass |

## 8. Later ideas (not in this slice)

- A live strip with today's numbers (open zones, pot, season standings) from `/api/world` and `/api/season`.
- Localised copy (Czech) when the game gets a language switch.
- A 30-second autoplay mode that steps chapters on a timer for a kiosk screen.

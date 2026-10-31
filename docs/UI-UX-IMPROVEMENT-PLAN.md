# AuraTrail UI and game experience improvement plan

31 October 2026. Prepared backlog, not an implementation report. Read with
`../DESIGN.md`, `UI-UX-RESEARCH.md` and the accepted product/economy plans.

Execution is coordinated by [ROADMAP.md](../ROADMAP.md). The [rule register](GAME-RULES.md) maps every U01–U14 package to its milestones. Existing review observations remain dated evidence; re-check current code and behavior before implementing a finding.

## Current evidence

Keep the existing pastel real-map base, solo arena loop, shared coins, quests,
inventory and explicit demo explanations. Desktop Explore was inspected in the
running local app at 1280×720. Findings below also identify source owners. Phone
findings are inferred from CSS and handlers; no physical-phone tests are claimed.

Existing images in `output/concepts/` are earlier concepts/rendering studies, not
acceptance evidence for this redesign. This review did not modify gameplay, the
deployed site or the current user's progress.

## Review of the current UI

| Before / evidence | After / proposed change | Why |
| --- | --- | --- |
| `App.tsx` gives Game fund a primary tab. Desktop Explore spends much of the left panel on a heading, subtitle, status and summaries before the first discovery. | Put a recommended adventure first; move Game economy to Settings with a Wallet link; introduce Community according to the accepted plan. | Make the next playable action prominent while preserving transparency. |
| `style.css` has many operational labels at 7–11px. Late mobile overrides improve some labels but leave an inconsistent scale; `.zone-info small` remains 8px. | Body/input 16px, secondary 14px, optional annotation 12px; verify rendered contrast. | Essential information should be readable at normal phone scale. |
| Mobile map controls are 36×36px; `.icon-button` is 32×32px. | At least 48×48px effective touch targets even when the glyph is smaller. | More reliable taps. |
| Mobile Explore is fixed at `36dvh` with a CSS `:before` handle; `App.tsx` has no corresponding sheet drag behavior. | Deliberate collapsed/browse/detail states and working expand/collapse controls; drag has an equivalent button action. | A handle should describe a real interaction. |
| Inventory's `.wardrobe-preview` uses fallback `<AuraArt>`; the profile uses `<Ghost>`. `GameMap.tsx` independently renders the selected canonical skin and both Aura positions. | Shared appearance composition in map, profile, wardrobe and preview. | The player's chosen character must look consistent. |
| Explore reward fallback shows `Items` or `Aura` when the available GOLD branch is absent; the branch does not establish that a visit grants an item. | Derive reward labels from quest type, eligibility and established availability. | Avoid promising loot unsupported by data. |
| `complete()` emits a toast and refreshes the world; no dedicated persistent discovery/result surface exists. | Confirmed result with actual rewards and an equip path when an item was awarded. | Make a discovery meaningful and immediately usable. |
| Each pickup replaces the same `toast` state. `coins` is a local counter reset on reload. | Local pickup reaction, coalesced totals, separate important feedback; session label or durable totals. | Pickups should not hide errors or imply lifetime progress. |
| Quest actions disable for distance/global busy state with limited explanation. | Local action state and specific disabled reasons. | The player understands how to continue. |
| `Npc` uses a custom scrim/section without dialog semantics, focus containment, focus return or Escape handling. Input has only a placeholder. | Complete accessible dialog behavior and visible input label. | Keyboard and assistive-tech behavior are part of quality. |
| Arena arrow handling ignores input/textarea/select, but does not suspend for dialogs or other focused controls. | Gate movement by game-input ownership. | Operating UI must not move the character behind it. |
| CSS already disables animation for reduced motion; `GameMap.tsx` still asks for 450/1400ms camera movement. | Apply motion preference to follow/recenter/globe too. | Reduced motion covers the entire experience. |
| Default muted ink is `#92899b`; pale/translucent compositions weaken hierarchy. | Semantic stronger ink and opaque reading surfaces; quiet map behind character. | Retain atmosphere while improving glance readability. |
| Zone pins use Unicode glyphs and `title`. | Authored marker family, accessible names and a usable list alternative. | Predictable silhouettes and equivalent access. |
| Topbar has fixed height without top-inset padding; bottom nav combines fixed height and safe-area padding. | Test all anchored layers together with safe areas, short viewports and keyboard. | A single inset declaration does not establish correct layout. |

Owners above are in `src/`. Component/selector names are more stable pointers than
the current compressed long source lines. Reformat touched components only.

## Ordered work packages

P0 blocks a clear/trustworthy interaction; P1 establishes the intended experience;
P2 refines it after the loop works. Every package below is a proposal, not completed.

### U01 — Readable touch foundation · P0

**Owners:** `style.css`, affected forms/buttons in `App.tsx`.
Adopt semantic tokens in a scoped pass, establish type/target/layer scales and
capability-gated hover. Keep readable map attribution.

**Acceptance:** 48px effective touch targets without overlap; essential text follows
the chosen scale; 360/390px views fit; full balances and long names remain legible;
200% text and input focus do not hide active actions. Verify alpha-composited colors,
not only opaque token pairs.

### U02 — Dialogs and game-input ownership · P0

**Owners:** `Npc`, profile menu, relevant forms, arena keyboard effect.
Use native/established accessible interaction behavior, labels, local errors and
expanded state. One modal interaction surface is active at a time.

**Acceptance:** modal focus stays inside; Escape closes; focus returns to trigger;
background movement stops; the guide input has a label; failed submission retains
text. Verify keyboard and screen-reader behavior, not just added ARIA attributes.

### U03 — Honest quest actions and rewards · P0

**Owners:** Explore list/detail, `complete()`, `types.ts`; consult existing server
quest/location validation without changing economy rules.
Model too far, inaccurate/stale GPS, locked, not yet open, expired, completed,
pending and retryable failure. Personal XP and shared GOLD are separate. Extend a
read response only if the display requires information not currently exposed.

**Acceptance:** zero-reward visits never promise Items; claimed GOLD stays claimed
while eligible personal XP can remain available; disabled actions explain why;
double activation cannot grant twice; a competing claim reconciles stale data;
arena movement is never described as proof of physical presence.

### U04 — Consistent character appearance · P1

**Owners:** `Ghost.tsx`, `GameMap.tsx`, profile/header, Inventory.
Share the representation of verified original/fallback and both Aura slots, with
adapters for DOM panels and map markers.

**Acceptance:** original plus above/below equipment match on map and wardrobe;
unequip/ownership refresh updates all views; slow/missing imagery has a clear
fallback; preview does not imply saved equipment. Check tall/wide wearables.
Preserve existing SVG trust boundaries.

### U05 — One recommended adventure · P1

**Owners:** Explore, `nearbyZones`, map selection state.
Surface a playable discovery and an easy alternative. Prefer an available eligible
free chest for a first cosmetic discovery when actual content supports it, then
eligible unfinished discoveries. Define deterministic tie-breaking and empty-world
behavior; keep selection stable through refreshes unless invalidated.

**Acceptance:** next action is visible without summary-card scrolling; no
closed/claimed/locked objective is presented as immediately available; no multiplayer
presence or deposit is required; pin/objective agree; manual pan is respected;
straight-line distance is not described as routed walking time.

### U06 — Mobile adventure sheet · P1

**Owners:** Explore container/CSS, objective navigation, camera padding.
Implement collapsed, browse and detail states. Derive map padding from visible
header/sheet bounds instead of a fixed width-based offset. Handle short visual
viewports and keyboard-open states.

**Acceptance:** collapsed portrait leaves at least half the usable map visible;
objective/action remain readable; buttons provide non-drag operation; pointer cancel
and a second touch do not jump the sheet; scrolling never moves the arena player;
Back returns detail → list/objective → map; rotation/browser bars do not hide the
player under UI. A full detail/form state may intentionally cover the map.

### U07 — Confirmed discovery and equip moment · P1

**Owners:** `complete()`, result view, Inventory equipment actions.
Use the actual claim response for a persistent result and optional short reveal.
Preserve a receipt when dismissed; use saved history or extend it if the awarded
item cannot be recovered from existing data.

**Acceptance:** first chest leads directly to preview/equip when an item exists;
success appears only after confirmation; retry/reconnect cannot duplicate the
reward or replay old celebration; Skip/reduced motion show the same actual result;
a transferred/sold item cannot be equipped from a stale result.

### U08 — Coherent game object art · P1

**Owners:** `Ghost.tsx`, map coin drawing/zone markers, quest illustrations.
Prepare coin, closed/open chest, discovery/completed place and Aura above/below as
one family with shared lighting, readable silhouettes and documented grids. Keep
utility actions in Phosphor.

**Acceptance:** objects are distinguishable at phone scale without color alone;
list art and map markers mean the same thing; selected/visited/locked states differ;
external assets have recorded source/permission; no always-running extra canvas or
shader background is required.

### U09 — Inventory around equipment · P1

**Owners:** Inventory and item actions.
Show character, slots and collection before optional linking setup. Item selection
opens supported actions; preview and saving are distinct. Empty collection has a
useful discovery action if an eligible target exists.

**Acceptance:** equipment is discoverable without scrolling through integration
text; both slots and saved state are obvious; rarity has text; long names fit;
listing failure preserves price; sold items stop looking owned; Base originals
never enter the demo sale path.

### U10 — Navigation and truthful Community entry · P1

**Owners:** navigation, Messages/Bounties, new Settings surface.
Move Game fund into Settings → Game economy with a Wallet link. Regroup existing
tasks/notes into an initial Community surface when it works. Full creator features
remain planned until implemented under `CREATOR-ECONOMY-PLAN.md`.

**Acceptance:** existing tasks/notes and financial transparency remain easy to find;
fund/proof links survive; Back behavior is defined; no buttons imply live follows,
paid access, XP commitments or creator-fund payouts. New accounting is separate work.

### U11 — Calm pickup feedback and progress · P1

**Owners:** collection effect, toast state, XP/balance HUD, history.
Separate routine pickups from errors/results. Coalesce bursts and assistive
announcements. Label session counters or derive persistent totals.

**Acceptance:** bursts do not obscure an error, block input, spam a screen reader
or create unbounded animations; confirmed totals agree with the server after
refresh; reconnect does not replay historical pickup effects.

### U12 — Motion and mobile rendering · P1

**Owners:** `GameMap.tsx`, CSS animation, world/presence updates.
Respect reduced motion in camera APIs; pause invisible decorative work; profile
before optimizing. Isolate frequent timers/counters from expensive updates where
evidence warrants it. A transform is not by itself proof of GPU compositing.

**Acceptance:** no camera travel, globe flight, shake or particles under reduced
motion; world snapshots do not visibly flicker markers; hidden-screen work pauses
appropriately. Profile named target phones for interaction frames, loading and
memory. Aim for responsive controls and near-60fps ordinary interaction on the
chosen baseline, with a documented quality fallback if unmet. No performance
number is claimed until measured.

### U13 — Playtest and designed quest variety · P1/P2

**Owners:** onboarding, recommendation, content templates; later server/world work.
Test the first-session path with five newcomers, including wallet beginners.
Observe next-action recognition, first completion, equip discovery, mis-taps,
understanding of demo value and voluntary interest in another adventure. Use
failures to design different requirements, rather than cosmetic copies of visits.
New mechanics require their own complete rule/state specification.

**Acceptance:** record build/date, observations and failures; players can explain
the result; next iteration addresses observed friction. Five participants do not
establish statistically proven retention. Raw location trails are not default UX
telemetry.

### U14 — Optional sound, haptics, 3D and promo · P2

After the core loop passes, consider one distinctive chest sound, optional light
haptics, budgeted 3D preview and a trailer. Select Blender/HyperFrames only for their
specific authoring jobs.

**Acceptance:** each addition has a player/communication purpose, provenance,
mute/reduced-motion behavior where applicable and named-device verification.
Effects are not added merely to demonstrate an AI tool.

## First implementation slice

Start with U01–U03, then U04–U07 and minimum U08 art. Deliver one complete arena path:
identify chest → understand action → confirm result → equip Aura → see the same
character back on the map. Complete U09–U12 around that path, then playtest. Keep
creator accounting and optional effect tooling outside the first slice.

## Verification matrix

| Context | Minimum checks for affected surfaces |
| --- | --- |
| Phone: 360×640 and 390×844 CSS viewports | Default map, sheet states, long names, empty inventory and result. |
| Landscape: 844×390 | Accessible action, visible character or intentional detail mode, no overlap. |
| Desktop: 1280×720 and 1440×900 | Bounded panels, useful map, keyboard navigation/focus. |
| Forms | Soft keyboard, browser zoom, 200% text, labels, local errors, retry preserves input. |
| Input | Touch, mouse, keyboard, screen reader, non-drag alternative, pointer cancel. |
| State | Slow load, map failure, GPS denied/stale/inaccurate, offline, empty world, expiry, competing claim, sold item. |
| Motion | CSS and MapLibre reduced motion; rapid reopen/close; no replayed reward reveal. |
| Real phones | Safari/iOS and Chrome/Android: safe areas, browser bars, keyboard, touch feel and performance. |
| Code verification | Existing `npm test` and `npm run build` for app changes; meaningful interaction checks for changed behavior. |

Record device/OS/browser, build, date and tested states. Browser emulation does not
establish physical-device acceptance. Application tests were not run for this
research because runtime code was unchanged.

## Token checks performed

Parsed `design-tokens.json` and calculated sRGB contrast for all ten declared text
pairs: all exceed 4.5:1; lowest is secondary ink on soft surface at 5.78:1. Action
text is 6.63:1. Control border against all three light surfaces exceeds 3:1.
These results apply to opaque token pairs only; alpha, overlays, art and actual map
backgrounds still require rendered checks.

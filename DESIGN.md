# AuraTrail game and interface direction

31 October 2026. Project design policy and proposed visual specification.
This document establishes the direction for subsequent work; it does not describe a
completed redesign. The current UI remains in `src/App.tsx`, `src/GameMap.tsx`,
`src/Ghost.tsx` and `src/style.css`.

Implementation order and completion gates live in [ROADMAP.md](ROADMAP.md).
The latest spatial policy is [WORLD-GENERATION.md](docs/WORLD-GENERATION.md): six
citywide Plzeň slots, distinct polygons, no overlap and meaningful walking between
sites. The [rule register](docs/GAME-RULES.md) preserves this direction and the
complete UI backlog without implying that the alpha has adopted it.

## The experience we are building

AuraTrail is a pocket exploration game: your character discovers small adventures in
real places, brings back a collectible and becomes recognizably yours. The intended
audience includes curious first-time players and existing Aavegotchi owners. The
first experience must make sense to both without requiring wallet knowledge.

Our working direction is **a playful Aavegotchi field companion**. Expressive ghosts,
crisp collectible art and confident purple/pink accents sit above a quieter real-world
map. The character and the place carry the personality. Interface ornament supports
them. Avoid generic SaaS summaries, overly polite filler and an interchangeable
pastel card system.

Quality means consistent authorship, useful hierarchy, responsive input and a fun
loop. No prompt, library or detector can establish that humans will perceive a
result as human-made. Playtesting and visual judgment remain necessary.

## Game design principles

| Pillar | Rule for a new feature | Reject or revise when |
| --- | --- | --- |
| Discovery | Give the player a visible curiosity and a comprehensible requirement. | The main experience is checking balances or reading panels. |
| Agency | Offer a useful choice: nearby quick visit, a chest, or a different place. | Every action produces the same generic reward card. |
| Character | A found Aura changes the actual character preview and map appearance. | Ownership is represented only by a number or badge. |
| Solo play | A first complete adventure works with no other players present. | Empty multiplayer activity blocks progress. |
| Respect for place | Keep real streets legible and location evidence honest. | A decorative path implies safe pedestrian navigation. |
| Trust | Distinguish earned XP, cosmetic items, shared GOLD and connected assets. | Rarity, staking or a linked NFT appears to guarantee income. |

Do not quietly add an energy meter, streak penalties, loot purchase mechanics,
competitive races or new currencies as decorative game UI. Such systems need their
own game design decision and acceptance criteria.

### First session

The following is the target sequence, not a claim about the current onboarding:

1. Show the character and a concise choice to enter the labelled demo arena. Keep
   wallet linking optional. Explain physical location when the player chooses it.
2. Surface one recommended playable objective, with another discovery easy to reach.
   Prefer an eligible free chest for the first cosmetic discovery when one exists.
3. Show distance and the next requirement. In the arena explain movement explicitly;
   outside it show GPS quality and never offer simulated movement as evidence.
4. Confirm the action. A successful server response produces a short reaction and a
   persistent result with the actual XP, GOLD and item, if any.
5. If an Aura was received, offer `Try it on`, then show the same character on the
   map. If no item was received, offer an honest next discovery instead.

Usability targets for a future moderated demo test: identify the next action within
five seconds of seeing the map; complete a first arena adventure within two minutes;
find and equip a received Aura within two more actions from its receipt. These are
project hypotheses to test, not measured results or promises about walking time.

### Returning sessions

Preserve a selected objective through panel navigation. Refresh expired content
without rerolling the player's existing world. Distinguish a personal completion
from an already claimed shared reward. End an adventure with a useful choice rather
than another forced panel. Offer short and longer discoveries through real available
content; variety in objectives requires designed templates and server support, not
new marketing descriptions for identical visits.

## Aavegotchi identity: evidence and adaptation

The official [brand style guide](https://www.aavegotchi.com/press-kit/AAVEGOTCHi_BRAND_STYLE_GUIDE.pdf)
shows a playful rounded wordmark, recognizable ghosts, pink/purple contrast,
white/light-pink space, and Kanit typography. Pages 12–17 cover colors, gradients and
type. Its white swatch is visibly white but printed with `#000000`; use actual white
for white rather than propagating that apparent source typo.

The [asset repository color module](https://github.com/aavegotchi/aavegotchi-assets/blob/b302ce569ac7f98a97947ce4e66f63bae85a0c66/colors.js)
contains a different named palette. These are two source systems, not one set of
interchangeable values. We choose a documented adaptation of the PDF palette for
this direction; existing on-chain asset colors remain unchanged.

| Evidence from the brand guide | AuraTrail application | Boundary |
| --- | --- | --- |
| Purple `#672EEB`, dark purple `#441C6C`, off-black `#1A0335` | Strong primary action, character frame and readable ink. | These are not the current app's CSS colors. |
| Pink `#FF1DFF`, light pink `#FFE8FF` | A rare discovery accent and soft character stage. | Never pink microcopy on a white map. |
| Green/teal `#51B4BA`, yellow `#FEF87D` | Reference hues for world/cosmetic art. | Do not assume either passes text or control contrast. |
| Kanit; bespoke Aavegotchi display lettering | Proposed Kanit 400/500/600 for UI and headings; original AuraTrail wordmark treatment. | Do not invent access to the proprietary display font or recreate the official logo. |
| Pixel faces, expressive wearables, collectible silhouette | Consistent character renderer and a coherent chest/coin/Aura asset family. | Verified originals must retain their identity and provenance. |
| Branded gradients on promotional compositions | Optional small reward or title treatment when deliberately art directed. | No automatic full-screen animated gradient behind the walking map. |

This is an Aavegotchi-compatible game direction, not an assertion of official
endorsement. Keep AuraTrail's name and NEAR gameplay identity. The existing Base
ownership integration does not transfer originals to NEAR or turn them into saleable
AuraTrail items. Follow `THIRD-PARTY-NOTICES.md` before distributing new assets.

### Palette roles and typography

`docs/design-tokens.json` is the proposed source of truth for a future scoped
implementation. It is not imported by the app today.

| Role | Proposed value | Use |
| --- | --- | --- |
| Ink | `#1A0335` | Headings, body text and key outlines. |
| Secondary ink | `#665577` | Supporting text on the documented light surfaces. |
| Surface | `#FCFAFF` | Quiet readable sheets. |
| Raised surface | `#FFFFFF` | Inputs and local controls. |
| Soft surface | `#F2EBFF` | Selected groups and character stage. |
| Action | `#672EEB` with white text | One principal action per surface. |
| Discovery | `#FF1DFF` with dark ink | Short celebratory accents, never a generic status color. |
| Coin | `#FEF87D` with dark ink | Coin art and explicit reward values. |
| Success | `#176553` on `#E3F6EE` | Confirmed completion, paired with text/icon. |
| Error | `#A32947` on `#FFF0F3` | Actionable errors, paired with text/icon. |

Use 16px/1.5 as the body and form baseline, 14px/1.45 for secondary labels,
12px/1.4 only for optional annotations, and 20/24/32px for the heading hierarchy.
Use tabular numerals for balances and countdowns. Financial amounts must retain full
precision in detail/review views; compact HUD rounding must not change settlement.
Long player names, translated strings and 200% text must reflow.

### Art and component grammar

- Keep one light direction and one shadow treatment across game objects. Preserve
  native pixel grids and deliberate integer scales for sprites where possible.
- The fallback explorer currently uses a 48×56 SVG view box. Preserve its geometry
  until an intentional asset replacement. Canonical appearance SVGs keep their own
  native geometry. Do not pixelate operational text or the entire WebGL map with CSS.
- Game objects use a shared authored family: coin, closed/open chest, Aura, discovered
  place, completed place. Utility actions keep the existing Phosphor family. Avoid
  mixing emoji, arbitrary Unicode, glossy 3D icons and line icons for equivalent roles.
- A sheet has a surface and limited elevation. A quest row uses spacing and artwork;
  it does not need another bordered card inside another card. A collectible slot can
  have a frame because equipment is a meaningful game object.
- Keep distinct geometry: 8px controls/slots, 12px item surfaces, 20px sheets, pill
  shapes only for compact status. Avoid applying one large radius to every element.
- Use spacing 4/8/12/16/24/32/48. Use a fixed layer order: map, markers, HUD, navigation,
  sheet, modal, feedback. Give each layer an explicit pointer-interaction policy.

## Navigation and screen composition

The intended navigation is `Explore`, `Inventory`, `Community`, `Market`, `Wallet`.
This preserves the accepted creator-economy direction. Community appears when its
initial truthful content surface exists; do not publish a hollow tab as if the full
creator platform were implemented. Move Game fund to `Settings → Game economy`,
with an explicit link from Wallet and preserved transaction proofs.

### Phone explore screen

Use a compact player identity/XP header and an explicit mode label. Keep map,
character, one objective and recenter visible. Balance is secondary; detailed
financial controls belong in Wallet. Do not make the wordmark and tagline consume
the most valuable walking viewport.

The adventure sheet has deliberate states: collapsed objective, discovery list,
selected quest and result. Starting proposals: a 112–144px collapsed objective,
roughly half-height browse sheet, and a large detail sheet when needed. These are
content-driven bounds, not fixed promises: safe areas, enlarged text and the keyboard
take priority. Keep at least half the usable map visible in the default collapsed
state; a detail/form state may cover it intentionally.

One objective surface contains the place name, straight-line distance, the actual
requirement, confirmed reward availability and one action. `Nearby discoveries`
opens the wider list. A working sheet may support drag, but also has labelled
`Expand`, `Collapse`, `Close` and Back behavior. Never draw a drag handle if it does
not work. A sheet gesture must not pan the map or accidentally move the arena player.

### Desktop and landscape

Keep a bounded left objective panel, a broad map and compact player HUD. Inventory
can use a large character preview with an item grid. Do not scale phone typography
down to fill a wider panel. On a short landscape phone, move quest detail into a
side region or an explicit full detail surface; do not stack header, sheet and tabs
until the map disappears.

### Character and inventory

One appearance renderer must compose the verified original or fallback explorer
with both equipped Aura slots, consistently in the map, profile, inventory and reward
preview. A preview is labelled until equipment is confirmed. If an original cannot
load, retain readable identity and provide a retry/fallback; do not silently claim a
different character is equipped.

Show inventory first: character, above/below slots, actual items and equipment state.
Move optional `Link Aavegotchi` discovery to a secondary section. Item selection
opens art, name, rarity text, edition, slot, equipment state and supported actions.
Selling is secondary to trying on a first discovery. Do not display a rarity as a
price prediction. Keep Base originals out of the demo sale flow.

### Community and wallet

The initial Community surface can truthfully regroup existing tasks and map notes.
Profiles, follows, creator commitments, likes and paid access remain planned until
their backend and accounting are implemented. Show creator attribution and clear
content status before visual popularity metrics. Nearby lists need a non-map
alternative; never require a pin tap to read content.

Wallet separates demo balance/positions from verified testnet account data. Put
explanations at the decision they qualify. Staking is optional and never the primary
answer to an empty free play session. Keep maturity, pending withdrawal and ready
withdrawal states visible. Do not redesign a pending operation into a success screen.

## Interaction, accessibility and game feel

- Effective targets: 48×48 CSS px on touch, with separation; a 24px glyph may sit
  inside that target. Do not adopt the source game's internal canvas units as CSS px.
- Use visible focus, named native buttons and labelled inputs. Dialogs have proper
  semantics, initial focus, focus containment, Escape and return to their trigger.
  Prevent background movement shortcuts while a dialog or editor has input focus.
- Never require hover, long press, sound, color or dragging as the sole way to act.
  Keep a nearby list alternative to map pins and textual quest status.
- Body contrast target: 4.5:1; large text and meaningful control boundaries: 3:1.
  Validate actual composited backgrounds. Use solid surfaces behind important text.
- Keep browser zoom. Use 16px input text, `100dvh`, safe-area insets on every anchored
  surface and capability-gated hover. Treat keyboard-open layout as a screen state.
- Feedback begins on press, but reward, sale and financial actions execute through
  their normal activation handlers. Do not trigger a transaction on pointer-down.
- Proposed motion: press 100ms, local state feedback 160ms, sheet 240ms with
  `cubic-bezier(0.23, 1, 0.32, 1)`. Gesture animation may be interrupted. Repeated
  navigation does not wait for an entrance sequence.
- A confirmed first Aura may have a skippable reveal of at most 900ms. Ordinary
  coin pickups use brief local feedback, batch announcements and a quiet counter;
  they must not repeatedly overwrite an important error or receipt.
- Reduced motion removes movement, camera flights, shake and particle bursts.
  A short opacity change may remain. An existing global CSS rule alone does not
  control MapLibre's `easeTo` and `flyTo` calls.
- Sounds and haptics are optional enhancements with saved controls and visual
  equivalents. No autoplay audio. Do not claim web vibration works on all phones.

## State and wording contract

Use a state model per interaction instead of unrelated booleans that allow a closed
quest, active claim and success panel at once. Navigation, world data and asynchronous
operation state are separate. Cancelled animations cannot cancel a settled reward.

| State | What the player sees | Available action |
| --- | --- | --- |
| Ready | Exact requirement and reward status. | `Open chest` or `Confirm visit`. |
| Too far | `Get closer to open this chest` and distance. | `Show on map`; arena movement only in arena. |
| GPS uncertain | Accuracy/age explanation without pretending the map proves position. | Retry location or return to demo arena. |
| Pending | `Checking visit…` inside the active surface. | Prevent duplicate activation; retain context. |
| Success | Actual server-confirmed XP, GOLD and item, if awarded. | `Try it on` or `Back to map`. |
| Shared GOLD claimed | Personal XP availability and shared prize state separately. | Complete for XP if allowed. |
| Closed | Explain expiry and preserve an existing receipt. | Find another discovery. |
| Offline/failed | Explain that confirmation has not arrived. | Retry safely; preserve entered content. |

Use simple English and stable action names. Prefer `Nearby discoveries`, `Open chest`,
`Equipped`, `Reward collected`, `No discoveries in this area yet`. Avoid repeating
`little`, `magic`, `journey`, `unlock your potential`, or decorative all-caps eyebrows.
Keep necessary mode, network, ownership and financial labels readable.

## How to work with AI

1. Give the agent a concrete player moment, this design policy, current screenshot,
   real content, platform constraints and the allowed change scope.
2. For hierarchy changes, compare two or three small compositions against the same
   content before choosing one. Do not mix whichever details look fashionable.
3. Build one complete interaction with all meaningful states. Use existing React,
   TypeScript, MapLibre and CSS. A repository recommendation is not a reason to
   migrate to a game engine, Tailwind or several motion libraries.
4. Critique the result at normal phone scale. Ask what the player sees first, what
   they can do, what changes after input, and what still needs explanation.
5. Check accessibility and performance after composition; then check art, alignment,
   typography, wording and timing. Treat automated design findings as review inputs,
   not as an authority that can ban the chosen brand color.
6. Verify the real UI and the core game loop. Save evidence for changed states and
   report real-device checks that remain. Do not call a mockup integrated or deployed.

Reusable task brief:

> Improve [one player moment] in AuraTrail. Read DESIGN.md and the relevant backlog
> item. Preserve the accepted economy and integration boundaries. Explain the player
> problem, compare compositions if hierarchy changes, implement the chosen interaction
> with real data and all important states, inspect it at phone and desktop sizes,
> verify keyboard/reduced-motion behavior, and report evidence and limitations.

## Acceptance

A design slice passes only when it is playable, readable, truthful and visually
coherent. The full verification checklist and implementation order are in
`docs/UI-UX-IMPROVEMENT-PLAN.md`. Research scope, source revisions and intentionally
rejected generic advice are in `docs/UI-UX-RESEARCH.md`.

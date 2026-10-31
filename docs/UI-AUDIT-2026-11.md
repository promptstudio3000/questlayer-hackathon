# UI/UX audit, 1 November 2026

Scope: the whole player-facing shell as it runs from the current `main` checkpoint, observed in an isolated
local build (Chromium via Playwright, 390×844, 360×780, 844×390 and 1280×800, device scale 2). Screenshots are
in `output/qa/2026-11-E0/ui-before/`. Source findings are marked **S**, observed behavior **O**, proposals **P**.
Map tiles could not load in the audit environment (external tile host blocked), so the map itself is not judged here.

## 1. Player problem

A new player cannot tell what the game wants from them. The first screen asks for a wallet, the map is covered
by chrome and switches, two independent "modes" (Demo / NEAR testnet, arena / GPS) are exposed with five
different names, and financial or network disclaimers sit where the next action should be. The character and the
discovery, which carry the Aavegotchi identity, are the smallest things on screen.

## 2. Findings

| # | Before (observed / source) | After (proposal) | Why |
| --- | --- | --- | --- |
| 1 | **O** Welcome dialog: primary "Continue with NEAR", then "Enter the demo world", passkey button, passkey toggle, two disclaimer lines. Four competing actions before play (`src/App.tsx:3490-3586`). | One input (name) and one button "Start exploring". Passkey offered later as "Secure your explorer" after the first discovery. External wallet under Settings → Advanced. | Mobile-game onboarding rule: get into the loop in seconds, no account creation first. Hackathon track bonus for no wallet popups. |
| 2 | **O** Two realm switches (Explore sheet and Bounties) plus realm labels in topbar, balance pill, HUD, footer ("DEMO GOLD · NEAR TESTNET"). | One realm for the player. The network label lives in Settings → Advanced and `/api/health`. The only visible mode switch is "Play here by tapping" ↔ "Use my location". | Rule D05/O09 keep disclosures available, not everywhere. Players do not choose a blockchain. |
| 3 | **O** Topbar wordmark + tagline "WALK. DISCOVER. COLLECT." consumes the top of the walking viewport on phones. | Compact header: tiny brand mark, objective chip, XP ring on the avatar. | DESIGN.md "Phone explore screen". |
| 4 | **O** Five bottom tabs (Explore, Inventory, Market, Community, Wallet) + "?" + "N" rail badge on desktop. | Four tabs: Explore, Inventory, Community, Profile. Market inside Inventory (sell/buy an Aura is an item action). Wallet content under Profile → Advanced. | Fewer destinations, market is an item action not a venue. |
| 5 | **O** Explore sheet shows "Testnet walks · GPS checkpoints · NEAR rewards" card, "Where to today? · 6 CITY ZONES", a "Map coverage & access" disclosure and zone cards; distances read "2239 m straight-line". | Collapsed objective (one card), "Nearby discoveries" list on expand. Distance as "2.2 km away" with a small "as the crow flies" hint only in detail. | DESIGN.md sheet states; D03 keeps the straight-line truth in detail. |
| 6 | **O** Zone detail action reads "Move here in demo"; cursor icon. | "Walk there" in arena with the character animating along the map; "Open chest" / "Confirm visit" when in range. | Verbs name the game action, not the mode. |
| 7 | **O** Wallet tab: "Rewards | Staking | Demo" switch, "NEAR testnet" pill, "Sponsored test tokens · no monetary value", "The testnet walks are not available yet." | Profile → Advanced: "Account", "Receipts", "Staking (pilot)". Empty states say what to do next, not what is unavailable. | Rule D05 every state has an action. |
| 8 | **O** Inventory: "Demo 0 | NEAR testnet" collection switch; "Demo outfit"; "Starter explorer appearance". | One collection. Items carry a small "secured" mark once minted on-chain (no wording about chains). | One inventory per player; the chain is a property of an item, not a tab. |
| 9 | **O** Landscape 844×390: the sheet covers the map, the map chip is overlapped by the loading banner. | Side panel on short landscape; banners stack in a single feedback layer. | DESIGN.md desktop/landscape. |
| 10 | **S** `src/style.css` 4 159 lines with three conflicting `:root` palettes (`style.css:2-15`, `:2939-2948`, `play-ui.css:73-87`), 192 font-size declarations below 14 px, `styles.css` next to `style.css`. | One `src/tokens.css` generated from `docs/design-tokens.json`; delete dead legacy selectors; 16/14/12 only. | Rule D06, D09. |
| 11 | **S** Prose: `CreatorCommunity.tsx` 74 `<p>`, `NativeTasks.tsx` 52, `App.tsx` 34 + 7 fine prints; ten longest strings are 200–330-character policy paragraphs. | Policy text moves to "Details" disclosures and `docs/`; in-loop copy ≤ 2 short sentences per state. | Playability; DESIGN.md wording contract. |
| 12 | **S** Terms "wallet" (147 lines in App.tsx), "testnet" (48), "transaction" (29), "hash", "yocto", "on-chain". | Glossary: wallet→account, transaction→receipt/"saved", testnet→(omit; Advanced shows "test network"), mint→"secure". | Hackathon track: blockchain invisible in the loop. |
| 13 | **O** Welcome cannot be dismissed (`onClose={() => {}}`); busy label "Waiting for your wallet…". | Welcome is a full-screen first-run page, not a modal; busy label "Preparing your explorer…". | Dialog semantics (D10). |
| 14 | **O** Legend "Place / Completed / GOLD coin" and guide bubble "Need a little direction? Ask your guide" are permanent map overlays. | Legend removed (objects are self-explanatory with art); guide becomes a Profile entry and a one-time hint. | Map must stay readable (D04). |

## 3. Visual direction (Aavegotchi-compatible, as approved by the owner)

Evidence available offline: the brand palette extracted in `DESIGN.md` (purple `#672EEB`, dark purple `#441C6C`,
off-black `#1A0335`, pink `#FF1DFF`, light pink `#FFE8FF`, teal `#51B4BA`, yellow `#FEF87D`, Kanit) and the
official starter layers in `public/art/aavegotchi/`. aavegotchi.com itself could not be fetched from this
environment; the owner should share two or three reference screenshots so spacing, button shapes and the dark
hero treatment can be matched exactly.

Decisions for the redesign:

- **Surfaces.** Light "paper" sheets (`#FCFAFF`) over the map; one dark purple shell (`#1A0335`) for navigation and
  the first-run page so the ghost glows against it. No gradients behind the map.
- **Type.** Kanit 500/600 for headings, 400 for body, tabular numerals for XP and coins. 20/24/32 heading scale.
- **Buttons.** Pill primary in `#672EEB`, 2 px dark outline on game-object buttons (chest, coin), `:active` scale 0.97.
- **Pixel craft.** Keep integer scales (2×, 3×) for sprites; the ghost, chest, coin and Aura share one light direction.
- **Auras.** Each Aura gets a 48×48 authored sprite with 2–3 frames of idle motion (above: orbiting, below: ground
  glow), a rarity frame color and a short flavor line. Current single static SVGs are placeholders.
- **Map.** Keep MapLibre vector rendering (text stays crisp), but author a "pixel paper" style: 4-color terrain
  ramp, dithered water, 1 px dark road outlines, building fills flattened; pixelate only the player layer and
  objects, not labels. This replaces the earlier idea of pixelating the whole canvas, which killed readability.

## 4. Motion rules adopted (from Emil Kowalski's design-engineering guidance)

- Animate `transform`/`opacity` only; ease-out for entering/exiting, ease-in-out for on-screen moves, never ease-in.
- Durations: press 100–160 ms, sheet 200–250 ms, modal ≤ 300 ms; exits faster than entrances; stagger 30–80 ms and never block input.
- No animation on actions repeated many times (coin pickups get a 160 ms counter tick, not a reveal).
- Springs only for drag (sheet), bounce ≤ 0.2. Enter from scale 0.96 + opacity, not 0.
- `prefers-reduced-motion` removes movement including MapLibre camera flights; hover effects gated by `(hover: hover)`.

## 5. Mobile-game principles adopted

- First 30 seconds: see the character, see one objective, act once, get a confirmed result.
- Core loop on paper: every 30 s (walk/pick a coin), every 5 min (open a zone activity), every session (one Aura or level).
- No forced account creation; the account exists invisibly and is secured later with a passkey.
- One objective at a time; the list is secondary. Distances in human units.
- Every state has a next action (Ready / Too far / Pending / Done / Closed / Offline).

## 6. Verification plan for the redesign

Screenshots at 360, 390, 844×390 and 1280 for welcome, explore (collapsed/browse/detail/result), inventory, item
detail, profile; keyboard-open and 200 % text on the name input; reduced-motion run; real iOS Safari and Android
Chrome checks reported separately as done or outstanding.

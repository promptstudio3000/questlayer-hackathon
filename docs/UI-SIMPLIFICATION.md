# UI simplification pass (3 Nov 2026)

Source: the Figma review of 35 phone-390 screens (file QUESTLAYER-2026,
page "Editable UI 2026-11-03"). Goal: less text, compact game-like
screens, fewer submenus.

Rules the UI now follows (styles in `src/compact-ui.css`, loaded last):

1. **One-line panel header.** Back is an arrow icon left of the title
   (`.panel-back`), close is a 32 px round button on the right
   (`.panel-close`). No separate "Back to adventure" row.
2. **Sheets and dialogs close with a small corner ✕** (`.sheet-close`,
   32 px, absolute in the dialog corner). Item detail, locked Aura,
   Today's board and NPC dialogs use it.
3. **Compact tab bars.** Icon and label on one line, 40 px tall; on
   phones only the active tab shows its icon so four labels fit.
4. **At most one tab row per screen.** A second level is a chip row
   (Community: Community · Following · Started) or a labelled button
   that opens a sub-view with a back arrow (Inventory: Wardrobe, History).
5. **One helper line at most.** Disclaimers ("practice", "test network")
   are one badge with the full sentence in its tooltip.

Screen changes:

- Inventory: Items | Market is the only tab row; Wardrobe and History are
  labelled buttons; Practice/Secured moved into the filter chips
  (All · Above · Below · Secured · filter).
- Market: one header line (title · badge · refresh icon); no lead
  paragraph or Details disclosure.
- Community Quests: no kicker, heading or Details; one chip row + refresh.
- Community Creators: the creator-bonus ballot is a one-line card that
  opens the vote list.
- Community Tasks / Notes: intro text removed; Notes header is
  back · title · refresh · Write on one line.
- Profile: Character keeps Wardrobe and Market shortcuts only (Stake and
  Rewards are tabs); Stake intro is one sentence; Game economy has a back
  arrow in the header.
- Today's board: one lead line, corner ✕, claim button only when ready.

## Wave 2

- Map: the OpenStreetMap/ODbL notice starts collapsed to its (i) button
  (one tap opens it) instead of covering the map above the sheet.
- Discoveries: zone cards are slim rows (56 px art); the list heading is
  "Places today · N" instead of repeating "Nearby discoveries".
- Second-level switches (Rewards · Staking · Practice, Sponsored ·
  Practice tasks) are 36 px pill rows.
- Removed repeated disclaimers: "Test rewards · no monetary value" under
  the Test network chip, the Signed offers lead line, "Cosmetic only" on
  the set card, the "originals still being added" note in Wardrobe.

## Wave 3: phone shell (4 Nov 2026)

Styles in `src/mobile-sheets.css` (imported after `compact-ui.css`).

- Header: 56 px, the QuestLayer logo at the top left, then the HUD pills
  (Today's board, GOLD, level ring). The "650/900 XP" line is gone on
  phones; the ring shows progress.
- An open sheet owns the bottom of the screen: while Discoveries is
  expanded or a screen (Inventory, Community, Profile) is open, the bottom
  menu and the header slide away and come back when the sheet closes. The
  app shell carries `sheet-open` for this. Journeys switch screens by
  closing the sheet first (`scripts/lib/e2e-nav.mjs`).
- Back is always an arrow pointing left: the expanded Discoveries sheet
  shows "← Show map"; only the closed peek keeps the up arrow that opens it.
- Dialogs have one frame and one padding (14-16 px on phones), not the
  dialog padding plus the section padding. Badges gets the corner ✕ and its
  kind filter scrolls in one row.
- NPC dialogs: grid tracks may shrink (`minmax(0, 1fr)`) and locked chips
  wrap their gate text under the label, so long gates ("Reach Tier 2 …")
  no longer push the dialog past the right edge.

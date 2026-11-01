# Slice 2 "Today's pot": evidence (1 November 2026)

## Player problem and scope

A player sees coins and prizes on the map but cannot tell whether they are real, who pays for them, or how much
is left today. The Explore sheet had no answer. "Where rewards come from" sat in Profile → Advanced → Game economy,
which uses chain vocabulary and is written for auditors.

Scope: one compact **Today's pot** card on the Explore sheet and a tap-through page, **How rewards are funded**.
Data comes only from `GET /api/native/economy` and `GET /api/native/distribution`. The server, contracts, economy
values and Advanced ledger are unchanged.

Composition choice: the card sits in the browse (expanded) sheet under the objective and day row, not in the
collapsed 188px phone sheet. That sheet keeps one objective so at least half the map stays visible (DESIGN.md
"Phone explore screen"). Desktop and landscape show the card in the left panel.

## Before / After / Why

| Where | Before | After | Why |
| --- | --- | --- | --- |
| `src/App.tsx:2444` (practice Explore) and `:2918` (native Explore) | No funding information on Explore. | `TodaysPot` card: "Today's pot", a Books chip, a coins row and a prizes row ("4.2 of 6 GOLD left"), and the source ("Funded by sponsors"). | PLAN-FOR-OPUS slice 2: what is funded, what is left and where it comes from, at the decision point. |
| `src/App.tsx:3087`, `:147`, `:165`, `:2082`; `src/app-navigation.ts:15,63` | Funding was explained only under Settings → Advanced → Game economy (`NativeEconomyPanel`, chain words). | New `funding` tab: **How rewards are funded**. Explore stays highlighted, browser Back works, and the close button and **Back to exploring** return to Explore. **Detailed ledger** links to the existing Advanced page. | A player-language page with no chain words. The audit view stays for people who want it. |
| `src/reward-funding.ts:173` `potView` | none | One state model: `loading`, `practice` (both sources 503/404/unavailable), `failed` (network; `offline` from `navigator.onLine`), `ready` (with `stale`, `books`, `source`, open days and today). | Every state has text and an action (AGENTS rule 5). Unavailable values are never shown as zero. |
| `src/reward-funding.ts:82,92` | `NativeEconomyPanel` formats with a "test NEAR" suffix. | `goldExact` / `goldCompact` convert integer-unit strings with BigInt: 10^21 units = 1 GOLD (1 NEAR = 1,000 GOLD). The card rounds to 2 decimals and marks it "≈". The page shows full precision. | ECONOMY-RULES "Units". DESIGN.md: full precision in detail views. |
| `src/reward-funding.ts:101,173` | none | "Today" is the open day whose id date equals the Plzeň local date (`Europe/Prague`, as in `server/domain.mjs dayKey`). "Funded today" appears only when the audit returns per-date totals (`date-totals-match-publications.dates[]`, which another engineer is adding to `server/native/distribution.mjs` in this working tree). Otherwise the card shows only "X GOLD left". | Never show a number the endpoints did not return. Nothing is summed or inferred. |
| `src/reward-funding.ts:173` (source) | none | "Funded by sponsors" only when `staking.totals.realizedGameYieldPaid` is exactly `"0"` from a complete observation. Yield above zero gives "sponsors and realized yield" plus "Received so far". Anything else gives "sponsors or realized yield" and states that the split could not be read. | Only sponsor and realized-yield receipts may fund rewards (ECONOMY-RULES "Income"). This avoids claiming a split that was not observed. |
| `src/RewardFunding.tsx:46` `BooksChip`, `:477` | none | `verified` shows "Books checked" (success token) with each check named in plain words. `drift` shows "Books under review" (error token), the failed check marked, and "New days pause until it is fixed; collecting continues". `unavailable`/503 shows "Not checked yet", with no result and no raw server reason. | An honest status taken from the endpoint. Raw reasons can contain chain words. |
| `src/RewardFunding.tsx:217` page sections | none | Today's pot, Where the money comes from (sponsors, realized yield, the endpoint's `excludes` in plain words), How the money is split (50/50 buckets: ready / set aside / paid), Who gets what (coins, zone prizes, XP, unclaimed), Books checked, Forecasts (the endpoint's `outlook.reason`; no APY), Check again, Back to exploring. | Built from docs/ECONOMY-RULES.md and the two endpoints. |
| `src/reward-funding.css` | none | Semantic tokens only. Text is 16px body and 14px secondary. The card is 72px or taller, and the page buttons and links are 48px. `:focus-visible` uses `--focus`. Press scale uses `--motion-press` (0ms under reduced motion). Container queries drop the large coin tile below a 300px content width (360px phones) and the arrow below 240px (200 % zoom). | DESIGN.md and AGENTS rules 6, 9 and 11. |
| `src/RewardFunding.tsx:32` focus | none | Opening the page focuses its h1. Closing or **Back to exploring** focuses the card again. | AGENTS rule 10: focus return. |
| `docs/HOW-TO-TRY.md` §1 step 7, §5 | none | Steps to see the card in both modes. | The plan requires a HOW-TO-TRY update for each slice. |

## Screenshots (Chromium via Playwright, `capture.cjs`)

Practice state, live: my own isolated server on port 18787, with both endpoints answering 503 "not configured":
`explore-practice-503-{360,390,844x390,1280}.png`, `pot-practice-503-*.png`, `funding-practice-503-*-top.png`, `-partN.png`.

Populated state: the two endpoint responses are intercepted with `route.fulfill`. The values are realistic and
self-consistent: 200 GOLD funded (the 0.2 sponsor grant), 2 open days, today with 4.2 of 6 GOLD coins and 5 of
6 GOLD prizes left, 7 passing checks and zero realized yield:
`explore-populated-*.png`, `pot-populated-*.png`, `funding-populated-*-top.png`, `-partN.png`.

Extra states at 390: `*-drift-390*` (one failed check), `*-failed-390*` (network aborted; inline **Try again**),
`*-mixed-yield-390*`, `*-native-ledger-390*` (Explore in native play, without the practice suffix), `*-zoom200-390*`
(195 CSS px at DPR 2, which matches 200 % browser zoom), `keyboard-focus-{pot,back}-1280.png`.

`interaction-log.txt` holds the automated checks for each viewport and state. Results:

- The card and the page contain none of the words NEAR, testnet, transaction, wallet or yocto.
- The smallest rendered text is 14px.
- No button or link in either surface is under 48×48.
- The page has no horizontal scroll.
- Keyboard: Tab reaches the card, Enter opens the page and focuses its h1, and **Back to exploring** returns focus to the card.
- Browser Back from the page returns to Explore.
- The only console error is a 500 from `/api/character/model` (3D pawn). It is unrelated and happens before this change too.

## Implemented, proposed, not verified

**Implemented:** everything in the table above. `npx tsc --noEmit -p tsconfig.json` passes. `DISABLE_BACKGROUND_WORKERS=1 npm run check` passes: 579 tests, 0 failed. I also ran assertion checks on the conversion, day-key and state functions from a scratch script. No test files were added, because this task allowed edits only under `src/` and `docs/HOW-TO-TRY.md`.

**Proposals (not built):**
- A per-day "funded" field on `/api/native/distribution` `days[]`. Without it, "funded today" depends on the per-date check that is in flight.
- A "Today's pot" line in the collapsed phone sheet once the objective card is smaller.
- A real 200 % layout for the app shell. At 195 CSS px the existing shell clips the sheet. The card itself reflows, but the shell around it does not (see `explore-zoom200-390.png`).
- Short landscape (844×390): the existing shell leaves about 220px for any non-Explore page, so the funding page needs a lot of scrolling. This is UI-AUDIT row 9, not changed here.

**Not verified:**
- Real iPhone Safari and Android Chrome. No hardware was available.
- A real populated server. The local native endpoints answer 503, so the populated state comes from intercepted responses.
- Screen-reader announcements.
- iOS Dynamic Type, which does not scale the px-based text.

# Creator safety browser verification

31 October 2026. Actual authenticated host: `http://localhost:8798/`. Disposable database: `/private/tmp/questlayer-safety-qa/game.sqlite`. Policy `qa-safety-v1`  / 200 demo XP is synthetic QA configuration. No wallet, real/testnet payment, GPS request, quest claim, ordinary `.data` change, commit or deployment occurred.

## Actual player and trusted-operator scenario

IAB was unavailable in this batch. A dedicated Chrome session was created without operating existing user tabs. A fresh guest **QA safety walker** entered the demo world, then opened the seeded public **Riverbank Stories** quest, **Three quiet details beside the river**.

- Quest: `creator-qa-path-3d1af4fb-664b-47f6-9f58-b7d42b1c74da`.
- Participant/reporter: `player_b163ccdf-548f-4d00-ac52-9f753bc49d3b`.
- Report: `creator_report_daaf6829-c1a4-4611-8d0a-fdd6fd24aee7`, reported revision 1; initially open/version 1, finally reviewed/version 2.

1. **Start free quest** confirmed saved accepted revision 1, In progress. The disclosure explicitly said no XP, item or GOLD reward is configured and that a start does not establish a physical visit.
2. Opened **Quest safety → Report revision 1**. Reason initially empty, confirmation unchecked, Send disabled. Selected unsafe-place and entered explicitly synthetic text: “Synthetic QA rehearsal only: no real hazard was observed. Exercise the unsafe-place report workflow for this disposable quest; this is not a field safety finding.”
3. Pressed Escape. The dialog closed and read-only DOM inspection established focus returned to **Report revision 1…**. Reopening restored only optional context; reason returned to Choose a reason, confirmation was unchecked and Send disabled. Selected the reason again, freshly checked confirmation, then sent. UI confirmed private receipt and said the report had not closed the quest or cancelled participation.
4. Opened **Block creator…**. Native confirmation described shared bilateral notes/profile/follow/discovery/presence effects and retained accepted rights. Confirmation initially unchecked and action disabled. Freshly confirmed. Public attribution disappeared from quest detail, while the full accepted revision 1 stayed readable and In progress.
5. Community's public creator feed became empty. **My creations → Blocked creators** privately listed Riverbank Stories. Explicit unblock opened another unchecked confirmation; removing the current player's block emptied that owned list and restored the public quest in discovery. This established an unblocked baseline before operator suspension.
6. Parent/runtime independently reviewed the synthetic report, then separately suspended the quest using trusted CLI. Review alone did not change publication. Suspension changed Published/version 3 to Closing/version 4 with exactly 1 open obligation and200 XP still held; it did not resolve or finalize anything.
7. Refreshed actual UI with the player's block removed. Public discovery was empty. **Your started quests** still listed accepted revision 1/Closing. Opening it retained the exact original instructions, In progress and the independent-review/no-reward explanation. No public report details or operator finding appeared in player UI.

At the end of the safety journey, read-only metadata established exactly 1 report (reviewed/version 2) and exactly 1 open participation for revision 1. Walker had 0 XP, 120,000 GOLD, 1 inventory row and 1 history row. These are current counts at that phase boundary, not an invented before/after inventory snapshot. Parent/runtime's separate `../../W02-W10-next/moderation-host.json` contains trusted-operation and author-invariant evidence. Nothing in the UI flow resolved or finalized this participant. Parent's subsequent Demo coin checks are separate activity; later coin XP/GOLD must not be attributed to creator reports or blocks.

## Actual report/layout captures

`computed-measurements.json` records 26 named capture states, actual viewport dimensions, document width and scoped control geometry/styles. All recorded states had no document horizontal overflow. All visible creator buttons measured at least 48 CSS px high. Native 24px checkboxes sit inside effective labels at least 48px high. Report inputs/select/context use 16px text; secondary text 14px.

| Viewport | Captures |
| --- | --- |
| 360×780 | `actual-report-360x780.jpg` |
| 390×844 | `actual-report-390x844.jpg`, report receipt, block confirmation, owned block list, hidden/restored public feeds, accepted rights after block and after suspension |
| 844×390 | `actual-report-844x390.jpg`: scrollable native dialog in short landscape |
| 1280×800 | `actual-report-1280x800.jpg` |
| 390×480 | `actual-report-focused-390x480.jpg`: textarea focus and reduced-height approximation; this does not open a real virtual keyboard |

The decisive protected-rights capture is `actual-suspended-accepted-revision1-retained-390x844.jpg`. Dialog content remains vertically scrollable in short landscape and at enlarged text. Escape/focus return was observed; no real hardware keyboard/zoom claim is made.

## Explicit simulated adverse checks

Used `http://127.0.0.1:5173/dev/creator-community.html` with the visible **simulated API only** banner. These actions never touched the actual host's report, block, XP or reward state.

- `state=safety&fault=report-lost&delay=1`: while pending, reason/context/confirmation/discard/Send were frozen, with Sending report shown. First reply was deliberately lost after the fixture committed. Error remained inside the dialog. Escape/reopen restored text but reset reason and confirmation. Freshly choosing the identical terms and confirming recovered the receipt; UI showed the confirmed private-report result.
- `state=safety&fault=block-lost&delay=1`: Confirming/disabled controls appeared, then the deliberate lost-reply error. Escape/reopen produced a fresh unchecked block confirmation. Explicit identical retry recovered the receipt and showed the owned blocked list.
- `state=safety&text=large`: report form captured with 32px text at 360/390, including the native select and safety summary. `large-contrast-measurement.json` records 390px document width with no document overflow; native dialog clientWidth 348 equals scrollWidth 348. This is a controlled 200% text approximation, not OS text enlargement.

Pending/error/recovered screenshots are prefixed `fixture-`. `fixture-report-lost-reply-error.jpg` is the actual 1512×893 desktop fixture viewport; other fixture filenames with360/390 contain their recorded corresponding dimensions. The pending390capture was overwritten by the verified 390px retry frame. Duplicate names in raw capture work were deduplicated to the final matching image/measurement.

Exact once-only report storage is established by the real SQLite/API client regression test; the fixture UI confirms visible recovery behavior and does not pretend its hidden in-memory counters are a browser-observed production journal.

## Rendered contrast and small correction

All report text/checkbox labels computed to `rgb(102,85,119)`  / `#665577` on the native dialog's `rgb(252,250,255)`  / `#fcfaff`, **6.470:1**. This reuses the scoped correction from the previous batch and exceeds 4.5:1. `min-width:0` now prevents intrinsic field widths from expanding the scoped grid. The enlarged fixture now includes select/summary rather than leaving those controls at 16px. Those final CSS/fixture adjustments were rendered and measured in Vite; parent owns the final combined static build.

## Authenticated map-art supplement

Before entering Community, captured the actual authenticated Explore map at 360×780, 390×844, 844×390 and 1280×800 (`actual-map-explore-*`). Then safely selected Chvojkovy lomy without movement/claim/GPS/payment and captured the settled zone (`actual-map-zone-selected-1280x800.jpg`). The first camera-transition frame had incomplete tiles; it was replaced by the settled rendered frame, which shows real map tiles and authored activity/coin art.

Read-only geometry established six place markers and three selected-zone activity markers each at 48×48 CSS px. Accessible labels distinguished discovery, walk, chest availability, closed place and tier requirement. This is actual map integration evidence, separate from the art agent's controlled SVG/canvas fixture.

**Timing:** these map screenshots precede the parent's final zone-caption/eligible-quest alignment and XP-fallback correction. They establish the rendered map assets and target sizes at capture time, not final caption behavior or physical navigation quality. Geography and generation were not changed by this UI agent.

## Limits and handoff

Physical Safari/iOS, Chrome/Android, real virtual keyboards, browser zoom, assistive technology and field-safety tests remain unverified. A transient browser automation/CDP timeout recovered without an app finding; select operations used observed control IDs after the label-locator adapter failed to match. No direct page-state mutation or hidden application-state read was used.

Fixture tab closed; viewport reset. Actual Chrome tab 986754894 on 8798 was temporarily retained, then closed at the parent's explicit request after the parent opened its own authenticated tab (the original was owned by this session). No further browser interaction occurred beyond that cleanup. No owned QA tabs remain. Source 11 client tests/build evidence are in this directory; final combined build/tests belong to the parent report.

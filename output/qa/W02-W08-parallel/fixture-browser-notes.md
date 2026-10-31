# Draft fixture browser review

Date: 2026-10-31. Scope: actual React MapNotes and NativeTasks components running in their local development fixtures at `http://127.0.0.1:5173`. The fixture supplies synthetic player, location, note, task and transaction data. It opens no real wallet, requests no real GPS permission and proves no chain settlement.

## Source contrast correction

Map note compose, photo, checkbox and report-dialog labels inherited the global `#8e7c99` colour (calculated 3.69:1 against fixture cream `#fcfaff`). Their scoped colour now uses `var(--ink-secondary, #665577)` (calculated 6.47:1 on cream), keeping the existing 16px form baseline. Global colours and control layouts are unchanged. Browser computation confirmed `rgb(102, 85, 119)` and `16px` on compose, photo, GPS/publication and report-dialog labels. Native task form labels computed `rgb(26, 3, 53)` at `16px`.

## Interaction results

Completed using actual UI controls in an isolated Chrome fixture session. IAB was unavailable in this environment, so the available Chrome browser was used. Both temporary tabs were closed and the viewport override reset before returning control to the parent. The actual application author tab was not touched.

| Interaction | Observed result |
| --- | --- |
| Enter note text, check publication consent, Leave/Return notes panel | Text restored exactly; both GPS and publication checkboxes unchecked. |
| Enter a different GPS-scope note, check both choices, Leave/Return | GPS text restored exactly; both choices unchecked. Returning to arena restored its separate original text. |
| Switch player | Other player's composer was empty with both choices unchecked. Returning to the original player restored its arena text. |
| Reload page | Original arena text survived reload; publication remained disabled until fresh consent. |
| Publish a note with simulated lost response | UI briefly showed unknown publication status, then status read-back confirmed one note. The settled list contained exactly one matching note, no pending journal section and no remaining draft/resume action. |
| Open note report dialog, then Escape | Reason/details labels used the corrected 16px colour; Escape closed the dialog and focus returned to the report action. No report was sent. |
| Enter task title/area/requirements/reward/deadline, Leave/Return and reload | All fields restored; the component returned to task list/editing rather than restoring funding review or acknowledgement. |
| Check funding acknowledgement, Leave/Return, review again | Acknowledgement unchecked; Lock prize & publish disabled. |
| Change synthetic contract code, then Refresh | Funding review closed, acknowledgement removed and raw draft title retained. A fresh review was required. |
| Simulated task accepted with lost confirmation, then Refresh and Publish again | Existing exact task opened with the explicit no-new-funding notice. Fixture transaction request count stayed **1**, and the operation ID did not change within that fixture run. The durable production wallet journal was not exercised by this isolated component fixture. |

During review, the NativeTasks fixture was corrected to return its seeded evidence only for task 1, rather than displaying task 1's evidence on a newly created task. The corrected lost-confirmation proof was rerun and recaptured; the new task has no unrelated evidence and the counter remains one. The saved measurements contain the initial run and the independent corrected run, each with one request; their operation IDs differ because fixture code/deadline context was deliberately reset between runs.

[Saved DOM measurements](fixture-draft-measurements.json) record values, checkbox states, rendered label styles, viewport dimensions and fixture counters. The early note lost-response observation is a transient pending state; the later settled observation is the confirmed result.

## Viewport evidence

| Viewport/state | Notes | Native task creation |
| --- | --- | --- |
| 360×780 | [Compose](notes-compose-360x780.jpg) | [Create](task-create-360x780.jpg) |
| 390×844 | [Compose](notes-compose-390x844.jpg) | [Create](task-create-390x844.jpg) |
| 844×390 short landscape | [Compose](notes-compose-844x390.jpg) | [Create](task-create-844x390.jpg) |
| 1280×800 desktop | [Compose](notes-compose-1280x800.jpg) | [Create](task-create-1280x800.jpg) |
| 390×480 focused-height approximation | [Focused text](notes-focused-height-approx-390x480.jpg) | [Focused requirements](task-focused-height-approx-390x480.jpg) |
| 390×844, enlarged 32px form text | [Enlarged notes](notes-large-text-390x844.jpg) | [Enlarged creation](task-create-large-text-390x844.jpg) |

Additional states: [report dialog](notes-report-dialog-390x844.jpg), [confirmed note after lost response](notes-lost-response-confirmed-390x844.jpg), [funding review](task-funding-review-390x844.jpg), and [existing task with one request](task-lost-response-existing-one-request-1280x800.jpg).

Full-page captures show the complete form at each requested viewport width; focused-height captures show the actual reduced-height viewport. Measured document width equalled viewport width at every normal matrix size and both enlarged-text cases: no horizontal page overflow. Long native select/input values remain editable within their controls rather than expanding the page. Text, labels, buttons and disclosures wrapped without overlap in the reviewed full-page compositions. Visible focus remained on the edited input.

Reduced-height and fixture 32px text are approximations, not actual mobile keyboard, browser zoom or OS Dynamic Type checks. Physical Safari/iOS and Chrome/Android remain unverified. The parent separately reviews actual application/browser-history and dialog navigation. No real GPS permission, wallet, RPC or chain transaction was used.

An additional minimal `/dev/inventory-draft.html?text=large` fixture now renders the actual Inventory and price dialog with a separate synthetic player and one Aura. Original ownership is mocked as unlinked; the listing callback always returns an unconfirmed local result and preserves the price. The query enables 32px dialog text through fixture CSS. The parent owns its browser check and evidence; no browser control was resumed for this addition.

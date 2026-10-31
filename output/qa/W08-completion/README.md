# W08 — reviewed observation completion

## Player problem and delivered scope

A started creator quest previously retained instructions but had no declared, independently reviewable player completion workflow. The delivered v1 lets an author propose an explicit observation prompt in a reviewed revision. A participant keeps that accepted revision, writes private text, deliberately submits it, receives independent feedback, and retains a durable completion receipt after acceptance. Acceptance and obligation resolution occur together. This is a local demo implementation; creators remain optional and disabled by default.

Composition comparison: placing a permanently open evidence editor under every instruction would mix reading with sending private text. The implemented composition keeps the accepted instructions and progress together, then opens one native dialog for deliberate private submission. The dialog repeats the accepted revision, prompt, privacy boundary and current attempt. Feedback and the final receipt return to the instruction view.

| Before | After | Why / owning source |
| --- | --- | --- |
| Free-form instructions and legacy operator resolution | A strict `observation-v1` requirement is saved as part of a revision and independently approved before new starts | Players know what is assessed before admission; later author changes cannot rewrite accepted requirements. [policy](../../../server/creators/completion-policy.mjs), [lifecycle](../../../server/creators/lifecycle.mjs), [editor](../../../src/CreatorCommunity.tsx) |
| No private player evidence/progress | Actor-bound evidence attempts, private feedback and pending/rejected/terminal/completed projections | Evidence is never part of discovery, author reads or public moderation surfaces. [completion service](../../../server/creators/completion.mjs), [API](../../../server/creators/api.mjs) |
| An operator could resolve any free participation without a structured assessment | Structured starts require the configured independent completion reviewer; generic resolve remains available only for legacy admissions | Neither author nor participant can approve their own work; stale decisions and bypasses fail. [operator](../../../server/creators/operator.mjs), [CLI](../../../scripts/creator-operator.mjs) |
| A result could be mistaken for a reward or physical visit | Durable receipt explicitly records reviewed text, zero XP/GOLD, no item, and `rewardStatus:not-configured` | No reward policy was adopted; review does not attest GPS, attendance or a walked route. [policy/award adapter](../../../server/creators/completion-policy.mjs) |
| Adding a required prompt field to the old local draft schema would reject existing two-field drafts | Prompt uses its own allowlisted draft scope; title/description retain their original schema | Existing unsaved stories survive the upgrade. Consent and operation IDs are excluded from both text stores. [editor](../../../src/CreatorCommunity.tsx), [regression test](../../../tests/creator-completion-drafts.test.mjs) |
| Native dialog boundary Tab left focus on BODY in the tested Chrome and IAB sessions | Root added the shared bounded focus loop; last→first and first→last now remain inside | Historical before and after observations are retained separately; Escape still returns focus. [before](keyboard-focus.json), [after](keyboard-focus-after.json), [shared primitive](../../../src/Dialog.tsx) |

## Explicit operational policy, not reward policy

`creator-observation-v1` allows one prompt up to 500 characters, evidence up to 1,000 characters, one pending attempt and up to three attempts. The UI discloses the bound before Start, in the author editor, and at submission. Rejections one and two permit corrections. A third independent rejection resolves the obligation as **NOT completed**, retains all attempts and feedback, and creates no completion receipt or reward. The trusted CLI requires `acknowledgeNotCompleted:true` for this terminal decision; its private queue warns about the consequence. Evidence never expires automatically.

An existing plain admission remains legacy even if the author later publishes a structured revision. It keeps readable instructions and the independent legacy resolution path. Completed/rejected/legacy records stay private and readable after later revisions, bilateral blocks, suspension, closure, daily reset and reopening the database. The schema/restore agent integrated these tables with the versioned compatibility and restore catalog.

No public appeals, participant abandonment action, automatic reviewer assignment, support inbox or response-time guarantee was added. The UI gives an operator reference and truthfully states the support boundary. Those operating decisions remain release gates.

## API and durable data

- Accepted revision content: optional `{requirement:{template:'observation-v1',policyVersion:'creator-observation-v1',prompt}}`.
- Authenticated `GET /api/creator-community/quests/:id/completion`: only the accepted participant's requirement, attempts, private feedback and receipt.
- Authenticated `POST` at the same path: `{operationId,revision,evidence,privateConsent:true}`. The accepted revision is authoritative. Same-operation retries return the saved response; pending/attempt/consent/stale-revision violations fail explicitly.
- Trusted configured CLI `review-completion`: actor, operation ID, submission ID, expected version, accept/reject decision, private feedback and explicit terminal acknowledgement when required. There is no public reviewer endpoint.
- Registered module `creator-completion@1`: append-only attempts plus immutable completion receipts, a unique pending attempt per participation, and one receipt per participation. It initializes only on the explicitly enabled path.
- Acceptance updates the attempt, writes the receipt, resolves the obligation and journals the operation in one transaction. Injected journal failure rolls all of it back. The fixed `unconfigured-v1` award adapter returns `{xp:0,gold:0,item:null}` and has no economy writer.

## Actual isolated host journey

This evidence used a fresh private temporary database at localhost:8802, explicit QA publication policy/200 XP commitment, workers and native attestations disabled, RPC pointed at an unused local port, and no repository environment file. The default-off localhost:8801 host was not altered.

1. A test author was seeded with 1,000 earned XP as an explicit fixture, published a profile, and submitted the structured **Two shapes in an imagined scene** revision through authenticated HTTP. A separate configured reviewer approved it through the trusted CLI.
2. A fresh Chrome guest **QA observation walker** opened Community, read the requirement/policy before Start, and accepted revision 1. No wallet, GPS, travel, money or external provider was used.
3. The guest entered explicitly synthetic imagined-scene text. Browser Back closed the dialog and returned focus. Reload retained the private text but left consent unchecked and submission disabled. Database inspection before explicit sending found no submission.
4. Explicit consent and Submit produced one pending attempt. A separate configured `qa-validator` accepted through the CLI. Exact CLI replay returned the same receipt.
5. Browser Reload showed **Observation completed**, the same receipt ID and response-derived zero XP/GOLD/no item. Sanitized [actual-review-proof.json](actual-review-proof.json) records one receipt, resolved participation, exact replay and unchanged player, inventory, history, treasury and native-award rows. It contains no evidence text or cookie.

Receipt: `creator_completion_6f4019bf-2e5e-4f1d-bffc-d545b282924e`; accepted revision: 1. The proof is independent text assessment, not physical completion evidence.

## Browser evidence and its limits

Actual Chrome captures:

| State | Capture |
| --- | --- |
| Private text draft, 360×780 | [phone 360](actual-observation-draft-360x780.jpg) |
| Private text draft, 390×844 | [phone 390](actual-observation-draft-390x844.jpg) |
| Short landscape, 844×390 | [landscape](actual-observation-draft-844x390.jpg) |
| Desktop, 1280×800 | [desktop](actual-observation-draft-1280x800.jpg) |
| Focused textarea, reduced height 390×480 | [keyboard-height approximation](actual-observation-focused-390x480.jpg) |
| Pending independent review | [pending](actual-observation-pending-390x844.jpg) |
| Completed receipt after Reload | [confirmed](actual-completed-receipt-after-reload-390x844.jpg) |

Root separately tested the actual React component against the explicitly simulated in-memory API in IAB:

- Enlarged 390px form: textarea computed at 32px, no horizontal document overflow. [enlarged](root-enlarged-observation-390.jpg)
- After typing and checking fresh consent, Reload restored only text: consent false and Submit disabled. [reset](root-enlarged-draft-consent-reset-390.jpg)
- Rejection feedback is expandable and readable. [rejected](root-rejected-390.jpg), [feedback](root-rejected-feedback-390.jpg)
- Three rejected attempts show terminal NOT-completed state and no Write action. [terminal](root-terminal-390.jpg)
- Simulated lost response retained entered text; explicit same-terms retry recovered a single pending Attempt 1. [retained](root-lost-reply-retained-390.jpg), [recovered](root-lost-reply-recovered-390.jpg)

Chrome keyboard checks after the shared Dialog fix: Cancel→Tab focuses the first textarea; textarea→Shift+Tab focuses Cancel; both report `insideDialog:true`. Escape returns the Write button. The read-only evaluator does not expose `document.hasFocus`; the JSON records null/unsupported rather than inventing that measurement.

The dialog scrolls within the viewport; the short-height cases intentionally do not show every control simultaneously. Form/input text uses 16px, secondary text 14px, and essential buttons/label targets have a 48px source minimum. The existing scoped secondary ink `#665577` on dialog `#fcfaff` calculates to 6.47:1; this is a source-token calculation, not an additional computed-style browser reading. [capture-manifest.json](capture-manifest.json) records actual screenshot dimensions. Earlier browser DOM measurements could not be archived after the CUA runtime reset, so the manifest does not claim a complete measured target/overflow matrix.

Owner isolation was verified by authenticated backend privacy tests and the draft-store regression test, not by a completed browser owner-switch test. The Chrome tool timed out repeatedly during that remaining fixture check. Root completed the other mock state checks in its separate responsive IAB session. Real Safari/iOS and Chrome/Android hardware, a real software keyboard, physical presence and field usability were not tested. Responsive screenshots are not real-device verification.

## Checks and cleanup

- [Completion tests](tests.txt): 9/9 passed, including actual HTTP dropped reply, two SQLite connections, independent roles, stale accepted revision, legacy rights, retained history, terminal rejection acknowledgement, exact replay and atomic rollback.
- [Draft compatibility test](draft-compatibility-tests.txt): 1/1 passed after the final draft-scope change.
- [Final local build](build.txt): TypeScript and Vite passed after the final source change.
- The earlier [combined creator log](all-creator-tests.txt) is historical: its legacy schema-ledger comparison failed before agent C updated that compatibility assertion. It is not the final combined-suite result. Root owns the final canonical full-suite log.

The localhost:8802 host and Vite:5174 were stopped after Root released its fixture checks. The owned temporary database, author cookie file and private operator input files were removed. Chrome tab closure and browser guest-cookie removal could not be verified after the tool outage: known owned QA tabs are 986754917 (8802) and 986754920 (5174). Their servers are stopped and the temporary authentication database was removed. No normal `.data`, default configuration, funds, deployed service or repository commit was changed by this batch.

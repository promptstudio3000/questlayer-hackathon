# W00 / W02 / W08 integrated delivery

31 October 2026. Three parallel implementation streams, integrated and reviewed in
one working tree. **484/484 application tests pass**, with zero failures/skips:
[canonical output](tests.txt). [TypeScript/Vite build](build.txt) passes. The earlier
473/474 integration log in the schema report is historical; its metadata-only
expectation was corrected without relaxing business-row preservation.

## Delivered behavior

- Exact durable demo quest results commit with XP/GOLD/item minting and final route
  progress. Retry and archive recover the original receipt; legacy detail stays
  explicitly unavailable. The player inspects a preview and deliberately equips a
  currently owned, unreserved Aura. Reload never automatically reveals or equips.
- Reviewed creator observation requirements, private text submission, independent
  validation, retained attempts/feedback and durable completion/obligation resolution
  are connected. Completed outcomes truthfully record **0 XP / 0 GOLD / no item**:
  activity rewards remain unconfigured. Creators remain disabled by default.
- Core/optional schema versions, six frozen legacy baselines, atomic adoption,
  readonly source preflight, active-WAL/checkpoint recovery and source/config-aware
  isolated restore checks. Unknown/future/corrupt/foreign files fail before writes.
- Native dialog Tab/Shift-Tab boundaries, retained Escape/Back/return focus, and
  preservation of older creator title/description drafts after adding requirements.

[Implementation/API boundaries](../../../docs/RESULTS-AND-COMPLETION-HANDOFF.md),
[adventure service/tests](../W02-durable-results/README.md),
[creator completion evidence](../W08-completion/README.md), and
[schema/restore evidence](../W00-schema-compatibility/README.md).

## Player problem and composition choice

A successful adventure could lose its HTTP response and leave no inspectable result
on reload. A creator participant could start a quest but could not privately submit
its declared requirement and receive independently recorded completion.

For returning adventure results, compared an automatically reopened modal, an
archive-only entry, and a compact recovery action in the existing objective position.
The compact action plus Inventory archive was selected: the map stays visible,
recovery is easy to find, and inspection is deliberate. Its card replaces the compact
objective only while an unviewed result needs attention; normal discovery continues
after inspection. Detailed preview/result uses the existing native dialog.

| Before / evidence type | After | Why / source |
| --- | --- | --- |
| Source: App held only an item discovery in React state. | Exact actor/realm receipts, unread recovery, bounded archive and no-item outcome. | [App](../../../src/App.tsx), [hook](../../../src/useAdventureResults.ts), [result UI](../../../src/AdventureResults.tsx), [service](../../../server/adventure-results.mjs). |
| Source review: retained scope equality could revive an old dialog after A→B→A; reconnect could revive stale equipment authority. | Generation-bound scopes and explicit fresh online ownership checks. | [read context](../../../src/adventure-results.ts), six presentation regressions plus timed browser scenarios. |
| Source review: equipment toggles and late responses could undo a confirmed outfit or force navigation. | Explicit desired state, current ownership/voucher guards, same-inspection/navigation gating and stale profile-read invalidation. | [game](../../../server/game.mjs), [App](../../../src/App.tsx). Actual equip/map/reload verified; delayed App equipment-navigation races were source-reviewed, not fault-injected in-browser. |
| Observed: result body inherited13px text and double padding; secondary buttons inherited the older low-contrast palette. | Body/controls16px, secondary14px,48px targets, deliberate padding and semantic text/control colors. | [scoped styles](../../../src/adventure-results.css), final App360/390/landscape/desktop measurements/captures. |
| Observed in IAB and Chrome: Tab/Shift-Tab could leave the dialog's document focus. | Boundaries now wrap through visible enabled controls and native radio groups. | [Dialog](../../../src/Dialog.tsx), [focus helper](../../../src/dialog-focus.ts), three regressions; result and private form browser checks both wrap. |
| Source: creator participation had no declared playable submission/validation/result path. | Private observation → independent review → atomic receipt/resolution, retained revision/feedback and explicit zero rewards. | [completion](../../../server/creators/completion.mjs), [Community](../../../src/CreatorCommunity.tsx), actual isolated host and simulated error-state evidence below. |
| Source: bootstrap changed schema without an explicit compatibility boundary. | Versioned metadata, known shapes, transactional adoption and fail-before-write preflight. | [database](../../../server/database.mjs), [compatibility](../../../server/schema-compatibility.mjs),16 schema tests. |

## Actual isolated-host observations

Adventure host8801 used a new private temporary database, synthetic `River explorer`,
background/attestation workers disabled and RPC pointed to a closed local port.
The ordinary UI created the guest. The official arena's free chest was committed
through the game service using explicit simulated arena evidence, without delivering
the outcome to that browser. Duplicate claim returned the same receipt and changed
no XP/item counts. Reload offered `View confirmed result`; it did not open a modal.
Inspection showed Northern Lights #1, 80 XP and 0 demo GOLD. `Try it on` returned to the
collapsed map with the same named Aura; reload retained it. The first persisted
post-equipment check had80 XP, one claim, one receipt and one Aura; a later distinct
visit added 50 XP with no Aura, yielding 130 XP, two claims/two receipts, still one Aura.
Historical inspection/equipment retries did not alter those award counts.

- [Unobserved committed receipt and unchanged retry](../W02-durable-results/committed-unobserved-result.json)
- [Actual HTTP checks](../W02-durable-results/host-http-results.json): anonymous401,
  foreign actor404, foreign-origin write403, exact retry, GET without acknowledgement,
  explicit view idempotency, realm/cursor isolation, zero-item result and idempotent
  `desiredEquipped:true`.
- [First persistent equipment](../W02-durable-results/post-equip-persistent-state.json),
  [zero-item receipt](../W02-durable-results/no-item-confirmed-state.json),
  [final durable state](../W02-durable-results/final-persistent-state.json).

Creator host8802 used separate explicit QA policy/roles and a synthetic author and
participant. The actual browser retained private draft text through Back/reload while
consent reset and database submission count stayed zero. Explicit submission created
one pending attempt. A separate configured trusted CLI validator accepted it and
retried the same operation. Reload showed the same immutable completed receipt,
resolved obligation, zero awards and unchanged economy rows.
[Actual review proof](../W08-completion/actual-review-proof.json).
QA 200 publication XP is fixture configuration, never a production default.

## Interface evidence

Actual App results: [360×740](../W02-durable-results/360-result-preview.jpg),
[390×844](../W02-durable-results/390-result-preview.jpg),
[844×390](../W02-durable-results/landscape-result-top.jpg),
[landscape actions](../W02-durable-results/landscape-result-actions.jpg),
[1280×900](../W02-durable-results/desktop-result-preview.jpg),
[recovery prompt](../W02-durable-results/390-recovered.jpg),
[equipped map](../W02-durable-results/390-equipped-map.jpg), and
[no-item result](../W02-durable-results/390-no-item-result.jpg).
Final DOM measurements confirm each required viewport, no horizontal overflow,
16px body/controls, 14px secondary text and 48px minimum result targets.

The actual creator form matrix includes 360×780,390×844,844×390,1280×800 and
focused390×480, with pending/completed states in the [creator report](../W08-completion/README.md).
The reduced height approximates keyboard pressure; it is not an OS keyboard test.

Synthetic components use actual production hooks/forms with an explicitly injected
in-memory transport; they make no game/API/GPS/wallet writes. Adventure actor,
realm and native-mode round trips during an intentionally late detail read left
zero reopened dialogs. Offline/reconnect retained the historical result with
`Try it on` disabled until explicit refresh. Listed and legacy results offered no
item action. Twice-normal text reflowed and controls stayed reachable.
[Enlarged result](../W02-durable-results/390-enlarged-text.jpg),
[enlarged actions](../W02-durable-results/390-enlarged-actions.jpg),
[reconnect](../W02-durable-results/fixture-reconnect-needs-check.jpg).

Additional creator synthetic checks: [32px observation field](../W08-completion/root-enlarged-observation-390.jpg),
[retained draft/reset consent](../W08-completion/root-enlarged-draft-consent-reset-390.jpg),
[private rejection feedback](../W08-completion/root-rejected-feedback-390.jpg),
[terminal outcome](../W08-completion/root-terminal-390.jpg),
[lost reply retains text](../W08-completion/root-lost-reply-retained-390.jpg),
[retry yields only Attempt 1 pending](../W08-completion/root-lost-reply-recovered-390.jpg).
Browser actor-isolation for creator completion was not separately exercised; backend
role/privacy/accepted-revision tests cover that authority boundary.

Both result and creator form now wrap Tab/Shift-Tab inside their dialogs; Escape
returns focus to the trigger. [Creator before](../W08-completion/keyboard-focus.json)
and [after](../W08-completion/keyboard-focus-after.json) are distinguished. The
browser evaluator does not expose document.hasFocus; no claim uses that method.

## Remaining gates and cleanup

No creator reward schedule, paid access, donations, native XP lock, new native policy
or contract settlement was adopted. Observation review is private text validation,
not proof of physical presence. Appeal/abandonment/support operations, further
spatial templates, genuine native passkey recovery, W01 pedestrian routing/field
review, full-host/offsite restore and reproducible release remain roadmap work.
Real Safari/iOS and Chrome/Android, OS keyboard/text/zoom, screen readers, GPS,
wallet return and five-newcomer observations are unverified. No milestone is passed.

The adventure guest was explicitly signed out; its four successful IAB test tabs
closed and viewport override reset. The adventure host8801 stopped; its private
synthetic database is retained for evidence. Creator host8802/temp credentials and
Vite5174 were stopped/removed by their owner. Chrome control later became unavailable,
so closure of its two owned QA tabs was not verified; the creator report records
their IDs. One temporary IAB connection-error page could not be rebound for manual
closure because the browser policy blocks its internal data URL; turn-end temporary
tab cleanup is expected, not verified. Pre-existing user tabs were preserved.

No production state, real funds, wallet permissions or hardware location was used.
No commit, push or deployment was performed.

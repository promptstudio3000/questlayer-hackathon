# Durable results, creator completion and schema compatibility

31 October 2026. Local implementation of the three approved streams from
[NEXT-DEVELOPMENT-PLAN.md](NEXT-DEVELOPMENT-PLAN.md). The combined
[delivery evidence](../output/qa/W00-W02-W08-next/README.md) separates running App
journeys, synthetic component scenarios and database/HTTP tests. No deployment,
contract change, real wallet transaction or physical-location proof occurred.
Milestones retain their existing status and incomplete exit gates.

## Adventure result and equipment

A demo quest claim now stores its exact XP, integer demo GOLD, awarded Aura ID and
immutable appearance snapshot, actor, world, realm, title and time inside the same
transaction as the award. A final route checkpoint is included in that transaction.
Retry returns that result with `replayed:true`, including after the quest closes;
it does not grant, mint or celebrate again. Legacy claims explicitly report missing
exact detail instead of guessing an item from its name.

Actor-authenticated routes are `GET /api/adventure-results`, `GET /:id`,
`GET /quest/:questId` and explicit `POST /:id/viewed` under the same prefix.
Reads never acknowledge a result. Archive pagination is bounded and actor/filter
bound. A separate unviewed query keeps recovery available beyond the newest page.
Reload/reconnect only reads results; the player deliberately opens the recovery
prompt or Inventory → Adventure results.

The result shows a labelled preview using the shared character renderer. `Try it on`
requires a fresh ownership projection and current actor inventory, and sends explicit
`desiredEquipped:true`. The server rechecks ownership, listing and native voucher
reservation/mint state. An inactive demo slot retained while a native outfit is worn
can deliberately select the demo outfit. A lost equipment reply can be retried
without toggling an already equipped item off. A late reply updates the same actor's
confirmed profile but cannot close a newer inspection or force navigation.

Actor/realm/native-mode transitions invalidate old inspections even on a round trip.
Disconnect/reconnect invalidates equipment freshness until another deliberate check.
Historical awards remain inspectable when an item is sold, reserved or unavailable;
a zero-item result offers a return to the map. Native and creator receipt namespaces
and reward authority remain separate.

## Creator observation completion

The optional creator module adds a reviewed `observation-v1` requirement with policy
`creator-observation-v1`. Accepted requirements remain bound to the admitted revision.
A participant writes private text evidence, explicitly consents to its submission,
and reads private attempts, feedback and a durable outcome. Legacy plain-text
admissions retain their original rights and operator resolution path; no requirement
is retroactively imposed.

Player `GET/POST /api/creator-community/quests/:questId/completion` handles private
progress/submission. Validation is independent human review through configured trusted
local `review-completion` operations, never a public privileged player endpoint.
Author and participant cannot validate their own outcome. Acceptance, immutable
completion receipt, obligation resolution and idempotency journal commit together.
Submission and review retries recover their original result.

This operational policy permits one pending submission and three attempts, disclosed
before publication/start/submission. Rejections retain private feedback. A third
rejection explicitly ends participation as **not completed**, requires trusted CLI
`acknowledgeNotCompleted:true`, preserves accepted content/attempts, and creates no
completion reward. There is no automatic deadline or evidence erasure.

Rewards are explicitly **not configured**: completed receipts record zero XP, zero
GOLD and no item. Observation review establishes this declared activity outcome;
it is not GPS verification or a native settlement adapter. Further templates,
reviewed reward policy, appeal/abandonment/support governance, native XP commitments
and creator money flows remain separate work. Creators stay disabled by default.

## Schema and restore boundary

Core and optional modules now have explicit version/fingerprint metadata. Known
legacy core baselines are frozen from six actual repository revisions; unknown,
future, altered, corrupt or foreign inputs fail before bootstrap changes or seeding.
The only supported SQLite application ID remains the historically used `0`.
Core adoption/migration and module installation are transactional, including nested
rollback. Disabled creator startup creates no creator tables.

Preflight reads a closed database immutably or checks a private copy of an active
WAL pair, with bounded retries for concurrent checkpoint/removal. Rejected originals,
WAL and SHM remain unchanged. Backup metadata records schema identity and optional
reviewed build/configuration identifiers. Restore checks checksum/schema and supplied
expected identifiers before bootstrapping the isolated copy. Unrecorded source/config
is reported as unverified. No environment file, key or precise GPS is exposed.

`/api/health` reports schema versions and an explicit `QUESTLAYER_BUILD_ID`, or
`development-unrecorded`; a supplied label alone is not a reproducible release or
proof that a dirty working tree matches a commit. Full-host/offsite restoration,
verified runtime configuration, financial reconciliation and release activation
remain separate gates.

## Interface and remaining acceptance

Shared native dialogs now keep Tab/Shift-Tab inside visible enabled controls, including
radio groups, and retain Escape, browser Back and return focus. Result screens use
48px targets, 16px body/controls, 14px secondary text and the adopted semantic palette.
Viewport and enlarged-text checks are desktop-browser evidence. Real Safari/iOS,
Chrome/Android, OS keyboard/text settings, screen readers, GPS/wallet return and
five-newcomer/field journeys remain unverified. W01 pedestrian routing, safe shortfall
publication, reviewed system-place closure and W03 independent native recovery are
still substantial next development streams; external financial operations require
fresh evidence and their own authorization.

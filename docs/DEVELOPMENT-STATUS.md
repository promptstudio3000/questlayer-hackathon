# Combined development status and next work

31 October 2026. Start here when continuing development. [ROADMAP.md](../ROADMAP.md)
owns scope and acceptance; [roadmap.json](roadmap.json) owns milestone status;
[V1-REMAINING.md](V1-REMAINING.md) owns the detailed gap register. None of the full
milestone exit gates has passed. Local source and test evidence do not establish a
deployed feature or physical-device acceptance.

## Whole-project review and handoff

The [engineering handoff](PROJECT-REVIEW-AND-HANDOFF.md) now reconciles the original
Git plan, all 15 milestones, 89 tasks, 102 rules and current implementation with
explicit verification/deployment limits. Use its [coverage appendix](PROJECT-REVIEW-COVERAGE.md)
and [source/public observation snapshot](PROJECT-REVIEW-SNAPSHOT.json) when taking
over. Older slice reports below retain their historical scope. No deployment or
runtime change was performed by this documentation review.

## Next execution plan

The [overall roadmap audit](NEXT-DEVELOPMENT-PLAN.md)'s three approved streams are now [implemented locally](RESULTS-AND-COMPLETION-HANDOFF.md): durable exact demo results and safe equip recovery; private structured creator observation with independent durable completion; and explicit schema/restore compatibility. Continue with the remaining W01 routing/safe-publication work, full player/device journeys, native independent recovery and reviewed creator reward/operations policy. Reuse the delivered foundations.

## Latest parallel delivery

The [W00/W02/W08 delivery](../output/qa/W00-W02-W08-next/README.md) passes **484/484** application tests and builds. Actual isolated-host journeys cover result recovery/preview/equip/map/reload and participant private submission → independent CLI review → durable completion receipt. Component scenarios cover stale actor/realm/native replies, reconnect freshness, rejection/terminal states, unknown submission outcome/retry and enlarged text. Shared native dialogs now retain Tab/Shift-Tab as well as Escape/Back/focus return. Creator rewards remain explicitly unconfigured and creators default off; no full milestone, real-device acceptance or deployment follows.

## Previous parallel follow-up

The [W02/W08/W10 batch](../output/qa/W02-W10-next/README.md) adds a shared authored
object family across map/list/native collection, exact confirmed demo session
pickup feedback, private creator reports, bilateral blocks and independent audited
publication suspension. The [full suite](../output/qa/W02-W10-next/tests.txt) passes
438/438 and source builds. Existing accepted revisions/obligations/XP locks survive
block and suspension; no report automatically awards, resolves or releases anything.
[Art/provenance](../output/qa/W02-object-art/README.md) and [safety API/recovery](../output/qa/W08-W10-safety/README.md)
evidence remain separate from actual-host and physical-device acceptance.

## Combined source

The current `main` baseline, `8604df2`, already combines native recovery changes
from `0ff170b` with the creator service foundation. Do not reapply transfer patches.
The current working-tree batch extends W02 navigation/draft continuity, mounts an
optional W08 creator runtime and interface, and rehearses creator-state recovery.
Existing research, concepts and earlier verification files are preserved.

| Work stream | Integrated source and evidence | Remaining boundary |
| --- | --- | --- |
| Native recovery, worker fencing and consistent media backups | [Durable recovery](DURABLE-NATIVE-RECOVERY.md), [earlier evidence](../output/qa/W03-W13-durable-recovery/README.md) | Full-host/offsite restore and physical wallet/device journeys remain open. |
| Optional creator runtime and Community interface | [Current integration](CREATOR-INTEGRATION-2026-10-31.md), [runtime/operator report](../output/qa/W08-runtime/README.md), [actual-host browser journey](../output/qa/W02-W08-parallel/README.md), [API handoff](CREATOR-COMMUNITY-HANDOFF.md) | Mounted in local source under Community, disabled by default. Explicit versioned policy and trusted local review/completion roles are required. Activity rewards, native XP commitments, production governance and all creator money flows remain unconfigured. |
| W02 adventure, form and browser-history continuity | [Demo objectives](../output/qa/W02-adventure-continuity/README.md), [native objectives](../output/qa/W02-native-objective/README.md), [local form drafts](../output/qa/W02-drafts/README.md), [history tests](../output/qa/W02-W08-parallel/navigation-tests-final.txt) | Actor-scoped presentation history, modal Back/close coordination and allowlisted text drafts are integrated locally. Saved references resolve current authoritative reads; consent, GPS and executable actions are not replayed. Actual App navigation/modal checks and separate form fixtures are now verified locally alongside the creator author journey. Physical GPS/wallet return, hardware and newcomer gates remain open. |
| W00/W13 creator database recovery | [WAL backup/restore rehearsal](../output/qa/W08-runtime/restore/README.md) | Existing private backup tooling restores exact creator rows/receipts and XP commitments in isolated copies. This does not complete full-host/offsite/native-chain recovery or the city pilot. |
| Gameplay, map, wardrobe, rewards, tasks and notes | [Earlier delivery](DELIVERY-2026-10-31.md), [gap register](V1-REMAINING.md) | Connected alpha/testnet slices do not establish physical play, independent recovery, actual yield cycles or a finished creator economy. |
| Map appearance and integration research | [Map study](MAP-STYLE.md), [source register](SOURCES-AND-INTEGRATIONS.md), `output/map-style-study/`, `output/concepts/` | Preserved preparatory material. Concepts and provider references are not implemented behavior or current provider/rights verification. Follow DESIGN.md and world rules before adoption. |

The last application deployment recorded in the recovery/creator handoff is
`0ff170b`; this batch did not inspect the production host or deploy. Creator runtime,
form/history work and recovery rehearsals must not be described as live features.
No contract, earned-XP award policy, reward amount, 50/50 allocation, ownership or
native settlement was changed. A creator lock lowers available demo XP and current
level without minting/burning earned XP or repeating inventory/level grants. Turning
publication off preserves existing locks. Test policies such as a 200-XP commitment
are QA-only fixtures; no production amount or policy has been adopted.

## Continue in this order

1. **W01/W02: finish and verify the playable loop.** Source now retains note/task/
   creator text and safe navigation context through panel changes and reload. Exact
   result/recovery, preview and current-owned equipment now have actual local journeys.
   Authored objects, Back/drafts and calm pickups have local evidence.
   Complete deliberate compositions and real-device journeys; field-review six
   sites/public access and observe five newcomers. A cached target is never GPS evidence.
2. **W08: validate the optional creator slice, then close its remaining rights.**
   Local source connects draft/quote/submission, independent operator review,
   discovery/follow/start, accepted revisions, closure and exact XP release. The actual
   local author-browser/participant-HTTP/operator-CLI journey and isolated restore
   are tested through explicit closure and exact release. Finish physical hardware
   checks, production moderation/reporting/closure governance, further activity
   validation and reviewed reward settlement before activation. The private text
   observation/review/receipt path is delivered locally. Native XP
   commitments and SocialDB/IPFS creator profiles remain separate work. Keep the
   feature disabled until explicit reviewed host policy and operations are ready.
3. **W05/W06: finish the observed testnet financial cycle.** Read current pool epochs
   and liquid balances before acting. Prove maturity, beneficiary withdrawal,
   received yield, allocation and retries. Old observations are historical evidence;
   no mainnet activity follows from this plan.
4. **W03/W04/W06: join independent identity, rewards and ownership.** Complete native
   passkey/recovery capability selection and real two-device wallet-return/GPS
   journeys; preserve the wallet-free solo arena.
5. **W07, W09–W14:** canonical market compatibility; conserved creator allocations,
   donations and paid access; private evidence/moderation; bounded AI; physical-device
   quality; multi-day city/full-host restore pilot; reviewed releases and separate
   iOS distribution. The roadmap retains exact dependencies.

## Verification status

The latest [application suite](../output/qa/W00-W02-W08-next/tests.txt) passed **484/484**, with zero failures/skips, and its [build](../output/qa/W00-W02-W08-next/build.txt) passed. The [combined report](../output/qa/W00-W02-W08-next/README.md) distinguishes actual-host and synthetic evidence. The previous [438/438 suite](../output/qa/W02-W10-next/tests.txt) and earlier audit remain historical evidence.

The [earlier application suite](../output/qa/W02-W08-parallel/tests-final.txt) passed
**408/408** with zero failures/skips, and the [TypeScript/Vite build](../output/qa/W02-W08-parallel/build-final.txt)
passed. The earlier [reviewer run](../output/qa/W02-W08-parallel/reviewer-tests.txt)
retains its historical **403/403** result. [Pure navigation checks](../output/qa/W02-W08-parallel/navigation-tests-final.txt)
passed 12; the creator restoration case and existing backup checks passed six.
The [runtime report](../output/qa/W08-runtime/README.md) records focused creator and
actual isolated HTTP/CLI behavior. No contracts changed in this batch; previous
Rust results were not rerun by this integration work.

The [actual isolated-host journey](../output/qa/W02-W08-parallel/README.md) and
[creator browser observations](../output/qa/W02-W08-parallel/creator-browser-notes.md)
record an author draft/quote/submission/independent approval, a fresh guest's
follow/discovery/accepted revision, and author closure with one open obligation.
Finalization was disabled with its reason; trusted synthetic QA resolution reduced
open obligations to zero while keeping 200 XP locked. Explicit author UI
finalization then showed Closed, 1000 earned / 0 locked / 1000 available XP and
Level 4, with unchanged GOLD. The policy/seed are test-only and no activity reward
or physical completion is established. Participant requests and resolution have
separate cookie-free metadata in the same report folder.

Earlier native-objective browser evidence uses the actual App/hooks with explicitly
synthetic read responses. [Actual App navigation/modal checks](../output/qa/W02-W08-parallel/app-navigation-browser-notes.md)
and [separate form fixtures](../output/qa/W02-W08-parallel/fixture-browser-notes.md)
now have local browser evidence; their synthetic setup and limitations are explicit. Browser viewports/focus/large-text approximations
are not physical hardware verification. Safari/iOS, Chrome/Android, actual virtual
keyboards/zoom, screen readers, GPS/wallet return, field play and newcomers remain
outstanding. No deployment occurred.

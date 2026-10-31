# Optional creator reports, blocking and unsafe-publication stop

31 October 2026. Local source/test delivery only. This report covers the server
and trusted local CLI; browser/device evidence belongs to the coordinating/UI
agents. No deployment, chain operation, funding, signing key or production data
was used. Creator publication still defaults disabled.

## Implemented

- Authenticated private quest reports bind to the currently visible approved
  public revision or this player's immutable accepted revision. Hiding, bilateral
  blocking and closure do not remove that accepted revision or the right to report
  it. Unapproved revisions and inaccessible/nonexistent quests all return 404.
- One report per player/quest, at most 20 new reports per rolling day, with four
  reason codes and at most 1000 characters of optional detail. Exact operation-ID
  recovery returns the historical receipt; a different intent for the same quest
  gets `409 CREATOR_ALREADY_REPORTED`. Reports never automatically restrict an
  author, settle participation or award/release XP.
- Creator block/unblock uses the existing bilateral `social_blocks` relation, so
  the existing note/presence rules also apply. Public profile/discovery/Following
  and new admission respect it. Existing accepted content and retained follows
  survive. Unblock removes only the caller's direction. An owned bounded block list
  exposes IDs and currently public attribution, never private account names/bios.
- Trusted independent operators can inspect a bounded private report queue, review
  a report and suspend a stable quest. Suspension withdraws pending drafts/reviews,
  changes a published quest to Closing (an unpublished quest to Closed), increments
  its version, and journals the actor/reason/previous version/state. It stops new
  admission and cannot be bypassed through revise/submit/approve. It does not
  resolve admitted obligations or release their commitment. Existing author
  finalization still needs independently resolved obligations.
- Report review and suspension are separate deliberate operator actions. Confirming
  a report does not automatically suspend a quest; suspension invents no finding
  or completion. There is no reopen/restore-publication capability in this slice.

`server/creators/safety.mjs` explicitly adds `creator_reports` plus bounded-query
indexes only during enabled composition. Existing rows/policies/receipts are not
rewritten. Read-only audit tolerates a pre-safety creator database. Disabled runtime
construction initializes no creator storage. Existing shared social audit, when
present, records block changes and shares its 100-change/hour bound. Creator block
requests additionally have a 100-operation/hour bound and a 200-active-block limit.
These are bounded service controls, not a production moderation/capacity proof.

## Player API contract

Prefix: `/api/creator-community`. Existing real session, exact write origin, strict
JSON/fields, 16 KiB body limit and private/no-store responses remain in force.

| Method/path | Exact input | Response |
| --- | --- | --- |
| `PUT /creators/:id/block` | `{operationId,blocked:boolean}` | Standard demo receipt, command `setCreatorBlocked`, `creatorId`, `blocked` |
| `GET /me/blocks` | Optional `limit` 1–50 and stable-ID `cursor` | `{domain:"demo",items:[{id,displayName:string|null}],nextCursor}` |
| `POST /quests/:id/reports` | `{operationId,revision,reason,detail}` | Standard demo receipt, command `reportCreatorQuest`, `report:{questId,revision,reason,status,reportedAt}` |

Reasons: `unsafe-place`, `abuse`, `misleading`, `other`. `detail` is a required
string, may be empty, and is capped at 1000 characters. The player receipt exposes
no report ID, detail, other reporter, queue, reviewer identity or moderation finding.
No public report listing or privileged mutation route exists.

Self-block is 400. New block requires a visible public profile, the author of one's
accepted quest, or an existing owned block; otherwise 404. Unblock is safe after
hiding/blocking and is a non-probing no-op for an unknown valid ID. The owned list
retains public display names across one's own block, but returns null after profile
hiding or a reverse block. Private participation detail/list additionally exposes
`creator:{id,displayName:string|null}` for safety controls: its name is null when
the profile is private or either direction is blocked. No private bio/name leaks.

## Trusted local operations

Use the existing explicit enabled policy and moderator configuration with an
existing selected database. The CLI loads no player or native signing capability.

```sh
node scripts/creator-operator.mjs audit --database /private/tmp/qa/game.sqlite --limit 50
node scripts/creator-operator.mjs suspend --database /private/tmp/qa/game.sqlite --input /private/tmp/qa/suspend.json
node scripts/creator-operator.mjs review-report --database /private/tmp/qa/game.sqlite --input /private/tmp/qa/review-report.json
```

Suspend input: `{actor,operationId,questId,expectedVersion,reason}`. The configured
moderator must differ from the quest author. Review-report input:
`{actor,operationId,reportId,expectedVersion,decision,reason}`, where decision is
`confirmed` or `dismissed`; the configured moderator must differ from both reporter
and author. Reasons are nonempty and bounded to 1000 characters. Stale versions
fail without changes; exact successful operation IDs replay historical receipts.
The audit adds `openReports` with private detail/revision content/current quest
version and `safetyActions` with bounded durable suspension/review receipts.
Each queue is independently limited; a page is not the entire operational backlog.

## Verification and remaining boundaries

[`creator-tests.txt`](creator-tests.txt) records **72/72 creator tests passed**,
including 14 new safety cases. The initial restricted HTTP run could not listen on
localhost; the complete rerun with local-server permission passed. A quota test
was corrected to count the preceding unblock toward the existing shared cap.

New evidence covers public/private probing resistance; exact report and block
receipts; a deliberately destroyed HTTP response followed by recovery of the one
committed report; session/origin/field/query controls; no public privilege routes;
bilateral discovery/admission; accepted-content/attribution privacy; report/block
bounds; independent/stale-version review and stop; receipt-storage rollback; real
two-connection start-vs-block and start-vs-suspension races; unchanged XP/inventory/
treasury; and exact obligation-gated release of only the stopped quest's commitment.

An old creator database is explicitly initialized with the additive safety table
without modifying existing rows. The actual private WAL backup tool then restores
reports, blocks, moderation/suspension receipts and an open accepted obligation;
disabled/enabled reopening and both real CLI retries preserve every row and the
active lock. The restored unsafe quest cannot finalize with an unresolved obligation.

This does not establish staffed moderation, appeals, public support/contact,
private-report retention/deletion policy, field validation, physical safety,
completion rewards, native XP locks, donations, paid access or creator funding.
Browser viewports and real hardware are not verified by these server tests. All
milestones remain partial, and default enablement/policy/economy are unchanged.

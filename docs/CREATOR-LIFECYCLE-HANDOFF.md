# W08 creator quest lifecycle: isolated integration handoff

31 October 2026. Base commit: `4149058` (`feat: add moderated map notes and native receipt recovery`). Prepared separately from the chat working on durable wallet receipts, staking lifecycle and host recovery. This is a tested server-side foundation for W08, not a completed creator platform or a deployed feature. W08 remains **building**.

## Current follow-up

The [Community service/API follow-up](CREATOR-COMMUNITY-HANDOFF.md) adds profiles, free follows, private/public projections, explicit quote acceptance and optional server adapters. It supersedes the original three-file transfer inventory below. The combined isolated slice has 44 creator tests and passed 312 application tests. The earlier verification record is retained as history.

## Original delivered scope

New implementation files only (verification transcripts are under `output/qa/W08-creator-lifecycle/`):

- `server/creators/lifecycle.mjs`: explicit opt-in SQLite adapter using the existing demo `players.xp` as earned XP, the existing `atomic` transaction helper and `levelFor` curve.
- `tests/creator-lifecycle.test.mjs`: lifecycle, adverse-state, rollback, persistence and concurrent-connection checks.
- This handoff. No shared roadmap, application entry point, database bootstrap, contract, wallet file, UI or deployment configuration was edited.

The module is not imported by the running application. Merely merging these files does not create tables in the application database or change any player's level. There are no new dependencies, signing keys, network calls, funds, rewards or automatic background jobs.

The player problem is a creator's publication commitment: publication must reserve actual available XP, preserve participants through edits/cancellation, and return precisely that commitment after closure. The code implements that accounting and lifecycle boundary. It does not implement location validation, quest completion rewards or the player interface.

## Behavior and decisions

| Before at the baseline                                              | Isolated implementation                                                                            | Why                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| No creator quest/commitment records; sponsorship has its own escrow | Stable creator quest IDs, immutable content revisions and independent moderation                   | Sponsorship and creator publication have different rights.                     |
| Earned XP is the only demo XP value                                 | `earnedXp`, sum of active `lockedXp`, `availableXp`, level from available XP                       | A lock neither earns nor burns XP.                                             |
| No atomic publication commitment                                    | Independent approval locks the quoted amount and publishes in one SQLite write transaction         | Competing publications cannot spend the same available XP.                     |
| No creator closure boundary                                         | `closing` stops new admissions immediately; `finalize` requires all recorded participants resolved | Author cancellation cannot erase an admitted participant.                      |
| No revision-specific creator admission                              | Each participant retains the approved revision present at their start                              | A new clue cannot rewrite an existing participant's accepted content.          |
| No creator operation receipts                                       | Actor-scoped operation IDs bind command/target/terms; successful receipts persist atomically       | Lost responses and concurrent retries do not repeat publication or XP release. |

These are source findings and tested service behaviors, not observations of an integrated UI.

Drafts and pending reviews hold **no XP** in this slice. Submission now explicitly accepts `expectedPolicyVersion` from an author-only publication quote. The quote is fixed when a revision enters review; actual availability is rechecked at approval. Insufficient XP leaves the review pending and creates neither a commitment nor a successful receipt. This deliberately uses the plan's permitted no-reservation review policy. The future UI must explain that submission is not publication and display the quote before submission.

The caller must supply `{ version, xpCommitment }`; there is no default commitment or production policy. Test values of 200/300 XP are fixtures, not adopted balancing decisions. Reusing a policy version with a changed amount fails. New policy versions apply to new submissions. Approved quests retain their original commitment policy through future revisions; revisions do not lock additional XP.

The author can submit an immutable revision of an existing published quest. The previously approved revision remains active until independent approval of the new revision. Rejection leaves the old publication active. A participant can start a stable quest at most once, including across revisions; this prevents edits from resetting eligibility. Series or repeatable editions need a separately specified policy.

A withdrawn review remains in the audit history. Create a new revision before resubmitting it. Closed identities remain closed; publishing a new edition must not silently reset scoring/completion eligibility.

## Service boundary

Call `createCreatorLifecycle(db, options)` only from a deliberate integration adapter. Initialization creates six `creator_*` tables and registers the configured policy atomically on a database whose foreign keys are enabled. It does not alter existing tables.

Options:

- `policy`: explicit immutable version and positive safe-integer XP commitment.
- `isModerator(actor)`: trusted synchronous role lookup, default deny. The author cannot approve their own quest, even if they hold a moderator role.
- `isCompletionAuthority(actor)`: trusted synchronous role lookup, default deny. Neither the author nor participant may resolve that participant's obligation.
- `clock`: server time, injectable for tests. Do not accept a client timestamp as this authority.

Resolve `actor` from the authenticated server session or trusted operator capability, never a request-body role flag. An ordinary player session cannot acquire review or completion authority. Async predicates do not grant authority. Authority revocation blocks new operations; fetching a historical receipt is recovery of an already committed action.

All mutations require `actor`, `operationId`, and `questId`. Authoring, review and closure also require the currently observed `expectedVersion`. Failed mutations leave no success receipt; retry the same operation ID/terms after the cause is corrected. Reusing a successful ID for different terms fails with `CREATOR_OPERATION_REUSED`. A replay returns the original receipt snapshot; re-read the quest/progression for current state.

| Command          | Caller and effect                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createDraft`    | Author; accepts only `{ title, description }`. No author-defined reward, price, payout or evidence authority.                                                                              |
| `revise`         | Author; append immutable draft content, keep existing publication/participants.                                                                                                            |
| `submit`         | Author; queue latest draft under an explicit policy quote.                                                                                                                                 |
| `withdrawReview` | Author; stop pending review, retain audit history and any older publication.                                                                                                               |
| `review`         | Independent moderator; approve or reject with an audit reason. Initial approval locks XP.                                                                                                  |
| `start`          | Authenticated non-author player; admit to the currently approved revision while published. No wallet, deposit or second player is required by this module.                                 |
| `resolve`        | Independent trusted completion adapter; record its durable `resolutionReference`. This is an obligation-settlement acknowledgement, not proof of physical completion or a reward issuance. |
| `close`          | Author; stop new starts. Never-published drafts/reviews close immediately; published content enters closing.                                                                               |
| `finalize`       | Author; release precisely one commitment after every recorded participation is resolved, then close.                                                                                       |

Private reads are `progression(author)`, `readQuest(questId)` and `participation(questId, participant)`. They are internal service views, not public API payloads. A discovery endpoint must return only approved public content and must not expose draft text, private participation, moderation reasons or receipts indiscriminately. This slice stores plain free-quest text only; protected/paid content must use a separate access-controlled serializer and storage policy.

The module never updates earned XP, inventory, native entitlements, treasury, rewards or sponsorship tables. Level drops/returns cannot issue a grant through this module. Before activation, route all relevant demo level gates through available XP and preserve the existing once-only award identities. Native progression must remain independently authoritative; a demo commitment must never reserve native contract XP or affect a native mint.

## Integration sequence

1. Bring the creator files listed in the companion handoff into the receiving branch and review the base-to-current differences. The other chat can continue its wallet/staking/recovery work independently.
2. Select and publish the XP policy separately from this code. Keep the adapter disabled until authenticated roles, migration/restore, read serializers and complete player behavior are ready.
3. Add routes and Community authoring UI as one reviewed slice under `DESIGN.md`; display the quote, available XP/level change, pending review, rejection, closing obligations and confirmed release. Inspect all required phone/desktop/form states before declaring the UI complete.
4. Wire authoritative quest/evidence validation and rewards. Settle the participant's actual obligations and durable reward receipt before calling `resolve`. If both use the same SQLite database, expose a transaction-aware composition so reward settlement and the resolution acknowledgement commit together. The current methods own `BEGIN IMMEDIATE`; they must not be nested inside another transaction. If adapters cross services/chains, use a durable reconciled workflow. Do not substitute a client-supplied reference for evidence validation.
5. Define abandonment, moderation removal, appeals, deadline/escalation and operator recovery policies. Open admissions intentionally block XP release until resolved by the trusted adapter; there is no invented automatic expiry or XP slash. A production timeout cannot discard timely evidence.
6. Add paid access, sponsored prizes or creator-fund rights only after extending closure blockers to their real durable obligations. Zero open participations currently proves only this slice's narrow closure condition. It cannot prove that an external refund or payout is complete.
7. Implement and prove equivalent native XP commitments on authoritative contracts, with explicit migration and replay identities, before labelling this a native creator platform. Do not duplicate native XP into this demo adapter.
8. Record the integrated acceptance evidence in the shared tracker after coordination. Adding these source files alone must not close W08 or change public completion claims.

## Verification

The focused suite contains 22 tests, including:

- Actual concurrent SQLite connections race two approvals against insufficient shared XP; exactly one succeeds.
- Identical concurrent approvals return one durable receipt and create one lock.
- Starting versus cancellation either admits and preserves the participant or rejects the new start.
- Receipt-write failures roll publication/XP locking and final closure/XP release back together.
- Closing the database and reopening it recovers receipts/locks; deleting a system world retains creator content and participant revision rights.
- Rejection, withdrawal, stale revisions, insufficient XP, policy changes, authorization failures and replayed resolutions preserve invariants.
- A complete isolated publish/start/close/resolve/finalize journey leaves earned XP, items, history, treasury and native award records unchanged. Releasing one quest never releases another quest's commitment.

Run `node --test tests/creator-lifecycle.test.mjs` in the receiving checkout. The unchanged baseline plus this file contains 290 unique application tests. Verification was split as follows:

| Run                                                   | Result                                                                                                  | Evidence                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `npm test` in the restricted environment              | 286 passed; 4 local-server cases blocked by `listen EPERM`                                              | `output/qa/W08-creator-lifecycle/regression-restricted.txt` |
| The four affected test files with local-server access | 5 passed; 1 failed because the fresh checkout had no `dist/index.html` (503 at the root-page assertion) | `output/qa/W08-creator-lifecycle/http-before-build.txt`     |
| `npm run build` in this worktree                      | Passed                                                                                                  | `output/qa/W08-creator-lifecycle/build.txt`                 |
| `node --test tests/http.test.mjs` after that build    | 1 passed                                                                                                | `output/qa/W08-creator-lifecycle/http-after-build.txt`      |

Every one of the 290 unique tests was observed passing across these runs. This is not a claim that the first unrestricted full-suite command passed; initial environmental failures are retained. The 22 new cases passed in the full suite and in focused runs. No existing test or runtime file was changed to obtain these results.

The current combined transfer artifact is `output/handoffs/creator-lifecycle.patch` with its SHA-256 sidecar. It includes the creator implementation, companion handoffs, focused tests and retained verification transcripts. It excludes dependencies, generated preview files, local databases and all changes from the other chat. The patch is checked against the active project checkout without applying it. Review and apply it only when the receiving branch is ready; the original slice was uncommitted and undeployed; the subsequent local integration is recorded separately.

No browser, device, field, live chain or usability verification was performed for this server-only module. The follow-up implements profiles/follows and discovery services; their application UI, actual solo completion rewards, native locks, moderation operations and W09 payments remain integration work. This handoff does not authorize deployment or mainnet actions.

## Combined integration update

The completed native-recovery commit `0ff170b` was subsequently combined with this slice. [The integration record](CREATOR-INTEGRATION-2026-10-31.md) records 343 passing application tests and a successful build, with creator routes still disabled.

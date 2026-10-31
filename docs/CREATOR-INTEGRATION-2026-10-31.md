# Creator integration and current runtime boundary

31 October 2026. The local working tree now mounts optional creator services in
`server/index.mjs` and `CreatorCommunity` under Community. This supersedes the
unmounted-source status in the historical merge record below. Nothing in this
follow-up deploys or enables the feature on a production host. W08 remains building.

## Current implementation

- Default configuration creates no creator tables. Explicit enablement requires an
  immutable versioned XP policy and trusted local review/completion actor lists;
  there is no economic or role default. All 200-XP examples are QA-only fixtures.
- The player UI connects private drafts/revisions, publication quotes and explicit
  acceptance, public profile consent, free follows/discovery, private started quests,
  closing obligations and exact XP release. Requests reuse real host authentication,
  origin checks and write-rate limits. Review, resolve and private audit use the local
  operator CLI; no privileged player endpoint exists.
- Common player reads and the HUD use earned/locked/available XP and current level.
  Locks change no earned XP, inventory or once-only grant. Accepted revisions survive
  edits, hiding, blocks and closure. Turning publication off preserves existing locks.
- Reward status is explicitly not configured. Independent completion resolves a
  recorded obligation; it awards no invented XP/item/GOLD and proves no physical
  visit. Native creator XP commitments, donations, paid access, creator funds,
  SocialDB/IPFS creator publishing and production moderation/governance remain open.

## Current evidence and remaining checks

[Runtime/operator evidence](../output/qa/W08-runtime/README.md) records real isolated
HTTP/CLI draft → accepted quote → independent approval → follow/discover/start →
closing → independent resolution → exact release, including current-level reads,
receipt retries and no duplicate economic grants. This is separate from UI fixtures.
[Restore evidence](../output/qa/W08-runtime/restore/README.md) records actual private
live-WAL backups and isolated reopened runtimes, exact schema/row/receipt equality,
protected private/public projections, one-time partial release and a second restore.

The [final suite](../output/qa/W02-W08-parallel/tests-final.txt) passed 408/408 and
[TypeScript/Vite build](../output/qa/W02-W08-parallel/build-final.txt) passed. The
earlier [reviewer suite](../output/qa/W02-W08-parallel/reviewer-tests.txt) retains
403/403 as historical evidence; pure navigation and creator/backup recovery checks
passed 12 and six respectively. [Draft continuity](../output/qa/W02-drafts/README.md)
records source/model coverage; earlier [native objective browser evidence](../output/qa/W02-native-objective/README.md)
uses synthetic authoritative-read fixtures.

The [actual local-host report](../output/qa/W02-W08-parallel/README.md) and
[creator browser observations](../output/qa/W02-W08-parallel/creator-browser-notes.md)
now record the integrated author browser, separate fresh participant HTTP and
trusted operator CLI journey. Author stop-new-starts showed Closing, one open
obligation and disabled finalization with a reason. Independent synthetic QA
resolution left zero open obligations and the exact 200-XP lock. Deliberate author
UI finalization then showed Closed, earned 1000 / locked 0 / available 1000, Level 4
and unchanged GOLD. Participant retries created one accepted revision and no award.
All amounts/policy/validation references are QA-only; no physical completion, reward
policy or native creator right is inferred.

Actual App navigation/modal and separate form fixture checks are verified locally. Physical
Safari/iOS, Chrome/Android, keyboards/zoom, GPS/wallet return, production governance,
activity rewards and full-host/offsite restore remain open. The local batch adds no
chain action or deployment.

## Historical foundation merge

31 October 2026. Receiving baseline: `0ff170b3a3ceb0cd6020001efc8e38e16736d76b` (`Harden native receipt recovery, worker leases and backup consistency`). The other chat completed its turn before this integration. Its source changes were brought into the isolated creator worktree with a fast-forward, preserving the creator additions.

### Original result

The combined local source contains durable native wallet recovery/worker/media-backup changes from the other chat, plus the creator lifecycle, XP commitments, profiles, free follows, protected read projections and optional player/server adapters from this chat. No wallet, contract or application entry-point edits were made by the creator slice. Shared roadmap/gap notes now distinguish the local source foundation from deployed behavior.

At this historical foundation merge, the creator API was **not mounted or enabled**. Ordinary gameplay still has no creator publication locks. The deployed application remains the separately verified `0ff170b` version; this local merge does not deploy the creator services, mint rewards or change the current economy.

### Original evidence

- `output/qa/W08-creator-combined/tests.txt`: **343/343 application tests passed**, zero failures/skips.
- `output/qa/W08-creator-combined/build.txt`: combined TypeScript/Vite build passed.
- `output/qa/W08-creator-combined/creator-tests.txt`: **44/44 creator tests passed**, including real local HTTP upload interruption/limits and concurrent SQLite publication/retry/cancellation cases.
- The creator working copy was advanced to the exact completed native-recovery commit before these combined checks. Existing unrelated untracked map research/concepts in the main checkout are excluded from the creator commit and merge.

No contract source changed in this slice; Rust tests were not rerun. No new dependencies, signing keys, production database writes, chain operations or deployment were needed. The existing physical-device, account-recovery, staking/yield, canonical Intents and creator UI/native integration gates remain open.

### Original next-slice handoff

Use [the Community handoff](CREATOR-COMMUNITY-HANDOFF.md) and [lifecycle details](CREATOR-LIFECYCLE-HANDOFF.md). Select the versioned XP policy, compose the actual host session/roles, wire all relevant level reads to available XP while preserving once-only rewards, build the Community editor/discovery/participation interface and integrate authoritative activity validation/receipts. Rehearse migration/restore and governance before enabling routes. Paid access, sponsored payouts and native XP rights need their own implemented obligations; this adapter does not represent them.

Source integration and the W08 acceptance gate remain separate. W08 stays **building**; screenshots/device playtests and live native creator rights are not established by this merge.

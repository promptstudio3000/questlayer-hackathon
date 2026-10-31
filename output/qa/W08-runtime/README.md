# W08 creator runtime and operator integration

31 October 2026. Local source integration only. Creator publication defaults off;
no production configuration, deployment, chain transaction or player balance was
changed. The 200-XP policy below is explicitly a QA fixture, not adopted balancing.

## Implemented

`server/creators/runtime.mjs` mounts the existing authenticated player adapter in
`server/index.mjs`, after host write-origin/content/rate checks and before body
consumption. It reuses the original session authenticator. No player route grants
moderation, completion, reward or operator capabilities.

Configuration is explicit:

- `CREATOR_COMMUNITY_ENABLED=1`
- `CREATOR_POLICY_VERSION=<immutable policy identifier>`
- `CREATOR_XP_COMMITMENT=<positive safe integer>`
- `CREATOR_MODERATORS=<comma-separated trusted operator actor IDs>`
- `CREATOR_COMPLETION_AUTHORITIES=<comma-separated trusted operator actor IDs>`

Missing/invalid enabled configuration fails before creator initialization. Disabled
startup creates no creator tables. Roles have no default. Authors cannot review
their own publication and neither author nor participant can settle that participant.
Runtime enablement is not native creator rights or permission to pay rewards.

Authenticated `GET /api/creator-community/status` works in either mode and returns
`enabled`, `domain: demo`, nullable `policy`, `rewards: not-configured`, `native: false`,
`reviewConfigured` and `completionConfigured`. Disabled player routes return 404.
Status is private/no-store and exposes no operator allowlist.

Private UI recovery reads were added:

- `GET /api/creator-community/me/quests/:id`: own projected draft/publication,
  latest revision state and `latestReviewReason`, current version, lock and open
  participant count. Another actor gets 404. No raw operator capabilities are exposed.
- `GET /api/creator-community/me/participations`: bounded stable-ID pagination of
  this player's accepted revisions, with `questId`, `revision`, `state`, `questState`,
  `content`, `rewardStatus: not-configured`. The list remains private and usable after
  author edits, profile hiding, bilateral blocks and closing. It does not expose an
  author's future draft or another participant's content.

The common `playerView` now returns cumulative `xp` / `earnedXp`, active `lockedXp`,
`availableXp` and `levelFor(availableXp)`. The host's `profile` retains that level.
Existing commitments remain counted if publication is disabled; turning off a route
cannot silently restore level or erase obligations. The client uses available XP for
its demo level/HUD. No XP is minted or burned by lock/release; inventory and one-time
award records are unchanged. Native progression remains a separate authoritative
contract domain. Completion here resolves an obligation and gives **no configured
XP/item/cash reward**.

## Trusted local operations

`scripts/creator-operator.mjs` has no HTTP endpoint. It requires an existing database
selected explicitly, and uses the same environment policy/role configuration.
Mutation input is an exact-field JSON file bounded to 16 KiB. Durable operation IDs
retain the existing lifecycle replay/fingerprint guarantees.

```sh
node scripts/creator-operator.mjs audit --database /private/tmp/qa/game.sqlite --limit 50
node scripts/creator-operator.mjs review --database /private/tmp/qa/game.sqlite --input /private/tmp/qa/review.json
node scripts/creator-operator.mjs resolve --database /private/tmp/qa/game.sqlite --input /private/tmp/qa/resolve.json
```

Audit uses a read-only SQLite connection and reports bounded pending revisions,
active commitments and open participations. It is an operator inspection of private
content, not public discovery or proof that a limited page is the whole queue.

Review input has `actor`, `operationId`, `questId`, `expectedVersion`, `decision`
(`approve` or `reject`) and `reason`. Resolve input has `actor`, `operationId`,
`questId`, `participant` and a stable `resolutionReference`. The trusted operator
must perform the independent review represented by that reference. The tool does
not invent evidence, verify GPS or produce a creator completion reward.

## Safe isolated host rehearsal

Run from a new temporary working directory so repository `.env` is not loaded.
Use an isolated database and explicit QA configuration. The following switches
were added for this rehearsal; ordinary startup defaults are unchanged:

- `DISABLE_BACKGROUND_WORKERS=1` suppresses world planner/reward worker starts and
  maintenance effects, without changing contract rights or withdrawal code.
- `DISABLE_NATIVE_ATTESTATIONS=1` generates/loads no award attestor, disables native
  reward attestation setup and fails voucher issuance/public signer endpoints closed
  with 503. Existing earned-Aura confirmation/restore operations do not require that
  signer. This is an isolated test-host configuration, not a new production recovery
  or withdrawal policy.

Set `REWARD_ATTESTOR_PATH=''`, `REWARD_WORKER_KEY_PATH=''` and a loopback-unavailable
`NEAR_RPC_URL=http://127.0.0.1:9`. Use `APP_ORIGIN` matching the exact browser origin.
For example, the QA tests use `CREATOR_POLICY_VERSION=qa-only-runtime-v1`, commitment
200, reviewer `qa-reviewer` and validator `qa-validator`, with no player keys. Test
XP is explicitly seeded only into the disposable database after creating sessions.

## Verification and remaining gates

`tests.txt` records **49/49 creator tests passed**, including the prior 44 focused
cases and five new runtime cases. The new cases cover disabled/no-schema startup,
explicit configuration rejection, lock-aware application progression, private
pagination/revision/review-reason boundaries, and actual isolated host/CLI journeys.

The actual HTTP journey creates author/walker sessions, publishes a consented
profile, saves a draft, accepts its quote, independently approves via CLI, follows
and discovers the quest, starts solo, hides the author profile, retains the private
accepted revision, closes admission, refuses premature finalization, independently
resolves the obligation and releases the exact 200 XP once. Author progression is
1000 earned / 200 locked / 800 available / level 3, then 1000 / 0 / 1000 / level 4.
Replayed moderation/finalization does not create another lock/release. Both original
avatar inventory rows, welcome history and treasury totals remain unchanged; the
walker earns no new XP. Disabled-host HTTP tests verify authentication, 404 routes,
503 signer status, no creator tables and no generated signing file.

Browser/UI composition, integrated full-suite/build verification and shared roadmap
updates belong to the coordinating agent. Physical devices, native XP commitments,
actual completion rewards, field validation, operational staffing/deadlines, public
SocialDB/IPFS publishing, donations, paid access, creator funds and full restore /
release governance remain separate roadmap gates. If publication is disabled with
open obligations, locks are preserved; operations must re-enable the reviewed
service to complete player lifecycle actions. No full W08 exit gate or production
moderation readiness is claimed by this runtime integration.

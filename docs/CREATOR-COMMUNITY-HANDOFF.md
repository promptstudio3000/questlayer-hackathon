# W08 Community service and player API handoff

31 October 2026. Continues the [creator lifecycle slice](CREATOR-LIFECYCLE-HANDOFF.md) in the same isolated worktree, based on `4149058`. This is the original service-foundation handoff. The [current integration](CREATOR-INTEGRATION-2026-10-31.md) now mounts an optional local runtime and player interface; default configuration remains disabled, and no production deployment or completed W08 acceptance is claimed.

## Implemented

- Explicitly published creator profiles use the existing player identity. The private account name is never automatically published. Publishing requires consent; hiding a profile removes it and its quests from public discovery.
- Free follow/unfollow produces a Following quest feed. There is no payment, XP change, GPS request, presence update or public follower list.
- Bounded, deterministic discovery and author-only My creations support keyset pagination. Public results contain approved quest text and public creator attribution only. Discovery has no distance ordering or Nearby claim because this slice has no reviewed geographic metadata.
- An admitted player privately retains the revision accepted at their start, including after edits, profile hiding, bilateral blocks and closure. This does not give them an author's future private drafts.
- Existing `social_blocks` apply in both directions to profiles, discovery, Following and new admissions. The composed service checks audience/block rules inside the admission write transaction. Unfollow remains available after blocking or hiding. A block filters an existing follow; it does not silently delete it. Unblocking can make that retained follow visible again.
- Publication quotes explicitly identify their policy version and XP amount. Submission requires `expectedPolicyVersion`; stale/unaccepted policy quotes fail before review or XP locking.
- Profile, following and quest mutations use the same actor-scoped idempotency journal. A successful operation ID cannot be reused across services for different terms.
- Player APIs enforce the authenticated session actor, exact write origin, JSON content type, a 16 KiB streamed body limit, strict field allowlists and private/no-store responses. Player routes cannot moderate, resolve participation or set reward amounts.
- A Node HTTP bridge accepts the original host session authenticator, preserves existing route fallback and rejects oversized in-progress uploads without destroying their response socket. Interrupted uploads terminate their body reader without applying a partial mutation.

All public quests report `domain: demo`, `access: free` and `rewardStatus: not-configured`. These APIs do not mint participant XP/items or prove physical completion. No financial or native staking contract was modified.

## Files and assembly

| File                               | Responsibility                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `server/creators/lifecycle.mjs`    | Revision/moderation/XP/closure domain, accepted publication quotes and an admission capability hook |
| `server/creators/operations.mjs`   | Shared transaction receipt, canonical terms, validation and replay namespace                        |
| `server/creators/community.mjs`    | Explicit public profiles, follows, approved discovery and private owned reads                       |
| `server/creators/services.mjs`     | Supported composition; applies current public/block rules atomically to admissions                  |
| `server/creators/api.mjs`          | Web Request/Response player API, disabled unless explicitly enabled                                 |
| `server/creators/node-handler.mjs` | Bridge to the existing Node server/session authenticator                                            |
| `tests/creator-*.test.mjs`         | 44 focused lifecycle, privacy, API and actual local HTTP cases                                      |

Use `createCreatorServices(db, options)` for Community rather than independently assembling lifecycle and Community objects. The factory binds audience validation to the same write transaction as participation creation. Standalone lifecycle use retains the earlier trusted-domain behavior; it has no public profile/discovery policy by itself.

Initialize only after deliberate feature configuration. Lifecycle initialization creates its six `creator_*` tables; Community adds `creator_profiles`, `creator_follows` and initializes the existing social-block schema. The current host bootstrap initializes these services only with explicit feature configuration; there is no new account system. The policy must explicitly supply an immutable version and a positive safe-integer XP amount. Test fixture amounts are not production tuning decisions.

The current mounting uses the existing `auth(req)` function in `server/index.mjs`. `createCreatorRuntime` composes reviewed policy/operator capabilities and the Node handler with `authenticate: auth`, configured `origin` and an explicit enabled flag. The host `api()` calls `if (await creatorRuntime.handle(req, res)) return;` **after** its existing origin/rate-limit checks and **before** any body parsing. The Node bridge constructs the request URL from the configured origin; do not pass the host's internal `http://localhost` parsing URL as a public origin. Instantiate neither services nor tables when the feature is disabled at the host configuration level.

Preserve the host's session revocation, authorization, request timeout, rate limits, logging and security headers. The adapter supplies neither player keys nor moderator/settlement credentials. No player endpoint grants those roles. Operator review/validation remains a separate capability, not a role field in a player request.

## API contract

The prefix is `/api/creator-community`. Every handled response is private and non-cacheable; all routes require an authenticated player. Unsupported prefixes return to the host router. Unenabled adapters return 404.

| Method/path                         | Behavior                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /me`                           | Own deliberate profile and demo earned/locked/available XP                                                 |
| `GET /me/quests`                    | Author-only drafts/publication state/commitments/open participation counts                                 |
| `GET /creators`                     | Visible public creator profiles                                                                            |
| `GET /creators/:id`                 | Public profile plus this viewer's Following state                                                          |
| `GET /quests`                       | Approved published free quests; optional `creator` and `following=true/false` filters                      |
| `GET /quests/:id`                   | Current approved public quest only                                                                         |
| `GET /quests/:id/participation`     | This player's immutable accepted revision and participation state                                          |
| `GET /quests/:id/publication-quote` | Author-only policy version, amount, expected quest version and available XP                                |
| `PUT /profile`                      | Save own profile with `operationId`, `expectedVersion`, `{ displayName, bio, public }` and `publicConsent` |
| `PUT /creators/:id/follow`          | Desired `following` boolean and `operationId`; never a payment                                             |
| `POST /quests`                      | Own `questId`, `{ title, description }` draft and `operationId`                                            |
| `POST /quests/:id/revisions`        | Append a draft with `expectedVersion` and `operationId`                                                    |
| `POST /quests/:id/submit`           | Accept `expectedPolicyVersion` and submit with `expectedVersion`/`operationId`                             |
| `POST /quests/:id/withdraw-review`  | Author withdraws pending review                                                                            |
| `POST /quests/:id/close`            | Author stops new starts while retaining admitted obligations                                               |
| `POST /quests/:id/finalize`         | Author closes only once all recorded obligations are resolved                                              |
| `POST /quests/:id/participation`    | Authenticated player starts once under their own session                                                   |

List endpoints accept `limit` (1–50, default 20) and an opaque stable-ID `cursor`; no GPS, actor or role query is accepted. Returned `nextCursor` is null at the end. A successful mutation's replay returns its historical receipt. Refresh reads to show the current state; never render a receipt as a new success event solely because it was imported/retried.

There are intentionally no player `/review`, `/resolve`, donation, payment, evidence-upload, payout or fund-allocation routes. A profile's public flag is the author's visibility choice, not an operator moderation approval. Operator removal, report/escalation and deadline/abandonment handling still need their own governed flow before public activation.

## Evidence

At the original service/API stage, the complete isolated application suite passed **312/312** tests. The focused set contains **44** tests: 22 lifecycle, 12 Community, 9 Web API and 1 actual Node HTTP bridge case. Additional final checks of the bridge cover ongoing oversized and interrupted uploads. Transcripts are in `output/qa/W08-creator-community/`.

Tests verify a complete isolated profile → draft → accepted quote → independent approval → follow → discovery → start → closing → independent obligation settlement → XP release sequence. Actual concurrent connections protect XP, exact receipt recovery, immutable participant revisions and start/cancel ordering. Privacy checks cover unapproved content, other players' drafts/participation, private names, bilateral blocks, actor spoofing, origin changes, malformed/streamed input and generic error responses.

That original evidence covers server/adapters. The subsequent [runtime report](../output/qa/W08-runtime/README.md) and [restore rehearsal](../output/qa/W08-runtime/restore/README.md) cover current host/CLI and local database integration; the player UI is now mounted in source. The [actual-host creator journey](../output/qa/W02-W08-parallel/README.md) and [browser notes](../output/qa/W02-W08-parallel/creator-browser-notes.md) verify author closure, guarded finalization, separate trusted resolution and exact UI XP restoration. Separate actual App navigation/modal and form fixture checks are verified locally; physical devices remain unverified. The full W08 exit still requires validated activities, actual confirmed rewards, native/profile-storage adapters, full-host/migration recovery, governed moderation and native XP commitments. W09 money flows remain separate and unimplemented.

## Combining with the other chat

Only creator-owned source/test/documentation and evidence paths are in this worktree's transfer patch. The other chat owns wallet durability, transaction anchors, staking, social media fixes and host recovery. Application entry points, wallet code and economy contracts remain untouched by the creator slice. Shared roadmap trackers were updated only after the other chat finished, as recorded in the combined integration note.

When that chat has finished, first verify the receiving checkout has no conflicting creator paths. Copy/apply the reviewed additions, preserving all existing changes. Run the creator tests against its current database/domain/social-block modules, then the complete combined application suite and build. Register/enable the feature only in a subsequent complete player-facing slice with its required rendered/device evidence. Source integration does not authorize deployment or imply a live creator platform.

## Combined integration update

The completed native-recovery commit `0ff170b` was subsequently combined with this slice. [The integration record](CREATOR-INTEGRATION-2026-10-31.md) records 343 passing application tests and a successful build, with creator routes then still unmounted/disabled; current optional runtime mounting is recorded above.


## Runtime follow-up API additions

The mounted runtime adds authenticated `GET /status` in either mode, reporting the
feature flag, demo domain, nullable explicit policy, unconfigured rewards and trusted
review/completion availability without exposing operator lists. Disabled player
routes remain 404 and create no tables. New private reads are `GET /me/quests/:id`
(author-only latest revision/state/review feedback/lock/obligations) and
`GET /me/participations` (bounded pagination of this player's accepted revisions).
Review feedback never enters public or participant projections. See
[the runtime report](../output/qa/W08-runtime/README.md) for exact configuration and
operator commands. Test policy values do not constitute adopted production tuning.

# Latest planning continuation: shared world and outdoor claims

The owner's latest direction is documentation only, ahead of another evening
refresh of the entire handoff. The [next implementation chapters](GOTCHIVERSE-SHARED-WORLD-PLAN-2026-11-07.md)
specify the common terrain, authoritative outdoor evidence, permits, temporary
claims, renewal, takeover/archive and settlement recovery. They keep the prior
permit-plus-QGOLD plan inactive; no fee waiver was selected. The first prerequisite
is proof classification: the current demo result schema's `gps` field alone is
insufficient to authorize a real outdoor permit.

No runtime or economic change was made in this documentation continuation.
[Its own provenance and reconstruction instructions](../output/qa/claude-evening-handoff-2026-11-07/README.md)
separate this plan from the implemented R1 delta and the older D2 audit. The new
plan also records the order of later Aura, DAO/AI, NFT and extra-layer work.
External stream states below remain dated evidence until the evening recapture.

---

# Runtime continuation: Gotchiverse integration

7 November 2026, after the original D2 delivery. A newer, separately identified
runtime candidate now mounts Gotchiverse in the actual QuestLayer client and API.
Read [the integration handoff](../output/qa/gotchiverse-integration-2026-11-07/README.md)
for its exact scope, file delta, tests, screenshots and remaining gates.
The first integration was built on the captured current UI, not the old `e916`
client. The original shared checkout was not overwritten.

The original report below remains a dated record. Its statements that runtime
integration is planned or that this task changed no runtime refer to **D2 only**.
They do not describe the later `weekend/r1-gotchiverse-integration` candidate.
The original ZIP and ten-patch security archive remain frozen for reproducibility.

---

# Claude return: changes, security candidates and next integration

Prepared 7 November 2026 for the owner and returning Claude. This handoff separates
committed work, uncommitted source, isolated candidates, historical verification,
active work and future product decisions. It is not a deployment record.

Start with the machine inventory in
[`output/qa/claude-return-2026-11-07/source-inventory.json`](../output/qa/claude-return-2026-11-07/source-inventory.json)
and the [change ledger](../output/qa/claude-return-2026-11-07/change-ledger.json).
The exact capture times, source paths, digests and concurrent-drift checks govern
this report. Work continued in other chats while it was written.

## The immediate integration decision

Preserve the current shared checkout and reconcile the security candidate with its
new UI before implementing additional financial features. A clean old checkout is
a reproduction base, not a replacement for newer work. Do not reset the shared tree,
copy one worktree over another, or stack every overlapping historical UI patch.

The canonical source checkout is
`/Users/coinmandeer/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON`.
At the initial audit its branch was `weekend/u12-camera-input`, HEAD was
`9dbed6f6709cdbc95fc214ee36733366fc515114`, and the integration reference/merge-base
was `e9160028637cda7785cae02acd9ea3e299525c17` on
`claude/upbeat-gauss-5czir7`. The machine capture rechecks those values.

This handoff's isolated branch is `weekend/d2-claude-return-audit`, based on `e916`.
Its changes are additive documentation, an isolated local prototype and review
artifacts. It applies none of the financial/security candidates to the live source.
No original runtime file, financial rule, dependency, CI configuration, deployment
record, key or production state was changed by this handoff task. Frozen candidate
archives contain protected financial changes by the security stream; they remain
review artifacts, not authorization to bypass the owner-only guard.

## 1. How to distinguish the work

| Stream | State | Where to inspect | Integration consequence |
| --- | --- | --- | --- |
| Sixteen weekend tasks | Committed locally through `9dbed6f` | `main-committed.patch`, commit list and source QA | Preserve the implementation history; not proof of remote merge/deployment |
| Integrated mobile/map/dialog UI | Uncommitted in shared source; older frozen evidence exists | `output/qa/integrated-2026-11-06/` | Historical patch applies to `9dbed6f`; current files have drifted |
| Secondary screens, Profile/Community and mobile polish | Overlapping uncommitted UI stages | Corresponding dated QA folders | Inspect scope manifests; do not apply them all on top of the current aggregate |
| Linear adventures and map play | Newer local follow-ups | `linear-adventures-2026-11-07/`, `map-play-2026-11-07/` | Preserve objective order, input ownership, GPS facing and recovery |
| Security A01–A09 | Frozen nine-patch local candidate with independent review gates | Security archive and package manifest copied into this delivery | Reproduce on `e916`, then reconcile into newer source |
| Login/API/permissions review | Completed local ten-patch candidate; independent review remains | `security-status.json` and security worktree | Use its exact frozen state/status, not a claim that all patch-9 tests cover patch 10 |
| Global world preparation | Separate active worktree; collector and newer finance work | `external-streams.json`, original `global-release/README.md` | Contains protected contract/payout edits; independent owner scope and review |
| New map art and zone rendering | Separate active worktree | `zone-aura-2026-11-07/`, map-kit manifest | Artwork and source integration have different verification scopes |
| Realm/Aura/DAO design | Consolidated product specification | [integration plan](QUESTLAYER-INTEGRATION-PLAN-2026-11-07.md) | Runtime work remains staged; owner choices and proposed tuning are marked |
| Gotchiverse interaction study | New, isolated, implemented local prototype | `prototypes/gotchiverse/` | Browser-local terrain/claim study; no gameplay API, GPS proof or money |

Git authorship does not reliably identify the writing agent. Branch names, commit
ancestry, source hashes, scope records and thread references provide provenance.
All inspected weekend branch tips being ancestors of a shared HEAD would establish
only committed ancestry, not that uncommitted work in their worktrees was integrated.

## 2. Committed weekend baseline

The initial source delta from `e916` through `9dbed6f` contained 71 files,
2,723 additions and 882 removals. See the generated inventory for captured totals.
Twenty commits record implementation, verification follow-ups and completion of
sixteen listed weekend tasks. Important implementation pointers include:

| Before — source problem addressed | After — local committed work | Why / pointers |
| --- | --- | --- |
| The next adventure competed with panels and shortcuts | Map home, one objective, compact HUD/demo controls | `8389f37`, `src/App.tsx`, `HudXpRing.tsx`, `phone-map.css` |
| Equipment and collection took too much scrolling | Inventory equipment/collection in the first viewport | `cde4201`, `src/Inventory.tsx` |
| Profile and community navigation needed clearer structure | Five sections each, reachable settings and availability states | `e081278`, `8bfe330`, `src/screens.tsx` |
| NPC conversations needed readable task state and retry | Accessible screens/tabs with drafts and short fallback voices | `72afba5`, `b1a1af2`, `src/NpcSheet.tsx` |
| Monster interactions lacked equivalent inputs/reliable retry | Keyboard rune tracing and confirmed-result retries | `d6687a0`, `src/MonsterChallenge.tsx` |
| Recovery/lazy content could be blank or unhelpful | Actionable failure states and lazy post-entry panels | `0226a09`, `ae03cd1` |
| Fallback discoveries and wiki statements were unclear | Action-oriented clues and dated rule review | `98d82fa`, `b4bea0f` |
| Text/controls lacked complete viewport evidence | Language, navigation, minigame and enlarged-input checks | `67be5e8`, `96a9e60`, `6849780` |
| Local code and public status could be confused | Dated implementation/public-health distinction | `c4f5da5`, `docs/STATUS.md` |

The untracked `public/treasury-mix-testnet.json` was preserved and not adopted as
a newly verified deployment record. Its presence is recorded in the source status.

These descriptions come from source and recorded local evidence. They are not a
new observation of every original running screen in this handoff task.

## 3. Uncommitted UI and playability follow-ups

The captured working patch and newly added source files preserve the current
aggregate. Earlier patches are retained by their original QA directories for
provenance, not as an additive installation sequence.

- **Map and objective surfaces:** `MapSurface`, `FindDetails`, `QuestBrief`,
  `ZonePresence`, nearby-action selection and contextual details. Keep confirmed
  availability separate from visual lures and straight-line guidance.
- **Appearance and discovery:** `ActorPortrait`, `WearableMoment`, inventory
  polish, result presentation and original appearance boundaries.
- **Dialogs and forms:** focus/scroll handling, secondary screens, error states,
  public-note consent and mobile typography. Preserve drafts and avoid duplicate
  success celebrations after retries.
- **Profile/Community:** authored character hierarchy, five sections and useful
  creator/unavailable entry points without silently enabling new money behavior.
- **Linear adventures:** current quest requirement, stop order, route hints,
  results and next useful action. Future stop markers must not bypass prerequisites.
- **Map play/input:** keyboard aliases, modal/form input ownership, camera recovery,
  real GPS course/fallback and stationary-jitter handling. Arena controls remain
  explicit simulation and cannot establish physical reward eligibility.

Verification sources:

| Evidence set | What its recorded run establishes | Limits |
| --- | --- | --- |
| `weekend-2026-11-05` | Sixteen-task local implementation and responsive/input evidence | Named historical source; local source is not deployment |
| `integrated-2026-11-06` | Recorded 1,284 app tests; 1,115 configuration checks, 19 skipped; language/browser matrices | 53 fingerprinted implementation files; current drift is measured separately |
| `secondary-surfaces-2026-11-06` | Recorded 110 accessibility scans, measured guide input and close target; UI/state fixtures | Actual local App/API and explicitly synthetic fixtures are distinguished |
| `profile-community-2026-11-06` | Five-route states, language checks, 360/390/landscape/desktop evidence | No physical phone or live financial operation |
| `linear-adventures-2026-11-07` | Local ordered quest and encounter checks | Use its own source manifest and limitations |
| `map-play-2026-11-07` | Recorded 1,298 app tests and 1,129 alternate-network fixture checks, 19 skipped; Chromium/WebKit input and stop checks | Synthetic GPS; no route safety, walking-time or hardware/FPS proof |

Do not add these test counts together: many repeat the same suite on different
source states. The initial rehash of the 53-file integrated snapshot found
24 matches and 29 changed files, none missing. The final inventory records the
fresh comparison. A historical green check does not validate a changed file.
Particular overlap hotspots are `src/App.tsx`, `GameMap.tsx`, `Dialog.tsx`,
`NpcSheet.tsx`, `BossFight.tsx`, translations, styles and wiki chapters/stamps.

Real Safari/iOS and Chrome/Android, OS enlarged text, physical keyboard, actual GPS
walks and wallet-return/hardware recovery remain separate acceptance work. Chromium
or WebKit emulation is not a substitute for those device checks.

## 4. Security: use the latest exact candidate

The security stream is in
`/Users/coinmandeer/.codex/worktrees/keeper-recovery/NEAR-HACKATHON`, chat
“Auditovat smart kontrakty a bezpečnost” (`01a1ae0d-bb65-77a0-a6a8-0b7cf35ca1b0`).
The shared source's older `output/security` folder is not the latest authority.

The selected delivery is the completed **ten-patch** archive,
`questlayer-claude-security-2026-11-07-final-auth.zip` (SHA-256
`3d34f9535133d6b53caecceb7c0e46da387d600213f22e88e4f2c61bf9f623fd`).
The nine-patch `questlayer-claude-security-2026-11-07-a05-a09.zip` is retained as
history. Both archives and all their member hashes were rechecked here.
`security-status.json` names the archive SHA-256, exact captured reports, patch
order, any tenth-patch package found and the latest observed thread state.
Do not substitute a similarly named earlier `with-keeper` or `with-lostfound` ZIP.

### A01–A09 candidate repairs

| Finding | Candidate repair | Main residual review |
| --- | --- | --- |
| A01 / P0 duplicate withdrawal mint | Durable once-only payout/credit reconciliation | Unknown outcomes, restored credits, exact finalized mint |
| A02 / P1 nightly payout completion | Submission separated from confirmed completion/retry | Receipts, lease takeover, pending obligations |
| A03 / P1 weak escrow funding binding | Bind complete terms/state and use durable delivery/outbox recovery | Concurrent accept/refund, replay and lost replies |
| A04 / P1 keeper recovery | Durable journal/lease and interrupted multi-step trade reconciliation | Actual target bytecode, retained output, no replayed spend |
| A05 / P1 purchase identity/burn proof | Exact intent and direct/delegated FINAL receipt binding; atomic delivery/credit/result | Paid unavailable item remedy; external-wallet unknown hash |
| A06 / P1 sponsored storage cash-out | Lifetime nonrefundable grants separate from player-refundable deposits | State layout, token-before-escrow activation and old deposits |
| A07 / P2 storage/dispute DoS | Fund record growth before admission; bind appeals to verified participation | Compaction, moderation liveness and preserved legitimate rights |
| A08 / P2 game-origin device key | Separate signing origin, exact request policy, protected account/asset operations | Existing-key transition, origin/cookie/PRF/mobile behavior |
| A09 / P2 shared subsidy exhaustion | Global reservations, funding journals and observed gas-overrun stop | Operator limits, bounded hot balance and gas-price exposure |

Patch 9 records 1,443 application tests, 67 QGOLD/escrow Rust tests and 71
actual-WASM/browser scenarios, with 145 recorded worker processes and 25 deliberate
SIGKILL interruptions. Build, bundle budget, signer build and wiki checks are also
recorded. These are the security stream's named-source results, not reruns by this
handoff task. Actual wNEAR/Rhea WASM tests were added after the older modeled keeper
evidence. Archived Rhea provenance/current deployed equivalence remains unverified.

### Login/API/permissions continuation

The later pass found additional account/session weaknesses. Its current candidate
adds fresh account-management authorization before attaching login methods or
queueing/removing device keys; purpose/session binding for wallet/passkey links;
revocation checks after streamed bodies and asynchronous creator admission; public
RPC configuration separation; event-stream logout handling, verified moderator authority, and bounded public
refresh/rate-limit behavior. Read its actual
findings and preconditions, particularly the conditional credential-bearing RPC URL
case. No actual production credential disclosure was investigated here.

At inspection, `2026-11-07-final-auth/verification.json` reported a ten-patch clean
application, 26 changed files, 94 matched source hashes, 1,462 passing application
tests, three browser scenarios and seven rerun signer/WASM scenarios. The 67 Rust
tests and 71 total scenarios remain **historical patch-9 results**; they were not
all rerun on patch 10. The security chat completed before this handoff cutoff. The final archive contains
all ten patches; its 282 file members and manifest hashes were reverified by this
task. Later edits would form a new candidate.

The user requires normal gameplay to remain seamless. Stronger protection applies
to withdrawal, asset/account control and recovery; ordinary play must not acquire
unnecessary confirmations. An isolated signer reduces key exposure but does not
prove the whole app safe or erase server/operator trust. No evidence here establishes
deliberate hidden backdoors, and no absence-of-backdoor certification is made.

### Security integration gates

Reproduce patch order on `e916`, verify source/WASM hashes, independently attack the
failure cases, then reconcile with newer UI/world work. Review actual configured
targets, origin/proxy/cookie policy, recovery, pending journals and existing device
authorization under a separately authorized operational review. Preserve unknown
payments and budget reservations. Never roll back to a known vulnerable spender
or clear an unresolved journal merely to make progress.

The security candidate did not change canonical release WASM pins, CI/dependencies
or deployment records. The separate global-world stream has its own proposed pin
and Rewards changes: do not confuse that with the security bundle's boundary.
Remote CI, owner-only protected-path approval, reproducible release artifacts,
physical devices and a named-environment release decision remain gates. No deploy
is authorized by this document. The Nov8 folder names are review scheduling,
not evidence that this Nov7 handoff was prepared a day later.

## 5. Active world and art streams

The world stream is `weekend/w14-global-world-preparation` in
`/Users/coinmandeer/.codex/worktrees/global-world-preparation/NEAR-HACKATHON`, chat
“Navrhni seedování questů do světa”. It has source preparation/collector work and
newer owner-authorized financial work. A recorded bounded-core prepared day had
11 zones/60 quests/two owners; that is historical coverage, not whole countries or
a globally funded live game. More recent full-source work has different counts and
policy. Preserve exact dated manifests and source labels rather than combining them.

Its `global-release/README.md` reports collector automation and a local rebuilt
Rewards candidate, and still lists whole-day reservations, dust/carry, conversion,
inventory, border context, capacity and physical-field gates. It reports separate
remote collector operations under that chat's authorization; this task performed
none. The latest observed work was reducing unnecessary regional recomputation
and implementing reservation-before-opening. That work is active and must be
rehash/reviewed before integration. It can overlap the payout/security repairs.

The art stream is `weekend/art2-map-kit` in
`/Users/coinmandeer/.codex/worktrees/questlayer-map-art-20261107/NEAR-HACKATHON`, chat
“Vytvořit QuestLayer herní obrázky”. Its newer package contains map art, standalone
viewers and 23 model rendering checks; that package's build/test results describe
the isolated asset baseline. Later source integration changes `GameMap`, actor/coin
layers and zone landmarks. Its `zone-aura-2026-11-07/README.md` describes open,
non-capped polygon curtains, smaller altars, map visibility and tilted overview.
These **zone boundary auras are rendering**, distinct from the equipped collectible
Aura economics in the new integration plan.

The latest observed art task was refining zone details and map-target guidance.
Preserve exact published polygons and the distinction between a directional hint
and a verified pedestrian route. Do not substitute generated imagery for original
Aavegotchi appearances/wearables. Review source/permission records before distributing
new art. Older 63-generated/8-original artwork statistics are an earlier package,
not the count of every current asset or a claim that all art is mounted.

`external-streams.json` captures path inventories and document hashes. This handoff
does not freeze every working file in active external worktrees or claim to own
their uncommitted changes. Re-inventory them at integration time.

## 6. New work produced in this handoff

The [integration plan](QUESTLAYER-INTEGRATION-PLAN-2026-11-07.md) consolidates the
approved world loop, temporary claims, limited Aura functions, QGOLD DAO, strategy
research/execution, NPC/private-AI use, Intents boundaries, geocaching and final demo.
It marks owner choices separately from unadopted tuning. It rejects a forced town,
complex land governance and extra Aura tricks outside the owner's chosen scope.

The standalone [Gotchiverse prototype](../prototypes/gotchiverse/preview.html) implements:

- QuestLayer/Gotchiverse/geocaching switching, with a once-only sample quest.
- Seeded 16 × 16 terrain, neighboring grid browsing, block raise/lower/material edits,
  character movement and placement of an original sample display collectible.
- Browser-local claims, owner/friend editing, visible read-only expiration,
  non-destructive renewal, archive-before-takeover and a natural-terrain reset.
- Local persistence with bounded validation and blueprint export; no external API,
  wallet, real GPS, staking reward, NFT custody or financial settlement.

This is an interaction study, not the actual new multiplayer game or the final
visual design. It uses local sample permits only. Its abbreviated claim simulation
does not implement the approved future QGOLD payment or annual term. Archive
previews are in-session only; existing terrain/claims persist in this browser.
No one should adopt its browser state as authoritative game ownership.

Seven meaningful model tests passed. Eight browser/viewport journeys passed across
Chromium and WebKit at 360, 390, 844×390 and 1440px, including keyboard selection and
movement, permissions, expiration/renewal/takeover, download, reload, named-button
alternatives and a 200% root-font fixture. An initial enlarged-text overflow failure
was fixed by constraining grid children and allowing tool labels to wrap. Screenshots
were inspected at phone and desktop sizes. Native OS scaling, real devices and
hardware input remain unverified; there are no text-entry forms in this prototype.

| Before | After | Why / file |
| --- | --- | --- |
| Realm/building discussion only | A local terrain editor and world selector can be tried | `prototypes/gotchiverse/index.html`, `app.mjs` |
| Unclear temporary-land lifecycle | Expired build remains visible; renewal preserves; takeover archives then resets | `prototypes/gotchiverse/model.mjs` |
| Financial features mixed with game ideas | Separate confirmed product decisions, proposed tuning and protected integration stages | `docs/QUESTLAYER-INTEGRATION-PLAN-2026-11-07.md` |
| Scattered dated reports could be confused with current source | Captured patches, file hashes, drift and security archive identity | `output/qa/claude-return-2026-11-07/` |

The wiki remains unchanged because no new mechanism was enabled in the actual
game. When a runtime stage is implemented, update its wiki chapter in that same PR
and stamp against the exact final sources.

## 7. Research, tracks and presentation

The [research brief](HACKATHON-RESEARCH-2026-11-07.md) includes the refreshed public
directory, track overlap, read demo-post summaries and honest limits on competitive
assessment. The observed directory has 242 projects rather than the earlier 218;
counts overlap because a project can select several tracks. A directory entry or
tweet is the author's claim, not a reviewed implementation.

Lead with a coherent Games With Real Economies loop. Add NFT/Social Money claims
only where behavior is demonstrable. A confidential NPC, constrained agent or DAO
plan can improve the case, but planned integrations do not earn implementation
credit. Do not claim a win probability from entry count or track count. There is
no defensible percentage without judging data and code review of competitors.

The strongest differentiation is the joined outdoor/virtual/yield loop, useful
equipped collectibles, access rights that do not permanently enclose the map, and
clear recovery without burdening ordinary play. None of those ingredients alone
establishes worldwide originality. A polished complete slice and evidence can
matter more than another disconnected feature before the deadline.

## 8. Review sequence and done criteria

1. Record current integration HEAD, all worktrees and pending candidates. Preserve
   source snapshots and existing work before reconciling patches.
2. Validate this archive's file hashes/CRC and the selected security package's
   exact base/order. Reject stale/ambiguous artifact substitutions.
3. Independently review the latest login/API and A01–A09 candidates. Reproduce the
   relevant regressions against their named sources; review any newer changes.
4. Reconcile overlapping UI, signing, wiki and world/payout edits deliberately.
   Do not sum historical test runs or accept a changed source under an old green log.
5. Run allowed build/budget/application/wiki/i18n/guard checks for the combined
   candidate, then owner-controlled CI/contract/release checks as applicable.
6. Review real phone/hardware/GPS behavior and exact operational target gates before
   calling those verified. Produce a scoped release decision, not a generic badge.
7. Implement the next staged realm slice. Keep financial work with its reviewed
   accounting and recovery boundaries. Preserve free solo entry.

No commit, push, PR, integration merge or deployment was performed by this handoff.
Only the owner can add `owner-approved`. The local audit pack and prototype are
ready to review; the product roadmap and financial candidates are not thereby
declared production-ready.

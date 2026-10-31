# QuestLayer: whole-project review and engineering handoff

Review date: 31 October 2026. Audience: the next engineer/agent and the project owner.
This is an implementation/acceptance review, based on the actual working tree,
repository history, owning source and retained evidence. Public HTTP observations
are recorded separately. This document does not certify a security audit, a
production financial launch or completion of V1.

## 1. Start here

QuestLayer, originally named **AuraTrail**, is a location-based exploration game on
real OpenStreetMap geography. The intended experience is: enter without a deposit,
find a useful solo adventure, complete its requirement, receive a confirmed result,
use an Aura on the same character, and continue. Native NEAR identity, staking,
rewards, collectibles, trading, creator content and social records are intended to
form one recoverable game around that loop.

**The project is a substantial playable alpha with native testnet pilots, not a
complete V1.** The tracker contains 15 milestones and 89 tasks; 12 milestones are
`building`, W09/W11/W14 are `planned`, and none has a recorded full exit pass.
The 102 rule IDs are all assigned to milestones. That assignment is traceability,
not evidence that all rules are implemented.

Latest local application verification: **484/484 tests, zero failures/skips, and a
passing TypeScript/Vite build**. The same checks were rerun successfully in the
immediately preceding whole-project review. No runtime source changed while this
handoff was written. Historical Rust/chain proofs remain historical and were not
rerun for this documentation task.

Read together:

- This document: overall state, findings, ownership, operations and next work.
- [Coverage appendix](PROJECT-REVIEW-COVERAGE.md): every rule, tracker task, final
  journey, UI package and spatial acceptance case, with scoped review disposition.
- [Audit snapshot](PROJECT-REVIEW-SNAPSHOT.json): Git baseline, local change
  inventory/source fingerprints and timestamped public observations. It is an
  inventory, not a source archive or deployment receipt.
- [Authoritative roadmap](../ROADMAP.md), [tracker](roadmap.json),
  [game rules](GAME-RULES.md), [gap register](V1-REMAINING.md).
- [Latest integrated delivery evidence](../output/qa/W00-W02-W08-next/README.md).

### Four separate meanings of status

| Dimension | Meaning in this handoff |
| --- | --- |
| Source implementation | Code actually exists and is connected in this local working tree. |
| Verification | Explicit test/source/browser/isolated-host/testnet evidence, with its limits. |
| Deployment | Timestamped public observation or a historical deployment record; neither substitutes for the other. |
| Milestone acceptance | The complete scenario and failure/device/operations gates in the roadmap. A passed test suite alone cannot close a milestone. |

## 2. Where the original plan is and how it evolved

The oldest reachable commit is **`a8896410879de5ec39f2edfc1d1ffaf5bb0c37a4`**
(31 October 2026, 01:39:03 +01:00), titled "Establish AuraTrail alpha and
implementation roadmap". It already contains the formal specification, creator
plan and W00–W14 roadmap. Earlier preparation/chat ideas are not an earlier Git
snapshot; do not reconstruct them by guessing.

| Document/source | Role and precedence |
| --- | --- |
| [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) | Main product, economy and integration specification. Compare its initial Git version with the present version to distinguish original requirements from delivered scope. |
| [PLAN-HRY.md](../PLAN-HRY.md) | A compatibility entry point pointing to the English specification. It is not a separate current implementation plan. |
| [ROADMAP.md](../ROADMAP.md) / [roadmap.json](roadmap.json) | Delivery order, dependencies, task IDs, journeys and full acceptance gates. Tracker statuses are coarse and some implementation notes predate the latest batch. |
| [CREATOR-ECONOMY-PLAN.md](../CREATOR-ECONOMY-PLAN.md) | Accepted creator direction: Community, refundable XP locks, creator support/funding, donations and paid access. The financial portions remain planned. |
| [GAME-RULES.md](GAME-RULES.md) | Consolidated 102 rules, including economic, identity, privacy and delivery boundaries. |
| [WORLD-GENERATION.md](WORLD-GENERATION.md) | Current citywide policy: six Plzeň slots, varied non-overlapping polygons, real transfers, one shared city/day world. It supersedes older circular/per-cell concepts. |
| [DESIGN.md](../DESIGN.md), [UI plan](UI-UX-IMPROVEMENT-PLAN.md), [research](UI-UX-RESEARCH.md) | Player-facing acceptance and provenance. Research/proposed numerical tokens do not automatically become implemented behavior. |
| [DEVELOPMENT-STATUS.md](DEVELOPMENT-STATUS.md), [latest slice handoff](RESULTS-AND-COMPLETION-HANDOFF.md) | Current local integration and evidence index; read before older transfer instructions. |

Reproducible history reads, from the repository root:

```sh
git show a889641:IMPLEMENTATION-PLAN.md
git show a889641:ROADMAP.md
git show a889641:CREATOR-ECONOMY-PLAN.md
git log --oneline -- IMPLEMENTATION-PLAN.md ROADMAP.md CREATOR-ECONOMY-PLAN.md
```

Key development stages, not claims about the present VPS release:

| Stage | Representative source history / subsequent local work |
| --- | --- |
| Formal alpha and V1 plan | `a889641`; the earliest formal plan already distinguishes demo, native integration and future acceptance. |
| Citywide solo play | `4043f52`; shared city geography and responsive discovery evolved beyond the original compact/circular alpha. |
| Wallet identity and appearance | `1e1e4a7`, `9d90a25`, `20dc5bd`; native sign-in, avatar/slots and player-approved earned-Aura claims. |
| Direct native market | `c70c648`; actual NFT escrow, not completion of canonical Intents. |
| Real assets and native funding pilots | `08c2646`, `58a833e`, `baa025f`; official character assets, bounded vault/reward contracts, playable templates and worker integration. |
| Progression, tasks, social and recovery | `6e5d669`, `84e6698`, `4149058`, `0ff170b`; native progression, sponsored escrow, moderated notes, durable wallet/worker/backup recovery. |
| Creator foundation in Git | Current HEAD `8604df2`; opt-in lifecycle/community service foundation. |
| Subsequent working-tree delivery | Mounted Community UI/runtime, draft/Back/objective continuity, authored objects, quiet pickups, creator safety, exact adventure receipts, private observation completion, schema/restore compatibility and dialog focus boundaries. These changes are not captured by HEAD alone. |

## 3. Working tree, public runtime and why the latest work is not on VPS

### Local source

At audit start, HEAD was **`8604df2`**. Many later files are modified or untracked,
including runtime modules, UI, tests, documentation and evidence. A checkout of that
commit alone will not contain the latest working version. Preserve the entire
reviewed working tree; do not reapply old transfer patches or run destructive Git
cleanup. The snapshot lists the pre-handoff change inventory and fingerprints of
relevant source/document files, excluding secrets and generated build caches.

No commit, push, deployment, production database migration or chain transaction was
performed by this handoff. A separately reviewed source checkpoint is still needed
for a portable release. Do not label a dirty working tree as exactly matching HEAD.

### Public observations

On 31 October 2026 around 20:37 UTC, unauthenticated HTTPS reads observed:

| Surface | Observed result | What it does not prove |
| --- | --- | --- |
| [Public health](https://questlayer.promptstudio3000.com/api/health) | `status:ok`, `app:QuestLayer`, `version:0.1.0`, `mode:demo`; prepared Plzeň days; worker queue 0/no reported last error at that observation. | Exact Git commit, current schema version, full financial reconciliation or delivery of local features. The returned health body has no new `source`/`schema` metadata. |
| [Public HTML](https://questlayer.promptstudio3000.com/) | Client module `/assets/index-C4wmYYs6.js`, stylesheet `/assets/index-drwoGffj.css`. | Source identity by Git SHA. A hashed asset identifies bytes, not the source commit. |
| Local built HTML | `/assets/index-BZyllovI.js` at audit capture; different from the public module. | A complete release archive or deploy authorization. |
| Public config, preceding review | Demo/testnet labels and demo passkey identity; canonical Intents unset and AI unconfigured. | Absence of every native pilot: several adapters use separate deployment manifests. Generic null config fields are not a complete capability inventory. |
| Creator status, preceding anonymous check | HTTP 401; no login attempted. | Whether creators are enabled on the actual host. Do not infer the flag from this auth response. |

The dedicated web fetcher could not retrieve this domain. Successful direct HTTPS
GETs supplied the observations above; a fetcher failure was not treated as downtime.
No SSH session, authenticated public journey or server filesystem inspection was
performed. The exact active VPS release therefore remains **unverified**.

### Legacy server naming and release gap

The checked-in [service](../deploy/questlayer-hackathon.service) and
[deployment script](../scripts/deploy-vps.sh) now target the renamed installation
(`questlayer-hackathon.service`, `/opt/ps3000/apps/questlayer-hackathon`,
`/var/lib/questlayer-hackathon/questlayer-hackathon.sqlite`, loopback port 7091,
public QuestLayer domain, separately managed private `runtime.env`). The host that was
observed for this review still ran the original installation under its former technical
name (`auratrail.service`, `/opt/ps3000/apps/auratrail`, `/var/lib/auratrail`); the
deployment script refuses such a host until the migration in
[CLOUD-DEVELOPMENT.md](CLOUD-DEVELOPMENT.md) and [VPS-MIGRATION.md](VPS-MIGRATION.md) is done.

These are configuration/historical-record facts, not a fresh SSH confirmation.
Searching only for a `questlayer` application directory/service can miss that
installation. Do not rename paths or create a second fresh service/database merely
to match the new branding.

The latest local implementation was developed/tested without executing a release.
Its changes are still uncommitted. **No failed deployment was observed: the new
release step did not happen.** The last application deployment named by the current
recovery handoff is `0ff170b`; older delivery records name earlier releases. None
of those records proves the exact current public commit.

This is not a conclusion that an alpha update must wait for every V1 milestone.
A scoped alpha release can be evaluated on its own source/configuration/migration
and regression evidence under a separate deployment task. This handoff did not
perform that task or observe an attempted deployment failing.

The deployment script packages selected built/server files; it is not a full
working-tree checkpoint. Backup operations are installed separately by
[install-vps-maintenance.sh](../scripts/install-vps-maintenance.sh). Its copied
helper/timer does not automatically update when only the app release changes.
The checked-in unit/deployer also does not automatically supply a reviewed
`QUESTLAYER_BUILD_ID`. Future deployment review must account for app/schema/source
identity, separately installed operations helpers, configuration and rollback.
This handoff does not run either installer.

Version labels are different domains: package/app `0.1.0` does not identify a
release; `worldPreparation.version` identifies world preparation policy; SQLite
core/module versions identify stored schema; `QUESTLAYER_BUILD_ID` is a source
label, not proof of a clean commit. An audit snapshot's own schemaVersion describes
its document shape. Never substitute one version for another.

## 4. Product and authority boundaries to preserve

| Boundary | Accepted behavior / implementation limit |
| --- | --- |
| Currency | 1 NEAR displays as 1,000 GOLD; no new GOLD token. Demo integer micro-GOLD and native integer yoctoNEAR remain separate. Demo welcome balances/rewards do not establish sustainable native prize budgets. |
| Funding | Current demo/native pilot uses independently conserved coin/zone funds and 50/50 allocation. Only attributable received eligible liquid income can back new rewards; principal, retained player yield, refunds and rollover are not new game income. |
| Creator allocation | Configurable future share, proposed 10%, then50/50 of the remainder: proposed 10/45/45. No creator allocation/routing/round implementation is delivered. Existing reservations cannot be raided to enable it. |
| Access/tier | Contribution-weighted confirmed active stake; Free below 50,000 GOLD, Tier 2 from 50,000, Tier 3 from 100,000. Real increases use epoch rules; arena 30-second maturity is simulation. |
| Withdrawal | Liquidity/epoch-dependent native rights; arena 60 seconds is simulation. Older unlocks must survive a new withdrawal request. Full-exit pilot is not complete partial-exit/NAV/loss accounting. |
| Completion | Personal XP and one shared backed GOLD prize are separate. No quest reservation or faster-gas priority is introduced. Timely accepted evidence must preserve its rights. |
| Appearance | Base originals stay on Base and read-only; native Aura/avatars and demo items have distinct ownership. An Aura is cosmetic, not guaranteed income/resale value. |
| Progression | Account-bound. Avatar transfer does not transfer XP or staking access. Demo publication locks lower available XP/current level, not earned XP, and release cannot repeat a level grant. |
| Creator completion | `observation-v1` is independently reviewed private text. Its receipt explicitly records 0 XP/0 GOLD/no item. It is not physical proof or a native reward policy. |
| Donation / access | Planned donations initially credit 100% to the creator apart from disclosed network cost. Planned paid access is 80/20 creator/treasury with durable entitlement and full failure refund. Neither is implemented. |
| Keys | Wallets sign player operations. Demo WebAuthn is not a native NEAR signing/recovery account. Service attestor/worker roles are not player wallet keys. |
| Privacy | Public receipts can link an account to a known destination even without raw GPS. Private observation/accepted rights stay actor-authorized. Native sponsored-task text is public and cannot be described as private media. |

Proposed timing/weights/percentages/commitments remain versioned decisions. In
particular, QA publication commitments of 200 XP are not production defaults.

## 5. Milestone-by-milestone implementation and remaining work

All rows below preserve the tracker status; none claims a full exit pass. "Pilot"
means the bounded implemented capability, not completion of all financial/product
requirements. Detailed rule/task/journey mappings are in the coverage appendix.

<a id="w00"></a>

### W00 — Reproducible baseline and integration decisions · building

**Implemented:** isolated tests, distinct demo/native configuration, core/optional
schema versions/fingerprints, known-legacy adoption from six actual snapshots,
transactional initialization, future/foreign/corrupt rejection before bootstrap,
source/schema health fields, consistent private SQLite/media backups and restore
preflight. Schema tests include active-WAL/checkpoint races and foreign application
ID rejection. Only historical application ID0 is currently supported.

**Missing:** a clean portable source/configuration checkpoint, proof that the running
release matches it, verified host replacement/offsite restore, complete reconciliation
and decisions for passkeys, canonical market, asset coverage and iOS delivery.
**Own:** database/schema modules, deployment/backup tools, identity/asset integration
owners. **Evidence:** [schema](../output/qa/W00-schema-compatibility/README.md),
[architecture](ARCHITECTURE.md), [latest delivery](../output/qa/W00-W02-W08-next/README.md).

<a id="w01"></a>

### W01 — City worlds and outdoor activities · building

**Implemented:** shared deterministic city/day worlds, six distributed disjoint
Plzeň polygon slots, multiple activities per zone, local-date/DST scheduling,
backed finite publication, idempotent preparation/leases/retries/expiry and operator
preview. H3 supports lookup/chunks and does not create extra city sets.

**Missing:** a connected pedestrian graph and verified trip distances, graph-aware
safety/access review, explicit publication of a safe reduced count with rejection
reasons when six sites cannot be accepted, and operated system-place closures.
Current planner asserts exactly six; separated sampled points are not graph
reachability. Full GEO field acceptance remains open. **Own:** world/planner,
spatial CityPack/calendar and map projections. **Evidence:**
[world worker](WORLD-WORKER.md), [templates](QUEST-TEMPLATES.md),
[spatial requirements](WORLD-GENERATION.md).

<a id="w02"></a>

### W02 — Complete solo experience and interface · building

**Implemented:** wallet-free arena, discovery selection/requirements, inventory and
same-character equipment, scoped Back/objective/draft continuity, authored object
family, quiet confirmed coin feedback, exact durable quest receipts and bounded
archive/recovery. Preview is labelled; explicit equip intent is idempotent and
rechecks current ownership/listing/native reservation. Actor/realm/native round
trips and reconnect invalidate stale authority. Native dialogs now wrap focus.

**Missing:** whole-product visual/input consistency beyond reviewed surfaces,
configured once-only demo level rewards/unlocks, complete repeated physical/native
journeys, named-device/accessibility checks and five-newcomer observations. Existing
browser viewport evidence is not device acceptance. **Own:** App/map/Inventory,
result and navigation hooks, Dialog and shared art. **Evidence:**
[latest App/fixture distinctions](../output/qa/W00-W02-W08-next/README.md),
[results](../output/qa/W02-durable-results/README.md),
[prior UI work](../output/qa/W02-W10-next/README.md).

<a id="w03"></a>

### W03 — Native identity and independent recovery · building

**Implemented:** guest/demo passkey identity; native NEP-413 wallet ownership proof,
wallet linking/re-sign-in restoring the same explorer, session listing/revocation,
fresh proof and cookie rotation; durable unknown wallet-operation recovery.

**Missing:** an actual recoverable NEAR passkey account/provider, real signing and
lost-key revocation on an independent device, bounded delegation and explicit
guest-to-native progression policy. Cookie recovery does not recover a lost wallet
key. **Own:** identity/session modules, wallet adapters and pending native
transactions. **Evidence:** [identity recovery](IDENTITY-RECOVERY.md),
[durable native recovery](DURABLE-NATIVE-RECOVERY.md),
[transaction confirmation](NATIVE-TRANSACTION-CONFIRMATION.md).

<a id="w04"></a>

### W04 — Native avatar, Auras and wardrobe · building

**Implemented:** bounded native avatar/Aura mint/equipment/approval/transfer paths,
player-approved earned-Aura vouchers, two slots, current ownership checks, official
starter art, Base original appearance and model/2D fallbacks. Demo and native
outfits remain explicit domains.

**Missing:** complete ownership pagination/quantity and wearable/model combination
coverage, a reviewed distribution-rights/catalog scope and measured mobile rendering
budgets/fallbacks. A functioning gallery does not establish every original/item
combination. **Own:** collectibles contract/adapters, original ownership/art/models,
Character/Inventory. **Evidence:** [Aura claims](NATIVE-AURA-CLAIMS.md),
[asset catalog](ASSET-CATALOG.md), [peer appearances](PEER-APPEARANCES.md).

<a id="w05"></a>

### W05 — Staking vault and realized game yield · building

**Implemented:** native testnet vault/factory/pool pilot, immutable-beneficiary
keyless position children, fixed contribution per position, pool reads, full-exit
cohorts and recoverable withdrawals; Wallet native/demo states and a conservative
read-only economy model. Demo provides its separate accelerated simulation.

**Missing:** partial exits, active contribution/pool changes, full retained-profit/
NAV/loss/high-water accounting and exceptional callback/migration design; actual
observed realization, beneficiary withdrawal and attributable game-yield receipt
across the full cycle. Historical epoch5399/5402 observations are not current
liquidity. **Own:** vault/factory contracts, pool/vault/economy/exit adapters.
**Evidence:** [staking foundation](NATIVE-STAKING-FOUNDATION.md),
[funded pilot](NATIVE-REWARDS-AND-VAULT.md),
[integration limits](NEAR-INTEGRATION-STATUS.md).

<a id="w06"></a>

### W06 — Gameplay settlement and reconciliation · building

**Implemented:** funded native manifests/batches, receiver-bound receipt replay
protection, durable worker queues/leases, separate treasury buckets, native XP and
level 2–4 entitlements, opt-in foreground native coin collection and retryable
confirmed withdrawals. Demo final checkpoint/award/result commit together. Worker
maintenance can progress existing exits independently of paused reward claims.

**Missing:** richer reviewed native activity/evidence policies, bounded operator
exposure/capacity and public receipt-linkability acceptance; one ordinary physical
player's complete collection→XP→item→equip→cash-withdrawal/restart journey and
realized-yield funding evidence. Do not rewrite issued hashes/targets/rights when
adding future templates. **Own:** game/rewards/collectibles contracts, manifest,
validator/worker/progression/confirmation adapters. **Evidence:**
[native map](NATIVE-GAME-MAP.md), [progression](NATIVE-PROGRESSION.md),
[auto collection](NATIVE-AUTO-COLLECT.md), [recovery](DURABLE-NATIVE-RECOVERY.md).

<a id="w07"></a>

### W07 — Signed Aura market and Intents compatibility · building

**Implemented:** native direct fixed-price NFT escrow, fill/cancel and verified
wallet settlement/recovery, plus a separate server-settled demo market.

**Missing:** selected/pinned canonical verifier/NFT/wNEAR compatibility, signed
orders/nonces/expiry/matching and associated recovery; ordinary two-player device
journeys. Existing direct escrow is not an Intents implementation. Historical
provider/network statements must be refreshed from primary sources when selecting
that adapter. **Own:** market contract, native market/confirmation services and UI.
**Evidence:** [market](NATIVE-MARKET.md), historical project proofs under `output/qa/`.

<a id="w08"></a>

### W08 — Community authoring and XP commitments · building

**Implemented locally, default off:** draft/quote/independent review, stable
revisions, profiles/free follows/feeds, accepted private rights, demo XP lock/
available-level accounting, closure/exact release, safety reports/blocks/suspension.
Reviewed observation requirements, private submission/feedback and independent
trusted completion now atomically produce a durable zero-reward receipt and resolve
the obligation. Actual local browser→CLI review→reload evidence exists.

**Missing:** further playable/spatial templates and authoritative award policy,
native XP commitments, governed abandonment/appeal/escalation/support and full
operational/device acceptance. One pending attempt/three attempts and terminal
independent rejection are disclosed operational rules, not a funded reward policy.
**Own:** creators modules/CLI and CreatorCommunity/client/drafts.
**Evidence:** [completion](../output/qa/W08-completion/README.md),
[latest handoff](RESULTS-AND-COMPLETION-HANDOFF.md),
[closure/restore foundations](CREATOR-INTEGRATION-2026-10-31.md).

<a id="w09"></a>

### W09 — Creator funding, donations and paid access · planned

**Implemented foundation only:** creator identities, free follows, accepted rights,
operation journals and available-XP reads in W08. These do not settle creator money.

**Missing:** future-receipt creator allocation/player routing, bounded rounds/likes/
anti-farming, donations, paid entitlements and exact80/20 settlement, protected
content, cancellation/refunds and native conservation tests. Allocation weights,
caps, deadlines and creator share need reviewed versioned policy; proposed 10% is
not the runtime. **Own:** future treasury/round/entitlement/refund services/contracts
and earnings UI. **Evidence/source of requirements:**
[creator plan](../CREATOR-ECONOMY-PLAN.md); absence must stay explicit in UI/API.

<a id="w10"></a>

### W10 — Social publishing, evidence and moderation · building

**Implemented:** server-hosted text/photo notes with sanitization/consent, bounded
presence, report/block/tombstone controls and local operator audit; native public
profile adapter; independently funded native public-text task escrow with review,
appeal/arbitration/refund/withdrawal pilot; private creator observation text.

**Missing:** complete public-record/SocialDB and pinned-IPFS media delivery/recovery,
private/media sponsored evidence, paid-content storage controls and governed
retention/deletion/support/moderation coverage. A CID/reference input alone is not
pinning or protected delivery. System-place closure is distinct from creator
suspension. **Own:** social/note-media/presence, native profile/tasks, operator tools.
**Evidence:** [notes](MAP-NOTES-UI.md), [social controls](SOCIAL-CONTROLS.md),
[profiles](NATIVE-PROFILES.md), [sponsored escrow](NATIVE-TASK-ESCROW.md),
[creator safety](../output/qa/W08-W10-safety/README.md).

<a id="w11"></a>

### W11 — Bounded AI and operator world controls · planned

**Implemented foundation:** static guide fallback and optional provider request with
an instructional prompt; reusable quest templates and existing publication budgets.

**Missing:** authoritative current world/mode/access/prize grounding, approved
capabilities/proposals, validation snapshots, bounded costs/abuse controls and
reliable deterministic fallback for provider exceptions. A prompt is not an
implemented authorization policy. No AI publishing/financial authority is adopted.
**Own:** guide route and future capability/proposal/review pipeline.
**Evidence:** current `server/index.mjs` guide path and W11 roadmap; provider enablement
in public config was false in the preceding read-only review.

<a id="w12"></a>

### W12 — Device quality and distribution builds · building

**Implemented:** responsive sheets/dialogs and native wallet UI, viewport and
synthetic enlarged-text/reduced-height checks, reduced-motion/camera support in
reviewed paths, deferred map/model loading, quality fallback and a web manifest.

**Missing:** named Safari/iOS and Chrome/Android device acceptance, real OS keyboard/
zoom/text settings, assistive technology, GPS/deep-link/wallet-return and battery/
thermal/performance measurements; service-worker cache/update lifecycle and native
iOS integration/build/distribution work. A manifest alone is not a complete PWA.
**Own:** App/GameMap/media rendering and future distribution adapters.
**Evidence:** actual/synthetic matrices in the latest reports; [UI plan](UI-UX-IMPROVEMENT-PLAN.md).

<a id="w13"></a>

### W13 — Release candidate and city pilot · building

**Implemented foundation:** durable jobs, crash/receipt tests, local whole-flow
journeys, private backup consistency and isolated schema/row/rights-preserving
WAL restore/retry rehearsals.

**Missing:** one integrated multi-day city/testnet runtime, daily resets and at least
two actual native exit cycles, load/incident evidence, host replacement/offsite
restore plus chain/right reconciliation and closure of discovered release defects.
An isolated copied-database rehearsal is not a live disaster restore.
**Own:** cross-system QA, operations/reconciliation and content operators.
**Evidence:** [state recovery](STATE-RECOVERY.md), [durable recovery](DURABLE-NATIVE-RECOVERY.md),
[schema rehearsal](../output/qa/W00-schema-compatibility/README.md).

<a id="w14"></a>

### W14 — Reviewed mainnet and public distribution · planned

**Implemented foundation:** alpha hosting/deploy/rollback tools, testnet pilot
contracts and honest demonstration/provenance material.

**Missing:** independent contract/security/rights review, incident/administrative
policy and funding caps, concrete mainnet release, separately authorized canonical
compatibility proofs, source/competition submission and web/iOS distribution gates.
Mainnet money, app-store acceptance and current competition/provider rules have not
been revalidated here. **Own:** release/security/operations/product and rights owners.
**Evidence:** W14 acceptance, [asset provenance](ASSET-CATALOG.md),
[third-party notices](../THIRD-PARTY-NOTICES.md), [demo guide](HACKATHON-DEMO.md).

## 6. Priority review findings

Priorities below describe engineering handoff/release impact, not a complete
vulnerability severity rating. Source findings are distinguished from observations.

| ID / priority | Finding and evidence | Required next disposition |
| --- | --- | --- |
| R01 / high | Latest source is modified/untracked beyond HEAD 8604df2. Source inventory and Git status establish it. | Review/preserve the full tree and create a separately authorized portable checkpoint; do not hand over only HEAD or delete untracked work. |
| R02 / high | Public HTML differs from local build; public health lacks build/schema fields. Exact active release not identifiable publicly. | Record SSH/read-only active symlink/service/source/config identity before any separately authorized release. Do not equate public 0.1.0 with the local feature set. |
| R03 / high | Documentation/tracker notes lag implementation. Older records still describe409 duplicate claims, title/description-only creators, missing result persistence or no schema boundary. | Use this handoff/latest source as the reconciliation index. Preserve old reports as dated history and add clear supersession links instead of repeating old transfer work. |
| R04 / high | City planner requires six; spatial samples do not establish a connected walk or safe access. Source finding. | Implement bounded safe-count/rejection semantics and routing/closure review; preserve existing issued worlds and six-slot identity. Then record field evidence. |
| R05 / high | Native passkey recovery, full financial lifecycle and canonical signed market are genuine missing mechanisms. Source and owning handoffs. | Choose/implement the missing adapters/accounting; keep pilots labelled. More tests of a full-exit/direct-escrow pilot cannot create partial exits or Intents. |
| R06 / high | Creator completion is implemented but zero-reward/default-off; money flows and operator governance are absent. Runtime explicitly says not-configured. | Adopt reviewed activity/reward/appeal policy before activation and implement W09 conservation/entitlements separately. Do not silently use QA 200 or proposed 10% as defaults. |
| R07 / medium | App deploy and maintenance installs package different artifacts; build ID is not automatically stamped by checked-in release tooling. Source finding in the two scripts. | Review app, operations-helper, schema/config and rollback compatibility together for a future release. No script was run here. |
| R08 / medium | Scoped modern UI coexists with older global CSS defaults, including small text/targets. Source finding, not a rendered audit of every control. | Audit each remaining player surface under DESIGN.md; preserve already reviewed 48px/16px controls, with real-device and assistive-technology evidence. |
| R09 / medium | Guide uses static instructions without full current-state context; provider exceptions can escape the intended fallback path. Source finding. | Implement/test W11 grounding, capability boundaries and deterministic failure behavior before claiming AI-authored gameplay. |
| R10 / medium | Browser/mock evidence and isolated restore do not establish devices, field play, actual financial cycles or full-host recovery. | Execute the explicit J/GEO/device/operations gates with accountable owners and source/config identity. |

## 7. Code ownership and architecture map

| Area | Entry points / durable authority |
| --- | --- |
| Client | `src/main.tsx`, `src/App.tsx`; React/TypeScript/Vite, MapLibre; Character/Ghost/Inventory and scoped native/community panels. |
| Navigation/input | `useAppNavigation`, `app-navigation`, `dialog-history`, `Dialog`, `dialog-focus`; presentation references do not restore consent/GPS/actions. |
| Local drafts/read ordering | `useFormDraft`, `form-draft`, `read-epoch`, scoped objective/result hooks; private text stays actor/realm/form scoped and consent is fresh. |
| HTTP/runtime | `server/index.mjs`; JSON/SSE/static serving, auth/origin/rate guards and composed services. Public health/config differ from authenticated player APIs. |
| Demo game/result authority | `server/database.mjs`, `domain.mjs`, `game.mjs`, `adventure-results.mjs`; SQLite transactions/constraints protect grants, inventory, treasury and receipts. |
| Worlds | `world.mjs`, `world-planner.mjs`, `prepare-worlds.mjs`, `quest-templates.mjs`, `spatial/city-pack.mjs`, `spatial/calendar.mjs`; static data in `server/data/`. |
| Identity | `server/identity/near.mjs`, `sessions.mjs`; demo credentials, NEP-413/public-key checks and revocable sessions, not custody of player secrets. |
| Native adapters | `server/native/`: rewards/worker/manifests, vaults/pool/exit/economy, collectibles/vouchers/progression, market, tasks, social-profile and finalized confirmation/anchor. |
| Contracts | Seven Rust workspace members: game, collectibles, rewards, vault, vault-factory, market, tasks. Contract authority/rights remain separate from demo database state. |
| Creator module | `server/creators/`: runtime/configuration, lifecycle, operations, projections/community, safety, observation policy/completion, player adapters and trusted CLI operator. |
| Notes/media/presence | `social-content.mjs`, `note-media.mjs`, `presence.mjs`; access checks/retirement/sanitization and bounded explicit presence. |
| Appearance | `aavegotchi.mjs`, gotchi item/model/art/appearance adapters and public verified assets; errors are not proof of zero ownership. |
| Compatibility/operations | `schema-compatibility.mjs`, `schema-catalog.mjs`, `schema-known.json`, `deploy/` and the deployment/maintenance scripts. |
| Evidence | `tests/`, `output/qa/`, `public/*proof*.json` and owning handoffs. Testnet accounts/transactions in historical public proofs are not credentials to reuse. |

## 8. API and storage handoff

| Interface | Important contract / limit |
| --- | --- |
| `/api/health`, `/api/config` | Public runtime/configuration observations. Current local health adds source/core/module versions; a supplied build label is not a cryptographic source proof. |
| Session/identity APIs | Guest/demo passkey/native wallet proofs and session recovery. Purpose/origin/account/network/replay bindings matter; authenticated linking does not arbitrarily merge explorers. |
| World/coins/quests | Shared authoritative world; server validates evidence/eligibility/expiry. Final checkpoint and award/result are atomic; retry returns canonical result. |
| `/api/adventure-results` | Authenticated list/detail/quest lookup and explicit viewed acknowledgement; actor/realm/pagination bound. GET never awards, marks viewed or equips. No raw GPS evidence in result records. |
| `/api/equip` | Current demo ownership/listing/native reservation guards. Optional `desiredEquipped:true` is explicit idempotent intent; omitted argument retains old toggle semantics for existing callers. |
| `/api/native/*` | Exact reviewed transactions/quotes, player wallet signatures, finalized verification and current contract authority. Unknown is pending/unknown, not success or permission to sign twice. |
| `/api/creator-community/*` | Optional authenticated player operations and private accepted rights. Public discovery projections exclude drafts/evidence; no privileged review authority comes from a request body. |
| Creator completion | Private GET/POST under quest completion; accepted revision + fresh private consent + bounded evidence/attempts. Independent local CLI review atomically records completion/resolution/journal. |
| Operator CLIs | Trusted local review, resolve, suspension/report review and observation review; role/version/operation ID checks. Operator inputs/audit access can be sensitive; public HTTP does not grant these roles. |
| Social/media | A URL/CID is not authorization. Current visibility/block/retirement checks remain enforced on media delivery and saved accepted rights. |

Demo SQLite is a single-service transactional store with WAL/foreign-key constraints;
PostgreSQL/PostGIS horizontal migration is a future boundary. Schema recognition is
strict: unknown tables/indexes/triggers/versions are not something to work around by
turning off checks. Use an isolated copy and explicit reviewed migration.

Adventure snapshots are immutable award history with a separate current-item
projection. Creator operations, accepted revisions, XP commitments, attempts and
completion receipts preserve rights across daily system-world changes. Native
claims and contract state cannot be rewound by replacing a SQLite backup.

## 9. Safe local start and verification

Requirements: Node24+, npm, existing dependency lockfile. Rust/WASM are needed only
for contract work. Preserve current uncommitted files before preparing a clean
portable environment. The normal README describes `npm ci` / `npm run dev`; normal
startup can load `.env` from its working directory and enable configured workers.
Do not use a real runtime environment just to inspect a UI.

From the repository root, the routine application checks are:

```sh
npm test
npm run build
```

Use the built app with an isolated directory/database to avoid existing state or a
repository `.env` during a disposable local review:

```sh
QUESTLAYER_REPO="$(pwd)"
QUESTLAYER_QA_STATE="$(mktemp -d "${TMPDIR:-/tmp}/questlayer-handoff.XXXXXX")"
(
  cd "$QUESTLAYER_QA_STATE"
  env DATABASE_PATH="$QUESTLAYER_QA_STATE/questlayer-hackathon.sqlite" \
    APP_ORIGIN=http://127.0.0.1:8891 HOST=127.0.0.1 PORT=8891 \
    DISABLE_BACKGROUND_WORKERS=1 DISABLE_NATIVE_ATTESTATIONS=1 \
    AWARD_SIGNER_PATH= REWARD_ATTESTOR_PATH= REWARD_WORKER_KEY_PATH= \
    NEAR_RPC_URL=http://127.0.0.1:9 CREATOR_COMMUNITY_ENABLED=0 \
    node "$QUESTLAYER_REPO/server/index.mjs"
)
```

This deliberately disables native relay/attestations and points RPC reads to a
closed local port. Native UI can report unavailable; it is not a chain-integrated
acceptance environment. Stop only your own test process afterward. The command is
a documented recipe, not a server started by this handoff.

`dev/*.html` pages are labelled component fixtures; some use real components with
fake in-memory APIs. They require the Vite development server and are not deployment
or wallet/GPS proof. The creator fixture's declared scenarios include completion
ready/pending/rejected/terminal/completed and lost/error replies.

### Configuration inventory

| Settings | Purpose / activation rule |
| --- | --- |
| `DATABASE_PATH`, `HOST`, `PORT`, `APP_ORIGIN`, proxy setting | Bind the correct isolated/runtime state and trusted browser origin. Never point a test at the VPS database. |
| `DISABLE_BACKGROUND_WORKERS`, `DISABLE_NATIVE_ATTESTATIONS` | Disable autonomous work and attestation in isolated QA. |
| `NEAR_NETWORK`, RPC, contract/manifests | Explicit native network/bytecode/account identities; config fields alone do not enumerate all manifest-based adapters. |
| `CREATOR_COMMUNITY_ENABLED` | Off unless explicitly1. Disabled startup creates no creator tables; existing commitments still retain their accounting rights. |
| `CREATOR_POLICY_VERSION`, `CREATOR_XP_COMMITMENT` | Required explicit immutable policy/positive integer when enabling; no production default. |
| `CREATOR_MODERATORS`, `CREATOR_COMPLETION_AUTHORITIES` | Explicit trusted role lists; no player-supplied privilege. Local CLI access and operational identity remain trusted. |
| `QUESTLAYER_BUILD_ID` | Optional reviewed label in local health; absent is `development-unrecorded`. Do not use Git HEAD as identity for extra uncommitted code. |
| Worker/attestor paths, provider keys | Service-only private material, managed separately from source. Never copy `.env`, state, credentials or key values into documentation/releases. |

The activation of optional creators, real worker credentials, chain writes or a VPS
release is not part of this handoff. Existing scripts named `deploy-*`, `upgrade-*`,
`prove-*` and worker installers may submit operations; read their scope first and
obtain the appropriate separate task authorization.

## 10. Tests, evidence and what was not verified

Latest saved full run: [484 application tests](../output/qa/W00-W02-W08-next/tests.txt)
and [build](../output/qa/W00-W02-W08-next/build.txt). Both also passed in the
preceding read-only review. `git diff --check` passed. The handoff's final checks
validate local links, counts, traceability and metadata; documentation-only edits
do not require another financial simulation or chain proof.

| Evidence family | Established scope | Important limit |
| --- | --- | --- |
| Application suite | Economy conservation, concurrency/replay, owner/privacy isolation, schema/restore, contracts/adapters through controlled fixtures and local HTTP where specified. | Passing484 tests is not a V1 percentage, physical proof, provider SLA or mainnet review. |
| Latest actual App host | Committed arena result recovered after unobserved response/restart, exact receipt, preview/equip/map/reload and a separate zero-item visit. | Synthetic actor and simulated arena evidence, not a physical walk or native reward conversion. |
| Actual creator host | Browser draft/Back/reload/reset consent, explicit submit, independent CLI accept/retry and same durable zero-reward receipt after reload. | Explicit QA policy, synthetic identities, no creator monetary reward. |
| Browser fixtures | Scope/reconnect races, failure/retry, enlarged text, rejected/terminal states and native-dialog focus boundaries. | Fake transport; distinguish from actual HTTP/chain authority. |
| Earlier native pilots | Project-owned testnet transactions and recorded finalized/ownership/withdrawal/task flows in owning reports. | Historical snapshots; do not treat old epochs, balances or network compatibility as current. No new native proof was run for the handoff. |
| Backup/restore | Known-schema and all-business-row/rights preservation in isolated copies, WAL races, replay/rollback and explicit unverified source/config cases. | No live host replacement, offsite recovery or full native-right reconciliation. |
| Mobile/accessibility | Required browser widths, short landscape, reduced-height focus and synthetic enlarged text for reviewed surfaces; focus wrap/return. | Physical iOS/Android, OS keyboard/zoom/text, assistive technology, GPS/wallet return, battery/thermal and newcomer/field acceptance remain open. |

The latest report documents residual QA-browser cleanup limits from unavailable
Chrome control and an internal IAB error tab. They concern synthetic test pages;
no real user credentials/funds were used. Do not claim full browser-cookie/device
cleanup from a stopped test server alone.

## 11. Next execution packages

These are actionable priorities, not authorization to deploy, choose financial
amounts or sign transactions. Preserve existing receipts, worlds and participant
rights throughout.

1. **Portable source and release identity — W00.** Review all current changes,
   retain untracked source/tests/docs, prepare an authorized checkpoint and identify
   build/schema/public configuration and operator ownership. Audit the actual active
   VPS release read-only if that task is authorized. Deliver a reproducible source
   inventory and reviewed migration/rollback plan, not a blind fresh DB/service.
2. **Walkable city publication — W01 with W02.** Implement routing/access evidence,
   safe-count/rejection diagnostics and operated system-place closures; retain
   deterministic slots and already issued data. Prove graph/barrier/shortfall/reset
   behavior and field-check several sectors. Complete ordinary full journeys and
   capture newcomer/device observations alongside it.
3. **Independent native identity — W03/W04.** Select the actual account/passkey
   recovery model, prove signing/recovery/revocation on two supported devices and
   implement explicit guest linking/migration. Complete bounded original ownership/
   model coverage without selling original NFTs or moving demo balances to native.
4. **Reviewed creator activation and W09 groundwork — W08/W10/W09.** Define the
   operating owner, abandonment/appeal/support/retention and activity validation/
   award policy. Extend the existing observation receipt path, then implement bounded
   native funding, rounds, donations/paid rights/refunds under explicit versions.
   Keep the unconfigured/default-off boundary until its own gates pass.
5. **Complete native finance and market — W05/W06/W07.** Implement missing financial
   mechanisms and separately observe actual exits/received yield/settlement before
   tuning prizes. Select/prove signed-order compatibility under an explicit network
   review; retain direct escrow as accurately labelled existing functionality.
6. **Grounded guide, social storage and distribution — W10/W11/W12.** Add actual
   storage/retention/failure controls and capability-bounded guide/content tools;
   deterministic fallback remains playable. Implement PWA/iOS and device budgets
   only with corresponding account/location/wallet acceptance.
7. **Integrated pilot and release — W13/W14.** Execute all J/GEO/device/restore
   scenarios across days/financial cycles, reconcile rights, resolve defects and
   perform independent source/contracts/rights review. Web alpha updates, mainnet
   rollout and iOS/store distribution are separate scoped decisions.

Useful parallel boundaries after the source checkpoint are city/world+safety,
identity/device recovery, and creator validation/operations. Native financial work
needs its explicit policy/fresh-state gates; it must not infer defaults from the
ability to run a local simulator. All streams integrate through the same confirmed
player action/result/recovery scenario rather than isolated feature demos.

## 12. Receiving engineer checklist

- [ ] Preserve the actual working tree; HEAD alone is incomplete. Review the snapshot inventory.
- [ ] Read the specification, roadmap, rules and this handoff; old transfer instructions are history.
- [ ] Distinguish local/source, verification and deployment for the selected package.
- [ ] Start isolated QA with workers/attestations disabled and no private runtime environment.
- [ ] Reuse existing result/identity/creator/worker primitives and test their failure/ownership boundaries.
- [ ] Identify the policy/operations decisions needed; do not invent reward, key custody or refund rules.
- [ ] For UI work, read DESIGN.md and record actual states, targets, contrast and hardware limits.
- [ ] Record evidence by task/rule/journey and update only genuinely demonstrated acceptance.
- [ ] Treat deployment, native transactions, migrations on live state and source publication as separate authorized actions.
- [ ] Hand over source/config identity, unresolved rights and next concrete acceptance step.

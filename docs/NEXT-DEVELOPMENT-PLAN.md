# Overall roadmap audit and next development

31 October 2026. Source/read-only audit after the W02/W08/W10 parallel delivery.
The coordinator and three reviewers compared the overall plan with owning source
and retained evidence. No application code, database, deployment, live RPC or test
run was changed by this audit. At the time of this historical audit, the recorded local application suite was
438/438 with a passing build. The subsequent integrated delivery passed 484/484;
use the [whole-project handoff](PROJECT-REVIEW-AND-HANDOFF.md) for current reconciliation.

Execution update: the approved A/B/C streams below have been [implemented locally](RESULTS-AND-COMPLETION-HANDOFF.md), with [combined verification](../output/qa/W00-W02-W08-next/README.md). The original stream descriptions remain acceptance/history context; do not restart them as missing work.

This document records the source audit and remaining execution scope. [ROADMAP.md](../ROADMAP.md) still owns
the complete V1 scope and acceptance gates. Historical handoffs and old test/network
observations must not be replayed as current setup instructions or live state.

## What is already delivered

- Shared city/day worlds, six distributed polygon slots, schedules, generation
  workers and four implemented demo activity templates. Native v1 keeps its existing
  ordered-checkpoint policy; future demo templates do not silently upgrade it.
- Wallet-free solo demo, server-confirmed quest rewards and equipment; objective
  continuity, browser Back/dialog handling, scoped form drafts, shared authored
  object art and calm confirmed pickup summaries.
- Native wallet authentication/session recovery, pending transaction recovery,
  testnet avatar/Aura/equipment and progression paths, direct fixed-price NFT
  escrow, staking-vault and funded reward/worker pilots.
- Optional creator publication/revisions, profiles/follows, exact demo XP locks,
  accepted-revision rights, closure/release, private reports, bilateral blocks and
  independently operated suspension. It remains disabled by default.
- Sanitized server-hosted note media, visibility/block enforcement, operator audit,
  private backup tooling and isolated WAL recovery/retry rehearsals.

These components should be extended and connected. U08 artwork, Back/draft handling,
creator administration and wallet-session recovery do not need to be rebuilt.

## Remaining scope, classified

| Milestones | Missing implementation/design | Separate proof or operational gate |
| --- | --- | --- |
| W00 · reproducibility and schema | Core/module versions, known-legacy adoption, preflight and source labels are implemented. Subsequent reviewed migrations and a reproducible source/configuration checkpoint remain. | Reproducible integration checkpoint, replacement-host/offsite restore and migration/reconciliation rehearsal. Current feature work remains in the working tree. |
| W01 · city/world | Connected pedestrian graph/routing adapter, rejection diagnostics and safe reduced-count publication when six acceptable sites cannot be produced. Operator closure of unsafe system places remains separate from creator suspension. | Field review of access, exclusions, pedestrian transfers and the six city sectors. OSM proximity is not verified public access or physical safety. |
| W02 · solo loop | Durable exact demo results, archive/recovery and current-owned equip are implemented and locally exercised. Complete native/physical journeys and configured once-only demo level rewards still require work. | Full repeated player journeys, screen readers, real phones and observations of five newcomers. Existing browser screenshots cover narrower scenarios. |
| W03 · native identity | Actual native passkey account creation/signing/recovery and bounded gameplay delegation; explicit guest-to-native progression policy. Current WebAuthn is demo identity. | Reviewed account/provider choice, independent-device recovery and compromised-key revocation; ordinary wallet return on supported devices. |
| W04 · wardrobe | Complete original-ownership pagination/coverage and supported modular equipment combinations. The UI gallery does not remove the backend's bounded ownership scope. | Asset/catalog/trademark rights, difficult outfit combinations and measured device/model fallback budgets. |
| W05 · staking/yield | Partial exits, contribution/pool changes, retained-profit/NAV tier accounting and exceptional callback recovery require reviewed accounting/design and implementation. Existing pilot uses fixed contribution/full exit. | Observe actual pool release, beneficiary withdrawal and attributable received game yield over real epochs. Saved epoch 5399/5402 observations are historical, not current state. |
| W06 · settlement | Richer versioned native quest/evidence policies, bounded payout exposure and privacy/abuse controls. Preserve already published hashes/targets/rights. | Physical collection, full restart/withdrawal journeys, realized-yield funding and independent review of the evidence/oracle trust boundary. |
| W07 · market | Pinned verifier/wNEAR compatibility, signed off-chain order/nonce/expiry flow and selected Intents integration. Current direct escrow is implemented. | Two ordinary players' device/wallet journeys and separately authorized canonical production compatibility. No new claim about current external network support is made by this audit. |
| W08 · playable creators | Reviewed private observation requirements, submission, independent review and durable zero-reward completion are implemented. Further spatial templates, reviewed reward settlement and native XP commitments remain. | Private observation has actual independent local completion proof. Production policy/governance, abandonment/appeal/escalation and physical/native device journeys remain. |
| W09 · creator economy | Creator allocation/routing/rounds, donations, paid entitlements, exact 80/20 access settlement, protected delivery and refunds. This is planned work. | Choose versioned allocation/weights/caps/deadlines, conserve old obligations and prove native settlement. Proposed 10% creator allocation and QA 200 XP are not production defaults. |
| W10 · social/evidence | Creator public-record/storage adapters, IPFS pinning/availability and private sponsored evidence/media. A native SocialDB profile adapter already exists. | Retention/deletion/support/appeal rules, independent dispute operations, provider recovery and real timeout/failure evidence. Native task evidence is currently deliberately public text. |
| W11 · bounded guide/AI | Ground the guide in current world/mode/access/prize state; deterministic fallback on provider exceptions. Approved proposal/review/publication controls, validation snapshots and cost/capability limits. | Reviewed content operations and adversarial prompts. A static model instruction cannot establish authority or physical truth. |
| W12 · devices/distribution | Service-worker cache/update workflow and native iOS account/wallet/location integration. A web manifest exists; it is not the complete PWA/iOS implementation. | Named Safari/iOS and Chrome/Android hardware, virtual keyboard/OS text, screen readers, GPS, wallet return, battery/thermal/performance and current distribution review. |
| W13–W14 · pilot/release | Close defects found by complete pilot/recovery work; source/schema/config reproducibility and reviewed operations/release artifacts. | Multi-day city pilot, at least two actual exit cycles, full-host/offsite restore, independent security/rights review, support ownership and separately reviewed web/mainnet/iOS release. |

## Historical source findings before the subsequent implementation

Findings 1/2 and the database portion of finding 5 below were addressed by the
[results/completion/schema delivery](RESULTS-AND-COMPLETION-HANDOFF.md). They are
retained as the original audit rationale, not current missing-code instructions.
City routing/safe shortfalls, native identity/finance and guide grounding remain
open as reconciled in the whole-project handoff.


1. **Demo completion is not a replayable result receipt.**
   [`server/game.mjs`](../server/game.mjs) commits quest/player/time and records XP
   plus item name in history; a repeated completion returns 409. It does not retain
   the stable awarded-item result needed for a replay-safe result read.
   [`src/App.tsx`](../src/App.tsx) keeps the discovery/equip offer in component state.
   Correct balances and inventory therefore coexist with a missing resumed result
   journey after a committed response is lost.
2. **Creator admission is implemented; gameplay validation is not.**
   [`lifecycle.mjs`](../server/creators/lifecycle.mjs) accepts only title/description,
   stores participation as open/resolved, and permits a trusted independent actor
   to resolve it using a syntactic reference. It contains no structured evidence
   validator or activity award transaction. [`runtime.mjs`](../server/creators/runtime.mjs)
   reports rewards as unconfigured. Preserve that disclosure until implemented.
3. **City safety fallback is incomplete code.**
   [`city-pack.mjs`](../server/spatial/city-pack.mjs) picks separated points from
   bounded path data; it does not prove graph reachability. [`world-planner.mjs`](../server/world-planner.mjs)
   asserts exactly six zones. A future safe-candidate shortfall needs an explicit
   bounded result, with no seventh slot, unsafe substitute or changed issued world.
4. **Native identity and finance contain genuine missing mechanisms.**
   [`IDENTITY-RECOVERY.md`](IDENTITY-RECOVERY.md) accurately distinguishes wallet
   reauthentication from native passkey/key recovery. [`vault/src/lib.rs`](../contracts/vault/src/lib.rs)
   implements the bounded full-exit/fixed-contribution pilot. [`market/src/lib.rs`](../contracts/market/src/lib.rs)
   implements direct escrow. Network tests alone cannot add their missing features.
5. **Guide grounding and deployment/version boundaries need code.**
   The guide route in [`server/index.mjs`](../server/index.mjs) sends the question
   and static prompt, without current manifest state. [`database.mjs`](../server/database.mjs)
   applies startup schema changes without an explicit compatibility/version gate.
   The existing restore tools are a useful foundation, not a full release boundary.

## Recommended next parallel delivery

Do a short shared contract/design pass, then keep three ownership streams. This records the original proposal, now delivered as the bounded local slice linked above; the audit itself introduced no runtime changes.

### A · Durable adventure result to current-owned equipment

Add a server-backed result identity/read model inside the existing atomic claim
transition. Preserve exact awarded XP/GOLD/item identity and realm/owner. The App
can resume inspection after a lost response or reload without another grant or
automatic celebration/equip. A historical result must recheck current ownership,
reservation and native/demo boundaries before offering an item action.

Acceptance: lost-after-commit response, duplicate retry, page reload, no-item chest,
another player's shared prize, sold/reserved/transferred item and actor/realm change.
The same result remains inspectable, balances never change twice, and equipment
still requires a deliberate authorized action. Native receipt authority stays separate.

### B · Creator participation to validated completion

Reuse the existing template catalog/atomic settlement patterns. Bind reviewed
requirements and place/validation-policy snapshots to the accepted revision. Add
authenticated progress/evidence, independent validation and a durable result that
composes with obligation resolution transactionally or through a reconciled workflow.
The author cannot select arbitrary rewards or certify their own fund-generating activity.

Acceptance: one solo participant completes an allowed activity; retries/reordered
steps/evidence cannot repeat settlement; closure/suspension/block/daily reset/restore
preserve timely progress and obligations. Rewards stay explicitly unavailable until
the system-controlled policy and funding are adopted. Coordinate checks remain
distinct from proof of physical presence. Define abandonment/escalation semantics
before enabling a public operational promise.

### C · Versioned data upgrade and restore compatibility

Record core/optional-module schema versions and source/config compatibility. Support
known legacy snapshots transactionally; reject unknown future/foreign schemas before
seeding or rewriting them. Keep the optional creator module disabled without creating
its tables. Give streams A/B explicit additive initializer/version ownership so they
do not each invent a migration mechanism or nested transaction model.

Acceptance: interrupted upgrade rolls back; restored balances/items/receipts/accepted
obligations/privacy state survive; retries grant nothing twice; old supported and
current snapshots reopen correctly; unsupported snapshots fail without mutation.

The coordinator owns shared App/result integration and end-to-end checks. Stream A
owns core result writes/reads, B owns creator validation surfaces/services, C owns
schema compatibility and restoration. Agree the result envelope and transaction
boundaries first; final integration of B depends on those contracts.

## Work that proceeds beside the code batch

- Prepare and run five-newcomer/real-device/field journeys against one identified
  candidate build. Record failures rather than deriving completion from test count.
- Read current pool/epoch/liquidity state before any future financial action, then
  obtain the missing real exit/yield/withdrawal evidence. This audit ran no RPC.
- Evaluate the supported native passkey/account recovery capability using official
  provider evidence before adopting a dependency or promising independent recovery.
- Queue the substantial W01 topology/shortfall/closure and W11 grounded-guide blocks
  next. Preserve future-day versioning and existing publication commitments.
- Start W09 financial delivery after its validation/funding/closure dependencies and
  unresolved versioned policies are concrete. Accepted 80/20 access rules, configurable
  creator allocation and direct-donation policy are different mechanisms.

## Tracking correction

The machine tracker correctly keeps full milestones open, but broad building status
does not distinguish delivered local code from missing implementation and unperformed
acceptance. Use the matrix above when assigning work. Older 343/408 test summaries,
unmounted-adapter instructions and saved epoch/deployment observations remain history.
The latest retained suite is [438 tests](../output/qa/W02-W10-next/tests.txt) with
[build evidence](../output/qa/W02-W10-next/build.txt). Production state was not inspected.
No deployment, mainnet activity, asset/provider adoption or full milestone completion
is authorized or implied by this planning audit.

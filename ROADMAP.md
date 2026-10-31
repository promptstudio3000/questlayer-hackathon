# QuestLayer implementation roadmap

Updated 31 October 2026. This is the execution plan from the current alpha to a complete V1. It combines [game rules](docs/GAME-RULES.md), [city generation](docs/WORLD-GENERATION.md), [design direction](DESIGN.md), the [UI backlog](docs/UI-UX-IMPROVEMENT-PLAN.md), [native product requirements](IMPLEMENTATION-PLAN.md) and [creator economics](CREATOR-ECONOMY-PLAN.md).

The next priority is a convincing exploration game across Plzeň: six distinct zones, real walking, understandable objectives and a complete discovery/equipment loop. Native finance, social features and creator payments must connect to that same experience rather than remain separate demonstrations.

The public deployment is an **alpha demonstration with native testnet pilots**. The latest implementation adds optional native coin collection and an independent sponsored-task escrow; 299 application tests pass; unchanged contracts last passed 100 Rust tests, including 31 tests for the new task contract. Three project-owned synthetic testnet task flows have settled and withdrawn a total 0.003 test NEAR. These are useful evidence, not completion of the milestones below or proof of physical gameplay. The [delivery record](docs/DELIVERY-2026-10-31.md), [playability evidence](output/qa/W02-playability/README.md), [native progression evidence](output/qa/W03-W06-native-progression/README.md), [task and collection slice evidence](output/qa/W08-W10-native-tasks/README.md) and [current V1 gap register](docs/V1-REMAINING.md) distinguish implementation, contract deployment, application deployment and remaining gates. Implementation status is tracked in [docs/roadmap.json](docs/roadmap.json).

Implementation update, 31 October: W00, W01, W02, W03, W04, W05, W06, W07, W08, W10, W12 and W13 are **building**. W08 has Community navigation and independent sponsored publication, not creator XP commitments or a complete authoring platform. W10 has a bounded public-text task lifecycle plus public-note reports, blocks and local operator moderation; private/photo task evidence and operational coverage remain unfinished. The citywide alpha and its evidence are recorded in [the overnight log](docs/OVERNIGHT-2026-10-31.md). No complete milestone exit gate has passed yet; the machine-readable tracker records partial work without converting disconnected native proofs into completed integration.

## What complete V1 means

V1 is complete when a new player can join through a native NEAR wallet or supported passkey, recover their account independently, walk through a supported city, collect funded rewards, complete several designed kinds of solo quest, own and customize an avatar, trade an Aura, participate in creator content and understand every pending or failed operation. Their profile, items, entitlements and financial rights survive reconnects, resets and service failures.

The full scope includes:

- Browser/PWA play on desktop and physical iOS/Android devices, with an iOS application distribution track.
- Six non-overlapping daily system zones across Plzeň, varied shapes/windows/content, outdoor map context and frequent shared street coins.
- Native account/profile/avatar ownership, optional read-only Base Aavegotchi appearance and a documented licensed 3D wardrobe catalog with device fallbacks.
- Native staking-pool choice, contribution and tier accounting, realized-yield treasury funding, actual rewards and recoverable withdrawals.
- A real fixed-price Aura market using the selected Intents protocol integration, including escrow, cancellation, matching and withdrawals.
- Community profiles/follows, authoring, refundable XP commitments, moderation, sponsored tasks, donations, paid access and bounded creator-fund distributions.
- Public notes and media through the planned social/storage adapters, explicitly optional GPS/presence and protected paid/private content.
- A bounded AI guide/content-authoring capability, operational controls, abuse handling, audited financial contracts, tested recovery and a measured release pilot.

The web mainnet release and App Store release have separate completion gates. A web release does not imply store approval. Optional later experiments are listed at the end and do not prevent finishing this finite V1.

## Current gaps and immediate decisions

| Area | Current alpha | Required final behavior |
| --- | --- | --- |
| World scale | One city/day plan, six citywide slots and chunked reads | One city/day world with six citywide slots and chunked reads |
| Geometry | Disjoint varied polygons across six sectors; field review pending | Reviewed, varied polygons with disjoint boundaries and real pedestrian separation |
| Quest depth | Visit/trail/chest activities; reusable return trails for new unprepared days from Nov 2; native v1 remains three stops | Several designed choices, explicit requirements and meaningful internal movement |
| Interface | One selected activity, compact native walks, separate wallet sections and Community; deeper collection/forms/device review remains | Complete discovery, result, equipment, navigation and failure states under DESIGN.md |
| Identity | Cookie/demo passkey and NEAR wallet message sign-in; no native passkey recovery proof | Real NEAR account creation/sign-in, user-controlled recovery and delegated gameplay capabilities |
| Ownership | Real testnet avatar/Aura mint/equip/trade paths; demo progression still separate | Gameplay mints, equips and transfers the actual native assets |
| Staking | Native immutable-beneficiary vault/factory pilot, validator deposits and epoch-bound full exits; no completed live yield cycle | Confirmed native pool positions, real epoch maturity and liquidity-aware exits |
| Rewards | Receiver-bound receipts, native XP/level 2–4 entitlements and explicit opt-in foreground GPS coin collection; field and recovery gates remain | Live gameplay receipts settle to native balances with bounded oracle permissions |
| Market | Native fixed-price NFT escrow plus demo market; canonical Intents path unresolved | Signed orders plus native NFT/wNEAR settlement and retryable recovery |
| Creators | Community navigation and independent native sponsored publication, with a separate Demo path; no creator XP/follows/access/fund integration | Full authoring, XP lifecycle, social discovery and conserved creator income |
| Social | Server notes/images, optional presence and a bounded native public-text task review/appeal/refund pilot | Storage adapters, public consent, private/media evidence, block/report and privacy controls |
| Operations | Durable workers, bounded reconciliation, private backup/replay rehearsal and native economy observations; full-host restore pending | Versioned migrations, multiple-worker safety, reconciliation, restore, monitoring and reviewed release process |

Do not tune real-value rewards from the current demonstration's 120,000 GOLD welcome credit or fixed 1,000/5,000 GOLD quest examples. They are not evidence that staking yield sustains those prizes. W05 and W09 establish affordable publication policies from actual liquid income.

## How implementation progresses

Each milestone delivers a whole scenario: an actor, an action, an authoritative result, visible feedback and failure recovery. Close it only after its acceptance evidence is attached. A component, contract deployment, screenshot, feature flag or successful build alone is insufficient.

Use `planned → building → verifying → passed`. A failed gate returns to building. Record external dependencies with an owner and next action, rather than marking an unimplemented feature complete. Keep simulation, experimental testnet and production labels until the matching integration is proved.

Before a change: read the current milestone, relevant rule IDs, DESIGN.md and the owning code. Preserve the accepted economy. Compare compositions before changing visual hierarchy. After a change: exercise the full scenario and its adverse states, record evidence and update the tracker. Do not add unrelated polish or another integration to avoid finishing a failed gate.

Planning sizes below indicate relative scope: **S** is a bounded setup/spike, **M** is several connected changes, **L** spans multiple workflows or contracts. They are not delivery dates. Provider capability, asset permissions, security review and store decisions must be resolved before promising a final calendar date.

## Dependencies and release stages

| ID | Milestone | Depends on | Size | Stage reached when passed |
| --- | --- | --- | --- | --- |
| W00 | Reproducible baseline and integration decisions | None | M | Reliable development foundation |
| W01 | City worlds and designed outdoor activities | W00 | L | Credible physical exploration foundation |
| W02 | Complete solo experience and interface | W01 | L | Playable game alpha |
| W03 | Native identity and independent recovery | W00 | L | Real account ownership |
| W04 | Native avatar, Auras and wardrobe | W02, W03 | L | Native collectible loop |
| W05 | Staking vault and realized game yield | W03 | L | Verified financial foundation |
| W06 | Gameplay settlement and reconciliation | W01, W02, W04, W05 | L | Connected native testnet alpha |
| W07 | Signed Aura market and Intents compatibility | W04, W06 | L | Tested native market path |
| W08 | Community, authoring and XP commitments | W02, W03 | L | Usable creator platform |
| W09 | Creator funds, donations and paid access | W05, W06, W08 | L | Complete creator economy |
| W10 | Social publishing, evidence and moderation | W03, W08 | L | Operable public content |
| W11 | Bounded AI and operator world controls | W01, W06, W10 | M | Governed content operations |
| W12 | Device quality and distribution builds | W02, W03, W04, W07, W09, W10, W11 | L | Device-tested product |
| W13 | Complete release candidate and city pilot | W01–W12 | L | Full testnet release candidate |
| W14 | Reviewed mainnet and public distribution | W13 | L | Production V1 and separately tracked iOS release |

Identity capability spikes and financial specifications can proceed while the game loop is refined. Device checks start with W02; W12 is their complete cross-feature gate. Security review starts during contract design, not after all code is written. The ordered milestone list is not a reason to postpone those checks.

## Reproducible baseline and integration decisions

**W00. Owners:** repository/build configuration, `server/`, `contracts/`, deployment tooling and architecture records. **Rules:** D27–D30, I01–I03, I07, I09–I10, O08–O09.

Work:

1. Capture the actual source baseline, dependency versions, deployed release, contract code hashes and database schema. Establish real version-control history without rewriting development dates. Preserve all existing player state and unrelated project documentation.
2. Break the largest runtime responsibilities into testable boundaries when touched: world generation, progression, funding, evidence, identity, market, social and presentation. Keep one model for each right and balance; avoid a parallel demo-shaped production economy.
3. Specify PostgreSQL/PostGIS migration and worker/outbox semantics. Keep SQLite as a bounded single-service development adapter where useful; prove migration and restore before production concurrency depends on the new database.
4. Add explicit environment configuration for arena, physical testnet and production. Validate contract/network identity at startup and before settlement. Deployment/version information must identify what is actually running.
5. Resolve four early capability spikes: native passkey account/recovery, licensed modular model coverage, an NFT/wNEAR Intents exchange, and iOS wallet/passkey/NFT distribution constraints. Record chosen packages/contracts, pinned versions, trust, costs, fallback and unresolved dependencies.
6. Define test fixtures, browser/device evidence folders and contract sandbox tests. Ensure no player or operator signing secrets enter commits, logs, archives or public proofs.

**Exit scenario:** a clean checkout can build, run isolated tests, create a local/sandbox world, deploy the intended testnet artifacts and identify its source/schema/network. A deliberately wrong contract/network or unsafe migration fails before money or state is changed. Each spike has a concrete result and a next implementation decision.

## City worlds and designed outdoor activities

**W01. Owners:** `server/world.mjs`, new spatial/content/worker adapters, world API, `src/types.ts`, `src/GameMap.tsx`. **Rules:** G01–G14, E09–E16. Full requirements: [WORLD-GENERATION.md](docs/WORLD-GENERATION.md).

Work:

1. Create a reviewed Plzeň CityPack with its boundary, six coverage sectors, candidate areas, exclusions and pedestrian graph. Keep a compact remote tutorial arena as a separate mode.
2. Implement one city/day manifest; make H3 a lookup/chunk index. Migrate identity, queries and allocations so new cell activation does not create six more zones or more funding.
3. Replace center/radius footprints with valid connected polygons. Enforce pairwise/cross-boundary gaps, shape diversity, public entry/target reachability and city spread before publication.
4. Design zone content templates: landmark discovery, a small ordered walking expedition, a reviewed geocaching-style interaction and a cosmetic chest. Implement multiple choices inside zones rather than renamed copies of a visit. Keep larger shared prizes competitive through scarcity, not mandatory opponents.
5. Add staggered all-day/three-hour/one-hour schedules, daily candidate rotation and deterministic content/rarity/supply selection. Distinguish zone availability from a player reservation; preserve timely evidence.
6. Build durable pre-generation, midnight activation, expiry and retry jobs with bounded fallbacks and city/day budgets. Add coins along reviewed public routes between destinations, with canonical IDs across chunks and finite allocations.
7. Add truthful walking-distance availability and outdoor context layers such as hiking/cycle routes where the provider/data license supports them. Cycling context does not turn every road into an eligible walking spawn.
8. Add an operator preview showing footprints, entries, rejected candidates, route connections, schedule and allocated funds. Preview has no economic side effect.

**Exit scenario:** six suitable sites span Plzeň, differ in shape, have no overlap and cannot be claimed from one spot. Different users/cells see one shared plan. GEO01–GEO12 pass, including at least 365 simulated dates, neighboring packs, DST, worker races, missing data and real walking checks in several sectors. Insufficient safe candidates produce an honest shortfall instead of a downtown cluster.

## Complete solo experience and interface

**W02. Owners:** Explore, navigation, sheets/dialogs, claim/result state, HUD, map/camera and shared appearance components. **Rules:** D01–D31, G05, G12, G14. **UI packages:** U01–U07, minimum U08/U09, U11/U12 and the first U13 observation.

Work:

1. Adopt reviewed tokens, readable typography, 48px touch targets, visible focus and stable layer ownership. Preserve readable network/value disclosures and map attribution.
2. Compare compositions for a recommended objective, alternative discoveries and selected detail. Implement collapsed/browse/detail/result sheet states with buttons and working gestures, dynamic camera padding and Back behavior.
3. Show the actual requirement: open later, too far, GPS uncertain, tier locked, ready, pending, complete, shared prize claimed, expired or failed. A zero-item visit must not advertise an item. Clarify straight-line versus routed distance.
4. Build one durable discovery → confirmed result → preview → equip → same map character flow. A response determines the reward; client optimism cannot mint success. A retry recovers its receipt without replaying a reveal.
5. Use a coherent coin/chest/discovery/Aura art family, a quiet pickup counter and an expressive but readable character. Preserve selection and actual progress through panel changes and reconnects. Define the supported XP curve and a once-only reward/unlock for each supported level; publication locks and returns must never replay those grants.
6. Make dialogs own input, retain form values on failure, support screen readers, keyboard, enlarged text and reduced-motion camera behavior. Add useful offline/empty/unsupported-area responses.

**Exit scenario:** a newcomer with no wallet and no other players finishes the full arena loop, understands the result, equips an Aura and finds the next available action. The physical-mode equivalent uses real evidence and an honest trip distance. Test conflicting claims, missing GPS/assets, offline retry, expiry and stale inventory. Record observations from five newcomers without presenting them as statistically proven retention.

## Native identity and independent recovery

**W03. Owners:** onboarding, identity/session service, native wallet/passkey adapter and player profile contract. **Rules:** I01–I04, I08, I12–I13, E02, E18.

Work:

1. Put native NEAR sign-in and supported passkey account creation on the primary path; keep the no-deposit arena useful. EVM linking/sign-in is an optional identity/cosmetic route, not a second game chain.
2. Select an audited/reviewable account implementation through the W00 spike. Prove that its passkey signs actual NEAR-authorized operations. Existing WebAuthn demo identity is not that proof.
3. Define account linking, duplicate identities, session expiry, lost-cookie recovery and guest-to-native migration. Preserve legitimate XP/items exactly once; never migrate demo GOLD into real NEAR or create multiple welcome payouts.
4. Provide user-controlled recovery through a supported second device/key/provider and test revocation. Non-exportable passkeys cannot produce a genuine downloadable seed; do not invent one.
5. Store public profile/progression references on the intended contract, while keeping private evidence and exact movement off chain. Bound gameplay delegations/relayers by receiver, methods, gas, duration and revocation. Neither a service key nor an ordinary game session can sign arbitrary transfers or add wallet keys.

**Exit scenario:** create a real testnet account, perform a signed game/profile operation, recover from an independently provisioned supported device, revoke the old capability and retain the same profile/assets. Wrong-origin, replay, wrong-network, expired delegation and conflicting-link tests fail safely. The server's stored data cannot reconstruct a player signing key.

## Native avatar Auras and wardrobe

**W04. Owners:** collectible contracts, mint/equipment service, shared character renderer, Inventory and asset catalog. **Rules:** D07–D08, D14, D16, D18–D19, E17–E18, I05–I08, I13. **UI packages:** U04, U07–U09 and relevant U14 work.

Work:

1. Mint the new player's actual native avatar NFT and connect Aura awards to real capped editions. Keep progression account-bound and gameplay rights separate from selling an avatar appearance.
2. Make both above/below slots authoritative. Equip, unequip, approval, transfer, escrow and return paths must clear or revalidate equipment consistently. The existing standalone contract proof is not sufficient evidence of two-slot gameplay.
3. Build one appearance model for map, wardrobe, profile and reward preview. Preserve the selected original SVG/traits and equipment while assets load or ownership refreshes.
4. Complete Base read-only ownership and loose/nested/equipped wardrobe coverage, with pagination, cache/staleness semantics and ownership changes. Support users without an original through the independent native avatar.
5. Inventory the upstream model/texture/animation catalog and rights. Load approved assets on demand from stable usable origins, with hashes, cache policy and CORS checks. Host/optimize required subsets only where measured loading or availability requires it.
6. Verify a modular GLB wardrobe and representative worst-case outfits on target phones. Keep an accurate canonical 2D fallback when a device or model is unavailable; display 3D coverage honestly. Rights gaps or incomplete requested coverage remain explicit release decisions, not an automatic claim of a complete catalog.

**Exit scenario:** an original owner and a new player each acquire/equip their real game items; both slots look consistent in every view. Transfer/listing/revoked ownership immediately removes invalid equipment. Missing/slow models preserve an understandable truthful appearance. Every asset in the release catalog has provenance and a tested render path.

## Staking vault and realized game yield

**W05. Owners:** reviewed vault/pool adapters, contribution accounting, treasury, withdrawal workers and Wallet. **Rules:** E01–E13, E19, I01–I03, O08.

Work:

1. Specify balances, pool shares, deposits, matured stake tranches, retained/game yield, fees, losses and pending liquidity before coding transfers. Begin with allowlisted native validator staking; additional strategies remain separate reviewed adapters.
2. Implement actual deposit/pool selection, 0–100% contribution and weighted access. Confirm E+2 maturity, top-ups preserving existing eligibility, decreases, pool changes and withdrawal removing the relevant tier value.
3. Accrue an auditable daily estimate, then realize only genuine net yield. Distinguish received liquidity from staked rewards and from restored losses. Principal, user-retained yield, operating funds and task escrow cannot become game income.
4. Implement independent exit cohorts and a queue that cannot reset an already unlocking batch. Demonstrate the selected pool's actual unstake semantics; isolate batch accounts or adopt another reviewed mechanism when a pool would otherwise reset its account's unlock epoch.
5. Allocate confirmed incoming NEAR under a versioned policy, using integer amounts and receipt IDs. Model how scarce daily yield funds many small coins and fewer larger prizes across six city slots. Reduce future publication, not backing already promised, when funding is low.
6. Display real balance, pool/fee data, estimated yield, active/maturing positions, retained earnings, requested/ready withdrawal and failure recovery. Keep accelerated demo timing isolated. Game economy reporting shows confirmed aggregate stakers, contributing stake, observed net yield and liquid/reserved funds, with clearly qualified daily, weekly, monthly, quarterly and yearly outlooks.
7. Add permission/upgrade governance, reconciliation, callback-failure recovery and emergency paths. Ordinary operator/oracle roles cannot withdraw player principal; upgrade authority and residual trust require an explicit reviewed design.

**Exit scenario:** a user deposits to an actual testnet staking strategy, earns attributable yield, contributes its configured share and receives principal plus retained entitlement through a real exit cycle. Tests cover zero/negative yield, rounding, interrupted callbacks, concurrent changes, unavailable pool/RPC, partial liquidity and a new exit while an older one unlocks. A sandbox test alone does not prove the live pool's timing.

## Gameplay settlement and reconciliation

**W06. Owners:** evidence service, native game/profile contracts, reward worker/outbox, chain indexer and client receipts. **Rules:** D05, D12, G10–G11, E09–E18, I08, O10.

Implemented slice: native street-coin collection has an explicit opt-in control, runs only with eligible foreground GPS and pauses during manual operations. Its session counter changes only after confirmed claims. Automated cases cover retries, interruption and controller state; this does not establish physical presence, real-device GPS behavior or the complete W06 recovery journey. The field gate and real yield/exit-cycle proof remain open. See [slice evidence](output/qa/W08-W10-native-tasks/README.md).

Work:

1. Publish native-backed coin batches and quest commitments from the city allocation. Bind world, item, policy, network, claimant and receipt identity. Reject exhausted supply before the UI promises it.
2. Separate fast walking feedback, evidence acceptance, chain finalization, claimable balance and withdrawal. Show pending accurately and recover the same operation after reconnect.
3. Settle actual coin/quest XP/item awards for real player accounts, including first valid shared prize and personal XP for later eligible completions. Prevent arena or demo balances from entering this route.
4. Handle oracle review, monotonic receipt order, bounded deadlines and timely pending submissions. Maintain backing through expiry and release it only after outstanding rights are resolved.
5. Reconcile database materialized views with authoritative contracts and durable receipts. Exercise crash-after-send-before-ack, stale cache, RPC outage and retry storms without paying twice or losing a claim.
6. Review receipt/location linkability: public coin indices, world manifests and account IDs can reconstruct visits even without raw coordinates. Prefer aggregate public claims and minimized commitments with private detailed receipts where the reviewed accounting design permits it. Disclose residual linkage before activation; do not claim anonymity.
7. Record gas, storage and operational subsidy separately from player rewards. Bound day/city/account exposure and service-key permissions before public physical-mode awards.

**Exit scenario:** one remote tester with an actual testnet account completes the connected flow from a published funded activity to native reward, NFT equipment and a verified withdrawal. A physical-mode tester does the corresponding real visit. A second tester's competing claim reconciles correctly. Proofs reference that player's gameplay receipt, not an unrelated operator transaction.

## Signed Aura market and Intents compatibility

**W07. Owners:** NFT escrow/market adapter, order service, signer UI, matching/relaying and settlement/withdrawal views. **Rules:** E02, E17–E18, I09–I10.

The official [Verifier accepts NEP-171 deposits and uses wrapped NEAR](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits). Its [canonical deployment is mainnet only](https://docs.near-intents.org/integration/verifier-contract/introduction). A self-deployed verifier used for sandbox/testnet compatibility is an experimental deployment, not the official Intents service. Do not plan against a nonexistent official testnet endpoint.

Work:

1. Reproduce NFT deposit, wNEAR deposit and matching signed token changes against the pinned verifier source in a controlled environment. Check token-ID serialization, supported signatures, nonce rules, fees and permission/capability assumptions.
2. Support a concrete order such as `Sell this Aura for 10 NEAR`: exact NFT, 10 NEAR displayed, corresponding wNEAR amount, owner, network/verifier, deadline and nonce. Explain escrow and costs before signing; a signature alone does not escrow an NFT.
3. Build deposit/list, browse/buy, cancel, expiry, fill race and withdrawal flows. An escrowed/listed item cannot remain equipped or be simultaneously sold elsewhere. Cancellation invalidates the actual on-chain order right, not just a database row.
4. Verify actual atomic economic exchange and separate asynchronous withdrawals. Failed NFT/token delivery retains a recoverable right and cannot silently keep the buyer's payment.
5. Prove two ordinary player accounts use the runtime flow; retain a generic market adapter for testing without claiming a server-only/native fallback is canonical Intents integration.

**Exit scenario:** two players trade an actual Aura for the exact agreed amount, cancel another listing, compete on a third and recover from a withdrawal failure. Controlled testnet compatibility closes this engineering milestone; canonical mainnet integration remains a required W14 proof before advertising it as production NEAR Intents. No mainnet spending is authorized by this roadmap.

## Community authoring and XP commitments

**W08. Owners:** Community, editor/lifecycle, progression contract/service, creator profiles and follows. **Rules:** C01–C06, D20, G13, O03. **UI package:** U10.

Implemented slice: Community separates Native and Demo tasks. Native publication locks a sponsor-funded prize in a dedicated escrow, with stable operation IDs and an exact funding review. This establishes independent sponsored publication and navigation only. Creator rights remain unavailable in the deployed application. A subsequent local source slice adds opt-in demo creator revisions/moderation, earned/locked/available XP, once-only release after admitted obligations, explicit profiles, free follows and approved/private read projections, with disabled player/server adapters. The combined source passes 343 tests and builds; [the integration record](docs/CREATOR-INTEGRATION-2026-10-31.md) separates source integration from runtime activation. Community authoring UI, validated completion/reward delivery, native XP commitments, paid rights and the full W08 exit scenario remain open.

Work:

1. Add Nearby, Following, Creators and My creations with useful map/list views. Move economy reporting into Settings with preserved Wallet/proof links.
2. Implement stable quest/template IDs, revisions, moderation and preview. Separate author, sponsor and validator. Allow several approved requirement types without letting authors mint arbitrary XP/items/cash.
3. Add earned/locked/available XP and an atomic publication commitment. Current level uses available XP. Keep one-time level grants separate so cancellation/republication cannot farm them; retain already earned inventory.
4. Implement cancellation/closing, pending evidence, revision rights and exactly-once XP release. System-world regeneration cannot remove purchased content, an author's series or pending obligations.
5. Add free follow/unfollow, creator profile and a useful following feed. Likes, donations and paid access remain absent or explicitly disabled until W09.

**Exit scenario:** a creator publishes a reviewed free quest, loses the committed XP from current level calculation, receives another player's solo completion, then closes it and regains the exact commitment without another level reward. Simultaneous publications cannot overcommit. A player finds the creator through Following without disclosing live location.

## Creator funds donations and paid access

**W09. Owners:** treasury allocation, creator rounds, preferences, paid entitlement/refund contracts and earnings UI. **Rules:** C07–C15, E09–E13. Follow [CREATOR-ECONOMY-PLAN.md](CREATOR-ECONOMY-PLAN.md).

Work:

1. Migrate native conservation to a third bucket through a reviewed state migration. Activate the creator allocation for future eligible receipts only. Preserve all old prizes and principal rights.
2. Add operator-configured allocation and attributable player routing preferences. At a proposed 10% setting, a new 1,000 GOLD game receipt allocates 100 creators, 450 street coins and 450 zones. Direct routing cannot count again in the shared round.
3. Implement optional likes and independently verified completions with published weights/caps, frozen UTC rounds, abuse review, residual carryover and idempotent payouts. No unbounded fixed cash amount per click/completion.
4. Add voluntary donations with explicit recipient/amount and the accepted initial 100% creator credit, separately disclosed network cost and no paid reputation.
5. Implement paid quest preview, exact price, durable entitlement and 80/20 settlement. Do not finalize creator/treasury income before entitlement delivery; failed delivery refunds the full payment. Only the finalized 20% treasury share can enter another eligible allocation once.
6. Protect paid content, exact protected locations and private evidence. Price/revision/cancellation cannot erase already purchased scope or timely participant rights. Add bounded review/refund/escalation flows.

**Exit scenario:** a player follows a creator, supports a free quest, donates, buys access and completes it. A 100 GOLD access payment settles 80/20 once; a failed delivery refunds all 100. XP and pending refunds survive closure and daily reset. A creator round never spends more than its reserved liquid budget. Demonstrate actual native testnet settlement in addition to isolated accounting tests.

## Social publishing evidence and moderation

**W10. Owners:** social/storage adapters, media pipeline, notes, sponsored evidence, presence and operator review. **Rules:** O01–O05, O10, C13–C15.

Implemented W10.3 slice: a keyless, code-pinned testnet contract supports intentionally public text evidence, sponsor review in chain-receipt order, rejection, appeal, a named trusted arbiter, cancellation preserving earlier rights, bounded timeout settlement and retryable credit withdrawal. The policy allows sponsor review until 48 hours after the submission deadline; rejected evidence has up to 24 hours to appeal, capped at deadline +72 hours; unresolved arbitration ends at deadline +120 hours. The immutable pilot has 128 lifetime task slots, 32 submissions per task and a maximum 1 test NEAR prize. Creation and submission each require a separate non-refundable 0.05 test NEAR storage payment. The arbiter and public permanence are disclosed before the relevant actions.

The [manifest](public/native-tasks-testnet.json) and [live proof](public/native-tasks-proof.json) record three project-owned, programmatic-wallet rehearsals: approval and claimant withdrawal; empty-task cancellation and sponsor refund withdrawal; and rejection, cancellation, appeal, arbiter approval and claimant withdrawal. All 0.003 test NEAR of prize funding was withdrawn; 0.25 test NEAR of storage funding and 3 yoctoNEAR of operating funding remain separately attributed. These synthetic records prove neither physical completion nor independent arbitration. Elapsed timeout and failed-transfer recovery are unit-tested, not demonstrated across live deadlines. Public photos, exact/private GPS evidence, protected submissions, content moderation and real-device wallet journeys remain open. See [implementation and QA evidence](output/qa/W08-W10-native-tasks/README.md); W10 stays **building**.

Implemented follow-up: public server-hosted map notes now have explicit publication consent, optional fresh author GPS, sanitized photos, recoverable operation IDs, removal, reporting, bilateral blocking and an operator-only local moderation queue. Photo delivery respects current visibility; presence is rechecked after asynchronous appearance reads. Public SocialDB/IPFS publishing, private task photos, unsafe-place closure and staffed moderation remain open. See [social and receipt evidence](output/qa/W10-social-finality/README.md).

Work:

1. Publish intended public profiles/follows/notes through the selected SocialDB adapter and pin sanitized public media through IPFS with retry and availability monitoring. Write public text/anchor/author/time as specified; ask separately before attaching actual author GPS.
2. Keep private submissions and paid content access-controlled. Public hashes/teasers cannot include secrets. Explain public permanence before writing public chain records; hiding a record in the app does not erase all copies.
3. Complete sponsored task text/photo/location evidence, submission, approval, rejection, appeal, arbitration, deadlines, refunds and review order. Sanitize attachments and keep private evidence access-controlled. A first invalid upload cannot permanently block a later valid winner. Use dedicated external escrow, not ordinary zone/creator funding.
4. Add report/block, unsafe-place closure, media filtering, moderation states, public support/contact and audit records. An on-chain note needs an application moderation/tombstone strategy.
5. Finish foreground-only opt-in presence, explicit 15-minute renewal, 30-second staleness, block enforcement and private-by-default telemetry. Do not collect raw trails merely to build a dashboard.

**Exit scenario:** a note/image publishes once, remains available after a provider retry and exposes only the agreed information. A paid answer remains inaccessible without entitlement. A disputed sponsored task reaches a final payout/refund through the disclosed process. Report/block removes the relevant content or presence from the affected views.

## Bounded AI and operator world controls

**W11. Owners:** guide/provider adapter, content proposal service, capability controller, generation review and operations UI. **Rules:** I11, G01–G09, O05.

Work:

1. Ground the guide in the current manifest and authoritative availability. It must not invent an unclaimed prize, open path or guaranteed return.
2. Permit content proposals only through approved templates, reviewed locations and fixed funded reward choices. An AI can fill a slot/objective under the same city capacity rules; it cannot add an overlapping seventh zone.
3. Validate schema, rights, safety/review status, geometry, supply and budget independently of the model. Snapshot accepted output/model/policy references so retries reproduce the published world.
4. Enforce daily/city/capability costs, scoped signer methods, rate limits, audit and emergency disable. Player principal is never exposed to the agent. Treat retrieved/user content as untrusted.
5. Keep deterministic templates and a useful rules guide when the provider is unavailable. Operator preview, rejection and publication have distinct states.

**Exit scenario:** an agent proposes a valid funded quest that is reviewed/published through the normal pipeline. Attempts to change a reward cap, use private/unsafe land, duplicate publication, leak paid content or transfer principal are rejected. Disabling the AI leaves the city playable.

## Device quality and distribution builds

**W12. Owners:** client rendering, PWA/native packaging, wallet deep links, media/model quality and accessibility. **Rules:** D04–D11, D22–D26, O06. Complete U01/U02/U06/U12 and selected U14 enhancements.

Work:

1. Complete the viewport matrix: 360×640, 390×844, 844×390, 1280×720 and 1440×900; keyboard-open, long names, 200% text, safe areas, screen reader and reduced motion.
2. Measure named physical Safari/iOS and Chrome/Android devices through the entire game, account, market and creator flows. Profile real map/model load, long walks, battery, memory, thermal behavior and interrupted network. Establish explicit release budgets from those measurements.
3. Provide sensible 2D/lower-detail fallbacks, pause invisible work and implement PWA installation/update/cache behavior. Never queue an unverified offline reward as an already settled award.
4. Build the iOS distribution path with tested associated-domain/passkey recovery, native/embedded browser wallet return, geolocation and lifecycle behavior. A web wrapper alone does not establish those capabilities.
5. Review the current [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) against NFT appearances, digital content, wallet/payment flows and user content before finalizing the store-specific build. Resolve requirements transparently; do not assume the web configuration will be approved unchanged.
6. Add optional sound/haptics only with saved controls, visual equivalents and actual platform support. Complete art/typography/motion review at normal device scale.

**Exit scenario:** fresh and returning users complete all required flows on named real devices and recover from keyboard, backgrounding, deep-link cancellation and network loss. No essential action is hidden or drag-only. The iOS build is signed/testable with its required account/domain configuration; store submission/approval remains W14.

## Complete release candidate and city pilot

**W13. Owners:** integrated app/services/contracts, content operations, QA and reconciliation. **Rules:** all applicable rules; all U packages and GEO gates must have a recorded disposition.

Work:

1. Run a complete testnet city pilot with a stable release candidate, several sectors and both newcomers/original owners. Include solo, free, staking and creator roles; simultaneous players are a race test, not a play requirement.
2. Exercise daily regeneration and at least two actual financial exit cycles. Aim for a 14-day operational pilot; extend it when the chosen pool timings or unresolved failures need longer observation.
3. Complete the acceptance matrix below, property/concurrency tests, load tests against an explicit concurrency target and recovery drills. Use consented minimal telemetry; do not imply that a small pilot proves long-term retention.
4. Reconcile every native asset/right and financial state with chain data. Restore the service/database from backup, restart workers mid-operation and recover a lost session without duplicating rights.
5. Close all critical/high defects, unresolved financial mismatches, unsafe content failures and broken required player flows. Record lesser known issues with an explicit release decision; a milestone is not passed just because its happy path worked once.

**Exit scenario:** a newcomer, collector, staker and creator each finish their complete journey across days and failures using the same runtime. Operations can explain every reserved unit, active publication, ownership right and pending case. Evidence identifies source build, data/policy versions, devices, scenarios and outcomes.

## Reviewed mainnet and public distribution

**W14. Owners:** reviewed release artifacts, contracts/governance, deployment, support, mainnet compatibility and store/hackathon materials. **Rules:** O08–O09 and all financial/integration rules.

Work:

1. Complete independent review of financial contracts, oracle/capability trust, native identity recovery, marketplace, paid entitlements and upgrade controls. Resolve critical/high findings and rehearse emergency publication pause plus preserved withdrawal rights.
2. Recheck third-party asset rights, current store requirements, privacy/terms and any applicable real-value product requirements before launch. Keep support, reporting, incident handling and operator ownership explicit.
3. Prepare a reviewable mainnet release with deployment plan, code hashes, multisig/timelock or other reviewed administrative policy, initial funding limits, monitoring, backup and rollback/forward-repair procedures. Mainnet funding/signing requires the separate concrete authorization applicable to that release.
4. Prove canonical Intents NFT/wNEAR deposit, exact-price exchange, cancellation and withdrawal with the approved mainnet test amounts. An experimental testnet verifier does not substitute for this evidence.
5. Validate actual production player deposits, rewards, payouts and creator rights under capped rollout. Publish correct contracts, costs, operating disclosures and observed support procedures. Keep an explicit no-real-value arena for remote exploration.
6. Publish the repository/materials and hackathon submission only against the applicable official rules, actual source dates and evidence. Confirm the event's real deadline/tracks/eligibility before submission; do not infer them from an old prompt-example repository.
7. Finish web/PWA production rollout and separately submit/review the iOS application. Track accepted distribution platforms individually; rejection or a requested change is not a successful App Store launch.

**Exit scenario:** the production rollout has real end-to-end proofs, reconciled funds, working independent recovery, reviewed source/assets and an incident/restore owner. The web release is operational; the iOS release is marked complete only after its actual distribution gate passes. No required V1 feature remains a disconnected demonstration.

## Acceptance journeys for the final product

| ID | Journey | Required adverse case | Gates |
| --- | --- | --- | --- |
| J01 | Enter without a wallet, collect street coins, open free chest, equip, resume later | Offline/retry, no other players and GPS denied | W01, W02 |
| J02 | Visit several city zones with distinct footprints and objectives | Stationary/replayed location, barrier, closed area, H3 boundary and midnight | W01, W06 |
| J03 | Create/sign in to native account and recover on another supported device | Lost cookie/key, conflicting wallet link, revoked delegation | W03 |
| J04 | Import original appearance and equip both real Aura slots | RPC outage, missing model, NFT transfer and stale ownership | W04 |
| J05 | Deposit, change contribution, reach tier, retain yield and withdraw | E+2, decrease, pool loss, callback failure and older unlocking batch | W05 |
| J06 | Earn real funded reward and withdraw it | Concurrent winner, pending evidence at expiry, crash after chain submission | W06 |
| J07 | Sell an Aura for exactly 10 NEAR, buy another and cancel a listing | Fill/cancel race, wrong verifier, signature replay, failed withdrawal | W07, W14 |
| J08 | Publish a quest, follow its creator and close it | Concurrent XP locks, revised content and repeated level-grant attempt | W08 |
| J09 | Like, donate, buy access, complete content and earn a creator award | Self-farming, empty round, charged-without-access and cancellation | W09 |
| J10 | Publish a note/image and complete a sponsored task | Private data boundary, provider outage, rejected evidence and appeal | W10 |
| J11 | Use a guide and publish a bounded AI-authored objective | Hallucinated reward, prompt injection, budget exhaustion, provider disabled | W11 |
| J12 | Complete the same game on physical supported devices | Keyboard, browser bars, accessibility, battery/thermal and deep-link return | W12 |
| J13 | Operate the full game over several daily/financial cycles | Worker races, partial outage, reconciliation and backup restore | W13, W14 |

Keep evidence under a versioned `output/qa/<build-or-milestone>/` location. Include source/schema/contract/policy identifiers, test commands, results, screenshots, device/browser information, aggregate field observations and outstanding issues. Exclude private keys, sessions, private evidence and raw GPS trails.

## Release gates and decisions still to resolve

| Decision | Must be resolved by | Required result |
| --- | --- | --- |
| Public CityPack boundary/candidates and route provider | W01 | Reviewed sources, access assumptions, cache/license and fallback |
| Exact footprint gap, target distances and rotation | W01/W13 | Versioned starting policy, simulated constraints and field tuning |
| Native passkey implementation/recovery/delegation | W03 | Actual account and multi-device recovery proofs |
| Asset rights/catalog and device 3D budgets | W04/W12 | Coverage manifest and measured quality fallback; explicit handling of unavailable requested assets |
| Pool list, share accounting, epoch and exit-cohort mechanism | W05 | Reviewed adapter semantics and real unstake evidence |
| Public receipt and location linkability | W06 | Minimized/accounted public data, private detailed evidence and truthful consent/disclosure |
| GPS spoofing and cash exposure | W06 | Reviewed threat model, bounded payout loss, account/activity controls and stronger evidence for valuable tasks; no claim that GPS or a chain proves physical truth |
| Native reward rate, city budgets and anti-abuse exposure | W05/W06 | Sustainable liquid-funding model and bounded publication |
| Experimental verifier and canonical mainnet path | W07/W14 | Pinned source compatibility plus separately authorized canonical proof |
| XP commitment schedule and creator weights/caps | W08/W09 | Published configuration; no silent confiscation or unlimited promises |
| Creator starting percentage and routing limits | W09 | Conserved future-receipt policy; 10% remains tunable |
| Review/appeal/refund deadlines and arbitration owner | W09/W10 | Finite user rights and tested closure paths |
| SocialDB/IPFS services and public/private retention | W10 | Available storage, pinning and disclosure/recovery design |
| Physical device baseline and store-specific product path | W12/W14 | Actual device evidence and a viable reviewed distribution build |
| Mainnet funding/administration and real-value launch conditions | W14 | Reviewed concrete release and appropriate authorization |
| Hackathon eligibility/deadline/materials | Before submission | Current official rules and reproducible honest demonstration |

## Hackathon demonstration within the roadmap

A useful competition slice ends after W06 with a polished city/arena experience, actual account, native reward and equipped collectible. Add a working W07 exchange and bounded AI use only when their gates pass. This slice is not the complete V1 and must not be presented as such.

The remote judge path remains short: enter the clearly labelled arena, discover/complete a quest, equip an actual testnet item, inspect the corresponding native receipt/withdrawal and understand how the physical city mode differs. The demonstration must work when no nearby players exist and must not require a judge to walk across Plzeň. Prepare source/build instructions, a short English video, current network/provider notes and test accounts without exposing private signing keys.

## Later extensions after complete V1

Preserve these ideas without making the present release unbounded:

- More reviewed cities and countryside/trail packs using the same spatial ownership and budget rules.
- Cooperative events, optional races and PvP, with solo alternatives; no team territory capture in the primary loop.
- Seasonal collections, richer geocaching, additional quest templates and creator series.
- NEP-245 materials/crafting if the actual item model needs it.
- Meta Pool or Rhea supply-only yield adapters after independent strategy review; no automatic leverage.
- OutLayer execution/randomness, Keypom onboarding and 1Click funding when a proved product need justifies the dependency.
- Trezu/SputnikDAO or another reviewed governance layer for published parameter changes and budget administration.
- Chain Signatures or eventual EVM deployment through explicit new scope; V1 stays native NEAR.

Each extension needs a complete rule/state/funding specification and its own acceptance gate. Adding an ecosystem logo, SDK import or disconnected example does not constitute integration.


### W04 follow-up — actual artwork in play

The local map now uses the actual bounded SDK GLB and follows visual heading, with official starter SVG layers shared across the UI and a persistent 2D fallback preference. Map Auras remain screen-space for readability. Original portrait backgrounds are distinguished from unsupported character slots, preserving more accurate 3D character coverage without losing clothing. Linked original item pictures use canonical `getItemSvg` reads in a paginated, ownership-checked gallery; manual refresh clears an unverifiable selected appearance. Evidence: `docs/ASSET-CATALOG.md` and `output/qa/W04-real-assets/`. W04 remains **building**: the first-50-original limit, complete modular dressing/catalog rights and physical-device acceptance are not passed.


### Native funding implementation, 31 October 2026

W05/W06 now include deployed testnet vault, keyless vault factory and funded reward contracts, wallet-signed position actions, six location-specific three-stop walks, a separate native coin trail and a durable settlement/distribution worker. Read [Native rewards and vault](docs/NATIVE-REWARDS-AND-VAULT.md) and [verification evidence](output/qa/W05-W06-native/README.md) before extending this boundary. These work packages remain **building**: real epoch-based exit completion, observed realized yield, partial exits/contribution changes, hardened GPS and independent contract review are still gates. Mainnet and the demo ledger are not enabled for real-money settlement.

### Playability and reusable quest update, 31 October 2026

The UI/backend/integration work was split among three focused agents and integrated into one release. Wallet no longer stacks native expeditions, staking and demo finance. Explore selects one zone activity; native walks return to their selected checkpoint/coin; Community exposes existing notes/tasks. See [UI audit](docs/UI-AUDIT-2026-10-31.md) and [rendered evidence](output/qa/W02-playability/README.md).

[Quest templates](docs/QUEST-TEMPLATES.md) specify implemented proximity/ordered/return/chest mechanics, evidence limits and future clue/photo/geocache prerequisites. Existing days and native hashes remain immutable. [Native integration status](docs/NEAR-INTEGRATION-STATUS.md) records the verified economy model and isolated maintenance path. W01/W02/W05/W06 remain building; field play, hardware, native lifecycle and full V1 integration gates are still open.

### Native receipt recovery and public-note controls, 31 October 2026

All seven non-task wallet flows now verify exact finalized receipts with current and executed contract-code checks and method-specific callback results. Sponsored tasks also use the shared recovery panel through their own reviewed keyless-contract verifier. A bounded session journal survives reload and prevents another signature while an unresolved operation for that account remains; Wallet offers receipt checking and deliberate reconciliation of verified failures. Seven existing project transactions passed read-only checks, while an older reward receipt with different executed bytecode was rejected. No new funds moved. Native passkey recovery and physical-wallet return tests remain open. The complete application suite now passes 268 tests.


### Durable recovery and worker takeover follow-up — 31 October 2026

New wallet operations persist in browser storage across tab closure, coordinate updated same-origin tabs and carry a finalized pre-sign checkpoint. Recovery files contain reviewed transaction records, never wallet keys; loading one never signs or establishes success. Older identical receipts, malformed outcomes and revoked authorization cannot clear a new pending operation. Legacy records without checkpoints retain their explicit limitations.

Worker sends and result/retry writes now recheck durable lease ownership after asynchronous work. Old processes cannot overwrite successor state or health. A single-block read-only reconciliation still observes epoch 5399, unlock5402, no released owner payment and zero realized game yield; sponsor funding is separate. Deleted public notes immediately lose access, with a durable media cleanup grace for coherent backups.

See [implementation and deployment evidence](output/qa/W03-W13-durable-recovery/README.md), [browser receipt model](docs/DURABLE-NATIVE-RECOVERY.md) and [staking observation](output/qa/W05-lifecycle/README.md). Native passkey recovery, live completed exit/yield cycles, physical phones and full-host/offsite restore remain required gates.

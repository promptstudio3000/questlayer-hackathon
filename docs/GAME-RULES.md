# Game design and integration rules

Updated 31 October 2026. These requirements consolidate the accepted game direction, the design work prepared in the parallel project conversation and the city-zone correction. They are a development and review checklist. A requirement appearing here does not mean that the alpha implements it.

## Sources and precedence

| Source | Role |
| --- | --- |
| Latest city-zone decision, 31 October | Six citywide slots for Plzeň, different shapes, no overlap and real movement between destinations |
| [AGENTS.md](../AGENTS.md) | Working agreements, twelve development rules and delivery evidence |
| [DESIGN.md](../DESIGN.md) | Game pillars, Aavegotchi direction, screen composition, input, states, motion and AI workflow |
| [UI improvement plan](UI-UX-IMPROVEMENT-PLAN.md) | Fourteen work packages U01–U14 with acceptance checks |
| [UI research](UI-UX-RESEARCH.md) | Source-specific adoption decisions; external advice is not automatically project policy |
| [Proposed tokens](design-tokens.json) | Proposed semantic visual roles; they are not current runtime tokens |
| [Implementation specification](../IMPLEMENTATION-PLAN.md) | Accepted economy, network, ownership and trust boundaries |
| [Creator economy](../CREATOR-ECONOMY-PLAN.md) | Accepted creator mechanisms and unresolved numerical balancing parameters |
| [World generation](WORLD-GENERATION.md) | City ownership, polygon selection, schedules and geometry acceptance |
| [Roadmap](../ROADMAP.md) | Implementation order, completion gates and evidence |

Explicit newer user decisions override earlier proposals. Do not interpret an upstream skill, proposed token file or research recommendation as authorization to change economics, install packages or deploy. The latest city rule supersedes the older twelve-zone target and per-H3-cell zone generation. The creator plan supersedes any earlier suggestion that locked publication XP would continue counting toward level.

Numerical tuning proposals remain identifiable: the 250 m gap, preferred walking distance, exact XP commitments, creator weights, fee policies and starting creator percentage require versioned configuration. GOLD denomination, 0–100% contributions, weighted stake thresholds and the accepted paid-access 80/20 split are product decisions.

## Development and design rules

The first twelve entries correspond to the twelve game/UI rules in AGENTS.md. Later entries preserve the more specific requirements from DESIGN.md and the reviewed backlog.

| ID | Rule | Completion evidence |
| --- | --- | --- |
| D01 | Design the next playable action before a summary dashboard. | A player can locate, understand, complete and use a discovery. |
| D02 | The first useful adventure works solo, without a wallet or deposit. | One fresh account finishes a free interaction with no other connected player. |
| D03 | Preserve real geography; arena movement, GPS and walking routes are distinct. | Mode labels, validation and distance labels agree. |
| D04 | Phone map and character stay readable through deliberate sheet states. | Compact objective, browse and detail work at the required viewports. |
| D05 | Every meaningful state has an action or an explanation. | Loading, ready, too far, stale/inaccurate GPS, pending, success, claimed, expired, offline and failed are exercised. |
| D06 | Adopt semantic tokens in a scoped change and check rendered contrast. | Real composited surfaces pass, not just a palette calculator. |
| D07 | Use an authored Aavegotchi-compatible character and pixel identity intentionally. | Recognizable appearance, restrained purple/pink roles, crisp operational text and recorded art provenance. |
| D08 | Phosphor serves utility actions; game objects use coherent authored art. | No random Unicode/emoji substitutions for coin, chest, Aura or discovery states. |
| D09 | Touch targets are at least 48 CSS px; body/input 16px, secondary 14px, optional notes 12px. | Actual effective hit areas, long names, safe areas and 200% text checked. |
| D10 | Dialogs and sheets use native or one established accessible interaction system. | Labels, initial/contained focus, Escape, focus return and non-drag alternatives work. |
| D11 | Motion explains state and never delays repeated actions; reduced motion includes camera APIs. | No forced reveal, camera flight, shake or particles under reduced motion. |
| D12 | Reward feedback comes from confirmed server/chain results and survives retries. | Durable receipt, one celebration, exactly-once settlement and safe retry. |
| D13 | Offer discovery and a useful choice rather than identical visit cards with different marketing. | Several designed quest requirements and a useful alternative objective. |
| D14 | Keep the same verified appearance and both Aura slots across map, profile, wardrobe and result. | Ownership refresh, missing asset, tall/wide outfit and transferred item scenarios agree. |
| D15 | Adapt the documented brand palette deliberately; do not mix source palettes or impose generic style bans. | The chosen roles match DESIGN.md and preserve canonical original colors. |
| D16 | A first eligible chest leads to its actual result, `Try it on`, confirmed equipment and return to map. | Complete flow with normal, skipped and reduced-motion reveal. |
| D17 | Preserve valid selected objectives through panels and refreshes; invalidate closed content honestly. | Back navigation and returning-session scenarios pass. |
| D18 | Inventory prioritizes character, slots and owned items before optional integration setup. | A newcomer finds equipment without scrolling through wallet setup. |
| D19 | Preview, pending save and equipped are different states. | Failed save or stale ownership never appears successful. |
| D20 | Community is primary when its initial content works; Game economy moves into Settings with a Wallet link. | Tasks, notes, fund balances and native proof links remain discoverable. |
| D21 | Routine coin feedback is calm, coalesced and subordinate to errors and receipts. | Bursts do not spam toasts/screen readers or replay after reconnect; counters are persistent or explicitly session-scoped. |
| D22 | Map following responds to sheet/header bounds; manual pan pauses it; recenter is explicit. | Rotation, browser bars and keyboard do not hide the character. |
| D23 | Do not move the arena character while dialogs, editors or operating controls own input. | Keyboard, touch-scroll, pointer-cancel and a second touch do not cause background movement. |
| D24 | Preserve zoom, focus and non-color/non-audio alternatives. | Body contrast 4.5:1; large text and meaningful control boundaries 3:1; screen-reader/list alternatives work. |
| D25 | Use one reviewed motion policy and interruption-safe transitions. | Proposed 100/160/240 ms roles and at-most-900 ms first reveal are tuned in context; sound/haptics are optional and saved. |
| D26 | Profile actual named phones and provide a quality fallback. | Loading, interaction, memory and battery observations recorded without invented performance scores. |
| D27 | Compare two or three compositions when changing hierarchy, then implement one complete interaction. | Before/After/Why with source pointers and actual screenshots. |
| D28 | Keep the React/TypeScript/MapLibre stack unless a demonstrated need justifies another dependency. | A tool recommendation alone never causes an engine, CSS or motion-library migration. |
| D29 | Avoid decorative mechanics such as energy, streak penalties, loot purchases, races or extra currencies. | Any such mechanic has its own explicit design decision before implementation. |
| D30 | Evaluate quality through playtesting and visual judgment. | Five-newcomer observations are evidence about those sessions, not a detector score or statistically proven retention. |
| D31 | Supported levels have an authoritative progression curve and a configured one-time reward or unlock. | Refresh and XP lock/release never replay a grant; no level promises an unfunded cash/item award. |

## World and physical play

| ID | Rule | Completion evidence |
| --- | --- | --- |
| G01 | Plzeň has six daily system-zone slots across the city. | A city overview and multiple H3 queries return the same six identities. |
| G02 | System zones never overlap or touch, including neighboring active ownership areas. | GEO02 geometry gate passes. |
| G03 | Use geography-led polygons and a versioned boundary gap. | Valid topology, exclusions and at least three suitable shape families in the six-site set. |
| G04 | Distribute destinations across city sectors and require real transfers. | Pedestrian connectivity and physical walking checks; no downtown-only fallback. |
| G05 | Several objectives may inhabit a zone; entering it does not complete them all. | Distinct targets, conditions and server authorization. |
| G06 | All-day and timed zone openings belong to one published daily schedule. | Server/client agree through local midnight and DST; no arbitrary player reservation. |
| G07 | World seed and coverage never depend on the first player's precise location. | Stable city/date/version, coarse/public centers and shared identity after restart. |
| G08 | Daily generation changes approved sites/content, not existing receipts or ongoing obligations. | GEO06–GEO08 and creator persistence cases pass. |
| G09 | OSM data is not certification of public access or physical safety. | Reviewed candidates, exclusions, closure reports and a reachable public interaction point. |
| G10 | Coins are shared, frequent, low-value and seeded on appropriate public paths. | First valid claim wins once; map chunks do not duplicate coins or budget. |
| G11 | Cash awards require credible evidence, backed supply and independent replay protection. | Server and native receipt tests; physical evidence limitations remain explicit. |
| G12 | Sparse/unsupported coverage has a useful truthful fallback. | Street play, point activities or clear coverage information without forced staking or fabricated zones. |
| G13 | Creator content is persistent content, not an extra overlapping system-zone layer. | Its own entitlement, availability and funding remain independent. |
| G14 | The compact tutorial arena remains available to remote judges and GPS-denied users. | Explicit simulation mode; it cannot settle physical-mode native rewards. |

## Economy and ownership

| ID | Rule | Completion evidence |
| --- | --- | --- |
| E01 | Native NEAR is primary; 1 NEAR displays as 1,000 GOLD. | Integer yoctoNEAR settlement; no new GOLD fungible token. |
| E02 | Demo micro-GOLD, native balances and Base assets are distinct domains. | No conversion of demo credit into native withdrawal, NFT ownership or an escrow obligation. |
| E03 | Players choose 0–100% of yield for the game; retained yield belongs to them. | Settlements before/after contribution changes conserve attribution. |
| E04 | Tiers use confirmed active stake weighted by its game contribution. | Free below 50,000; Tier 2 from 50,000; Tier 3 from 100,000 GOLD weighted value. |
| E05 | Increased access matures at E+2; matured portions survive top-ups. | Per-tranche maturity, immediate confirmed decreases/withdrawal removal and pool-value handling. |
| E06 | Withdrawal requests are available at any time; actual settlement follows liquidity. | Batches have an estimated 1–7-day range without a new request resetting an older unlock. |
| E07 | Start with allowlisted native staking, without leverage or borrowing. | Pool adapter, net returns, fees, contract permissions and loss behavior reviewed. |
| E08 | Daily earned yield is not necessarily liquid NEAR. | Accrued estimates and received spendable harvests are separate; principal never pays prizes. |
| E09 | Every eligible liquid receipt is allocated once under its policy version. | Deposits, rollover, refunds and loss recovery cannot masquerade as new income. |
| E10 | Current demo uses 50/50 coins/zones; creator activation first takes its configured share. | At a proposed 10% creator setting, new receipts allocate 10/45/45; historical obligations remain intact. |
| E11 | Available, reserved, awarded, pending withdrawal and paid funds reconcile. | Conservation includes all pools, native promises, sponsored tasks, creator rounds and refunds. |
| E12 | City/day budgets bound publication; more users or regions cannot create money. | Idempotent allocation, finite native batches, sufficient gas and storage separate from rewards. |
| E13 | Unclaimed backing stays in its original bucket; pending evidence retains its reservation. | Expiry and retry cannot release or allocate it twice. |
| E14 | Personal completion and the shared GOLD prize are different rights. | XP once per eligible player, cash once, and no second player needed. |
| E15 | No quest reservation; the first valid timely receipt wins the shared prize. | Trusted receipt ordering with review/appeal, not fastest chain gas or first unverified upload. |
| E16 | Free system zones mainly award XP/items; street coins and independent sponsored rewards remain available to free players. | No accidental cross-application of a zone's stake gate. |
| E17 | Auras are cosmetic NEP-171 items with above/below slots and bounded supply. | No payout multiplier, buyback or guaranteed resale claim; transfer removes equipment rights. |
| E18 | User progression is account-bound, not sold with an avatar NFT. | Avatar/NFT transfer cannot buy XP, identity or staking access. |
| E19 | Game economy reporting shows confirmed aggregate stake, contribution, observed yield, liquid funds and day/week/month/quarter/year outlooks. | Projections disclose inputs and remain estimates, not separately allocated or guaranteed payouts. |

## Identity and integration

| ID | Rule | Completion evidence |
| --- | --- | --- |
| I01 | A production passkey controls a real NEAR account with user-controlled recovery. | Sign an actual operation, restore independently on another supported device and revoke a lost key. |
| I02 | The server stores no player seed, private key or encrypted seed backup. | Service roles and logs cannot reconstruct or export a player's signing authority. |
| I03 | Do not invent a recovery seed for a non-exportable passkey. | Supported secondary recovery keys/providers are explained and tested. |
| I04 | Native wallet and alternative EVM identity require replay-safe ownership proof and account recovery semantics. | Correct origin, nonce, chain/account binding; a signed address cannot steal another profile. |
| I05 | Base Aavegotchi NFTs and wardrobes remain read-only original appearances. | Owned tokens and loose/nested/equipped items are decoded and deduplicated correctly; no original NFT enters the Aura sale flow. |
| I06 | Refresh ownership; unavailable RPC is not proof of zero ownership. | Stale, transferred and unavailable states are distinct; earned game items remain owned. |
| I07 | Use licensed models on demand and preserve a complete appearance with fallback. | Release catalog, permissions, CORS, asset hashes, equipment coverage and device budgets verified. |
| I08 | Profiles and public records use native contracts/social adapters where specified. | A read/write/recovery flow proves integration; a static link or transaction from a development operator is insufficient. |
| I09 | Signed fixed-price NFT orders need escrow, matching, cancellation and recoverable withdrawals. | Actual NFT/wNEAR exchange and failure recovery; no server-only sale described as live Intents. |
| I10 | [Official NEAR Intents](https://docs.near-intents.org/integration/verifier-contract/introduction) has no testnet deployment. | Local/self-deployed compatibility tests are labelled experimental; canonical integration is a separate reviewed mainnet gate. |
| I11 | AI uses approved templates, locations, capability scopes and funded budgets. | No access to principal or arbitrary payouts; deterministic fallback preserves gameplay. |
| I12 | No EVM game economy or Aurora chain is required for V1. | Base identity is isolated; future network adapters do not dilute native NEAR implementation. |
| I13 | Reuse Aavegotchi visuals and owned appearances without importing GHST, ALPHA or KEK game tokenomics. | The native NEAR economy and original-asset ownership remain independent. |

## Creator economy

| ID | Rule | Completion evidence |
| --- | --- | --- |
| C01 | Community contains Nearby, Following, Creators and My creations. | Usable content surfaces and map/list parity, with no fictitious feature buttons. |
| C02 | Publish through stable quest identity, revisions, moderation and lifecycle. | Draft → review → published → closing → closed; daily system reset preserves it. |
| C03 | Publication atomically locks earned XP; drafts do not silently lock it. | Concurrent publication cannot overcommit and failed/rejected publication releases its lock. |
| C04 | Current level uses earned XP minus locked XP. | Closure returns the same XP once; one-time level rewards do not repeat and earned inventory is retained. |
| C05 | Cancellation stops new starts/purchases, then resolves existing obligations. | Timely evidence, purchased access and refunds survive closure; no orphan locks. |
| C06 | Following is free and does not reveal the follower's current position. | Independent follow/unfollow and useful feed. |
| C07 | Creator share and player routing use an existing attributable budget once. | Direct routing cannot also enter the shared round or increase tier contribution. |
| C08 | Likes direct a finite fund; donations spend the donor's balance. | UI distinguishes them; neither is mandatory for free content. |
| C09 | UTC creator rounds distribute only a reserved finite budget. | Score weights/caps versioned; zero-score rounds/residuals roll over and finalization is idempotent. |
| C10 | Self-activity, copied revisions and repeated evidence do not farm the fund. | Stable quest identity, independent completion checks and reviewed abuse outcomes. |
| C11 | Direct donation starts at 100% creator credit with network cost disclosed separately. | The paid-access 80/20 rule is not silently applied to donations. |
| C12 | Paid access settles 80% creator / 20% treasury exactly once. | Durable entitlement, rounding, retry and full refund on failed delivery. |
| C13 | Paid access buys disclosed content, not a reserved prize or guaranteed return. | Useful preview and separate prize funding/eligibility. |
| C14 | Protected content stays out of public chain/IPFS, bundles and unrestricted reads. | Public teaser/integrity reference and actual access controls tested. |
| C15 | Existing access survives revisions/price changes under its disclosed scope. | Cancellation, review deadlines, escalation and refund rights exercised. |

## Social records and operation

| ID | Rule | Completion evidence |
| --- | --- | --- |
| O01 | A public note has anchor, author, time and optional sanitized image; actual author GPS needs separate consent. | EXIF removed; public persistence explained before chain publication. |
| O02 | Presence is on by default while the game is in the foreground (Settings switch turns it off, choice remembered), seen only within ~1.5 km, lease renewed automatically every 15 minutes, stale after 30 seconds. Profiles never show a position (Lubos, 11 Nov 2026). | Stop/hide/block works; no raw player trajectory goes on chain. |
| O03 | Sponsored tasks lock their own budget before publication and have review, rejection, appeal, arbitration and timeout rules. | Earliest eligible evidence handled fairly; pending cases do not disappear or permit premature refunds. |
| O04 | Public profiles/follows/notes and private evidence/paid content have separate storage policies. | SocialDB/IPFS failure, pinning, moderation tombstones and data retention work without duplicate charges. |
| O05 | Operators can remove unsafe content, pause publication and investigate receipts without taking player keys. | Audited capabilities; player withdrawal and evidence obligations retain defined behavior. |
| O06 | Delivery requires real rendered and interaction evidence. | Phone 360/390, short landscape, desktop, keyboard, enlarged text, reduced motion and real-device matrix. |
| O07 | Every milestone ends in an entire player/operator scenario with required failures. | Feature code, a mockup, or a successful build alone cannot close it. |
| O08 | Production release needs migrations, reconciliation, restore, monitoring, reviewed contracts/rights and actual network proofs. | Stage gates in ROADMAP.md; mainnet and store release are distinct from alpha hosting. |
| O09 | Public claims distinguish proposed, simulated, testnet and production behavior. | A reproducible judge flow and source/deployment evidence, with real development dates. |
| O10 | Public receipts can reveal visits by linking an account to a known coin/quest location, even without raw GPS. | Review and minimize that linkage, keep exact private history/evidence access-controlled, and disclose unavoidable public data; do not promise location anonymity. |

## Backlog coverage from the design conversation

Every U package remains independently traceable. Completion of a related backend feature does not automatically close a UI package.

| Package | Preserved scope | Roadmap delivery |
| --- | --- | --- |
| U01 | Readable type, targets, tokens and layers | W02 and W12 |
| U02 | Dialog behavior and game-input ownership | W02 and W12 |
| U03 | Honest quest requirements, cash/XP and failure states | W01, W02 and W06 |
| U04 | One consistent character composition | W02 and W04 |
| U05 | A useful recommended adventure | W02 and W13 |
| U06 | Deliberate mobile sheet and camera padding | W02 and W12 |
| U07 | Confirmed reward, receipt and equip moment | W02, W04 and W06 |
| U08 | Coherent authored game objects | W02 and W04 |
| U09 | Equipment-first inventory | W02 and W04 |
| U10 | Navigation, Community and accessible economy | W08 and W09 |
| U11 | Quiet pickup feedback and truthful counters | W02 and W06 |
| U12 | Reduced motion and measured mobile rendering | W02 and W12 |
| U13 | Newcomer observation and designed quest variety | W01, W02 and W13 |
| U14 | Optional sound/haptics/promotion; budgeted 3D | W04 and W12; promotional work is optional |

The numerical parameters still to tune are listed in the world/creator specifications and roadmap decision register. Change them through versioned policy and evidence, not through unrelated UI edits.

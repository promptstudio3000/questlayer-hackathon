# QuestLayer — implementation specification

Updated 31 October 2026. Product, source comments, public documentation, errors and competition materials use English. Private development conversations may use Czech.

The authoritative delivery order and milestone gates are in [ROADMAP.md](ROADMAP.md).
The consolidated [game rules](docs/GAME-RULES.md) and [city generation specification](docs/WORLD-GENERATION.md) include the latest citywide zone decision.

Player-facing development also follows [DESIGN.md](DESIGN.md) and [AGENTS.md](AGENTS.md).
The [UI improvement plan](docs/UI-UX-IMPROVEMENT-PLAN.md) defines proposed design work
and verification, informed by the [source review](docs/UI-UX-RESEARCH.md). Its new
palette, navigation and interaction states are not yet runtime behavior. These
design documents do not change the economy or integration status specified below.

## Product

A native NEAR exploration game on real OpenStreetMap geography. A person can play alone: walk, collect shared street coins, visit daily zones, complete a personal activity, discover an Aura and customize their character. Multiplayer competition is a future mode; the primary loop never waits for another player.

1 NEAR = 1,000 GOLD. GOLD is a display denomination, not a newly issued token. Deployed financial contracts account in integer yoctoNEAR. The explicitly labelled demo uses integer micro-GOLD in a separate database ledger and never transfers player funds.

## Economy

Players choose a native staking pool and contribute 0–100% of their yield to the game. The remaining yield belongs to the player. The game share is split 50% street coins / 50% zones. Player principal, retained player yield, operating gas and externally sponsored task escrow are separate.

The accepted next-phase [creator economy plan](CREATOR-ECONOMY-PLAN.md) extends this allocation with an operator-configurable creator share, proposed initially at 10% of new eligible liquid receipts. The remaining 90% retains the 50/50 coin/zone split, giving 10/45/45 overall. Existing prizes and commitments are never reduced. The current 50/50 demo behavior remains in place until the new allocation is implemented and migrated.

Every new liquid game-yield receipt is allocated once. Odd indivisible units go to the zone fund. Neither deposits, the return of unclaimed backing nor recovery of an earlier loss count as new yield. Funds awaiting unstaking are not liquid reward backing.

Street coins are shared, numerous and small. The first valid collector gets the fixed amount; the coin disappears for everyone. Initial demo denomination: 0.01 GOLD. Every published coin is backed before publication. Uncollected backing rolls into the street-coin fund after expiry. Zone backing stays in the zone fund. Exhausted funding never creates unbacked GOLD.

Weighted stake is the sum of active position values multiplied by the yield contribution. Free <50,000 GOLD; Tier 2 >=50,000; Tier 3 >=100,000. Higher access matures after a complete subsequent staking epoch (deposit in E, eligible E+2). Mature access survives small top-ups. Decreases and withdrawal requests immediately lower confirmed eligibility. The arena explicitly uses a 30-second maturity simulation.

The first real strategy is allowlisted native validator staking. No leverage or borrowing. Withdrawals are requestable at any time and processed in batches, normally estimated at 1–7 days. A new unstake must not reset an already unlocking batch. The arena explicitly simulates 60 seconds. Daily accounting and actual liquidity realization are different operations.

Personal quests award XP once per account. A separately backed shared GOLD reward can be collected once, including by a lone player. Opening a quest creates no player reservation. Future competitive quests use durable receipt order: first valid evidence, not fastest blockchain gas. Timely pending evidence retains its backing after expiry.

## World and map

Physical city content activates after login and location consent. A deterministic mode/city/local-date/version key creates one shared city world; restarts, first visitors and reconnects never reroll it. Use a reviewed CityPack boundary and IANA timezone, UTC storage and local-midnight regeneration. H3 resolution 7 supports lookup, caching and coin chunks; entering another cell does not create another set of zones or another budget. Financial daily limits use UTC, preventing timezone travel from creating extra allocations.

Ingest bounded OSM pedestrian/public-access routes through a cached map-data adapter. OSM does not prove physical safety. Exclude known private/forbidden access, railways, water and inaccessible locations. Insufficient data means less content, not invented accessible places. Fixed places, messages and long-lived sponsored tasks survive daily resets.

Target configuration for Plzeň: six system-zone slots across the whole city, with varied valid polygon shapes, no overlap/touch, meaningful boundary gaps and actual pedestrian transfers between reviewed city sectors. Begin with three Free, two Tier 2 and one Tier 3 slot, each supporting several designed activities. Include all-day, three-hour and one-hour openings. Safe-candidate shortfalls produce fewer zones, never an overlapping downtown cluster. Follow [WORLD-GENERATION.md](docs/WORLD-GENERATION.md) for geometry, schedules, generation and acceptance. The local city implementation now uses six geography-derived non-overlapping polygons and one shared city/day identity; the original circular/per-cell alpha description is historical. Public deployment of any particular local feature requires separate release evidence; see the whole-project handoff. Zones are not team territories.

MapLibre and OpenFreeMap provide real vector maps. Use pastel terrain, clear wider roads, simplified buildings, an expressive character and pixel objects. Target zoom 17, pitch 43–45 degrees, smoothed following and a recenter control. Manual pan pauses following. Globe view transitions to local geography. Rendering and simulated camera movement never constitute physical evidence.

## Identity, inventory and social

Native NEAR is primary; EVM is an alternative identity and read-only ownership source. A production passkey must control an actual NEAR account and support independent user-controlled recovery. Never store player private keys, seeds or encrypted seed backups on the server. The initial browser passkey controls only the explicitly labelled demo identity; NEAR wallet signatures are verified independently with NEP-413.

Each new player should receive an independent NEAR avatar NFT. Account progression is not transferred by selling an avatar. Aavegotchi originals remain on Base. Verify the address by signature, read owned token IDs and loose/nested/equipped wearables, deduplicate quantities and periodically refresh ownership. Unavailable RPC data is not zero ownership. Premium appearances expire when ownership can no longer be established; earned game items remain.

Load licensed upstream GLBs on demand, with a fallback for unavailable or slow assets. Public availability is not a blanket asset license. Complete model coverage, a modular wardrobe and renderer compatibility require separate validation. The current starter UI uses verified official Aavegotchi template layers; historical minted cover media retain their original artwork. Verified originals can use their existing on-chain SVG appearance. Follow the [asset catalog](docs/ASSET-CATALOG.md) for source/rights and remaining coverage boundaries.

Auras are cosmetic, limited-edition NEP-171 assets with above/below slots. No guaranteed resale value or reward multiplier. Transfers clear equipment. Free players can trade their own Auras and fulfill independently funded tasks. The intended market uses signed fixed-price Intents, NFT escrow, wrapped NEAR, actual nonce cancellation and retryable asynchronous withdrawals. The [official Verifier has no testnet deployment](https://docs.near-intents.org/integration/verifier-contract/introduction); sandbox or self-deployed testnet compatibility must be labelled experimental, with canonical mainnet proof gated separately. The initial demo market is explicitly server-settled; it must not be described as a live Intents market.

Map notes contain public text, anchor, author and time, with optional sanitized image and separately opt-in actual author GPS. Intended publication: SocialDB and pinned IPFS media. Initial notes use the demo database and sanitized server images. Live presence is off by default, foreground only, explicitly renewed after 15 minutes and removed after 30 seconds of inactivity. No raw trajectory on chain.

Sponsored tasks lock their own reward before publishing and survive world resets. Creator review must not skip earlier pending evidence. Pending evidence blocks refunds. Public disputed tasks require explicit review, appeal, arbitration and timeout rules before non-demo launch.

The planned **Community** section combines nearby player-authored quests, followed creators, creator profiles and My creations. Move the standalone fund dashboard to **Settings → Game economy**, linked from Wallet. Publishing creator quests locks refundable earned XP, excluded from current level calculation until released after closure obligations. Creator income combines donations, a bounded fund distributed through eligible likes/verified completions, and optional paid access split 80% creator / 20% treasury. Use the lifecycle, access protection, accounting and acceptance rules in [CREATOR-ECONOMY-PLAN.md](CREATOR-ECONOMY-PLAN.md); these capabilities are not implied by existing demo sponsorship.

## NEAR and AI

Native game contract (`contracts/game`, retired on 10 November 2026; the live game never called it): independently conserved coin/zone buckets, funded batches, exactly-once claims, profiles, XP and retryable reward withdrawal. NFT contract: limited Auras, ownership, approval, enumeration and transfer-safe equipment. Staking vault and Intents Verifier are separate integrations, not implied by the existence of game/NFT contracts.

An NPC guide may use NEAR AI Cloud. Autonomous publication requires a separate bounded capability: approved templates/locations, fixed reward choices, daily/local caps and no access to player principal. AI does not judge physical truth or authorize arbitrary transfers. If AI is unavailable, deterministic templates keep the game playable.

Future ecosystem additions: NEP-245 materials/crafting; OutLayer verifiable execution/randomness; Trezu/SputnikDAO governance; Meta Pool and Rhea supply-only strategies; Keypom onboarding; 1Click funding; Chain Signatures when genuinely needed. No EVM game economy or Aurora chain in the first release.

## Delivery and acceptance

Follow [ROADMAP.md](ROADMAP.md): reproducible baseline; city worlds and complete solo UI; real native identity; actual collectibles and wardrobe; reviewed staking/yield; gameplay settlement; market; Community and creator economics; social/moderation and bounded AI; full device quality; integrated city pilot; reviewed production/distribution. Identity spikes, device checks and financial review start early. Passing an isolated demo or deploying a contract does not close its integration milestone.

The deployed demo must clearly state which assets and balances are simulated. Native deployment proofs live in `public/testnet-deployment.json` only after real transactions and postcondition checks succeed. No mainnet transactions are authorized by this specification.

Acceptance includes simultaneous coin claims, retry idempotency, rollover and DST, no duplicate prize, tier maturity and decreases, retained yield, withdrawal retry, atomic market conservation, custody-free passkey recovery, signature replay rejection, origin validation and NFT equipment removal on transfer. A standalone testnet smoke verifies an actual reward transfer and an actual NFT transfer.

Creator integration additionally requires conserved three-bucket allocation, atomic refundable XP commitments, no repeated level grants, bounded support distributions, paid-access delivery/refunds and exactly-once 80/20 settlement. Follow the dedicated plan's acceptance criteria before enabling these features.

The hackathon demonstration must be executable by one remote judge: join the arena, collect coins, finish a quest, open a chest, equip/list an Aura, inspect fund accounting and follow native transaction proofs. The arena is visibly separate from physical-location validation.

## Next phases

Start with W00, then W01 city generation and W02 complete solo experience. This ordering resolves the latest overlap, city coverage and playability problems before adding more disconnected integrations. W03 identity capability work may proceed independently of visual refinement.

The complete dependency order, release gates, acceptance journeys and later extensions are maintained in [ROADMAP.md](ROADMAP.md). Use the dedicated [creator plan](CREATOR-ECONOMY-PLAN.md) for its financial/lifecycle semantics. Keep one progression and accounting model throughout.

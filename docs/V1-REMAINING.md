# QuestLayer: remaining work to a complete V1

Updated 31 October 2026, after the playability, reusable quest and native worker slice. This is a current gap register, not a declaration that the full product is ready. The authoritative milestones and acceptance journeys remain in [ROADMAP.md](../ROADMAP.md). Testnet tokens have no monetary value.

## What is implemented now

- A city/day world with six disjoint, distributed polygon zones, shared street coins, persistent preparation and daily rotation.
- Solo demo play, confirmed chest discovery and equipment; official starter art and an on-demand Aavegotchi 3D character with a 2D fallback.
- Wallet message sign-in, testnet avatar/Aura ownership and equipment, native fixed-price Aura escrow/trading, SocialDB profile publication and read-only original Aavegotchi appearance.
- Native validator vaults, keyless factory positions, fixed contribution percentages, maturity-based tiers, full exits and receiver-bound native reward receipts. The worker publishes funded days, reconciles claims and maintains positions.
- A public native economy read model separates actual pool balances, weighted tier stake, available/reserved reward funding, player credits, pending transfers and withdrawn funds. Missing/stale observations are explicit; unsupported APY/forecasts remain unavailable.
- Compact Explore objectives, one selected zone activity, a separate testnet walk board, Wallet sections for Rewards/Staking/Demo, Community navigation and economy under Settings/Wallet. Operational and optional setup details are disclosed on demand.
- Four reusable quest templates: proximity visit, ordered three-stop trail, four-stop return trail and cosmetic chest. New demo content begins with unprepared days from 2 November; already-prepared worlds and all native v1 manifest hashes remain unchanged. Native v1 continues to attest its original three checkpoints.
- Route completion commits the final stop and reward together. Paused/failing reward settlement no longer prevents independent maintenance of an existing withdrawal. Tests cover rollback/retry, receipt ordering, ownership/code guards and conservation.

These are connected slices, but several native systems remain a pilot beside the main demo progression. A working contract is not evidence of the entire release journey.

## Next implementation order

| Priority | Finish | Concrete acceptance gate |
| --- | --- | --- |
| 1 · W01/W02 | Finish playable content and interface | One objective and sensible Back behavior across map, inventory, market, notes and creator forms. Authored coin/chest/quest artwork, actual level rewards and stable/recoverable results. Observe five newcomers; correct failures. Field-check public access and real separation in Plzeň. |
| 2 · W05/W06 | Complete the real money lifecycle on testnet | Observe pool release, receipt of unstaked cash, beneficiary withdrawal, realized yield capture and 50/50 treasury funding over several epochs. Prove failure recovery and older withdrawal protection. Current demonstrated exit still awaits epoch 5402; realized game yield observed so far is zero. |
| 3 · W03/W04/W06 | Join native identity, rewards and progression into one game | The same explorer earns native XP/level unlocks and actual Aura rights on the primary map, resumes after reconnect and uses an independently recoverable account. No server-held player keys. Validate wallet return/recovery on two supported devices. Keep demo funds clearly separate. |
| 4 · W01/W06 | Introduce richer native quest policies safely | Versioned future-day manifest migration for visit/return/chest mechanics, reviewed evidence and payout exposure. Never rewrite a published day's targets, hash, amounts or accepted rights. Native photo/geocache proof needs a separate implemented review policy. |
| 5 · W07 | Complete signed market / Intents path | Existing fixed-price native NFT escrow is a working testnet path. Prove the selected canonical protocol's exact NFT/payment compatibility, replay protection, cancellation, matching and failed-withdrawal recovery. Do not call the current market a live NEAR Intents integration. |
| 6 · W08–W11 | Finish creator and social rights | Native sponsored-task escrow, evidence review, deadlines/refunds/appeals; authoring/follows, XP commitments and once-only level grants; conserved donations/access/creator allocations; moderation, private media retention and bounded AI tools. Existing demo task/notes screens do not fulfill these rights. |
| 7 · W12/W13 | Prove the release candidate | Physical Safari/iOS and Chrome/Android GPS, keyboard, safe areas, wallet return, performance, battery and offline behavior; multi-day city pilot, monitored workers and full host/offsite restore. Reconcile all funds after restore. |
| 8 · W14 | Reviewed mainnet and distribution | Independent contract/security review, administration/upgrade/incident policy, verified asset rights and catalog, actual funding limits, mainnet acceptance and separate iOS distribution review. |

## Financial features still bounded in the current implementation

The vault supports a full exit and a fixed contribution percentage per position. Partial exits, changing a live contribution, loss/recovery policy review, retained-profit NAV tier accounting and exceptional callback recovery are unfinished. Factory children are keyless and immutable; changing their behavior requires an explicit migration design. The creation reserve is separate from stake and currently cannot be withdrawn.

Only realized, received yield can fund rewards. Sponsored pilot funding is not an observed yield return. The available buckets remain 50% street coins and 50% zone rewards, with same-bucket carryover. Daily receipt/storage limits and conservative maturity rules are intentional pilot bounds, not the final scale/capacity design.

## Content and device gates

Template proximity checks attest accepted coordinates, not physical truth. Browser GPS spoofing resistance, reviewed routing/access and stronger evidence for valuable tasks still require work. No verified walking duration is invented. Photo observations, authored landmark clues and geocaching are future capabilities until their evidence/review requirements are implemented.

The official starter/model assets are integrated; complete wearable coverage, licensing/trademark review and measured mobile model budgets remain open. A live 3D preview is not evidence that every original inventory/model combination works.

Responsive browser inspection and automated tests do not establish physical-phone, accessibility-assistive-technology or newcomer playtest acceptance. Complete V1 is gated by the journeys in the roadmap, not a completion percentage derived from test count.

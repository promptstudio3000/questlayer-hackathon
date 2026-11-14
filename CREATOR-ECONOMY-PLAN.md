# QuestLayer — creator economy integration plan

Updated 31 October 2026. Accepted product direction for a future integration phase, linked from [the implementation specification](IMPLEMENTATION-PLAN.md). This document specifies intended behavior. Optional demo XP locks, profiles and follows now have a locally integrated runtime/interface; creator payments, native XP locks and paid unlocks remain unimplemented. Local source is not a deployment. Demo micro-GOLD and native yoctoNEAR remain separate ledgers.

The integrated delivery order is in [ROADMAP.md](ROADMAP.md), especially W08 and W09.
The [rule register](docs/GAME-RULES.md) connects these requirements to the design and city-world work.

Implementation boundary: the [current creator integration](docs/CREATOR-INTEGRATION-2026-10-31.md) mounts optional demo authoring, immutable quotes, profile/follow services, independent local operator review/resolve and available-XP/current-level reads. Default configuration leaves publication disabled and creates no creator tables. [Runtime](output/qa/W08-runtime/README.md) and [isolated restore](output/qa/W08-runtime/restore/README.md) evidence use explicit QA-only policies; no production amount has been adopted. Activity rewards, native locks, payments and production governance remain unconfigured. Use the combined development status for remaining acceptance work; financial mechanisms below stay planned.

## Product and navigation

Players can author local quests, follow creators and support their work. Creators commit earned XP while their quests are published. Creator income can come from direct donations, paid access and a bounded creator fund allocated through likes and verified completions.

Add a primary **Community** section with:

- **Nearby:** player-created quests, distance, availability, difficulty and free/paid filters; map and list share the same selection.
- **Following:** new quests and series from followed creators.
- **Creators:** profiles, themes, published quests, series, verified completion counts and participant reviews.
- **My creations:** drafts, publication status, locked XP, participants, earnings and close/cancel actions.

Creator profiles expose **Follow** and **Support**. Following is free and does not require payment, staking GOLD or sharing live location. Reuse the existing player identity and map; creator status is a role, not a second account system.

Move the standalone **Game fund** dashboard to **Settings → Game economy**, also linked from Wallet and creator-fund explanations. Keep its accounting visible and accessible. Creator preferences live in the player's settings; platform allocation controls require an authorized operator.

## Funding and configurable allocation

The proposed starting platform allocation is **10% for creators** from each eligible newly received liquid game contribution. The operator can configure this percentage for future receipts. It is not an additional charge on player principal or retained yield.

After the creator allocation, split the remainder **50% street coins / 50% zones**. For a new 1,000 GOLD game receipt at the starting setting:

| Destination | Amount |
|---|---:|
| Creator fund | 100 GOLD |
| Street-coin fund | 450 GOLD |
| Zone fund | 450 GOLD |
| Total | 1,000 GOLD |

The starting percentage is configurable; it is not an immutable protocol promise. Configuration is versioned and applies only to receipts processed under that version. Existing funding keeps its original attribution. Never take money from published prizes, awarded payouts, pending withdrawals or third-party escrow to activate this feature.

Use integer arithmetic: allocate the creator share by rounding down, split the remaining amount in half and give the indivisible remainder to zones. Record the receipt ID, policy version and all three allocations in one authoritative transaction. A replay cannot allocate the receipt twice.

Eligible sources are newly realized game-yield contributions, explicitly eligible sponsor funding and the finalized treasury share of paid unlocks. Respect earmarked sponsorships. Player deposits, retained player yield, unclaimed backing, refunds and transfers between buckets are not new income. Creator earnings and direct donations are not automatically recycled as game receipts.

Players may direct their attributable creator share to selected creators, with an undirected remainder going to the shared creator fund. This directs an existing allocation; it does not increase the total contribution, tier credit or creator budget. Store attribution before pooling funds and offer the same preference for future receipts. A direct allocation cannot also enter the shared distribution round.

Initially, only accept allocation settings whose resulting bucket shares are valid and sum exactly to the receipt. Show the projected destination amounts before confirmation. A higher creator percentage reduces future funding for other rewards; it never creates extra GOLD.

## XP commitment and level calculation

Publishing a quest locks a system-defined amount of the author's earned XP. Drafts do not lock XP. Commit the XP lock and publication state atomically; a failed publication cannot strand a lock. If moderation reserves XP while pending, show that explicitly and release it on rejection or withdrawal.

Maintain distinct values:

- `earnedXp`: cumulative legitimately earned XP; locking and returning XP do not mint or burn it.
- `lockedXp`: XP committed across unresolved creator quests.
- `availableXp = earnedXp - lockedXp`: XP available for new commitments and used to calculate the current player level.

Example: 1,000 earned XP minus 200 locked XP leaves 800 XP for level calculation. A new publication cannot lock more than the available amount. The required commitment is a versioned platform policy displayed before publication; its exact amount remains a balancing decision.

Locked XP **do not count toward the current level**. Closing or cancelling a quest returns its committed XP after existing participant obligations are resolved. Returning XP is not an earning event. Track one-time level rewards independently so locking and releasing XP cannot repeatedly grant the same reward. Already earned inventory remains owned; actions requiring a current level check the level derived from available XP.

XP cannot be transferred, sold as GOLD or spent as financial backing. The XP lock is a publication commitment, not a yield-bearing financial position. Cancellation does not automatically slash XP. Moderation, creation quotas and abuse restrictions are separate policies and must not silently confiscate the agreed refundable commitment.

## Creator income

### Direct donations

A player may voluntarily donate GOLD from their own available balance before or after participation. Show the amount and recipient before confirmation. Start with **100% of the donation credited to the creator**, with any actual network cost separately disclosed. The 80/20 paid-access split does not silently apply to donations. Donations neither guarantee a prize nor buy verified completion or reputation.

### Likes and verified completions

A like is a signal directing shared creator funding, not a payment from the liker. Clearly label the difference between **Like / Support from the fund** and **Donate GOLD**. Neither is mandatory for a free quest; paid access has its separately disclosed price.

Distribute a fixed, already liquid and uncommitted creator budget over a defined accounting period. Use UTC daily rounds initially. A configurable score combines eligible likes and verified completions; verified completion should carry more weight than a like. Exact weights and caps remain balancing parameters, published before a round starts.

For each round, the author's share equals the round budget multiplied by the author's eligible score divided by the total eligible score. Round down allocations and carry residual units forward. A round with no eligible score carries its budget forward. Reserved round budgets and already awarded claims cannot be reused. Finalization and payout retries are idempotent.

This supports earning from each eligible completion without promising an unlimited fixed GOLD amount per completion. If a future campaign advertises a fixed per-completion payment, it must reserve a finite funded amount and publish its participant cap before launch.

Count at most one eligible like and one eligible completion per player/quest for the initial one-time quest policy. Define eligibility against a quest's stable identity, not each edit or republication. Exclude self-likes and self-completions from financial scoring. A new account is not proof of a unique person: apply published caps, duplicate-evidence checks and abuse review. An author cannot validate their own fund-generating activity without independent validation. Likes alone do not grant XP or participant-review rights.

Freeze eligible scores at round close. Like withdrawal before close updates the score; later changes do not rewrite settled rounds. Flagged activity can be withheld for review under disclosed deadlines; it cannot create an unfunded claim. Author-owned or coordinated accounts must not farm the fund through trivial paid unlocks or repeated quest copies.

### Paid quest access

The author may set a GOLD price for opening the full quest. Show a useful public preview before payment: creator, theme, approximate area, duration, difficulty, availability, price, unlock scope and cancellation terms. For the first version, purchase unlocks that quest for that player; it does not reserve a shared prize or promise completion.

Split each finalized access payment **80% creator / 20% treasury**. For 100 GOLD, credit 80 to the author and 20 to treasury. Compute the creator share by rounding down and assign the remaining indivisible units to treasury. Only the treasury share can enter the new-income allocation policy above, once. The author's share never enters that policy again.

Charge and grant the durable access entitlement atomically in the demo ledger. Native implementation must provide an equivalent recoverable paid-entitlement workflow: a failed attempt must not leave a player charged without access. Repeating the same purchase request cannot charge again. Existing access survives price changes and content revisions within its disclosed scope.

Keep unsettled purchase money separate until access delivery is confirmed. A failed delivery returns the full payment, including the tentative treasury share, without drawing on unrelated reserved funds. After delivery, access remains available for the promised period; author closure must honor existing purchases or apply the disclosed refund policy.

Paid content, answers and protected precise coordinates must not be placed in public SocialDB records, public IPFS media, client bundles or unrestricted API responses. Store public previews and integrity references separately from access-controlled content. Payment cannot make publicly exposed content private.

## Quest lifecycle and participant rights

Use a persistent creator quest/template identity, independent of daily system worlds. Author series and long-lived quests survive world regeneration. Scheduled editions link back to that identity and have explicit availability and claim scope.

Lifecycle: draft → pending review → published → closing → closed, with explicit rejected/hidden moderation states. Publication records author, XP commitment, validation policy, availability, content version, price and funding source. Material edits create a new revision and cannot retroactively change purchased access, submitted evidence or advertised rewards.

An author can cancel a quest. Cancellation immediately blocks new purchases and new starts, then resolves timely submissions, purchased-access obligations and any reserved rewards. Pending reviews do not disappear. Release the XP commitment once closure is complete; retries cannot release it twice. A paid quest must have a bounded review/refund deadline and a defined escalation path before public real-value use.

Community XP/item quests can be completed by a lone player. Optional donations and likes do not gate free participation. GOLD prize eligibility follows the separately disclosed funding policy: paid access, tier requirements and a prize are distinct conditions. No creator can mint arbitrary XP, items or GOLD through the editor. System-controlled reward limits apply.

Externally funded prizes use dedicated sponsored-task escrow and remain separate from access payments, XP commitments and creator-fund rounds. The author, sponsor and validator may be different parties. Preserve existing receipt ordering and exactly-once settlement rules where a shared competitive prize is used.

## Integration with the current application

Reuse existing profiles, quests, claims, history, sponsorship and wallet boundaries. Add capabilities incrementally rather than creating a parallel economy:

| Area | Required integration |
|---|---|
| Identity and profiles | Creator role/profile, follows, public creator page and linked series |
| Quest authoring | Stable creator identity, revisions, moderation, XP lock, preview and close flow |
| Progression | Earned/locked/available XP, available-XP level calculation, one-time level grants |
| Treasury | Third creator bucket, versioned incoming allocation and conserved round budgets |
| Player preferences | Creator-share routing without increasing contributions or tier credit |
| Activity | Likes, authoritative completion evidence, eligibility and deduplicated round scores |
| Payments | Donations, paid entitlements, 80/20 settlement, refunds and earnings history |
| Navigation | Community section; economy dashboard under Settings and linked from Wallet |
| Social publishing | Public profile/follow/preview adapters; protected quest content remains access-controlled |
| Native contracts | Creator funding/claims, XP commitments, paid entitlement settlement and retryable withdrawal |

Suggested records: `CreatorProfile`, `CreatorFollow`, `CreatorAllocationPreference`, `CreatorQuestRevision`, `XpCommitment`, `QuestSupport`, `CreatorRound`, `CreatorAward`, `Donation`, `PaidQuestAccess` and `AccessRefund`. Treat these as conceptual domain records, not a requirement to duplicate existing compatible tables.

All economic mutations bind the authenticated actor, stable operation ID and policy/content version. Funding sources remain attributable. Balances distinguish available, reserved, awarded, withdrawal-pending and paid; conservation includes creator obligations, access settlement and refunds. Demo values never flow into a native payout.

Extend the conservation invariant and storage migration of the contract that holds the live reward buckets explicitly before activating a third funding bucket (the first-alpha `contracts/game` contract was retired on 10 November 2026 and is not that contract). Adding a dashboard bucket alone is not an integration. Follow updates, content publication and money transfers can fail independently; retry them without repeating a charge, award or XP lock. No raw location history or private evidence goes on chain.

## Delivery sequence

1. Add authoritative XP commitment accounting, creator quest lifecycle, moderation and closure obligations.
2. Add Community, creator profiles/follows, Nearby/Following/My creations and move the economy dashboard.
3. Add a versioned creator funding allocation, player routing preferences and transparent bucket accounting.
4. Add optional likes, independently verified completions and bounded daily creator distributions.
5. Add direct donations and paid unlocks with 80/20 settlement, durable access and cancellation/refund behavior.
6. Validate the complete isolated demo flows, then integrate equivalent native testnet contracts, custody-free identity and public social adapters. Keep simulation labels until real integrations are verified.

This phase extends the shared solo loop and the existing sponsorship system. It does not authorize a deployment or mainnet transactions. Existing 50/50 demo accounting remains current behavior until the creator allocation is implemented and migrated.

## Acceptance criteria

- A new player can discover a nearby free creator quest and complete it alone without paying or liking.
- Following an author produces a useful Following view without exposing the player's live location.
- Two simultaneous publications cannot overcommit XP. Locked XP lower the current level; closure releases the exact commitment once and never repeats level rewards.
- A rejected/failed publication leaves no orphan XP lock. Author cancellation resolves paid access and timely evidence before releasing XP.
- A 1,000 GOLD eligible receipt at 10% allocates 100/450/450 exactly; tiny and indivisible amounts also conserve totals. Replays, policy changes and fund rollover create no income twice.
- Enabling creators leaves existing prizes, claims, principal and sponsored-task escrow intact. Direct creator routing cannot also fund the shared round or increase tier credit.
- Distribution never exceeds its reserved creator budget. Zero-score rounds and rounding residuals roll forward; repeated finalization cannot pay twice.
- Self-activity, repeated revisions and replayed evidence cannot generate extra eligible support. Suspicious activity has a defined review outcome rather than an unlimited payout.
- Donate and Like clearly explain whose money is used. Direct donations follow their displayed fee policy.
- A 100 GOLD unlock settles 80/20 once, delivers durable access and counts only the 20 GOLD treasury share as eligible new platform income. Failed delivery refunds all 100 GOLD.
- Price edits and cancellations preserve existing entitlement/submission rights. Protected content is absent from public reads and public storage.
- Creator content survives daily world resets, while expired editions cannot silently reopen or reset reward eligibility.
- Demo creator balances cannot withdraw real NEAR; native testnet evidence separately proves creator awards, XP commitment changes, access settlement and withdrawal failure recovery.

## Remaining balancing decisions

Before activating this phase, set the XP commitment schedule, support/completion weights, per-round caps, creator-routing limits and review/refund deadlines. The product mechanisms and the paid-access 80/20 split are accepted; these numerical parameters require explicit published configuration. The proposed 10% starting creator allocation remains operator-configurable.

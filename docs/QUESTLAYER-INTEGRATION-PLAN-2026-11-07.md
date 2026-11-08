# QuestLayer and Gotchiverse: integration plan

7 November 2026. Owner discussion consolidated for implementation and independent review.
This is a product decision record and staged implementation specification. It does not
change the accepted runtime economy, activate a contract, allocate money, or supersede
existing obligations. Read [the return handoff](CLAUDE-RETURN-HANDOFF-2026-11-07.md)
before applying any code. Repository and product copy remain English.

## Runtime update after the initial plan

The R1 continuation integrates the world picker, shared character and a server-saved
workshop directly into the current game. Invited friends edit the same terrain and
see virtual visitor markers. This is the nonfinancial foundation of R1/R2, not an
activation of the public claim economy. The free private workshop is practice space;
it cannot be exchanged for land, permits, QGOLD or funded rewards. See
[implemented behavior](GOTCHIVERSE.md) and
[the integration evidence](../output/qa/gotchiverse-integration-2026-11-07/README.md).
The standalone study is retained as history, not the entry point of the game.

The next common-world and outdoor-claim implementation is specified in
[separate Claude chapters](GOTCHIVERSE-SHARED-WORLD-PLAN-2026-11-07.md).
The owner's latest direction deferred that implementation to the handoff; this
planning update changes no runtime and adopts no alternative claim pricing.
Review the evidence boundary before issuing permits: a demo receipt labelled
`gps` is not by itself a trusted production outdoor-completion proof.

## What the next experience should do

A player completes a real outdoor adventure in **QuestLayer**, brings a useful
collectible or building permit into **Gotchiverse**, shapes a piece of a shared
virtual landscape, and has a reason to return outdoors. Existing players can meet,
visit, trade and complete virtual quests without pretending that keyboard movement
proves physical presence. Staking funds affordable gameplay through received yield.

The physical game and Gotchiverse share QGOLD and the existing global treasury.
Geocaching is the first additional demonstration layer. Later layers may have their
own staking asset and economics; that flexibility must not fragment the first demo.

The distinctive loop is **outdoor discovery → useful Aura / permit → virtual
building and activity → community choices over future funding → another adventure**.
It can be demonstrated without a token-price-growth narrative.

## Decision provenance

The owner explicitly chose the following direction in the discussion and planning
follow-up. Financial implementation still belongs to the owner's Claude integration
and must retain the normal review and protected-path gates.

| ID | Owner decision | Consequence |
| --- | --- | --- |
| O01 | Names: `questlayer` for the physical layer, `gotchiverse` for the virtual layer | Use a world selector from the logo; do not rename historical financial world IDs |
| O02 | Aavegotchi visual character, simple interaction, no prescribed Gotchi town | Authored open terrain, not a settlement-management game |
| O03 | Minecraft-style landscape editing plus NFT/library objects | Raising/carving terrain is essential; a prefab inventory alone is insufficient |
| O04 | Temporary grid claims earned through outdoor play plus QGOLD | The outdoor and virtual games reinforce each other; money alone cannot claim |
| O05 | 16 × 16 blocks per claim; months/year rather than recurring daily activation | A prepaid valid claim does not require monthly check-ins |
| O06 | Recorded claim terms: 30 days = 1 permit + 0.025 QGOLD; 365 days = 12 permits + 0.25 QGOLD | Proposed future schedule only; confirm token precision and bookkeeping before activation |
| O07 | Claim payments go to the treasury | No claim-payment burn; a payment is not an ownership transfer of backing assets |
| O08 | Expired builds remain visible and stop accepting edits | Original claimant can renew while nobody else has taken over |
| O09 | On takeover, archive the old blueprint and start from natural terrain | Personal NFTs stay with their owner; archiving never conveys custody |
| O10 | Simple owner-and-friends editing | No parcel councils, territorial politics or elaborate permissions hierarchy |
| O11 | 10% of received game-directed staking yield goes to equipped Auras | This is a finite shared budget, not a guaranteed return per NFT |
| O12 | Aura rarity changes its share; Explorer reach is the useful bonus | Find Auras outdoors, then use or trade them across the two layers |
| O13 | QGOLD DAO votes over treasury/backing strategies and next week's world budgets | Snapshot balances, no voting lock; administrator confirms before execution |
| O14 | Initially invest at most half of free QGOLD backing; retain liquid NEAR for the remainder | Encumbered liabilities and pending withdrawals are excluded before computing the investable portion |
| O15 | AI researches strategies and proposes allocations weekly | Reviewed adapters and deterministic constraints govern execution |
| O16 | Private QGOLD transfer/swap agent is lower priority | Do not delay the playable core to add another payment surface |
| O17 | Geocaching is the first extra-world prototype | Snake and car-route concepts remain backlog |

These are **engineering/tuning proposals**, not additional owner decisions or
adopted economy constants: four active neighboring claims per account; one
nontransferable permit from the first eligible outdoor quest per day; Aura rarity
weights 1/2/4/8; Explorer bonuses 0/10/25/50%; highest bonus rather than stacking;
10% voting quorum; weekly timetable and a 48-hour execution delay. Keep them together
in a versioned proposal, obtain product review, and use existing invariant tests
when financial implementation is explicitly undertaken. Do not quietly write these
values into protected catalogs during UI work.

## 01 — Worlds, identity and switching

Introduce a small `RealmDescriptor` alongside existing geography/WorldPack concepts.
A realm selects movement mode, renderer, content rules and economy reference. A
WorldPack remains a reviewed theme on geography; it is not the new virtual realm.
Existing city/day worlds, accepted quests, receipts and native allocation IDs keep
their identity. Never regenerate them merely because a player changes the selector.

`questlayer` uses actual GPS outside the explicitly labelled arena. `gotchiverse`
uses virtual movement. `geocaching-preview` is a separate demo with fictional
examples. Carry shared identity, verified appearance and compatible inventory;
keep position, objective, camera and admission proof scoped to their realm.

The first implementation should lazy-load the virtual renderer after selection.
Preserve the 220 KB first-load JS budget. Reuse the installed rendering stack before
adding anything. Switching must not sign, spend, re-admit a quest, duplicate a
completion, leak live GPS to another player, or turn simulation into reward proof.

**Acceptance:** switch away and back during a quest; retain its current requirement;
no extra settlement; separate positions; no wallet needed to try the virtual world;
loading, unavailable and offline states retain a clear return action.

## 02 — Gotchiverse terrain and shared activity

Use a deterministic, practically extensible landscape divided into 16 × 16 chunks.
Generate natural terrain by seed and store reviewed edits. Load a bounded nearby
window; do not pre-create an infinite database or download the whole map. A world
seed/version is a content contract; publishing a new seed cannot erase builds.

Start with an isometric camera, character movement, a small block palette, raising,
lowering and changing terrain, plus placing/removing owned display objects. Water
is a static material in the first version. Defer fluids, circuits, falling blocks,
complex physics, imported executable assets and destructive simulation. Add
occlusion/ghosting where terrain obscures characters. Match original appearances
and verified wearable art before claiming cross-world visual continuity.

Interactions in this realm can reuse quest requirements, NPC roles and once-only
receipts where their admission rules are compatible. They must have distinct
virtual proofs and funded budgets. A virtual NPC quest must not resolve a physical
visit or consume a physical objective's reserved reward.

Store edits authoritatively on the server with a chunk revision and idempotent edit
ID. Reject stale revisions with an understandable refresh/retry result. An atomic
cell update plus revision check is sufficient initially. Only the current claim
owner and invited friends edit. Friends cannot extend leases, spend the owner's
funds, move a personal NFT, or administer invites. Put a simple invite/revoke
control behind ownership checks. Nearby activity updates can use the existing SSE
transport after authentication/permissions review; client checks are never authority.

NFT placement is a non-custodial display reference with an ownership source, token
ID and checked media. Reject scripts/untrusted HTML; keep original art provenance.
On ownership loss, remove the display entitlement without moving or burning the NFT.
Archive a blueprint's reference without conferring the old owner's placement rights.
Library props have a separate licence and entitlement. Terrain ownership never
conveys another player's collectibles.

**Acceptance:** two editors update the same block without lost writes; a revoked
friend's next edit fails; a boundary edit cannot affect a neighbor; ownership loss
removes a display; reconnect recovers the actual revision. A 360px phone has usable
selection/edit controls and an alternative to precise tapping or dragging.

## 03 — Outdoor permits and temporary claims

One long-lived claim covers one grid cell. Claims grant editing rights for a term,
not permanent land/NFT ownership. Keep the world open for visiting without a claim.
Avoid a scarce central hub where early purchasers permanently control useful play.

An eligible **verified physical quest** can issue a nontransferable permit through
an existing durable completion receipt. The proposed first-quest-per-day rate
should use an explicit UTC or player/world-day policy, never the browser clock.
Arena/demo claims and permits are separate. Ordinary free adventures remain useful
without money and without needing to claim land.

For the integrated paid claim, bind the exact realm/grid/term/claimant/price/permit
receipt/expiry to one operation. Reserve the permit and claim atomically, then use
reviewed settlement and refund/reconciliation. If two people target an expired
cell, exactly one wins. Failure or uncertain payment retains the original build,
permit entitlement and a durable operation record. No debit-until-retry shortcut.

Lifecycle:

1. **Unclaimed:** anyone visits; a valid permit plus funded payment can create a claim.
2. **Active:** owner and invited friends edit; everyone else visits.
3. **Expired:** the build remains visible and read-only. The previous owner may
   renew if the claim has not been taken. No monthly activation during a prepaid term.
4. **Taken over:** persist the old blueprint before committing the new claim;
   reset that cell to its deterministic natural seed; keep personal NFT ownership
   unchanged. The old claimant can export/rebuild on another valid claim.

Archive metadata should distinguish authored terrain, media references and rights
that may no longer be held. Do not copy another player's NFT into the new claimant's
inventory. Define retention/export policy before launch; the isolated prototype
currently preserves archive previews only in-session and makes this visible.

**Acceptance:** simultaneous claim, exact renewal boundary, lost callback, expired
quote, replayed permit, takeover crash before/after archive, unavailable storage,
pending withdrawal and revoked friend. Existing reward/financial rights survive.

## 04 — Auras: a share of received yield and useful reach

The approved mechanism uses **10% of received game-directed staking yield**, first
accounted as a single actual funded daily budget. Do not take 10% from principal,
player-retained yield, outstanding withdrawal rights, pledged backing or already
reserved quest payments. The remaining game budget must cover its existing rights
before any new discretionary allocation.

An Aura earns while equipped and eligible; it need not be online every day. Use
time-weighted equipped seconds and a proposed rarity weight. Count the same NFT
once globally. Sale, escrow, transfer and unequip terminate the old interval at the
authoritative event boundary. Settlement belongs to the account entitled during
each interval, rather than whoever owns it when a worker runs. A late market event
must not make two accounts eligible for the same seconds.

For a funded day with budget B and eligible weighted seconds W:

`player entitlement = B × player weighted equipped seconds / W`

Use exact integers and a deterministic rounding/carry policy. At zero yield, B is
zero. At W=0, carry the allocation under an explicit policy; never divide by zero or
fabricate income. New claims cannot consume already committed Aura payouts.
Time weighting reduces last-minute equipping, but does not make account splitting
or two-slot advantages disappear; review them explicitly before activation.

Use one durable daily receipt and an idempotent claim/payout. Show the actual
received amount, denominator, eligible interval and settlement status. Current
QGOLD mint/burn/backing semantics must determine the conversion: never mint a daily
QGOLD reward merely from an estimated NEAR return or an unreviewed market price.

Explorer reach should make an otherwise too-distant eligible point interaction
reachable within a modest disclosed bonus. Proposed rarity bonuses: 0/10/25/50%,
using the highest equipped bonus. Apply it consistently on server and UI. It does
not move zone polygons, bypass closures or access restrictions, repair inaccurate
GPS, complete ordered steps out of sequence, or certify a walking route. A physical
quest that requires an actual visit needs a deliberate per-template decision before
range bonuses apply. This boundary resolves the tension between useful reach and
honest location proof.

In Gotchiverse the same Aura can extend interaction/build-tool reach, but never
editing rights beyond an active claim. Locate new Aura discoveries in the physical
game; the virtual layer provides a second use and social display. Do not add the
other previously discussed Aura masks, tricks or extra currencies to this version.

**Acceptance:** partial-day equipment changes, midnight, sale and duplicate worker,
zero yield, delayed receipt, mixed rarity, two accounts equipping one NFT, rounding,
closed zones and virtual/physical proof separation. Free quests remain completable.

## 05 — QGOLD DAO and weekly AI proposal

The community chooses next week's portfolio and discretionary world budgets. Start
with QGOLD balance snapshots without locking the token. This needs historical
`balance_at` and eligible-supply checkpoints or another independently verified
snapshot mechanism. Reading today's balance after a token transfer lets the same
tokens vote repeatedly and is unacceptable. Use a finalized block before proposals
open, deterministic exclusions, one recorded vote per eligible account, and an
auditable tally. Treat delegation and a transferable profile separately.

The initial proposal is one coherent weekly yes/no plan with quoted sources, exact
adapter IDs, allocation bounds, liquid reserve, existing obligations, execution
window and expected costs. A proposed starting quorum is 10% of eligible supply,
with strictly more than half of cast weight supporting the proposal. Those numbers
are proposals, not current rules. No quorum keeps the previous safe allocation;
expiry, stale prices or unavailable adapters require a refreshed proposal.

AI produces a weekly research brief: available allowlisted strategies, evidence
dates, contract identities, liquidity/unbonding, fees, dependencies, loss risks and
an allocation explanation. It may recommend **no change**. An advertised APY is
neither safety evidence nor a funded reward. Do not let a model add a newly found
protocol to an execution allowlist.

After the vote, an administrator confirms the exact reviewed plan. Proposed delay:
48 hours before execution; emergency pause can prevent new exposure but cannot
redirect vested player rights. A deterministic executor validates the snapshot,
tally, limits, available liquidity and exact adapter calls. Preserve a receipt for
each step and unknown outcome. The AI does not hold an unrestricted signing key.

Use Sputnik DAO or Trezu for the treasury/custody execution boundary where a reviewed
integration fits. Do not claim that a multisig alone supplies QGOLD holder voting,
historical snapshots or autonomous portfolio management. Investigate existing token
governance support before deciding whether a separate ballot adapter is required.

**Acceptance:** tokens move between voters, stale proposal, denied administrator
approval, minority/no quorum, missing checkpoint, execution interruption, changed
contract/price and simultaneous withdrawal. A vote cannot spend encumbered backing.

## 06 — Treasury strategies, backing and sustainable rewards

Use separate accounting categories for player principal/retained entitlement,
QGOLD backing, liquid withdrawal reserve, outstanding claims, received game surplus,
Aura allocation and uncommitted world budgets. Categories are rights and constraints
over assets, not additional assets to add together. Never count the same NEAR twice.

The approved initial exposure ceiling applies only to **free investable QGOLD
backing after liabilities and reservations**. Keep at least the chosen liquid
remainder; if withdrawals or market losses make the reserve insufficient, stop new
investment and discretionary rewards before harming existing rights. A mark-to-market
gain is not automatically liquid or spendable. Contract upgrade and strategy risk
remain even for liquid staking.

Research cash NEAR, stNEAR and LiNEAR as initial candidates, subject to current source
verification and reviewed adapters. They are candidates, not installed integrations
or guaranteed safe investments. Defer borrowing, leverage and LP rebalancing.
Received liquid yield first meets the approved accounting policy, including the
Aura allocation, then funds future gameplay. Weekly world-budget votes change
future uncommitted money; they cannot rewrite accepted quest payouts.

Avoid promising automatic token-price growth. Greater adoption can increase
contributions and fees, but costs, liquidity needs and asset losses can reduce
distributable rewards. Explain funding with actual receipts and a sensitivity
model, not a rising token-price chart.

**Acceptance:** zero/negative yield, actual unbonding delay, partial liquidity,
multiple pending exits, strategy failure, price change, dust and retries. Preserve
all existing invariant tests and add a conservation test that spans the new buckets.

## 07 — NPCs, private AI and agents

Keep deterministic game requirements and settlement. Use AI for bounded, useful
interaction: a storyteller remembers a player's voluntary choices, a quest giver
selects an appropriate already valid adventure, and a guide gives a concise hint
based on accepted quest progress. Generated prose cannot mint stock, change prices,
grant rewards, invent a safe path, bypass GPS or create an unreviewed destination.
Short dialogue and an offline/template fallback remain essential.

The strongest private mini-game candidate is a **sealed-choice negotiation/riddle**:
each player supplies a private clue, the referee combines only the agreed fields,
and the public result reveals an outcome rather than the raw answers. A deterministic
result verifier must define scoring and rewards; AI may narrate or judge only a
bounded rubric with an appeal/fallback rule. For a genuine hidden-information claim,
review the whole ingress, logging, inference and output path. An ordinary game server
that sees the secret cannot be described as blind just because inference uses a TEE.

Use an explicitly confidential model route and verify its attestation before making
privacy claims. Minimize prompts: a quest requirement and coarse setting can be
enough, instead of exact GPS, wallet history or player identity. Private inference
does not hide public blockchain transfers or the final published result.

NEAR AI's staking-funded compute can be useful for operating NPCs. It redirects an
economic resource into compute credits; the same yield cannot simultaneously fund
player rewards and inference. Put compute sponsorship in its own budget. Verify
actual current model route, credit terms, token limits and availability before
integrating. The existence of a private pool does not itself provide unlimited free
inference. Sources: [NEAR AI staking](https://near.ai/blog/staking-for-near-ai),
[NEAR AI terms and route distinctions](https://near.ai/terms-of-service).

For Agent Economy, make one constrained keeper/NPC perform an actual useful job
under a bounded budget and durable receipt. A character that merely talks to an
LLM has not demonstrated an agent economy. Do not give every NPC an unrestricted
wallet just for track coverage.

## 08 — Intents and P2P exchange

P2P exchange is compatible with NEAR Intents. The official verifier describes
atomic peer-to-peer token exchanges; a peer can supply the matching signed intent.
It does not require an AI solver. A solver finds/composes a valid match and submits
execution; it can be an ordinary service, another player or an AI-assisted process
with deterministic checks. Source: [official verifier repository](https://github.com/near/intents).

Distinguish a signed game order/intent from execution through the NEAR Intents
verifier/solver network. Existing QuestLayer signed Aura-market orders are not
automatically proof that the public solver network supports those NFTs or QGOLD.
Before marketing that integration, confirm supported asset standard, deposits,
liquidity, nonce/deadline, cancellation, settlement and an actual fulfilled receipt.

Quest completion, delivery of a physical service and subjective dispute resolution
need a separate escrow/evidence/adjudication mechanism. The token swap primitive
does not independently prove a person completed a real-world task. AI may propose
matches or help triage evidence; it must not decide financial success from invented
facts. The lower-priority transfer agent needs explicit destination, supported route,
asset/amount/deadline and a bounded spend policy. A private prompt does not make an
arbitrary destination or the chain transfer private.

## 09 — Geocaching and the first presentation

The geocaching prototype has a clue, cache, visit evidence and a durable collection
result. Start with fictional/demo locations and no financial payout. A real cache
requires a reviewed safe location, permission/maintenance, anti-spoof proof and an
appropriate once-only or repeat policy. Do not represent a map point as an installed
physical cache. Keep snake/racing ideas separate until this loop is coherent.

The final recorded scenario should show:

1. Solo entry without a wallet or deposit; one clear outdoor/demo adventure.
2. A confirmed receipt, actual earned collectible, and a visible equip action.
3. Gotchiverse selection, a permit-based claim demonstration, terrain editing and
   placing the same eligible collectible without transferring its ownership.
4. Actual received game yield, its dated funding receipt and exact division into
   committed obligations/Aura allocation/future budgets. If no live yield is
   available, use a visibly labelled sandbox trace; do not stage a live result.
5. One sourced weekly AI proposal, QGOLD snapshot tally, human confirmation and a
   bounded execution/reconciliation receipt, if actually implemented.
6. Expiry/unknown-payment behavior and a useful next adventure.

Primary track: Games With Real Economies. NFTs That Do Something and Social Money
become strong secondary fits when their behavior is working and evidenced.
Unstoppable DeFi and Agent Economy require actual settlement/strategy/agent work;
Privacy & Private AI requires an actual confidential path. Track selection is a
claim about delivered behavior, not the number of ideas in this document.

## Implementation order and review ownership

| Stage | Deliverable | Status in this delivery | Review / exit gate |
| --- | --- | --- | --- |
| D2 | Source inventory, plan, change ledger, frozen candidate references | Implemented documentation/evidence | Verify manifests and drift; preserve other streams |
| P0 | Local Gotchiverse terrain/claim interaction study | Implemented isolated prototype | Model tests and browser evidence; not mounted in the game |
| R1 | Lazy realm selector and shared identity contract | Implemented in the local game candidate; see the integration report | Preserve current App/UI changes and historical world IDs |
| R2 | Authoritative terrain, simple friends and revisioned edits | Implemented for bounded workshops; public-world chunks remain planned | Concurrent edits, revocation, offline recovery, phone review |
| R3 | Verified outdoor permits and paid claims | Owner Claude; protected integration | Exact permit/payment/claim conservation and recovery |
| R4 | Aura allocation and reach | Owner Claude; protected integration | Funded budget, ownership intervals, proof boundaries |
| R5 | DAO snapshot ballot and weekly AI research | Planned; owner for governance/finance | Historical balance proof, tally and exact plan review |
| R6 | Backing strategy execution | Owner Claude; protected integration | Liquidity, adapters, conservation, independent security review |
| R7 | Geocaching layer | Local clue sample only | Reviewed real location/proof before activation |
| R8 | Demo and submission evidence | Script/evidence plan only | Recorded named build; claims match delivered behavior |
| R9 | Private transfer agent/profile NFT | Deferred | Separate threat model, account/asset recovery and supported routes |

Use a separate scoped branch/PR for each runtime stage. Update the corresponding
wiki chapter and stamp only when a mechanism is implemented. This proposal and
standalone study deliberately do not describe new mechanisms as already in force.
Complete independent review of the security candidates before adding financial
surface. No deployment is authorized by this document.

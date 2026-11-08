# Hackathon positioning and public demo-post review

Verified public-source snapshot, 7 November 2026. No project was adopted as a design
reference for the approved QuestLayer/Gotchiverse plan. This is a factual directory
and positioning review, not a code/security review of competing submissions.

## Directory coverage

The [public directory API](https://nearhackathon.com/api/projects?page=1) reported
**242 projects**, page size 8. All 31 pages were fetched without failed pages and
produced 242 unique IDs at `2026-11-07T14:13:21Z`. Pagination is not an atomic database
export: entries can change while pages are fetched. This is a dated observation,
not a permanent total. Raw page snapshots and normalized rows are in
[`research/`](../output/qa/claude-return-2026-11-07/research/directory.json).

| Track | Listed entries |
| --- | ---: |
| AI Security & Defense | 128 |
| Agent Economy | 120 |
| Real-World Money | 49 |
| Autonomous Business | 42 |
| Open Innovation | 41 |
| Unstoppable DeFi | 38 |
| Privacy & Private AI | 37 |
| Investment Thesis | 23 |
| NFTs That Do Something | 17 |
| AI Swarms | 17 |
| Social Money | 12 |
| Games With Real Economies | 11 |
| Memecoins With Mechanics | 5 |

Counts overlap because projects select several tracks. Small track counts are not
a win probability. The [organizer's rules](https://nearhackathon.com/HACKATHON.md)
state one grand prize and three places per track, with one submission per project.
They require a public repository plus a demo post with video/screenshots. The
published deadline is 14 November 2026, 23:59 UTC; refresh rules before submission.
This task submitted or posted nothing.

## Demo-post reading scope

Selected every directory entry tagged games, social or NFTs: **35 projects**.
Public X embed responses supplied readable post text for **32**. Some responses
contain truncation/ellipsis; no claim is made to have read the entire thread,
watched the attached video or inspected its implementation. Three did not provide
readable X text through this method: Chai Pot on NEAR, Zinc and SCOGÉ Universe.
The last two directory links point to websites. Their unavailable status does not
establish that their product/demo is broken.

These summaries describe authors' posts, not verified product behavior. Every
project below has its direct listed demo source. Captured statuses, short excerpts and text digests live in
[`demo-posts.json`](../output/qa/claude-return-2026-11-07/research/demo-posts.json).

### Games

| Project / demo source | What the author presents |
| --- | --- |
| [TreasureHunt](https://x.com/Sparkler_Labs/status/2114194006947291518) | Token/NFT treasure campaigns driven by clues and community discovery. The retrieved text alone does not establish a new physical GPS game. |
| [Nims](https://x.com/marrnueldev/status/2118292623358341128) | Agent merchants with individual wallets, supply-sensitive prices, multi-token goods and email entry. |
| [Maven](https://x.com/josephmarv3016/status/2118398854609387999) | Policy-constrained agents and verifiable economic decisions; the post is broad rather than a detailed gameplay proof. |
| [Agent Undercover](https://x.com/necklace_btc/status/2118430392734888088) | A deception game with agent participants, committed votes and escrow settlement. Its staking/betting direction is outside QuestLayer's approved scope. |
| [DiveMarket](https://x.com/agungkzn/status/2118582497793691861) | A fishing economy built around item supply, prices and uses. The captured first post links to a thread. |
| [Nearverse](https://x.com/gabquelyn/status/2118602977363784094) | Social sign-in and a hunt/haul/sell loop with reduced wallet friction. Treat its stated token-standard wording as the author's claim. |
| [Overclock](https://x.com/AlvinAgustus/status/2118703283502227812) | Agent duels with matchmaking, on-chain answer commitments and a token-burning mechanic. |
| [DUEL](https://x.com/tajudeen/status/2118711739793408144) | Escrow-backed challenges between friends. The read post is partial; do not infer complete dispute rules. |
| [Bazaar Sovereign](https://x.com/ReconScribe/status/2118951990667710788) | NFT-owned agent merchants that negotiate and react to competitors; free entry is advertised. |
| [NEARlyHuman](https://x.com/alphastack1/status/2118877597023269366) | Collectible AI rooster NPCs, daily supplies and NEAR Cloud-related verification. |
| [SCOGÉ Universe](https://www.scoge.world/) | Directory tags games/NFTs/open; no readable X post was captured by the selected method. |

### Social Money and community coordination

| Project / demo source | What the author presents |
| --- | --- |
| [Petty Cash](https://x.com/kasbsquall95/status/2117473026732437544) | DAO spending envelopes with fast rule-compliant payments and council review for exceptions. |
| [Patch Fund](https://x.com/surthenort40906/status/2117717450783633412) | DAO-funded security work with payout review depending on earned trust and amount. |
| [Proof of Ship](https://x.com/HeyResearch/status/2118011068731854972) | Builder escrow tied to shipping evidence; the captured excerpt describes an earlier-chain origin and is truncated. |
| [Roomy](https://x.com/FocoBernardo/status/2118698850445586812) | Shared-household expenses, cross-chain stablecoin payment claims, and separate testnet escrow/DAO scope. |
| [AllTogether](https://x.com/MAarashAlijo/status/2119059717540712799) | Coordinated community budgets with a DAO match and an all-or-refund funding condition. |
| [Dragons Market](https://x.com/DragonsOnNear/status/2118729901847007494) | Precommitted prediction-market rules and a dispute jury. Prediction/betting is not part of the approved QuestLayer direction. |
| [NDBOT](https://x.com/cryptoworld_by/status/2117309648709538189) | Convenient trading-bot entry; the short post does not independently establish all selected track mechanics. |
| [TheRascalsDotFun](https://x.com/therascalsfun/status/2118272084346593280) | Community-driven trading preferences; the retrieved excerpt is partly promotional/truncated. |
| [Ash.](https://x.com/i_am_festac/status/2118371914884211011) | Agent actions, expenses and results with claimed independent verifiability. |
| [Boyun](https://x.com/QianCherry2102/status/2119005602223444412) | Financial/economic agent simulation with private constraints and information exchange; excerpt is incomplete. |
| [Chai Pot](https://x.com/farhanakhan33/status/2117851251048079595) | Listed for security/agents/social; no readable post text captured. |
| DUEL | Also selected Social Money; see the Games row. |

### NFT behavior beyond pictures

| Project / demo source | What the author presents |
| --- | --- |
| [Veridom Pay](https://x.com/KhDidukh/status/2116683395585691855) | Inspection-backed construction milestones represented as transferable financial NFTs. |
| [Deed](https://x.com/Szczypek_96/status/2117369764112932935) | Sale of an account-owning NFT with protection against the seller changing inspected assets. |
| [Release Passport](https://x.com/surthenort40906/status/2117717055579501036) | Transferable release authority and a bonded account attached to an NFT. |
| [Handover](https://x.com/ApexSys_Dev/status/2118392517699780924) | Transfer of a wallet-controlling NFT using chain signatures instead of sharing a seed. |
| [Phylaxtag](https://x.com/nestarich07/status/2118754817711784305) | Product identity and a warranty reserve that follows resale. |
| [OneUp](https://x.com/EthBoi_/status/2118836495641461214) | An NFT associated with trading loss and subsequent revenue participation. |
| [Logen](https://x.com/chennl1u/status/2118871692261147135) | Transfer of an NFT-controlled account and its contents, with public attack demonstrations claimed. |
| [Outlive](https://x.com/olaph_lol/status/2118877859389530222) | Transferable API-business custody, treasury and customer-service configuration. |
| [Torch](https://x.com/BimaJadiva07/status/2118949693963321612) | NFT-associated account baskets of tokens. |
| [Writ](https://x.com/Viktor_ella_/status/2119003082897936792) | Transferring operational contract authority together with a project's other deliverables; excerpt is partial. |
| [Agent NFT](https://x.com/neqro_61/status/2119053192746942910) | An NFT-controlled wallet with agent spend limits, target policy and risk filters. |
| [ArchivePass](https://x.com/MAarashAlijo/status/2119056656256598343) | Transferable archive stewardship, an upkeep fund and proof-conditioned keeper payments. |
| [Zinc](https://zinc-demo-production.up.railway.app/) | NFT track directory entry; the listed link is a website, not a captured X post. |
| Bazaar Sovereign, NEARlyHuman, SCOGÉ Universe, Dragons Market | Also selected NFTs; see the Games/Social rows. |

## QuestLayer's strongest claim

The strongest submission is a complete outdoor/virtual economy experience with
clear actions and receipts, not a list of integrations. The owner explicitly does
not want a competitor-inspired town or a clone of these submissions. Keep the
approved product direction independent.

| Track | Fit | Evidence needed before selecting/claiming it |
| --- | --- | --- |
| Games With Real Economies | Primary | A playable solo loop, meaningful items, affordable funded rewards and recovery |
| NFTs That Do Something | Strong secondary when implemented | An actual Aura changes reach/eligibility or receives an accounted funded allocation; original appearance linking alone is weaker |
| Social Money | Strong secondary when implemented | QGOLD-holder choice, a verifiable snapshot/tally and an actual treasury execution boundary |
| Unstoppable DeFi | Conditional | A working reviewed strategy/yield/settlement cycle; staking copy and a projected yield graph are insufficient |
| Agent Economy | Conditional | An agent actually performs a useful bounded job and accounts for spend/earnings; NPC dialogue alone is insufficient |
| Privacy & Private AI | Conditional | A real confidential path with attestation/data-flow evidence and a deliberately limited privacy claim |
| Open Innovation | Optional | Explain the joined outdoor/virtual mechanism, without using it as a substitute for a finished primary loop |
| AI Swarms / Autonomous Business / AI Security | Peripheral at present | Would need additional substantial delivered behavior; do not stretch the submission for track count |

These assessments are our inference from the published
[track descriptions](https://nearhackathon.com/#tracks), not organizer approval.
The site permits multiple track selections for one project; it does not guarantee
separate awards merely because a checkbox fits a roadmap idea.

## Novelty and realistic winning prospects

Token-backed collectibles, wallet NPCs, account NFTs and staking-funded play all
have precedents. The read posts already show substantial overlap with broad
"AI NPC" and "NFT wallet" claims. We should not present any of those alone as a
first-ever invention.

QuestLayer can stand out through the **combination** of real outdoor discovery,
useful equipment, temporary claim rights earned through activity, terrain authored
by players and community control of future yield-funded content. The expiry rule
retains a visible build while returning edit rights to circulation; it connects
continuity with an open map. The Aura mechanism makes rarity compete for a finite
received budget rather than promising a fixed emission. These are design arguments
to prove in a coherent slice, not established comparative superiority.

The most damaging gaps would be an unclear first action, simulation presented as
real-world proof, money claims ahead of funded receipts, inaccessible phone controls,
or financial recovery/security unresolved at submission. A recorded end-to-end
scenario with honest limitations can be stronger than many disconnected prototype
screens. Our code review of other submissions is incomplete, judging weights and
future entries are unknown, and the 242 count cannot support a numerical win chance.

Practical priority: finish the Games loop and stable demo, independently reconcile
the security candidates, then add only a secondary track with a working proof.
Use the [integration plan's presentation scenario](QUESTLAYER-INTEGRATION-PLAN-2026-11-07.md)
to show received yield, reserved gameplay, actual outcomes and the next useful
player action. The final video should identify sandbox and production evidence at
the point it appears.

## Intents and compute clarification

The official [NEAR Intents verifier](https://github.com/near/intents) supports
atomic P2P token exchange. The [solver documentation](https://docs.near-intents.org/integration/market-makers/introduction)
describes quoting/matching and submission to the verifier. A solver can be software
assisted by AI; AI is not required. Matchable signed token orders and proof that a
person fulfilled an outdoor task are separate concerns. Existing signed QuestLayer
orders do not by themselves prove public-solver support for QGOLD/Auras.

[NEAR AI staking](https://near.ai/blog/staking-for-near-ai) can fund compute credits
using staked capital/yield. This is useful for NPC operating costs but not unlimited
free computation. That yield cannot also be booked as player reward income.
[Current route terms](https://near.ai/terms-of-service) distinguish confidential and
other provider routes; verify the selected route and attestation before saying a
particular game interaction is private. No inference account/key was accessed or
created for this research.

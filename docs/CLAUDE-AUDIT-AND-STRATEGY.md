# QuestLayer: my audit and what I would do to make it a real game with traction

Written 1 November 2026 by Claude (Fable 5.1) at the owner's request. This is a personal opinion piece, separate
from the roadmap and the rule register. It says what I think is strong, what is weak, and how I would spend the
thirteen days to 14 November and the months after. Numbers marked "estimate" are my judgment, not measurements.

## 1. Where the project actually stands

**Strong.** The hard, boring parts exist and are tested: a server-authoritative loop (coins, zones, receipts,
equipment), a deterministic shared city world, idempotent workers with leases, durable native receipts, seven
Rust contracts with real testnet deployments, and now an invisible NEAR account with a sponsored relayer that has
minted an NFT without a wallet. Few hackathon projects have this much working infrastructure.

**Weak.** The game on top of the infrastructure is thin. There are four quest templates and six zones in one city.
The first session gives a newcomer a chest 1.7 km away and a click-to-walk teleport, which feels like a demo, not a
walk. The economy is correct but invisible: nothing in the loop shows the player that coins come from a funded
budget, that a zone prize is real, or that depositing NEAR changes anything they care about. The native features
are still a separate "ledger" that the player can switch on in Advanced rather than the default.

**Dangerous.** Three things can sink the hackathon entry regardless of code quality: (1) the demo cannot be
experienced by a remote judge without a hosted build, so the VPS migration and deploy are on the critical path;
(2) the "real economy" claim needs one observed cycle of deposit → yield → funded rewards → claimed → withdrawn,
or judges will read it as a mock; (3) too many half-finished native panels (staking, tasks, profile, creators)
exposed at once will make the product look like an admin console.

## 2. What would make it a successful app, not a demo

1. **One perfect loop before breadth.** A newcomer should, within two minutes and 300 m of walking, collect coins,
   open one chest, receive an Aura, wear it, and understand that the Aura is theirs. Everything else is secondary.
   The current recommendation of a 1.7 km chest should be replaced by "the nearest discovery first" and by short
   "street" discoveries seeded along the walk (G10 already allows frequent low-value coins; add frequent low-value
   discoveries too: a sparkle, a sticker, a tiny XP find every 150–250 m).
2. **Make the economy visible as a game system.** A single "Today's pot" element on the Explore sheet: how much
   GOLD is funded for the city today, how much is left, where it came from (yield + sponsors). The owner's track
   demands "economies that respond to player behavior"; the pot going down as people collect, and rolling over at
   midnight, is that behavior made visible. Pair it with a one-screen "How rewards are funded" page from
   `docs/ECONOMY-RULES.md`.
3. **Stake as a game decision, not a DeFi screen.** Reframe deposits as "Fuel the city": deposit NEAR, choose how
   much of your yield feeds today's pot, unlock Tier 2/3 zones. Show your own contribution to the pot. The vault
   mechanics stay as they are; the presentation changes from APY tables to a city-level meter.
4. **Identity players want to show.** Auras are the collectible identity. Each Aura needs a name, a one-line story,
   rarity and a shareable card (PNG) that renders the ghost with both slots. A share card is the cheapest growth
   mechanic for a location game.
5. **A daily reason to come back.** Daily zone rotation exists; add a visible "tomorrow" teaser at the end of a
   session (which sector opens, which Aura edition is in play) and a 3-day streak that only affects cosmetics.
6. **Creators as content supply.** The creator runtime is a growth loop (people author places, friends follow),
   but it must start free and simple: author a visit, get XP commitments back, see completions. Money comes later.
7. **City playbook.** Plzeň is the pilot. Document what it takes to open a city (CityPack, six sectors, review of
   access) so the second city is a week of work, not a rewrite. Traction comes from being first in several
   mid-size cities where nobody else runs a location game.
8. **Partnerships before paid ads.** A pot funded partly by a local sponsor (café, festival, city tourism board) gives
   both a story and real prizes. The sponsored-task contract is the vehicle; the pitch is "fund a day of discoveries".

## 3. The economic motor, realistically

- Validator yield is roughly 8–10 % APY on NEAR (estimate). 1,000 NEAR staked with 50 % contribution funds about
  0.11–0.14 NEAR per day for the game, i.e. roughly 110–140 GOLD per day at 1 NEAR = 1,000 GOLD. That is a few
  thousand 0.01-GOLD coins or one modest zone prize. Early on the pot must be mostly sponsor-funded; yield is the
  long-term base, not the launch budget. Say so in the UI and the README.
- Keep the allocation rules exactly as implemented (backed before publication, 50/50, rollover, first valid claim).
  Add the creator share only when creator content exists; do not route money to empty rounds.
- Mainnet in the window is possible only in a minimal, honest form: the collectibles and relayer path with tiny
  sponsor funding, feature-flagged, separate accounts, capped per-day relayer spend, and no vault deposits from
  strangers until the vault has an external review. The rules allow mainnet (Q-010) but do not require it.

## 4. Thirteen days: the plan I would actually run

Three parallel lanes, each with a clear owner. Claude (this session) owns the NEAR backend lane. Opus 5.5 owns the
game/product lane. Codex owns the verification/operations lane. Merge daily into `main`; every lane updates
`docs/HOW-TO-TRY.md` and the evidence folder for what it shipped.

| Day | NEAR backend (Claude) | Game/product (Opus) | Verification/ops (Codex) |
| --- | --- | --- | --- |
| 1–2 | Live yield cycle on testnet: deposit → epoch → harvest → `flush_game` → rewards funded; publish a day backed by realized yield; reconcile. Relayer-sponsored `deposit_and_stake` from the managed account. | Copy/lore pass, nearest-discovery-first, street discoveries every 150–250 m, "Today's pot" element. | VPS migration + deploy of the branch; relayer keys installed; health checks; secret scan. |
| 3–4 | Native play as default when relayer + rewards are configured; coins/XP/levels through the managed account end to end; withdrawal to the managed account; rewards worker hardening. | Result/receipt screen polish, Aura share card, Secure-with-passkey nudge after first Aura. | Playwright journeys at 360/390/landscape; real iPhone + Android run with GPS; bug list. |
| 5–6 | Creator money (W09) contract: refundable XP commitments on chain, donation + paid access with 80/20 settlement, conservation tests. | Creator authoring UI simplified to visit/trail/chest templates; Community feed. | Rust CI, contract tests for W09, load test of coin claims. |
| 7–8 | W10: NEAR Social public records for profiles/notes, pinned media (IPFS) behind a bounded uploader, retention/deletion controls. | Notes/photos UI, presence, reports/blocks states. | Backup/restore rehearsal on the VPS; monitoring and alerts. |
| 9–10 | Mainnet minimal path: collectibles + relayer + market on mainnet with capped sponsor funding and feature flags; mainnet manifests; emergency pause. | PWA polish, service worker update prompt, second-city playbook doc. | Mainnet dry runs with tiny amounts; release checklist; rollback drill. |
| 11–12 | Reconciliation and economy page: aggregate stake, pot funding sources, outlooks; final proofs. | Demo video storyboard and recording support; README "do X, see Y" verified on a fresh clone. | Full regression, fresh-clone verification, device matrix report. |
| 13 | Freeze, fix, and submit. | | |

Progress, 1 November (evening): creator money publisher and routes live (first round opened from the API process);
NEAR Social public note records with content addresses, pinning adapter and a live proof from an invisible account;
the vault's yield cycle is automated in the reward worker (`maintain_vault`: harvest, advance, `flush_game`) and
waits for the first epochs to pass; the mainnet path is planned in `docs/MAINNET-PLAN.md` with a 9 November gate.

This is aggressive. The items most likely to slip are W10 media pinning and the mainnet path; both can be cut to
"documented, flagged off" without hurting the core story. The items that must not slip are the live yield cycle,
the hosted demo, and the end-to-end invisible-account journey on a phone.

## 5. Concrete improvements, prioritized

**P0 (ship before judging)**
- Nearest-discovery-first and short street discoveries; remove the teleport-as-walk feeling in the city demo by
  animating the walk and capping teleport distance.
- "Today's pot" and "How rewards are funded" in the loop; native ledger as the default when configured.
- One observed yield cycle with proofs; relayer-sponsored deposit; withdrawal to the managed account.
- Hosted demo on the VPS with the relayer on; HOW-TO-TRY verified on a fresh clone.
- Aura share card.

**P1 (strong differentiators)**
- Creator money with conservation tests; creator feed as the Community home.
- Public profile on NEAR Social from the managed account, no wallet popup.
- PWA install prompt, offline shell, push for "your zone opens in 10 minutes" (requires a push service; can be
  deferred to local notifications in the installed app).
- Second city playbook and a dry run with a different CityPack.

**P2 (after the hackathon)**
- Pedestrian routing and honest trip distances; field-reviewed access.
- NPC merchant agent with its own account (track hint) using the market contract.
- Mainnet vault after an external review; sponsor onboarding flow.

## 6. Metrics I would track from day one

- First-session completion: name → first coin → first chest → Aura worn (target: 60 % of newcomers within 5 minutes
  in the city demo; measure on the hosted build).
- Day-1 and day-7 return of installed PWA users.
- Pot funding sources per day (yield vs sponsor) and the share actually claimed.
- Relayer spend per active player per day (keep below 0.01 NEAR on mainnet).
- Creator content: published places per week and completions per place.

## 7. Risks I want on record

- GPS spoofing is unsolved; keep real-value prizes small and sponsor-reviewed until stronger evidence exists.
- A device-held full-access key is browser-wallet-grade custody; recovery depends on the passkey nudge being used.
- The relayer is an abuse target; the budgets exist, but a public host needs rate limits per IP and per account.
- Art rights: Aavegotchi template layers are used under the developer invitation, not a blanket license; the
  release needs the owner's confirmation of that scope.
- The schedule above assumes three lanes working in parallel with daily merges; a single lane cannot finish it.

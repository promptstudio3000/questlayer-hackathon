# QuestLayer status

Updated 1 November 2026. This is the single start page for the current state of the project. Older status
documents (`DEVELOPMENT-STATUS.md`, `V1-REMAINING.md`, `NEXT-DEVELOPMENT-PLAN.md`, `NEAR-INTEGRATION-STATUS.md`,
`PROJECT-REVIEW-*`) are kept as dated history and are superseded by this page.

## Goal for 14 November 2026 (NEAR Hackathon, track "Games With Real Economies")

A playable mobile exploration game on real Plzeň geography where a new player enters with a name only, collects
coins, opens a zone chest, receives an Aura and wears it, while the NEAR account, rewards and NFTs are created,
funded and signed in the background. The blockchain is a property of the items, not a screen the player visits.

## What works now (verified in this checkpoint)

| Area | State | Evidence |
| --- | --- | --- |
| Solo demo loop (name → map → coin → zone chest → receipt → equip) | works locally, server-authoritative | `output/qa/2026-11-E0/`, `npm run check` 490/490 |
| Shared daily city world, six Plzeň zones, coins | works; planner asserts six slots, no pedestrian graph yet | `tests/city-world.test.mjs`, `docs/WORLD-GENERATION.md` |
| Native rewards (`questlayer-rewards-20261031.testnet`), worker relaying claims | works on testnet with a service key; gasless for the player | `public/native-rewards-testnet.json` |
| Aura NFTs (`nfts.questlayer-dev-20261031.testnet`), market escrow (`questlayer-market-20261101.testnet`), staking pilot, tasks, NEAR Social profile | work on testnet; Auras and the market now also accept the invisible account through the relayer | `public/*-testnet.json` proofs |
| Shell cleanup (E1) | done: one entry button, four tabs, no network wording in the loop, one token source | `docs/UI-AUDIT-2026-11.md`, `output/qa/2026-11-E0/ui-after/` |
| Secure with a passkey | a playing guest attaches a passkey to the same explorer | `tests/http.test.mjs` |
| Audit fixes | pickup radius served by the server, 3–6 zone shortfall handling, distinct visit targets | `docs/CODE-AUDIT-2026-11.md` |
| Aura sprites | authored pixel sprites for both slots on character, inventory and map marker | `output/qa/2026-11-aura-art/` |
| Aavegotchi research | palette, rendering, Baazaar model and rights notes for reuse on NEAR | `docs/AAVEGOTCHI-REUSE.md` |

## In progress

- **Invisible account + relayer (E2)**: implemented and **proven on testnet on 31 October 2026**: a guest session
  received the sponsored sub-account `proof-mvx1gsxi.play-20261031.questlayer-dev-20261031.testnet` and a relayed
  `mint_avatar` confirmed without any wallet (`public/native-invisible-account-proof.json`). Factory
  `play-20261031.questlayer-dev-20261031.testnet`, relayer `relay-20261031.questlayer-dev-20261031.testnet`.
  Remaining: wire the same path into the live UI journey on a phone and the VPS runtime. See `docs/RELAYER.md`.
- **Contract redeploy done**: `game.questlayer-dev-20261031.testnet`, `nfts.questlayer-dev-20261031.testnet`
  (award signer configured, claims manifest v3), market `questlayer-market-20261101.testnet`. The former
  `auratrail-dev-*` contracts are history only. Rewards/vault/tasks pilots still run under their 2026-10-31 accounts.
- **VPS migration** from the former installation name: `docs/VPS-MIGRATION.md`, `scripts/migrate-vps-legacy.sh`.

## Not in scope before the hackathon deadline

Staking yield cycle completion (W05), NEAR Intents market (W07), creator payments (W09), SocialDB/IPFS notes
(W10), AI authoring (W11), iOS store distribution (W12/W14), mainnet. The roadmap (`ROADMAP.md`) keeps their gates.

## Known limitations

- Browser GPS can be spoofed; the location validator is trusted for physical evidence.
- Real-device checks (iOS Safari, Android Chrome) are still outstanding for the new shell.
- The public host still runs the pre-rename release until the migration and a new deployment are done.

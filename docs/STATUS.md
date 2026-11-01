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
| Solo demo loop (name → map → coin → zone chest → receipt → equip) | works locally, server-authoritative | `output/qa/2026-11-E0/`; latest local `npm run check` 566/566, `output/qa/2026-11-map-backend/` |
| Shared daily city world, six Plzeň slots, coins | safe 0–6 map shortfalls; resilient street data, closures and optional viewport reads; graph support for configured packs, active Plzeň routing still unverified | `tests/city-world.test.mjs`, `docs/MAP-BACKEND-CONTINUATION-2026-11-01.md` |
| Native rewards (`questlayer-rewards-20261031.testnet`), worker relaying claims | works on testnet with a service key; gasless for the player | `public/native-rewards-testnet.json` |
| Aura NFTs (`nfts.questlayer-dev-20261031.testnet`), market escrow (`questlayer-market-20261101.testnet`), staking pilot, tasks, NEAR Social profile | work on testnet; Auras and the market now also accept the invisible account through the relayer | `public/*-testnet.json` proofs |
| Shell cleanup (E1) | done: one entry button, four tabs, no network wording in the loop, one token source | `docs/UI-AUDIT-2026-11.md`, `output/qa/2026-11-E0/ui-after/` |
| Secure with a passkey | a playing guest attaches a passkey to the same explorer | `tests/http.test.mjs` |
| Audit fixes | pickup radius served by the server, 3–6 zone shortfall handling, distinct visit targets | `docs/CODE-AUDIT-2026-11.md` |
| Aura sprites | authored pixel sprites for both slots on character, inventory and map marker | `output/qa/2026-11-aura-art/` |
| Aavegotchi research | palette, rendering, Baazaar model and rights notes for reuse on NEAR | `docs/AAVEGOTCHI-REUSE.md` |

## In progress

Latest local map/backend delivery: all five follow-up capabilities are implemented—resilient cached street data/background recovery, original-node pedestrian graph import/routing and configured-pack validation, audited operator place closures, compatible viewport/page reads, and a repeatable three-day integration pilot. [Claude handoff and interfaces](MAP-BACKEND-CONTINUATION-2026-11-01.md) · [566-test evidence](../output/qa/2026-11-map-backend/README.md). No UI or contract changes, additional city activation or deployment occurred. Reviewed Plzeň topology/entries and physical access remain open; optional viewport fields have not been adopted by the unchanged frontend.

Local continuation, 1 November: the zone/map worker now rejects malformed candidates independently, keeps obsolete jobs from starving current dates, verifies stored readiness and retains published geometry. Native publication uses one explicit CityPack, recovers its original durable intent and verifies exact chain terms/storage before enabling collection or closing a day. Default Plzeň geometry/native commitments are preserved. UI, contracts, relayer policy and deployed configuration are unchanged. Start with the [brief Claude handoff](CLAUDE-WORKER-HANDOFF-2026-11-01.md); see [worker boundaries](WORLD-WORKER.md) and [local evidence](../output/qa/2026-11-world-worker/README.md). This does not complete W01/W06 field/release gates or the separate treasury-liquidity audit.

- **Invisible account + relayer (E2)**: implemented and **proven on testnet on 31 October 2026**: a guest session
  received the sponsored sub-account `proof-mvx1gsxi.play-20261031.questlayer-dev-20261031.testnet` and a relayed
  `mint_avatar` confirmed without any wallet (`public/native-invisible-account-proof.json`). Factory
  `play-20261031.questlayer-dev-20261031.testnet`, relayer `relay-20261031.questlayer-dev-20261031.testnet`.
  Remaining: wire the same path into the live UI journey on a phone and the VPS runtime. See `docs/RELAYER.md`.
- **Contract redeploy done**: `game.questlayer-dev-20261031.testnet`, `nfts.questlayer-dev-20261031.testnet`
  (award signer configured, claims manifest v3), market `questlayer-market-20261101.testnet`. The former
  `auratrail-dev-*` contracts are history only. Rewards/vault/tasks pilots still run under their 2026-10-31 accounts.
- **VPS migration** from the former installation name: `docs/VPS-MIGRATION.md`, `scripts/migrate-vps-legacy.sh`.

## Economy motor on testnet (1 November 2026, evening)

- Rewards treasury generation 2026-11-01 publishes today and tomorrow from funded buckets; the vault holds 5 test
  NEAR at the Aurora pool with a 50 % contribution. The worker harvests gain and flushes realized yield to the
  treasury as epochs pass (observe `questlayer-vault-20261101.testnet` `get_state`).
  First rewarded epoch observed (2026-11-01 09:15 UTC, epoch 5401): +0.000353 NEAR on 5 NEAR, harvest condition met
  but no harvest yet (high-water unchanged, `game_paid` 0), so no realized-yield funding so far. The reward worker
  must be running with the publisher key for it to happen (`public/native-yield-observation.json`).
- Creator money (`questlayer-creators-20261101.testnet`) is live and proven: paid access 80/20, donations,
  support rounds, withdrawals, treasury flush. The server publisher (`server/native/creator-money.mjs`) mirrors
  published quests, verified completions and likes and runs the UTC daily round from the API process; its first
  live round (2026-11-01, 0.01 NEAR) is transaction `3aBKSkm3N4rhoxriFG5vZosSiFeWrqAKo49V5u47HZSc`. Player
  payments are quoted by `/api/native/creators/prepare`; the UI is the next step (`docs/PLAN-FOR-OPUS.md`).
- Relayer money rule (1 November, evening): a NEP-366 relayer pays every attached deposit, verified live when a
  relayed `create_position` took 3.52 NEAR from the relayer. The policy now relays only storage-class deposits
  (0, 1 yocto, 0.05 NEAR); purchases, creator payments and staking are self-paid transactions signed by the same
  device key, still without a wallet popup (`docs/RELAYER.md`, "Who pays what"). Live proof after the fix:
  `public/native-sponsored-stake-proof.json` (position `v3.questlayer-vaults-20261101.testnet`).
- Public records (W10.1, `server/native/social-records.mjs`): a note that is already public in the app can be
  written under the player's own NEAR Social namespace from their own account (`/api/native/records*`), with the
  photo's IPFS content address, rounded anchors, optional author fix, confirm-by-readback and tombstones for
  removals. Pinning runs through an optional add endpoint (`IPFS_ADD_URL`); without it the record carries the
  address and pinning reports "unavailable". Live proof: a note published from a fresh invisible account, relayed
`set` on `v1.social08.testnet` (transaction `4YKtshNX1d1QfdkN4RGsMQXfbY834WMuz29fuUNrjBdy`) and confirmed from
chain; see `public/native-public-record-proof.json`. The UI is the next step.
- Treasury distribution audit (1 November): every reserved coin and prize on `questlayer-rewards-20261101.testnet`
  is explained by the two open Plzeň days, the ledger is conserved and the account holds about 47 times its
  liabilities; the rewards contract now caps each local date across all cities on chain (in-place upgrade, state
  preserved, earlier days backfilled); the worker refuses to publish on drift (`public/native-distribution-proof.json`,
  `docs/WORLD-WORKER.md`). CI now builds the vault WASM before the factory; 111 contract tests pass.
- Network configuration: `server/native/network.mjs` is the single source for the NEAR network (`NEAR_NETWORK`,
  testnet by default); server modules no longer spell "testnet". Mainnet stays unsupported until the remaining
  steps in `docs/MAINNET-PLAN.md` land.

## Not in scope before the hackathon deadline

NEAR Intents market (W07), AI authoring (W11), iOS store distribution (W12/W14). Mainnet is planned as a minimal
flagged path (collectibles, relayer, social) with a 9 November go/no-go gate; see `docs/MAINNET-PLAN.md`. The
roadmap (`ROADMAP.md`) keeps the gates.

## Known limitations

- Browser GPS can be spoofed; the location validator is trusted for physical evidence.
- Real-device checks (iOS Safari, Android Chrome) are still outstanding for the new shell.
- The public host still runs the pre-rename release until the migration and a new deployment are done.

# QuestLayer status

> **Superseded (14 Nov 2026).** This is a dated record kept as history. Units and numbers here are out of date (the game uses QGOLD, 1 NEAR = 1B QGOLD). The current description is the [README](../README.md) and the in-game wiki at `/wiki`.

Updated 6 November 2026. This is the single start page for the current state of the project. Older status
documents were removed; `NEAR-INTEGRATION-STATUS.md` is kept as dated history.

## Goal for 14 November 2026 (NEAR Hackathon, track "Games With Real Economies")

A playable mobile exploration game on real geography across Czechia. A new player enters with a name only and finds
something to do wherever they stand: street coins, quests at real public places, NPCs and monsters. Plzeň is the
reviewed, funded showcase where the player opens a zone chest, receives an Aura and wears it. The NEAR account,
rewards and NFTs are created, funded and signed in the background. The blockchain is a property of the items, not a
screen the player visits. Coverage is Czechia only before the deadline (owner decision, 2 November); Europe and
beyond come after.

## Public testnet checkpoint — 5 November 2026, 21:57 UTC

Read-only observation of [the public health endpoint](https://questlayer.promptstudio3000.com/api/health).
It reports build `e9160028637cda7785cae02acd9ea3e299525c17`, network `testnet`, status `ok`.
The weekend UI changes below are local work and are **not deployed** by this checkpoint.
A healthy endpoint is not evidence that every financial journey or physical location has been tested.

| Area | Observed state | Evidence field |
| --- | --- | --- |
| Plzeň preparation | 6/6 zones ready for 5 and 6 November; no shortfall | `worldPreparation.days` |
| Czechia POIs | 290,817 places; 197,999 quest-ready; 5,867 require review | `poiWorld` |
| Country coverage | 14,999 / 15,282 street cells have quest candidates (98.15%) | `poiWorld.countryShare` |
| Auto cities | On, 85 cities; not funded | `autoCities` |
| AI flavour | 2,844 cached entries; latest bounded nightly batch stopped at its token budget, 877 generated, no failed calls | `questFlavour` |
| Distribution | Verified; no failed or reconciling entries reported | `distribution` |
| Ledger | Recorder ready, per-action mode, 17 confirmed records, no unbound records; 4 November root confirmed | `chainLedger` |

PRs #206–#210 and the preceding financial changes are included in the fetched base. The current source includes
nightly QGOLD payouts, real-balance display and verified spending burns. Those mechanisms were not changed by
this UI work. Their source presence and public health are separate from a fresh end-to-end money-flow audit.

## Local weekend implementation — not deployed

Map home has fixed control anchors, one dismissible objective and a nearby Open action. Inventory, community and
profile use their own screens; discovery details and encounters use bounded dialogs with complete artwork and a
persistent close control. The former Show discoveries footer has been removed; the list lives in Map tools. The five profile sections and five community sections share accessible tabs. NPC and monster screens,
keyboard rune tracing, retry handling, quiz/NPC copy and display-only fallback quest titles are implemented.
Deferred panels keep first-screen JavaScript below the budget: 204 KB gzip and 679 KB raw in the 6 November local build.

New local checks cover landmark boundaries, keyboard trace scoring, an NPC errand acceptance and a server-confirmed
monster quiz. Final verification, screenshots and the status of all 16 tasks are recorded in
`output/qa/weekend-2026-11-05/README.md`; the map-dialog follow-up is recorded in
`output/qa/map-overlays-2026-11-06/README.md`. Physical iOS Safari and Android Chrome checks remain outstanding.
No weekend change has been pushed, merged or deployed.

## Remaining release gates

- Review the local UI and complete physical-phone GPS, touch, keyboard and accessibility checks.
- Verify financial end-to-end flows separately, including scheduled payouts and recovery on the deployed build.
- Field-review geography and access; map provenance is not proof of a safe walking route.
- Mainnet and publication remain separate owner decisions; see `docs/MAINNET-PLAN.md`.

## Historical checkpoint — 3 November 2026

The following checkpoint is retained as dated history. Later observations above supersede its live-state claims.

## Live on the public testnet host (3 November 2026)

Checked against `GET https://questlayer.promptstudio3000.com/api/health` (build `c1f8fc5`, `network: testnet`) and
`view_account` on `rpc.testnet.near.org`.

| Area | State | Evidence |
| --- | --- | --- |
| Name-only start, invisible account, gas sponsor | live; relayer `relay-20261101.questlayer-dev-20261101.testnet`, 9 confirmed jobs | `/api/health` → `relayer`, `docs/RELAYER.md` |
| Plzeň loop (map → coin → zone chest → Aura → equip → secure) | live, six zones a day ready two days ahead | `/api/health` → `worldPreparation` |
| Czechia place database (W3/W4) | `cz-20261102-6620c3bf`: 290,817 places, 197,999 quest-ready, 5,867 under review, 30 % excluded by the safety filter | `/api/health` → `poiWorld`, `docs/POI-PIPELINE.md`, `docs/POI-SAFETY.md` |
| Place quests in every street cell (W6) | live; quests possible in 14,999 of ~15,282 country cells (98 %); XP and cosmetics only | `server/poi-quests.mjs`, `docs/WORLD-COVERAGE.md` |
| Generic NPCs and monsters everywhere (W7) | live in every city and street cell | `docs/ACTORS-API.md` |
| Auto cities (W5), towns ≥ 15,000 people | code merged; **not on yet** on the public host (`autoCities.status: off`): the first `scripts/poi/auto-cities.mjs` run on the VPS is pending. Until then towns play as street cells | `docs/POI-PIPELINE.md` "Auto cities (W5)" |
| Nightly quest flavour text (W8) | merged; last nightly batch skipped (`poi-file-missing`, before the import finished), cache empty, quests show rule titles | `/api/health` → `questFlavour`, `docs/QUEST-FLAVOUR.md` |
| Coverage QA (W12) | `npm run world:coverage`, `npm run e2e:world` (Brno and village journeys at 390 px) in CI | `docs/WORLD-COVERAGE.md` |
| Rewards treasury and books | `questlayer-rewards-20261101b.testnet`, `distribution.status: verified`, no foreign days | `/api/health` → `distribution`, `nativeRewards` |
| Yield | treasury stake in stNEAR (`meta-v2.pool.testnet`), yield vault `questlayer-yield-20261102.testnet` (stNEAR, LiNEAR, USDC, USDT; deposit = Staker). `yieldBackedDays: false`: no day is labelled yield-backed yet | `docs/YIELD-VAULT.md`, `docs/STNEAR-TREASURY.md` |
| Auras, editions, market, creators, tasks, social | live on testnet (collectibles with patron and season editions, signed-order market, creator money, NEAR Social notes) | `public/native-*-testnet.json` |
| NPC economy | trader Vojtěch with his own funded account and auto-restock; earned roll tickets on `questlayer-npc-games-20261101.testnet` | `docs/NPC-TRADERS.md`, `docs/NPC-GAMES.md` |
| Progression | levels to L10, daily board (3 goals, no streaks), patron rank, Staker gates at 2 NEAR, season to 14 Nov 23:59:59 UTC | `docs/LEVELS.md`, `docs/DAILY-BOARD.md`, `docs/SEASON.md` |
| Badges | `questlayer-badges-20261102.testnet`, 69 place badges, minting on | `/api/health` → `badges`, `docs/BADGES.md` |
| Test world | seeded bots, notes, listings and quests (`TEST_SEED=1`, testnet only) | `docs/TEST-SEED.md` |

## In progress (wave 3, 3 November)

- First session anywhere in Czechia: a new player outside Plzeň starts in their own cell instead of the Plzeň demo.
- Landmark and errand quest types on top of place quests; Czech UI; phone performance; hardening and a secret scan.
- Mainnet dry run for the contracts added since the mainnet plan (`docs/MAINNET-PLAN.md`); no mainnet deploy without
  the owner's go.
- Proving a yield-funded reward day end to end.
- Phone verification (iOS Safari, Android Chrome) after wave 3; the demo video is recorded after that.

## Not in scope before the hackathon deadline

NEAR Intents market, iOS store distribution, coverage outside Czechia, public player-made worlds. Mainnet is the last
step, after phone testing, and needs the owner's explicit go; see `docs/MAINNET-PLAN.md`.

## Known limitations

- Browser GPS can be spoofed; the location validator is trusted for physical evidence.
- Places outside Plzeň come from map data nobody walked; they carry an "Unverified map" notice and never pay money.
- Real-device checks (iOS Safari, Android Chrome) are still outstanding.
- NPC replies use a private Ollama model; there is no attested "private AI" yet.

---

# Log, 1 November 2026 (history)

The sections below are the 1 November checkpoint, kept as written. Account names with `20261031` or without the
`b` suffix are earlier testnet generations; the live set is in the README.

### What works now (verified in this checkpoint)

| Area | State | Evidence |
| --- | --- | --- |
| Solo demo loop (name → map → coin → zone chest → receipt → equip) | works locally, server-authoritative | `output/qa/2026-11-E0/`; latest local `npm run check` 566/566, `output/qa/2026-11-map-backend/` |
| Shared daily city world, six Plzeň slots, coins | safe 0–6 map shortfalls; resilient street data, closures and optional viewport reads; graph support for configured packs, active Plzeň routing still unverified | `tests/city-world.test.mjs`, `docs/MAP-BACKEND-CONTINUATION-2026-11-01.md` |
| Native rewards (`questlayer-rewards-20261031.testnet`), worker relaying claims | works on testnet with a service key; gasless for the player | `public/native-rewards-testnet.json` |
| Aura NFTs (`nfts.questlayer-dev-20261031.testnet`), market escrow (`questlayer-market-20261101.testnet`), staking pilot, tasks, NEAR Social profile | work on testnet; Auras and the market now also accept the invisible account through the relayer | `public/*-testnet.json` proofs |
| Shell cleanup (E1) | done: one entry button, four tabs, no network wording in the loop, one token source | `src/App.tsx` |
| Secure with a passkey | a playing guest attaches a passkey to the same explorer | `tests/http.test.mjs` |
| Audit fixes | pickup radius served by the server, 3–6 zone shortfall handling, distinct visit targets | `docs/CODE-AUDIT-2026-11.md` |
| Aura sprites | authored pixel sprites for both slots on character, inventory and map marker | `output/qa/2026-11-aura-art/` |
| Aavegotchi research | palette, rendering, Baazaar model and rights notes for reuse on NEAR | `docs/AAVEGOTCHI-REUSE.md` |

### In progress

Latest local map/backend delivery: all five follow-up capabilities are implemented—resilient cached street data/background recovery, original-node pedestrian graph import/routing and configured-pack validation, audited operator place closures, compatible viewport/page reads, and a repeatable three-day integration pilot. Claude handoff and interfaces · [566-test evidence](../output/qa/2026-11-map-backend/README.md). No UI or contract changes, additional city activation or deployment occurred. Reviewed Plzeň topology/entries and physical access remain open; optional viewport fields have not been adopted by the unchanged frontend.

Local continuation, 1 November: the zone/map worker now rejects malformed candidates independently, keeps obsolete jobs from starving current dates, verifies stored readiness and retains published geometry. Native publication uses one explicit CityPack, recovers its original durable intent and verifies exact chain terms/storage before enabling collection or closing a day. Default Plzeň geometry/native commitments are preserved. UI, contracts, relayer policy and deployed configuration are unchanged. Start with the brief Claude handoff; see [worker boundaries](WORLD-WORKER.md) and [local evidence](../output/qa/2026-11-world-worker/README.md). This does not complete W01/W06 field/release gates or the separate treasury-liquidity audit.

- **Invisible account + relayer (E2)**: implemented and **proven on testnet on 31 October 2026**: a guest session
  received the sponsored sub-account `proof-mvx1gsxi.play-20261031.questlayer-dev-20261031.testnet` and a relayed
  `mint_avatar` confirmed without any wallet (`public/native-invisible-account-proof.json`). Factory
  `play-20261031.questlayer-dev-20261031.testnet`, relayer `relay-20261031.questlayer-dev-20261031.testnet`.
  Remaining: wire the same path into the live UI journey on a phone and the VPS runtime. See `docs/RELAYER.md`.
- **Contract redeploy done**: `game.questlayer-dev-20261031.testnet`, `nfts.questlayer-dev-20261031.testnet`
  (award signer configured, claims manifest v3), market `questlayer-market-20261101.testnet`. The former
  `auratrail-dev-*` contracts are history only. Rewards/vault/tasks pilots still run under their 2026-10-31 accounts.
- **VPS migration** from the former installation name: `docs/VPS-MIGRATION.md`, `scripts/migrate-vps-legacy.sh`.

### Economy motor on testnet (1 November 2026, evening)

- Rewards treasury generation 2026-11-01 publishes today and tomorrow from funded buckets; the vault holds 5 test
  NEAR at the Aurora pool with a 50 % contribution. The worker harvests gain and flushes realized yield to the
  treasury as epochs pass (observe `questlayer-vault-20261101.testnet` `get_state`).
- Creator money (`questlayer-creators-20261101.testnet`) is live and proven: paid access 80/20, donations,
  support rounds, withdrawals, treasury flush. The server publisher (`server/native/creator-money.mjs`) mirrors
  published quests, verified completions and likes and runs the UTC daily round from the API process; its first
  live round (2026-11-01, 0.01 NEAR) is transaction `3aBKSkm3N4rhoxriFG5vZosSiFeWrqAKo49V5u47HZSc`. Player
  payments are quoted by `/api/native/creators/prepare`. UI: quest detail has gifts, like and paid unlock
  (`src/CreatorMoney.tsx`), My creations has earnings and withdraw; a paid quest starts only after its unlock
  (`CreatorMoney.admitStart`, 402 `CREATOR_ACCESS_REQUIRED`).
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
chain; see `public/native-public-record-proof.json`. UI: Notes → own note → public record dialog
(`src/NoteRecordDialog.tsx`) with consent, permanence, photo pin state, publish/update and mark removed.
- Realized-yield cycle proven (1–3 November): three keyless vaults earned yield at the Aurora pool. The reward
  worker harvested the city's 50 % share at epoch 5401, advanced the unstake after it unlocked at epoch 5405
  and flushed the cash into the rewards treasury on 3 November. Funding grew by exactly the
  0.000264 NEAR the vaults paid, split 50/50 into the coin and zone buckets, and the distribution audit stayed
  verified. No manual step was needed. Proof with the three flush hashes: `public/native-yield-cycle-proof.json`.
  This ran on the previous generation (`questlayer-rewards-20261101.testnet`, operator `questlayer-dev-20261031`).
  The public host now runs generation `20261101b` with the same worker; its treasury already shows a first small
  realized-yield funding, the rewards contract includes the per-date cap and its audit reads verified.
- Treasury distribution audit (1 November): every reserved coin and prize on `questlayer-rewards-20261101.testnet`
  is explained by the two open Plzeň days, the ledger is conserved and the account holds about 47 times its
  liabilities; the rewards contract now caps each local date across all cities on chain (in-place upgrade, state
  preserved, earlier days backfilled); the worker refuses to publish on drift (`public/native-distribution-proof.json`,
  `docs/WORLD-WORKER.md`). CI now builds the vault WASM before the factory; 111 contract tests pass.
- Network configuration: `server/native/network.mjs` is the single source for the NEAR network (`NEAR_NETWORK`,
  testnet by default); server modules no longer spell "testnet". Mainnet stays unsupported until the remaining
  steps in `docs/MAINNET-PLAN.md` land.

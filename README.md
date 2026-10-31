# QuestLayer

**Little adventures. Real discoveries.** A location-based exploration game on real OpenStreetMap geography,
built on NEAR. Walk through Plzeň, collect street coins, open a zone chest, receive an Aura and wear it on your
character. The NEAR account, the rewards and the Aura NFTs exist, but the player never sees a wallet popup,
a seed phrase or a gas prompt: the chain is a property of the items, not a screen.

Built for the [NEAR Hackathon](https://nearhackathon.com/) (1–14 November 2026), tracks **Games With Real
Economies** and **Open Innovation**. Everything runs on NEAR **testnet**; nothing here has monetary value.

## Try it in two minutes (do X, see Y)

Requirements: Node.js 24 (`.nvmrc`), npm. No wallet, no keys.

```bash
npm ci
npm run dev
```

| Do | See |
| --- | --- |
| Open http://127.0.0.1:5173/ | The first-run page with the ghost explorer and one input. |
| Type a name, press **Start exploring** | The Plzeň map, your explorer in the centre, one objective card ("Your next quest"). |
| Tap the map near a coin (city demo moves by tapping) | The coin disappears for every player and the counter ticks. |
| Open the objective, press **Walk there**, then **Open chest** | A result sheet with the exact XP and the Aura you received. |
| Press **Try it on** | The same Aura on your map character. |
| Reload | Name, XP, item and equipment are still there (server-side state). |
| Profile → **Advanced** | Where the test-network details live, deliberately out of the loop. |

Automated checks: `npm run check` (build + 490 application tests), `cargo test --manifest-path contracts/Cargo.toml --workspace`
(about 100 contract tests). The full guide, including the isolated QA server, the testnet scripts and phone testing,
is [docs/HOW-TO-TRY.md](docs/HOW-TO-TRY.md).

## What is on NEAR

| Piece | Where | How the player meets it |
| --- | --- | --- |
| Rewards (coins, XP, level entitlements) | `questlayer-rewards-20261031.testnet` ([contracts/rewards](contracts/rewards)) | The server attests a visit; a background worker relays the claim. The player sees "Reward collected". |
| Auras and avatars (NEP-171, two equipment slots) | collectibles contract ([contracts/collectibles](contracts/collectibles)); redeploy under a `questlayer-*` account is in progress, see `public/testnet-deployment.json` | "Secure this Aura" mints it to the player's own account; equipping is on-chain. |
| Invisible player account | sub-account under a factory account, device-held key, NEP-366 meta-transactions relayed by the server ([server/relayer](server/relayer), [docs/RELAYER.md](docs/RELAYER.md)) | Nothing. The account is created in the background after the name-only start. |
| Market (fixed-price NFT escrow) | `questlayer-market-20261031.testnet` ([contracts/market](contracts/market)) | Profile → Market: list, buy, cancel. |
| Staking vault pilot, sponsored tasks, NEAR Social profile | `questlayer-vault(s)-20261031.testnet`, `questlayer-tasks-20261031.testnet`, `v1.social08.testnet` | Profile → Advanced. Pilots; see [docs/STATUS.md](docs/STATUS.md). |

Transaction proofs with hashes are in `public/*-testnet.json` and `public/*proof*.json` (no keys).

## The economy, in one page

[docs/ECONOMY-RULES.md](docs/ECONOMY-RULES.md) lists every live number with its source: 1 NEAR = 1,000 GOLD
display units, coins worth 0.01 GOLD backed before publication, a 50/50 split of eligible income into coin and zone
buckets, six daily Plzeň zones with shared prizes that pay once, personal XP once per account, level rewards as
capped Auras. Practice-only numbers (the 120,000 GOLD welcome credit) are marked as such. Unclaimed backing
returns to its bucket; more players never create money.

## Architecture

- **Client**: React 19 + TypeScript + Vite, MapLibre on OpenFreeMap vector tiles, Aavegotchi-compatible pixel
  character (official template layers, see `public/art/aavegotchi/provenance.json`).
- **Server**: Node 24 ESM, SQLite (WAL), server-authoritative gameplay (coins, quests, receipts, equipment),
  durable background workers (world planner, reward relay, account/relayer jobs) with leases and backoff.
- **Contracts**: Rust `near-sdk` workspace with seven members (game, collectibles, rewards, vault, vault-factory,
  market, tasks).
- **Identity**: name-only start, device key + sponsored sub-account, optional passkey, optional external wallet
  (NEP-413 sign-in). The server never holds a player private key or seed.

Design policy: [DESIGN.md](DESIGN.md). Rules: [docs/GAME-RULES.md](docs/GAME-RULES.md). Roadmap and gates:
[ROADMAP.md](ROADMAP.md). Current state and limits: [docs/STATUS.md](docs/STATUS.md). Audits from 1 November:
[UI](docs/UI-AUDIT-2026-11.md), [code](docs/CODE-AUDIT-2026-11.md).

## Repository map

```
src/        client (App.tsx shell, GameMap, Inventory, native panels, player-key/relayed transport)
server/     API, game, world planner, native adapters, relayer, creators (default off)
contracts/  Rust NEAR contracts
tests/      node --test suites (fake RPC, isolated SQLite)
public/     static assets, official art, testnet manifests and proofs
docs/       status, how-to-try, rules, design, audits, operations
output/qa/  evidence per delivery (screenshots, logs)
deploy/, scripts/  systemd units, VPS deployment and migration, testnet scripts
```

## Trust and limitations

Browser GPS can be spoofed; the location validator is trusted for physical evidence, while contracts enforce
backing and exactly-once claims. Testnet operation is not a mainnet audit. A device-held key is the same custody
class as a browser wallet; the passkey-derived recovery key and the external-wallet link are the recovery paths.
Real-device field play, a complete staking yield cycle, NEAR Intents and store distribution remain open.
See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). All product text and documentation are English.

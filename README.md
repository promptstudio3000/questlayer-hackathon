# questlayer-hackathon

**Little adventures. Real discoveries.** A native NEAR exploration game on real OpenStreetMap geography, designed to be fun even when nobody else is nearby.

## Whole-project handoff

Start with the [whole-project review and engineering handoff](docs/PROJECT-REVIEW-AND-HANDOFF.md),
its [complete coverage appendix](docs/PROJECT-REVIEW-COVERAGE.md) and
[audit snapshot](docs/PROJECT-REVIEW-SNAPSHOT.json). They locate the original plan,
compare all W00–W14 milestones with source/evidence, and separate local work from
public deployment. This review is a historical snapshot taken before the GitHub source checkpoint.
See [cloud development and naming](docs/CLOUD-DEVELOPMENT.md) for the current source and deployment boundary.

## Continue in the cloud

Repository: [promptstudio3000/questlayer-hackathon](https://github.com/promptstudio3000/questlayer-hackathon).
Open [a GitHub Codespace](https://codespaces.new/promptstudio3000/questlayer-hackathon), wait for setup, then run `npm run dev` and open port **5173**.
The development container installs Node.js 24 and dependencies. Use `npm run check` before committing.
For another cloud coding environment, use Node.js 24+, `npm ci`, and the existing [roadmap](ROADMAP.md).
Full setup, preview security, legacy compatibility and VPS migration boundaries are in [cloud development](docs/CLOUD-DEVELOPMENT.md).

## Design and development

For player-facing development, follow the [game and UI design policy](DESIGN.md)
and [project working rules](AGENTS.md). The [UI improvement backlog](docs/UI-UX-IMPROVEMENT-PLAN.md)
defines the proposed first-adventure redesign and acceptance checks. The
[research review](docs/UI-UX-RESEARCH.md) records 15 source repositories and adoption
decisions. Proposed [design tokens](docs/design-tokens.json) are not yet used by the
runtime; these documents do not indicate a deployed redesign.

## Development direction

Follow the [implementation roadmap](ROADMAP.md), [consolidated game rules](docs/GAME-RULES.md) and [city-world specification](docs/WORLD-GENERATION.md). The public alpha now uses six varied, non-overlapping park-derived zones across Plzeň. The [current delivery](docs/DELIVERY-2026-10-31.md) distinguishes connected native testnet features from the demo economy. Milestone status is in [the tracker](docs/roadmap.json); complete exit gates remain open.

Continue from [the combined development status](docs/DEVELOPMENT-STATUS.md): native recovery and creator source are already integrated; local W02 adventure continuity is verified separately from deployment. This index connects the handoffs, research, current evidence and remaining work.

## Run locally

Requirements: Node.js 24+, npm. For contracts, Rust and the `wasm32-unknown-unknown` target.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/**. The API runs on loopback port 8787. `npm run build && npm start` serves the production build and API together.

The deploy target is **https://questlayer.promptstudio3000.com/**. Deployment is not implied by a local build; verify `/api/health` and the UI after activation.

## Try the game

1. Enter an explorer name and choose **Enter the demo world**, or create a demo passkey.
2. In the clearly labelled Pilsen arena, click the map or use arrow keys to move. Nearby shared coins are collected automatically. Each pays 0.01 demo GOLD and disappears for every player.
3. Open a free park zone and choose its visit, chest or ordered three-point expedition. Discover an Aura without needing a second player.
4. Open **Inventory**, equip the Aura or list it on the demo market. A second independent browser session can buy it; the old owner loses equipment rights.
5. Open **Wallet**, stake demo GOLD and choose a 0–100% contribution. Arena tier activation takes 30 seconds. A withdrawal unlocks in 60 seconds. These are explicitly simulated timings.
6. Open **Settings → Game economy** (also linked from Wallet) to inspect available/reserved/paid balances in the separate 50% street-coin and 50% zone buckets.
7. Switch to **My surroundings** to request browser geolocation and generate a shared local world from cached OSM pedestrian routes. In this mode, camera clicks do not move the character or prove location.

## Implemented vs. native integrations

| Capability | Status |
|---|---|
| Real map, globe, shared daily worlds, solo quests | Implemented |
| Shared low-value coins, conserved 50/50 funds | Implemented in the separate demo ledger |
| Persistent inventory, Aura equipment and peer market | Implemented, server-settled demo items |
| Demo staking, maturity, retained yield, withdrawals | Implemented simulation; not a validator deposit |
| Passkey registration and recovery | Implemented demo identity; not a native NEAR account |
| Native NEAR sign-in and recovery | Real NEP-413 FullAccess verification; existing wallet restores the same player |
| Native avatar and Aura wardrobe | Live testnet ownership, caller-minted starter NFT, independent above/below equipment and native appearance selection; earned demo Auras can use player-approved signed NFT claims on the activated testnet contract |
| Aavegotchi linking | EVM signature verification, read-only Base ownership, loose/nested/equipped inventory and original SVG appearances |
| Optional 3D dressing room | Selected-model download, integrity verification, bounded cache and mobile texture budget; no full-catalog mirror |
| Native Aura market | Actual testnet NFT escrow, exact-price native NEAR purchase, cancellation and seller-credit withdrawal |
| Public NEAR Social profile | Explicitly consented alias and owned starter reference, signed by the player's linked testnet wallet; no GPS or private inventory |
| Notes with images and optional author GPS | Implemented server storage; image metadata removed |
| Sponsored tasks | Demo escrow, evidence, creator approval; public arbitration is a later gate |
| Native game and NEP-171 contracts | Rust implementations with tests and reproducible build commands |
| Native deployment proofs | `public/testnet-deployment.json` and `public/native-wardrobe-testnet.json`; verified real testnet operations |
| Intents market, native staking vault, native passkey wallet | Not connected to gameplay yet |
| Public notes/media on SocialDB/IPFS | Not connected; current note content stays in the app's off-chain storage |
| NEAR AI | Optional Cloud-backed guide when configured; otherwise a clearly identified rules-based guide |
| Mainnet / App Store release | Not deployed |

**Demo GOLD has no monetary value.** It is never added to a connected account's real NEAR balance. The intended denomination is 1 NEAR = 1,000 GOLD. There is no standalone GOLD fungible token.

The map loads independently of the application shell and has an isolated failure state. Hashed public assets remain available across releases. Private daily snapshots cover SQLite, the bounded award attestor and referenced note images; an isolated restore was rehearsed through the current app schema. See [runtime reliability](docs/RUNTIME-RELIABILITY.md) and [state recovery](docs/STATE-RECOVERY.md).

## Verify

```sh
npm test
npm run build
cargo test --manifest-path contracts/Cargo.toml --workspace
cargo build --manifest-path contracts/Cargo.toml --workspace --target wasm32-unknown-unknown --release
```

The HTTP integration test starts an isolated local server and temporary database. It tests competing coin claims, market/escrow flows, signature replay, cross-origin rejection and cryptographically generated WebAuthn registration/recovery. Contract tests cover independent financial conservation, replay rejection and NFT ownership/equipment changes.

`node scripts/bootstrap-testnet.mjs` creates a dedicated developer operator via the testnet helper. Its key stays in ignored `.data/near-operator.json`. `node scripts/deploy-testnet.mjs` deploys the testnet game/NFT contracts, checks actual reward withdrawal and NFT transfer, and emits public transaction proofs. Never use these scripts with mainnet funds.

## Configuration and deployment

Copy `.env.example` to `.env` when needed. Set a stable `APP_ORIGIN` before creating production-domain passkeys: passkeys are RP/domain scoped. Server-side secrets belong only in runtime configuration. No player seed, private key or encrypted seed backup is stored by the app.

The initial server uses SQLite WAL for one service. Domain and strategy boundaries support a later PostgreSQL/PostGIS worker deployment. See [architecture](docs/ARCHITECTURE.md) and the [implementation plan](IMPLEMENTATION-PLAN.md).

The accepted [creator economy integration plan](CREATOR-ECONOMY-PLAN.md) specifies the future Community section, refundable XP commitments, configurable creator funding, follows, donations and paid quest access with an 80/20 creator/treasury split. These features are planned; the current demo still uses its existing 50/50 coin/zone funding.

The VPS deployment script runs tests/builds, backs up the existing route and database, starts a separate hardened systemd service, checks health, then changes only the requested domain route. Failed activation restores routing and the previous release.

## Trust and limitations

Browser GPS can be spoofed. The location validator is explicitly trusted for physical evidence; contracts enforce backing and exactly-once claims rather than physical truth. Testnet contract operation is not a mainnet audit. Native wallet recovery, the financial vault, Intents integration, external asset rights and real-device performance remain explicit release gates.

See [third-party notices](THIRD-PARTY-NOTICES.md). All public product text and delivery documentation are English.

`node scripts/upgrade-collectibles-testnet.mjs` upgrades the existing owned testnet collectible contract with a checked V1→V2 migration and records live equipment/transfer/idempotency proofs. `node scripts/smoke-near-identity.mjs --wardrobe` verifies signed application identity, actual NFT ownership and outfit selection without sending a blockchain transaction. The application uses current public testnet endpoints listed in [NEAR's provider documentation](https://docs.near.org/api/rpc/providers); no player signing key is stored by the server.

Daily city geography is prepared ahead of time by a durable leased worker, independently of treasury allocation. See [daily preparation operations and boundaries](docs/WORLD-WORKER.md). `npm run world:preview -- YYYY-MM-DD` exports a nonfinancial CityPack preview; the public health endpoint exposes readiness without future coordinates.

[Native Aura claims](docs/NATIVE-AURA-CLAIMS.md) connect an earned cosmetic to a capped NEAR NFT through a receiver-bound, expiring signature. The server attests the entitlement; the player's own wallet approves storage and minting. GOLD and staking remain a separate demo economy.

The [native Aura market](docs/NATIVE-MARKET.md) uses testnet NFT escrow and exact NEAR prices. Its live owned-account proof verifies cancellation, delivery and seller withdrawal; canonical NEAR Intents remains a separate integration. Demo GOLD offers retain their separate ledger.

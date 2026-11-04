# Sources and planned integrations

Preparatory register as of 30 October 2026 (translated from Czech on 1 November 2026). The intended behavior of the
game is defined by [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md). The links below document technical
possibilities and terms of external components; they do not confirm their deployment in this game. Tier thresholds,
the 0–100 % yield share, competition rules and the 1–7 day withdrawal estimate are our design rules, not an offer or
guarantee by the NEAR protocol.

## Accounts and testing

| Source | Use and limits |
| --- | --- |
| [NEAR Connect Passkey](https://github.com/NEAR-DevHub/near-connect-passkey) | Passkey connector; the current manifest declares mainnet, not testnet. Our own testnet wiring is development work. |
| [WebAuthn wallet contract](https://github.com/near/intents/blob/main/contracts/wallet/README.md) | Signatures, extensions and recovery. The README marks it unaudited; do not present it as a reviewed mainnet wallet. |
| [Ethereum wallets connector](https://github.com/near/wallet-selector/blob/main/packages/ethereum-wallets/README.md) | Alternative EVM signatures for native NEAR; respect EOA, action and feature limits. |
| [NEAR Kit sandbox](https://kit.near.tools/dapp-workflow/testing) | Local node, prefunded accounts, state changes, block advancement and snapshots. |
| [Testnet faucet](https://near-faucet.io/) | Test funds. Verify the allowance; do not rely on a fixed 10 NEAR. |
| [RPC providers](https://docs.near.org/api/rpc/providers) | Configurable endpoints, fallback and limits. Public endpoints are not for unlimited load tests. |

The game server never holds player private keys or seed backups. Passkeys and seeds are not interchangeable. The
relayer's operational signature is separate from player authority.

## Staking and yield strategies

| Source | Use and limits |
| --- | --- |
| [Native staking](https://docs.near.org/protocol/tutorials/staking-tokens) | Deposits, reading positions, unstake and withdrawals; docs state release after four epochs. |
| [Reference staking pool](https://github.com/near/core-contracts/blob/master/staking-pool/src/lib.rs) | Unstaked balance availability is per account in the pool. A new unstake can postpone withdrawal; batches must not keep resetting. |
| [Meta Pool contracts](https://docs.metapool.app/master/for-developers/meta-pool-contracts/near-network) | stNEAR value and liquidity methods, mainnet/testnet addresses. Verify real deployment before use. |
| [Meta Pool withdrawals](https://docs.metapool.app/master/meta-pool-ecosystem/stake/fast-unstake) | Fast unstake depends on liquidity and a fee; not identical to native unstaking. |
| [Rhea supplying](https://guide.rhea.finance/near-chain-guides/lending-and-borrowing/supplying) | Lending market, variable interest and liquidity limits on withdrawal. |
| [Rhea audits](https://guide.rhea.finance/developers/audits) | Audits have a specific scope and version; not a universal guarantee. |

The first version uses allowlisted validator pools. Meta Pool and Rhea are further strategies. Native staking yield
is already NEAR, no swap needed. Only liquid confirmed income enters the treasury.

## Market, profiles and content

| Source | Use and limits |
| --- | --- |
| [NEAR Intents Verifier](https://github.com/near/intents) | Open settlement contract; a self-deployed testnet instance is not the official ecosystem testnet. |
| [NEP-171 deposits](https://github.com/near/intents/blob/main/contracts/defuse/src/contract/tokens/nep171/deposit.rs) | Receiving NFTs into the Verifier's internal balance. |
| [NEP-171 withdrawals](https://github.com/near/intents/blob/main/contracts/defuse/src/tokens/nep171.rs) | Asynchronous return of NFTs from the Verifier. |
| [TokenDiff](https://github.com/near/intents/blob/main/contracts/defuse/core/src/intents/token_diff.rs) | Settlement of token changes; NFT support is not a finished market or guaranteed liquidity. |
| [1Click](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api) | Swap interface; the v1 NFT market uses the Verifier and own orders directly. |
| [SocialDB](https://github.com/NearSocial/social-db) | Public profile and messages, write permissions, testnet deployment. Deleting a current value does not erase chain history. |
| [IPFS pinning](https://docs.ipfs.tech/how-to/pin-files/) | Image availability needs pinning; a CID alone hosts nothing. |
| [NEAR plugins](https://github.com/near/near-plugins) | Building blocks for roles, pausing and upgrades; set rights per contract. |
| [NEAR AI Cloud](https://docs.near.ai/cloud) | Quest suggestions and dialogue; API keys on the server, no automatic financial decisions. |

Atomic settlement inside the Verifier does not make later external withdrawals atomic. Payouts and withdrawals have
durable states and retry without double fulfilment.

## Aavegotchi and assets

| Source | Use and limits |
| --- | --- |
| [Migration to Base](https://blog.aavegotchi.com/aavegotchi-has-migrated-to-base/) | Original ownership is read on Base. |
| [Official addresses](https://github.com/aavegotchi/deployed-contract-addresses/blob/main/README.md) | Verify current contracts and ABI before integrating; do not reuse old Polygon addresses. |
| [3D renderer](https://github.com/aavegotchi/aavegotchi-3d-render-skill/blob/main/SKILL.md) | Documented PNG/GLB outputs and appearance derivation. Availability, CORS and modularity need verification. |
| [Unity SDK](https://github.com/aavegotchi/unity-sdk) | Model and wearable catalog; Unity materials/prefabs are not automatically web-compatible. |
| [Base license](https://github.com/aavegotchi/aavegotchi-base/blob/master/LICENSE) | MIT for the stated code, not automatically all artwork. |
| [Sprite generator](https://github.com/aavegotchi/aavegotchi-game-sprites/blob/master/README.md) | Separate asset and trademark rights resolution. |
| [IP announcement](https://blog.aavegotchi.com/aavegotchi-beyond-the-one-studio-model/) | Proposals to open the IP do not by themselves confirm an effective blanket CC0 for the whole catalog. |

Every publicly distributed asset must have a recorded source, a concrete usage right and the required attribution.
Loading a model from someone else's hosting does not avoid this question. We load required GLBs on demand; own
optimization and hosting apply where modularity, performance or availability require it.

## Maps and hackathon

- [MapLibre projection](https://maplibre.org/maplibre-style-spec/projection/) and [layers](https://maplibre.org/maplibre-style-spec/layers/): globe/flat transition, look of roads and areas.
- [OpenFreeMap](https://openfreemap.org/quick_start/) and [OSM attribution](https://www.openstreetmap.org/copyright): basemap and required credit.
- [CARTO basemaps](https://docs.carto.com/faqs/carto-basemaps): alternative provider with its own terms and API-key regime.
- [Games track](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md) and [hackathon](https://nearhackathon.com/): verify current competition terms before publishing.

New implementation was planned from 1 November 2026 00:00 UTC (01:00 Europe/Prague). Preparatory documents, visuals
and prototypes keep their real creation dates. External components actually used keep their licenses and the
information the competition requires; older files are never presented as new by changing their dates.

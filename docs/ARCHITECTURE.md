# Architecture and trust boundaries

For the current implementation/deployment distinction and ownership inventory,
read [the whole-project handoff](PROJECT-REVIEW-AND-HANDOFF.md). Deployment paths
below describe checked-in configuration and historical operations; this review did
not inspect the active VPS over SSH. Native pilots do not close full V1 gates.

## Runtime

React/TypeScript/Vite renders a MapLibre vector map. Node 24 serves the built client, JSON endpoints and server-sent events. SQLite WAL is the durable single-service transactional store for the initial deployment; the spatial/queue boundaries are designed to migrate to PostgreSQL/PostGIS when horizontal workers are needed. There is no in-memory-only reward ledger.

HTTP-only same-site cookies reference hashed expiring session tokens. WebAuthn uses verified challenges, RP binding, required user verification and counters. Only credential public keys are stored. Demo passkeys are not native NEAR wallets. NEAR account links require NEP-413 signature verification and an on-chain public-key check. Base links require a single-use domain/account-bound EVM signature.

Coin claims, quest awards, inventory transfers, listings, escrow and wallet balance mutations use `BEGIN IMMEDIATE` with database constraints. Exactly-once IDs and state checks protect retries and competing requests. Integer micro-GOLD belongs only to the demo ledger; native contracts use integer yoctoNEAR strings.

The reward validator remains trusted for physical evidence and receipt ordering. Browser GPS can be spoofed. Neither NEAR, an NFT nor AI proves physical presence. Contract invariants constrain financial backing and replay independently of that oracle.

## Deployment

The VPS runs one dedicated systemd service on loopback port 7091 under a dynamic unprivileged identity. Immutable code resides in a release directory; SQLite and sanitized image files reside in its own systemd state directory. The service does not share another application's database or keys.

Deployment first validates tests and builds, archives the previous domain route, starts and health-checks the new service, validates Caddy and only then reloads the route. A failed activation restores the domain configuration and previous release. Existing databases are backed up using SQLite's backup API, not a live file copy.

Never upload `.data`, `.env`, `.near-credentials`, operator keys or personal sessions with a source release. The optional VPS runtime environment is separately managed and must remain private.

## Native contracts

The game contract separates available/reserved coin and zone funds, claimable balances, pending transfers and completed payouts. Their sum always equals accepted funding. A batch records fixed denomination, bounded supply, expiry and a claim bitmap. Withdrawals debit before the promise, then restore on failure without overwriting newer earnings.

The NEP-171 contract caps each Aura edition at 256, authorizes minting to the operator, delegates standard transfer/approval/enumeration behavior and clears equipped ownership on transfer. The equipment view also rechecks ownership.

Testnet operator keys control development contract accounts. These permissions and contracts are not a mainnet security or custody guarantee. The staking vault, native passkey wallet, Intents settlement and SocialDB writing remain independent delivery gates.

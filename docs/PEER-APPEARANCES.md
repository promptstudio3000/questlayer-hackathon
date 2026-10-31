# Nearby appearances and temporary sharing

QuestLayer can show nearby explorers with their chosen original appearance and both Aura slots. Solo play remains complete without any nearby player.

## Data and consent

Sharing is off by default. The explorer explicitly publishes their name, chosen look and precise current position for at most 15 minutes. The client stops sharing when its tab becomes hidden or leaves the page; returning requires a new opt-in. Heartbeats do not extend consent. Losing connectivity removes a position from discovery after 30 seconds, even when the explicit stop cannot reach the server.

Demo arena and GPS presence are separate realms. Changing realms clears local sharing and observed explorers. Old asynchronous responses cannot restore another realm's markers. Each activation has its own random lease: an older cleanup/heartbeat cannot delete or replace a newer activation. A 20-minute revocation tombstone also rejects an initial publication that arrives after its stop request. Expired tombstones are pruned on updates.

The nearby response exposes only explorer ID, name, position and a reduced appearance object. It does not serialize wallet links, native account IDs, NFT equipment IDs, inventory, balances or activity history. An original Aavegotchi token ID is necessarily visible when its chosen unique skin is displayed; a recognizable appearance can associate a person with that public asset. This is included in the chosen-look sharing decision, not an anonymity guarantee.

## Appearance authority

- Demo colors and equipped slots come from the server-owned inventory.
- Native slots require a linked selected account, current on-chain equipment and current NFT ownership. Failed reads omit unverified effects rather than retaining a claimed ownership state.
- Original Aavegotchi skin selection requires the same recently verified ownership snapshot as the player's own appearance. It is a read-only visual choice, not a transfer or local ownership claim.
- Shared map markup only accepts hex colors and the game's numeric-token skin route. Arbitrary image URLs, markup and attributes cannot be injected through the appearance object.

## Evidence and remaining work

The application tests cover lease races, stop-before-start, expiry, realm isolation, stale positions, both slots, ownership changes, failed reads and reduced/sanitized appearance output. `scripts/smoke-native-presence.mjs` exercises the live local NEP-413 API using the project's own testnet account and synthetic demo positions. It reads the actual owned native outfit, verifies the public DTO and realm separation, then removes the temporary share. It submits no chain transaction and provides no real-world GPS evidence.

Browser evidence under `output/qa/W04/` includes the actual native peer with green above/purple below, 360px map pan, 360/390 consent surfaces, landscape menu scrolling and keyboard focus. These are browser layout reviews; real-device foreground lifecycle, mobile browser suspension and physical GPS checks remain open. Blocking/reporting and moderation remain W10 work. The current bounded presence table is not a public location-history product.

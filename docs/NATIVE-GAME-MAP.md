# Native map and progression integration

Implemented 31 October 2026. This remains an experimental NEAR testnet game; test tokens have no monetary value.

Explore has explicit Demo / NEAR testnet modes. Native mode projects the funded, published native day onto the main map, including up to 128 nearby uncollected coins and all six zone polygons. Geometry is accepted only when the stored city blueprint passes its integrity hash and matches the published day/source, checkpoint coordinates, tiers and opening windows. Missing or mismatched geometry is omitted, never replaced by the current demo world. A response-only map projection does not change an existing manifest, hash, budget or claim right.

Selecting a native zone opens its actual three-stop walk; tapping a native coin opens that coin's collection card. Actual GPS and explicit enrollment remain required. Coin collection is currently a deliberate action in the selected card; automatic native Pac-Man collection is still future work. Native mode disables demo click/keyboard movement and demo auto-collection. An already-sent demo request can finish, but does not create a native pickup animation or native balance. Coin graphics do not carry invented spendable values.

The native HUD uses the linked account's confirmed contract XP and reward credit. Missing data stays unavailable. It never imports demo XP, its welcome balance or demo quest rewards. The inventory exposes confirmed level 2/3/4 Aura entitlements described in NATIVE-PROGRESSION.md. Old/revoked browser sessions cannot receive new level vouchers after the final RPC read.

One shared sequential reader supplies the main native map, walk board and wallet rewards. Polls are coalesced; an explicit post-action refresh awaits a fresh follow-up. Account switches supersede queued old accounts; disabled/unmounted reads cannot update the current player. New days/accounts and failed reads clear stale target markers. Returning from the map preserves the selected native quest or coin.

## Limits and next work

- The native v1 manifest still supports its published three-checkpoint walk. The richer demo quest registry is not silently applied to native rights.
- GPS browser coordinates are attested, not trustless physical presence. Field-access review, anti-abuse evaluation and physical iOS/Android acceptance remain open.
- Add native auto-collection only with explicit discoverable control, bounded retry/backpressure, daily caps and accepted/confirmed feedback. Preserve manual accessible collection.
- Extend versioned native policies and creator XP separately. Level cosmetics are limited shared editions and are not guaranteed by eligibility.
- Full pool exit/yield realization, passkey-native signing, canonical Intents integration, creator escrow/moderation and mainnet review retain their existing roadmap gates.

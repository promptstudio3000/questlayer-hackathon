# Native map and progression integration

Implemented 31 October 2026. This remains an experimental NEAR testnet game; test tokens have no monetary value.

Explore has explicit Demo / NEAR testnet modes. The selected mode survives reload; an explicit NEAR sign-in opens native play, while first guest play stays in the demo. Native mode projects the funded, published native day onto the main map, including up to 128 nearby uncollected coins and all six zone polygons. Geometry is accepted only when the stored city blueprint passes its integrity hash and matches the published day/source, checkpoint coordinates, tiers and opening windows. Missing or mismatched geometry is omitted, never replaced by the current demo world. A response-only map projection does not change an existing manifest, hash, budget or claim right.

Selecting a native zone opens its actual three-stop walk; tapping a native coin opens that coin's collection card. Actual GPS and explicit enrollment remain required. Manual collection remains available alongside the explicit **Collect as you walk** control. The [automatic collector](NATIVE-AUTO-COLLECT.md) uses fresh GPS, serial requests, bounded pending work and confirmed-only session feedback; leaving the map, hiding the app or recording a manual visit pauses it. Native mode disables demo click/keyboard movement and demo auto-collection. An already-sent demo request can finish, but does not create a native pickup animation or native balance. Coin graphics do not carry invented spendable values.

The native HUD uses the linked account's confirmed contract XP and reward credit. Missing data stays unavailable. It never imports demo XP, its welcome balance or demo quest rewards. The inventory exposes confirmed level 2/3/4 Aura entitlements described in NATIVE-PROGRESSION.md. Old/revoked browser sessions cannot receive new level vouchers after the final RPC read.

One shared sequential reader supplies the main native map, walk board and wallet rewards. Polls are coalesced; an explicit post-action refresh awaits a fresh follow-up. Account switches supersede queued old accounts; disabled/unmounted reads cannot update the current player. New days/accounts and failed reads clear stale target markers. Returning from the map preserves the selected native quest or coin.

## Limits and next work

Local continuity follow-up, 31 October: selection now stores navigation identity
per player and linked account, including the testnet contract, published day/hash,
kind and index. It restores the next checkpoint from a fresh response, never stored
coordinates or a saved XP/reward value. The last deliberately selected account is
restored only if still linked. Failed/stale reads hide markers while retaining the
bookmark; an exact own receipt distinguishes pending, retrying and confirmed from
merely recorded progress. Missing nearby coins remain uncertain. Expired-day rights
stay accessible through Wallet receipts. View reward receipts opens/focuses the
actual disclosure. Native target camera placement uses current panel bounds and a
manual pan does not itself restart target movement. [Delivery evidence](../output/qa/W02-native-objective/README.md)
records 363 application tests, build and synthetic read-state browser checks. This
follow-up is not deployed and does not prove physical visits or native wallet return.

- The native v1 manifest still supports its published three-checkpoint walk. The richer demo quest registry is not silently applied to native rights.
- GPS browser coordinates are attested, not trustless physical presence. Field-access review, anti-abuse evaluation and physical iOS/Android acceptance remain open.
- Validate the implemented automatic collector through physical walking, wallet return, unavailable GPS and offline/foreground recovery on supported phones. Controller tests and browser viewport checks do not pass the field gate.
- Extend versioned native policies and creator XP separately. Level cosmetics are limited shared editions and are not guaranteed by eligibility.
- Full pool exit/yield realization, passkey-native signing, canonical Intents integration, creator XP/funding/moderation and mainnet review retain their existing roadmap gates. A separate native sponsored-task escrow now has testnet evidence; private/photo evidence and the full creator lifecycle remain open.

# QuestLayer overnight implementation — 31 October 2026

Work in progress. This is a factual implementation log, not a declaration that V1 is complete. The requested morning report is due at 10:00 Europe/Berlin. Product content is English; the private morning summary will be Czech.

## Delivered source

- Active product identity is **QuestLayer**, including interface, manifest, package, server responses and current design/planning documents. Historical testnet account addresses and operational service paths remain truthful and unchanged.
- Captured a real local Git baseline, `a889641`. No development dates were rewritten. Player signing keys and local operator credentials are excluded from version control and deployment archives.
- Added a versioned OpenStreetMap CityPack: 19 candidate park footprints in six sectors and a bounded snapshot of 3,500 pedestrian ways. Source identifiers, ODbL attribution, data limits and pending review state are retained.
- One city/day plan serves all Plzen H3 cells: six distinct park-derived polygons, three free/two Tier 2/one Tier 3, minimum 250m boundary separation. Large parks receive a bounded footprint rather than becoming a city-sized zone. Different dates rotate candidates, footprints and tier assignment.
- Added three solo activities in each zone: a visit, an edition-bounded Aura chest and an ordered three-point expedition. Checkpoint evidence requires the current target and zone footprint; replay, skipping and stationary completion are rejected. XP is awarded once at the end.
- Added four all-day windows, one three-hour premium window and one one-hour top-tier window. All-day windows start at the local calendar boundary, not at first activation.
- Replaced decorative map circles with canonical server polygons and authored quest markers. Fixed relative-position styles that displaced geographic markers. Added a city overview and camera offsets for the available map area.
- Adopted the Kanit typeface, stronger purple hierarchy, visible focus and larger core controls. Added compact/expanded phone sheets, a short-landscape layout and direct opening of the selected quest. Selection persists through inventory navigation.
- Added a native discovery dialog driven by the actual server reward and a direct `Try it on` action. Inventory preview and map show equipped Aura effects. Exhausted edition stock produces honest XP-only availability.
- Upgraded MapLibre from the vulnerable 5.x dependency to 6.16.0 and configured its separately bundled worker. Dependency audit: zero known vulnerabilities at this check. [Official v6 migration reference](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/).

## Before / after / reason

| Surface | Before | Implemented | Reason / owning source |
| --- | --- | --- | --- |
| City generation | H3-local downtown-style placement | One six-sector city/day plan using actual park polygons | Physical exploration instead of a downtown cluster; `server/spatial/city-pack.mjs`, `server/world.mjs` |
| Zone play | A single similar claim | Visit, chest and three ordered locations | A useful solo choice and actual movement; `server/game.mjs` |
| Geographic markers | Relative layout could displace anchors | MapLibre markers keep absolute positioning | A rendered marker must represent its coordinates; `src/style.css` |
| Phone Explore | Fixed-height desktop-derived panel | Compact objective and explicit expansion; short-landscape composition | Keep map and actions reachable; `src/App.tsx`, `src/style.css` |
| Discovery | Generic notification, separate inventory search | Confirmed reward dialog and direct equip | Complete discovery-to-character loop; `src/Dialog.tsx`, `src/Character.tsx` |
| Camera | Fixed offsets and hidden recenter edge cases | Layout-aware camera, explicit recenter and viewport changes | Preserve character visibility; `src/GameMap.tsx` |

## Verification so far

- 26 Node tests pass, including HTTP account/wallet-signature/passkey recovery, shared-budget conservation, market/escrow behavior, city identity, polygon evidence, checkpoint order, exhausted supply and daily windows. Log: `output/qa/W01/checks.txt`.
- Eight Rust contract tests passed after the product-display metadata change. Native contracts remain standalone testnet proofs, not integrated gameplay settlement.
- 365 city dates simulated: all produce six valid footprints and six distinct sectors. The minimum conservative boundary-gap lower bound observed was 296.87m. This is a geometry simulation, not a verified walking-distance or safety claim.
- Production build passes. Current main bundle is approximately 1.47MB uncompressed/409KB gzip, plus the map worker; mobile performance work remains open.
- In-browser desktop discovery → confirmed Aura → equip was exercised. A 360px phone layout completed all three checkpoints and received 100 XP only at completion. Progress remained complete in the server response.
- Layout screenshots use actual browser-rendered development viewports at 360×640, 390×844, 844×390 and desktop 1280×720. They are browser layout reviews, not physical-device evidence. Screenshots are under `output/qa/W01/`.

## Deployment

City alpha deployed at release `20261031T012257Z`, source commit `4043f52`, with backup `/opt/ps3000/apps/auratrail/backups/20261031T012257Z`. Public health and browser rendering passed. The first deployment preserved all existing demo state. Public URL: https://questlayer.promptstudio3000.com/ . Development viewport harnesses, local data and credentials are not packaged.

## Remaining release gates and limits

- **Game money is still a demo ledger.** Native testnet wallet balances and deployed contract evidence are separate. End-to-end native identity, yield vault, reconciled gameplay settlement and NFT sales are not complete.
- CityPack coverage is partial and uses a coverage box rather than a reviewed municipal boundary. No full pedestrian graph, barrier/water/building exclusion set or site field review has passed. Distances are labelled straight-line. No cash play is enabled.
- The simulation currently covers two footprint-family classifications, not the three-family release target. Neighboring packs, routing-connected entrances and field walks remain open.
- World allocation is transactionally protected in the current single-service SQLite runtime; PostgreSQL/PostGIS, durable pre-generation jobs, city quotas, multi-process races and operator preview are still planned.
- The interface has not passed the full typography/contrast, offline/result-recovery or five-newcomer acceptance protocol. Some older secondary surfaces still require redesign. Actual Safari/iOS, Chrome/Android, soft-keyboard, enlarged-text and native-wallet device checks remain open.
- Discovery receipt recovery across a crash, full native multi-slot equipment, the verified 3D catalog, creator publication XP, paid access/follows, Intents settlement and durable media/moderation remain open.
- No complete W00–W14 milestone is labelled passed. Implementation continues from the evidence in this log and `docs/roadmap.json`.

## Native identity increment

- Added primary NEAR testnet sign-in using NEP-413. An existing linked wallet restores its same explorer and progress. A new valid wallet creates one explorer only after ownership verification. No game custody key or recovery phrase is requested.
- The backend verifies the currently registered **FullAccess** public key through RPC and checks the challenge recipient, account, network, purpose, expiry and one-time consumption. Linking and signing in use distinct purposes. Expiry is rechecked after asynchronous RPC verification.
- Added a game-styled accessible wallet picker with explicit cancellation, a native welcome dialog, visible form errors and preserved nickname on cancellation. The wallet picker does not expose developer manifest/debug forms.
- 29 application tests pass. New cases use real cryptographic signatures with a local RPC fixture and cover recovery, no duplicate starter grant, wrong recipient/account, function-call keys, link-versus-login isolation, replay races and expiry during a delayed RPC response.
- A separate live test used the project's existing developer testnet account against the real NEAR RPC and the local running application. The same explorer was restored twice, a real session was verified and no chain transaction was submitted. Only public identity and a signature went to the server. Evidence: `output/qa/W03/live-near-identity.json`; no credential or session token is in that file.
- The browser exercised opening the wallet choices, cancellation, nickname retention and inline invalid-name feedback. This is not yet a signed mobile-wallet/browser round trip. Native passkey account creation, on-chain profile publication and hardware/browser interoperability remain open.
- Refined overview camera bounds and smaller overview markers so the northern site and current character do not dominate/crop the city view. Public rollout of this increment follows its final UI checks.

- The RPC reports its actual network before identity/balance verification. A mainnet endpoint or syncing node is rejected instead of being labelled testnet. Each login still reads current access-key ownership. The live test was repeated after this guard.
- Wallet choices require message signing and sign-in without adding an application access key. Both identity SDK versions are pinned to the versions tested in this increment.
- Phone form checks include a 20px form-text stress setting and a reduced 390×430 layout. The input and primary action remain reachable by scrolling. These are explicit browser stress cases, not a physical soft-keyboard or OS text-setting result.

## Native wardrobe increment

Native identity release `20261031T020502Z` / commit `1e1e4a7` was deployed and verified through the public HTTPS API with the live NEAR testnet account. The public city overview also received its corrected bounds and smaller overview markers.

- Upgraded the existing owned testnet NFT contract atomically to schema V2. The original NFT and original supply were checked before/after migration. Collection display metadata now says QuestLayer; historical account addresses and old token metadata were preserved.
- Added caller-owned starter explorer NFTs, independent above/below Aura slots, owner checks, transfer cleanup, and cleanup of transient receiver equipment after a returned `nft_transfer_call`. The original single-slot view remains compatible.
- Added an oracle-only `mint_aura_once` claim ID. A retry returns the same token even after it has transferred, cannot redirect its original recipient and cannot exceed edition caps. Compound mint storage is charged before unused deposits are refunded through the standard NFT utility.
- The explorer art is generated from the same canonical SVG function used by the game. The NFT embeds its SVG, so its 2D image requires no separate asset host. This does not constitute a 3D model catalog.
- Nine real testnet transactions verified migration, caller minting, independent equipment, transfer cleanup, replay without reminting, return and restored equipment. Evidence: `public/native-wardrobe-testnet.json` and `output/qa/W04/live-wardrobe.json`.
- Read-only native inventory verifies each owner and each equipped token. It supports limited pagination, removes stale ownership, coalesces normal reads and prevents an older in-flight request overwriting a confirmed refresh.
- Added a public collection/outfit preview and wallet-owned NFT sections. Wallet transactions create/equip/remove NFTs; the server stores no player signing key. A confirmed native outfit can be used on the map; equipping a demo item selects the demo outfit again.
- Header, inventory, map and public outfit preview share the character art/composition. Demo listing failures now keep the entered price and selling form open.
- 34 application tests and 19 Rust tests pass. The live local application test proved signed identity → owned NFTs → both native equipment slots → native outfit selection in the same profile. No player key was uploaded.

Important boundary: quest chest drops and GOLD settlement still use the demo game ledger. Native Aura issuance is currently an owned testnet proof through the idempotent oracle method; a durable gameplay-to-native reward outbox remains W06 work. The native wallet transaction path still needs a real mobile/browser wallet round trip and physical-device checks. Native market/Intents sales, real staking/yield and the complete 3D wardrobe remain open.

### RPC correction discovered in browser review

The former `rpc.testnet.near.org` endpoint began returning JSON-RPC `-429` with an explicit deprecation warning during the native collection phone check. This was an observed infrastructure failure, not an ownership failure. Updated default configuration, the service unit and operator scripts to FASTNEAR's current testnet endpoint. The application uses the SDK failover provider with Intear's testnet RPC as backup; explicitly supplied custom RPCs remain isolated for configuration and test determinism. Network status checks are coalesced, failures do not poison subsequent retries, and the public collection has an explicit retry action. A real read through the new provider returned the three owned NFTs and both equipment slots in 1.47 seconds in that check; this is one observation, not a performance guarantee. Endpoint source: [official NEAR RPC providers](https://docs.near.org/api/rpc/providers).

| Before | After | Why / source |
| --- | --- | --- |
| Inventory showed demo items alongside a disconnected testnet proof. | A separately labelled NEAR inventory and a public live outfit preview read actual ownership and equipment. | Keep source and asset custody understandable; `src/NativeWardrobe.tsx`, `server/native/collectibles.mjs`. |
| Header, map and item previews had separate ghost/Aura paths. | Shared composition and canonical SVG source cover header, map, inventory and public outfit previews. | An equipped appearance should have one visual identity; `src/App.tsx`, `src/character-art.ts`. |
| The NFT contract exposed one legacy equipment slot. | Above/below equipment survives safe migration and clears on transfers/failed transfer-call returns. | Ownership is authoritative; `contracts/collectibles/src/lib.rs`. |
| A deprecated RPC made an otherwise valid owned outfit unavailable. | Updated providers, a backup transport, coalesced network checks and visible retry. | Availability errors must not be presented as asset loss; `server/near-provider.mjs`, `server/identity/near.mjs`. |

Browser evidence currently includes the real native public outfit on desktop, at 360/390 CSS px and at 844 × 390 landscape. The confirmed outfit shows the original preserved polar Aura above and the newly minted moon Aura below. The guest's own character correctly stays in its separate demo outfit. Phone browser frames are layout checks, not physical iOS/Android device results. Wallet approval, soft-keyboard and OS enlarged-text checks for native transaction screens remain pending.

The inventory wallet picker was exercised with Tab and Escape without selecting a wallet or signing. This caught a focus-return failure: disabling the invoking button while the SDK loaded caused the dialog to capture the document body as its previous focus. The shared action wrapper now remembers the invoking control before the busy state and restores it after cancellation when no other dialog has opened. The repeated browser check confirmed focus on “Connect a NEAR wallet”; `output/qa/W04/keyboard-wallet-cancel.png` records that state.


Native wardrobe app release `20261031T030717Z` / commit `9d90a25` is live. The post-deployment public HTTPS smoke test restored the same NEAR player with no duplicate demo grant and confirmed the three owned NFTs, both equipment slots and active native outfit. Public browser inspection also confirmed the live native collection. Backups are recorded in `output/qa/W04/deployment.txt`.


## Durable city-day preparation

Added offline preparation for today's and tomorrow's city plan, SQLite job leases, bounded retry, stale-worker rejection and persisted process-restart recovery. Ready plans retain source/integrity hashes. Preparation never reserves money or spawns claimable objects. World creation consumes the prepared geometry only for its active local day and expires old unclaimed backing before reserving new rewards. Midnight rollover no longer waits for the 30-second maintenance interval to make that backing available. Local calendar boundary lookup now uses bounded binary search and passes both 23-hour and 25-hour DST dates.

The app starts its worker automatically. Public health reports only readiness/date states; the operator CLI exports a nonfinancial GeoJSON preview. Older preparation cache entries expire after 14 days, independently of published worlds and receipts. Existing city manifests remain unchanged for their day. The generation in-flight cache is scoped to each database connection.

All 40 application tests pass. Six focused worker cases cover deterministic geography, unchanged treasury during future preparation, retry, lease takeover, actual SQLite reopen after interruption and conserved rollover. The live local service reports both dates ready. Details: `docs/WORLD-WORKER.md`; evidence: `output/qa/W01-worker/`.


Worker release `20261031T031845Z` / commit `5405fbd` is live. Public health confirms both the current and next Plzeň date prepared in one attempt; evidence: `output/qa/W01-worker/public-health.json`.

## Earned Aura claim increment — pre-activation

Implemented an application attestor with a private persistent non-wallet signing key, domain/receiver/edition/expiry-bound vouchers, a 15-minute resumable demo-item reservation, finalized claim confirmation and safe post-expiry demo restoration. The server never signs a player NEAR transaction. Contract V3 adds owner-configured public attestation verification, canonical on-chain Aura images and state-preserving V2 migration. Existing avatars/equipment/legacy claims remain compatible. Current checks: 47 application tests and 25 Rust tests pass; locked WASM build succeeds.

| Before | After | Why / source |
| --- | --- | --- |
| A chest cosmetic could only remain in the demo inventory. | Its owner can request a bound claim and approve a native NFT mint in their own wallet. | Connect gameplay to owned NEAR assets; `server/native/award-vouchers.mjs`, `src/AuraClaims.tsx`. |
| Cancelling a wallet prompt had no native reward state. | Issued, confirmed and safely restorable states are durable; duplicate mints and demo resale are excluded. | Retry without duplicating rights; `server/game.mjs`, `contracts/collectibles/src/lib.rs`. |
| A signing outage could hide recovery actions. | Existing claims keep Check/Restore controls independently of mint availability. | Recovery must remain usable; `src/AuraClaims.tsx`. |

UI evidence is explicitly labelled fixture-based: 360/390 px, 20px enlarged text, long addresses, landscape, desktop and keyboard activation. Fixtures perform no blockchain transaction and are excluded from production. Real wallet approval on physical devices remains unverified. Live contract migration and end-to-end application proof are the next activation steps. Details: `docs/NATIVE-AURA-CLAIMS.md`.


### Live earned Aura activation

Application release `20261031T035422Z` / commit `20dc5bd` is live. The NFT contract migrated V2→V3 in transaction `7Vh9zALvY8dX3R6eMhjHbxF6uUnCQrcGRUGVszqC3EmB`, preserving all three original tokens and both equipment slots. The owner configured only the server's public attestation key; its private key remained in the protected application state directory and is not a NEAR wallet access key.

The owned developer account then completed the full public application flow: free demo-arena chest → signed claim → native `aura:polar:2` → finalized application receipt → native above-slot equipment. The actual mint transaction is `Mq4yurjy6v2hkETktGkJzC5a3hyrG2tVyLDj8KNgknP`; retry `9VAxoGdnLLY7PhYhbV1Uy4RcFX9MdT7qC36chbw3fYKU` minted no duplicate. The demo market rejected that item both while reserved and after confirmation. Supply increased from three to four once. This is explicitly an arena/protocol proof, not physical GPS evidence. No player private key was uploaded and no server wallet access key signed a NEAR transaction. Evidence: `public/native-claims-testnet.json`, `public/earned-aura-testnet.json`, `output/qa/W06-claims/`.

Remaining: actual mobile/browser wallet approval, native cash/yield settlement and reviewed mainnet operation. The live CLI proof does not replace those gates.


Earned-Aura proof publication release `20261031T040245Z` / commit `e8fbfb5` is live.

## Native market increment — application review

Added a testnet-only NEP-171 escrow market with exact native NEAR prices, stale-listing protection, owner-only listing, bounded sponsored storage, asynchronous NFT delivery, pull-payment proceeds/refunds and restoration after failed transfers. The server reads state and signs no market transaction. The shared RPC reader retains coalescing/fresh-read race protection; grouped RPC errors now preserve meaningful ownership validation errors.

The new market contract is live at `questlayer-market-20261031.testnet`. A full real trade proof passed using only two owned developer accounts. An earned Aura entered escrow, returned on cancellation, relisted with a different identifier, transferred to its buyer for exactly 0.01 test NEAR and paid its seller through an actual withdrawal. A 0.02 test NEAR sample offer remains visible in escrow. This is developer test activity, not external users or market volume. Proofs: `public/native-market-testnet.json`, `public/native-market-trades-testnet.json`.

The application now has separate Native Aura / Demo GOLD market sections, wallet-specific balances, exact decimal input, cancellation, withdrawal and authoritative ownership checks after actions. Local browser inspection loaded the actual sample NFT and escrow state. Connected-wallet form layout is reviewed in explicitly labelled fixtures whose trade callbacks submit no transaction. Price validation rejects exponent notation and preserves the entered value; input focus/remaining phone review are being completed before app deployment. Current checks: 49 application tests, 38 Rust tests.

| Before | After | Why / source |
| --- | --- | --- |
| Only server-settled demo offers were available (source finding). | A distinct native testnet section reads actual escrowed NFTs and quotes NEAR. | Keep asset/currency sources explicit; `src/NativeMarketPanel.tsx`, `server/native/market.mjs`. |
| A submitted trade could be mistaken for a completed swap. | Wallet results are followed by fresh NFT ownership/listing/balance checks. | Confirm delivery before success; `src/App.tsx`, `src/NativeMarketPanel.tsx`. |
| Generic errors could disable unrelated trading while editing a bad price. | Price validation is scoped to its input and returns focus there. | Preserve correction and keyboard flow; `src/NativeMarketPanel.tsx`. |

Canonical Intents, native yield and reviewed mainnet operation remain open. Details: `docs/NATIVE-MARKET.md`.


Market UI review completed before publication: the actual public escrow offer is visible in the app; fixture form states passed 360/390 widths, 20px text, short-height and landscape review. Price errors preserve the value, remain local to that field and return focus to it; keyboard correction kept all 24 decimal places. Missing wallet-balance data is labelled unavailable rather than zero. No fixture trade submitted a chain transaction. Actual mobile wallet approval, mainnet policy and event indexing remain open.


Native market application release `20261031T043243Z` / commit `c70c648` is live. Public API and browser inspection confirmed sample offer 3 at 0.02 test NEAR, NFT escrow ownership and the market accounting invariant. Evidence: `output/qa/W07-market/public-api.json`, `public-native-offer.png` and `app-deployment.txt`.

## Nearby native appearance and privacy increment

Nearby map characters now use the shared composition renderer, including the original verified skin and independent above/below Auras. The native look is checked against actual equipment and current ownership; RPC failures omit unverified effects. Wallet accounts, native token identifiers, balances and inventory are excluded from the nearby response.

Sharing is explicit, foreground-only and bounded to 15 minutes. GPS and demo presence are isolated. Heartbeats retain the original expiry; stale positions disappear after 30 seconds. Per-activation leases, asynchronous response guards and short-lived revocation tombstones prevent old cleanup, delayed initial publication and stale heartbeats from overriding the current consent. A hidden tab stops sharing and requires a fresh opt-in on return.

| Before | After | Why / source |
| --- | --- | --- |
| Nearby explorers showed only a generic colored ghost (source finding). | The actual native above/below outfit is composed on their marker. | Make collected identity visible consistently; `server/appearance.mjs`, `src/character-art.ts`, `src/GameMap.tsx`. |
| A late cleanup could remove a newer share; arena/GPS records shared one discovery pool. | Lease-bound updates, cancellation tombstones and explicit realms. | Preserve the latest consent and physical/demo separation; `server/presence.mjs`. |
| Sharing could continue from a background tab. | Visibility/page lifecycle stops publication with a bounded server staleness fallback. | Publish only while intentionally present; `src/App.tsx`. |

A live local API proof used only an owned developer account and synthetic arena coordinates. It verified the on-chain green/purple outfit, reduced response and GPS isolation, then opted out. Browser review captured desktop and 360px native peer markers, 360/390 consent menus and keyboard-reachable landscape controls. No physical GPS or actual mobile wallet approval is claimed. Details: `docs/PEER-APPEARANCES.md`.

All 58 application tests pass for this increment. The unchanged contracts retain their prior 38 passing Rust tests. The profile disclosure supports Escape with focus return; its scrollable short-landscape menu keeps sharing controls keyboard-reachable.


Nearby appearance/privacy release `20261031T045233Z` / commit `1907d3b` is live. A separate public HTTPS API smoke test confirmed both actual native Aura slots, no wallet/native token identifiers in the peer response and demo/GPS isolation, then removed the synthetic share. Evidence: `output/qa/W04/public-native-presence.json` and `peer-deployment.txt`.

## Native staking foundation

Added finalized-block-pinned testnet pool views, strict u128 money calculations, E+2 tranche/contribution access, loss-recovery-aware unrealized quotes, a sealed asynchronous exit scheduler and a versioned receipt/bucket model. Real read-only probes verified three active pools and recorded their fees, key state, owner, code hash, epoch and delegator view. No APY was invented from total stake. No staking transaction or player deposit occurred.

The executable funding simulation exercises two exit cohorts without resetting the older unlock, excludes principal/retained yield/unclassified surplus from game income, allocates each modeled receipt once and preserves awarded/expired backing. These are executable specifications, not a native vault or actual earnings. The detailed design records the open provisional-fee loss/recovery question before any real custody implementation. Details: `docs/NATIVE-STAKING-FOUNDATION.md` and `output/qa/W05/`.

Staking-foundation verification: all 66 application tests and the production build pass. Tests include eight native foundation cases and bounded policy/reservation stress. Test-process concurrency is capped at four; cold-start readiness uses a 15-second bound to avoid CPU-contention false failures. Contracts are unchanged from the 38-test Rust check.


## Optional upstream 3D dressing room

Added an on-demand real GLB preview with both equipped QuestLayer Aura effects, button/keyboard rotation and zoom, reset, native-dialog Escape/focus return and canonical 2D fallback. The modest upstream starter body is 664,092 bytes / 5,275 vertices / nine meshes; it loads without a preprocessing pipeline. The renderer is a separate lazy chunk (about 164 KiB gzip at this build), rather than part of ordinary map loading. The cache fetches individual fixed-source models and never mirrors the whole catalog or starts upstream render jobs. Original model requests must match the verified Base equipment snapshot and report unsupported slots honestly.

| Before | After | Why / owning source |
| --- | --- | --- |
| Character inspection only used 2D art. | A deliberate optional 3D dressing room with the actual upstream body and both equipped Auras. | Inspect collectible identity without loading 3D during ordinary play; `src/Character3D.tsx`, `src/character-3d-scene.ts`. |
| A portrait-style dialog needed scrolling on short landscape (observed screenshot). | Two-column model/controls composition. | Keep the character, controls and context visible; `src/style.css`. |
| Compact header effects used full-size Aura dimensions (observed). | Scaled effects fit the compact avatar. | Preserve name/control readability; `src/style.css`. |
| Peer original images used the viewer's ownership route (source finding). | A separate shared-skin route checks the publisher's current consent and ownership snapshot. | Other explorers need not own the same NFT to see a voluntarily shared look; `server/appearance.mjs`, `server/index.mjs`. |

The real local browser flow earned two demo-chest Auras in separate free zones, equipped both and inspected them in 3D. This does not claim physical movement or a native-wallet transaction. Permission evidence, adoption scope and unresolved full-catalog rights/device gates are recorded in `docs/ASSET-CATALOG.md`.


The complex public reference #6741 exposed a genuine texture cost: 6,133,316 source bytes and 21 images despite only 13,052 vertices. Added serialized, bounded, on-demand texture LOD, preserving geometry, skinning and UVs. The measured result is 1,986,172 bytes / about 21 MiB decoded textures. A labelled local reference fixture rendered the actual clothing; no ownership or wallet transaction is claimed. Base equipment was compared before deriving its renderer identity. The user-facing original preview reports the extra background slot as incomplete. The basic starter asset still loads directly without optimization.

Actual browser layouts now cover 360/390 widths, 20px enlarged text, desktop and short landscape. Buttons, keyboard/Home and Escape/focus return were exercised; two demo-chest discoveries supplied the displayed Aura slots. Real mobile hardware and signed original-owner/browser flows remain open.

3D/appearance verification: all 72 application tests and the production build pass. The reference optimization unit case preserves geometry and UVs while reducing texture memory. The unchanged native contracts retain their prior 38 passing Rust tests. Actual mobile hardware remains a release gate.

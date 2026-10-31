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

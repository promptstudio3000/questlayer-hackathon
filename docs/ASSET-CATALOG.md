# Character artwork and 3D adoption record

QuestLayer uses its own canonical SVG explorer and Aura artwork for its native NFT metadata. A verified original Aavegotchi remains a read-only Base-owned appearance. The map and optional dressing room render actual upstream GLBs. Five official template SVG layers supply the shared starter UI and 2D fallback. These visual integrations do not mint, bridge, sell or claim ownership of an original Aavegotchi NFT.

## Sources and permission evidence

| Asset | Source / evidence | Adopted scope | Rights status |
| --- | --- | --- | --- |
| Historical native collectible SVG covers | `src/character-art.ts`; generated public artwork and embedded NEAR NFT media | Historical native collectible cover media; the shared UI now uses the official starter template below | Authored project artwork |
| Aura edition sprites (catalog v2) | `src/aura-art-data.ts` (pixel painters), `server/data/aura-catalog.json` (editions, sets, entitlements); rendered sheet under `output/qa/W04-aura-catalog/` | Nine editions (Ember Wisp, Dewfall Ring, Northern Lights, Meadow Bloom, Stormcrown, Moonwake/Moon Ring, Comet Trail, Sunlit/Golden Dust, Nova Bloom), each authored for the 48x24 `above` and 56x20 `below` grids with two sparkle frames | Original project pixel geometry generated from hand-placed keypoints in source; no upstream or third-party artwork, fonts or generators. Distributable as project artwork. |
| NPC and monster 3D models | `src/actor-models.ts`; dev preview `dev/actor-models.html`; rendered sheet `output/qa/actor-models/preview.png` | Nine characters (chronicler, merchant, keeper, pilgrim, wisp, glitch-moth, rune-warden, pocket-wisp, storm-golem) built from three.js primitives in code; baked once into cached map sprites, plus one animated view in the encounter sheet | Original project geometry and palette, in an Aavegotchi-compatible style only. No Aavegotchi or Gotchiverse character, land or installation art is copied or loaded (those repositories carry no licence, checked 1 Nov 2026). Distributable as project artwork. |
| Gotchiverse monsters and props (Lickquidator soldier, brute, Dire Tire, Laser Beamer, boss recolour; Great Portal, Golden Altar) | Pinned commit `dc413dd4…` of [aavegotchi/GotchiGuardiansInverse](https://github.com/aavegotchi/GotchiGuardiansInverse); exact paths, sizes and SHA-256 in `server/upstream-models.mjs` | Fetched on demand by the server from that one source, checked by size and digest, cached in memory and served to signed-in players at `/api/upstream-models/<key>.fbx`; rendered with three.js FBXLoader in flat-shaded materials using the upstream colours | The repository has no licence. The owner confirmed on 1 Nov 2026 that the Aavegotchi developer invitation covers these Gotchiverse characters and props. No bytes are committed or redistributed as files; original stand-ins (`src/actor-models.ts`) render if the source is unavailable. Commercial/trademark review stays a release gate as for the SDK models. |
| Shared map/list game objects | `src/game-object-art-data.ts` and `src/game-object-art.tsx`; [provenance and rendered evidence](../output/qa/W02-object-art/README.md) | Authored 32px coin, chest, discovery, route/place, completion/lock and independent selection states; shared SVG/DOM/raster rendering | Original project pixel geometry; independent of verified character layers and upstream artwork. Brand/trademark release gates remain separate. |
| Original on-chain Aavegotchi SVG | Canonical Base contract, selected through verified wallet ownership | Read-only chosen appearance; shared only during active presence | Original asset; no ownership transfer or claim that the artwork is MIT/CC0 |
| Aavegotchi 3D body / wardrobe | [Official SDK page](https://www.aavegotchi.com/sdk), its published invitation to build Gotchi experiences in Unity and beyond, and [official renderer interface](https://github.com/aavegotchi/aavegotchi-3d-render-skill) | Prototype map and dressing-room visualization from already available upstream GLBs | Published developer-use invitation is recorded; no standard blanket artwork license is asserted. Complete catalog/commercial/trademark rights review remains open. |
| glTF Transform | Official `@gltf-transform/core` / `extensions` 4.5.1 packages, MIT | Serialized on-demand texture LOD for heavier previews | Full notice retained at `/GLTF-TRANSFORM-LICENSE.txt`; software licensing does not license the artwork |
| Three.js runtime | Official `three` 0.187.0 package, MIT | On-demand renderer, loader and orbit controls | Full notice retained at `/THREE-LICENSE.txt` |

The [sprite generator](https://github.com/aavegotchi/aavegotchi-game-sprites) distinguishes its MIT software from third-party artwork and marks. Its software license is not used as permission for the 3D artwork. Neither the generator nor the Unity runtime was installed or copied into QuestLayer. The renderer's protocol mappings were implemented locally; its external agent instructions/installers were not adopted.

The prototype attributes the SDK in the dressing room. It does not imply an official partnership, original NFT ownership for new players, or a license to sell upstream models as new NFTs. Native collectible media remain the project's own SVGs. The generic starter preview removes the upstream ETH collateral mesh at runtime; original owners' geometry and equipped composition are retained. This is a visual body preview, not an Ethereum integration.

## Measured starter asset

The actual available GLB `Eth-Common2-Common-0-0-0-0-0-0-0` has SHA-256 `19ddddacbb2045b6ecbae5d14f96f017063d8e1de9c06ae23c928ece9d960d7d` at this probe. It is 664,092 bytes with 5,275 declared vertices, 9 meshes, 64 nodes, 4 materials and three embedded 1024×1024 JPEG textures (about 12 MiB decoded RGBA). It has no animation clips or external buffers/images. This modest preview did not require an optimization pipeline. It does not establish the cost or coverage of every outfit or of many concurrent 3D map players.

The observed direct CDN response did not provide browser CORS permission. The game therefore fetches only requested assets through a fixed-source, bounded same-origin cache. It does not mirror the full dataset. Renderer requests use `verify:true, force:false`; missing generated models remain unavailable and do not start render jobs.

## Loading and safety budgets

- Dynamic 3D code loads after map readiness when 3D is enabled, or when the player opens the dressing room. One local map pawn uses a small independent canvas. Other explorers and zone pins use actual 2D artwork; this does not create a renderer per peer. Data Saver defaults to 2D; Inventory exposes a persistent 2D/3D preference. Unsupported character slots keep their complete verified SVG on the map. A portrait background alone does not block the actual 3D character.
- Only server-derived renderer identities and one fixed CDN are allowed. The public asset route accepts a known content digest and cannot fetch an arbitrary URL.
- Source GLBs are capped at 12 MiB and final preview GLBs at 6 MiB; cache at 24 MiB / 12 entries; concurrent asset loads at three. Descriptors require an authenticated player and are rate bounded.
- Embedded resources only, at most 500,000 declared vertices / 120 meshes / 512 nodes, 32 preview images (up to 64 source images), 4 Mi pixels per image and 8 Mi pixels total. Unsupported required decoders are rejected. Source inspection bounds total input pixels separately; only one texture optimization runs at a time.
- The browser verifies the content digest before parsing. Rendering is on demand with no idle frame loop or automatic camera motion; close disposes graphics, textures and the WebGL context.
- Original model traits are read from the official Base index and equipped slots must match the recently verified Base wardrobe snapshot. Unknown mappings fail closed. An unavailable original never silently becomes a generic 3D original.
- Only the seven upstream renderer wardrobe positions are represented by that hash. Other equipped slots produce an explicit partial-coverage notice; the verified 2D SVG remains the complete view.

## Observed complex outfit and targeted LOD

A public reference probe of original #6741 compared all equipped positions with the canonical Base RPC before deriving the renderer identity. Its available source has 13,052 declared vertices, 15 meshes, 76 nodes and 21 images in 6,133,316 bytes. The texture set exceeded the conservative mobile memory budget even though geometry was modest. Only such heavier requested models enter the texture pipeline. Existing smaller textures remain byte-identical; larger JPEG/PNG textures are resized to at most 512px with nearest sampling, preserving the pixel character. Materials, UVs, geometry and skinning remain in the glTF document. No new upstream render is requested.

The measured preview is 1,986,172 bytes, with the same vertex/mesh/node counts and approximately 21 MiB decoded texture data. Its extra background position remains an explicitly unsupported 3D slot. This is a public reference, not a project-owned NFT or ownership-import proof. A labelled local-only fixture rendered its actual outfit after optimization; it and the temporary binary are excluded from deployment, and the binary is ignored by Git. Records and screenshots are under `output/qa/W04-models/`.

## Review evidence and remaining gates

Browser evidence under `output/qa/W04-models/` includes actual upstream starter rendering, two demo-chest Auras equipped in both 2D and 3D, button/keyboard rotation, Home, Escape/focus return and desktop/phone/landscape compositions. The short landscape uses two columns to keep model and controls visible. Compact character Auras were resized after an observed oversized header effect.

This is browser layout evidence, not physical Safari/iOS or Chrome/Android verification. Full modular wardrobe editing, all-original model coverage, worst-case devices, context-loss recovery, distributed asset rights clearance and mainnet/commercial packaging remain open. Read-only probes are not claims that the reference NFTs belong to this project.

## Shared real starter visuals (2026-10-31 follow-up)

Five unchanged official layers from [aavegotchi-assets](https://github.com/aavegotchi/aavegotchi-assets/tree/b302ce569ac7f98a97947ce4e66f63bae85a0c66/images/template) now supply the body, cheeks, eyes, mouth and closed hands. `public/art/aavegotchi/provenance.json` records each source URL, exact SHA-256, composition and distribution scope. `scripts/build-starter-art.mjs` verifies the upstream bytes, preserves root fill colors and composes a cropped viewport without changing the paths. The served artifact is 1,966 bytes and content-addressed under `/assets/`, including deployment retention for older tabs. No collateral badge, premium wearable or original token identity is included.

The same actual starter art replaces the authored stand-in in profile, inventory, Aura previews, guides, map fallbacks and zone/peer markers. Native market and collection previews use this game appearance; already minted on-chain cover media stay unchanged. The map's real GLB body follows heading after a meaningful movement and map rotation. Equipped map Auras deliberately remain screen-space rings for readability, while the dressing room renders the two 3D ring slots. The local pawn is screen-anchored, with no claim of terrain/building occlusion or walking animation. The measured starter GLB contains no animation clips.

The client verifies source, selected original ID, digest-to-URL binding and SHA-256 bytes. Only two verified downloads are kept for five minutes, with fresh authorized descriptors required even on cache hits. Originals with unsupported character slots keep their complete 2D view. A portrait background in the documented slot 7 may be omitted on the map without dropping character clothing; descriptors distinguish `complete`, `mapCompatible` and `backgroundOmitted`. This does not establish full catalog coverage, commercial/trademark rights, physical phone performance or completed modular dressing.

## Original item artwork and ownership refresh

`getItemSvg(uint256)` on canonical Base contract `0xA99c4B08201F2913Db8D28e71d020c4298F29dBF` supplies the actual original item images. The [official SvgFacet](https://github.com/aavegotchi/aavegotchi-contracts/blob/master/contracts/Aavegotchi/facets/SvgFacet.sol) documents that getter; [LibItems](https://github.com/aavegotchi/aavegotchi-contracts/blob/master/contracts/Aavegotchi/libraries/LibItems.sol) defines portrait background slot 7 separately from body/face/eyes/head/hands/pet slots 0–6. Unknown later slots still prevent a partial 3D map look.

The linked inventory now shows original item pictures and positive quantities in pages of 12. These include loose and nested original items from the existing ownership reader; not every item is necessarily wearable. The API checks a positive, fresh five-minute ownership snapshot before every artwork lookup, including cache hits. Artwork requests are constrained to the canonical contract and numeric item ID, with four concurrent RPC reads, at most 24 pending unique items, a 4-second transport timeout, 200,000-byte SVG limit, 64 cached items and 2 MiB total cache. The response is sandboxed SVG and private for 60 seconds. A failed picture has an explicit unavailable state rather than invented art.

A manual inventory refresh performs a new ownership lookup, bounded to one forced request per minute per player and three concurrent distinct owner lookups. When a selected original is absent from its refreshed address snapshot, the server clears that appearance and the client updates only its appearance field. Inventory JSON omits raw SVG payloads in both success and failure responses. Ownership pagination across more than the first 50 original NFTs, complete item names/categories, modular try-on, automatic transfer observation and physical-device validation remain open. This gallery does not mint, transfer, sell or claim possession of the external items.

A real public read at Base block `53326551` verified six SVGs (#85, #384, #57, #84, #58, #82), totalling 2,062 bytes. Their hashes and explicit `ownershipClaimed:false` values are in `output/qa/W04-real-assets/public-item-source.json`. The local reference fixture labels them as not owned; its raw files are ignored and excluded from deployment. Runtime player ownership was separately tested through isolated HTTP/RPC fixtures, not a personal wallet signing session.

The small map renderer preserves its drawing buffer and repaints on move/resize/foreground restoration, including one bounded reveal frame after becoming visible. This prevents an intermittently blank character after viewport changes without introducing an idle rendering loop. The browser round-trip regression and follow-up build are recorded in the same evidence directory.

## Aura catalog v2 (2026-11-01)

The Aura wardrobe grew from three to nine editions. `server/data/aura-catalog.json` is the single source for names, rarity, default slot, colour, set and the `native` flag; the client reads it through `src/aura-catalog.ts` and the server through `server/aura-catalog.mjs`, and `tests/aura-catalog.test.mjs` keeps them in step.

| Edition | Rarity | Slot | Set | Native NFT |
| --- | --- | --- | --- | --- |
| Ember Wisp | common | above | First Light | yes (`aura:ember:*`) |
| Dewfall Ring | common | below | First Light | yes (`aura:dew:*`) |
| Northern Lights | rare | above | Night Sky | yes (`aura:polar:*`) |
| Meadow Bloom | rare | below | First Light | yes (`aura:bloom:*`) |
| Stormcrown | epic | above | Tempest | yes (`aura:storm:*`) |
| Moonwake Aura (demo name Moon Ring) | epic | below | Night Sky | yes (`aura:moon:*`) |
| Comet Trail | epic | below | Tempest | yes (`aura:comet:*`) |
| Sunlit Aura (demo name Golden Dust) | legendary | above | Solar Crown | yes (`aura:gold:*`) |
| Nova Bloom | legendary | below | Solar Crown | yes (`aura:nova:*`) |

**Artwork and rights.** Every sprite is drawn in code by the painters in `src/aura-art-data.ts`, using the existing style rules: light from the upper left, a 1px `#1A0335` outline at 40% opacity, a static base layer and two alternating sparkle frames. No upstream Aavegotchi artwork, wearable geometry or third-party asset is used, so the sprites are project-authored artwork under the repository license. The on-chain cover media of already minted Aura tokens is unchanged.

**Entitlements.** A chest can hold an edition only when the chest's zone tier and the player's level meet its rarity rule: common in any zone at any level, rare from level 2, epic in expedition or gold zones (tier 2+) from level 3, legendary in gold zones (tier 3) from level 4. Within the allowed editions the server prefers ones the player does not yet hold, then rotates, and skips editions whose 256-copy practice supply is used up. A chest's `itemAvailable` flag now reflects that player's entitled supply. Already stored inventory rows keep their names, rarity and colour; nothing is renamed or reissued.

**Set bonuses are cosmetic only.** Wearing two different editions of one set (one above, one below) adds a soft glow behind the explorer and a short note in the wardrobe. It never changes GOLD, XP, rewards, drop chances or any claim. Reduced motion shows a static glow.

**Native editions (follow-up, 2026-11-01).** All nine editions are now native: the collectibles contract has a code-only `AURA_EDITIONS` table (id, title, cover media) and a `supported_editions` view, with no state migration. Token ids stay `aura:<edition>:<serial>` with 256 per edition, the voucher message format (`QuestLayer Aura claim v1`) is unchanged, and the three existing cover media files are byte-identical. The six new covers (`contracts/collectibles/assets/aura-<edition>-uri.txt`, `public/aura-<edition>.svg`) are generated by `scripts/generate-explorer-assets.mjs` from the same project-authored explorer-with-ring design, tinted per edition. Demo items named Moon Ring or Golden Dust now also map to their native editions. The server signs a voucher for a new edition only when the deployed contract lists it in `supported_editions`, so an older deployment never receives a voucher it would reject. The testnet upgrade is `scripts/upgrade-collectibles-editions-testnet.mjs` (read-only plan, then `--execute`). The new WASM needs a fresh independent review before mainnet; see `docs/COLLECTIBLES-REVIEW.md`. Already issued tokens are untouched.

**NPC and monster editions (N5, 2026-11-01).** Six editions are earned only from roaming NPCs and monsters (`docs/NPC-PLAN.md` §4 and §13.4), never from zone chests. They are native from the start; the catalog marks them with `source: "npc"` or `"monster"` and a `how` line shown in the wardrobe catalog.

| Edition | Rarity | Slot | Set | Source | Claim id prefix |
| --- | --- | --- | --- | --- | --- |
| Pilgrim's Path | rare | below | Wayfarers | NPC (quest giver, 5 lines) | `earned:npc:` |
| Chronicle Crown | epic | above | Wayfarers | NPC (storyteller chapter set) | `earned:npc:` |
| Merchant's Ledger | epic | below | Wayfarers | NPC (trader loyalty, 10 trades) | `earned:npc:` |
| Wardbreaker Horns | epic | above | Night Hunt | Monster (zone guardian) | `earned:monster:` |
| Will-o'-Wisp Halo | legendary | above | Night Hunt | NPC (wandering rare item game) | `earned:npc:` |
| Bossbane Fangring | legendary | below | Night Hunt | Monster (weekly boss, 3+ hits) | `earned:monster:` |

The contract enforces this: `CLAIM_ONLY_EDITIONS` mints these editions only for a claim whose id starts with the prefix (signed `redeem_aura` claims or the oracle's `mint_aura_once`), and the claim-less oracle `mint_aura` refuses them. The `claim_only_editions` view lists them, and `get_claim` shows where each token came from. The server's award vouchers use the matching prefix (`awardClaimPrefix` in `server/aura-catalog.mjs`). Their tokens say "Earned from a QuestLayer NPC." or "Earned by beating a QuestLayer monster." Supply stays 256 per edition. The sprites are original project creatures and props (storybook, coins, waystone, ghost-fire lantern, guardian horns, a fang ring around a rift), drawn by the painters in `src/aura-art-data.ts` with the same style rules; no Aavegotchi artwork or lore is used. Rendered sheet: `output/qa/N5-npc-editions/npc-edition-sprites.png`. Set bonuses stay cosmetic.

**Wardrobe.** The practice collection can be filtered by slot, rarity and set, is sorted rarest first, and has an Aura catalog listing every edition with where it can be found and how many the player holds. Controls are native buttons and selects with 48px targets.

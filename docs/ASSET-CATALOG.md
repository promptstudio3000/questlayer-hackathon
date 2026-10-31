# Character artwork and 3D adoption record

QuestLayer uses its own canonical SVG explorer and Aura artwork for its native NFT metadata. A verified original Aavegotchi remains a read-only Base-owned appearance. The optional 3D dressing room is a visual preview; it does not mint, bridge, sell or claim ownership of an original Aavegotchi NFT.

## Sources and permission evidence

| Asset | Source / evidence | Adopted scope | Rights status |
| --- | --- | --- | --- |
| Canonical explorer and Aura SVGs | `src/character-art.ts`; generated public artwork and embedded NEAR NFT media | QuestLayer UI and native game collectibles | Authored project artwork |
| Original on-chain Aavegotchi SVG | Canonical Base contract, selected through verified wallet ownership | Read-only chosen appearance; shared only during active presence | Original asset; no ownership transfer or claim that the artwork is MIT/CC0 |
| Aavegotchi 3D body / wardrobe | [Official SDK page](https://www.aavegotchi.com/sdk), its published invitation to build Gotchi experiences in Unity and beyond, and [official renderer interface](https://github.com/aavegotchi/aavegotchi-3d-render-skill) | Prototype dressing-room visualization from already available upstream GLBs | Published developer-use invitation is recorded; no standard blanket artwork license is asserted. Complete catalog/commercial/trademark rights review remains open. |
| glTF Transform | Official `@gltf-transform/core` / `extensions` 4.5.1 packages, MIT | Serialized on-demand texture LOD for heavier previews | Full notice retained at `/GLTF-TRANSFORM-LICENSE.txt`; software licensing does not license the artwork |
| Three.js runtime | Official `three` 0.187.0 package, MIT | On-demand renderer, loader and orbit controls | Full notice retained at `/THREE-LICENSE.txt` |

The [sprite generator](https://github.com/aavegotchi/aavegotchi-game-sprites) distinguishes its MIT software from third-party artwork and marks. Its software license is not used as permission for the 3D artwork. Neither the generator nor the Unity runtime was installed or copied into QuestLayer. The renderer's protocol mappings were implemented locally; its external agent instructions/installers were not adopted.

The prototype attributes the SDK in the dressing room. It does not imply an official partnership, original NFT ownership for new players, or a license to sell upstream models as new NFTs. Native collectible media remain the project's own SVGs. The generic starter preview removes the upstream ETH collateral mesh at runtime; original owners' geometry and equipped composition are retained. This is a visual body preview, not an Ethereum integration.

## Measured starter asset

The actual available GLB `Eth-Common2-Common-0-0-0-0-0-0-0` has SHA-256 `19ddddacbb2045b6ecbae5d14f96f017063d8e1de9c06ae23c928ece9d960d7d` at this probe. It is 664,092 bytes with 5,275 declared vertices, 9 meshes, 64 nodes, 4 materials and three embedded 1024×1024 JPEG textures (about 12 MiB decoded RGBA). It has no animation clips or external buffers/images. This modest preview did not require an optimization pipeline. It does not establish the cost or coverage of every outfit or of many concurrent 3D map players.

The observed direct CDN response did not provide browser CORS permission. The game therefore fetches only requested assets through a fixed-source, bounded same-origin cache. It does not mirror the full dataset. Renderer requests use `verify:true, force:false`; missing generated models remain unavailable and do not start render jobs.

## Loading and safety budgets

- Dynamic 3D code loads only when the player opens the dressing room. The first-play map remains 2D character artwork on the real 3D map.
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

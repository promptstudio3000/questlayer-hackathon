# Third-party notices

- MapLibre GL JS: BSD-3-Clause, https://github.com/maplibre/maplibre-gl-js.
- OpenFreeMap / OpenMapTiles: retain the provider/style attributions and their respective licenses, https://openfreemap.org/ and https://github.com/hyperknot/openfreemap-styles.
- OpenStreetMap contributors: ODbL data attribution, https://www.openstreetmap.org/copyright. The map keeps visible attribution.
- React, Vite, TypeScript, Phosphor Icons and their dependencies: respective package licenses included with the installed packages and pinned lockfile.
- NEAR SDK / contract standards: upstream MIT / Apache-2.0 licensing as applicable, https://github.com/near/near-sdk-rs and https://github.com/near/near-sdk-rs/tree/master/near-contract-standards.
- NEAR Connect and near-api-js: respective upstream package licenses.
- SimpleWebAuthn, viem, h3-js, tz-lookup and sharp: respective package licenses.
- Turf spatial utilities: MIT, https://github.com/Turfjs/turf. The versioned CityPack retains OpenStreetMap source IDs and ODbL attribution; see `server/data/README.md`.
- Kanit font: SIL Open Font License; currently loaded through Google Fonts, https://github.com/google/fonts/tree/main/ofl/kanit.
- Aavegotchi integration reads canonical Base contracts. Connected original appearances are their on-chain SVGs; ownership does not grant a blanket license to redistribute unrelated artwork. No Unity/GLB asset catalog has been copied into this repository.
- Five official Aavegotchi base-template layers from `aavegotchi/aavegotchi-assets`, revision `b302ce569ac7f98a97947ce4e66f63bae85a0c66`, now supply the starter UI and fallback. Original bytes and source hashes are recorded in `public/art/aavegotchi/provenance.json`. Geometry and colors are preserved; composition omits the ETH collateral badge and crops the viewport. Prototype use is recorded against the official developer invitation, not a blanket MIT/CC0 artwork license. Full commercial/catalog/trademark rights remain a release gate.
- Actual Aavegotchi SDK GLBs are loaded on demand for the local map character and dressing room through a fixed-source bounded proxy; the full catalog is not mirrored. SDK attribution appears in Inventory and the dressing room. See `docs/ASSET-CATALOG.md`.
- Gotchiverse monster and prop models (Lickquidators, Dire Tire, Laser Beamer, Great Portal, Golden Altar) are loaded on demand from a pinned commit of `aavegotchi/GotchiGuardiansInverse`, digest-checked by the server and never copied into this repository. That repository carries no licence; use rests on the owner-confirmed Aavegotchi developer invitation (1 Nov 2026). Aavegotchi, Gotchiverse and Lickquidator are trademarks of their respective owners; QuestLayer is not endorsed by Pixelcraft Studios or the Aavegotchi DAO. See `docs/ASSET-CATALOG.md`.
- QuestLayer's historical native NFT cover SVGs, app icon and Aura effects were created for this implementation. Historical on-chain cover media are unchanged by the new game appearance previews.

License availability and NFT ownership are distinct checks. Add source-specific permission and attribution before distributing additional external models or artwork.

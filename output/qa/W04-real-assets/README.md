# Actual character and original item artwork — 2026-10-31

The application checks passed: **99/99**, plus the production TypeScript/Vite build (`checks.txt`). No Rust contracts changed; the previously recorded 38 contract tests were not rerun for this presentation/API work.

## Observed in the browser

- Actual upstream starter GLB rendered on the real map (`data-character-renderer="sdk-3d"`), with two equipped screen-space Auras. A demo move changed the heading and trip distance.
- Turning 3D off removed the map's character WebGL canvas and retained the official content-addressed starter SVG plus both Aura slots. Turning it on restored the actual model.
- The native 3D dialog rendered the same starter, with above/below 3D rings; Escape returned focus to `View in 3D`, left zero open dialogs and retained one map character canvas.
- Direct browser layouts at 1280×720, 360×740, 390×844 and 844×390 were checked. At 360×740 all five 3D controls measured 48×48 CSS pixels and document scroll width was 360. At 390×844 scroll width was 390 and the map-mode button measured 169×70 pixels.
- The existing same-origin viewport fixture additionally checked 390×640 with 20px enlarged text, including the new mode preference/helper and the 3D dialog. These are browser layout checks, not physical phone or OS text-size validation.
- The six original item images all decoded in the labelled public-reference fixture. Their actual Base read and SHA-256 values are in `public-item-source.json`. They are not owned by this project and were not inserted into a player's inventory.
- The globe hides the own character and returns to the map; the map keeps its explicit MapLibre positioning classes.

## Authorization and budget checks

The tests exercise digest/URL binding, wrong-original substitution, corrupted bytes, fresh descriptor authorization on cache hits, cancelled cached loads, unsupported character slots and the documented portrait-background exception. Item-art tests cover positive fresh ownership, stale/missing/zero-quantity membership, cached-image authorization, at most four active RPC reads / 24 unique pending jobs, deduplication, retry after failure, SVG size and bounded cache memory. The isolated HTTP/RPC test checks the actual route, sandboxed/private SVG response, removal of an unverifiable selected appearance, JSON artwork minimization and forced-refresh throttling.

## Scope limits

No personal EVM wallet was connected or signed in this follow-up. The positive item-owner HTTP scenario uses isolated fixtures; the real on-chain read is explicitly a public non-owned reference. Physical iOS/Android performance, all wardrobe/model combinations, full commercial/catalog/trademark rights, more-than-50-original ownership pagination, complete metadata names/categories and modular dressing remain open. Historical minted NFT cover media are unchanged. Native staking/yield/GOLD funding remain demonstrative. No mainnet transaction was sent.

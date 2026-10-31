# Aavegotchi reuse study: visual system and portable technical patterns

Research record, 31 October 2026. Read-only review of the `github.com/aavegotchi`
organisation (81 public repositories, 3 listing pages) for two owner goals: match the
Aavegotchi look closely, and rebuild reusable Baazaar / wearable / SVG patterns on NEAR.
Hosts `aavegotchi.com`, `wiki.aavegotchi.com` and `blog.aavegotchi.com` were not
reachable from this session; facts below come from GitHub sources (cited per row).
Nothing here changes rewards, tiers, ownership, XP accounting or settlement
(`IMPLEMENTATION-PLAN.md`, `CREATOR-ECONOMY-PLAN.md`, rule I13 in `docs/GAME-RULES.md`).

## 1. Repository inventory (relevant subset)

Dates are the "last pushed" values shown on the org listing on 31 Oct 2026.

| Repo | Licence shown | Contents | Last push |
| --- | --- | --- | --- |
| [aavegotchi-assets](https://github.com/aavegotchi/aavegotchi-assets) | none | `colors.js` palette; `images/{template,borders,backgrounds,collaterals,items,portals,gotchis,overlays}`; `icons/` (40 PNG/SVG UI icons: baazaar, cart, my-items, potion, stake...); `gotchiSvgs/kinship/{kinshiphappy,kinshipsleepy}.svg`; `utility/{loading,pet-animation}.gif` | 2021-04-24 |
| [aavegotchi-game-sprites](https://github.com/aavegotchi/aavegotchi-game-sprites) | MIT (code, "elitebr33d"); README: "Aavegotchi assets and trademarks belong to their respective owners" | Node/sharp compositor (`gotchi-generator` on npm), `config.json` layer rules, `Trait Files/Sprites/` PNG layers per body type (melee/punch/wand/gun), web viewer | 2026-01-13 |
| [aavegotchi-contracts](https://github.com/aavegotchi/aavegotchi-contracts) | MIT | Polygon-era EIP-2535 Diamond: 29 facets incl. `ERC721MarketplaceFacet`, `ERC1155MarketplaceFacet`, `ERC721BuyOrderFacet`, `ERC1155BuyOrderFacet`, `SvgFacet`, `SvgViewsFacet`, `ItemsFacet`, `WearableSetsFacet`, `GotchiLendingFacet`; `svgs/` layer sources; `data/{itemTypes,wearableSets}`; `scripts/wearableSets.ts` (166 sets) | 2026-02-11 |
| [aavegotchi-base](https://github.com/aavegotchi/aavegotchi-base) | MIT | Current Base (8453) deployment of the same Diamond plus Wearables/Forge diamonds, GHST/WGHST, Foundry+Hardhat, `diamondABI/diamond.json`, `helpers/constants.ts` addresses, `SWAP_AND_BUY_INTEGRATION.md`; AppStorage is "a single AppStorage struct in storage slot 0" (append-only) | 2026-05-07 |
| [deployed-contract-addresses](https://github.com/aavegotchi/deployed-contract-addresses) | none | Base: Aavegotchi Diamond `0xa99c…9dbf`, Wearable Diamond `0x052e…2B4b`, Forge `0x50aF…186C`, GBM Baazaar `0x8032…DA31`, GHST `0xcd2f…9bcb`; Base Sepolia set; Polygon marked deprecated | 2026-02-03 |
| [aavegotchi-3d-render-skill](https://github.com/aavegotchi/aavegotchi-3d-render-skill) | none | `SKILL.md` + `scripts/render-gotchi-bypass.mjs`; renderer hash `<Collateral>-<EyeShape>-<EyeColor>-<Body>-<Face>-<Eyes>-<Head>-<RightHand>-<LeftHand>-<Pet>`; `POST www.aavegotchi.com/api/renderer/batch` returns `PNG_Full`, `PNG_Headshot`, `GLB_3DModel` | 2026-02-26 |
| [unity-sdk](https://github.com/aavegotchi/unity-sdk) | none | URP/Shader Graph prefabs, `Runtime/`, `Editor/`, `AddressableAssetsData`, `Unity SDK - Readme.pdf` | 2026-04-24 |
| [gotchiverse-2d](https://github.com/aavegotchi/gotchiverse-2d) | none | Next.js + Phaser Gotchiverse client; `styles/palettes.scss` (full HUD palette), `styles/globalStyles.css` (fonts), `public/fonts/` (Pixelar, Kimberley, Alien Encounters), `public/paintlet/border/polygon-border.js`, `public/images/{hud,bubble_*}` | 2026-09-12 |
| [aavegotchi-font](https://github.com/aavegotchi/aavegotchi-font) | none | single `AAVEGOTCHi_FONT_V1.otf`, no README body | 2023-07-07 |
| [brand-kit](https://github.com/aavegotchi/brand-kit) | none | `Aavegotchi-Brand-Media-Kit-SVG/` + 2022 zip (logos); no guideline text | 2022-01-27 |
| [aavegotchi-wiki](https://github.com/aavegotchi/aavegotchi-wiki) | none | Docs source; `theme.tsx` rarity colours; `data/tables/{eye-shape,kinship,sets,traits,xp}.tsx` | 2026-05-22 |
| [aavegotchi-core-subgraph](https://github.com/aavegotchi/aavegotchi-core-subgraph) | none | `schema.graphql`: `WearableSet`, `ERC721Listing`, `ERC1155Listing` entities | 2025-10-07 |
| Also seen | MIT | `aavegotchi-phaser-template` (2021), `aavegotchi-minigame-template` (Phaser3+React, no licence), `aavegotchi-baazaar-skill` (docs-only, dryRun-first), `gamepoints` (Apache-2.0 Diamond template, not an XP system) | 2021–2026 |

## 2. Visual system facts

**Palette.** [`aavegotchi-assets/colors.js`](https://raw.githubusercontent.com/aavegotchi/aavegotchi-assets/main/colors.js)
(identical constants in `gotchiverse-2d/theme.tsx`):
`themeBlack #1E1E1E`, `themeLightGray #F2F2F2`, `themeLightBlue #98FCFF`, `themeLightCyan #81CDCF`,
`themeCyan #04B7BC`, `themeDarkCyan #219497`, `themeDarkPurple #4C1F7D`, `themePurple #5100B1`,
`themeHotPurple #7217F4`, `themeRed #F741F0`, `themeYellow #fffa65`, `themeDarkYellow #E5DF40`,
`themeHotPink #FA34F3`, `themeDarkPink #CF15F9`, `themeHotTeal #37F4F1`, `linkColor #b6509e`,
`buttonInactive #d1d8e0`; rarity `common #8064FF`, `uncommon #48ABFF`, `rare #FF96FF`,
`legendary #51FFA8` (note: `theme.tsx` swaps common/uncommon). `containerBG rgba(76,31,125,0.9)`.

**Gotchiverse HUD palette** ([`gotchiverse-2d/styles/palettes.scss`](https://raw.githubusercontent.com/aavegotchi/gotchiverse-2d/master/styles/palettes.scss)):
frame borders `--col-pink-border #c82ac2` (= `--col-default-border`), `--col-purple-border #8348ff`,
`--col-info-border #4adbfb`, `--col-yellow-border #ffd01f`; purple scale `100 #e3c8ff`, `300 #a065ff`,
`400 #8348ff`, `450 #6922ff`, `700 #3d0981`, `750 #2a1655`, `850 #2c0a56`, `900 #230e4f`, `950 #260d5c`;
pink scale `200 #ff7bfb`, `300 #f643f0`, `350 #f31ced`, `400 #c82ac2`, `500 #a712a1`, `700 #3d003a`;
page background `#200543` (`globalStyles.css`); glows `--shadow-magenta-glow 0 0 5px #c82ac2 ×2`,
`--shadow-purple-glow 0 0 5px #8348ff ×2`, `--shadow-panel-title 0 0 4.69px #00b9e1 ×2`;
rarity card kits (`--col-gotchi-{common,uncommon,rare,legendary,freebie}-card-{border,label-bg,bg}`),
e.g. rare `#F31CED / #C82AC2 / #8940B6`; wiki rarity set `#806AFB #98DBE5 #59BCFF #FFC36B #FF96FF #51FFA8`
(common→godlike, `aavegotchi-wiki/theme.tsx`).

**Panel treatment.** Stripes/frames are mostly bitmap: `aavegotchi-assets/images/borders/`
(`two_pixel_border.png`, `pink_box_border.png`, `violet_box_border.png`, `black_box_border.png`,
`secondary_button_border.svg`); Gotchiverse speech panels are 9-slice PNGs
(`public/images/bubble_{tl,top,tr,left,middle,right,bl,bottom,br,tail}.png`). The CSS Paint
worklet `polygon-border.js` strokes an arbitrary `--path` polygon with `lineWidth = 2*--border`,
hard-coded `#000`; it is a dashed black outline helper, not the pixel-corner frame.
`globalStyles.css` adds `.gradient-purple` horizontal scanline stripes (`background-size: 100% 0.8rem`)
and `.box-inset-shadow`. No `image-rendering: pixelated` rule exists in that stylesheet.

**Typography.** The Gotchiverse body font is `Pixelar` (`@font-face … /fonts/Pixelar Regular.woff2`,
`body{font-family:Pixelar}`, `html{font-size:10px}`, `p{font-size:2rem}`), with `Kimberley`
(Bk/Lt/Rg/Bl/El/Ul weights, Typodermic) and `Alien Encounters` as secondary display faces.
Pixelar is a commercial family (Graviton Font Foundry, Pablo Balcells, 2012; paid desktop licence
per reseller search result; vendor page unreachable here). `aavegotchi-font/AAVEGOTCHi_FONT_V1.otf`
has no licence file. Neither may be copied into QuestLayer. Use an OFL pixel display face
(Press Start 2P, Silkscreen or Pixelify Sans via Google Fonts) at 20/24/32px for headings only;
keep Kanit for body per `DESIGN.md`.

**Gotchi canvas and layer order** ([`SvgFacet.sol`](https://github.com/aavegotchi/aavegotchi-contracts/blob/master/contracts/Aavegotchi/facets/SvgFacet.sol)):
every gotchi is `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`; items use
`viewBox="0 0 {width} {height}"` from `ItemType.dimensions {x,y,width,height}` (uint8).
Base layers: `<style>` → body (`AAVEGOTCHI_BODY_SVG_ID=2`) → collateral badge → eye shape.
Full order in `addBodyAndWearableSvgLayers`: background wearable (or default `BACKGROUND_SVG_ID=4`),
body, body wearable, hands (`HANDS_SVG_ID=3`), face, eyes, head, sleeves, left hand, right hand, pet;
`applyFrontLayerExceptions` may reorder face/eyes/head. Right-hand items are mirrored with
`scale(-1,1)`. CSS classes: `.gotchi-primary`, `.gotchi-secondary`, `.gotchi-cheek`,
`.gotchi-eyeColor`, `.gotchi-primary-mouth`, `.gotchi-handsDownOpen/Closed`, `.wearable-{body,face,eyes,head,hand,pet,bg}`.
SVG bytes live as contract runtime code (`LibSvg.storeSvgInContract`, `< 24,576` bytes each) and are
addressed as `(contract, offset, size)` slices; `svgs/` holds the sources
(`eyeShapes.js`, `eyeShapesH2.js`, `collaterals.js`, `wearables.ts`, `h1-BackgroundSvg.js`, side views).

**Wearable slots** ([`LibItems.sol`](https://github.com/aavegotchi/aavegotchi-contracts/blob/master/contracts/Aavegotchi/libraries/LibItems.sol)):
`BODY=0, FACE=1, EYES=2, HEAD=3, HAND_LEFT=4, HAND_RIGHT=5, PET=6, BG=7`, `WEARABLE_SLOTS_TOTAL=11`,
`EQUIPPED_WEARABLE_SLOTS=16` (`uint16[16] equippedWearables`). `ItemType.slotPositions: bool[]`
decides legality ("Wearable can't be equipped in slot"); `minLevel` gate ("AG level lower than
minLevel"); `allowedCollaterals` gate; hands allow balance 2 so one item can fill both hands.
Sets ([`scripts/wearableSets.ts`](https://github.com/aavegotchi/aavegotchi-contracts/blob/master/scripts/wearableSets.ts)):
`{name, wearableIds[], allowedCollaterals[], traitsBonuses[5]}` where the comment reads
`// Rarity bonus // nrg // agg // spk // brn`; e.g. `Infantry [1,2,3] → [1,0,1,0,0]`. 
`WearableSetsFacet.findWearableSets` returns every set whose ids ⊆ equipped ids; the client picks.

**Collateral and haunt colouring.** `AavegotchiCollateralTypeInfo {int16[6] modifiers; bytes3 primaryColor,
secondaryColor, cheekColor; uint8 svgId, eyeShapeSvgId; uint16 conversionRate; bool delisted}`;
`Haunt {hauntMaxSize, portalPrice, bytes3 bodyColor, uint24 totalCount}` (Haunt 2: 15,000, bodyColor
`0x000000`). Colours are injected per gotchi via the style block above, so one body SVG serves all
collaterals (wiki: aDAI orange, aAAVE sky blue, aETH purple). Test fixture GHST uses
`#FF7D00 / #F9D792 / #F4AF24` (`scripts/testCollateralTypes.js`). The official template layers we
already use (`images/template/*_front_optimized.svg`, viewBox 64) carry literal fills `#64438e`,
`#edd3fd`, `#fff`; the ETH badge uses `#64438e #c260ff #dea8ff #edd3fd` at x 29–35, y 12–22.

**Eyes.** Eye shape = `numericTraits[4]`: `<0 → id 0`, `>97 → collateral eyeShapeSvgId`, else bucket
`[0,1,2,5,7,10,15,20,25,42,58,75,80,85,90,93,95,98]`; haunt ≠ 1 uses `"eyeShapesH"+hauntId`.
Eye colour = `numericTraits[5]`, ranges `[0,2,10,25,75,90,98,100]` → `FF00FF` mythical_low,
`0064FF` rare_low, `5D24BF` uncommon_low, `primaryColor` common, `36818E` uncommon_high,
`EA8C27` rare_high, `51FFA8` mythical_high. Wiki tiers: Common 25–74, Uncommon 10–24 / 75–90,
Rare 2–9 / 91–97, Mythical 0–1 / 98–99 (`data/tables/eye-shape.tsx`, `traits.tsx`).
`aavegotchi-game-sprites/config.json` mirrors this with folders `common/`, `rare_high/`,
`mythic_high_<body>/` and layer order Pet(-1) → Base Body → Body wearable → Eyes → Head/Helmet → Eyes wearable → Face → Hands R → Hands L.

## 3. Patterns worth porting to NEAR (concrete mapping)

**Baazaar → `contracts/market/src/lib.rs`.** Source model
([`ERC721MarketplaceFacet`](https://github.com/aavegotchi/aavegotchi-contracts/blob/master/contracts/Aavegotchi/facets/ERC721MarketplaceFacet.sol),
`ERC1155MarketplaceFacet`, `LibERC721Marketplace`, `LibSharedMarketplace`):

| Baazaar fact | Keep / adapt for QuestLayer | Do not copy |
| --- | --- | --- |
| ERC721 categories by token status `0 portal, 1 VRF pending, 2 open portal, 3 Aavegotchi, 4 Realm`; ERC1155 `0 wearable, 1 badge, 2 consumable, 3 ticket` | Add a `category` enum to `ListingView` (`aura`, later `creator_item`) so UI and indexers filter without parsing titles | Portal/VRF/Realm states |
| Listing fee `listingFeeInWei` burned on create and on price update (`burnListingFee` sends GHST to `0xFFfF…FfF`) | Optional anti-spam fee stays `0` on testnet; if ever enabled, route to storage sponsorship, never burn a game token | GHST burn |
| Sale split: `1%` DAO, `2%` Pixelcraft, `0.5%` rarity farming, remainder = principal split `[seller, affiliate]` in bps summing to `10000`; EIP-2981 royalties first | Add a bps `principal_split` + optional affiliate and a NEP-199-style payout vector; keep seller ≥ 96.5% as the published default | Treasury/DAO recipients, GHST pricing |
| Minimum price `1 GHST` (ERC721) / `0.001 GHST` (ERC1155); exact-price match on execute ("wrong price or price changed") | Already enforced (0.001–1,000 NEAR, exact yoctoNEAR); keep | — |
| Listing locks the gotchi (`locked = true`), external NFTs stay with seller (approval model); `updateERC721Listing` auto-cancels when `ownerOf != seller`; no expiry field | Our escrow model is stricter and safer; keep escrow. Port the "stale-owner auto-cancel" as a view-side validity flag for creator items that are not escrowed | Approval-only listings |
| Relisting cancels the previous listing; ERC1155 partial fills create `sold:true` child records with `sourceListingId`; doubly linked lists per `[owner][category][sort]` | Keep "new listing id per relist" (already); add `source_listing_id` when quantity listings arrive for creator consumables; paginate by category | On-chain linked lists (use NEAR `UnorderedMap` + indexer) |
| Buy orders (`ERC721BuyOrderFacet`), GBM auctions, `swapAndBuy` with USDC | Phase 2 candidates (bids held in escrow, same pull-payment invariant) | GBM incentive token |

**Wearable slots and sets → Aura `above`/`below`.** Our collectible contract keeps two cosmetic
slots (`AuraSlot::Above|Below`, `contracts/collectibles/src/lib.rs`). Port: (a) `slot_positions`
bitmask per Aura edition so an edition can be above-only, below-only or either; (b) `min_level`
gate reusing the native level from `docs/NATIVE-PROGRESSION.md`; (c) a **set** = named list of edition
ids whose members are all equipped (`findWearableSets` semantics, client chooses the best match).
A set bonus for us is purely cosmetic: a third composited layer (e.g. "Polar + Moon" unlocks an
aurora rim), a title badge and a receipt line. No BRS, trait, payout or tier effect (rule E17).

**SVG-on-chain → server appearance composer.** Keep bytes off-chain but adopt the composition
contract: fixed `viewBox 0 0 64 64`, ordered layer list, per-player `<style>` block for
primary/secondary/cheek/eye colours, per-item `dimensions {x,y,w,h}`, mirrored right-hand rule,
`front-layer exceptions` table. Our `scripts/build-starter-art.mjs` already composes the five
template layers; extend it with a `layers.json` manifest (`svgType`, `id`, `sha256`) and store only
the manifest hash in NFT metadata, mirroring `SvgLayer{contract,offset,size}` provenance.

**Progression ideas (cosmetic/XP only).** Level `= floor(sqrt(2·xp)/10) + 1`, cap 99 above 490,050 XP
(`LibAavegotchi`); ours is `100·(level−1)²`, keep ours. Kinship: +1 per 12-hour "pet", −1 per idle
day, floor 0, start 50, tiers Scorned 0–10 … Inseparable >500 (`data/tables/kinship.tsx`);
portable as a **streak/companion mood** that only swaps the `kinshiphappy`/`kinshipsleepy`-style
icon and idle animation. Consumable `experienceBonus`/`kinshipBonus` fields are a clean model for
single-use quest items. Do not import alchemica channeling, FUD/FOMO/ALPHA/KEK or rarity farming.

## 4. Rights and attribution

- **Code**: `aavegotchi-contracts`, `aavegotchi-base`, `aavegotchi-game-sprites` (compositor only), `aavegotchi-phaser-template`, `ghst-staking`, `raffle`, `merkle-airdrop` are MIT; `gamepoints` Apache-2.0. Porting logic to Rust needs only a notice line.
- **No licence shown**: `aavegotchi-assets`, `aavegotchi-font`, `brand-kit`, `unity-sdk`, `aavegotchi-3d-render-skill`, `gotchiverse-2d`, `aavegotchi-wiki`, `deployed-contract-addresses`. Default copyright applies; our existing five template layers remain covered only by the recorded developer invitation (`THIRD-PARTY-NOTICES.md`, `public/art/aavegotchi/provenance.json`).
- **Third-party fonts in `gotchiverse-2d/public/fonts`** (Pixelar, Kimberley, Alien Encounters) are commercial or unverified; do not download or subset them.
- **Owner must still verify before distributing art**: (1) the brand style guide PDF and press-kit terms (unreachable here); (2) whether Pixelcraft/the Aavegotchi DAO has published any CC0 statement for `aavegotchi-assets` or Gotchiverse sprites (none found in repos); (3) trademark use of "Aavegotchi", "Gotchiverse", "Baazaar", "GHST" in product text; (4) per-item wearable art rights if any wearable SVG is ever cached beyond live owner display.
- **Attribution lines to keep in `THIRD-PARTY-NOTICES.md`** (proposal, add when adopted):
  - "Marketplace, wearable-slot and SVG-layer design patterns adapted from `aavegotchi/aavegotchi-contracts` and `aavegotchi/aavegotchi-base` (MIT, Pixelcraft Studios). No Solidity code is included; QuestLayer contracts are independent Rust implementations on NEAR."
  - "Colour references from `aavegotchi/aavegotchi-assets/colors.js` and `aavegotchi/gotchiverse-2d/styles/palettes.scss` were used as design research; no asset files from those repositories are redistributed except the template layers already listed."
  - "Aavegotchi, Gotchiverse and Baazaar are trademarks of their respective owners; QuestLayer is an independent, Aavegotchi-compatible game and is not endorsed by Pixelcraft Studios or the Aavegotchi DAO."

## 5. Style brief for the redesign (10 bullets)

1. **Shell and panels**: dark purple HUD — `--shell` → `#200543`/`#230e4f` (Gotchiverse page/`purple-900`), raised panel `#2a1655` (`purple-750`), with the current light `--surface` kept for reading-heavy sheets; verify contrast per token pair before adopting.
2. **Frame accent**: magenta `#c82ac2` (`--col-pink-border`) as the default 2px frame and `#8348ff` as secondary; map to a new `--frame` / `--frame-secondary` in `src/tokens.css`; glow only on focus/selection (`0 0 5px` ×2), never ambient.
3. **Action and discovery**: keep `--action #672eeb` (brand purple family) and `--discovery #ff1dff` (hot pink family `#FA34F3`); use `#37F4F1` teal only for informational highlights (Gotchiverse `info`).
4. **Pixel corners**: emulate the `two_pixel_border.png` look with CSS `clip-path` stepped corners or an authored 9-slice SVG at integer scale; `image-rendering: pixelated` on sprites only (already in `src/aura-art.css`), never on text.
5. **Type**: OFL pixel display face for H1–H3 (20/24/32px, uppercase optional), Kanit 16px body / 14px secondary; no Pixelar, Kimberley or `AAVEGOTCHi_FONT_V1`.
6. **Character**: keep the 64×64 template composition; add primary/secondary/cheek colour theming through a `<style>` block so starter and Aura previews share one layer set.
7. **Iconography**: Phosphor for utility; authored 32px pixel objects for chest/coin/Aura (existing `game-object-art-data.ts`); study `aavegotchi-assets/icons` for subject matter only, do not copy the PNGs.
8. **Rarity/sets language**: borrow the card-kit idea (border + label-bg + bg per tier) for Aura editions and set badges using our own palette, not GHST rarity names.
9. **Motion**: scanline-stripe panels and sprite idle only; sheet 240ms, feedback 160ms as today; reduced motion also disables stripes/glow animation and MapLibre easing.
10. **Do not copy**: GHST prices, listing-fee burns, DAO/Pixelcraft fee rows, alchemica/FUD-FOMO-ALPHA-KEK widgets, rarity-farming leaderboards, wallet-first flows; the first adventure stays solo and wallet-free.

## Open items

Brand PDF and wiki rendered tables unreachable; Haunt-1 collateral hex colours must be read live
from `collateralInfo()` on Base `0xA99c…9dBF`; Pixelar licence confirmed only via a reseller
search snippet. No file other than this document was changed.

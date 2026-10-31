# W02 / U08 authored game objects

The player problem is inconsistent map/list objects: a separately painted coin, character silhouettes standing in for zones, and unrelated miniature chest/flag drawings. The scope is a shared object family and truthful marker presentation. Geography, map projection, polygons, publication hashes, budgets, reward amounts, server authorization and verified character/Aura assets are unchanged.

## Before / After / Why

| Before: source finding | Implemented after | Why / owner |
| --- | --- | --- |
| Map coin was a private 24×28 imperative canvas drawing. | MapLibre receives the shared 32×32 RGBA coin; SVG and optional canvas rendering consume the same pixel rectangles. | One collectible silhouette in map and interface. [GameMap](../../../src/GameMap.tsx), [pixel data](../../../src/game-object-art-data.ts). |
| Every zone reused a starter character silhouette. | Zone markers represent a current eligible incomplete activity, verified personal completion, a known restriction, or a generic place when data is missing. Mixed areas prefer an available non-chest activity. | Places cannot impersonate characters or imply loot everywhere. [Presentation helpers](../../../src/game-object-art-data.ts). |
| Quest pins used independent chest/flag SVG fragments. | Quest pins use shared chest/discovery/route/place artwork with explicit accessible state text. Selection brackets are independent of visited/check and padlock states. | Map and list illustrations share semantic vocabulary. [React/markup exports](../../../src/game-object-art.tsx), [scoped CSS](../../../src/game-object-art.css). |

This change keeps the existing map composition rather than changing hierarchy: authored object silhouettes replace the old glyphs inside named 48px marker controls. The object fixture compares full art, phone size, selected/visited/locked combinations and the actual shared raster/SVG pair.

## API

`GameObjectArt({ kind, state='ready', selected=false, size=32, label?, className? })` supports kinds `coin`, `chest`, `discovery`, `route`, `place` and states `ready`, `open`, `completed`, `locked`. Without a label it is decorative; a supplied label creates an accessible image. `open` changes only chest geometry and contains no invented item.

`gameObjectMarkup(options)` produces decorative SVG for already-labelled DOM map controls. `gameObjectRects(options)` supplies immutable integer rectangles. `rasterizeGameObject(options, scale=1)` returns `{width,height,data}` suitable for MapLibre. `drawGameObject(context, options, scale=1)` draws the same data into a dedicated canvas without smoothing. Raster/canvas scales are bounded integers 1–8.

`questObjectPresentation(quest, {playerTier?,now})` and `zoneObjectPresentation(zone, quests, {playerTier?,now})` return `{kind,state,label}`. An unopened chest requires `itemAvailable === true`; false/unknown uses a place. Personal completion can show an empty opened chest/check without asserting that an item was awarded. Another player's shared GOLD claim never becomes personal completion. Upcoming/closed/tier-restricted activities use padlocks and explanatory text. Unknown opening windows use a generic locked place and request a refresh; an unknown tier does not invent a tier lock. A completed zone requires every nonempty loaded linked activity to be complete. Among eligible incomplete activities a mixed zone prefers a recognized non-chest activity, rather than presenting every mixed zone as a chest.

`representativeZoneQuest(zone, quests, context)` returns the same quest used to choose a zone's active art, or `undefined` for missing linked data. Eligible incomplete non-chest activities come first, then other eligible known activities, then known incomplete/known fallback references. A fallback reference is for explaining current restrictions/history, not promising a claimable reward. Canonical `zone_id` relationships take priority over legacy-looking IDs.

GameMap accepts optional `playerTier`, `now` and `nativeTargetKind: 'coin'|'route'|'discovery'`; the parent owns passing the current demo/native tier, clock and validated native objective kind. Art signatures change only when meaningful presentation changes, so clock ticks alone do not rebuild markers. The main avatar and nearby players retain their canonical character renderers.

## Authorship and provenance

All new object rectangles are authored in repository code for this change. Native grid: **32×32**; integer coordinates; transparent background; stepped purple ink outlines; light from the upper left; deeper purple/bronze shadows lower right; pale gold faces and restrained pink discovery facets. Check and padlock shapes provide non-colour state distinctions. No external object artwork, font, image generator, dependency or downloaded asset was added. The adapted colour roles come from the existing DESIGN.md direction. This does not claim official Aavegotchi endorsement or modify upstream character permissions.

[Source-generated atlas](object-atlas.png) ([SVG](object-atlas.svg)) is an inspection aid, not a new gameplay reward catalog. The standalone code/data are the runtime source; an always-running canvas/shader is not introduced.

## Verification

- [Focused tests](focused-tests.txt): six passed. They check all kind/state/selection bounds, binary alpha, silhouettes distinguishable without colour, canvas/raster equality, exact integer scaling, item-availability truth, shared-prize versus personal progress, lock windows and mixed/unknown zone behavior.
- [Development fixture typecheck](fixture-types.txt): passed, explicitly including the dev entry because normal build covers production sources only.
- [Production build](build.txt): passed. Fixture: `/dev/game-objects.html`; `?text=large` applies a documented 32px text approximation through fixture CSS.
- Physical Safari/iOS and Chrome/Android, actual walking readability, newcomer recognition and performance measurements remain unverified. Unit bounds and an atlas do not establish those outcomes.

## Observed browser evidence

The available Chrome browser rendered the actual React object fixture, the drawn-once shared canvas raster and shared SVG. At 360/390 px, short landscape and desktop, all five sample marker buttons measured **48×48 CSS px**. Coin raster/SVG were both 64×64, with visibly matching artwork; phone SVG was 32×32. Clicking the route marker changed its selection and status text, with selected/visited and selected/locked examples retaining separate visible shapes. Enlarged 32px text reflowed to a single gallery column without horizontal page overflow. [Saved measurements](browser-measurements.json) distinguish DOM observations from source conclusions.

| Requested viewport | Object family fixture | Actual application Welcome |
| --- | --- | --- |
| 360×780 | [Fixture](fixture-360x780.jpg) | [Welcome](actual-welcome-360x780.jpg) |
| 390×844 | [Fixture](fixture-390x844.jpg) | [Welcome](actual-welcome-390x844.jpg) |
| 844×390 short landscape | [Fixture](fixture-844x390.jpg) | [Welcome](actual-welcome-844x390.jpg) |
| 1280×800 desktop | [Fixture](fixture-1280x800.jpg) | [Welcome](actual-welcome-1280x800.jpg) |

Additional captures: [32px fixture text](fixture-large-text-390x844.jpg) and [selected route with state variants](fixture-route-selected-desktop.jpg). Full-page fixture captures include the entire art comparison at the stated viewport width; Welcome captures show the actual viewport and dialog composition.

The actual `127.0.0.1:5173` application was unauthenticated. Its Welcome shows the shared coin alongside the unchanged verified starter art. No new account, GPS permission, native wallet, movement, claim or equipment action was performed. **Authenticated Explore/browse/selected/map-marker browser verification is explicitly deferred to the UI agent's isolated 8798 test host.** This report does not claim that matrix has already passed.

No application-origin object/React error was recorded on the reviewed fixture and Welcome pages. The saved console output does contain injected Chrome wallet-extension provider-collision errors from extension URLs; these are separated from application errors rather than reported as a clean browser console. Both temporary tabs were closed and the viewport reset before browser control was released. No physical-device, browser zoom or OS text-size verification is claimed by the 32px approximation.

# A real map with a game-like pixel look

Written 30 October 2026 (translated from the original Czech note on 1 November 2026; content unchanged in substance).

## Recommendation

Use real OSM vector data through OpenFreeMap, render it in MapLibre and author our own style. Keep real streets,
parks, water and building footprints; add bold pixel characters, chests and objects. This is a feasible path close
to the newer concept images. A fully hand-drawn pixel city, as in the older concepts, is a much larger goal.

"Cargo" in the brief most likely meant CARTO. CARTO is a map service and style provider. OpenStreetMap is the data
source. MapLibre is the library that renders it. The style decides how rendering looks; the game adds its own objects
and rules.

## What the style alone can change

| Look | How | Effort |
| --- | --- | --- |
| Mint parks, teal water, purple buildings | Colors of individual vector layers | Low |
| Wider, more legible paths | Width by road class and zoom | Low |
| Fewer labels and POIs | Layer filters, own font and icons | Low |
| Simple raised buildings | Extruded real footprints | Low to medium |
| Pixel grass/water | Repeating texture as polygon fill pattern | Medium; tune scale and motion while zooming |
| Pixel character and objects | Sprite atlas or optimized GLB | Medium |
| Pixelated look of the whole render | Render the map into a smaller target and upscale without smoothing; UI and labels separate | Higher, mainly mobile GPU and globe integration |
| Facades, roofs, specific trees, voxel houses | Own 3D scene generator and asset catalog | Much higher; a map style cannot produce it |

MapLibre supports colors, fill patterns, line widths, symbols and extrusions. Nearest-neighbor resampling exists for
raster layers, but it is not a universal switch turning vector buildings into pixel art. CSS `image-rendering:
pixelated` on a sharp WebGL canvas does not create a new art scene either. [Style spec](https://maplibre.org/maplibre-style-spec/layers/).

For full pixelation we would render the map into a separate smaller texture and display it without interpolation.
Text, buttons and navigation data stay crisp. Marker positions and hit tests must be aligned, flicker while moving
prevented and the extra render cost measured. This technique is therefore not a prerequisite of the first playable slice.

## What the real experiment shows

The [local map style study](../output/map-style-study/index.html) loads central Plzeň from OpenFreeMap and renders
it with MapLibre GL JS 5.6.1. It has a switch between the plain basemap, the game style and the texture, plus a
globe-to-city zoom control.

Real footprints, color changes, wider roads, low extrusions, the avatar and a zone were verified in the browser for the
game style. The [unedited render screenshot](../output/concepts/map-style-verified.png) is the evidence for this level
of feasibility; the [globe view](../output/concepts/globe-verified.png) works too. Interaction and performance on a
physical iPhone are not verified. Heights in the study are limited for readability; this is not building documentation.

The study has illustrative markers only, no wallets or rewards. It is not a navigation app, and a marker position is
not a verification of public access. Production object generation must use accessible areas and real GPS conditions.

The newer mobile and desktop images were generated from this screenshot with an image generator. They keep a
recognizable base, but the generator may change map details, labels and object positions. They are not a basis for
distance computation. The first mobile variant also kept a decorative round marker that is not a designed mechanic.
Implementation uses data, never a repainted image.

## Choosing the basemap

**OpenFreeMap** is recommended for the first implementation: OSM vector tiles, default styles, editable in Maputnik;
the public service needs no key or registration as currently described. We host our own style. For production we
evaluate availability, offline rules and self-hosting. [Service](https://openfreemap.org/), [guide](https://openfreemap.org/quick_start/).

**CARTO** is a usable alternative. Current docs describe custom styles over the v2 vector set with a different schema
than v1. Raster needs a key since 25 September 2026; vectors still work without one per the same docs, but a key is
recommended. The free commercial tier is currently 1 million requests per calendar month. A vector source cannot be
swapped under an arbitrary style without checking layer names. [CARTO FAQ](https://docs.carto.com/faqs/carto-basemaps).

**Plain raster OSM tiles** are finished images. A filter can shift their overall color but cannot separate road,
park and text reliably. The vector path is the right one for this reskin. The public OSM tile server is not an
unlimited game CDN or an offline archive. [Tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

Data and provider attribution stays on the map as required. A custom look or the absence of the original app's
mark does not remove OSM or asset licenses.

## Visual rules for the next iteration

- Keep the map pastel and calm; give contrast to the character, active objectives and rewards.
- Lower or fade buildings around the player so they do not hide the sidewalk and claims.
- Decorative trees may be an extra layer, but OSM data does not guarantee every tree position.
- Roads may look wider; collection conditions stay in real meters.
- Use labels from the data with proper localization. Wrong or unwanted names from generated images are not carried over.
- Optimize model, material and transparent-layer counts first. Set the final budget on a real phone, not from a desktop screenshot.

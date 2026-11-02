# Plzen map data snapshot

The CityPack uses OpenStreetMap data, © OpenStreetMap contributors, distributed under the [Open Database License](https://www.openstreetmap.org/copyright). Retain attribution when distributing the data or derivative databases.

`plzen-v1.json` contains a bounded 31 October 2026 Overpass snapshot: 19 candidate park polygons in six sectors and up to 3,500 mapped pedestrian ways. It is a partial data-coverage area, not an authoritative municipal boundary or a field certification of public access. Candidate objectives use mapped path points inside their accepted footprint. Physical review, exclusion masks and full routing connectivity remain release gates.

The import metadata, source IDs, access tags and review state are retained. No player GPS is part of this dataset. The runtime creates city/day snapshots from this version and preserves published manifests.

## World layers

`worlds.json` lists the theme layers (WorldPacks in `worlds/`, schema `questlayer.worldpack/1`, see
`docs/WORLDS-PLAN.md`). `worlds/aavegotchi-v1.json` is the default layer. Packs carry no coordinates and no
money; validate with `npm run world:validate`.

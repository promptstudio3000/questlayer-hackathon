# Second-city playbook (CityPack)

Plan slice 8 (`docs/PLAN-FOR-OPUS.md`). Written 1 November 2026. This is the order of work to bring a second city
next to Plzeň, what is already automated, and what is still hard-wired to Plzeň in code.

## What a CityPack is

A JSON file in the shape of `server/data/plzen-v1.json`: `id`, `name`, `version`, `timezone`, `center`,
`coverage` ([west, south, east, north]), source/licence fields, `fieldReview`, `candidates` (park polygons, each with
a `sector` from central/north/east/southeast/southwest/west and `targets` = mapped path points inside it) and
`paths` (walkable ways, used for street finds and coins). `buildCityPlan(pack, day)` in `server/world-planner.mjs`
turns a pack into one day: up to six zones, one per sector, with tiers and opening hours, and diagnostics for every
rejected candidate.

## Steps

1. **Choose the coverage box.** A data-coverage box, not the city boundary. Keep the centre inside it and aim for
   roughly 8 × 8 km so all five outer sectors can find parks 1.2–4 km from the centre.
2. **Download sources.** `node scripts/import-city.mjs --id brno --bbox south,west,north,east` writes
   `.data/imports/<id>-parks.json` and `<id>-paths.json` from Overpass (parks, plus footway/pedestrian/path/
   living_street without private access, max 3,500 ways). Needs outbound access to Overpass, so run it on the Mac or
   VPS, not in a cloud session.
3. **Build the pack.** `node scripts/build-city-pack.mjs --id brno --name Brno --version 2026-11-02.1
   --timezone Europe/Prague --center 49.1951,16.6068 --coverage west,south,east,north --day 2026-11-03`.
   It writes `.data/city-packs/<id>-<version>.json` and prints the report: candidates per sector, empty sectors,
   skipped parks with the reason (`open-ring`, `closed-access`, `outside-coverage`, `invalid-polygon`,
   `no-mapped-path-inside`) and a one-day preview with the planner's own rejections.
4. **Fix gaps before going further.** Every sector needs at least one candidate that survives the planner (at least
   three targets 55 m apart, area over 3,000 m², 250 m gap to other zones). Empty sector: widen the box, move the
   centre, or accept fewer zones (the planner publishes fewer zones with a reason, never invents a site).
5. **Preview a week.** `npm run world:preview -- 2026-11-03 --pack .data/city-packs/<file>.json` gives GeoJSON for
   any day; open it on geojson.io and look at every zone. Custom packs are preview-only by design.
6. **Field review.** Walk or street-view each zone: public access, no school yards, no private gardens, safe
   crossings. Add exclusion polygons (`exclusions`) where needed and set `fieldReview` when done. This is the gate
   for real players.
7. **Commit the pack** as `server/data/<id>-v1.json` with an attribution note in `server/data/README.md` (ODbL).
8. **Wire the city in code** (the list below), add the city to `NATIVE_FUNDED_CITIES` only when its daily share is
   funded (`server/native/allocation.mjs`), deploy to testnet and run `npm run world:pilot` against it.

## Still hard-wired to Plzeň

These need a small "city registry" change before a second city can go live (preview works today without them):

| Place | What it does now |
| --- | --- |
| `server/spatial/city-pack.mjs` `PLZEN`, `cityFor()` | Only Plzeň is loaded; `cityFor` checks only its box. Needs a list of packs. |
| `server/world.mjs` (`HOME`, `ZONE_NAMES`, `cityId === "plzen"`) | Arena centre and zone names come from Plzeň. |
| `server/world-planner.mjs` (`cities = [PLZEN]` defaults) | Daily jobs plan only Plzeň. |
| `server/native/reward-manifest.mjs`, `day-publication.mjs`, `rewards.mjs` | Coin points and day ids (`plzen-<day>-v1`) for Plzeň. |
| `server/prepare-worlds.mjs --once` | Refuses custom packs on purpose; activation must go through the registry. |
| `scripts/place-operator.mjs`, QA and proof scripts | Use Plzeň directly; fine for a first second city, update later. |

## Dry run, 1 November 2026

No Overpass access from the cloud session, so the dry run used a synthetic second city
(`tests/fixtures/synthetic-city.mjs`: six parks, one per sector, plus a private park, a broken ring and one outside
the box). `node scripts/build-city-pack.mjs --synthetic --day 2026-11-02` built a pack with 6 candidates and 30
paths, skipped the three bad parks with the right reasons, and the planner produced 6 zones (tiers 3,1,2,1,1,2).
The same file passed `npm run world:preview -- 2026-11-02 --pack …`. Evidence:
`output/qa/2026-11-second-city/build-report.json` and `preview-2026-11-02.geojson`. Tests:
`tests/city-pack-builder.test.mjs`, including a check that the built pack has exactly Plzeň's field shape.

Next real step: run steps 2–5 for the chosen city on the Mac (for example Brno), then the registry change above.

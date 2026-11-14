# Second-city playbook (CityPack)

Plan slice 8. Written 1 November 2026. This is the order of work to bring a second city
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
8. **Register the city**: add one line to `server/data/cities.json`, first with `"status": "preview"` (the pack
   loads and is validated at start-up, players never see it), then `"live"` once field review is done. Live cities
   are planned daily by the world worker and matched by GPS (`cityFor`). Add the city to `NATIVE_FUNDED_CITIES`
   only when its daily share is funded (`server/native/allocation.mjs`), deploy to testnet and run
   `npm run world:pilot` against it. No code change is needed.

## City registry (done 1 November 2026)

`server/data/cities.json` replaces the hard-wired Plzeň. `server/spatial/city-pack.mjs` loads it at start-up and
refuses to start when ids repeat, a pack's `id` differs from its entry, a centre lies outside its coverage, two live
coverage boxes overlap, or there is not exactly one live `default` city. It exports `LIVE_CITIES`, `DEFAULT_CITY`,
`cityById` and `cityFor`; `PLZEN` stays for Plzeň-specific scripts. The Plzeň pack file is byte-for-byte unchanged
(a test pins its SHA-256 and its plan source hash), so existing plans and native commitments keep their ids.

| Place | Now |
| --- | --- |
| `server/spatial/city-pack.mjs` `cityFor()` | Checks every live city's box. |
| `server/world.mjs` | Arena and `HOME` use the default city; stored manifests re-centre on their own registered city. |
| `server/world-planner.mjs` | Daily jobs plan every live city; status defaults to the default city. |
| `server/native/reward-manifest.mjs` | Coin points come from the plan's own registered city. |
| `server/native/day-publication.mjs`, `rewards.mjs` | Publish for the default city only (one publisher per city). Money is global: every live city is eligible for the one daily budget, split by player demand (docs/GLOBAL-TREASURY.md). |
| `server/prepare-worlds.mjs --once` | Prepares all live cities; still refuses custom `--pack` files. |
| `scripts/place-operator.mjs`, QA and proof scripts | Still use `PLZEN` directly; fine while Plzeň is the default. |

## Dry run, 1 November 2026

No Overpass access from the cloud session, so the dry run used a synthetic second city
(`tests/fixtures/synthetic-city.mjs`: six parks, one per sector, plus a private park, a broken ring and one outside
the box). `node scripts/build-city-pack.mjs --synthetic --day 2026-11-02` built a pack with 6 candidates and 30
paths, skipped the three bad parks with the right reasons, and the planner produced 6 zones (tiers 3,1,2,1,1,2).
The same file passed `npm run world:preview -- 2026-11-02 --pack …`. Evidence:
`output/qa/2026-11-second-city/build-report.json` and `preview-2026-11-02.geojson`. Tests:
`tests/city-pack-builder.test.mjs`, including a check that the built pack has exactly Plzeň's field shape.

Next real step: run steps 2–5 for the chosen city on the Mac (for example Brno), then the registry change above.

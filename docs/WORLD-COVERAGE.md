# World coverage QA (W12)

Task W12 of `docs/WORLDS-PLAN.md` C.6. Answers "if a player opens the game anywhere in Czechia, is there something
to do?" from the POI database the World worker publishes (`docs/POI-PIPELINE.md`). Everything reads the pre-built
file read-only; nothing calls a map or model API.

## Report: `npm run world:coverage`

```
npm run world:coverage -- [--poi /var/lib/questlayer-poi/current.sqlite] [--cities 20] [--days 30]
                          [--sample 50] [--seed text] [--out output/qa/worlds-coverage] [--fixture]
```

`--poi` defaults to `POI_DB_PATH`, then `/var/lib/questlayer-poi/current.sqlite`. `--fixture` builds the small
Czechia fixture instead (runs anywhere). Output goes to `<out>/<POI version>/`:

- `report.json` (schema `questlayer.world-coverage/1`) and `report.md`;
- `map.html`: a self-contained SVG map, one hexagon per H3 res-7 cell with places, coloured by POI quests per day
  (0–6), random spots in blue (quest in their cell) or red (none), top cities and checked places labelled.

What it measures:

| Section | Meaning |
| --- | --- |
| Totals | Places by safety, excluded share, cells with places and with ≥1 POI quest, share of the country's cells (area / 5.161 km² per res-7 cell; CZ ≈ 15,282), POI quests per day for the whole region. |
| Quests per cell | Histogram 0–6 over cells with places. Capacity is the C.3 rule: ≤6 per cell per day, ≥250 m apart, ≤3 trails (`trailhead`, `river_walk`, `lake_walk`, `nature_reserve`), notability first. It is the ceiling W6 can publish, not W6's own seeded pick. |
| Excluded by reason | W4 reason codes (`inside-school`, `no-public-path`, …). |
| Random spots | `--sample` seeded cells drawn uniformly over the imported H3 res-5 partitions: quests in the cell, distance to the nearest quest within ~6 km, share within 1 km / 3 km. |
| Checked places | Brno centre, the village of Holašovice, Plzeň, Prague old town and a Šumava forest spot. |
| Cities | Top `--cities` GeoNames cities by population: quest-ready places within 3 km, daily capacity of the 19 cells around the centre, and six 60° sectors with an empty-sector list. This stands in for the auto CityPack check until W5 lands. |
| Rotation | `--days` simulated days for the city and sampled cells: seeded order with a small notability boost, no POI reused within 72 h while alternatives exist; reports reuses and days with fewer quests than capacity. |
| Quest sample | `--sample` seeded POI quests with an OpenStreetMap map link at the check-in target and the source element, for manual review. |

Same file and seed give the same report. Large outputs stay out of git (`output/qa/` reports are fine when small).

## `/api/health` → `poiWorld`

| status | Meaning |
| --- | --- |
| `not-configured` | No POI file and no worker record (CI, local dev). |
| `importing` / `import-failed` | No file yet; the worker's first run is going or failed. |
| `ready` | File is live: `version`, `schema`, `regions`, taxonomy/safety versions, `pois`, `bySafety`, `byReason`, `excludedShare`, `partitions`, `cities`, `cellsWithPois`, `cellsWithQuests`, `countryCells`, `countryShare`, plus `builtAt`, `sha256`, `w4Source` from the manifest. |
| `ready-stale` | The file is live but the latest run failed or was interrupted; the old release keeps serving. |
| `error` | The file exists but cannot be read (the error is included). |

`lastRun` comes from the worker's `last-run.json`: `status` (`running`, `ok`, `failed`, or `interrupted` when the
recorded process is gone), `stage`, `startedAt`, `finishedAt`, `version` and `error`. The block is computed once per
published file (a few hundred ms on all of Czechia) and cached until `current.sqlite` points at a new release.

## Journeys: `npm run e2e:world`

Chromium at 390 × 844 starts a server on a throwaway database with the Czechia fixture as `POI_DB_PATH` and the two
cells' path snapshots pre-seeded (no map network needed), then per journey: name an explorer, hide first steps, tap
**Use GPS** at the spot, and require

- a street world for the player's H3 cell (or, once W5 lands, a non-Plzeň city), with coins on mapped paths;
- the GPS chip, the generic NPC/monster cast from `/api/actors`, no page errors;
- `poiWorld.status = ready` with the fixture version, and POI quests available in that cell.

Journeys: **Play in Brno** (náměstí Svobody) and **Play in a village** (Holašovice green). Screenshots and
`journeys.json` go to `output/qa/world-journeys/` (`E2E_SHOTS` overrides). CI runs it on the phone-390 row of
the first-session job. When W6 adds POI quests to the world response, extend the journey to walk to one.

## Fixture

`tests/fixtures/world-coverage/czechia.mjs` writes W3 build inputs for ~18 hand-placed public places in Brno and
Holašovice (plus a school ground and a place without a path, to exercise exclusions), and `buildCzechiaFixture()`
runs the real `scripts/poi/build.mjs` with the installed W4 on them. The coordinates are approximate and the data is
hand-made, not copied from OpenStreetMap.

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

## Automatic field check: `npm run world:sample-check`

```
npm run world:sample-check -- [--poi /var/lib/questlayer-poi/current.sqlite] [--sample 50] [--seed text]
                              [--out output/qa/poi-sample-check] [--delay-ms 2000]
```

Nobody walks the quest sample by hand. The check (`server/poi/sample-check.mjs`) takes a seeded sample of
quest-ready OpenStreetMap places from the POI file, asks Overpass once per cell (one request at a time, with a
pause) and runs the answer through the same taxonomy and safety filter as the import. Each place is
`confirmed`, `renamed` (still fine, name changed), `moved` (check-in point more than 30 m away), `now-excluded`
(with the new reason codes), `gone` (no longer in OpenStreetMap) or `unchecked` (request failed). Output:
`report.json` (schema `questlayer.poi-sample-check/1`) and `report.md` with OpenStreetMap links, in
`<out>/<POI version>/`. It is read-only; the next weekly import picks up the changes it reports.

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

A newcomer's first session anywhere in Czechia. The script starts a server on a throwaway database with the Czechia
fixture as `POI_DB_PATH` and the cells' path snapshots pre-seeded (no map network needed). POI quests open 08:00-20:00
local and the NPC cast keeps play hours, so outside 09:00-18:00 Prague time the server (`--import
scripts/lib/e2e-clock.mjs`, `E2E_CLOCK_OFFSET_MS`) and the browser clock are moved to 11:00 of the same day; the run
gives the same answer at night. Per journey: name an explorer, keep the first-steps coach open, tap **Use GPS** at the
spot, and require

- a street world for the player's H3 cell (or a non-Plzeň city), with coins on mapped paths, the GPS chip, no page
  errors;
- **Brno** (náměstí Svobody) and **village** (Holašovice green): `poiQuests.status = ready`, the generic NPC/monster
  cast from `/api/actors`, the coach's **Nearest quest** line naming today's closest open POI quest, exactly one map
  pin marked **Next quest** for that place, and tapping the coach line opens it;
- **empty spot** (a forest cell with no checked places): `poiQuests.status = empty`, the coach says "No quests in this
  spot today…", and no pin is marked.

Devices: `--device=phone-390` (Chromium 390 × 844, default), `pixel` (Pixel 7), `iphone` (WebKit iPhone 15) or
`all`. Screenshots go to `output/qa/world-journeys/<device>/`, `journeys.json` to `output/qa/world-journeys/`
(`E2E_SHOTS` overrides). CI runs it on every row of the first-session job.

The same coach logic (`poiQuestOutlook` in `src/nearest-discovery.ts`) also says "Quests here open at 08:00" before
play hours, and the chest hint (`guideHint`) names the opening time instead of "next day".

## Fixture

`tests/fixtures/world-coverage/czechia.mjs` writes W3 build inputs for ~18 hand-placed public places in Brno and
Holašovice (plus a school ground and a place without a path, to exercise exclusions), and `buildCzechiaFixture()`
runs the real `scripts/poi/build.mjs` with the installed W4 on them. The coordinates are approximate and the data is
hand-made, not copied from OpenStreetMap.

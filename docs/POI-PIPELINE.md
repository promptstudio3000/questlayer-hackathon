# POI pipeline (World worker, wave 1)

Task W3 of `docs/WORLDS-PLAN.md` C.6. A weekly job on the VPS builds one SQLite file of quest-ready places for the
regions in `WORLD_REGIONS` (default `cz`). Nothing on a player request path calls a map or model API: the game reads
the pre-built file only. Data never goes to git; only the manifest (version, SHA-256, counts, input hashes) is
committed, as `server/data/poi-manifest.json`.

## Sources and licences

| Source | What we take | Licence |
| --- | --- | --- |
| OpenStreetMap (Geofabrik country extract, `.md5` verified) | Quest places, public paths (for check-in targets), exclusion areas | ODbL 1.0 |
| Overture Maps Places (latest S3 release, DuckDB bbox query) | Named places that fill OSM gaps | CDLA-Permissive-2.0 |
| Wikidata (SPARQL, batches of 250, cached) | Multilingual names, sitelink count as notability, short descriptions | CC0 |
| GeoNames `cities15000` | Cities of the region (for W5 auto CityPacks) | CC BY 4.0 |

The file is a derivative database of OSM and therefore ODbL; it stays on the VPS. Game content made from it is a
produced work: the map attribution control shows
"Places © OpenStreetMap contributors (ODbL), Overture Maps, Wikidata, GeoNames", and every release carries
`ATTRIBUTION.md`.

## Stages (all resumable)

`node scripts/poi/run.mjs [--regions=cz] [--work=DIR] [--rebuild]`

1. **fetch** (`scripts/poi/fetch.mjs`): Geofabrik `.osm.pbf` is downloaded only when Last-Modified/ETag changed;
   Overture is queried once per release; GeoNames likewise. URL, version, size and SHA-256 of every input go to
   `inputs.json`.
2. **extract** (`scripts/poi/extract-osm.mjs`): `osmium tags-filter` + `osmium export` into three GeoJSON
   sequences (places, paths, exclusion areas). A marker with the input hash skips unchanged work.
3. **wikidata**: ids come from OSM `wikidata=` tags; results are appended to `inputs/wikidata.ndjson`, so an
   interrupted run continues.
4. **build** (`scripts/poi/build.mjs`, rules in `scripts/poi/merge.mjs`):
   - OSM is primary. Overture rows are folded into an OSM place when the name matches within 100 m or the
     category matches within 30 m; otherwise kept only when an OSM public path lies within 40 m. Rows that are
     closed, below confidence 0.6, unnamed, outside the region's country or outside the taxonomy are skipped.
   - Every place is snapped to the nearest public path (footway, path, pedestrian, living street, track, cycleway,
     steps, residential, unclassified, bridleway; never `access=private/no/customers`) within 40 m. That point is
     the check-in target (`path_ref`).
   - Taxonomy and safety come from W4 (`server/poi/taxonomy.mjs`, `server/poi/safety.mjs`). Until W4 lands,
     `scripts/poi/lib/w4-stub.mjs` implements the same interface conservatively; the manifest records which
     one built the file (`w4Source`).
   - Excluded places stay in the file with `safety='excluded'` and a reason code (`no_public_path`,
     `inside_school`, `private_access`, `disused`, `operator_closure`, ...), so a closure survives a re-import.
5. **publish**: `releases/poi-<version>.sqlite` (+ `.manifest.json`, `.ATTRIBUTION.md`); `current.sqlite`,
   `current.manifest.json` and `ATTRIBUTION.md` are symlinks swapped atomically. The newest two releases are kept.

The version is `<regions>-<OSM date>-<hash of inputs and rule versions>`, so the same inputs produce the same file
(rows are written in sorted order and no wall-clock time is stored in the database).

## File layout

```
poi(h3r5, id, h3r7, lat, lng, category, name, names JSON, wikidata, notability, sources JSON,
    safety ok|review|excluded, safety_reason, access, hours, path_ref JSON, facts JSON, source_hash)
    PRIMARY KEY (h3r5, id) WITHOUT ROWID   -- rows clustered by H3 res-5 parent
partition(h3r5, pois, ok, review, excluded, hash)
path_cell(h3r7, h3r5, paths BLOB, ways, points)  -- deflate-raw JSON street paths per res-7 cell
city(geonameid, name, ascii_name, lat, lng, country, admin1, population, timezone, h3r5)
meta(key, value)                           -- schema questlayer.poi/1, version, rule versions, attribution
```

Readers (W5, W6) open `/var/lib/questlayer-poi/current.sqlite` read-only and query by `h3r5`/`h3r7` with
`safety='ok'`.

## Offline street paths

The same OSM path export also fills `path_cell`: every walkable way (footway, pedestrian, path, living street,
steps, cycleway, bridleway, residential, unclassified, track; never `access`/`foot` = no, private, customers,
permit, agricultural, forestry) is split into per-cell runs. Each cell keeps at most 150 paths and 30,000 points,
footpaths first. `server/spatial/map-data.mjs` reads this file first through `server/spatial/offline-paths.mjs`
(`POI_DB_PATH`, default `/var/lib/questlayer-poi/current.sqlite`, `off` disables it). Street worlds outside
reviewed cities therefore get paths, coins and NPCs without any network call. Reviewed CityPacks (Plzeň) never use
it. Overpass stays only as a fallback for cells the file lacks: it sends a contact User-Agent, a request waits at most 4 s, and the
provider call keeps running in the background (up to 25 s) and caches a late answer for the next retry.
A full Czechia build gives 17,310 cells with 1.06 million ways, adds about 100 MB, and takes about 3 minutes.

## On the VPS

- Unit `deploy/questlayer-poi.service` (oneshot, system user `questlayer-poi`, state in `/var/lib/questlayer-poi`,
  mode 0755 so the game can read the file; Nice 15, idle I/O, 3 GB memory cap) and `deploy/questlayer-poi.timer`
  (Sundays 02:40 UTC).
- `bash scripts/install-poi-worker-vps.sh` installs osmium-tool, unzip, the pinned DuckDB CLI
  (`/opt/ps3000/apps/questlayer-hackathon/tools/duckdb`), the user and the units, then starts the first import in
  the background. The code itself ships with `scripts/deploy-vps.sh` (it now includes `scripts/poi`).
- Optional overrides go in `/opt/ps3000/apps/questlayer-hackathon/poi.env` (never `runtime.env`; the worker needs
  no secrets): `WORLD_REGIONS`, `OVERTURE_RELEASE`, `POI_CLOSURES_FILE`.
- Follow a run with `journalctl -u questlayer-poi -f`. The last line is the manifest JSON; copy it into
  `server/data/poi-manifest.json` in a PR.

## Auto cities (W5)

After each release `run.mjs` runs `scripts/poi/auto-cities.mjs` (also runnable alone:
`node scripts/poi/auto-cities.mjs --work=/var/lib/questlayer-poi [--min-pop=15000] [--country=CZ]`). It builds one
CityPack per GeoNames city of the imported countries with at least 15,000 people (`AUTO_CITY_MIN_POP`), using the
same builder as reviewed packs (`server/spatial/city-pack-builder.mjs`) on the kept OSM extracts:

- parks and gardens from `osm-<region>-pois.geojsonseq`, walkable ways (footway, pedestrian, path, living street,
  no private access) from `osm-<region>-paths.geojsonseq`, at most 3,500 per city, ways through parks first;
- coverage box sized by population (half side `1.5 + 3·sqrt(pop/100k)` km, 12 km cap), timezone from GeoNames;
  a feature in two boxes belongs to the nearer city centre;
- targets inside exclusion polygons (schools, hospitals, playgrounds, cemeteries, military, ...) are dropped, and a
  park centred in one is dropped;
- reviewed cities in `server/data/cities.json` win: same id or centre inside a reviewed coverage box skips the
  city, and no auto feature inside a reviewed box is used (the server enforces this again on load);
- a GeoNames place whose centre lies inside a larger auto city's box (city districts such as Žižkov or Brno-střed) is
  folded into that city;
- a city with no zone on any of seven sample days is not published.

Output: `city-packs-<poi version>-a<builder>/` with `<id>.json` (`fieldReview: "auto"`, `status: "auto"`,
`funded: false`), `index.json` (SHA-256 per pack), `report.json` (cities built, empty sectors, zones per city per
sample day) and `manifest.json` (hashes and counts only: the one file that may be copied into git). The
`city-packs` symlink is swapped atomically; the game re-reads the index within a minute, no restart. The game
finds it at `/var/lib/questlayer-poi/city-packs` (or `AUTO_CITIES_DIR`); `AUTO_CITIES=0` turns auto cities off.
`/api/health` shows `autoCities`. `scripts/deploy-vps.sh` starts one worker run when a POI release exists but no
auto city index does.

In the game: precedence is reviewed live city > auto city > H3 cell. An auto city gets the daily zone plan
(prepared lazily on the first visit), generic NPCs and street coins from the demo bucket, a visible "Unverified
map" notice, and no zone prize. Auto cities are never in native publication, and start-up refuses an auto city in
`NATIVE_FUNDED_CITIES`. Promotion to a reviewed city follows `docs/SECOND-CITY-PLAYBOOK.md`.

## Adding a region

Add an entry to `scripts/poi/regions.mjs` (Geofabrik URL, ISO country, bbox) and set `WORLD_REGIONS=cz,sk` in
`poi.env`. Europe and the planet need the same stages with more disk; memory stays at one tile (see below), not
at the size of the country.

Imported countries (13 Nov 2026): `cz`, `sk`, `at` (`deploy/questlayer-poi.service` sets `WORLD_REGIONS=cz,sk,at`;
an existing VPS keeps its installed unit, so set the same line in `poi.env`). Vienna and Bratislava are also demo
city clips: a GeoNames place whose centre lies inside a demo city's clip is left to the demo city (`inside-demo-city`),
and its own districts fold into it, so no second Vienna appears. Local check (cloud, openstreetmap.fr extracts plus
the two clips): 599,701 OSM places, 621,641 rows (442,967 ok), 524 tiles, POI build peak 0.44 GB in 6.7 min, 0.55 GB
file; auto cities 158 of 166 published, peak 1.58 GB in 10 min.

## Tiled build

`scripts/poi/build.mjs` builds a country in tiles (13 Nov 2026). Before, it held every place of the country in
memory to snap it to the nearest public path: Czechia (about 580,000 OSM places and Overture candidates) reached
2.8 GB of the worker's 3 GB cap, and Germany would need about ten times that.

1. Every input is streamed once into a scratch SQLite file next to the output (`<release>.sqlite.stage`, deleted
   at the end): places keyed by id with their tile, public path lines as raw float64 coordinates, exclusion areas,
   Wikidata items and the street path pieces.
2. A tile is a `POI_TILE_DEG` × `POI_TILE_DEG` degree square (default 0.25, about 28 × 18 km in Czechia). A place
   belongs to the tile of its own coordinates. A path line or exclusion area is staged for every tile its bounding
   box reaches plus a 60 m margin, so the 40 m snap and the exclusion test see exactly what a whole-country build
   sees.
3. Pass 1, tile by tile: snap places to public paths and fold Overture rows into OSM places. A tile also reads its
   neighbours' OSM places within 150 m, because an Overture row folds into a place up to 100 m away; the folds are
   recorded, not applied.
4. Pass 2, tile by tile: apply the folds, add Wikidata, run the W4 safety assessment and write the rows. Partition
   hashes are computed afterwards in one ordered scan of the written file.

The rules are unchanged (same taxonomy, safety filter, 40 m snap and Overture merge). The only possible difference
from a whole-country build is the order of two Overture rows on opposite sides of a tile edge folding into the same
nameless OSM place.

Auto cities (`scripts/poi/auto-cities.mjs`) are built in chunks of `AUTO_CITY_CHUNK` country cities (default 40),
one pass over the country's OSM exports per chunk. Which city owns a feature is still decided among all cities, so
a chunk bins exactly what a full run would.

Local check on 13 Nov (Czechia, openstreetmap.fr extract, Overture 2026-10-21.0, 79,352 Wikidata items, cloud
sandbox): the tiled build and the old whole-country build wrote the same 297,372 places, 400 partitions, 17,309
path cells and 123 cities, row for row, also with 0.1 degree tiles (1,133 tiles). Peak memory of the POI build
fell from 1.30 GB to 0.43–0.46 GB (0.39 GB with 0.1 degree tiles), 2.3 minutes either way; the scratch file peaked at
0.9 GB next to a 0.52 GB path export. Auto cities in chunks of 20: the same 85 packs (only `importedAt` differs),
peak 1.26 GB down to 0.87 GB, about 5.5 minutes instead of 5.

## Run status and coverage

Every run writes `last-run.json` next to `current.sqlite` (`running`, then `ok` with the version, or `failed` with the
stage and the error; SIGTERM counts as failed). A failed run keeps the previous release live. `/api/health` reports
both as `poiWorld` (see `docs/WORLD-COVERAGE.md`), and `npm run world:coverage` turns the file into a coverage
report and map.

## Worldwide build by an external worker

The spec for a worker that builds the database for the whole world (schema contract, sharding, validation with
`npm run poi:validate`, hand-over and swap-in) is `docs/POI-WORKER-BRIEF.md`.

## Tests

`tests/poi-pipeline.test.mjs` runs the whole build on `tests/fixtures/poi/` without network: merge and fold rules,
Wikidata enrichment, every exclusion reason, path snapping, partitions, a byte-identical rebuild, closures after a
re-import and the query builders' input checks.

## Outside the import (11 Nov 2026)

The weekly import covers Czechia. A street cell anywhere else asks Overpass
once for its places, public paths and grounds (`server/poi/live-source.mjs`),
classifies them with the same `classifyPois` taxonomy and safety filter, and
keeps the safe places with a path target in `geo_cache` under `poi:<cell>`
for 7 days (failures retry after 10 minutes). The first visitor's world load
waits up to 20 s for it; POI quests then use the rows like the imported file.
`POI_LIVE=off` disables it, `POI_LIVE_URL` changes the Overpass endpoint.

## Demo cities abroad (13 Nov 2026)

Public Overpass is not reliable from the VPS (London returned `map-data-unavailable`
for every retry on 13 Nov), so judges and visitors outside Czechia found an empty
map. `scripts/poi/demo-cities.mjs` lists 28 demo cities (three waves, centre on a
walkable public square or park). For each one the worker:

1. downloads the smallest public extract that contains it (BBBike city extract,
   download.openstreetmap.fr, or Geofabrik for Bolivia and Taiwan), skipping the
   download when Last-Modified/ETag are unchanged;
2. cuts an 8 × 8 km clip (`osmium extract -s simple`, `clipOsm`, about 2 GB peak), keeps only the
   clip and deletes the source extract;
3. runs the same osmium filters as a country (`osm-city-<id>-*.geojsonseq`), so the
   places, paths and exclusions go into the same `current.sqlite`. No Overture
   query for clips.

The auto city step then builds one pinned auto CityPack per clip (id = the city
id, coverage = the clip, timezone from the list, no GeoNames row needed). The
server answers a cell abroad from the file when the file mapped it
(`hasCell`), otherwise from live Overpass as before. Auto city rules are
unchanged: unverified notice, zone gold 0, coins from the global daily budget.

Wave 4 (`scripts/poi/demo-capitals.json`, 289 entries) adds the capital of
every country (GeoNames `PPLC`, largest per country; RU, KP, IR left out like
the launch scope, Czechia comes from the country import), the capital of every
US state (Denver is already a demo city) and the main city of split capitals
(La Paz, Abidjan, Dar es Salaam, Cotonou, Malabo, Cape Town, Johannesburg,
Tel Aviv, Jerusalem, Ramallah, Yangon, Istanbul, Almaty, Karachi, Casablanca,
São Paulo, Rio de Janeiro). A review moved seven centres to the walkable
centre (Jakarta, Astana, Muscat, Brasília; Kolonia for Palikir, Koror for
Ngerulmud, Brades for Plymouth). Capital clips are 6 × 6 km. The source is the
smallest BBBike or openstreetmap.fr extract whose published polygon holds the
clip (up to 600 MB), otherwise `geofabrik:auto`: on the VPS the worker reads
Geofabrik's `index-v1.json` (cached 7 days) and takes the smallest extract
that holds the clip (`scripts/poi/geofabrik-index.mjs`). A clip younger than
`DEMO_CITY_REFRESH_DAYS` (28) is reused without contacting its source.

`WORLD_CITIES` picks the set: `demo` (default, all), `off`, `wave1`..`wave4`,
`capitals` or ids. A city whose source fails is skipped and reported in `last-run.json`
(`demoCities.skipped`); its previous clip stays in use. The version gets
`-c<count>`. After a deploy, `scripts/vps-activate-release.sh` starts one worker
run when the release lacks a listed city (`scripts/poi/demo-cities-stale.mjs`).

Local check on 13 Nov (26 clips, cloud sandbox; Taipei and Cochabamba need
Geofabrik, VPS only): 25 auto cities, 6 zones a day in most, Lisbon 4, Zug 2,
Mumbai 3; Lagos has too few mapped parks and footways for zones and stays a
street world with POI quests and coins. Build 28 s and 531 MB RSS for the
POI file, about 25 s per auto city.

Local check of the memory-bounded worker (13 Nov, 169 clips that BBBike and
openstreetmap.fr serve; the 148 Geofabrik ones only run on the VPS): POI build
in 5 parts peaked at 750 MB (one build had peaked at 1.6 GB), auto cities in
their own process at 994 MB, osmium about 2 GB per call. 140 of 169 clips
became auto cities (zones per day 1-6, mean 4.3); the rest are small islands
(e.g. Funafuti, Majuro) or Lagos and stay street worlds. In an API probe of
143 capitals with a fresh player each: 115 auto cities (72 with a Tier 3
zone), 142 with quests, 141 with street coins, and the first quest claimed
in 117 (the rest were closed at that local hour or Tier 3 only).

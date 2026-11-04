# Brief: worldwide game POI database (external worker)

Status: brief, 4 November 2026. Audience: a worker (person or agent) who builds the QuestLayer place database for
the whole world on their own hardware and hands it over ready to plug in. Everything the game reads is described
here; you should not need to read the rest of the repository, although the code paths are linked.

> **Decision in force: Czechia only until 14 November 2026.** You can build, validate and hand over a world release
> now, but it is switched on for players only after Lubos says go. Until then a world file may be checked on the
> VPS (validator, coverage report) without being made live. The first delivery that matters is a **Czechia shard**
> that matches our own import (acceptance test A2), because it proves your pipeline before you scale it.

Contents: 1. How it works today · 2. What you deliver · 3. SQLite contract · 4. Taxonomy and safety · 5. Sharding ·
6. Versions, cadence, file names · 7. Sizes and hardware · 8. Validation and acceptance · 9. Hand-over and swap-in
on the VPS · 10. What the game side still does · 11. Checklist.

---

## 1. How it works today

### 1.1 One file, read-only, no network on the request path

The game never calls a map or model API while a player plays. A batch job builds **one SQLite file** of
quest-ready places and the game opens it read-only:

```
/var/lib/questlayer-poi/
  current.sqlite         -> releases/poi-<version>.sqlite          (symlink, swapped atomically)
  current.manifest.json  -> releases/poi-<version>.manifest.json
  ATTRIBUTION.md         -> releases/poi-<version>.ATTRIBUTION.md
  last-run.json          worker status shown in /api/health
  releases/              newest two releases kept
  city-packs/            auto CityPacks (W5), separate from the POI file
```

The live release on 3 November is `cz-20261102-6620c3bf`: **290,817 places, 197,999 quest-ready (`ok`), 5,867
`review`, 86,951 `excluded` (29.9 %)**, 395 H3 res-5 partitions, 123 GeoNames cities, 15,835 res-7 cells with
places, 14,999 cells with at least one POI quest, which is 98.2 % of Czechia's ~15,282 res-7 cells. The top
exclusion reasons were `unnamed` 34,604, `no-public-path` 32,522, `private-access` 10,594 and `military` 5,742
(full list: `curl -s https://questlayer.promptstudio3000.com/api/health` → `poiWorld.byReason`).

### 1.2 The current importer (W3, PR #109)

Code: `scripts/poi/run.mjs` (stages), `fetch.mjs`, `extract-osm.mjs`, `build.mjs` (schema and writer), `merge.mjs`
(fold and snap rules), `regions.mjs` (only `cz` today). Docs: `docs/POI-PIPELINE.md`.

On the VPS it runs as `questlayer-poi.service` (oneshot, user `questlayer-poi`, 3 GB memory cap) from
`questlayer-poi.timer`, **Sundays 02:40 UTC**. A full Czechia run takes ~17 minutes on the VPS (3 Nov: 01:20 →
01:37 UTC). Stages:

1. **fetch**: Geofabrik `czech-republic-latest.osm.pbf` (only when ETag/Last-Modified changed, `.md5` verified);
   Overture Maps Places, latest release, bbox query with the DuckDB CLI over S3; GeoNames `cities15000`.
2. **extract**: `osmium tags-filter` + `osmium export` into three GeoJSON sequences: candidate places (tourism,
   historic, selected amenity/leisure/man_made, `place=square`, `highway=trailhead`), walkable paths
   (`highway=footway,path,pedestrian,living_street,track,cycleway,steps,residential,unclassified,bridleway`) and
   exclusion grounds (schools, hospitals, military, railway land, …).
3. **wikidata**: ids from OSM `wikidata=` tags; SPARQL in batches of 250, cached in `inputs/wikidata.ndjson`
   (labels, short descriptions, sitelink count, inception year).
4. **build**: OSM is primary. An Overture row is folded into an OSM place when the name matches within 100 m or
   the category matches within 30 m; otherwise it is kept only if an OSM public path lies within 40 m. Overture
   rows that are closed, below confidence 0.6, unnamed, outside the region's country or outside the taxonomy are
   dropped. Every place is snapped to the nearest public path within 40 m (the check-in target). Taxonomy and
   safety come from W4 (below). Excluded places stay in the file with a reason, so an operator closure survives
   re-imports.
5. **publish**: write `releases/poi-<version>.*`, swap the `current.*` symlinks, keep two releases, write
   `last-run.json`, then build auto CityPacks (W5).

### 1.3 Data sources and licences

| Source | What we take | Licence | Notes for a world build |
| --- | --- | --- | --- |
| OpenStreetMap | places, walkable paths, exclusion grounds | ODbL 1.0 | Planet PBF or Geofabrik extracts; record the replication timestamp |
| Overture Maps Places | named places that fill OSM gaps | CDLA-Permissive-2.0 | Download the release's places parquet once instead of one S3 query per country |
| Wikidata | multilingual names, short descriptions, notability (sitelinks) | CC0 | SPARQL does not scale to the world: use the JSON dump or a QLever endpoint |
| GeoNames `cities15000` | cities for auto CityPacks and coverage checks | CC BY 4.0 | One small global file |

The database is a derivative database of OSM and therefore ODbL. It **never goes to git** (size and licence); only
its manifest does. Every release carries `ATTRIBUTION.md`.

### 1.4 Taxonomy and safety filter (W4, PR #107)

Code: `server/poi/taxonomy.mjs`, `server/poi/safety.mjs`, `server/poi/index.mjs`. Docs: `docs/POI-SAFETY.md`.
Policy ids `poi-taxonomy-v1` and `poi-safety-v1`. Offline and deterministic. Section 4 gives the rules you must
reproduce. **Use these modules as the single source of truth**; do not re-type the tables.

### 1.5 Who reads the file

| Reader | Code | What it queries |
| --- | --- | --- |
| W6 POI quests | `server/poi-quests.mjs` | `SELECT id,category,name,notability,path_ref,wikidata,facts FROM poi WHERE h3r5=? AND h3r7=? AND safety='ok' AND path_ref IS NOT NULL ORDER BY id`; clue pool by `h3r5` with `facts`. Refuses a file whose `meta.schema` is not `questlayer.poi/1`. ≤6 quests per res-7 cell per day, ≥250 m apart, ≤2 category hunts, 72 h rotation, open 08:00–20:00 local time (timezone from the cell). |
| Offline street paths | `server/spatial/offline-paths.mjs` | `SELECT paths FROM path_cell WHERE h3r7=?`; parses the OSM date from `meta.version` (`-YYYYMMDD-<hash>` suffix). Gives street worlds paths, coins and NPCs without Overpass. |
| W8 flavour texts | `server/ai/flavour-batch.mjs`, `server/ai/flavour.mjs` | `SELECT id,h3r7,category,name,names,notability,facts FROM poi WHERE h3r5=? AND h3r7=? AND safety='ok' ORDER BY notability DESC, id`. Uses `names[lang] || name` and the Wikidata description in `facts` as model input for nightly titles. |
| W5 auto cities | `scripts/poi/auto-cities.mjs` | `city` table (plus the OSM GeoJSON extracts in the worker's own directory; see section 10). |
| W12 coverage QA | `server/poi/coverage.mjs`, `scripts/world-coverage.mjs` | Every table; `/api/health` → `poiWorld` and `npm run world:coverage`. |

Readers re-check the symlink target about once a minute and reopen on change, so a swap needs no restart.

### 1.6 Coverage QA (W12, PR #114)

`npm run world:coverage -- --poi <file>` writes `report.json`, `report.md` and a hex `map.html` with: totals by
safety, quests-per-cell histogram (the C.3 capacity: ≤6 per cell, 250 m spacing, ≤3 trails, notability first),
exclusions by reason, seeded random spots (distance to the nearest quest), checked places (Brno, Holašovice, Plzeň,
Prague, Šumava), top cities by population with six 60° sectors, a 30-day rotation simulation and a quest sample
with OpenStreetMap links for manual review. Same file and seed give the same report.

---

## 2. What you deliver

Per release, one directory:

```
poi-world-<version>/
  poi-<version>.sqlite              the merged release the game reads (section 3)
  poi-<version>.manifest.json       section 6.4
  poi-<version>.ATTRIBUTION.md      section 6.5
  shards/<shard>.manifest.json      one per shard (the shard .sqlite files stay with you unless asked)
  qa/validate.json                  npm run poi:validate -- … --json, merged file
  qa/validate-<shard>.json          same, per shard
  qa/coverage/<shard>/report.json   npm run world:coverage per shard (and report.md, map.html)
  qa/conformance-cz.json            acceptance test A2
  SHA256SUMS                        sha256 of every file above
```

The game reads exactly **one** file. Shards are your unit of work, validation and partial rebuilds; you merge them
into one release (section 5.4). A continent release (`eu-…`) is allowed as an intermediate step with the same rules.

---

## 3. SQLite contract: `questlayer.poi/1`

The schema is fixed. Table names, column names, **column order** and the two indexes must be exactly these (the
writer is `scripts/poi/build.mjs`, `SCHEMA_SQL`). Extra tables are allowed and ignored (for example `shard`, 5.4);
extra columns are not.

```sql
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE poi(
  h3r5 TEXT NOT NULL, id TEXT NOT NULL, h3r7 TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, category TEXT NOT NULL,
  name TEXT, names TEXT NOT NULL, wikidata TEXT, notability INTEGER NOT NULL,
  sources TEXT NOT NULL, safety TEXT NOT NULL CHECK (safety IN ('ok','review','excluded')),
  safety_reason TEXT, access TEXT, hours TEXT, path_ref TEXT, facts TEXT,
  source_hash TEXT NOT NULL,
  PRIMARY KEY (h3r5, id)) WITHOUT ROWID;
CREATE UNIQUE INDEX poi_id ON poi(id);
CREATE INDEX poi_cell ON poi(h3r7, safety, category);
CREATE TABLE partition(h3r5 TEXT PRIMARY KEY, pois INTEGER NOT NULL, ok INTEGER NOT NULL,
  review INTEGER NOT NULL, excluded INTEGER NOT NULL, hash TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE path_cell(h3r7 TEXT PRIMARY KEY, h3r5 TEXT NOT NULL, paths BLOB NOT NULL,
  ways INTEGER NOT NULL, points INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE city(geonameid INTEGER PRIMARY KEY, name TEXT NOT NULL, ascii_name TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, country TEXT NOT NULL, admin1 TEXT, population INTEGER NOT NULL,
  timezone TEXT, h3r5 TEXT NOT NULL);
```

Write with `page_size=4096`, `journal_mode=OFF` during the build, insert rows in primary-key order, finish with
`VACUUM`. No wall-clock time inside the database.

### 3.1 `meta`

| key | value |
| --- | --- |
| `schema` | `questlayer.poi/1` (readers refuse anything else) |
| `version` | `<scope>-<YYYYMMDD>-<hash8>` (6.1) |
| `regions` | comma-separated sorted shard ids, e.g. `at,cz,de-by,…` (shown in `/api/health`) |
| `taxonomyVersion` | `poi-taxonomy-v1` (must equal the game build) |
| `safetyVersion` | `poi-safety-v1` (must equal the game build) |
| `w4Source` | `w4` (the real W4 modules were used) |
| `attribution` | `Places: © OpenStreetMap contributors (ODbL), Overture Maps Foundation (CDLA-Permissive-2.0), Wikidata (CC0), GeoNames (CC BY 4.0)` |

### 3.2 `poi` columns

| column | type and rule |
| --- | --- |
| `id` | `osm:<n|w|r><number>` for OSM (`osm:w123456`), `ovt:<Overture GERS id>` for Overture-only rows. Stable across releases; unique in the file. |
| `lat`, `lng` | label point of the place, WGS84, rounded to 6 decimals. Polygons: a representative point inside the polygon. |
| `h3r7` | `latLngToCell(lat, lng, 7)` (h3-js v4) of the **label point**. |
| `h3r5` | `cellToParent(h3r7, 5)`. |
| `category` | one of the 30 ids in 4.1. Never empty. A feature with no category is not written at all. |
| `name` | the local `name` tag (or Overture `names.primary`), or `NULL`. ≤300 characters. |
| `names` | JSON object `{ "<lang>": "<name>" }`, `{}` when none. Keys are lowercase ISO 639 codes. Fill from OSM `name:<lang>` and Wikidata labels for **en, cs, de, sk, pl, es, fr, pt, ru, zh, ja, hi, ar** (the game's UI languages plus the current set). Keys sorted. |
| `wikidata` | `Q<number>` or `NULL`. |
| `notability` | Wikidata sitelink count, integer ≥ 0 (0 without Wikidata). Quests and flavour texts pick notable places first. |
| `sources` | JSON array, sorted by `source:sourceId`, each `{ "source": "osm"|"overture"|"wikidata", "sourceId": "way/123"|"<gers>"|"Q42", "licence": "ODbL-1.0"|"CDLA-Permissive-2.0"|"CC0-1.0" }` (Overture may add `dataset`). Never empty. |
| `safety` | `ok`, `review` or `excluded` (4.2). |
| `safety_reason` | `NULL` for `ok`; the first blocking (else first review) reason code for the others. |
| `access` | OSM `access` tag or `NULL`. |
| `hours` | OSM `opening_hours` or `NULL`. |
| `path_ref` | check-in target JSON `{ "distanceM": <m ≤ 40>, "lat": …, "lng": …, "wayId": "w123"|null }`, keys sorted, coordinates rounded to 6 decimals. Required for `ok`, `NULL` for `excluded`. |
| `facts` | JSON object or `NULL`: Wikidata short descriptions by language (`{"cs": "…", "en": "…"}`) plus `inception` (integer year) when known. |
| `source_hash` | sha256 hex of the canonical JSON of the row (all columns above except `source_hash`, plus the OSM `tags` object). Used for partition hashes and change detection. Canonical = keys sorted recursively, no spaces. |

### 3.3 `partition`

One row per `h3r5` that has `poi` rows: `pois`, `ok`, `review`, `excluded` counts, and `hash` = sha256 hex over
the lines `"<id>:<source_hash>\n"` of that partition's rows in `id` order. The validator recomputes it.

### 3.4 `path_cell` (offline street paths)

One row per H3 res-7 cell with walkable ways. `paths` = **deflate-raw** (zlib `deflateRawSync`, level 9) of the
JSON `[[[lng,lat],[lng,lat],…], …]`; `ways` = number of paths; `points` = total points; `h3r5` = parent.

- Walkable: `highway` in footway, pedestrian, path, living_street, steps (priority 0), cycleway, bridleway (1),
  residential (2), unclassified, track (3); never `area=yes`, never `access` or `foot` in
  `no, private, customers, permit, agricultural, forestry`.
- A way is split into per-cell runs; each run keeps one vertex on either side so a path does not stop short of
  the cell edge; runs longer than 2,048 points are cut.
- Per cell at most **150 paths and 30,000 points**, filled in order priority → way id → run.
- Coordinates rounded to 6 decimals. Reference: `cellPieces` and `packPathCells` in `scripts/poi/{merge,build}.mjs`.

### 3.5 `city`

GeoNames `cities15000` rows of the shard's territory: `geonameid, name, ascii_name, lat, lng, country` (ISO alpha-2),
`admin1, population, timezone` (IANA), `h3r5` = res-5 parent of the res-7 cell of the city point. Sorted by
`geonameid`.

---

## 4. Taxonomy and safety rules (must match W4 exactly)

Import `classifyOsm`, `classifyOverture`, `assessPoi`, `isPublicPath`, `TAXONOMY_VERSION`, `SAFETY_VERSION` from
`server/poi/taxonomy.mjs` and `server/poi/safety.mjs` (or run our `scripts/poi/build.mjs`, see 5.3). If you
reimplement in another language you must pass acceptance tests A2 and A3, and every behaviour change on our side
bumps the policy version, which your release must then match.

### 4.1 Categories (`poi-taxonomy-v1`, 30 ids, stable)

`park, garden, plaza*, viewpoint, fountain, monument, memorial, artwork, street_art, castle°, ruins,
historic_building*°, museum°, library°, market, bridge, river_walk*, lake_walk*, trailhead, nature_reserve*,
observatory°, landmark_tower°, sculpture, picnic_site, information_board, music_venue*°, sports_ground*,
skate_park (review), bench_with_view, other_named*`

`*` needs a name (otherwise `excluded` / `unnamed`), `°` exterior only (quests never ask players to go inside).
OSM rules are ordered most specific first (`OSM_CATEGORY_RULES`); Overture maps through `OVERTURE_CATEGORY_MAP`
(primary category first, then alternates). Print the unmatched Overture primary categories per shard in your QA so
the table can grow on our side; do not add categories yourself.

### 4.2 Safety (`poi-safety-v1`)

| Result | Reason codes |
| --- | --- |
| `excluded` by own tags | `school`, `kindergarten`, `playground`, `hospital`, `care-home`, `prison`, `military`, `private-access`, `railway`, `motorway`, `quarry`, `construction`, `embassy`, `police`, `aerodrome`, `bar`, `adult-venue`, `disused` |
| `review` by own tags | `worship-exterior`, `cemetery`, `sensitive-memorial` (Stolpersteine, ghost bikes) |
| inside grounds | `inside-<code>` when the place (or its polygon) lies inside such grounds; review grounds give `review` |
| category | `uncategorised`, `unnamed`, `category-review`, `low-confidence` (Overture confidence < 0.5; the importer already drops < 0.6) |
| path | `no-public-path` (no public path within **40 m**), `water-no-path`, `target-excluded` |
| operator | `operator-closure` (ids from the closures file, 6.3) |

Path snapping: the check-in target is the nearest point on a public path within **40 m**. A polygon prefers path
points inside it. A candidate point inside excluded grounds, or within **25 m** of a school, kindergarten or
playground, is skipped. Path points inside review grounds give `review`, never `ok`. Public paths for snapping are
wider than the walkable set in 3.4 (`isPublicPath`): also service roads with `foot=yes` or a sidewalk, and
primary/secondary/tertiary roads only with a mapped sidewalk; never motorways, trunks, tunnels, indoor or private
ways.

Hard safety rules, whatever the data says:

1. Never `ok` inside or within 25 m of schools, kindergartens or playgrounds, and never inside hospitals, care
   homes, prisons, military land, railway land, quarries, construction sites, embassies, police or airfields.
2. Never `ok` without a public path target within 40 m.
3. Never `ok` for bars, nightclubs, adult or gambling venues, or disused/abandoned features.
4. When in doubt, `review` or `excluded`. A looser verdict than ours on the same feature fails acceptance (A2).
5. Grounds and paths must be loaded for the shard **plus a 1 km margin** (W4 needs at least 50 m), so a place near
   a shard edge sees the school next door.

---

## 5. Sharding

### 5.1 Shard ids

One shard per ISO 3166-1 country, lowercase alpha-2 (`cz`, `sk`, `at`). Countries too large for one bounded build
are split along Geofabrik sub-regions with `<cc>-<sub>` ids (`us-ca`, `de-by`, `ru-cfd`, `fr-idf`, `in-mh`, …);
a split must be total (every bit of the country is in exactly one sub-shard). Rule of thumb: split when a country
has more than ~1.5 M candidate places or its PBF is above ~2 GB. Publish your shard list as `shards.json`
(`[{ id, name, country, polygonSource }]`) with the first delivery.

### 5.2 Ownership: every row has exactly one owner

Ownership is decided at **H3 res-5** so that partitions never straddle shards:

1. A res-5 cell belongs to the shard whose boundary polygon contains the cell centre.
2. If no shard contains the centre (coast, lakes, open sea), it belongs to the shard containing the most centres
   of its res-7 children; tie → the lexicographically smallest shard id. Cells with none are not owned.
3. A shard writes only `poi` rows, `partition` rows and `path_cell` rows whose `h3r5` it owns, and `city` rows
   whose `h3r5` it owns.
4. The shard is built from an extract that covers its owned cells **plus a 1 km buffer** (`osmium extract
   --polygon` on the union of owned hexes, buffered), so snapping and grounds work at the edges. Places that fall
   in a neighbour's cells are dropped from this shard; the neighbour writes them.

Write the ownership table once per release as `ownership.csv` (`h3r5,shard`) and keep it stable between releases
unless a boundary changes.

### 5.3 Building a shard

Recommended route: use this repository's builder unchanged.

- Add your shard to `scripts/poi/regions.mjs` (or call `buildPoiDatabase()` from `scripts/poi/build.mjs`
  directly with your own inputs: `{ osmPois, osmPaths, osmExclusions, overture: [{path, country}], wikidata,
  geonames: [{path, countries}], closures }`, all GeoJSON-seq / NDJSON files as `run.mjs` produces them).
- Use `loadW4()` from `scripts/poi/lib/w4.mjs` so the manifest says `w4Source: "w4"`.
- Extend `NAME_LANGS` in `scripts/poi/merge.mjs` and the Wikidata label languages in `scripts/poi/fetch.mjs` to
  the 13 languages in 3.2 (send that change to us as a PR; it is a rule change we ship too).
- Apply the ownership filter (5.2) to the build output, or to the inputs, before merging.

Memory is bounded by the number of places per shard (CZ: 290 k places in < 3 GB). Run shards in parallel.

### 5.4 Merging shards into a release

`ATTACH` each shard and `INSERT INTO … SELECT … ORDER BY` primary key into a fresh file with the exact schema,
then write `meta` (version and regions of the merged release) and `VACUUM`. Because ownership is disjoint, ids,
`h3r5` partitions and `h3r7` path cells never collide; a collision is a bug, not something to resolve by picking
one. You may add `CREATE TABLE shard(h3r5 TEXT PRIMARY KEY, shard TEXT NOT NULL) WITHOUT ROWID` to the merged file;
readers ignore it. A failed shard keeps its last good build in the merge, and the manifest says so (6.4).

---

## 6. Versions, cadence, file names

### 6.1 Version string

`<scope>-<YYYYMMDD>-<hash8>`, lowercase:

- `<scope>`: shard id for a shard (`cz`, `de-by`), `world` for the merged release (`eu`, `af`, … for a continent).
- `<YYYYMMDD>`: the newest OSM replication timestamp among the inputs (UTC date). The game reads it as the map
  data date.
- `<hash8>`: first 8 hex of sha256 over the canonical JSON of: sorted shard list with each shard's OSM PBF sha256,
  Overture release, GeoNames sha256, Wikidata snapshot id, `taxonomyVersion`, `safetyVersion`, closures count.

The same inputs must give the same version **and a byte-identical file** (acceptance A5).

### 6.2 Cadence

| What | When |
| --- | --- |
| OSM | weekly (planet or Geofabrik weekly), published by **Sunday 02:00 UTC** |
| Overture | each monthly release; pin it in the manifest |
| Wikidata | monthly dump; cache by id between dumps |
| GeoNames | monthly |
| Maximum staleness of a live release | 14 days; a shard older than 28 days is flagged in the manifest |

Czechia keeps being built by our own VPS timer for auto cities until the game side says otherwise (section 10).

### 6.3 Closures input

Operator closures are a JSON array of POI ids (`["osm:w123", "ovt:…"]`), exported from the game and given to you
as `closures.json`. Every listed id becomes `excluded` / `operator-closure` and stays so across releases. The list
is empty today; use an empty array until we send one.

### 6.4 Manifest (`questlayer.poi-manifest/1`)

The output of `buildPoiDatabase()` plus the fields below; this is the only file that goes to git
(`server/data/poi-world-manifest.json`):

```json
{
  "schema": "questlayer.poi-manifest/1",
  "version": "world-20261115-1a2b3c4d",
  "regions": ["at", "cz", "de-by", "…"],
  "file": "poi-world-20261115-1a2b3c4d.sqlite",
  "bytes": 0, "sha256": "…",
  "taxonomyVersion": "poi-taxonomy-v1", "safetyVersion": "poi-safety-v1", "w4Source": "w4",
  "counts": { "pois": 0, "partitions": 0, "cities": 0, "pathCells": 0, "pathWays": 0, "pathPoints": 0,
              "bySafety": {}, "byCategory": {}, "byReason": {} },
  "shards": [{ "id": "cz", "version": "cz-20261115-…", "sha256": "…", "bytes": 0, "osmTimestamp": "…",
               "pois": 0, "ok": 0, "reused": false, "unmatchedOvertureCategories": {} }],
  "inputs": [{ "source": "openstreetmap:planet", "url": "…", "version": "…", "sha256": "…", "licence": "ODbL-1.0" }],
  "builder": { "name": "…", "questlayerCommit": "<git sha of this repo used>", "host": "…" },
  "builtAt": "2026-11-15T01:00:00.000Z"
}
```

### 6.5 File names

- Release: `poi-<version>.sqlite`, `poi-<version>.manifest.json`, `poi-<version>.ATTRIBUTION.md` (generate with
  `attributionMarkdown()` from `scripts/poi/build.mjs`, listing every input).
- Shard: `poi-<shard version>.sqlite` and `.manifest.json`, same schema and validator.

---

## 7. Sizes and hardware (estimates)

Measured: Czechia (78,871 km², very well mapped) gives ~291 k places and ~200 MB (POI rows ~100 MB, `path_cell`
~100 MB for 17,310 cells / 1.06 M ways). Scaling by OSM data volume (CZ PBF ≈ 1 % of the planet), and allowing for
the fact that most of the world is mapped less densely than Czechia:

| Scope | Places | File | Note |
| --- | --- | --- | --- |
| Czechia | 0.29 M | ~0.2 GB | measured |
| Central Europe (CZ, SK, AT, PL, DE, HU) | 3–4 M | 2–3 GB | |
| Europe | 10–15 M | 6–10 GB | |
| World | 25–40 M | 15–30 GB | `path_cell` is the larger half |

These are planning numbers; report the real ones per shard. The VPS needs about **2.5 × the release size free**
(new release, previous release, copy in flight) on the disk that holds `/var/lib`. Check `df -h /var/lib` there
before the first world hand-over; if it does not fit, we go continent by continent (Europe first) or drop
`path_cell` for cells outside the active countries (agree with us first).

Build machine for the world: 16+ cores, 64 GB RAM, ~1 TB SSD (planet PBF ~85 GB, extracts, Overture parquet,
Wikidata dump ~130 GB compressed, intermediates). Expect hours, not minutes; run shards in parallel.

---

## 8. Validation and acceptance

### 8.1 Validator (mechanical, must pass)

```
npm ci
npm run poi:validate -- poi-<version>.sqlite --manifest poi-<version>.manifest.json [--sample-paths 2000] [--json]
```

`scripts/poi/validate-release.mjs` exits 0 (`ACCEPTED`) or 1 (`REJECTED` with the first 50 problems). It checks:
tables, column order and indexes; `meta` keys, schema, version format, taxonomy/safety versions equal to the game
build, OSM attribution; every `poi` row (id format, coordinate range, `h3r7`/`h3r5` derived from the label point,
category in the taxonomy, name length, `names`/`sources`/`facts`/`path_ref` JSON shape, language-code keys,
`ok` ⇒ no reason and a target, non-`ok` ⇒ a known reason code, `excluded` ⇒ no target, `distanceM ≤ 40`, sha256
hex `source_hash`, unique ids); partition counts and hashes recomputed from the rows; every `path_cell` row's
cell, parent and limits, plus a decoded sample (`[lng,lat]` points, counts match, each path touches its cell);
`city` rows; `PRAGMA quick_check`; and with `--manifest` the file sha256, bytes, counts and inputs list.

### 8.2 Acceptance tests

| # | Test | Pass when |
| --- | --- | --- |
| A1 | Validator on every shard and on the merged release | `ACCEPTED` everywhere, outputs in `qa/` |
| A2 | **Czechia conformance**: your `cz` shard vs our VPS release built from the same Geofabrik date | place count and `ok` count within ±2 %; ≥ 95 % of our ids present; **zero** ids that we mark `review`/`excluded` and you mark `ok`; differences listed in `qa/conformance-cz.json` (we give you our release file for that date on request) |
| A3 | Fixture parity (only if you reimplement the builder) | your pipeline on `tests/fixtures/poi/` and `tests/fixtures/world-coverage/` inputs gives the same rows (all columns) as `scripts/poi/build.mjs`; `npm test` stays green with your PR |
| A4 | Coverage per shard: `npm run world:coverage -- --poi <shard file> --out qa/coverage` | report produced; for each shard with ≥ 1 city of 100 k people, ≥ 90 % of its top-20 cities have ≥ 1 quest-ready place within 3 km; shards below that are listed, not hidden |
| A5 | Determinism | rebuilding a shard from the same inputs gives the same sha256 |
| A6 | Safety sample | from each coverage report's quest sample (`--sample 50`), a person or agent opens the OSM links for at least 20 targets in 5 different shards; zero targets inside or at a school, kindergarten, playground, hospital, military or private ground |
| A7 | Swap-in smoke on the VPS (we do it with you) | section 9 steps pass, `/api/health` → `poiWorld.status` is `ready` with your version |

Unit tests for the validator: `tests/poi-validate-release.test.mjs` (a fixture release is accepted; eight contract
violations are each rejected with a reason).

---

## 9. Hand-over and swap-in on the VPS

The VPS (`questlayer.promptstudio3000.com`) is reached only from Lubos's Mac (SSH from the cloud is blocked). The
world release lives in **its own directory**, so the Czechia worker and auto cities keep running untouched and a
rollback is one symlink.

1. **Transfer** (from the Mac): `rsync --partial --progress poi-world-<version>/ <vps>:/var/lib/questlayer-poi-world/incoming/<version>/`.
   Never through git or a public bucket without Lubos's say-so (ODbL is fine to share with attribution, but the
   file is large and the hand-over should be private).
2. **Verify on the VPS**, in `/opt/ps3000/apps/questlayer-hackathon/current`:
   `sha256sum -c SHA256SUMS`, then
   `node scripts/poi/validate-release.mjs <file> --manifest <manifest>` and
   `node scripts/world-coverage.mjs --poi <file> --out /var/lib/questlayer-poi-world/qa`.
   Back up the game database first, as with every deploy.
3. **Publish atomically**: move the three release files into `/var/lib/questlayer-poi-world/releases/`
   (owner `questlayer-poi`, files 0644, directories 0755 so the game user can read), then for each of
   `current.sqlite`, `current.manifest.json`, `ATTRIBUTION.md`:
   `ln -sfn releases/poi-<version>.<ext> <link>.next && mv -T <link>.next <link>`.
   Write `last-run.json` there: `{"status":"ok","stage":"done","version":"<version>","finishedAt":"<ISO>","startedAt":"<ISO>"}`
   so `/api/health` reports `ready`, not `import-failed`. Keep the previous release; delete older ones.
4. **First time only (after the go for worldwide play)**: add
   `POI_DB_PATH=/var/lib/questlayer-poi-world/current.sqlite` to the game's `runtime.env` and restart the game
   service. Lubos must ask for this change himself in the deploy thread (agent-requested `runtime.env` changes are
   blocked on the Mac). Every later swap is step 3 only: readers notice the new symlink target within a minute.
5. **Smoke**: `curl -s https://questlayer.promptstudio3000.com/api/health | jq .poiWorld` shows `status: "ready"`,
   your `version` and counts; open the game with the demo pad in Brno and in one foreign city of your shards and
   see POI quests and street paths. Then copy the manifest into `server/data/poi-world-manifest.json` in a PR.
6. **Rollback**: point the symlinks back at the previous release (step 3), or remove the `POI_DB_PATH` line and
   restart to fall back to the Czechia file.

---

## 10. What the game side still does (not your job, listed so you know the edges)

- **Country gate.** Pointing `POI_DB_PATH` at a world file makes POI quests and offline paths appear everywhere at
  once. Until the 14 November decision is lifted the world file stays off; we may add a `POI_COUNTRIES` allowlist so
  a world file can be live while play stays limited.
- **Auto cities (W5)** are built by `scripts/poi/auto-cities.mjs` from the OSM GeoJSON extracts in the Czechia
  worker's directory, not from the SQLite file, and stay Czechia-only; they keep coming from
  `/var/lib/questlayer-poi/city-packs`.
- **`/api/health` poiWorld** computes its summary over the whole file once per release (a few hundred ms for
  Czechia, minutes for the world) and `countryShare` knows only Czechia's area; both need a small change before a
  world swap.
- **Flavour texts (W8)** are written in English and Czech only; other languages use template text.
- **Coverage checked places** are Czech; per-shard sample spots come from your QA.

---

## 11. Checklist for each delivery

- [ ] Built with the W4 modules at the same `taxonomyVersion` / `safetyVersion` as the game (`w4Source: "w4"`).
- [ ] Ownership by res-5 cell, extracts with a 1 km buffer, no duplicate ids or cells after the merge.
- [ ] Names in the 13 languages where the sources have them; Wikidata descriptions in `facts`.
- [ ] Closures file applied (empty array allowed).
- [ ] `npm run poi:validate` ACCEPTED for every shard and the release (A1).
- [ ] Czechia conformance (A2) in `qa/conformance-cz.json`.
- [ ] Coverage reports per shard (A4), safety sample reviewed (A6), determinism checked (A5).
- [ ] Manifest with shards, inputs (url, version, sha256, licence), builder commit; `ATTRIBUTION.md`; `SHA256SUMS`.
- [ ] Size checked against free disk on the VPS (2.5 ×).
- [ ] Hand-over through the Mac with rsync; swap-in steps in section 9; worldwide go from Lubos before step 4.

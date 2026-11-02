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
city(geonameid, name, ascii_name, lat, lng, country, admin1, population, timezone, h3r5)
meta(key, value)                           -- schema questlayer.poi/1, version, rule versions, attribution
```

Readers (W5, W6) open `/var/lib/questlayer-poi/current.sqlite` read-only and query by `h3r5`/`h3r7` with
`safety='ok'`.

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

## Adding a region

Add an entry to `scripts/poi/regions.mjs` (Geofabrik URL, ISO country, bbox) and set `WORLD_REGIONS=cz,sk` in
`poi.env`. Europe and the planet need the same stages with more disk; the per-stage memory stays bounded by the
number of places, not by the number of paths.

## Tests

`tests/poi-pipeline.test.mjs` runs the whole build on `tests/fixtures/poi/` without network: merge and fold rules,
Wikidata enrichment, every exclusion reason, path snapping, partitions, a byte-identical rebuild, closures after a
re-import and the query builders' input checks.

# QuestLayer — global geography and context data delivery

This is a self-contained assignment for the authorized data-collection AI/operator. Deliver data, reproducibility and measured coverage. Do not change rewards, contracts, production activation or financial code.

## Objective and checkpoint

Prepare a reproducible global geographic dataset for QuestLayer's daily world worker. The target is global testnet gameplay at delivery: zones, quests, coin positions, item selections and fixed reward allocations are decided before each UTC accounting day opens. Player visits must not generate extra objects or funding.

Use the owner-supplied checkpoint of `promptstudio3000/questlayer-hackathon`. Record the exact commit and any supplied source-package hash. Read its agent rules. The conversation's global objective supersedes the former Czechia-only activation goal in older briefs; schema, safety and protected-code boundaries still apply.

## 1. Inventory before collecting

Inspect supplied exports and only sources explicitly authorized for this assignment. Historical locations for the authorized VPS operator to verify:

- `/opt/prompt-studio/data/agent-zero/usr/workdir/mapos-atlas`
- `/var/lib/questlayer-atlas-context/current.sqlite`
- `/var/lib/questlayer-poi/current.sqlite`

These are historical pointers, not verified current services or permission to access production. Request isolated exports from the authorized operator. Do not modify live databases, replace symlinks, deploy services, read credentials or delete existing data.

Report dates, countries, record counts, stable IDs, coordinate completeness, full geometry coverage, licenses, collection status and missing inputs. Reuse existing downloads/checkpoints where hashes match. Do not claim current counts from historical notes.

Atlas is contextual enrichment. A matching entity does not establish safe/public access. Preserve `text_reuse=review_required` and unverified field-review labels. Keep source text apart from AI-generated interpretation.

## 2. Collect geographic inputs

- Named POIs with stable OSM, Wikidata or Overture identifiers.
- Public pedestrian paths with original way/node references, access/foot restrictions, barriers, crossings, bridge/tunnel/layer data and available opening hours.
- Polygon/multipolygon candidates with complete inner rings, exclusions and known closures.
- GeoNames cities, population, country and IANA timezone.
- Sourced local facts, multilingual names and descriptions with explicit reuse status.

Use bulk OSM extracts and cached/dump-based enrichment at scale. Do not crawl the planet through public Overpass/SPARQL endpoints. Never invent coordinates, walkable routes, public access, local facts or quest answers. Geocaching listings and hidden cache coordinates are excluded unless the owner supplies specific reuse authorization. Retain source-specific attribution/licenses, including current provider-specific Overture licenses.

## 3. Preserve the existing data contract

The supplied repository's builder and validators are authoritative:

- `questlayer.poi/1`; writer `scripts/poi/build.mjs`.
- Classification/safety in `server/poi/`.
- Release validation in `scripts/poi/validate-release.mjs`.
- Detailed collection/sharding contract in `docs/POI-WORKER-BRIEF.md`.

Produce compatible `poi`, `partition`, `path_cell`, `city` and `meta` tables. Preserve excluded/review records and reason codes. Record taxonomy and safety versions. Do not silently change fields to satisfy a newly invented schema.

Preserve label coordinates separately from check-in targets. In the current builder, res-7 indexes the **label**, and res-5 is the parent of that res-7 cell. It is not an independent res-5 point lookup and not an index of the snapped target. Report cross-cell targets explicitly.

Deliver the normalized OSM POI/path/exclusion GeoJSON sequences alongside SQLite. Keep original topology IDs and full polygon geometry; compressed `path_cell` alone is insufficient for world zones or route validation. Build candidate CityPacks using the supplied builder. Keep automatic/unverified status, never funded or field-reviewed, and list omitted cities/rejected candidates with reasons.

The new `questlayer.world-snapshot/1` contract documented in `docs/GLOBAL-WORLD-PREPARATION.md` is a **downstream game-content snapshot**, not a demand for this data agent to invent coin allocations or completion rules. Your geography output feeds the implemented `server/world-preparation/geography.mjs` source adapter. Do not present a raw POI export as a completed daily world. `tests/fixtures/world-preparation/world.mjs` demonstrates that downstream shape with synthetic, non-playable data only.

## 4. Regional processing

Publish a complete expected global shard inventory with stable ownership and explicit incomplete areas. Follow the detailed brief's deterministic H3 res-5 shard ownership and overlap context. Extract boundaries are not country borders; preserve crossing geometry and give every identity one owner.

Retain the geographic context margin needed for path/exclusion safety. The owner's "no buffer" decision refers to money reserved for future cities, not geographic processing margins.

Make stages resumable with input hashes, checkpoints, bounded memory and rate limits. Use isolated output directories. Return hardware, disk, elapsed time and peak memory from the pilot before scaling. Measure the daily world adapter/bundles as a separate workload; a POI database benchmark does not establish daily-world capacity. Any 64 GB RAM/1 TB SSD estimate is only a planning starting point.

## 5. Deliverables

1. `manifest.json`: source checkpoint/package hash, input versions/hashes, rule versions, countries, shards, counts, sizes and build status.
2. `poi-<version>.sqlite` and the existing compatible POI manifest.
3. `shards.json`, ownership mapping and explicit incomplete region reasons.
4. Normalized geometry inputs and candidate CityPacks, with indexes/hashes.
5. Separate Atlas/context export preserving source URLs, licenses and text-reuse status.
6. `qa/`: release validation, matched Czech comparison, per-region coverage, rejection reasons and boundary/geometry checks.
7. `ATTRIBUTION.md`, `SHA256SUMS` and exact reproduction commands.

Exclude player data, location histories, credentials and production configuration. Supply immutable versioned files; the QuestLayer integration team handles activation.

## 6. Delivery order and acceptance

First deliver an inventory, Czechia conformance build and one foreign-region pilot. For matched source snapshots require the existing brief's ±2% place/quest-ready count tolerance, at least 95% reference IDs, zero reference review/excluded records promoted to ok, passing release validation and byte-identical rebuilds. Test shard edges, duplicate IDs, polygon holes, restricted grounds and missing paths.

When source snapshots differ or references are unavailable, report comparison unavailable and list the exact missing inputs. Do not claim conformance from an unrelated snapshot.

After the pilot passes, process the complete global shard inventory and deliver incremental validated releases. Cover large cities, smaller towns and rural areas on all six inhabited continents; list incomplete regions honestly. Delivery is complete only when QuestLayer can reproduce, validate and consume the files without another scrape or guessed fields.


## 7. Direct handoff to the implemented game worker

In addition to the unchanged POI database, deliver `catalog.json` using `questlayer.geography-catalog/1` from `docs/GLOBAL-WORLD-PREPARATION.md`. Every complete region must supply the three normalized osmium sequences under `inputs.pois`, `inputs.paths`, `inputs.exclusions` with relative `file` and exact `sha256`, source date/countries and core/context bounds. Preserve flat osmium tags and `@type`/`@id`; no new POI database schema is needed. Include empty companion files when they are genuinely complete and empty. Never use an empty file to mask unavailable paths or exclusions.

The live adapter already builds Atlas visits and category hunts, imports a complete UTC day and uses existing GPS completion. Supply OSM geometry first; context-only Atlas exports cannot replace public-path and exclusion evidence. Mark all known opening hours and conditional access: the first all-day adapter rejects those records pending a window-aware gameplay adapter. It preserves raw multipolygon holes and rejects unresolved geometry.

Acceptance now includes `node scripts/build-global-activities.mjs --catalog <catalog> --out <isolated-days> --day <UTC-date>` and inspecting its `selection/<day>/selection-report.json`, `<day>/status.json` and `<day>/manifest.json`. Confirm geography, stable ownership and explicit shortfalls. Do not set funding/stock activation flags. For the local six-country HTTP/browser test the integration team uses `scripts/e2e-global-activities.mjs`; larger releases still need their separate target-volume benchmark.

## Owner launch selection, 7 November 2026

The initial active footprint is now European and US extracts plus national-capital surroundings elsewhere, excluding Russia, North Korea and Iran. Preserve all previous downloads. Use the exact hash-bound `questlayer.launch-scope/1` policy generated from the pinned official extract inventory and GeoNames cities15000 archive. Do not replace this with guessed city coordinates or a country-name filter: joint extracts can cover additional countries. Default selection uses res-5 owner centers within 25 km of each national capital and complete mapped res-7 sections per selected owner. Keep geometry context margins; no future-city reserve refers to money, not clipped safety data.

The bulk worker reads `launch-scope.json` before choosing downloads. The full-source content collector consumes the same policy. It continues deterministically without LLM calls and checks compiled regions in the actual isolated game before acceptance. It reports missing source context, unmapped capitals and both selected-scope and whole-inventory completeness. A passed pilot is not permission to mark the launch footprint fully covered or funded.

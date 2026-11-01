# Map backend: five-task continuation

1 November 2026. Source continuation of `e94be6c` on `claude/upbeat-gauss-5czir7`, handed off through GitHub at the owner's request. The owner's scope is map data, zones, worker and operator/backend tools. Claude's UI, product direction, contracts, relayer and financial policy are preserved. No deployment or milestone pass is implied.

## 1. Resilient street data

`server/spatial/map-data.mjs` queries fixed resolution-7 H3 bounds, not a first visitor's precise location. It coalesces concurrent requests, bounds response size/time, filters restricted paths and stores successful or retryable results in the existing `geo_cache`. Legacy array caches remain readable. Fresh snapshots last seven days; a failed refresh may use explicitly stale data for up to fourteen days from observation. Failures back off from five seconds to five minutes.

An unsupported-city world can exist with `coverage: unavailable`, no coins and no reward reservation. Its first usable snapshot materializes at most 350 in-cell street coins once, under the existing demo bucket balance. Later reads never replenish already materialized supply. The regular world worker retries deferred street worlds in bounded batches; it does not need another player request. An expired allocation cannot be revived by a late response. This does not establish physical safety or implement a global multi-city native funding policy.

## 2. Pedestrian graph and configured-pack validation

The new importer accepts bounded OSM node/way JSON and writes a separate versioned, hashed graph. Connections use original node IDs; geometric crossings do not connect a bridge to the road below. Restricted/conditional access, blocked gates, exclusion polygons and explicit foot one-way rules are handled conservatively. The router uses mapped segment lengths and bounded snapping; uncertain overlapping snaps require a path reference. Distances remain estimates from map data, not field-certified walking directions.

```sh
node scripts/import-pedestrian-graph.mjs --input nodes-and-ways.json --output NEW-graph.json --city plzen
npm run world:preview -- 2026-11-02 --pack draft-city-pack.json
```

A draft CityPack supplies `pedestrianGraph`, optional exclusion polygons and an explicit candidate `entry` (or first `entries` value), with a mapped point and preferably `pathId`. Existing target path references are preserved. Configured graph packs reject unreachable objectives or disconnected transfers between selected zones, and their GeoJSON preview includes entry/route metadata. `--pack` is preview-only; it cannot activate a city through `--once`.

The existing Plzeň snapshot has geometry-only paths, without the original node topology and reviewed entries needed to establish these routes. It remains enabled unchanged, with routing explicitly unverified. A live bounded source-fetch attempt timed out; no replacement snapshot or guessed graph was adopted. The graph integration is implemented and exercised on labelled synthetic node/way fixtures. Adopting a complete reviewed Plzeň topology and checking physical access remain data/field gates.

Sources for the format/policy boundary: [Overpass geometries](https://dev.overpass-api.de/overpass-doc/en/full_data/osm_types.html), [OSM node references](https://wiki.openstreetmap.org/wiki/OSM_XML), [OSM access semantics](https://wiki.openstreetmap.org/wiki/Access). The implementation intentionally rejects ambiguous restrictions rather than certifying access from missing tags.

## 3. Operator place closures

`scripts/place-operator.mjs` supports read-only `audit` and explicit `close`/`reopen` mutations. It requires an existing `--database`; mutation additionally requires a bounded `--input` file and `--apply`. It never loads `.env`, player/service keys or an implicit database. There is no HTTP mutation route.

```sh
node scripts/place-operator.mjs audit --database /explicit/path/to/database.sqlite
node scripts/place-operator.mjs close --database /explicit/path/to/database.sqlite --input operation.json --apply
```

Operation input has exactly `actor`, `operationId`, `candidateId`, `action`, `reason`, and `expectedVersion`. The trusted operator service is default-denied outside the CLI. Version checks prevent conflicting updates and an operation ID returns its original receipt on retry. Reopening uses a new operation ID, action `reopen`, and the current version.

The lazy optional schema module is `system-place-safety@1`; core tables are unchanged. Closures bind the stable city/candidate identity and retain geometry, reason and audit history. They exclude future candidates/routes/coins and fence new demo/native visits. Existing manifests are not rewritten or repriced. Accepted native outbox receipts still settle, and existing demo/native result replays remain accessible. Map read models expose `placeStatus`; private operator reasons/actors are not exposed through those public map fields.

## 4. Compatible viewport reads

The existing routes accept optional pagination; the existing UI request shape still returns its original full map content.

- `GET /api/world?id=WORLD&bbox=west,south,east,north&limit=256&cursor=CURSOR`
- `POST /api/world` retains `location`/`arena`, with optional `bounds`, `limit`, `cursor`.

Viewport/page reads preserve one world and shared coin IDs. `cityZoneCount` stays citywide, `visibleZoneCount` counts returned zone footprints and `openEligibleCount` counts citywide zones with a currently open, unfinished, tier-eligible activity. An empty viewport does not erase citywide availability. Page limits are 1–1000. Cursors bind the world and viewport; `page.nextCursor` follows stable coin IDs even when another player collects one between reads. Closed-area coins are omitted; a filtered page can be short while still having a continuation cursor. Antimeridian-wrapping bounds are explicitly rejected in this initial interface.

No frontend was changed to start requesting pages. This delivery provides the compatible server interface; it makes no claim of measured mobile payload/performance improvement before the client adopts it. PostgreSQL/PostGIS, production-scale query indexing and multi-host concurrency remain separate work.

## 5. Repeatable multi-day integration pilot

```sh
npm run world:pilot
npm run world:pilot -- --output NEW-report.json
```

The pilot always creates and removes its own temporary SQLite databases. Across three local dates (24/25/24 hours, including the autumn clock change), it combines preparation-lease takeover, map-data outage/recovery, shared coin competition, durable chest result/equipment, closure/reopen, native checkpoint admission, lost post-commit reply, consistent SQLite backup/reopen, receipt reconciliation and same-bucket expiry. It checks exact-once grants and demo/native ledger conservation throughout.

Native RPC/transport is a labelled test double with ephemeral in-memory QA signing keys. The pilot is service integration evidence, not deployed-contract, yield, custody, physical-GPS or device verification.

## Verification and Claude handoff

`npm ci` with Node 24 and `npm run check` pass: **566/566** application tests plus the TypeScript/Vite build. Existing 365-date geometry, native receipt, schema/restore and isolated HTTP tests also pass. The HTTP suite exercises real viewport/page requests and rejects invalid bounds before world activation. [Evidence](../output/qa/2026-11-map-backend/README.md).

Reuse the five delivered modules/tools; do not rebuild them from the earlier gap list. Next independent work is reviewed Plzeň topology/entries and field checks, frontend adoption of optional read-model fields if desired, and Claude's separate contract/funding/release lane. The [brief Claude handoff](CLAUDE-WORKER-HANDOFF-2026-11-01.md) gives the ordered Plzeň routing checklist. Keep publication's six-slot contract boundary, existing funded intents and received-liquidity rules intact. This batch is a source handoff on the existing branch; no release, signing-service setup or deployment was performed.

# Global daily world preparation

Status: **automatic geographic selection and opt-in live GPS gameplay implemented for supplied regions**. Atlas visits and three-stop hunts use the existing XP, GPS and durable-receipt rules. An exact-NEAR financial adapter and UTC reservation contracts are implemented and locally tested, but require reviewed testnet upgrades and explicit confirmed activation. Item stock and full geographic coverage remain release dependencies. The content compiler itself has no network, database, account, secret, deployment or signing dependency.

The approved direction is global testnet play, one UTC accounting day, all content decided before that day opens, and fixed NEAR entitlements funded from actually received available money. A player's arrival must only read a previously prepared day. Plzen retains six shared city slots; other ownership areas use one to three slots selected upstream from the existing density policy and usable geography. No funding reserve for future cities is introduced.

## Delivered boundary

`scripts/build-global-activities.mjs` now selects safe polygons and quests from immutable OSM extracts or the existing osmium GeoJSON sequences, then calls the lower-level `scripts/prepare-global-world.mjs` compiler. `server/global-activities.mjs` imports the complete day into the existing game before reads are allowed. Supplying every intended region is still required; the six-country real-data pilot is partial coverage, not a worldwide catalog.

Implemented:

- Snapshot binding to the UTC date, source checkpoint, geographic/rules/closures/activity/edition versions and SHA-256 hashes.
- Exact expected region inventory, explicit incomplete regions and honest geographic shortfalls.
- Resumable, single-host preparation with exclusive process locking, atomic files and immutable content-addressed geometry/public/server bundles. Retries revalidate all frozen inputs; they reuse identical output bytes rather than trusting a checkpoint. This is not a distributed worker queue.
- Canonical object identity independent of player, request order, timezone and loading shard. Duplicate identities are audited across regions using bounded disk buckets.
- H3 ownership compatible with the POI builder: `cellToParent(latLngToCell(label.lat, label.lng, 7), 5)`. Label and check-in target remain separate. Independent res-5 lookup is **not** equivalent at some edges.
- Polygon validity, closed rings, holes, entries, child targets, slot limits and cross-region/country intersection and boundary-gap checks. No fabricated polygons or additional sets when a neighboring cell loads.
- UTC identity with local wall-clock windows, including skipped/repeated DST minutes and fractional-hour timezones. A child cannot open outside its zone. Windows are clipped to the accounting day.
- Gzip regional content, geometry references, actual counts by object kind, counts with nonempty opening windows, private edition demands and server-only completion requirements.
- Official `system:atlas` quest attribution and a deterministic, original place-visit instruction helper. No model/network is required, no cache descriptions or historical facts are invented.
- A read-only, checksum-verifying public-content reader. It cannot load a server bundle through a public reference and cannot create content or authorize claims.
- Explicit `activation.permitted: false` on every sealed preparation. No amount, guaranteed item, reservation receipt or funded status is invented.

Not delivered: money allocations/reservations, earned dust accounting, inventory reservation, coins/NPCs/chests in the new adapter, chain settlement, worldwide data collection, production activation, target-scale acceptance or physical device/field verification. Existing Plzen and arena paths are deliberately preserved. Global mode is explicit and disabled without its data-directory configuration.

## Running the offline compiler

Use Node 24+ and the repository's unchanged dependency lock:

```sh
npm ci
node scripts/prepare-global-world.mjs --snapshot /path/to/input/snapshot.json --out /path/to/isolated/day-output --day 2026-11-07
node --test tests/world-preparation.test.mjs
npm run check
```

All CLI arguments are required. There are no production/default directories, database reads, environment files or automatic activation. Exit 0 means **content-prepared only**; exit 2 means incomplete; exit 1 means the job could not start or seal. A complete zero-object region is legal when it states a geographic shortfall. A missing region is never silently omitted.

The complete synthetic six-continent input builder is `tests/fixtures/world-preparation/world.mjs` (`writeFixture`). Its coordinates, path references and source URLs are fixtures, not harvested data or access approvals. Do not feed these files to physical gameplay.

## Input contract

The actual authority is `server/world-preparation/schema.mjs`, tested by `tests/world-preparation.test.mjs`. Unknown fields are rejected. Existing `questlayer.poi/1` remains unchanged; this is a downstream content preparation contract, **not a replacement POI schema**.

Top level `questlayer.world-snapshot/1`:

| Field | Meaning |
| --- | --- |
| `sourceCommit` | Exact 40-character source checkpoint supplied with the job |
| `versions` | Required `geography`, `rules`, `closures`, `activity`, `editions`; each has `version` and `sha256` |
| `zoneGapM` | Boundary gap from the frozen geographic policy; never silently reduced |
| `areas` | Unique ownership areas `{id, requestedZones, shortfallReason?}` |
| `regions` | Entire expected res-5 inventory: `{id, status, file?, sha256?, reason?}` |

An area is `city:plzen` with six slots, or `cell:<res7>` with one to three. The upstream adapter must determine the existing density policy's requested count; the compiler checks capacity rather than replacing that policy. It must supply an explicit reason if fewer slots can be prepared. This is not a license to call a one-slot Plzen day a passed six-zone milestone.

A completed region has a relative `.json` input path and the SHA-256 of its exact bytes. An incomplete region has a reason. Symlinks/relative paths cannot escape the supplied input directory. Do not put credentials, player data or production configuration in it.

Region `questlayer.world-region-input/1`:

- `id`: owner res-5 cell; `countries`: distinct ISO codes for coverage, not administrative geometry ownership.
- `coverage`: `{status: "complete"}` or `{status: "shortfall", reason: "..."}`.
- `objects`: the final selected objects for this epoch, not a pool to choose from on request.

Each object requires:

| Field | Meaning |
| --- | --- |
| `key`, `kind` | Stable physical/gameplay identity; kind is zone, quest, coin, npc, chest or item |
| `label`, `target` | Distinct `{lat,lng}` values; owner uses label's res-7 parent |
| `timezone`, `localWindows` | IANA timezone and recurring half-open wall-clock minute intervals, e.g. `[[420,1320]]`; all-day is `[[0,1440]]`; split overnight windows |
| `title`, `instructions` | Frozen public text; sourced/approved before compilation |
| `source` | `{id, url, license, sha256}` with original provenance |
| `fieldReview` | `unverified` or `reviewed`, preserved from authorized input |
| `pathRef` | Existing mapped public path identity; a string alone is not proof of access |
| `serverRequirements` | Nonempty private completion requirements, never merged into public data |

Zones additionally need `areaId`, zero-based `slot`, one connected GeoJSON `Polygon` with all hole rings, and interior `entries`. Non-zone objects may carry `zoneKey`; that zone must be in the same input region and contain the check-in target. Cross-owner child relationships need upstream normalization or a future explicit relation adapter; the compiler rejects them instead of rewriting ownership.

An item or chest additionally carries `editionRef` (a concrete edition reference or explicit `null`). Every emitted item/chest is a distinct potential inventory demand; do not emit both a chest's content and that same content as a separate loose item. The compiler reports the selection privately and shows `not-reserved` publicly. It neither asserts supply nor grants an item. The owner must reconcile inventory demand before the runtime can promise anything.

`serverRequirements` are opaque stored data, not executable instructions and not proof of enforceability. The runtime adapter must validate supported templates and authoritative evidence rules. The source adapter must apply current exclusions, path restrictions, closures and licensing checks. Polygon validation here does not replace the existing POI safety filter, graph reachability or field review.

## Output and recovery

- `snapshot.json`: immutable binding, including compiler source hash, dependency-lock hash, Node/ICU/timezone-data/zlib versions. Toolchain changes require a new output directory.
- `status.json`: current per-region preparation state/reason and overall completeness. A failed or interrupted build never creates a new sealed manifest.
- `public/regions/<sha>.json.gz`: allowlisted public content; no correct answers, private requirements, planned edition references or money amounts.
- `public/geometry/<sha>.json`: shared complete geometry.
- `server/regions/<sha>.json.gz`: object IDs, path references, completion requirements and planned editions; **never serve this directory**.
- `manifest.json`: immutable content-preparation manifest, region hashes, counts, versions, coverage and activation blockers. It references server artifacts and is an integration artifact, not a public activated-day manifest.

Only this supplied region inventory is considered by completeness. It cannot prove that the inventory itself covers the planet. `counts` counts prepared objects; `openCounts` counts those with nonempty windows in this UTC day. Neither is an economic weight or financial entitlement. The finance adapter must verify eligible objects, actual frozen pioneer/zone weights and obligations against the exact content hash.

An interrupted process can be retried with the same arguments. The output lock is never stolen from a live PID or another host. A dead local PID is recoverable; a crash during the tiny recovery-lock section may require an operator to inspect/remove the stale `.prepare.lock.recovery` file after establishing that no worker runs. There is no force-unlock command. Orphan temporary/audit files after hard process termination are not publication artifacts; retain or clean only within the isolated job directory. Do not reuse directories for changed inputs or another day.

An already sealed candidate stays immutable even if subsequent verification finds corrupted files; `status.json` becomes incomplete and the content reader rejects corrupt chunks. No reader may equate the existence of `manifest.json` with permission to activate. The protected integration must verify all referenced artifacts and reservations immediately before its own atomic activation step.

## Limits and remaining acceptance

The worker holds one region plus a global zone bounding index in memory, not every world coin. Object duplicate auditing spills to 256 disk buckets. Input, output decompression and audit files are bounded to 64 MiB; a region is bounded to 250,000 objects; geometry's index footprint is bounded. These are engineering bounds, not economy tuning. Very large root inventories may need a hierarchical manifest adapter before reaching these bounds. No world-scale capacity claim has been made.

Polygons crossing the longitude discontinuity must be normalized upstream; a disconnected MultiPolygon is not accepted as one zone. Geometry near the poles and huge polygons can exceed spatial-index bounds and produce an explicit failure. All-day UTC remains 24 hours; local schedules can produce zero, one or several intervals. Durable accepted quests and timely evidence across epoch boundaries still need the runtime/owner integration.

Required next gates: matched-snapshot Czech conformance, full global city/town/rural coverage, target-volume/time/disk/RSS measurement, full path-graph/access verification, coins/NPC/stock adapters, financial and inventory reservation, payout/dust invariants, accepted-quest rollover and physical iOS/Android field tests. Six bounded real OSM extracts and local simulated-GPS journeys are recorded in `output/qa/global-world-live/`; they do not satisfy those release gates.



## Geographic selection and live game integration

Run a frozen catalog manually:

```sh
node scripts/build-global-activities.mjs --catalog /path/to/catalog.json --out /path/to/isolated/days --day 2026-11-07
```

For a local test server, set `GLOBAL_ACTIVITY_DAYS_DIR` to that days directory. Optionally set `GLOBAL_ACTIVITY_CATALOG` to the catalog: a separate child process prepares today and tomorrow at startup and on a one-minute timer, then the loader imports completed days. Heavy source processing runs outside the HTTP process. These are explicit opt-ins, with no default production paths. The loader runs when configured even if ordinary background workers are disabled for local tests. No map/API fetch occurs in the player request path. The collector is a separate, bounded pilot tool; do not use public Overpass to seed the planet.

`GET /api/health` exposes `globalActivities`: imported days, expected/loaded region counts, per-day financial activation and reward-worker status. Financial activation defaults to `false` and only a separately confirmed exact reservation changes it; the top-level flag describes today's UTC day. An unavailable or incomplete day returns `GLOBAL_COVERAGE_UNAVAILABLE`; partial imports cannot be viewed or claimed even with a known quest ID. Per-region transactions are resumable; quest openings move from a closed sentinel to the UTC start atomically with the whole-day ready marker. A published date cannot be replaced by a different manifest. New source data applies to the next unbuilt date.

The live loader yields to the HTTP event loop between region transactions and can be stopped at those boundaries. An interrupted import keeps its completed transactions closed until the same manifest finishes; resumption preserves object identities and receipts. This bounds uninterrupted work to one region, not a verified latency budget for a whole-planet import. The synchronous importer is retained for isolated tools. Worker status includes a separate entry for each attempted date, import progress, and `awaiting-content` when a manifest has not been supplied. One failed date does not prevent preparing the next. Failed attempts back off from one minute to one hour; they never publish partial content to escape a failure.

The existing `/api/world`, `/api/quests/claim` and `/api/quests/checkpoint` routes serve these imported worlds. Atlas visits use existing visit XP; category hunts use existing hunt XP. No treasury balance, economy value, money policy, item minting rule or protected financial code changes. At a target across a shard edge, a small indexed lookup resolves the original owning world; it does not duplicate the activity. Map-area searches read prepared regions. Operator POI closures still prevent completion after import.

Plzen's reviewed area and the demo arena continue through their existing runtime. Other GPS locations use the prepared catalog when global mode is configured. This is a staged gameplay integration, not a claim that Plzen financial planning has been converted to the global UTC model. A global day here contains only zones and quests; generic compiler manifests with coins/NPCs/chests/items are rejected by this gameplay adapter. The compiler's `activation.permitted: false` continues to mean that no funded/stocked day is authorized. The separate database ready marker permits the explicitly nonmonetary gameplay subset only.

### Geography catalog contract

`questlayer.geography-catalog/1` requires `sourceCommit` (exact 40-hex checkpoint), `version`, frozen `closures` and `recentPoiIds` arrays, and `regions` (unique res-5 owners). Each complete descriptor includes:

- `id`, `status: "complete"`, `countries`, `sourceDate` (ISO timestamp).
- `coreBounds` and `contextBounds`, each `[west,south,east,north]`, with a minimum 1 km context margin. Bounds cannot wrap the date line or exceed 85 degrees latitude; normalize/split such extracts upstream.
- Either `file` and `sha256` for an Overpass JSON response or normalized FeatureCollection, or `inputs: {pois, paths, exclusions}`, each `{file, sha256}`, for the existing osmium GeoJSON sequences (optional record separators supported). All three companion sequences are mandatory. Paths are relative and hash checked. Every file is bounded to 64 MiB; partition oversized inputs upstream.
- Optional `coverageReason`, required in practice for partial pilot extracts. Incomplete descriptors use `status: "incomplete"` and an explicit `reason`.

Flat osmium properties (`@type`, `@id`, original tags) and FeatureCollections with `id: "osm:w…"` and `properties.tags` are supported. Original raw files/topology remain immutable. Input sequences retain their separate roles when a way appears as both POI and path. This adapter accepts OSM identities; Wikidata/Overture-only records remain contextual inputs until their own verified adapters exist.

Selection applies the existing POI classifier, public-path filter, 40 m snapping, restricted-ground rules and frozen closures. Index processing is clipped to the context bounds, while original source geometries are retained. Split multipolygon members are assembled with their holes; invalid public candidates are rejected. A malformed exclusion may conservatively fill holes only when its complete valid outer shells are available; missing outer geometry fails the region. Complex relations above the bounded validator's 4,096-point limit need upstream preprocessing. The report preserves each decision.

Only named places are selected: missing names are reported rather than repeated as generic discoveries. Valid connected park/garden/plaza polygons wholly inside the core are candidates for zones. Polygons touching exclusions/closures, missing interior public targets or violating the existing spacing are rejected. No synthetic circles are substituted for missing polygons. A cell requests one to three slots using existing density thresholds, and actual geometry shortfalls are recorded. Extra discoveries are mapped points or three-stop hunts selected by the existing POI planner. No physical route is inferred between stops.

This first activity adapter supports continuous all-day visits/hunts only. POIs and paths with non-24/7 opening hours or conditional access are omitted with reasons, not silently opened all day. General compiler local-window/DST support remains available for a future gameplay-window adapter. Unknown access is field-unverified; known-safe tagging and map-derived snapping do not certify a walking route or remove the player's need to follow local signs.

### Local verification

```sh
node --test tests/global-activities.test.mjs tests/world-preparation.test.mjs
npm run build
node scripts/e2e-global-activities.mjs --days /path/to/prepared-days --out /path/to/qa
```

The browser journey uses a throwaway local database and simulated GPS, checks actual HTTP claims/retries for six countries, and captures the reused player interface. Its prepared directory must contain today's UTC day. It neither reads production state nor deploys anything.

## Autonomous playable-region collector

`node scripts/continue-playable-world.mjs /absolute/isolated-config.json` performs one resumable background step. Its explicit configuration contains `acquisitionDir`, `workDir`, `daysDir`, the exact `sourceCommit`, and optional `minimumRegions` / `nextDayMinuteUTC` (default 23:30 UTC). No production directory, key or model is inferred. `acquisitionDir` supplies the frozen Geofabrik `index-v1.json`, verified receipt queue and original PBF files. The scoped Agent Zero supervisor schedules steps independently of any AI chat.

The stages are receipt/hash verification, repository-compatible osmium extraction, geographic planning, bounded export, day compilation, isolated runtime acceptance, and atomic publication into `daysDir`. The running game consumes that directory through its existing `GLOBAL_ACTIVITY_DAYS_DIR` loader. Configuring or deploying the production game remains separate owner work; generating files does not change its configuration.

Each accepted owner starts with one bounded mapped core near actual named park/garden candidates. Core selection is deterministic and independent of players. The entire 1.1 km context must fit inside the original extract geometry; edges needing another source are reported and withheld. This is partial owner coverage, not a country or planet completion claim. Country attribution follows the official source hierarchy; unresolved attribution fails explicitly. A repeated owner from another source reuses the existing identity rather than gaining another set of zones.

The exporter imports the repository's actual label and owner functions. It scans all three original geometry roles completely, failing malformed input even outside the chosen core. It selects complete geometries by intersection with a fixed context, so a path/exclusion whose label belongs elsewhere is still retained. A genuinely empty companion is emitted only after its complete audited scan. Each feature is bounded to 4 MiB and each selected role to 16 MiB for normalization. Oversized regions require upstream subdivision; no record is silently discarded to fit.

An osmium single-component `MultiPolygon` becomes `Polygon` with every inner ring preserved. Disconnected components remain `MultiPolygon` and cannot become one system zone. Within one role, duplicate OSM identities merge only for an equal-tag closed-line/single-ring-area pair with exactly the same cyclic boundary (rotation/reversal allowed). Conflicts, open paths, missing holes or additional components fail. Source inputs are retained unchanged.

Before accepting a region, the collector imports its compiled day into an in-memory instance of the actual game, checks real polygons and linked objectives, rejects distant simulated GPS, confirms a visit and its repeated receipt, and checks that the treasury is unchanged. This is runtime compatibility evidence, not a financial reservation or field/device verification. Regions with quests but no valid polygons retain their zone shortfalls; the aggregate publication requires at least one real zone.

Publication freezes a complete supplied catalog and prepares its day in a staging directory. Only after runtime validation is the whole day directory renamed atomically into `daysDir`. A published day is never extended or replaced when another region finishes. New accepted sources join the next unpublished preparation, with tomorrow's accounting day prepared from 23:30 UTC. Failed region steps back off and do not starve other sources; three failed attempts retain the rejection and continue to the next candidate. Input checkpoints, source receipts, exports, region acceptances and day status remain available under the isolated worker directory.

The Agent Zero wrapper checks disk and memory before/during work, reserves 8 GiB free disk, limits one Node worker to a 512 MiB heap, lowers its priority and stops only that worker's process group if resource floors or its 20-minute time slice are reached. Raw sources and failed outputs are preserved. No acquisition or gameplay process is killed by a name-wide rule, and there are no recurring model calls. Disk capacity, omitted edge owners, failed exports and actual region/zone counts remain visible limitations.

## Selected launch footprint and storage (7 November 2026)

The owner narrowed the initial release to Europe and the USA, plus national-capital surroundings elsewhere, excluding RU/KP/IR. This is a selected global launch footprint, not full planet coverage. Existing source files are preserved, including sources outside this selection. No financial reserve for future cities is created.

`prepare-launch-scope.mjs` binds the immutable official extract inventory and the original GeoNames `cities15000.zip` SHA-256. It selects national capitals (PPLC), preserves real coordinates, names and IANA timezones, and attributes GeoNames under CC-BY-4.0. The initial geographic choice is a 25 km radius measured to canonical res-5 owner centers, with complete mapped res-7 sections inside each selected owner. This is an explicit geographic launch tuning value, not an economy change or a verified walking radius. Extracts intersecting an additional context margin supply entire original geometries; neighboring context is never clipped away to save money or disk.

Both acquisition and content planning consume the same hash-checked policy. Extract geometry, rather than country labels alone, handles combined sources such as Malaysia/Singapore/Brunei. Missing capitals, unavailable or oversized source files and incomplete boundary context remain reported. A selected-scope completion cannot set the whole-planet-ready flag. `requireSelectedScopeCoverage` blocks a release until that exact scope is complete; `requireGlobalCoverage` remains a separate full-source-inventory gate. Full-scale production activation is not established by a two-region pilot.

Storage planning, **not a measured guarantee**: request 250 GB usable SSD for this footprint; 500 GB provides safer build/retry headroom. A retained planet source and processing workspace should provision roughly 1 TB. The present VPS has approximately 31 GiB free, and the collector retains an 8 GiB free-space floor. The worker must pause rather than fill a shared disk. Prefer smaller official extracts, compressed spatial tiles and shared content hashes. Never discard private grounds, polygon holes, path restrictions or existing downloads to achieve a disk target. A smaller city-only release would need a separately versioned selection and measured pilot; it cannot silently stand in for the agreed European/US coverage.

The full-source exporter audits missing OSM multipolygon members before strict osmium export. It may quarantine only unusable, unrestricted candidate relations, retaining IDs, tags and rejection reasons; any relation matching the existing safety-ground rules or review reasons fails closed. Original PBFs remain untouched. Every role audit is checksum-bound into the extraction receipt and spatial-index provenance. Malformed remaining geometry still fails `--stop-on-error`. Source versions are reconciled across POI, path and exclusion roles so a newer private restriction cannot be erased by an older public POI copy.

## EU-first collection phase (owner update, 7 November 2026)

The active collection phase is now restricted to the 27 EU member states. Build its hash-bound policy with `prepare-launch-scope.mjs ... --eu-only`. Membership is a versioned ISO allowlist checked against the official EU country list; Cyprus is selected even though Geofabrik groups it under Asia. UK, Norway, Switzerland, USA and other non-EU sources are not scheduled. Existing global downloads, checkpoints and pilot outputs remain preserved. Combined extracts and overlapping borders are source data, not authoritative administrative boundaries.

The same EU policy controls future bulk acquisition and the preparation of zones/Atlas quests. Czechia and small EU sources with useful neighboring context are prioritized. The worker continues autonomously within that scope and pauses when its resource floor is reached. There is no automatic switch to US/capital/global collection after EU completion; widening the scope requires another owner decision.

EU processing uses a separate work state and daily-output directory so an older non-EU pilot cannot be relabeled as EU coverage. Reuse only verified eligible source indexes from the earlier work directory. Report missing EU countries, missing neighboring geometry, source failures and incomplete owners. EU-only mode never asserts full-planet readiness and does not activate financial rewards.


### Completing days while acquisition waits

The collector CLI accepts `--prepare-only`. It retains the same scope, source
context, safety checks, immutable snapshot, complete-day compiler and isolated
runtime acceptance, while skipping source extraction/planning/export attempts.
It does not increment those attempts or scheduling turns. An interrupted daily
build resumes its already frozen catalog, rather than accepting different inputs.

The Agent Zero supervisor gives publication priority from 23:00 UTC. Heavy work
requires 9 GiB free; publication-only work starts with 128 MiB above the unchanged
8 GiB service floor. A publication slice has up to 55 minutes; heavy slices retain
their 20-minute bound. Both preserve memory/process gates and explicit waiting
states. No money, item supply or whole-EU readiness follows from this mode.

Verified indexed plaintext intermediates may be retained losslessly as
`*.retained.gz` with `*.retention.json`. The retention helper checks the original, sealed
index references, complete decompression and archive hash before releasing
plaintext. Gameplay index reads retain their independent chunk-hash checks.
Existing index-driven planning/export does not reopen whole-country originals.
An intentional re-extraction first restores those originals from their verified
receipts. Raw PBFs, complete selected geometry, audit evidence and prior published
days remain intact. This is storage maintenance, not a change to public access or
safety classification.

## Czechia fallback

Everywhere on Earth, `/api/world` falls back to the normal street world (POI quests, landmark clues, NPC errand targets, coins) whenever no ready prepared region covers the spot, for example after the daily manifest was not supplied (Lubos, 11 Nov 2026: open the whole world). Outside Czechia the street world takes its places live from OpenStreetMap (`server/poi/live-source.mjs`). `GLOBAL_STREET_FALLBACK=czechia` limits the fallback to Czechia and `GLOBAL_STREET_FALLBACK=off` (or the older `GLOBAL_CZECHIA_FALLBACK=off`) restores the strict behaviour. Test: `tests/global-czechia-fallback.test.mjs`.

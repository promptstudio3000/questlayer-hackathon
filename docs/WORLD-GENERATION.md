# City zones and daily world generation

Updated 31 October 2026. This specification replaces the earlier per-cell zone-count target for the next implementation. Plzeň has **six shared system-zone slots across the city**, with different footprints, no overlap and meaningful travel between them. H3 partitions transport and caching; crossing a cell boundary does not create another set of zones.

The deployed alpha still uses the small square-based arena and circular footprints. The geometry, city distribution and worker described here are implementation requirements, not deployed behavior.

## Current problem and owning code

| Source finding | Required behavior | Owner |
| --- | --- | --- |
| `arenaPaths` covers the central square and short adjacent segments. | Use a reviewed city content pack for Plzeň; keep a separate compact tutorial arena. | `server/world.mjs` |
| Anchors are sampled independently, with replacement. | Select a set of candidates together, enforcing spacing, district coverage and access constraints. | `ensureWorld` and replacement generation service |
| Zones have a center and radius; the renderer constructs circular polygons. | Persist real polygon geometry and render that geometry directly. | `src/types.ts`, `src/GameMap.tsx` |
| Each live H3 cell receives six zones. | Resolve one city/day manifest and query its contents through tiles or a viewport. | World identity and API |
| Each zone has one visit/chest target at its anchor. | Author multiple distinct objectives inside a zone; a stationary fix cannot complete a whole local expedition. | Quest templates and validation |
| Initial reward sizes are fixed demonstration amounts. | Reserve a city allocation before publishing prizes; avoid funding a new world from whatever is left first. | Treasury and generation worker |

Changing radius or increasing the map zoom cannot satisfy these requirements.

## World identity and spatial ownership

Use a stable `worldId = mode / cityId / localDate / generationVersion`. A reviewed city polygon and IANA timezone determine the daily instance. `mode` separates arena, physical testnet and mainnet. A player's position, first login or wallet must not affect the seed or generation area.

Persist a CityPack with its boundary, coverage sectors, public pedestrian graph, approved candidate areas, exclusion areas, source versions and review date. H3 remains useful for spatial lookup, map chunks and coin deduplication. Every chunk points to its parent city world; it cannot allocate additional city-zone slots.

Outside supported cities, use separately configured trail/region packs with their own density and access policy. Do not silently generate six zones per new visitor's cell. Return truthful limited coverage when a location has no reviewed pack. City, neighboring-city and trail-pack ownership must have a deterministic precedence so one location cannot produce duplicate economic allocations.

Nearby map queries may return only a viewport subset. The response distinguishes `cityZoneCount`, `visibleZoneCount`, `openEligibleCount` and the nearest eligible discovery. An empty viewport does not mean that the city has no content.

## Six slots for Plzeň

Keep six simultaneous daily system-zone footprints. Start by preserving three Free, two Tier 2 and one Tier 3 slot; evaluate that composition with the city pilot without quietly expanding the total. A slot may contain several quests and chests. Slots are locations, not team territories.

The first content pack should offer candidate pools across the following six broad sectors. These are search areas for map-data review and field checks, not certified spawn sites:

| Sector | Candidate character | Intended contribution |
| --- | --- | --- |
| Central city | Reviewed green ring, public square or accessible river-adjacent public area | One central discovery, not all six |
| Lochotín and Bolevec | Public park or reviewed path network | Northern outing |
| Doubravka | Public neighborhood green space or trail area | Eastern outing |
| Slovany | Public park, path or neighborhood discovery | Southeastern outing |
| Bory | Public park or open pedestrian area | Southwestern outing |
| Skvrňany and western city | Reviewed public green space or pedestrian network | Western outing |

Use a supported district/coverage-sector dataset rather than inferring geography from these names. Candidates must remain inside the accepted city footprint and satisfy access checks. A curated substitution can cover an unsafe/missing sector; it must still pass city spread and geometry checks. Do not place six candidates downtown to satisfy a numerical count. Publish fewer with a visible coverage reason if six valid sites cannot be found. This reduced-count fallback is resilience behavior; it does not close the Plzeň milestone until the normal content pack demonstrates six accepted sites across the reviewed city sectors.

Tier assignments rotate between suitable sectors over successive days. Do not make one neighborhood permanently free or permanently premium. One player is not expected to walk through the entire city every day. Street coins, free point activities and independent creator content support shorter local sessions without adding hidden system zones.

## Geometry and spacing policy

### Mandatory properties

- Store each zone as a valid GeoJSON Polygon with closed rings in longitude/latitude order. Hole rings represent exclusions where appropriate. Do not use a disconnected MultiPolygon to disguise several locations as one zone.
- No two system-zone footprints in one daily city manifest intersect or touch. Enforce the same active-world check against neighboring ownership areas and sponsored replacement slots.
- Every zone has a publicly reachable entry and reachable objective points on the reviewed pedestrian graph. A polygon centroid is neither an entry nor proof of access.
- Use different, geography-led shapes across the set. Rotating or stretching the same circle six times does not count as variety.
- Keep a minimum **boundary-to-boundary** separation, not merely center separation. Small marker collision avoidance is a separate rendering concern.
- A player cannot use one location fix to claim objectives in different zones. Rewardable targets also have their own disclosed proximity and evidence rules.
- Removing blocked land must not leave narrow accidental slivers, disconnected islands or an inaccessible interaction point. Reject or rebuild that candidate.

### Starting tuning values

These numbers are initial policy proposals for the Plzeň pilot, not newly accepted immutable rules. Keep them versioned and adjustable after field observation.

| Parameter | Initial proposal | Reason |
| --- | --- | --- |
| System slots | 6 citywide | Latest product decision |
| Boundary gap | At least 250 m | Makes zones distinct even with location uncertainty |
| Nearest-neighbor pedestrian travel | Prefer 1–3 km between usable entries | Creates an outing rather than six taps from one square |
| Distribution | Prefer six reviewed sectors; at least five represented | Avoid downtown concentration while allowing a safe substitution |
| Typical footprint | 0.015–0.12 km² | Leaves room for several discoveries without covering a district |
| Shape diversity | At least three shape families among six accepted sites | Spatial character rather than decorative random vertices |
| Objectives per zone | 3–6 designed choices | Meaningful choice inside a zone |
| Separate objective targets | Prefer 60 m or more along public paths | Avoid claiming the entire zone while stationary |
| Nearby street coins | Nominal 12–20 m path spacing, budget constrained | A frequent walking loop between destinations |
| Site reuse | Prefer a different footprint for 72 hours | Daily variety without a hard guarantee when candidates are limited |

The minimum boundary gap is a hard publication constraint under the active policy. Walking-distance preferences and footprint sizes are quality targets. Do not make an unreachable candidate valid by relaxing safety, overlap or funded-prize constraints. Distant city sectors may legitimately exceed the preferred travel range; show real distance and trip scope rather than promising a short walk.

### Shape families

1. **Park clearing:** an irregular polygon following reviewed public green space, with holes for water, buildings or restricted areas.
2. **Linear green belt:** a corridor along a connected public walking area on one side of a barrier. Its width must allow usable location evidence; a narrow riverside footpath is not automatically a suitable polygon.
3. **Public garden or plaza:** a compact, asymmetric footprint bounded by real edges and safe entrances.
4. **Trail pocket:** a broader connected area around several public trail junctions, after access and environmental review.

Choose the shape family because it fits the site. Seeded vertex jitter may soften an approved footprint within its permitted envelope, but cannot create geography or move an edge into private land. Simple rectangles may occasionally be geographically correct; they must not become the only template.

## Generation pipeline

1. **Prepare reviewed candidates.** Import a bounded, versioned OSM/public-data snapshot. Retain data attribution. Combine known access restrictions, water, rail, major road barriers, public crossings, opening hours and operator exclusions. Map data is an input; field review and closure reports remain necessary.
2. **Build pedestrian connectivity.** Associate candidate entries and all objective points with valid graph nodes. Reject isolated components and paths requiring a forbidden crossing. Cache route lengths; never substitute straight-line distance while labeling it walking distance.
3. **Create candidate footprints.** Clip to the allowed envelope, remove exclusions, validate topology, minimum usable areas and objective reachability. Keep a stable candidate ID, source hash and review state.
4. **Select the city set jointly.** Use seeded, bounded optimization over all candidates: first feasibility, then coverage, nearest-neighbor route distance, shape diversity, tier access, rotation and content suitability. Independent random picks are insufficient.
5. **Check neighbors.** Read the neighboring active-world geometry/version. Resolve cross-boundary conflicts through stable ownership and a publication lock. Include that neighbor version in the publication check.
6. **Assign daily content and windows.** Bind reviewed quest templates, target points, rarity limits and tier access to each zone. At least one Free opportunity should remain open during the advertised supported play period. Randomness cannot silently change already published content.
7. **Reserve funds and supply.** Claim the city/day budget once, reserve every GOLD prize and bounded item allocation, and store the policy version. Unfunded choices become honest XP content or are omitted. Do not publish a chest promising an Aura without remaining supply.
8. **Publish one immutable manifest.** Save geometry, content, schedule, funding commitments and manifest hash atomically. An outbox publishes chain commitments and notifications through retryable jobs. A partial failure cannot expose an unfunded half-world.
9. **Serve snapshots and changes.** Return a manifest version and deltas. One refresh must not reset a selected valid objective, reconstruct all markers unnecessarily or create another world.

If bounded selection fails, use a reviewed fallback set that passes the same checks. If that also fails, publish fewer zones or no cash content with a clear coverage explanation. Never fall back to overlapping circles at the player's position.

Use an appropriate local metric projection for geometry construction. Store/serve WGS84 GeoJSON. Measure distances and areas in meters/square meters rather than degrees, screen pixels or arbitrary Web Mercator offsets. PostgreSQL/PostGIS is the target spatial authority for production; an isolated geometry module can be exercised against fixtures before the storage migration.

PostGIS provides [geometry validity checks](https://postgis.net/docs/ST_IsValid.html) and [meter-based proximity checks on geography](https://postgis.net/docs/ST_DWithin.html). For a positive gap `g`, reject an intersecting pair and reject a pair with boundary distance below `g`; do not invert the `ST_DWithin` predicate. The [GeoJSON specification](https://www.rfc-editor.org/rfc/rfc7946) defines the wire format, not pedestrian accessibility.

## Daily scheduling and persistence

Prepare the next city manifest before local midnight, initially 30 minutes ahead. Persist a job ID, lease, attempt state, candidate-set version, budget reservation and output hash. Multiple workers must converge on one manifest. Test crashes after reservation, after chain submission and before publication acknowledgment.

Activation swaps the daily city pointer at local midnight, including 23/25-hour days. It does not open every zone at midnight: all-day, three-hour and one-hour windows come from the published zone schedule. Set a visible refresh rule and close old award eligibility consistently.

Expiry does not discard timely pending evidence. Backing stays reserved until those claims finish. Release only the uncommitted remainder to its original bucket, once. Creator templates, notes, bought content access, sponsored tasks and historical receipts survive system-world rollover. Expired system content never silently reopens because a worker restarts.

No first visitor can consume the entire global fund. A separate policy allocates city/day and coin-chunk budgets. Lazy coin materialization consumes an existing allocation, not new funding. Dense activity or many identities cannot multiply budgets by causing more H3 activations.

## Physical entry and objective completion

The server validates the published polygon, current opening window, authenticated player, applicable tier and evidence. The renderer consumes the same manifest geometry. Display membership, target proximity and claim authorization are different states.

Use a fresh GPS fix, sensible accuracy and short stable observations where needed. A boundary uncertainty state should ask the player to wait or move to a safe clear area, not step across a road to satisfy a mathematical edge. Apply visual hysteresis without enlarging reward eligibility into another zone. Narrow sites need stricter usable-accuracy checks or another candidate.

Each quest defines its requirement: entry, a particular landmark, ordered public checkpoints or a reviewed geocaching interaction. Photo/community tasks need a separate evidence-review policy. Entering a polygon is not an automatic completion of every quest in it. A single-player visit can earn personal XP; a shared backed GOLD prize is awarded once according to valid-receipt order. There is no player reservation and no extra arbitrary quest countdown beyond zone/content availability.

Normal travel between zones must require real-world movement. Camera clicks, map panning, modifying a coordinate in a request or choosing another city cannot establish it. Speed anomalies are review inputs; transit between distant districts must not automatically ban a player who physically visits legitimate targets. Only a specifically disclosed walking-route quest can require its complete path, and it must have a privacy-conscious validation design.

## Interaction with other content

Creator quests and map notes are content, not extra system-zone slots. They may be points or reviewed routes, can refer to a system zone, and survive the daily world reset. Their own availability, entitlement, evidence and funding apply. A free player can still fulfill an independently funded task; a nearby Tier 3 system zone must not accidentally impose its stake requirement on unrelated community content.

If area-based creator zones or sponsored replacement zones are introduced later, they join the same geometry registry and capacity policy. Do not implement them as a second overlapping colored layer that defeats the six-slot rule.

## Data and API changes

Introduce CityPack, CandidateArea, CityWorld, ZoneGeometry, ZoneSchedule, QuestTemplate, QuestInstance, BudgetAllocation, GenerationJob and EvidenceReceipt as domain responsibilities. Reuse compatible tables where practical.

A zone needs `zoneId`, `worldId`, polygon geometry, bounds, public entries, sector, shape family, tier, opening window, content IDs, source/review versions, policy version and manifest hash. Link quests by `zoneId`; coordinate equality is not a relationship. Geometry changes require a new version and a disclosed handling of already submitted claims.

Add world overview, viewport/chunk queries, objective detail, authoritative claim status and operator generation preview. Keep paid quest content and private evidence out of public manifests. Expose rejection reasons and aggregate coverage metrics without player location trails.

Migrate old worlds through an explicit version boundary. Archive or let the alpha instance expire, preserving earned items, history and outstanding obligations. Do not rewrite a live funded footprint under a walking player.

## Acceptance scenarios

| ID | Scenario and required result |
| --- | --- |
| GEO01 | Six accepted Plzeň slots occupy the reviewed city sectors; opening a new H3 chunk or logging in elsewhere adds none. |
| GEO02 | Every pair has zero intersection/touch and at least the configured boundary gap; neighboring active worlds are included. |
| GEO03 | All footprints are valid connected polygons; holes and narrow/excluded land do not create invalid targets. |
| GEO04 | The set includes at least three approved shape families when safe candidates permit it; all entry/target nodes are reachable. |
| GEO05 | A player standing still cannot claim different zones or all separated objectives; arena relocation cannot settle physical-mode prizes. |
| GEO06 | Daily seeds reproduce the same manifest across restarts; different dates rotate approved sites without changing a published instance. |
| GEO07 | Two workers, retry storms and crash recovery publish/reserve once; cold-cache/map-data failure produces a bounded fallback. |
| GEO08 | Local midnight and DST activate exactly one next world; timely evidence retains backing and unclaimed funds roll over once. |
| GEO09 | Samples over at least 365 local dates cover every reviewed sector, respect constraints and report shortfalls rather than hiding them. |
| GEO10 | Real walking sessions in several city sectors confirm usable targets, meaningful transfers, GPS edge behavior and understandable distance labels. |
| GEO11 | Empty/unsupported coverage offers street play or a truthful alternative without a forced deposit or invented zone. |
| GEO12 | Map rendering, public reads and paid/private content boundaries match the canonical manifest; no first-visitor GPS is published. |

Automated spatial tests can establish geometry and conservation before a full city playtest. They cannot certify real-world access, accessibility, safety or how enjoyable a walk feels.

# POI taxonomy and safety filter (W4)

Status: implemented in `server/poi/` (policy `poi-taxonomy-v1` + `poi-safety-v1`), offline and deterministic.
Plan: `docs/WORLDS-PLAN.md` C.2.3, C.2.4 and task W4. Consumers: W3 (POI import on the Mac), W5 (auto
CityPacks), W6 (POI quests), W7 (generic NPC homes), W12 (coverage QA).

No model, map API or network call happens here. The filter runs at import time on the Mac or VPS; the player
request path only reads its stored results.

## Interface (stable)

```js
import {
  osmToInputs, overtureToInputs, classifyPois, questReady,
  loadPoiClosures, changePoiPlace, POI_POLICY, POI_CATEGORIES, SAFETY_REASONS,
} from "./server/poi/index.mjs";

// One bounded region at a time (an H3 res-5 tile, or one city).
const osm = osmToInputs(elements);                 // Overpass-style JSON ("out geom"): nodes, ways, multipolygons
const pois = [...osm.pois, ...overtureToInputs(overtureRows)];
const { records, report } = classifyPois({ ...osm, pois, closures: loadPoiClosures(db) });
const usable = questReady(records);                // safety "ok", categorised, with a path target
```

- `osmToInputs(elements)` splits elements into POI candidates, public paths (`isPublicPath`) and grounds
  (school yards, hospitals, cemeteries, …). The osmium export on the Mac must keep the geometry of ways and
  multipolygon outers, and must include grounds and paths for the tile plus a 50 m margin.
- `classifyPois()` returns records sorted by id and a report (`bySafety`, `byCategory` for ok records,
  `byReason`). Input order never changes the output.
- Record shape (matches the POI table in WORLDS-PLAN C.2.2):
  `{ id, source, name, category, rule, lat, lng, h3r7, h3r5, wikidata, access, safety, reasons, target, policy,
  closure? }`. `target` is `{ lat, lng, pathId, distanceM }` or `null`; `h3r7/h3r5` index the target (or the
  label point when there is no target). `rule` records which taxonomy rule matched.
- `npm run poi:classify -- <overpass.json> [--overture places.json] [--db state.sqlite] [--out records.jsonl]`
  runs the same thing from the command line and prints the report.

Ids, category ids, rule ids and reason codes are a stable interface: add new ones, never rename. A behaviour
change bumps `POI_TAXONOMY_VERSION` or `POI_SAFETY_VERSION`, which every record carries in `policy`.

## Taxonomy (30 categories)

`park, garden, plaza, viewpoint, fountain, monument, memorial, artwork, street_art, castle, ruins,
historic_building, museum, library, market, bridge, river_walk, lake_walk, trailhead, nature_reserve,
observatory, landmark_tower, sculpture, picnic_site, information_board, music_venue, sports_ground, skate_park,
bench_with_view, other_named`.

OSM rules (`OSM_CATEGORY_RULES`) are ordered, most specific first (a mural is `street_art`, not `artwork`).
Overture categories map through `OVERTURE_CATEGORY_MAP` (primary first, then alternates); W3 should print the
unmatched primary categories per release so the table can grow. Flags per category: `requiresName` (an
unnamed plaza or river is not findable), `review` (skate parks) and `exterior` (quests never ask players to go
inside).

## Safety states and reasons

Every record is `ok`, `review` or `excluded`, and every non-ok record carries reason codes from
`SAFETY_REASONS`:

| Kind | Codes |
| --- | --- |
| Own tags, excluded | `school`, `kindergarten`, `playground`, `hospital`, `care-home`, `prison`, `military`, `private-access`, `railway`, `motorway`, `quarry`, `construction`, `embassy`, `police`, `aerodrome`, `bar`, `adult-venue`, `disused` |
| Own tags, review | `worship-exterior`, `cemetery`, `sensitive-memorial` (Stolpersteine, ghost bikes) |
| Inside grounds | `inside-<code>` for a POI that sits in (or a polygon fully inside) grounds; review grounds give review |
| Category | `uncategorised`, `unnamed`, `category-review`, `low-confidence` (Overture < 0.5) |
| Path | `no-public-path`, `water-no-path`, `target-excluded` |
| Operator | `operator-closure` |

### Path snapping

The check-in target is the nearest point on a mapped public path within **40 m** (`MAX_SNAP_M`). A polygon POI
prefers path points inside it. A candidate point is skipped when it lies inside excluded grounds, or within
**25 m** (`CHILD_BUFFER_M`) of a school, kindergarten or playground. If every nearby point is skipped the POI is
excluded with `target-excluded`; if none is in reach, `no-public-path` (`water-no-path` for rivers and lakes).
Points inside review grounds (a path through a cemetery) give `review`, never `ok`.

Public paths: footways, paths, pedestrian streets, living and residential streets, cycleways (unless
`foot=no`), steps, bridleways, tracks and unclassified roads; service roads only with `foot=yes` or a sidewalk;
primary/secondary/tertiary roads only with a mapped sidewalk. Never motorways or trunks, tunnels, indoor ways
or private ways without explicit foot access.

### Operator closures

Closures reuse `system-place-safety` (`system_place_closures`). POIs outside reviewed cities use scope
`city_id = "poi"`: `changePoiPlace(db, record, input, { isOperator })` stores a 30 m square around the target
through the same trusted, versioned, idempotent operator flow as city places. `loadPoiClosures(db)` reads every
closed place in every scope, and `classifyPois({ closures })` excludes a record when its id matches or its
target or label point lies inside a closure polygon. A re-import that renames, re-tags, nudges or even
re-numbers the feature therefore stays closed until an operator reopens it.

## Verified and not verified

Verified by `tests/poi-safety.test.mjs` and `tests/poi-taxonomy.test.mjs` on synthetic fixtures
(`tests/fixtures/poi/safety-world.mjs`): one fixture per exclusion rule, a school next to a park (park kept,
school excluded, target outside the school and its buffer), a POI with no path in 40 m, water with and without a
path, re-import after a closure, Overture mapping, determinism. A synthetic 20k-POI / 40k-path region classifies
in under a second.

Not verified yet: real Czech data (W3 runs the import on the Mac), Overture category names against the current
release, and field review of a sample of quest targets (W12).

## Adapter for the import pipeline (W3)

The import does its own path and grounds lookup in SQLite and calls the per-POI adapter:

- `taxonomy.mjs`: `classifyOsm(tags) -> category | null`, `classifyOverture({ category, basicCategory }) ->
  category | null` (`category` = Overture `taxonomy.primary`; the specific one wins), `TAXONOMY_VERSION`.
- `safety.mjs`: `assessPoi(poi, { nearestPath, exclusion, closures }) -> { safety, reason, reasons, target }`
  and `SAFETY_VERSION`. `poi` is `{ id, category, name, tags }` (`tags` is `{}` for Overture). `nearestPath`
  is `{ lat, lng, distanceM, wayId }` or `null` (more than 40 m also counts as none). `exclusion` is
  `{ kind, id }` when that path point lies in forbidden grounds. Kinds are the reason codes above, and
  `care_home` is also accepted; `cemetery` gives `review`. `closures` is a `Set` of closed POI ids. `reason`
  is the first blocking code (or the first review code), `null` when ok. `target` is `null` when excluded.

Both paths give the same reason codes, so reports from either can be compared.

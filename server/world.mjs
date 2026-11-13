import { getOrPrepareCityPlan } from "./world-planner.mjs";
import { demoWorldSuffix } from "./demo-zones.mjs";
import { placeTier, playerStakeTier } from "./staker-gates.mjs";
import { preparedActivityWorld, assertGlobalActivityReady } from "./global-activities.mjs";
import { decorateGlobalRewardWorld,globalPrizeForQuest } from './global-rewards.mjs';
import { localDateBounds } from "./spatial/calendar.mjs";
import { isCzechiaCell, isInCzechia } from "./map-rewards/czechia.mjs";
import { combinedPoiSource, liveOverpassPoiSource } from "./poi/live-source.mjs";
import tzLookup from "tz-lookup";
import { latLngToCell, cellToLatLng, cellToBoundary } from "h3-js";
import {
  COIN_VALUE,
  COIN_ARENA_RADIUS_M,
  COIN_GPS_RADIUS_M,
  GOLD,
  assert,
  dayKey,
  levelFor,
} from "./domain.mjs";
import { chestAuraAvailable } from "./aura-catalog.mjs";
import { atomic } from "./database.mjs";
import { withoutTakenSpots } from "./coin-spots.mjs";
import {
  DEFAULT_CITY,
  cityFor,
  isAutoCity,
  playableCityById,
  sampleCityPaths,
} from "./spatial/city-pack.mjs";
import { AUTO_CITY_NOTICE } from "./spatial/auto-cities.mjs";
import { describeStoredQuest } from "./quest-templates.mjs";
import { STREET_FIND_XP, streetFindIds } from "./street-finds.mjs";
import { wearableFinds } from "./gotchi-wearables.mjs";
import { publicPathSnapshot } from "./spatial/map-data.mjs";
import {
  worldQuery,
  readQueryCursor,
  queryCursor,
  zoneInBounds,
  nearQuery,
  nearBox,
  NEAR_RADIUS_M,
  NEAR_COIN_LIMIT,
} from "./spatial/world-query.mjs";
import {
  effectiveCityPack,
  closedPlaces,
  pointClosed,
  placeClosed,
} from "./spatial/place-safety.mjs";
import { pauseState, pauseFor } from "./operator/world-controls.mjs";
import {
  defaultPoiSource,
  huntVisited,
  materializePoiQuests,
  poiQuestText,
} from "./poi-quests.mjs";
import { clueView } from "./landmark-clue.mjs";
import {
  MAP_REWARDS_POLICY,
} from "./map-rewards/policy.mjs";
import {
  coinTiers,
  hiddenCoinIds,
  mapRewardsEnabled,
  materializeCellRewards,
  nextWave,
} from "./map-rewards/service.mjs";
import { ensureMapRewardsSchema } from "./map-rewards/schema.mjs";
export const HOME = DEFAULT_CITY.center;
export const ZONE_NAMES = DEFAULT_CITY.candidates.map((c) => c.name);
const databasePending = new WeakMap();
const citySamples = new WeakMap();
function samplePaths(paths, max = 350) {
  return sampleCityPaths(
    { paths: paths.map((points, i) => ({ id: String(i), points })) },
    max,
  );
}
function streetSamples(snapshot, region, max = 350) {
  return samplePaths(snapshot.paths, 6000)
    .filter((p) => latLngToCell(p.lat, p.lng, 7) === region)
    .slice(0, max);
}
// Path points of one cell for map rewards (Poisson spacing picks from them).
const CITY_CELL_SAMPLES = 40000;
const cityCellSamples = new WeakMap();
function cellSampler(db, world, cell, now, mapData) {
  return async () => {
    if (!world.cityId) {
      const snapshot = await publicPathSnapshot(db, world.region, { ...mapData, clock: () => now });
      return snapshot.status === "unavailable" ? null : streetSamples(snapshot, world.region, 6000);
    }
    const base = playableCityById(world.cityId);
    if (!base) return null;
    const city = effectiveCityPack(db, base);
    if (!cityCellSamples.has(city.paths))
      cityCellSamples.set(city.paths, sampleCityPaths(city, CITY_CELL_SAMPLES));
    return cityCellSamples
      .get(city.paths)
      .filter((p) => latLngToCell(p.lat, p.lng, 7) === cell && !pointClosed(city.exclusions || [], p));
  };
}
function pathState(snapshot, materialized) {
  const { paths, ...state } = snapshot;
  return { ...state, materialized };
}
function applyPathState(manifest, snapshot, materialized) {
  manifest.pathData = pathState(snapshot, materialized);
  manifest.coverage =
    snapshot.status === "unavailable" ? "unavailable" : "street-only";
  manifest.quality.pathCoverage = snapshot.status;
  manifest.quality.notice =
    snapshot.status === "unavailable"
      ? "Map paths are temporarily unavailable. You can browse the map; nearby discoveries will retry shortly."
      : "City zones are not available here yet. Street coins use mapped public paths; physical access still requires care.";
}
async function hydrateStreetWorld(db, manifest, now, mapOptions) {
  if (
    manifest.cityId ||
    manifest.arena ||
    manifest.pathData?.materialized !== false ||
    now >= manifest.endsAt ||
    now < manifest.pathData.retryAt
  )
    return publicManifest(db, manifest);
  const started = Date.now();
  const snapshot = await publicPathSnapshot(db, manifest.region, {
    ...mapOptions,
    clock: () => now,
  });
  const samples = streetSamples(snapshot, manifest.region);
  const hydrated = atomic(db, () => {
    const current = JSON.parse(
      db.prepare("SELECT manifest FROM worlds WHERE id=?").get(manifest.id)
        .manifest,
    );
    if (
      current.pathData?.materialized !== false ||
      current.endsAt <= now + Math.max(0, Date.now() - started) ||
      db
        .prepare("SELECT 1 FROM daily_jobs WHERE job_key=?")
        .get(`expire:${current.id}`)
    )
      return current;
    const ready = snapshot.status !== "unavailable";
    // Map-reward worlds get their coins per cell in ensureWorld.
    if (ready && !current.mapRewards) {
      const available = db
        .prepare("SELECT available_u FROM treasury WHERE bucket='coins'")
        .get().available_u;
      const count = Math.min(
        samples.length,
        Math.floor(available / COIN_VALUE),
      );
      for (let i = 0; i < count; i++)
        db.prepare(
          "INSERT INTO coins(id,world_id,lat,lng,value_u) VALUES(?,?,?,?,?)",
        ).run(
          `${current.id}:coin:${i}`,
          current.id,
          samples[i].lat,
          samples[i].lng,
          COIN_VALUE,
        );
      db.prepare(
        "UPDATE treasury SET available_u=available_u-?,reserved_u=reserved_u+? WHERE bucket='coins'",
      ).run(count * COIN_VALUE, count * COIN_VALUE);
    }
    applyPathState(current, snapshot, ready);
    db.prepare("UPDATE worlds SET manifest=? WHERE id=?").run(
      JSON.stringify(current),
      current.id,
    );
    return current;
  });
  // The recovered paths also drop the cell's map rewards (no player visit needed).
  if (!hydrated.mapRewards || hydrated.pathData?.materialized !== true)
    return hydrated;
  return materializeCellRewards(db, hydrated, {
    cell: hydrated.region,
    now,
    samples: async () => streetSamples(snapshot, hydrated.region, 6000),
  });
}
export async function retryStreetWorlds(
  db,
  { clock = Date.now, mapData = {}, maxJobs = 2 } = {},
) {
  assert(
    Number.isSafeInteger(maxJobs) && maxJobs >= 0 && maxJobs <= 10,
    "Invalid street recovery job limit.",
  );
  const now = clock(),
    rows = db
      .prepare(
        "SELECT manifest FROM worlds WHERE json_valid(manifest) AND json_extract(manifest,'$.endsAt')>? AND json_extract(manifest,'$.pathData.materialized')=0 AND json_extract(manifest,'$.pathData.retryAt')<=? ORDER BY created_at,id LIMIT ?",
      )
      .all(now, now, maxJobs);
  for (const row of rows)
    await hydrateStreetWorld(db, JSON.parse(row.manifest), clock(), mapData);
  return rows.length;
}
function publicManifest(db, w) {
  let center = w.center;
  const registered = w.cityId ? playableCityById(w.cityId) : null;
  if (registered) center = registered.center;
  else if (!w.arena) {
    const [lat, lng] = cellToLatLng(w.region);
    center = { lat, lng };
  }
  if (w.center.lat !== center.lat || w.center.lng !== center.lng) {
    w.center = { ...center };
    db.prepare("UPDATE worlds SET manifest=? WHERE id=?").run(
      JSON.stringify(w),
      w.id,
    );
  }
  return w;
}

// Street worlds get today's POI quests on first load (docs/WORLDS-PLAN.md C.3,
// task W6), from the local POI file only. City worlds (auto and reviewed, the
// city demo too) get them per H3 cell: the player's cell, or `cellAt` when the
// player asks to search another spot of the same city ("Search this area").
const poiSources = new WeakMap();
/**
 * The imported POI file inside Czechia, live OpenStreetMap places everywhere
 * else (server/poi/live-source.mjs). One live source per database.
 */
function worldPoiSource(db, mapData = {}) {
  const file = defaultPoiSource();
  if (!file) return null;
  if (!poiSources.has(db))
    poiSources.set(
      db,
      combinedPoiSource(
        file,
        liveOverpassPoiSource(db, {
          // Czechia and the demo city clips abroad come from the file.
          covers: (cell) => !isCzechiaCell(cell) && !file.hasCell?.(cell),
          ...(mapData.poiFetcher ? { fetcher: mapData.poiFetcher } : {}),
        }),
      ),
    );
  return poiSources.get(db);
}
/** Where a spot without a prepared day falls back to its street world. */
export function streetFallbackScope(env = process.env) {
  if (env.GLOBAL_CZECHIA_FALLBACK === "off" || env.GLOBAL_STREET_FALLBACK === "off") return "off";
  return env.GLOBAL_STREET_FALLBACK === "czechia" ? "czechia" : "world";
}
// A world built before 13 Nov 2026 may still hold zone prizes reserved from
// the game treasury. They are never paid out on chain, so with map rewards
// on they are released: zone prizes come only from the daily zone budget.
function releaseTreasuryZonePrizes(db, worldId) {
  const unbacked =
    "world_id=? AND claimant IS NULL AND gold_u>0 AND NOT (json_valid(metadata) AND json_extract(metadata,'$.cellZone.cell') IS NOT NULL)";
  atomic(db, () => {
    const n = db.prepare(`SELECT COALESCE(SUM(gold_u),0) n FROM quests WHERE ${unbacked}`).get(worldId).n;
    if (!n) return;
    db.prepare(`UPDATE quests SET gold_u=0 WHERE ${unbacked}`).run(worldId);
    db.prepare(
      "UPDATE treasury SET available_u=available_u+?,reserved_u=MAX(0,reserved_u-?) WHERE bucket='zones'",
    ).run(n, n);
  });
}
export async function ensureWorld(
  db,
  location = HOME,
  arena = true,
  now = Date.now(),
  { mapData = {}, poiSource, cellAt = null, globalActivities = !!process.env.GLOBAL_ACTIVITY_DAYS_DIR, streetFallback = streetFallbackScope(), arenaCity = null } = {},
) {
  // An installed global day is read-only on player arrival. Plzen retains its
  // reviewed citywide six-slot world; the arena remains its existing simulation.
  if (globalActivities && !arena && cityFor(location)?.id !== "plzen") {
    const at = cellAt || location;
    try {
      return preparedActivityWorld(db, at, now);
    } catch (error) {
      // Every spot keeps its street world (POI quests, landmark clues, errand
      // targets, backed coins) whenever no ready prepared day covers it, so a
      // missing daily manifest never empties the map anywhere on Earth.
      // GLOBAL_STREET_FALLBACK=czechia limits that to Czechia, =off keeps the
      // prepared catalog as the only source (docs/GLOBAL-WORLD-PREPARATION.md).
      if (
        error?.code !== "GLOBAL_COVERAGE_UNAVAILABLE" ||
        streetFallback === "off" ||
        (streetFallback === "czechia" && !isInCzechia(at.lat, at.lng))
      )
        throw error;
    }
  }
  const world = await ensureBaseWorld(db, location, arena, now, { mapData, arenaCity });
  if (world.mapRewards) releaseTreasuryZonePrizes(db, world.id);
  if (!world.cityId && arena) return world;
  // A searched spot must lie in the same city; otherwise the player's own cell.
  const at =
    world.cityId && cellAt && cityFor(cellAt)?.id === world.cityId
      ? cellAt
      : location;
  const cell = world.cityId ? latLngToCell(at.lat, at.lng, 7) : world.region;
  let current = world;
  try {
    const source = poiSource === undefined ? worldPoiSource(db, mapData) : poiSource;
    // Outside the POI import a cell asks OpenStreetMap once (live source).
    await source?.prepare?.(cell);
    current = materializePoiQuests(db, world, {
      source,
      now,
      cell: world.cityId ? cell : null,
    });
  } catch (error) {
    // POI quests are an addition: a broken POI file never hides the street world.
    console.warn("poi-quests: materialisation failed", error?.message || error);
  }
  try {
    return await materializeCellRewards(db, current, {
      cell,
      now,
      samples: cellSampler(db, current, cell, now, mapData),
    });
  } catch (error) {
    // Rewards come back on the next load; the world itself stays playable.
    console.warn("map-rewards: cell drop failed", error?.message || error);
    return current;
  }
}
async function ensureBaseWorld(
  db,
  location = HOME,
  arena = true,
  now = Date.now(),
  { mapData = {}, arenaCity = null } = {},
) {
  // arenaCity: the Test Layer's city demo ("/?newyork"); otherwise the arena is the default city.
  const baseCity = arena ? arenaCity || DEFAULT_CITY : cityFor(location),
    city = baseCity ? effectiveCityPack(db, baseCity) : null,
    region = city
      ? `city-${city.id}`
      : latLngToCell(location.lat, location.lng, 7);
  const timezone = city?.timezone || tzLookup(...cellToLatLng(region)),
    day = dayKey(now, timezone),
    // A compact demo day (DEMO_ZONES) is its own world, never today's
    // citywide one with different zones.
    worldId = `demo:${arena ? "arena-" : ""}${region}:${day}:v2${city ? demoWorldSuffix(city.id) : ""}`;
  const found = db
    .prepare("SELECT manifest FROM worlds WHERE id=?")
    .get(worldId);
  if (found)
    return hydrateStreetWorld(db, JSON.parse(found.manifest), now, mapData);
  let pending = databasePending.get(db);
  if (!pending) {
    pending = new Map();
    databasePending.set(db, pending);
  }
  if (pending.has(worldId)) return pending.get(worldId);
  const job = (async () => {
    const started = Date.now();
    expireWorlds(db, now);
    const plan = city ? getOrPrepareCityPlan(db, city, day, now) : null;
    const { startsAt, endsAt } = plan || localDateBounds(day, timezone),
      base = plan?.zones || [];
    const snapshot = city
      ? null
      : await publicPathSnapshot(db, region, { ...mapData, clock: () => now });
    const effectiveNow = now + Math.max(0, Date.now() - started);
    if (effectiveNow >= endsAt)
      return ensureBaseWorld(db, location, arena, effectiveNow, { mapData, arenaCity });
    if (city && !citySamples.has(city.paths))
      citySamples.set(city.paths, sampleCityPaths(city));
    const samples = city
        ? citySamples
            .get(city.paths)
            .filter((p) => !pointClosed(city.exclusions || [], p))
        : streetSamples(snapshot, region),
      [lat, lng] = city
        ? [city.center.lat, city.center.lng]
        : cellToLatLng(region);
    // Auto cities (unreviewed map data) are practice only: no zone prize.
    const auto = isAutoCity(city);
    const zones = base.map((z) => ({
      ...z,
      id: `${worldId}:zone:${z.slot}`,
      radius: 0,
      kind: z.tier === 1 ? "cache" : "expedition",
      opensAt: z.opensAt,
      closesAt: z.closesAt,
      color: z.tier === 3 ? "#c29222" : z.tier === 2 ? "#672eeb" : "#258b73",
    }));
    const manifest = {
      id: worldId,
      version: 2,
      blueprintId: plan?.id || null,
      ...(plan?.demoZones ? { demoZones: plan.demoZones } : {}),
      day,
      region,
      cityId: city?.id || null,
      cityName: city?.name || null,
      ...(city ? { cityStatus: auto ? "auto" : "reviewed" } : {}),
      timezone,
      arena,
      source: auto
        ? "OpenStreetMap auto CityPack"
        : city
          ? "OpenStreetMap CityPack"
          : "OpenStreetMap / Overpass",
      center: { lat, lng },
      boundary: city ? null : cellToBoundary(region, true),
      paths: [],
      endsAt,
      zones,
      cityZoneCount: zones.length,
      ...(mapRewardsEnabled()
        ? { mapRewards: { policy: MAP_REWARDS_POLICY, cells: {} } }
        : {}),
      coinRadius: arena ? COIN_ARENA_RADIUS_M : COIN_GPS_RADIUS_M,
      coverage: city ? "city-pack" : "street-only",
      quality: {
        fieldReview: city?.fieldReview || "pending",
        ...(auto ? { status: "auto", funded: false } : {}),
        pathCoverage: city?.pathCoverage || "bounded-live-query",
        routing: "straight-line-only",
        geometry: "OSM-polygons",
        notice: auto
          ? AUTO_CITY_NOTICE
          : city
          ? "Map-data preview. Walking routes and physical access still require field review."
          : "City zones are not available here yet. Street coins use mapped public paths.",
      },
    };
    if (snapshot)
      applyPathState(manifest, snapshot, snapshot.status !== "unavailable");
    return atomic(db, () => {
      const existing = db
        .prepare("SELECT manifest FROM worlds WHERE id=?")
        .get(worldId);
      if (existing) return JSON.parse(existing.manifest);
      db.prepare("INSERT INTO worlds VALUES (?,?,?,?,?,?)").run(
        worldId,
        day,
        region,
        timezone,
        JSON.stringify(manifest),
        now,
      );
      const available = db
          .prepare("SELECT available_u FROM treasury WHERE bucket='coins'")
          .get().available_u,
        count = manifest.mapRewards
          ? 0
          : Math.min(samples.length, Math.floor(available / COIN_VALUE));
      for (let i = 0; i < count; i++)
        db.prepare(
          "INSERT INTO coins(id,world_id,lat,lng,value_u) VALUES (?,?,?,?,?)",
        ).run(
          `${worldId}:coin:${i}`,
          worldId,
          samples[i].lat,
          samples[i].lng,
          COIN_VALUE,
        );
      db.prepare(
        "UPDATE treasury SET available_u=available_u-?,reserved_u=reserved_u+? WHERE bucket='coins'",
      ).run(count * COIN_VALUE, count * COIN_VALUE);
      for (const z of [...zones].sort(
        (a, b) => a.tier - b.tier || a.slot - b.slot,
      )) {
        // With map rewards on, a zone prize comes only from the daily zone
        // budget when its cell opens (map-rewards/service.mjs), so it is paid
        // out on chain; the game treasury never funds a prize there.
        const desired = auto || manifest.mapRewards
          ? 0
          : z.tier === 3
            ? 5000 * GOLD
            : z.tier === 2
              ? 1000 * GOLD
              : 0;
        const available = db
            .prepare("SELECT available_u FROM treasury WHERE bucket='zones'")
            .get().available_u,
          reward = desired <= available ? desired : 0;
        db.prepare(
          "UPDATE treasury SET available_u=available_u-?,reserved_u=reserved_u+? WHERE bucket='zones'",
        ).run(reward, reward);
        const defs = z.questActivities
          ? z.questActivities.map((q, index) => ({
              ...q,
              xp: [50, 100, 80][index],
              reward: index === 0 ? reward : 0,
            }))
          : [
              {
                kind: "visit",
                title: "Discover the park",
                description:
                  "Reach the marked public path and record your visit.",
                target: z.targets[0],
                xp: 50,
                reward,
              },
              {
                kind: "route",
                title: "Three-point expedition",
                description:
                  "Visit three marked checkpoints in order. Each checkpoint is on a mapped pedestrian path.",
                target: z.targets[2],
                xp: 100,
                reward: 0,
              },
              {
                kind: "chest",
                title: "Find the park chest",
                description:
                  "Reach the chest on the marked path and discover a cosmetic Aura.",
                target: z.targets[1],
                xp: 80,
                reward: 0,
              },
            ];
        for (const [qIndex, q] of defs.entries())
          db.prepare(
            "INSERT INTO quests(id,world_id,title,description,lat,lng,tier,gold_u,xp,kind,opens_at,closes_at,zone_id,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            `${worldId}:quest:${z.slot}:${qIndex}`,
            worldId,
            q.title,
            q.description,
            q.target.lat,
            q.target.lng,
            z.tier,
            q.reward,
            q.xp,
            q.kind,
            z.opensAt,
            z.closesAt,
            z.id,
            JSON.stringify({
              zoneId: z.id,
              checkpoints: q.kind === "route" ? q.checkpoints || z.targets : [],
              ...(q.activity ? { activity: q.activity } : {}),
            }),
          );
      }
      return manifest;
    });
  })().finally(() => pending.delete(worldId));
  pending.set(worldId, job);
  return job;
}
export function worldView(db, id, player = null, options = {}) {
  // options.timing (an object) collects ms per phase for Server-Timing.
  const spans = options.timing,
    mark = (() => {
      let last = performance.now();
      return (name) => {
        if (!spans) return;
        const at = performance.now();
        spans[name] = (spans[name] || 0) + (at - last);
        last = at;
      };
    })();
  const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(id);
  if (!row) return null;
  assertGlobalActivityReady(db, JSON.parse(row.manifest));
  const query = worldQuery(options),
    near = query.limit ? null : nearQuery(options.near),
    now = options.now ?? Date.now(),
    manifest = publicManifest(db, decorateGlobalRewardWorld(db,JSON.parse(row.manifest))),
    closed = closedPlaces(db, manifest.cityId),
    paused = pauseState(db, manifest.cityId, manifest.day);
  mark("wmanifest");
  const quests = db
    .prepare(
      "SELECT q.*,EXISTS(SELECT 1 FROM quest_claims c WHERE c.quest_id=q.id AND c.player_id=?) AS completed,COALESCE((SELECT checkpoint FROM quest_progress p WHERE p.quest_id=q.id AND p.player_id=?),0) AS checkpoint FROM quests q WHERE q.world_id=? ORDER BY q.tier,q.id",
    )
    .all(player, player, id)
    .map((q) => {
      const meta = JSON.parse(q.metadata || "{}");
      const cps = meta.checkpoints || [], nearPrize=globalPrizeForQuest(db,q.id);
      // A category hunt takes its stops in any order: point at the first open one.
      const visited = meta.unordered ? huntVisited(db, q.id, player) : null;
      return {
        ...q,
        ...(meta.poi ? poiQuestText(db, q, meta, { lang: options.lang }) || {} : {}),
        metadata: undefined,
        checkpointCount: cps.length,
        nextPoint: visited
          ? cps.find((_, i) => !visited.has(i)) || null
          : cps[q.checkpoint] || null,
        ...(visited ? { visitedStops: [...visited].sort((a, b) => a - b) } : {}),
        // Stops still ahead, so the map can draw the walk to the next one and
        // beyond (ordered walks in order; hunts list every unvisited stop).
        ...(cps.length > 1
          ? {
              stops: (visited
                ? cps.filter((_, i) => !visited.has(i))
                : cps.slice(q.checkpoint)
              ).map((p) => ({ lat: p.lat, lng: p.lng })),
            }
          : {}),
        activity: {...describeStoredQuest(q, meta),...(nearPrize?{rewardConstraint:nearPrize.available?`Personal XP for everyone. The first confirmed completion also earns ${nearPrize.amountNear} NEAR, converted to QGOLD at settlement; fractional NEAR stays credited.`:'The shared NEAR prize was already earned. You can still finish for personal XP.'}:{})},
        ...(nearPrize?{nearPrize}:{}),
        ...(meta.author ? { author: meta.author } : {}),
        ...(meta.clue ? { clue: clueView(db, q.id, meta.clue, player, options.lang) } : {}),
      };
    });
  const level = levelFor(
      (player &&
        db.prepare("SELECT xp FROM players WHERE id=?").get(player)?.xp) ||
        0,
    ),
    chestStock = new Map(
      [1, 2, 3].map((t) => [t, chestAuraAvailable(db, t, level)]),
    );
  // An operator pause reads as a closed place to players; operatorPause says why.
  const zones = manifest.zones.map((z) => {
      const pause = pauseFor(paused, z.slot);
      return {
        ...z,
        placeStatus:
          pause || placeClosed(closed, z.sourceId, z) ? "closed" : "open",
        ...(pause ? { operatorPause: { reason: pause.reason } } : {}),
      };
    }),
    visibleZones = zones.filter((z) => zoneInBounds(z, query.bounds)),
    visibleIds = new Set(visibleZones.map((z) => z.id)),
    zoneById = new Map(zones.map((z) => [z.id, z]));
  const tier = placeTier(db, player);
  const eligible = new Set(
    quests
      .filter(
        (q) =>
          zoneById.has(q.zone_id) &&
          !q.completed &&
          q.tier <= tier &&
          q.opens_at <= now &&
          q.closes_at > now &&
          zoneById.get(q.zone_id)?.placeStatus !== "closed",
      )
      .map((q) => q.zone_id),
  );
  mark("wquests");
  let rows;
  if (query.limit) {
    const after = readQueryCursor(id, query),
      params = [id, after];
    const bounds = query.bounds
      ? " AND lng>=? AND lat>=? AND lng<=? AND lat<=?"
      : "";
    if (query.bounds) params.push(...query.bounds);
    rows = db
      .prepare(
        `SELECT id,lat,lng,value_u,claimant FROM coins WHERE world_id=? AND claimant IS NULL AND id>?${bounds} ORDER BY id LIMIT ?`,
      )
      .all(...params, query.limit + 1);
  } else if (near) {
    const [w, south, e, north] = nearBox(near),
      cosLat = Math.cos((near.lat * Math.PI) / 180),
      away = (c) =>
        ((c.lat - near.lat) * 111320) ** 2 +
        ((c.lng - near.lng) * 111320 * cosLat) ** 2;
    rows = db
      .prepare(
        "SELECT id,lat,lng,value_u,claimant FROM coins WHERE world_id=? AND claimant IS NULL AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
      )
      .all(id, south, north, w, e)
      .filter((c) => away(c) <= NEAR_RADIUS_M ** 2);
    if (rows.length > NEAR_COIN_LIMIT)
      rows = rows.sort((a, b) => away(a) - away(b)).slice(0, NEAR_COIN_LIMIT);
  } else
    rows = db
      .prepare(
        "SELECT id,lat,lng,value_u,claimant FROM coins WHERE world_id=? AND claimant IS NULL",
      )
      .all(id);
  // Hide a coin somebody already picked up at the same spot in another world.
  rows = withoutTakenSpots(db, id, rows);
  mark("wcoins");
  // Map-reward coins appear in waves; a later wave stays hidden until it opens.
  const hidden = manifest.mapRewards ? hiddenCoinIds(db, id, now) : null,
    tiers = manifest.mapRewards ? coinTiers(db, id) : null;
  if (hidden?.size) rows = rows.filter((c) => !hidden.has(c.id));
  const finds = streetFindIds(db, id),
    wearables = wearableFinds(db, id);
  mark("wfinds");
  const more = !!query.limit && rows.length > query.limit,
    page = query.limit ? rows.slice(0, query.limit) : rows;
  const view = {
    ...manifest,
    zones: visibleZones,
    cityZoneCount: zones.length,
    visibleZoneCount: visibleZones.length,
    openEligibleCount: eligible.size,
    playerTier: playerStakeTier(db, player),
    ...(paused.day ? { operatorPause: { reason: paused.day.reason } } : {}),
    coins: (paused.day ? [] : page)
      .filter((p) => !pointClosed(closed, p))
      .map((c) => {
        const tier = tiers?.get(c.id);
        const out = tier && tier !== "small" ? { ...c, tier } : c;
        if (!finds.has(c.id)) return out;
        const w = wearables.get(c.id);
        return w
          ? { ...out, find: true, wearable: { id: w.id, name: w.name, rarity: w.rarity } }
          : { ...out, find: true };
      }),
    streetFindXp: STREET_FIND_XP,
    ...(manifest.mapRewards
      ? {
          mapRewards: {
            policy: manifest.mapRewards.policy,
            cells: manifest.mapRewards.cells,
            nextWaveAt: nextWave(manifest, now),
            hiddenCoins: hidden?.size || 0,
          },
        }
      : {}),
    ...(near
      ? { coinsNear: { lat: near.lat, lng: near.lng, radiusM: NEAR_RADIUS_M } }
      : {}),
    ...(query.limit
      ? {
          page: {
            limit: query.limit,
            bounds: query.bounds,
            nextCursor: more ? queryCursor(id, query, page.at(-1).id) : null,
          },
        }
      : {}),
    quests: quests
      .filter((q) => !query.bounds || visibleIds.has(q.zone_id))
      .map((q) => ({
        ...q,
        placeStatus: zoneById.get(q.zone_id)?.placeStatus || "open",
        itemAvailable:
          q.kind === "chest" && (chestStock.get(q.tier) ?? false),
      })),
  };
  mark("wrest");
  return view;
}
export function expireWorlds(db, now = Date.now()) {
  ensureMapRewardsSchema(db);
  return atomic(db, () => {
    // Worlds already closed out are skipped in SQL, so this stays cheap as
    // past days pile up (it runs on every POST /api/world).
    for (const row of db
      .prepare(
        "SELECT id,manifest FROM worlds w WHERE NOT EXISTS (SELECT 1 FROM daily_jobs j WHERE j.job_key='expire:'||w.id)",
      )
      .all()) {
      const w = JSON.parse(row.manifest);
      if (w.endsAt > now) continue;
      const key = `expire:${row.id}`;
      if (db.prepare("SELECT 1 FROM daily_jobs WHERE job_key=?").get(key))
        continue;
      const coins = db
          .prepare(
            // Map coins and cell zones are backed by the day's chain budget,
            // not by this treasury, so they never roll back into it.
            "SELECT COALESCE(SUM(value_u),0) AS n FROM coins c WHERE world_id=? AND claimant IS NULL AND NOT EXISTS(SELECT 1 FROM map_coin_meta m WHERE m.coin_id=c.id)",
          )
          .get(row.id).n,
        quests = db
          .prepare(
            "SELECT COALESCE(SUM(gold_u),0) AS n FROM quests WHERE world_id=? AND claimant IS NULL AND NOT (json_valid(metadata) AND json_extract(metadata,'$.cellZone.cell') IS NOT NULL)",
          )
          .get(row.id).n;
      for (const [bucket, n] of [
        ["coins", coins],
        ["zones", quests],
      ])
        db.prepare(
          "UPDATE treasury SET available_u=available_u+?,reserved_u=reserved_u-? WHERE bucket=?",
        ).run(n, n, bucket);
      db.prepare("INSERT INTO daily_jobs VALUES (?,?)").run(key, now);
    }
  });
}

// Coins still on the map for the compact "Today's pot" row: unclaimed coins of
// this world within 10 km of the explorer, and across every open world. Later
// map-reward waves stay hidden until they open, so they are not counted.
export const COIN_COUNT_RADIUS_M = 10_000;
const globalCoinCache = { at: 0, value: 0 };
function mapCoinMetaExists(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='map_coin_meta'").get();
}
export function coinCounts(db, worldId, at, now = Date.now()) {
  const meta = mapCoinMetaExists(db);
  const visible = meta
    ? "AND NOT EXISTS(SELECT 1 FROM map_coin_meta m WHERE m.coin_id=c.id AND m.opens_at>?)"
    : "";
  let near = null;
  if (worldId && at && Number.isFinite(at.lat) && Number.isFinite(at.lng)) {
    const dLat = COIN_COUNT_RADIUS_M / 111320,
      cosLat = Math.max(0.01, Math.cos((at.lat * Math.PI) / 180)),
      dLng = dLat / cosLat;
    const rows = db
      .prepare(
        `SELECT c.lat,c.lng FROM coins c WHERE c.world_id=? AND c.claimant IS NULL AND c.lat BETWEEN ? AND ? AND c.lng BETWEEN ? AND ? ${visible}`,
      )
      .all(worldId, at.lat - dLat, at.lat + dLat, at.lng - dLng, at.lng + dLng, ...(meta ? [now] : []));
    near = rows.filter(
      (c) =>
        ((c.lat - at.lat) * 111320) ** 2 + ((c.lng - at.lng) * 111320 * cosLat) ** 2 <=
        COIN_COUNT_RADIUS_M ** 2,
    ).length;
  }
  // Every open world: one cached count a minute, the map polls far more often.
  if (now - globalCoinCache.at > 60_000 || globalCoinCache.db !== db) {
    globalCoinCache.value = db
      .prepare(
        `SELECT COUNT(*) AS n FROM coins c WHERE c.claimant IS NULL ${visible} AND NOT EXISTS(SELECT 1 FROM daily_jobs j WHERE j.job_key='expire:'||c.world_id)`,
      )
      .get(...(meta ? [now] : [])).n;
    globalCoinCache.at = now;
    globalCoinCache.db = db;
  }
  return { radiusM: COIN_COUNT_RADIUS_M, near, global: globalCoinCache.value };
}

import { getOrPrepareCityPlan } from "./world-planner.mjs";
import { localDateBounds } from "./spatial/calendar.mjs";
import tzLookup from "tz-lookup";
import { latLngToCell, cellToLatLng, cellToBoundary } from "h3-js";
import {
  COIN_VALUE,
  COIN_ARENA_RADIUS_M,
  COIN_GPS_RADIUS_M,
  GOLD,
  assert,
  dayKey,
  positionTier,
  tierFor,
  levelFor,
} from "./domain.mjs";
import { chestAuraAvailable } from "./aura-catalog.mjs";
import { atomic } from "./database.mjs";
import {
  DEFAULT_CITY,
  cityFor,
  liveCityById,
  sampleCityPaths,
} from "./spatial/city-pack.mjs";
import { describeStoredQuest } from "./quest-templates.mjs";
import { STREET_FIND_XP, streetFindIds } from "./street-finds.mjs";
import { publicPathSnapshot } from "./spatial/map-data.mjs";
import {
  worldQuery,
  readQueryCursor,
  queryCursor,
  zoneInBounds,
} from "./spatial/world-query.mjs";
import {
  effectiveCityPack,
  closedPlaces,
  pointClosed,
  placeClosed,
} from "./spatial/place-safety.mjs";
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
function streetSamples(snapshot, region) {
  return samplePaths(snapshot.paths, 6000)
    .filter((p) => latLngToCell(p.lat, p.lng, 7) === region)
    .slice(0, 350);
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
  return atomic(db, () => {
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
    if (ready) {
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
  const registered = w.cityId ? liveCityById(w.cityId) : null;
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

export async function ensureWorld(
  db,
  location = HOME,
  arena = true,
  now = Date.now(),
  { mapData = {} } = {},
) {
  const baseCity = arena ? DEFAULT_CITY : cityFor(location),
    city = baseCity ? effectiveCityPack(db, baseCity) : null,
    region = city
      ? `city-${city.id}`
      : latLngToCell(location.lat, location.lng, 7);
  const timezone = city?.timezone || tzLookup(...cellToLatLng(region)),
    day = dayKey(now, timezone),
    worldId = `demo:${arena ? "arena-" : ""}${region}:${day}:v2`;
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
      return ensureWorld(db, location, arena, effectiveNow, { mapData });
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
      day,
      region,
      cityId: city?.id || null,
      cityName: city?.name || null,
      timezone,
      arena,
      source: city ? "OpenStreetMap CityPack" : "OpenStreetMap / Overpass",
      center: { lat, lng },
      boundary: city ? null : cellToBoundary(region, true),
      paths: [],
      endsAt,
      zones,
      cityZoneCount: zones.length,
      coinRadius: arena ? COIN_ARENA_RADIUS_M : COIN_GPS_RADIUS_M,
      coverage: city ? "city-pack" : "street-only",
      quality: {
        fieldReview: city?.fieldReview || "pending",
        pathCoverage: city?.pathCoverage || "bounded-live-query",
        routing: "straight-line-only",
        geometry: "OSM-polygons",
        notice: city
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
        count = Math.min(samples.length, Math.floor(available / COIN_VALUE));
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
        const desired =
          z.tier === 3 ? 5000 * GOLD : z.tier === 2 ? 1000 * GOLD : 0;
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
                  "Reach the chest on the marked path and discover a cosmetic Aura while edition supply remains.",
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
  const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(id);
  if (!row) return null;
  const query = worldQuery(options),
    now = options.now ?? Date.now(),
    manifest = publicManifest(db, JSON.parse(row.manifest)),
    closed = closedPlaces(db, manifest.cityId);
  const quests = db
    .prepare(
      "SELECT q.*,EXISTS(SELECT 1 FROM quest_claims c WHERE c.quest_id=q.id AND c.player_id=?) AS completed,COALESCE((SELECT checkpoint FROM quest_progress p WHERE p.quest_id=q.id AND p.player_id=?),0) AS checkpoint FROM quests q WHERE q.world_id=? ORDER BY q.tier,q.id",
    )
    .all(player, player, id)
    .map((q) => {
      const meta = JSON.parse(q.metadata || "{}");
      const cps = meta.checkpoints || [];
      return {
        ...q,
        metadata: undefined,
        checkpointCount: cps.length,
        nextPoint: cps[q.checkpoint] || null,
        activity: describeStoredQuest(q, meta),
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
  const zones = manifest.zones.map((z) => ({
      ...z,
      placeStatus: placeClosed(closed, z.sourceId, z) ? "closed" : "open",
    })),
    visibleZones = zones.filter((z) => zoneInBounds(z, query.bounds)),
    visibleIds = new Set(visibleZones.map((z) => z.id)),
    zoneById = new Map(zones.map((z) => [z.id, z]));
  const tier = player
    ? tierFor(
        db
          .prepare("SELECT * FROM positions WHERE player_id=?")
          .all(player)
          .reduce((n, p) => n + positionTier(p, now), 0),
      )
    : 1;
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
  } else
    rows = db
      .prepare(
        "SELECT id,lat,lng,value_u,claimant FROM coins WHERE world_id=? AND claimant IS NULL",
      )
      .all(id);
  const finds = streetFindIds(db, id);
  const more = !!query.limit && rows.length > query.limit,
    page = query.limit ? rows.slice(0, query.limit) : rows;
  return {
    ...manifest,
    zones: visibleZones,
    cityZoneCount: zones.length,
    visibleZoneCount: visibleZones.length,
    openEligibleCount: eligible.size,
    coins: page
      .filter((p) => !pointClosed(closed, p))
      .map((c) => (finds.has(c.id) ? { ...c, find: true } : c)),
    streetFindXp: STREET_FIND_XP,
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
}
export function expireWorlds(db, now = Date.now()) {
  return atomic(db, () => {
    for (const row of db.prepare("SELECT id,manifest FROM worlds").all()) {
      const w = JSON.parse(row.manifest);
      if (w.endsAt > now) continue;
      const key = `expire:${row.id}`;
      if (db.prepare("SELECT 1 FROM daily_jobs WHERE job_key=?").get(key))
        continue;
      const coins = db
          .prepare(
            "SELECT COALESCE(SUM(value_u),0) AS n FROM coins WHERE world_id=? AND claimant IS NULL",
          )
          .get(row.id).n,
        quests = db
          .prepare(
            "SELECT COALESCE(SUM(gold_u),0) AS n FROM quests WHERE world_id=? AND claimant IS NULL",
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

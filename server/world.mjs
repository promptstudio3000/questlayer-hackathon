import tzLookup from "tz-lookup";
import { latLngToCell, cellToLatLng, cellToBoundary } from "h3-js";
import { COIN_VALUE, DAY, GOLD, dayKey, distance } from "./domain.mjs";
import { atomic } from "./database.mjs";
import {
  PLZEN,
  cityFor,
  buildCityZones,
  sampleCityPaths,
} from "./spatial/city-pack.mjs";
export const HOME = PLZEN.center;
export const ZONE_NAMES = PLZEN.candidates.map((c) => c.name);
const pending = new Map();
let citySamples;
async function publicPaths(db, region, center) {
  const cached = db
    .prepare("SELECT * FROM geo_cache WHERE region=? AND expires_at>?")
    .get(region, Date.now());
  if (cached) return JSON.parse(cached.data);
  const [lat, lng] = center,
    d = 0.009,
    box = `(${lat - d},${lng - d},${lat + d},${lng + d})`;
  const q =
    "[out:json][timeout:12];(" +
    ["footway", "pedestrian", "path", "living_street"]
      .map(
        (h) =>
          `way[highway=${h}][access!=private][access!=no][foot!=no]${box};`,
      )
      .join("") +
    ");out geom 150;";
  const r = await fetch(
    "https://overpass-api.de/api/interpreter?" +
      new URLSearchParams({ data: q }),
    {
      headers: { "User-Agent": "QuestLayer map adapter" },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) throw new Error("The map data service is busy.");
  const json = await r.json();
  const paths = (json.elements || [])
    .filter((e) => e.geometry?.length > 1)
    .map((e) => e.geometry.map((p) => [p.lon, p.lat]));
  db.prepare("INSERT OR REPLACE INTO geo_cache VALUES (?,?,?)").run(
    region,
    JSON.stringify(paths),
    Date.now() + 7 * DAY,
  );
  return paths;
}
function samplePaths(paths, max = 350) {
  return sampleCityPaths(
    { paths: paths.map((points, i) => ({ id: String(i), points })) },
    max,
  );
}
function publicManifest(db, w) {
  let center = w.center;
  if (w.cityId === "plzen") center = PLZEN.center;
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

function localMidnight(now, tz) {
  const day = dayKey(now, tz);
  for (let t = now + 60000; t <= now + 26 * 3600000; t += 60000)
    if (dayKey(t, tz) !== day) return Math.floor(t / 60000) * 60000;
  throw Error("Could not resolve the next local date.");
}
function localDayStart(now, tz) {
  const day = dayKey(now, tz);
  for (let t = now; t >= now - 26 * 3600000; t -= 60000)
    if (dayKey(t, tz) !== day) return (Math.floor(t / 60000) + 1) * 60000;
  throw Error("Could not resolve the start of the local date.");
}
function windowFor(z, startOfDay, end, timedTier2Slot) {
  // One premium three-hour window and one top-tier one-hour window; free play remains all-day.
  const duration =
    z.tier === 3
      ? 3600000
      : z.tier === 2 && z.slot === timedTier2Slot
        ? 3 * 3600000
        : 0;
  if (!duration) return { opensAt: startOfDay, closesAt: end };
  const hour = z.tier === 3 ? 18 : 12,
    start = end - (24 - hour) * 3600000;
  return { opensAt: start, closesAt: Math.min(end, start + duration) };
}
export async function ensureWorld(
  db,
  location = HOME,
  arena = true,
  now = Date.now(),
) {
  const city = arena ? PLZEN : cityFor(location),
    region = city
      ? `city-${city.id}`
      : latLngToCell(location.lat, location.lng, 7);
  const timezone = city?.timezone || tzLookup(...cellToLatLng(region)),
    day = dayKey(now, timezone),
    worldId = `demo:${arena ? "arena-" : ""}${region}:${day}:v2`;
  const found = db
    .prepare("SELECT manifest FROM worlds WHERE id=?")
    .get(worldId);
  if (found) return publicManifest(db, JSON.parse(found.manifest));
  if (pending.has(worldId)) return pending.get(worldId);
  const job = (async () => {
    const startsAt = localDayStart(now, timezone),
      endsAt = localMidnight(now, timezone),
      base = city ? buildCityZones(city, day) : [];
    const paths = city
      ? []
      : await publicPaths(db, region, cellToLatLng(region));
    if (city && !citySamples) citySamples = sampleCityPaths(city);
    const samples = city ? citySamples : samplePaths(paths),
      [lat, lng] = city
        ? [city.center.lat, city.center.lng]
        : cellToLatLng(region);
    const zones = base.map((z) => ({
      ...z,
      id: `${worldId}:zone:${z.slot}`,
      radius: 0,
      kind: z.tier === 1 ? "cache" : "expedition",
      ...windowFor(z, startsAt, endsAt, base.find((x) => x.tier === 2)?.slot),
      color: z.tier === 3 ? "#c29222" : z.tier === 2 ? "#672eeb" : "#258b73",
    }));
    const manifest = {
      id: worldId,
      version: 2,
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
        const defs = [
          {
            kind: "visit",
            title: "Discover the park",
            description: "Reach the marked public path and record your visit.",
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
              checkpoints: q.kind === "route" ? z.targets : [],
            }),
          );
      }
      return manifest;
    });
  })().finally(() => pending.delete(worldId));
  pending.set(worldId, job);
  return job;
}
export function worldView(db, id, player = null) {
  const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(id);
  if (!row) return null;
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
      };
    });
  const remaining =
    3 * 256 -
    db.prepare("SELECT COALESCE(SUM(minted),0) AS n FROM editions").get().n;
  return {
    ...publicManifest(db, JSON.parse(row.manifest)),
    coins: db
      .prepare(
        "SELECT id,lat,lng,value_u,claimant FROM coins WHERE world_id=? AND claimant IS NULL",
      )
      .all(id),
    quests: quests.map((q) => ({
      ...q,
      itemAvailable: q.kind === "chest" && remaining > 0,
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

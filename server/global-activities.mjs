// The playable content slice of a globally prepared day. All rows are
// imported before readiness; requests only look them up. Existing GPS, fair-
// play, XP and durable receipt code remains the authority for completion.
// Money requires a separate finalized pre-opening reservation.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { setImmediate as yieldToGame } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { cellToLatLng } from "h3-js";
import { atomic } from "./database.mjs";
import { registerGlobalRewardCandidates,decorateGlobalRewardWorld } from './global-rewards.mjs';
import { globalRewardWorkerStatus } from './global-reward-worker.mjs';
import { assert, distance } from "./domain.mjs";
import { registerModuleSchema, ensureModuleVersion } from "./schema-compatibility.mjs";
import { POI_XP, POI_QUEST_POLICY } from "./poi-quests.mjs";
import { poiQuestActivity } from "./quest-templates.mjs";
import { MAX_SNAP_M } from "./poi/safety.mjs";
import { ATLAS } from "./world-preparation/atlas.mjs";
import { utcEpoch } from "./world-preparation/calendar.mjs";
import { PREPARATION_SCHEMA, ownerCell } from "./world-preparation/schema.mjs";
import { readPreparedRegion } from "./world-preparation/read.mjs";
import { inputFile, readBounded, MAX_INPUT_BYTES } from "./world-preparation/storage.mjs";
import { canonical, sha256, requireValue } from "./world-preparation/canonical.mjs";

export const GLOBAL_ACTIVITY_POLICY = "atlas-geographic-activities/1";
export const GLOBAL_ACTIVITY_SCHEMA = registerModuleSchema({ name: "global-activities", version: 1, sql: `
CREATE TABLE IF NOT EXISTS global_activity_days(day TEXT PRIMARY KEY,content_hash TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('loading','ready')),regions INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS global_activity_regions(day TEXT NOT NULL REFERENCES global_activity_days(day),owner TEXT NOT NULL,world_id TEXT NOT NULL REFERENCES worlds(id),PRIMARY KEY(day,owner));
CREATE TABLE IF NOT EXISTS global_activity_targets(day TEXT NOT NULL,owner TEXT NOT NULL,quest_id TEXT NOT NULL REFERENCES quests(id),stop INTEGER NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL,PRIMARY KEY(day,quest_id,stop),FOREIGN KEY(day,owner) REFERENCES global_activity_regions(day,owner));
CREATE INDEX IF NOT EXISTS global_activity_targets_near ON global_activity_targets(day,lat,lng);
` });
const present = (db) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='global_activity_days'").get();

function privateRegion(root, entry) {
  const r = entry.server;
  requireValue(r && /^[a-f0-9]{64}$/.test(r.sha256) && r.path === `server/regions/${r.sha256}.json.gz`, "Invalid private region reference.");
  const bytes = readBounded(inputFile(root, r.path));
  requireValue(bytes.length === r.bytes && sha256(bytes) === r.sha256, "Private region checksum mismatch.");
  return JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_INPUT_BYTES }));
}

function runtimeRegion(manifestFile, manifest, entry) {
  const root = dirname(resolve(manifestFile)), content = readPreparedRegion(root, manifest, entry), secret = privateRegion(root, entry);
  requireValue(secret.schema === "questlayer.world-region-requirements/1" && secret.epochId === content.epoch.id && secret.region === entry.id, "Private requirements belong to another day or region.");
  const requirements = new Map(secret.objects.map((o) => [o.id, o]));
  requireValue(requirements.size === secret.objects.length && requirements.size === content.objects.length, "Public/private object identities differ.");
  const [lat, lng] = cellToLatLng(entry.id), worldId = `demo:global-${entry.id}:${manifest.epoch.day}:v2`;
  const zones = [], quests = [], zoneIds = new Set();
  for (const o of content.objects) {
    const s = requirements.get(o.id), r = s?.serverRequirements;
    requireValue(s?.kind === o.kind && r?.policy === GLOBAL_ACTIVITY_POLICY, "Unsupported activity requirements.");
    requireValue(o.windows.length === 1 && o.windows[0].startsAt === manifest.epoch.startsAt && o.windows[0].endsAt === manifest.epoch.endsAt, "This activity adapter requires a continuous full UTC day.");
    if (o.kind === "zone") {
      requireValue(r.template === "zone-entry" && o.geometry, "Invalid prepared zone.");
      const geometry = JSON.parse(readBounded(inputFile(root, o.geometry.path)));
      zones.push({ id: o.id, slot: zones.length, name: o.title, tier: 1, lat: o.target.lat, lng: o.target.lng, radius: 0, geometry, targets: [o.target], kind: "cache", sector: null, source: "global-geography", sourceId: o.source.id, opensAt: manifest.epoch.startsAt, closesAt: manifest.epoch.endsAt, color: "#258b73", areaId: o.areaId, areaSlot: o.slot });
      zoneIds.add(o.id);
    } else requireValue(o.kind === "quest", "Money, coins, NPCs and stock need their separate owner integration; this importer accepts zones and quests only.");
  }
  const systemZones = zones.length;
  for (const o of content.objects.filter((o) => o.kind === "quest")) {
    const r = requirements.get(o.id).serverRequirements;
    const hunt = r.template === "poi-category-hunt";
    requireValue(hunt || r.template === "poi-visit", "Only implemented visit and category-hunt templates can enter gameplay.");
    requireValue(Array.isArray(r.targets) && r.targets.length === (hunt ? 3 : 1) && r.targets.every((p) => Number.isFinite(p.lat) && Math.abs(p.lat) <= 85 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180), "Invalid completion targets.");
    requireValue(Array.isArray(r.sourceIds) && r.sourceIds.length === r.targets.length && new Set(r.sourceIds).size === r.sourceIds.length && r.sourceIds.every((id) => /^osm:[nwr]\d+$/.test(id)), "Completion targets need distinct source identities.");
    requireValue(distance(o.target, r.targets[0]) < 0.1, "Public and private start targets differ.");
    for (let i = 0; i < r.targets.length; i++) for (let j = 0; j < i; j++) requireValue(distance(r.targets[i], r.targets[j]) >= 55, "Distinct route stops are too close.");
    let zoneId = o.zoneId;
    if (zoneId) requireValue(zoneIds.has(zoneId), "Quest references a missing zone.");
    else {
      zoneId = `${o.id}:discovery`;
      zones.push({ id: zoneId, slot: 100 + quests.length, name: o.title, tier: 1, lat: o.target.lat, lng: o.target.lng, radius: 25, targets: r.targets, kind: "discovery", source: "poi", sourceId: o.source.id, opensAt: manifest.epoch.startsAt, closesAt: manifest.epoch.endsAt, color: "#258b73" });
    }
    const activity = poiQuestActivity(r.template, r.targets, { objective: o.instructions, policy: POI_QUEST_POLICY });
    const metadata = { zoneId, checkpoints: hunt ? r.targets : [], ...(hunt ? { unordered: true } : {}), activity, author: ATLAS, globalActivity: { policy: GLOBAL_ACTIVITY_POLICY, inputHash: manifest.inputHash, sourceIds: r.sourceIds } };
    quests.push({ id: o.id, title: o.title, description: o.instructions, target: r.targets.at(-1), kind: hunt ? "route" : "visit", xp: hunt ? POI_XP.hunt : POI_XP.visit, zoneId, metadata });
  }
  const world = { id: worldId, version: 2, day: manifest.epoch.day, region: entry.id,
    // 'poi' is the existing operator closure scope for non-city POIs. It is
    // not a funded CityPack. Native funding still only accepts its own registry.
    cityId: "poi", cityName: "Atlas discoveries", timezone: "UTC", arena: false,
    source: "OpenStreetMap contributors", center: { lat, lng }, boundary: null, paths: [], endsAt: manifest.epoch.endsAt,
    zones, cityZoneCount: systemZones, coinRadius: 35, coverage: "prepared-global-activities",
    globalPreparation: { policy: GLOBAL_ACTIVITY_POLICY, day: manifest.epoch.day, inputHash: manifest.inputHash, systemZones, financialActivation: false },
    quality: { fieldReview: "unverified", funded: false, routing: "straight-line-only", notice: "Map-derived discoveries by Atlas. Public access and paths have not been checked on foot: follow local signs and skip blocked places. These activities award personal XP; no monetary or item reward is promised." },
    poiQuests: { policy: POI_QUEST_POLICY, status: quests.length ? "ready" : "empty", count: quests.length, ...(quests.length ? {} : { notice: "No safe mapped discoveries were prepared in this area." }) },
  };
  const candidates=zones.filter(z=>z.source==='global-geography').flatMap(z=>{
    const potential=requirements.get(z.id)?.serverRequirements.potential,q=quests.find(q=>q.zoneId===z.id&&q.kind==='visit');
    return Number.isSafeInteger(potential)&&potential>=0&&q?[{objectId:z.id,questId:q.id,cell:requirements.get(z.id).areaId?.slice(5)||content.objects.find(o=>o.id===z.id).areaId.slice(5),potential}]:[];
  });
  return { world, quests,candidates };
}

function* globalActivityImport(db, manifestFile) {
  const raw = readBounded(manifestFile), manifest = JSON.parse(raw), contentHash = sha256(raw);
  requireValue(manifest.schema === PREPARATION_SCHEMA && manifest.state === "content-prepared" && manifest.activation?.permitted === false, "A complete content preparation is required.");
  const epoch = utcEpoch(manifest.epoch.day);
  requireValue(canonical(epoch) === canonical(manifest.epoch), "Invalid accounting epoch.");
  requireValue(["coin", "npc", "chest", "item"].every((kind) => manifest.counts[kind] === 0), "This runtime slice cannot activate financial or inventory objects.");
  requireValue(Array.isArray(manifest.regions) && manifest.regions.length > 0 && manifest.regions.every((r) => r.state === "prepared") && new Set(manifest.regions.map((r) => r.id)).size === manifest.regions.length, "The complete expected region inventory must be prepared.");
  ensureModuleVersion(db, GLOBAL_ACTIVITY_SCHEMA);
  const previous = db.prepare("SELECT * FROM global_activity_days WHERE day=?").get(epoch.day);
  requireValue(!previous || previous.content_hash === contentHash, "A different global day is already installed; published identities cannot be replaced.");
  if (previous?.state === "ready") return globalActivityStatus(db);
  atomic(db, () => db.prepare("INSERT OR IGNORE INTO global_activity_days VALUES(?,?,?,?,'loading',?)").run(epoch.day, contentHash, epoch.startsAt, epoch.endsAt, manifest.regions.length));
  let processed = 0;
  for (const entry of manifest.regions) {
    let prepared;
    try { prepared = runtimeRegion(manifestFile, manifest, entry); }
    catch (error) { error.region = entry.id; throw error; }
    const { world, quests,candidates } = prepared;
    atomic(db, () => {
      const existing = db.prepare("SELECT world_id FROM global_activity_regions WHERE day=? AND owner=?").get(epoch.day, entry.id);
      if (existing) { requireValue(existing.world_id === world.id, "Prepared world identity changed."); return; }
      db.prepare("INSERT INTO worlds VALUES(?,?,?,?,?,?)").run(world.id, epoch.day, entry.id, "UTC", JSON.stringify(world), epoch.startsAt);
      // Partial imports cannot be claimed even by a caller who knows an ID.
      // All openings move to the real epoch atomically with the ready marker.
      for (const q of quests) db.prepare("INSERT INTO quests(id,world_id,title,description,lat,lng,tier,gold_u,xp,kind,opens_at,closes_at,zone_id,metadata) VALUES(?,?,?,?,?,?,1,0,?,?,?,?,?,?)").run(q.id, world.id, q.title.slice(0, 120), q.description.slice(0, 280), q.target.lat, q.target.lng, q.xp, q.kind, Number.MAX_SAFE_INTEGER, epoch.endsAt, q.zoneId, JSON.stringify(q.metadata));
      db.prepare("INSERT INTO global_activity_regions VALUES(?,?,?)").run(epoch.day, entry.id, world.id);
      const target = db.prepare("INSERT INTO global_activity_targets VALUES(?,?,?,?,?,?)");
      for (const q of quests) for (const [i, p] of (q.metadata.checkpoints.length ? q.metadata.checkpoints : [q.target]).entries()) target.run(epoch.day, entry.id, q.id, i, p.lat, p.lng);
      registerGlobalRewardCandidates(db,epoch.day,candidates);
    });
    yield { day: epoch.day, state: "importing", processedRegions: ++processed, regions: manifest.regions.length };
  }
  atomic(db, () => {
    const count = db.prepare("SELECT COUNT(*) AS n FROM global_activity_regions WHERE day=?").get(epoch.day).n;
    requireValue(count === manifest.regions.length, "Global activity day is incomplete.");
    db.prepare("UPDATE quests SET opens_at=? WHERE world_id IN (SELECT world_id FROM global_activity_regions WHERE day=?)").run(epoch.startsAt, epoch.day);
    db.prepare("UPDATE global_activity_days SET state='ready' WHERE day=? AND content_hash=?").run(epoch.day, contentHash);
  });
  return globalActivityStatus(db);
}

// The synchronous entry point remains useful for isolated tools. The running
// game uses the cooperative importer so other requests run between regions.
export function installGlobalActivityDay(db, manifestFile) {
  const work = globalActivityImport(db, manifestFile);
  for (;;) { const next = work.next(); if (next.done) return next.value; }
}

export async function installGlobalActivityDayAsync(db, manifestFile, { signal, onProgress = () => {} } = {}) {
  const work = globalActivityImport(db, manifestFile);
  try {
    for (;;) {
      await yieldToGame();
      signal?.throwIfAborted();
      const next = work.next();
      if (next.done) return next.value;
      onProgress(next.value);
    }
  } finally { work.return(); }
}

export function globalActivityStatus(db) {
  if (!present(db)) return { state: "not-configured", financialActivation: false, days: [] };
  const financial=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='global_reward_days'").get();
  const days=db.prepare("SELECT day,state,regions,(SELECT COUNT(*) FROM global_activity_regions r WHERE r.day=d.day) AS loadedRegions FROM global_activity_days d ORDER BY day DESC LIMIT 3").all().map(d=>({...d,financialActivation:financial&&!!db.prepare('SELECT 1 FROM global_reward_days WHERE day=?').get(d.day)}));
  const today=new Date().toISOString().slice(0,10);
  return { state: "configured",financialActivation:days.some(d=>d.day===today&&d.financialActivation),rewards:globalRewardWorkerStatus(db),days };
}

export function preparedActivityWorld(db, location, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  let owner = ownerCell(location);
  if (present(db)) {
    // Labels own identities, but a snapped public-path target can cross the
    // ownership boundary. At that target load its existing owner, not a new
    // world in the arrival cell. The read never moves or duplicates a quest.
    const dy = MAX_SNAP_M / 110000, dx = dy / Math.cos(location.lat * Math.PI / 180);
    const candidates = db.prepare("SELECT t.owner,t.lat,t.lng,t.quest_id FROM global_activity_targets t JOIN global_activity_days d ON t.day=d.day WHERE t.day=? AND d.state='ready' AND t.lat BETWEEN ? AND ? AND t.lng BETWEEN ? AND ? ORDER BY t.quest_id,t.stop").all(day,location.lat-dy,location.lat+dy,location.lng-dx,location.lng+dx);
    const nearest = candidates.map((p) => ({ ...p, distance: distance(p, location) })).filter((p) => p.distance <= MAX_SNAP_M).sort((a,b) => a.distance-b.distance)[0];
    if (nearest) owner = nearest.owner;
  }
  const row = present(db) ? db.prepare("SELECT w.manifest FROM global_activity_regions r JOIN global_activity_days d ON r.day=d.day JOIN worlds w ON w.id=r.world_id WHERE r.day=? AND r.owner=? AND d.state='ready' AND d.starts_at<=? AND d.ends_at>?").get(day, owner, now, now) : null;
  assert(row, "No prepared discoveries are available here for today yet. Try another covered area or the demo arena.", 503, "GLOBAL_COVERAGE_UNAVAILABLE");
  return decorateGlobalRewardWorld(db,JSON.parse(row.manifest));
}

export function assertGlobalActivityReady(db, world) {
  if (!world.globalPreparation) return;
  assert(present(db) && db.prepare("SELECT 1 FROM global_activity_days d JOIN global_activity_regions r ON d.day=r.day WHERE d.day=? AND d.state='ready' AND r.world_id=?").get(world.day, world.id), "This global day is still being prepared. Please try again shortly.", 503, "GLOBAL_DAY_INCOMPLETE");
}

export function startGlobalActivityLoader(db, { directory, catalogFile, clock = Date.now, intervalMs = 60000, log = console.error } = {}) {
  if (!directory) return null;
  const cancellation = new AbortController(), days = new Map();
  let busy = false, stopped = false, child = null, preparation = { state: "idle", day: null, missingRegions: [] };
  const update = (day, value) => {
    const state = { ...(days.get(day) || {}), ...value, day };
    days.set(day, state); preparation = state;
  };
  const build = (day) => new Promise((done, fail) => {
    update(day, { state: "preparing", missingRegions: [], problems: [] });
    child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/build-global-activities.mjs", import.meta.url)), "--catalog", resolve(catalogFile), "--out", resolve(directory), "--day", day], { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (d) => { error = (error + d).slice(-2000); });
    child.once("error", fail);
    child.once("exit", (code) => {
      child = null;
      try {
        const statusFile = resolve(directory, day, "status.json");
        const status = existsSync(statusFile) ? JSON.parse(readBounded(statusFile)) : null;
        update(day, { state: code === 0 ? "prepared" : "incomplete", missingRegions: status?.regions?.filter((r) => r.state !== "prepared") || [], problems: status?.problems || (code === 0 ? [] : ["Geographic preparation failed; inspect worker logs."]) });
        if (code === 0) done(); else fail(Error(error || "Geographic preparation is incomplete."));
      } catch (cause) { fail(cause); }
    });
  });
  const run = async () => {
    if (busy || stopped) return; busy = true;
    try {
      // Freeze the two dates for this pass: a midnight crossed during a large
      // import must not accidentally skip the new current day.
      const startedAt = clock(), wanted = [0, 86400000].map(delta => new Date(startedAt + delta).toISOString().slice(0, 10));
      for (const day of days.keys()) if (!wanted.includes(day)) days.delete(day);
      for (const day of wanted) {
        if (stopped) break;
        if ((days.get(day)?.retryAt || 0) > clock()) continue;
        const file = resolve(directory, day, "manifest.json");
        try {
          if (!existsSync(file) && catalogFile) await build(day);
          if (stopped) break;
          if (!existsSync(file)) {
            update(day, { state: "awaiting-content", missingRegions: [], problems: ["No complete daily manifest has been supplied."] });
            continue;
          }
          update(day, { state: "importing", missingRegions: [], problems: [] });
          await installGlobalActivityDayAsync(db, file, { signal: cancellation.signal, onProgress: progress => update(day, progress) });
          update(day, { state: "ready", failures: 0, retryAt: null, problems: [] });
        } catch (error) {
          if (stopped) break;
          const failures = (days.get(day)?.failures || 0) + 1;
          update(day, { state: "incomplete", failures, retryAt: clock() + Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6)), ...(error.region ? { missingRegions: [{ id: error.region, state: "incomplete", reason: "Region content validation failed; inspect worker logs." }] } : {}), problems: days.get(day)?.problems?.length ? days.get(day).problems : ["The complete day could not be imported; inspect worker logs."] });
          log(`Global activity preparation unavailable for ${day}: ${error.message}`);
          // An unavailable date does not prevent preparing the following day.
        }
      }
    }
    finally { busy = false; }
  };
  const initial = setTimeout(run, 0), timer = setInterval(run, intervalMs); timer.unref(); initial.unref();
  return { run, status: () => ({ ...preparation, days: [...days.values()].map(d => ({ ...d })) }), stop() { stopped = true; cancellation.abort(); clearTimeout(initial); clearInterval(timer); child?.kill("SIGTERM"); } };
}

#!/usr/bin/env node
// World worker, wave 1 (docs/POI-PIPELINE.md): fetch -> extract -> build for
// WORLD_REGIONS, publish releases/poi-<version>.sqlite and point current.sqlite
// at it. Run by deploy/questlayer-poi.timer on the VPS; never on a player
// request path. Prints the manifest (no data) as the last line of output.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseRegions } from "./regions.mjs";
import { parseDemoCities } from "./demo-cities.mjs";
import { loadW4 } from "./lib/w4.mjs";
import { clipOsm, extractOsm } from "./extract-osm.mjs";
import {
  collectWikidataIds,
  downloadIfChanged,
  fetchGeonames,
  fetchOverture,
  fetchWikidata,
  latestOvertureRelease,
  readInputs,
  sha256File,
  verifyGeofabrikMd5,
} from "./fetch.mjs";
import { attributionMarkdown, buildPoiDatabase, writeJson } from "./build.mjs";

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [k, v] = arg.replace(/^--/, "").split("=");
  args.set(k, v ?? "1");
}
const workDir = resolve(
  args.get("work") || process.env.POI_WORK_DIR || ".data/poi",
);
mkdirSync(workDir, { recursive: true });

// last-run.json: what /api/health reports as poiWorld.lastRun. A failed run
// keeps the previous release live and records the stage and the error.
const lastRunPath = `${workDir}/last-run.json`;
const startedAt = new Date().toISOString();
let stage = "start";
function writeLastRun(extra) {
  try {
    const tmp = `${lastRunPath}.next`;
    writeFileSync(
      tmp,
      JSON.stringify(
        { startedAt, stage, pid: process.pid, ...extra },
        null,
        2,
      ) + "\n",
    );
    renameSync(tmp, lastRunPath);
  } catch {}
}
function failed(error) {
  // A second run that finds the lock must not overwrite the live run's record.
  if (stage !== "lock")
    writeLastRun({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: String(error?.message || error).slice(0, 500),
    });
  console.error(error);
  process.exit(1);
}
process.on("uncaughtException", failed);
process.on("unhandledRejection", failed);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => failed(new Error(`Stopped by ${signal}.`)));

const regions = parseRegions(args.get("regions") || process.env.WORLD_REGIONS);
// Demo cities outside the country regions: small OSM clips (demo-cities.mjs).
const cityRegions = parseDemoCities(
  args.get("cities") ?? process.env.WORLD_CITIES ?? "demo",
);
const allRegions = [...regions, ...cityRegions];
const keep = Math.max(1, Number(process.env.POI_KEEP_RELEASES || 2));
const log = (msg) => console.error(`[poi] ${new Date().toISOString()} ${msg}`);

mkdirSync(`${workDir}/inputs`, { recursive: true });
mkdirSync(`${workDir}/releases`, { recursive: true });

// Single-run lock; a lock left by a dead process is taken over.
const lockPath = `${workDir}/run.lock`;
function takeLock() {
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(readFileSync(lockPath, "utf8"));
    try {
      process.kill(pid, 0);
      throw new Error(`Another POI run (pid ${pid}) holds ${lockPath}.`);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
      rmSync(lockPath, { force: true });
      return takeLock();
    }
  }
}
stage = "lock";
takeLock();
process.on("exit", () => rmSync(lockPath, { force: true }));
stage = "start";
writeLastRun({ status: "running", regions: allRegions.map((r) => r.id) });

const inputsPath = `${workDir}/inputs.json`;
const recorded = readInputs(inputsPath);
const inputs = { regions: {}, geonames: null, wikidata: null };
const save = () => writeJson(inputsPath, inputs);

const w4 = await loadW4();
log(
  `regions ${regions.map((r) => r.id).join(",")}, demo cities ${cityRegions.length}, W4 interface: ${w4.source}`,
);

const overtureRelease =
  process.env.OVERTURE_RELEASE || (await latestOvertureRelease());
const buildInputs = {
  osmPois: [],
  osmPaths: [],
  osmExclusions: [],
  overture: [],
  wikidata: [],
  geonames: [],
};

stage = "fetch";
const builtCities = [],
  skippedCities = [];
for (const region of regions) {
  const prev = recorded.regions?.[region.id] || {};
  const pbf = `${workDir}/inputs/${region.id}-latest.osm.pbf`;
  const osm = await downloadIfChanged(region.geofabrik, pbf, prev.osm, { log });
  if (osm.changed) osm.md5 = await verifyGeofabrikMd5(region.geofabrik, pbf);
  delete osm.changed;
  inputs.regions[region.id] = { osm };
  save();
  const extracted = extractOsm({
    pbf,
    pbfSha256: osm.sha256,
    workDir,
    region: region.id,
    osmium: process.env.OSMIUM_BIN || "osmium",
    log,
  });
  buildInputs.osmPois.push(extracted.pois);
  buildInputs.osmPaths.push(extracted.paths);
  buildInputs.osmExclusions.push(extracted.exclusions);
  const overture = await fetchOverture({
    region,
    release: overtureRelease,
    workDir: `${workDir}/inputs`,
    previous: prev.overture,
    duckdb: process.env.DUCKDB_BIN || "duckdb",
    log,
  });
  delete overture.changed;
  inputs.regions[region.id].overture = { ...overture, path: undefined };
  save();
  buildInputs.overture.push({ path: overture.path, country: region.country });
}

// A demo city keeps only its clip on disk: the source extract (up to a few
// hundred MB) is deleted once the clip is cut. Unchanged Last-Modified/ETag
// and an intact clip skip the download. No Overture query: OSM only.
for (const city of cityRegions) {
  const prev = recorded.regions?.[city.id] || {};
  const clip = `${workDir}/inputs/${city.id}.clip.osm.pbf`;
  const src = `${workDir}/inputs/${city.id}.src.osm.pbf`;
  let osm;
  try {
    osm = await downloadIfChanged(
      city.source,
      clip,
      prev.osm && prev.osm.clipBbox?.join(",") === city.bbox.join(",")
        ? { ...prev.osm, bytes: prev.osm.clipBytes }
        : null,
      { log },
    );
    if (osm.changed) {
      // downloadIfChanged wrote the source to `clip`; move it aside and cut.
      renameSync(clip, src);
      if (city.sourceKind === "geofabrik")
        osm.md5 = await verifyGeofabrikMd5(city.source, src);
      clipOsm({
        pbf: src,
        out: clip,
        bbox: city.bbox,
        osmium: process.env.OSMIUM_BIN || "osmium",
      });
      rmSync(src, { force: true });
      osm.sourceBytes = osm.bytes;
      osm.sourceSha256 = osm.sha256;
      osm.clipBbox = city.bbox;
      osm.clipBytes = statSync(clip).size;
      osm.sha256 = await sha256File(clip);
    }
  } catch (error) {
    // One unreachable city never stops the import; its previous clip stays.
    rmSync(src, { force: true });
    if (!existsSync(clip) || !prev.osm?.sha256) {
      log(`demo city ${city.id} skipped: ${error.message}`);
      skippedCities.push({ id: city.id, reason: String(error.message).slice(0, 200) });
      continue;
    }
    log(`demo city ${city.id} keeps its previous clip: ${error.message}`);
    osm = prev.osm;
  }
  delete osm.changed;
  inputs.regions[city.id] = { osm, kind: "city" };
  save();
  const extracted = extractOsm({
    pbf: clip,
    pbfSha256: osm.sha256,
    workDir,
    region: city.id,
    osmium: process.env.OSMIUM_BIN || "osmium",
    log,
  });
  buildInputs.osmPois.push(extracted.pois);
  buildInputs.osmPaths.push(extracted.paths);
  buildInputs.osmExclusions.push(extracted.exclusions);
  builtCities.push(city);
}

stage = "geonames";
const geonames = await fetchGeonames({
  workDir: `${workDir}/inputs`,
  previous: recorded.geonames,
  log,
});
delete geonames.changed;
inputs.geonames = { ...geonames, path: undefined };
buildInputs.geonames.push({
  path: geonames.path,
  countries: regions.map((r) => r.country),
});
save();

stage = "wikidata";
const wikidataCache = `${workDir}/inputs/wikidata.ndjson`;
const ids = await collectWikidataIds(buildInputs.osmPois);
const wd = await fetchWikidata({ ids, cachePath: wikidataCache, log });
buildInputs.wikidata.push(wikidataCache);
inputs.wikidata = {
  endpoint: "https://query.wikidata.org/sparql",
  items: wd.items,
};
save();

if (process.env.POI_CLOSURES_FILE && existsSync(process.env.POI_CLOSURES_FILE))
  buildInputs.closures = JSON.parse(
    readFileSync(process.env.POI_CLOSURES_FILE, "utf8"),
  );

// The version names the inputs: same inputs and rules, same file.
const osmDate = Object.values(inputs.regions)
  .map((r) =>
    new Date(r.osm.lastModified || r.osm.fetchedAt)
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", ""),
  )
  .sort()
  .at(-1);
const inputHash = createHash("sha256")
  .update(
    JSON.stringify([
      Object.entries(inputs.regions).map(([id, r]) => [
        id,
        r.osm.sha256,
        r.overture?.sha256 ?? null,
      ]),
      inputs.geonames.sha256,
      ids.length,
      w4.taxonomyVersion,
      w4.safetyVersion,
      buildInputs.closures?.length || 0,
    ]),
  )
  .digest("hex")
  .slice(0, 8);
// Demo cities add "-c<count>" so the version stays short (the city ids are in
// the input hash and in manifest.regions).
const version = `${regions.map((r) => r.id).join("-")}${builtCities.length ? `-c${builtCities.length}` : ""}-${osmDate}-${inputHash}`;
const file = `${workDir}/releases/poi-${version}.sqlite`;
const manifestPath = `${workDir}/releases/poi-${version}.manifest.json`;

stage = "build";
let manifest;
if (existsSync(file) && existsSync(manifestPath) && !args.has("rebuild")) {
  log(`release ${version} already built`);
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} else {
  log(`building ${version}`);
  manifest = await buildPoiDatabase({
    inputs: buildInputs,
    outPath: file,
    version,
    regions: [...regions, ...builtCities].map((r) => r.id),
    w4,
    log,
  });
  const sources = [
    ...Object.entries(inputs.regions).flatMap(([id, r]) => r.kind === "city" ? [
      {
        source: `openstreetmap:${id}`,
        url: r.osm.url,
        version: r.osm.lastModified,
        sha256: r.osm.sha256,
        clip: r.osm.clipBbox,
        licence: "ODbL-1.0",
      },
    ] : [
      {
        source: `openstreetmap:${id}`,
        url: r.osm.url,
        version: r.osm.lastModified,
        sha256: r.osm.sha256,
        licence: "ODbL-1.0",
      },
      {
        source: `overture-places:${id}`,
        url: r.overture.url,
        version: r.overture.release,
        sha256: r.overture.sha256,
        licence: "CDLA-Permissive-2.0",
      },
    ]),
    {
      source: "geonames",
      url: inputs.geonames.url,
      version: inputs.geonames.lastModified,
      sha256: inputs.geonames.sha256,
      licence: "CC-BY-4.0",
    },
    {
      source: "wikidata",
      url: inputs.wikidata.endpoint,
      version: `${ids.length} items`,
      licence: "CC0-1.0",
    },
  ];
  manifest = {
    ...manifest,
    demoCities: builtCities.map((c) => c.cityId),
    inputs: sources,
    builtAt: new Date().toISOString(),
  };
  writeJson(manifestPath, manifest);
  writeFileSync(
    `${workDir}/releases/poi-${version}.ATTRIBUTION.md`,
    attributionMarkdown(manifest, sources),
  );
}

stage = "publish";
// Atomically repoint current.* and keep the newest `keep` releases.
for (const [link, target] of [
  ["current.sqlite", `releases/poi-${version}.sqlite`],
  ["current.manifest.json", `releases/poi-${version}.manifest.json`],
  ["ATTRIBUTION.md", `releases/poi-${version}.ATTRIBUTION.md`],
]) {
  const tmp = `${workDir}/${link}.next`;
  rmSync(tmp, { force: true });
  symlinkSync(target, tmp);
  renameSync(tmp, `${workDir}/${link}`);
}
const releases = readdirSync(`${workDir}/releases`)
  .filter((f) => /^poi-.+\.sqlite$/.test(f))
  .map((f) => f.slice(4, -7))
  .filter((v) => v !== version)
  .sort(
    (a, b) =>
      a.split("-").at(-2).localeCompare(b.split("-").at(-2)) ||
      a.localeCompare(b),
  );
for (const old of releases.slice(0, Math.max(0, releases.length - (keep - 1))))
  for (const suffix of [".sqlite", ".manifest.json", ".ATTRIBUTION.md"])
    rmSync(`${workDir}/releases/poi-${old}${suffix}`, { force: true });

// W5: auto CityPacks from this release (docs/WORLDS-PLAN.md C.3 point 7).
// A failure here never withdraws the POI release; the previous packs stay.
let autoCities = null;
if (process.env.AUTO_CITIES !== "0") {
  stage = "auto-cities";
  try {
    const { runAutoCities } = await import("./auto-cities.mjs");
    const auto = await runAutoCities({
      workDir,
      regions: [...regions, ...builtCities].map((r) => r.id),
      minPopulation: Number(process.env.AUTO_CITY_MIN_POP || 15000),
      log: (m) => log(m),
    });
    autoCities = {
      version: auto.index.version,
      published: auto.report.published,
      selected: auto.report.selected,
    };
    log(
      `auto cities ${auto.index.version}: ${auto.report.published}/${auto.report.selected} published`,
    );
  } catch (error) {
    log(`auto cities failed: ${error.stack || error.message}`);
    autoCities = { error: String(error.message).slice(0, 300) };
    process.exitCode = 1;
  }
}

stage = "done";
writeLastRun({
  status: "ok",
  finishedAt: new Date().toISOString(),
  version,
  pois: manifest.counts?.pois ?? null,
  demoCities: { built: builtCities.map((c) => c.cityId), skipped: skippedCities },
  autoCities,
});
console.log(JSON.stringify(manifest));

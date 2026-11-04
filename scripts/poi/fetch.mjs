// Downloads the POI inputs. Every stage is resumable: a file whose recorded
// Last-Modified/ETag (or release) still matches is not fetched again, and
// every input's URL, version and SHA-256 lands in inputs.json.
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  renameSync,
  rmSync,
  statSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { readJsonLines } from "./lib/ndjson.mjs";

export const USER_AGENT =
  "QuestLayerPOI/1.0 (+https://questlayer.promptstudio3000.com/how-it-works)";
export const GEONAMES_URL =
  "https://download.geonames.org/export/dump/cities15000.zip";
export const OVERTURE_BUCKET =
  "https://overturemaps-us-west-2.s3.amazonaws.com";
export const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

export async function sha256File(path, algorithm = "sha256") {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function head(url) {
  const res = await fetch(url, {
    method: "HEAD",
    headers: { "user-agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`HEAD ${url}: ${res.status}`);
  return {
    lastModified: res.headers.get("last-modified"),
    etag: res.headers.get("etag"),
    bytes: Number(res.headers.get("content-length")) || null,
  };
}

// Downloads url to dest unless `previous` (an inputs.json entry) still
// matches the server's Last-Modified/ETag and the file is intact.
export async function downloadIfChanged(
  url,
  dest,
  previous,
  { log = () => {} } = {},
) {
  const remote = await head(url);
  if (
    previous &&
    existsSync(dest) &&
    previous.url === url &&
    (previous.etag
      ? previous.etag === remote.etag
      : previous.lastModified === remote.lastModified) &&
    statSync(dest).size === previous.bytes
  ) {
    log(`unchanged ${url}`);
    return { ...previous, changed: false };
  }
  log(`downloading ${url}`);
  const part = `${dest}.part`;
  rmSync(part, { force: true });
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`GET ${url}: ${res.status}`);
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(part),
  );
  renameSync(part, dest);
  return {
    url,
    lastModified: remote.lastModified,
    etag: remote.etag,
    bytes: statSync(dest).size,
    sha256: hash.digest("hex"),
    fetchedAt: new Date().toISOString(),
    changed: true,
  };
}

// Geofabrik publishes <file>.md5 next to every extract.
export async function verifyGeofabrikMd5(url, path) {
  const res = await fetch(`${url}.md5`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`GET ${url}.md5: ${res.status}`);
  const expected = (await res.text()).trim().split(/\s+/)[0];
  const actual = await sha256File(path, "md5");
  if (expected !== actual)
    throw new Error(`MD5 mismatch for ${path}: ${actual} != ${expected}`);
  return expected;
}

export async function latestOvertureRelease() {
  const res = await fetch(
    `${OVERTURE_BUCKET}/?list-type=2&prefix=release/&delimiter=/`,
    {
      headers: { "user-agent": USER_AGENT },
    },
  );
  if (!res.ok) throw new Error(`Overture release listing: ${res.status}`);
  const releases = [
    ...(await res.text()).matchAll(
      /<Prefix>release\/([0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+)\/<\/Prefix>/g,
    ),
  ]
    .map((m) => m[1])
    .sort();
  if (!releases.length) throw new Error("No Overture release found.");
  return releases.at(-1);
}

export function overtureSql(release, [west, south, east, north], outPath) {
  for (const v of [west, south, east, north])
    if (!Number.isFinite(v)) throw new Error("Bad bbox.");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$/.test(release))
    throw new Error("Bad Overture release.");
  if (!/^[\w./-]+$/.test(outPath)) throw new Error("Bad output path.");
  return `INSTALL httpfs; LOAD httpfs;
CREATE OR REPLACE SECRET overture_anonymous (TYPE s3, KEY_ID '', SECRET '', REGION 'us-west-2');
SET memory_limit='1GB'; SET threads=2;
COPY (
  SELECT id, names."primary" AS name, taxonomy."primary" AS category, basic_category,
         confidence, operating_status, addresses[1].country AS country,
         (bbox.xmin + bbox.xmax) / 2 AS lng, (bbox.ymin + bbox.ymax) / 2 AS lat,
         sources[1].dataset AS dataset
  FROM read_parquet('s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN ${west} AND ${east} AND bbox.ymin BETWEEN ${south} AND ${north}
    AND names."primary" IS NOT NULL
  ORDER BY id
) TO '${outPath}' (FORMAT JSON);`;
}

export async function fetchOverture({
  region,
  release,
  workDir,
  previous,
  duckdb = "duckdb",
  log = () => {},
}) {
  const out = `${workDir}/overture-${region.id}-${release}.ndjson`;
  if (previous?.release === release && existsSync(out) && previous.sha256) {
    log(`unchanged overture ${release} for ${region.id}`);
    return { ...previous, path: out, changed: false };
  }
  log(`querying overture ${release} for ${region.id}`);
  const part = `${out}.part`;
  rmSync(part, { force: true });
  execFileSync(
    duckdb,
    ["-batch", "-c", overtureSql(release, region.bbox, part)],
    {
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: "",
        AWS_SECRET_ACCESS_KEY: "",
        AWS_SESSION_TOKEN: "",
      },
    },
  );
  renameSync(part, out);
  return {
    release,
    url: `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/`,
    bbox: region.bbox,
    path: out,
    bytes: statSync(out).size,
    sha256: await sha256File(out),
    fetchedAt: new Date().toISOString(),
    changed: true,
  };
}

export async function fetchGeonames({ workDir, previous, log }) {
  const zip = `${workDir}/cities15000.zip`;
  const meta = await downloadIfChanged(GEONAMES_URL, zip, previous, { log });
  const txt = `${workDir}/cities15000.txt`;
  if (meta.changed || !existsSync(txt))
    writeFileSync(
      txt,
      execFileSync("unzip", ["-p", zip, "cities15000.txt"], {
        maxBuffer: 256 * 1024 * 1024,
      }),
    );
  return { ...meta, path: txt };
}

export async function collectWikidataIds(paths) {
  const ids = new Set();
  for (const path of paths)
    for await (const feature of readJsonLines(path)) {
      const q = feature?.properties?.wikidata;
      if (typeof q === "string" && /^Q\d+$/.test(q)) ids.add(q);
    }
  return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function wikidataQuery(ids) {
  for (const id of ids)
    if (!/^Q\d+$/.test(id)) throw new Error(`Bad Wikidata id ${id}`);
  return `SELECT ?item ?sitelinks ?inception ?lang ?label ?description WHERE {
  VALUES ?item { ${ids.map((id) => `wd:${id}`).join(" ")} }
  ?item wikibase:sitelinks ?sitelinks.
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { VALUES ?lang { "cs" "en" "de" "sk" "pl" }
    ?item rdfs:label ?label. FILTER(LANG(?label) = ?lang)
    OPTIONAL { ?item schema:description ?description. FILTER(LANG(?description) = ?lang) } }
}`;
}

// Cache version: v2 adds the inception year (P571) used by landmark-clue
// quests. Cached items of an older version are fetched again once.
export const WIKIDATA_CACHE_VERSION = 2;

/** Year of a Wikidata time value ("1350-01-01T00:00:00Z", "-0500-…"), or null. */
export function wikidataYear(value) {
  const m = /^([+-]?)(\d{1,6})-/.exec(String(value || ""));
  if (!m) return null;
  const year = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  return Number.isInteger(year) && year > -3000 && year <= 2100 ? year : null;
}

export function parseWikidataBindings(json) {
  const items = new Map();
  for (const b of json?.results?.bindings || []) {
    const id = b.item?.value?.split("/").pop();
    if (!/^Q\d+$/.test(id || "")) continue;
    let item = items.get(id);
    if (!item)
      items.set(
        id,
        (item = {
          id,
          v: WIKIDATA_CACHE_VERSION,
          sitelinks: Number(b.sitelinks?.value) || 0,
          labels: {},
          descriptions: {},
        }),
      );
    // Several inception statements: the earliest year is kept.
    const year = wikidataYear(b.inception?.value);
    if (year !== null && (item.inception === undefined || year < item.inception)) item.inception = year;
    const lang = b.lang?.value;
    if (lang && b.label?.value) item.labels[lang] = b.label.value;
    if (lang && b.description?.value)
      item.descriptions[lang] = b.description.value.slice(0, 200);
  }
  return [...items.values()];
}

// Appends to an ndjson cache so an interrupted run continues where it stopped.
export async function fetchWikidata({
  ids,
  cachePath,
  batch = 250,
  log = () => {},
  fetchImpl = fetch,
  pauseMs = 1000,
}) {
  const done = new Set();
  for await (const item of readJsonLines(cachePath))
    if ((item.v || 1) >= WIKIDATA_CACHE_VERSION) done.add(item.id);
  const missing = ids.filter((id) => !done.has(id));
  log(`wikidata: ${ids.length} ids, ${missing.length} to fetch`);
  for (let i = 0; i < missing.length; i += batch) {
    const chunk = missing.slice(i, i + batch);
    let json = null;
    for (let attempt = 0; attempt < 4 && !json; attempt++) {
      const res = await fetchImpl(WIKIDATA_SPARQL, {
        method: "POST",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query: wikidataQuery(chunk) }).toString(),
      });
      if (res.ok) json = await res.json();
      else
        await new Promise((r) => setTimeout(r, pauseMs * 2 ** (attempt + 1)));
    }
    if (!json) throw new Error(`Wikidata batch ${i / batch} failed.`);
    const found = parseWikidataBindings(json);
    const seen = new Set(found.map((f) => f.id));
    // Ids without a result are cached as empty so they are not retried forever.
    const lines = [
      ...found,
      ...chunk
        .filter((id) => !seen.has(id))
        .map((id) => ({ id, v: WIKIDATA_CACHE_VERSION, sitelinks: 0, labels: {}, descriptions: {} })),
    ]
      .map((item) => JSON.stringify(item))
      .join("\n");
    appendFileSync(cachePath, `${lines}\n`);
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { items: ids.length, fetched: missing.length };
}

export function readInputs(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

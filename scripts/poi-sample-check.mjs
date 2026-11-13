#!/usr/bin/env node
// Automatic field check of POI quest targets (W12, docs/WORLD-COVERAGE.md).
//
//   npm run world:sample-check -- [--poi <current.sqlite>] [--sample 50] [--seed text]
//                                 [--out output/qa/poi-sample-check] [--delay-ms 2000]
//
// Picks a seeded sample of quest-ready OpenStreetMap places from the POI file,
// asks Overpass once per place (one request at a time, retries, a pause between) and
// writes report.json + report.md into <out>/<POI version>/. Read-only: it
// never changes the POI file or the game database.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { livePoiQueryBox } from "../server/poi/live-source.mjs";
import { MAP_USER_AGENT, boundedJson } from "../server/spatial/map-data.mjs";
import { compareCell, pickSample, summarize } from "../server/poi/sample-check.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const opt = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const [k, v] = a.slice(2).split("=");
  opt.set(k, v ?? process.argv[++i]);
}
const poiPath = opt.get("poi") || process.env.POI_DB_PATH || "/var/lib/questlayer-poi/current.sqlite";
const size = Number(opt.get("sample") || 50);
const seed = opt.get("seed") || "poi-sample";
const delayMs = Number(opt.get("delay-ms") || 2000);
const url = process.env.POI_LIVE_URL || "https://overpass-api.de/api/interpreter";

const db = new DatabaseSync(poiPath, { readOnly: true });
const version = db.prepare("SELECT value FROM meta WHERE key='version'").get()?.value || "unknown";
const sample = pickSample(db, { size, seed });
db.close();

// One small query per place (about 300 m around its check-in point, enough for
// its grounds and paths): the public Overpass server times out on whole cells.
const PAD = 0.003;
async function ask(r) {
  const query = livePoiQueryBox([r.lat - PAD, r.lng - PAD * 1.5, r.lat + PAD, r.lng + PAD * 1.5]);
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "User-Agent": MAP_USER_AGENT },
        signal: AbortSignal.timeout(90_000),
      });
      return await boundedJson(res, 16 * 1024 * 1024);
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 15_000 * (attempt + 1)));
    }
  }
  throw last;
}
const results = [];
for (const r of sample) {
  try {
    const json = await ask(r);
    results.push(...compareCell([r], json?.elements || []));
  } catch (e) {
    results.push({ ...r, status: "unchecked", error: String(e?.message || e).slice(0, 120) });
  }
  await new Promise((ok) => setTimeout(ok, delayMs));
}

const summary = summarize(results);
const out = join(resolve(ROOT, opt.get("out") || "output/qa/poi-sample-check"), version);
mkdirSync(out, { recursive: true });
const report = { schema: "questlayer.poi-sample-check/1", version, seed, checkedAt: new Date().toISOString(), summary, results };
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const osm = (id) => `https://www.openstreetmap.org/${{ n: "node", w: "way", r: "relation" }[id[4]]}/${id.slice(5)}`;
const lines = [
  `# POI sample check ${version}`,
  "",
  `Seed \`${seed}\`, ${summary.sampled} places, ${summary.checked} checked, still fine: ${summary.okShare === null ? "n/a" : `${(summary.okShare * 100).toFixed(1)} %`}.`,
  "",
  "| Status | Count |",
  "| --- | --- |",
  ...Object.entries(summary.byStatus).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "| Place | Status | Detail |",
  "| --- | --- | --- |",
  ...results.map((r) => `| [${(r.name || r.id).replace(/\|/g, "/")}](${osm(r.id)}) | ${r.status} | ${r.reasons?.join(", ") || (r.movedM ? `${r.movedM} m` : "") || r.liveName || r.error || ""} |`),
  "",
];
writeFileSync(join(out, "report.md"), lines.join("\n"));
console.log(JSON.stringify({ out, ...summary }));

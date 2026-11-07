// Bounded, one-off real-data pilot. Never use public Overpass to crawl the
// planet: global releases use operator-supplied bulk extracts and this catalog
// contract. Existing raw downloads are immutable and reused on retry.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { latLngToCell, cellToParent } from "h3-js";
import { canonical, sha256 } from "../server/world-preparation/canonical.mjs";

const flag = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--out") || !process.argv.includes("--commit"))
  throw Error("Use --out <isolated-directory> --commit <source-commit>.");
const root = resolve(flag("--out")), commit = flag("--commit");
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("Supply the full source commit.");
mkdirSync(root, { recursive: true });
// These are query centers, not invented POIs or game targets. Actual object
// names, geometry, labels and targets must come from the returned map data.
const sites = [
  ["berlin", "DE", 52.514, 13.355],
  ["cape-town", "ZA", -33.926, 18.416],
  ["tokyo", "JP", 35.69, 139.69],
  ["new-york", "US", 40.731, -73.997],
  ["buenos-aires", "AR", -34.595, -58.377],
  ["sydney", "AU", -33.873, 151.211],
];
const descriptors = [], failures = [];
for (const [id, country, lat, lng] of sites) {
  const file = `${id}.json`, path = resolve(root, file);
  const core = [lng - 0.007, lat - 0.007, lng + 0.007, lat + 0.007];
  const marginLat = 1100 / 110000, marginLng = marginLat / Math.cos(lat * Math.PI / 180);
  const bounds = [core[0] - marginLng, core[1] - marginLat, core[2] + marginLng, core[3] + marginLat];
  try {
    if (!existsSync(path)) {
      const box = [bounds[1], bounds[0], bounds[3], bounds[2]].join(",");
      const keys = ["highway", "amenity", "leisure", "landuse", "natural", "historic", "tourism", "access", "barrier", "railway", "military"];
      const query = `[out:json][timeout:25][maxsize:67108864];(${keys.map((key) => `nwr[${key}](${box});`).join("")});out body geom;`;
      const response = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "QuestLayer-geography-pilot/1 (six bounded extracts; source: github.com/promptstudio3000/questlayer-hackathon)" }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw Error(`Overpass HTTP ${response.status}`);
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) throw Error("Pilot extract exceeds 64 MiB."); chunks.push(chunk); }
      const raw = Buffer.concat(chunks), parsed = JSON.parse(raw);
      if (parsed.remark || !Array.isArray(parsed.elements)) throw Error(parsed.remark || "Incomplete Overpass response.");
      writeFileSync(path, raw, { flag: "wx" });
    }
    const raw = readFileSync(path), parsed = JSON.parse(raw);
    const owners = new Set([cellToParent(latLngToCell(lat, lng, 7), 5)]);
    for (const e of parsed.elements) {
      const points = e.type === "node" ? [e] : (e.geometry || e.members?.flatMap((m) => m.geometry || []) || []);
      for (const p of points) if (p.lon >= core[0] && p.lon <= core[2] && p.lat >= core[1] && p.lat <= core[3]) owners.add(cellToParent(latLngToCell(p.lat, p.lon, 7), 5));
    }
    for (const owner of [...owners].sort()) descriptors.push({ id: owner, status: "complete", file, sha256: sha256(raw), countries: [country], coreBounds: core, contextBounds: bounds, sourceDate: parsed.osm3s?.timestamp_osm_base, coverageReason: `Bounded ${id} pilot extract; coverage of this H3 cell is partial.` });
    console.log(`${id}: ${parsed.elements.length} source elements, ${owners.size} owner cells`);
  } catch (error) {
    failures.push({ site: id, reason: error.message });
    descriptors.push({ id: cellToParent(latLngToCell(lat, lng, 7), 5), status: "incomplete", reason: `${id}: ${error.message}` });
    console.error(`${id}: ${error.message}`);
  }
}
const catalog = { schema: "questlayer.geography-catalog/1", sourceCommit: commit, version: "six-continent-osm-pilot", regions: descriptors, closures: [], recentPoiIds: [] };
writeFileSync(resolve(root, "catalog.json"), canonical(catalog));
writeFileSync(resolve(root, "collection-report.json"), JSON.stringify({ failures, complete: descriptors.filter((d) => d.status === "complete").length, source: "https://overpass-api.de/api/interpreter", license: "ODbL-1.0", attribution: "OpenStreetMap contributors", attributionUrl: "https://www.openstreetmap.org/copyright", scope: "six bounded pilot extracts, not worldwide coverage or field review" }, null, 2));
if (failures.length) process.exitCode = 2;

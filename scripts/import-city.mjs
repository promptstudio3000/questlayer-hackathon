// Download Overpass source fixtures for a second-city CityPack review.
// Usage: node scripts/import-city.mjs --id brno --bbox south,west,north,east
// Writes .data/imports/<id>-parks.json and <id>-paths.json; never touches a live pack.
import { mkdirSync, writeFileSync } from "node:fs";
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? "" : process.argv[i + 1] || "";
};
const id = arg("id"),
  box = arg("bbox").split(",").map(Number);
if (
  !/^[a-z][a-z0-9-]{1,31}$/.test(id) ||
  box.length !== 4 ||
  box.some((n) => !Number.isFinite(n))
)
  throw Error("Use --id <city> --bbox south,west,north,east");
const bbox = `(${box.join(",")})`;
const queries = {
  parks: `[out:json][timeout:60];way[leisure=park]${bbox};out tags geom;`,
  paths:
    "[out:json][timeout:60];(" +
    ["footway", "pedestrian", "path", "living_street"]
      .map(
        (h) =>
          `way[highway=${h}][access!=private][access!=no][foot!=no]${bbox};`,
      )
      .join("") +
    ");out tags geom 3500;",
};
mkdirSync(".data/imports", { recursive: true });
for (const [name, data] of Object.entries(queries)) {
  let saved = false;
  for (const endpoint of [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ]) {
    try {
      const r = await fetch(endpoint + "?" + new URLSearchParams({ data }), {
        headers: { "User-Agent": "QuestLayer development map-data importer" },
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) continue;
      const json = await r.json();
      if (!Array.isArray(json.elements)) continue;
      writeFileSync(`.data/imports/${id}-${name}.json`, JSON.stringify(json));
      console.log(
        `${name}: ${json.elements.length} source elements saved for review`,
      );
      saved = true;
      break;
    } catch {}
  }
  if (!saved) throw Error(`No map provider returned ${name}; try again later.`);
}

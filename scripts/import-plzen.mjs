// Download source fixtures for a reviewed CityPack revision; never overwrite a live manifest.
import { mkdirSync, writeFileSync } from "node:fs";
const bbox = "(49.708,13.31,49.79,13.44)";
const queries = {
  parks:
    "[out:json][timeout:60];way[leisure=park](49.69,13.28,49.82,13.46);out tags geom;",
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
      writeFileSync(`.data/imports/plzen-${name}.json`, JSON.stringify(json));
      console.log(
        `${name}: ${json.elements.length} source elements saved for review`,
      );
      saved = true;
      break;
    } catch {}
  }
  if (!saved)
    throw Error(
      `No map provider returned ${name}; keep the previous reviewed snapshot.`,
    );
}

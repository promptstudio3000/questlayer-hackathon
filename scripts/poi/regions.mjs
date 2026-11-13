// Regions the World worker can import (docs/POI-PIPELINE.md). One entry per
// country extract; WORLD_REGIONS=cz,sk,... picks which ones a run builds.
export const REGIONS = Object.freeze({
  cz: Object.freeze({
    id: "cz",
    country: "CZ",
    name: "Czechia",
    geofabrik:
      "https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf",
    // west, south, east, north; used for the Overture bbox query only.
    bbox: Object.freeze([12.09, 48.55, 18.86, 51.06]),
  }),
  sk: Object.freeze({
    id: "sk",
    country: "SK",
    name: "Slovakia",
    geofabrik: "https://download.geofabrik.de/europe/slovakia-latest.osm.pbf",
    bbox: Object.freeze([16.83, 47.73, 22.57, 49.62]),
  }),
  at: Object.freeze({
    id: "at",
    country: "AT",
    name: "Austria",
    geofabrik: "https://download.geofabrik.de/europe/austria-latest.osm.pbf",
    bbox: Object.freeze([9.52, 46.37, 17.17, 49.03]),
  }),
});

export const DEFAULT_REGIONS = "cz";

export function parseRegions(value = DEFAULT_REGIONS) {
  const ids = String(value || DEFAULT_REGIONS)
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!ids.length) throw new Error("WORLD_REGIONS is empty.");
  const unique = [...new Set(ids)].sort();
  for (const id of unique)
    if (!REGIONS[id])
      throw new Error(
        `Unknown region "${id}". Known: ${Object.keys(REGIONS).join(", ")}.`,
      );
  return unique.map((id) => REGIONS[id]);
}

// Small hand-made Czechia fixture for the coverage report and the "play in
// Brno" / "play in a village" journeys (docs/WORLD-COVERAGE.md). Coordinates
// are approximate public places in Brno and in the village of Holašovice;
// every place gets a short public footway ~11 m north of it so W4 can snap a
// check-in target. Nothing here is real OSM data, so no licence applies, but
// the shapes match what scripts/poi/extract-osm.mjs writes.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BRNO = Object.freeze({ lat: 49.19522, lng: 16.60796 });
export const VILLAGE = Object.freeze({
  name: "Holašovice",
  lat: 48.96965,
  lng: 14.2736,
});
// A forest spot with no mapped places (truthful empty state).
export const EMPTY = Object.freeze({ lat: 48.985, lng: 13.6 });

let nextId = 1000;
const place = (lng, lat, tags) => ({ lng, lat, tags });

const BRNO_PLACES = [
  place(16.60815, 49.19505, { place: "square", name: "Náměstí Svobody" }),
  place(16.608, 49.1953, { tourism: "artwork", name: "Brněnský orloj" }),
  place(16.60855, 49.19225, { amenity: "fountain", name: "Kašna Parnas" }),
  place(16.608, 49.1924, { amenity: "marketplace", name: "Zelný trh" }),
  place(16.5994, 49.1944, {
    historic: "castle",
    name: "Špilberk",
    wikidata: "Q725591",
  }),
  place(16.5985, 49.195, { tourism: "viewpoint", name: "Vyhlídka Špilberk" }),
  place(16.6105, 49.1908, { leisure: "park", name: "Denisovy sady" }),
  place(16.6089, 49.2067, { leisure: "park", name: "Lužánky" }),
  place(16.608, 49.198, { place: "square", name: "Moravské náměstí" }),
  place(16.5841, 49.2038, {
    man_made: "observatory",
    name: "Hvězdárna Kraví hora",
  }),
  place(16.5826, 49.212, { highway: "trailhead", name: "Wilsonův les" }),
  place(16.583, 49.2125, {
    tourism: "information",
    information: "board",
    name: "Mapa Wilsonova lesa",
  }),
  // Inside the school ground below: excluded, inside-school.
  place(16.6152, 49.2002, { historic: "memorial", name: "Pomník u školy" }),
  // No footway is written for this one: excluded, no-public-path.
  place(16.63, 49.17, { amenity: "fountain", name: "Kašna bez cesty" }),
];

const VILLAGE_PLACES = [
  place(14.2736, 48.96965, { place: "square", name: "Náves Holašovice" }),
  place(14.274, 48.9696, {
    historic: "wayside_shrine",
    name: "Kaplička sv. Jana Nepomuckého",
  }),
  place(14.272, 48.9694, {
    tourism: "information",
    information: "board",
    name: "Památková rezervace Holašovice",
  }),
  place(14.279, 48.9735, { historic: "wayside_cross", name: "Boží muka" }),
  place(14.268, 48.966, { highway: "trailhead", name: "Stezka Blanský les" }),
];

const NO_PATH = new Set(["Kašna bez cesty"]);
const SCHOOL = [
  [16.6148, 49.1999],
  [16.6156, 49.1999],
  [16.6156, 49.2005],
  [16.6148, 49.2005],
  [16.6148, 49.1999],
];

const feature = (geometry, properties) => ({
  type: "Feature",
  geometry,
  properties,
});

function footwayNorthOf({ lng, lat }) {
  return [
    [lng - 0.0005, lat + 0.0001],
    [lng + 0.0005, lat + 0.0001],
  ];
}

// Streets through the middle of each cell so street worlds get coins and the
// NPC graph gets connected components: three lines crossing at the spot,
// one point every ~25 m (the midpoint is the spot itself, so they join).
function line(spot, dLng, dLat, n = 40) {
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = (k - n / 2) / (n / 2);
    return [round7(spot.lng + dLng * t), round7(spot.lat + dLat * t)];
  });
}
const round7 = (v) => Math.round(v * 1e7) / 1e7;
function cross(spot) {
  return [line(spot, 0.006, 0), line(spot, 0, 0.004), line(spot, 0.004, 0.003)];
}

/** Map path snapshot ([[lng,lat],...] lines) around a spot, for geo_cache. */
export function pathsAround(spot) {
  const all = [...BRNO_PLACES, ...VILLAGE_PLACES]
    .filter((p) => !NO_PATH.has(p.tags.name))
    .filter(
      (p) =>
        Math.abs(p.lat - spot.lat) < 0.03 && Math.abs(p.lng - spot.lng) < 0.04,
    )
    .map(footwayNorthOf);
  return [...cross(spot), ...all];
}

/** Writes the W3 build inputs into dir and returns them for buildPoiDatabase. */
export function writeCzechiaFixture(dir) {
  mkdirSync(dir, { recursive: true });
  nextId = 1000;
  const pois = [],
    paths = [];
  for (const p of [...BRNO_PLACES, ...VILLAGE_PLACES]) {
    const id = nextId++;
    pois.push(
      feature(
        { type: "Point", coordinates: [p.lng, p.lat] },
        { "@type": "node", "@id": id, ...p.tags },
      ),
    );
    if (!NO_PATH.has(p.tags.name))
      paths.push(
        feature(
          { type: "LineString", coordinates: footwayNorthOf(p) },
          { "@type": "way", "@id": id + 50_000, highway: "footway" },
        ),
      );
  }
  for (const spot of [BRNO, VILLAGE])
    for (const line of cross(spot))
      paths.push(
        feature(
          { type: "LineString", coordinates: line },
          { "@type": "way", "@id": nextId++ + 50_000, highway: "footway" },
        ),
      );
  const exclusions = [
    feature(
      { type: "Polygon", coordinates: [SCHOOL] },
      { "@type": "way", "@id": 90_001, amenity: "school", name: "ZŠ Brno" },
    ),
  ];
  const lines = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const files = {
    osmPois: join(dir, "osm-pois.geojsonseq"),
    osmPaths: join(dir, "osm-paths.geojsonseq"),
    osmExclusions: join(dir, "osm-exclusions.geojsonseq"),
    overture: join(dir, "overture.ndjson"),
    wikidata: join(dir, "wikidata.ndjson"),
    geonames: join(dir, "cities15000.txt"),
  };
  writeFileSync(files.osmPois, lines(pois));
  writeFileSync(files.osmPaths, lines(paths));
  writeFileSync(files.osmExclusions, lines(exclusions));
  writeFileSync(files.overture, "");
  writeFileSync(
    files.wikidata,
    lines([
      {
        id: "Q725591",
        sitelinks: 31,
        labels: { cs: "Špilberk", en: "Špilberk Castle" },
        descriptions: { en: "castle in Brno" },
      },
    ]),
  );
  const geo = (id, name, lat, lng, pop) =>
    [
      id,
      name,
      name,
      name,
      lat,
      lng,
      "P",
      "PPLA",
      "CZ",
      "",
      "78",
      "",
      "",
      "",
      pop,
      "",
      "230",
      "Europe/Prague",
      "2024-01-01",
    ].join("\t");
  writeFileSync(
    files.geonames,
    [
      geo(3078610, "Brno", 49.19522, 16.60796, 379527),
      geo(3068160, "Plzen", 49.74747, 13.37759, 168733),
    ].join("\n") + "\n",
  );
  return {
    osmPois: [files.osmPois],
    osmPaths: [files.osmPaths],
    osmExclusions: [files.osmExclusions],
    overture: [{ path: files.overture, country: "CZ" }],
    wikidata: [files.wikidata],
    geonames: [{ path: files.geonames, countries: ["CZ"] }],
  };
}

/** Builds the fixture POI database (and manifest) like the VPS worker does. */
export async function buildCzechiaFixture(
  dir,
  { version = "cz-fixture" } = {},
) {
  const { buildPoiDatabase, writeJson } =
    await import("../../../scripts/poi/build.mjs");
  const { loadW4 } = await import("../../../scripts/poi/lib/w4.mjs");
  const inputs = writeCzechiaFixture(join(dir, "inputs"));
  const dbPath = join(dir, "current.sqlite");
  const manifest = await buildPoiDatabase({
    inputs,
    outPath: dbPath,
    version,
    regions: ["cz"],
    w4: await loadW4(),
  });
  writeJson(join(dir, "current.manifest.json"), {
    ...manifest,
    builtAt: "2026-11-02T00:00:00.000Z",
  });
  return { dbPath, manifest, dir };
}

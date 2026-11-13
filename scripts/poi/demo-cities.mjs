// Demo cities outside Czechia (docs/POI-PIPELINE.md "Demo cities"). Each one
// is a small OSM clip (default 8 x 8 km) around a walkable public centre, cut
// from the smallest public extract that contains it. The World worker turns a
// clip into POI quests, offline street paths and an auto CityPack (zones,
// generic NPCs, backed street coins) exactly like a Czech auto city. Auto
// cities are never funded: zone prizes are 0 and coins come from the global
// day budget only.
//
// Sources: BBBike city extracts (weekly) and download.openstreetmap.fr
// extracts (daily) are reachable from the cloud sandbox and the VPS; the two
// Geofabrik ones (Bolivia, Taiwan) only from the VPS. All are OSM, ODbL-1.0.
import { readFileSync } from "node:fs";

const BBBIKE = (name) =>
  `https://download.bbbike.org/osm/bbbike/${name}/${name}.osm.pbf`;
const OSMFR = (path) =>
  `https://download.openstreetmap.fr/extracts/${path}-latest.osm.pbf`;
const GEOFABRIK = (path) =>
  `https://download.geofabrik.de/${path}-latest.osm.pbf`;

export const DEMO_CITY_HALF_KM = 4;

// wave: 1 = first ten (NEAR and recruiting priority), 2 and 3 = the rest,
// 4 = capitals (below).
// center = the public square or park a first quest should start from.
const CITIES = [
  ["new-york", "New York", "US", "America/New_York", 40.7536, -73.9832, 8_300_000, 1, BBBIKE("NewYork")],
  ["san-francisco", "San Francisco", "US", "America/Los_Angeles", 37.788, -122.4075, 810_000, 1, BBBIKE("SanFrancisco")],
  ["london", "London", "GB", "Europe/London", 51.508, -0.1281, 8_900_000, 1, OSMFR("europe/united_kingdom/england/greater_london")],
  ["berlin", "Berlin", "DE", "Europe/Berlin", 52.5186, 13.3976, 3_700_000, 1, BBBIKE("Berlin")],
  ["zurich", "Zürich", "CH", "Europe/Zurich", 47.3717, 8.5402, 420_000, 1, OSMFR("europe/switzerland/zurich")],
  ["lisbon", "Lisbon", "PT", "Europe/Lisbon", 38.7139, -9.1394, 550_000, 1, OSMFR("europe/portugal/lisbon")],
  ["singapore", "Singapore", "SG", "Asia/Singapore", 1.2897, 103.8501, 5_900_000, 1, BBBIKE("Singapore")],
  ["kuala-lumpur", "Kuala Lumpur", "MY", "Asia/Kuala_Lumpur", 3.1478, 101.6953, 1_980_000, 1, OSMFR("asia/malaysia")],
  ["cochabamba", "Cochabamba", "BO", "America/La_Paz", -17.3935, -66.157, 630_000, 1, GEOFABRIK("south-america/bolivia")],
  ["paris", "Paris", "FR", "Europe/Paris", 48.8606, 2.3376, 2_100_000, 2, OSMFR("europe/france/ile_de_france/paris")],
  ["zug", "Zug", "CH", "Europe/Zurich", 47.1662, 8.5155, 31_000, 2, OSMFR("europe/switzerland/zug")],
  ["amsterdam", "Amsterdam", "NL", "Europe/Amsterdam", 52.3731, 4.8926, 920_000, 2, BBBIKE("Amsterdam")],
  ["toronto", "Toronto", "CA", "America/Toronto", 43.6525, -79.3835, 2_800_000, 2, BBBIKE("Toronto")],
  ["mumbai", "Mumbai", "IN", "Asia/Kolkata", 18.9298, 72.8278, 12_400_000, 2, BBBIKE("Bombay")],
  ["bengaluru", "Bengaluru", "IN", "Asia/Kolkata", 12.9763, 77.5929, 8_400_000, 2, OSMFR("asia/india/karnataka")],
  ["tokyo", "Tokyo", "JP", "Asia/Tokyo", 35.6812, 139.7671, 14_000_000, 2, BBBIKE("Tokyo")],
  ["seoul", "Seoul", "KR", "Asia/Seoul", 37.5663, 126.9779, 9_400_000, 2, BBBIKE("Seoul")],
  ["taipei", "Taipei", "TW", "Asia/Taipei", 25.0408, 121.515, 2_500_000, 2, GEOFABRIK("asia/taiwan")],
  ["hong-kong", "Hong Kong", "HK", "Asia/Hong_Kong", 22.2819, 114.158, 7_400_000, 2, OSMFR("asia/china/hong_kong")],
  ["buenos-aires", "Buenos Aires", "AR", "America/Argentina/Buenos_Aires", -34.6083, -58.3712, 3_100_000, 3, OSMFR("south-america/argentina/buenos_aires_city")],
  ["chicago", "Chicago", "US", "America/Chicago", 41.8826, -87.6226, 2_700_000, 3, BBBIKE("Chicago")],
  ["barcelona", "Barcelona", "ES", "Europe/Madrid", 41.387, 2.1701, 1_600_000, 3, BBBIKE("Barcelona")],
  ["warsaw", "Warsaw", "PL", "Europe/Warsaw", 52.24, 21.015, 1_860_000, 3, BBBIKE("Warsaw")],
  ["denver", "Denver", "US", "America/Denver", 39.7392, -104.9903, 715_000, 3, BBBIKE("Denver")],
  ["bangkok", "Bangkok", "TH", "Asia/Bangkok", 13.7307, 100.5418, 10_500_000, 3, BBBIKE("Bangkok")],
  ["ho-chi-minh-city", "Ho Chi Minh City", "VN", "Asia/Ho_Chi_Minh", 10.7745, 106.7035, 9_000_000, 3, BBBIKE("Saigon")],
  ["lagos", "Lagos", "NG", "Africa/Lagos", 6.4541, 3.3947, 15_400_000, 3, OSMFR("africa/nigeria/south_west")],
  ["sydney", "Sydney", "AU", "Australia/Sydney", -33.8688, 151.2093, 5_300_000, 3, BBBIKE("Sydney")],
];

// Wave 4: the capital of every country (GeoNames PPLC, without RU, KP, IR and
// Czechia, which the country import covers) and the capital of every US state,
// minus the ones already above. Built by a one-off dev script from GeoNames
// cities1000 and the published extract polygons: the smallest BBBike or
// openstreetmap.fr extract that contains the clip, otherwise "geofabrik:auto"
// (the worker picks the smallest Geofabrik extract containing the clip from
// Geofabrik's index; Geofabrik is reachable from the VPS only). A capital's
// clip is 6 x 6 km to keep the worker's memory bounded.
export const DEMO_CAPITAL_HALF_KM = 3;
const CAPITALS = JSON.parse(
  readFileSync(new URL("./demo-capitals.json", import.meta.url), "utf8"),
);
const capitalSource = (s) => {
  const [kind, path] = s.split(":");
  if (kind === "bbbike") return BBBIKE(path);
  if (kind === "osmfr") return OSMFR(path);
  if (s === "geofabrik:auto") return GEOFABRIK_AUTO;
  throw new Error(`Unknown capital source ${s}`);
};
export const GEOFABRIK_AUTO = "geofabrik:auto";

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** [west, south, east, north] of a square clip of half side `halfKm`. */
export function clipBox({ lat, lng }, halfKm = DEMO_CITY_HALF_KM) {
  const dLat = halfKm / 110.57,
    dLng = halfKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return Object.freeze([
    round4(lng - dLng),
    round4(lat - dLat),
    round4(lng + dLng),
    round4(lat + dLat),
  ]);
}

const ALL = [
  ...CITIES.map(([id, name, country, timezone, lat, lng, population, wave, url]) => ({
    id, name, country, timezone, lat, lng, population, wave, url, halfKm: DEMO_CITY_HALF_KM, kind: "demo",
  })),
  ...CAPITALS.map((c) => ({
    ...c,
    wave: 4,
    url: capitalSource(c.source),
    halfKm: DEMO_CAPITAL_HALF_KM,
  })),
];

export const DEMO_CITIES = Object.freeze(
  ALL.map(({ id, name, country, timezone, lat, lng, population, wave, url, halfKm, kind }) =>
    Object.freeze({
      // Region ids are prefixed so they can never collide with a country code.
      id: `city-${id}`,
      cityId: id,
      kind: "city",
      name,
      country,
      timezone,
      population,
      wave,
      group: kind,
      center: Object.freeze({ lat, lng }),
      source: url,
      sourceKind:
        url === GEOFABRIK_AUTO || url.includes("geofabrik.de")
          ? "geofabrik"
          : url.includes("bbbike.org")
            ? "bbbike"
            : "osmfr",
      halfKm,
      bbox: clipBox({ lat, lng }, halfKm),
    }),
  ),
);

/** Demo city regions picked by WORLD_CITIES: "demo" (all, default), "off", wave numbers or ids. */
export function parseDemoCities(value = "demo") {
  const raw = String(value ?? "demo").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "none") return [];
  if (!raw || raw === "demo" || raw === "all") return [...DEMO_CITIES];
  const out = new Set();
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const wave = /^wave(\d)$/.exec(part) || (part === "capitals" ? [0, "4"] : null);
    const hits = wave
      ? DEMO_CITIES.filter((c) => c.wave === Number(wave[1]))
      : DEMO_CITIES.filter((c) => c.cityId === part || c.id === part);
    if (!hits.length)
      throw new Error(
        `Unknown demo city "${part}". Known: ${DEMO_CITIES.map((c) => c.cityId).join(", ")}, wave1..wave4, capitals.`,
      );
    for (const c of hits) out.add(c);
  }
  return DEMO_CITIES.filter((c) => out.has(c));
}

// A made-up second city in Overpass JSON shape, used by the CityPack builder
// test and the second-city dry run. Six square parks (one per sector) with a
// walkable grid through each, plus parks the builder must skip.
export const SYNTHETIC_CENTER = { lat: 49.1951, lng: 16.6068 };
const M_LAT = 1 / 111_320,
  M_LNG = 1 / (111_320 * Math.cos((SYNTHETIC_CENTER.lat * Math.PI) / 180));
const at = (northM, eastM) => ({
  lat: SYNTHETIC_CENTER.lat + northM * M_LAT,
  lng: SYNTHETIC_CENTER.lng + eastM * M_LNG,
});
const geo = (p) => ({
  lat: Number(p.lat.toFixed(7)),
  lon: Number(p.lng.toFixed(7)),
});
function square(id, c, half, tags = {}) {
  const ring = [
    at(c.n - half, c.e - half),
    at(c.n - half, c.e + half),
    at(c.n + half, c.e + half),
    at(c.n + half, c.e - half),
    at(c.n - half, c.e - half),
  ].map(geo);
  return {
    type: "way",
    id,
    tags: { leisure: "park", ...tags },
    geometry: ring,
  };
}
function grid(baseId, c, half) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const offset = -half + ((i + 0.5) * 2 * half) / 5,
      pts = [];
    for (let s = -half; s <= half; s += 20)
      pts.push(geo(at(c.n + offset, c.e + s)));
    out.push({
      type: "way",
      id: baseId + i,
      tags: { highway: "footway" },
      geometry: pts,
    });
  }
  return out;
}
const SITES = [
  { name: "Central Gardens", n: 0, e: 0 },
  { name: "North Hill Park", n: 2600, e: 200 },
  { name: "East Meadow", n: 300, e: 2600 },
  { name: "Southeast Orchard", n: -2000, e: 1400 },
  { name: "Southwest Lake Park", n: -2000, e: -1400 },
  { name: "West Woods", n: 200, e: -2600 },
];
export function syntheticOverpass() {
  const parks = SITES.map((s, i) => square(1000 + i, s, 160, { name: s.name }));
  parks.push(
    square(2001, { n: 900, e: 900 }, 120, {
      name: "Private Yard",
      access: "private",
    }),
  );
  const open = square(2002, { n: -900, e: -900 }, 120, { name: "Broken Ring" });
  open.geometry.pop();
  parks.push(open);
  parks.push(square(2003, { n: 9000, e: 9000 }, 120, { name: "Far Away" }));
  const paths = SITES.flatMap((s, i) => grid(5000 + i * 10, s, 160));
  paths.push({
    type: "way",
    id: 9999,
    tags: { highway: "path", access: "private" },
    geometry: [geo(at(0, 0)), geo(at(10, 10))],
  });
  return { parks: { elements: parks }, paths: { elements: paths } };
}
export const SYNTHETIC_COVERAGE = [
  Number((SYNTHETIC_CENTER.lng - 4000 * M_LNG).toFixed(4)),
  Number((SYNTHETIC_CENTER.lat - 4000 * M_LAT).toFixed(4)),
  Number((SYNTHETIC_CENTER.lng + 4000 * M_LNG).toFixed(4)),
  Number((SYNTHETIC_CENTER.lat + 4000 * M_LAT).toFixed(4)),
];

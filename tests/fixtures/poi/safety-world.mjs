// Synthetic Overpass-style elements for the POI safety filter tests.
// Coordinates are given in metres east/north of ORIGIN so each case is easy
// to reason about; nothing here is real map data.

export const ORIGIN = { lat: 49.75, lng: 13.38 };
const M_LAT = 6_371_000 * (Math.PI / 180);
const M_LNG = M_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
export const at = (x, y) => ({
  lon: Number((ORIGIN.lng + x / M_LNG).toFixed(7)),
  lat: Number((ORIGIN.lat + y / M_LAT).toFixed(7)),
});
export const node = (id, x, y, tags) => ({
  type: "node",
  id,
  ...at(x, y),
  tags,
});
export const way = (id, points, tags) => ({
  type: "way",
  id,
  tags,
  geometry: points.map(([x, y]) => at(x, y)),
});
export const rect = (id, x0, y0, x1, y1, tags) =>
  way(
    id,
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
    tags,
  );
export const footway = (id, points, tags = {}) =>
  way(id, points, { highway: "footway", ...tags });

/**
 * School next to a park. The park has a path close to the school fence
 * (inside the child buffer), the school yard has a path, and the only clean
 * path runs 20 m west of the park.
 */
export function schoolNextToPark() {
  return [
    rect(100, 0, 0, 200, 200, { leisure: "park", name: "Lipový park" }),
    rect(101, 200, 0, 300, 200, { amenity: "school", name: "ZŠ Lipová" }),
    footway(1, [
      [190, 20],
      [190, 180],
    ]),
    footway(2, [
      [230, 20],
      [230, 180],
    ]),
    footway(3, [
      [-20, 0],
      [-20, 200],
    ]),
  ];
}

/** A path well away from the origin so nodes near the origin have nothing in reach. */
export const farPath = () =>
  footway(9, [
    [1000, 1000],
    [1100, 1000],
  ]);

/** A straight public path along y=0 from x=-500 to x=500. */
export const mainPath = () =>
  footway(8, [
    [-500, 0],
    [500, 0],
  ]);

// The cells of the Czechia-wide reward map (docs/MAP-REWARDS.md).
//
// A coarse outline of the Czech border (about 2-5 km accurate) is enough to
// pick the H3 res-7 cells the daily plan budgets. Border cells that fall
// partly outside still count: a coin is only ever placed on a mapped public
// path inside the cell, and the POI file covers Czechia only.
import {
  polygonToCells,
  latLngToCell,
  isValidCell,
  getResolution,
} from "h3-js";

// [lat, lng], clockwise from the western tip (Aš).
export const CZECHIA_OUTLINE = Object.freeze([
  [50.25, 12.09],
  [50.32, 12.18],
  [50.4, 12.5],
  [50.43, 12.95],
  [50.58, 13.3],
  [50.71, 13.55],
  [50.8, 14.0],
  [50.87, 14.25],
  [51.05, 14.32],
  [50.98, 14.62],
  [51.02, 15.0],
  [50.98, 15.2],
  [50.78, 15.4],
  [50.74, 15.75],
  [50.62, 16.02],
  [50.66, 16.33],
  [50.57, 16.45],
  [50.42, 16.2],
  [50.32, 16.4],
  [50.13, 16.62],
  [50.2, 16.85],
  [50.42, 17.0],
  [50.33, 17.25],
  [50.27, 17.4],
  [50.32, 17.73],
  [50.1, 17.9],
  [49.98, 18.2],
  [49.93, 18.57],
  [49.55, 18.86],
  [49.42, 18.52],
  [49.27, 18.15],
  [49.05, 17.98],
  [48.87, 17.7],
  [48.86, 17.2],
  [48.62, 16.95],
  [48.78, 16.6],
  [48.75, 16.1],
  [48.87, 15.8],
  [48.98, 15.4],
  [49.0, 15.0],
  [48.78, 14.95],
  [48.58, 14.7],
  [48.55, 14.33],
  [48.63, 14.0],
  [48.77, 13.82],
  [48.95, 13.5],
  [49.12, 13.2],
  [49.35, 12.9],
  [49.45, 12.6],
  [49.7, 12.45],
  [49.97, 12.4],
  [50.1, 12.18],
]);

let cached = null;
/** Every res-7 cell of Czechia, sorted (stable leaf order for the Merkle tree). */
export function czechiaCells() {
  if (!cached)
    cached = Object.freeze(
      polygonToCells(
        CZECHIA_OUTLINE.map((p) => [...p]),
        7,
      ).sort(),
    );
  return cached;
}
let index = null;
export function isCzechiaCell(cell) {
  if (!index) index = new Set(czechiaCells());
  return (
    typeof cell === "string" &&
    isValidCell(cell) &&
    getResolution(cell) === 7 &&
    index.has(cell)
  );
}
export function isInCzechia(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    isCzechiaCell(latLngToCell(lat, lng, 7))
  );
}

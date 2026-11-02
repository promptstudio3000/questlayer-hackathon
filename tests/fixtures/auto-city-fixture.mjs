// Builds a tiny auto city release (the synthetic Brno-like city) the way the
// World worker does, from GeoJSON features as `osmium export` writes them.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYNTHETIC_CENTER, syntheticOverpass } from "./synthetic-city.mjs";
import {
  buildAutoCityPacks,
  publishAutoCities,
} from "../../scripts/poi/auto-cities.mjs";

export const toFeature = (way) => {
  const coords = way.geometry.map((g) => [g.lon, g.lat]);
  const closed =
    coords.length >= 4 &&
    coords[0][0] === coords.at(-1)[0] &&
    coords[0][1] === coords.at(-1)[1];
  return {
    type: "Feature",
    properties: { "@type": "way", "@id": way.id, ...way.tags },
    geometry:
      closed && way.tags.leisure
        ? { type: "Polygon", coordinates: [coords] }
        : { type: "LineString", coordinates: coords },
  };
};

export async function* iter(list) {
  yield* list;
}

export const SYNTHETIC_ROW = {
  geonameid: 3078610,
  name: "Brno",
  ascii_name: "Brno",
  lat: SYNTHETIC_CENTER.lat,
  lng: SYNTHETIC_CENTER.lng,
  country: "CZ",
  population: 379527,
  timezone: "Europe/Prague",
};

export function syntheticSources({ exclusions = [] } = {}) {
  const { parks, paths } = syntheticOverpass();
  return {
    pois: iter(parks.elements.map(toFeature)),
    paths: iter(paths.elements.map(toFeature)),
    exclusions: iter(exclusions),
  };
}

/** Builds and publishes into a fresh temp dir; returns the city-packs dir. */
export async function buildSyntheticRelease({ zonesFor, rows } = {}) {
  const work = mkdtempSync(join(tmpdir(), "auto-cities-"));
  const built = await buildAutoCityPacks({
    rows: rows || [SYNTHETIC_ROW],
    sources: syntheticSources(),
    reviewed: [{ id: "plzen", coverage: [13.31, 49.708, 13.44, 49.79] }],
    version: "cz-20261102-test-a1",
    importedAt: "2026-11-02T00:00:00.000Z",
    sampleDays: 3,
    firstDay: "2026-11-02",
    zonesFor,
  });
  publishAutoCities(work, built, "cz-20261102-test-a1");
  return { work, dir: join(work, "city-packs"), built };
}

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { latLngToCell } from "h3-js";
import {
  canonical,
  digest,
  sha256,
} from "../../../server/world-preparation/canonical.mjs";
import {
  REGION_SCHEMA,
  SNAPSHOT_SCHEMA,
  SNAPSHOTS,
  ownerCell,
} from "../../../server/world-preparation/schema.mjs";
import { atlasVisit } from "../../../server/world-preparation/atlas.mjs";

// Synthetic locations near six cities exercise geography and timezones. They
// are not collected POIs, verified paths, access approvals or a playable world.
export const SITES = [
  ["europe", "CZ", 49.75, 13.37, "Europe/Prague"],
  ["africa", "ZA", -33.93, 18.42, "Africa/Johannesburg"],
  ["asia", "JP", 35.68, 139.76, "Asia/Tokyo"],
  ["north-america", "US", 40.72, -74.01, "America/New_York"],
  ["south-america", "AR", -34.6, -58.38, "America/Argentina/Buenos_Aires"],
  ["oceania", "AU", -33.86, 151.2, "Australia/Sydney"],
];

export function object(kind, key, lat, lng, timezone = "UTC") {
  return {
    key,
    kind,
    label: { lat, lng },
    target: { lat, lng },
    timezone,
    localWindows: [[0, 1440]],
    title: `Synthetic ${kind}`,
    instructions: "Synthetic fixture: do not use for physical play.",
    source: {
      id: `fixture:${key}`,
      url: "https://example.invalid/fixture",
      license: "fixture-only",
      sha256: digest(key),
    },
    fieldReview: "unverified",
    pathRef: `fixture-path:${key}`,
    serverRequirements: { kind: "fixture-proximity", target: { lat, lng } },
    ...(["item", "chest"].includes(kind)
      ? { editionRef: "fixture:edition" }
      : {}),
  };
}

export function zone(key, lat, lng, timezone = "UTC", delta = 0.001) {
  return {
    ...object("zone", key, lat, lng, timezone),
    areaId: `cell:${latLngToCell(lat, lng, 7)}`,
    slot: 0,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lng - delta, lat - delta],
          [lng + delta, lat - delta],
          [lng + delta, lat + delta],
          [lng - delta, lat + delta],
          [lng - delta, lat - delta],
        ],
      ],
    },
    entries: [{ lat, lng }],
  };
}

export function fixtureRegions() {
  return SITES.map(([name, country, lat, lng, timezone]) => {
    const z = zone(`fixture:${name}:zone`, lat, lng, timezone);
    const quest = object("quest", `fixture:${name}:quest`, lat, lng, timezone);
    const prose = atlasVisit({
      name: `Fixture ${name}`,
      sourceId: quest.source.id,
    });
    quest.title = prose.title;
    quest.instructions = prose.instructions;
    quest.serverRequirements.answer = "PRIVATE_FIXTURE_ANSWER";
    return {
      schema: REGION_SCHEMA,
      id: ownerCell({ lat, lng }),
      countries: [country],
      coverage: { status: "complete" },
      objects: [
        z,
        { ...quest, zoneKey: z.key },
        ...["coin", "npc", "chest", "item"].map((kind) => ({
          ...object(kind, `fixture:${name}:${kind}`, lat, lng, timezone),
          zoneKey: z.key,
        })),
      ],
    };
  });
}

export function writeFixture(root, regions = fixtureRegions(), overrides = {}) {
  mkdirSync(root, { recursive: true });
  const areas = new Map();
  for (const r of regions)
    for (const o of r.objects)
      if (o.kind === "zone")
        areas.set(o.areaId, {
          id: o.areaId,
          requestedZones: o.areaId === "city:plzen" ? 6 : 1,
        });
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    sourceCommit: "0".repeat(40),
    versions: Object.fromEntries(
      SNAPSHOTS.map((name) => [
        name,
        { version: `fixture-${name}`, sha256: digest(name) },
      ]),
    ),
    zoneGapM: 250,
    areas: [...areas.values()],
    regions: regions.map((region) => {
      const file = `${region.id}.json`,
        bytes = canonical(region);
      writeFileSync(resolve(root, file), bytes);
      return { id: region.id, status: "complete", file, sha256: sha256(bytes) };
    }),
    ...overrides,
  };
  const file = resolve(root, "input.json");
  writeFileSync(file, canonical(snapshot));
  return file;
}

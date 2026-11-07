import { isValidCell, getResolution, latLngToCell, cellToParent } from "h3-js";
import {
  booleanValid,
  booleanPointInPolygon,
  feature,
  point,
  kinks,
  polygonToLine,
  flattenEach,
  pointToLineDistance,
  booleanIntersects,
  bbox,
} from "@turf/turf";
import {
  canonical,
  compare,
  digest,
  exactKeys,
  requireValue,
} from "./canonical.mjs";
import { localWindows } from "./calendar.mjs";

export const SNAPSHOT_SCHEMA = "questlayer.world-snapshot/1";
export const REGION_SCHEMA = "questlayer.world-region-input/1";
export const PREPARATION_SCHEMA = "questlayer.world-preparation/1";
export const KINDS = ["zone", "quest", "coin", "npc", "chest", "item"];
export const SNAPSHOTS = [
  "geography",
  "rules",
  "closures",
  "activity",
  "editions",
];
// Match scripts/poi/merge.mjs exactly: res-5 is the parent of the label's
// res-7 index, not an independent res-5 point lookup (H3 edges differ).
export const ownerCell = ({ lat, lng }) =>
  cellToParent(latLngToCell(lat, lng, 7), 5);
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,199}$/;

export function validateSnapshot(input) {
  exactKeys(
    input,
    ["schema", "sourceCommit", "versions", "zoneGapM", "areas", "regions"],
    "snapshot",
  );
  requireValue(
    input.schema === SNAPSHOT_SCHEMA,
    "Unsupported world snapshot schema.",
  );
  requireValue(
    /^[a-f0-9]{40}$/.test(input.sourceCommit),
    "Pin the exact source commit.",
  );
  exactKeys(input.versions, SNAPSHOTS, "versions");
  for (const key of SNAPSHOTS) {
    exactKeys(input.versions[key], ["version", "sha256"], key);
    requireValue(
      typeof input.versions[key].version === "string" &&
        input.versions[key].version.length > 0 &&
        HEX.test(input.versions[key].sha256),
      `Missing frozen ${key} version/hash.`,
    );
  }
  // A frozen geography policy value, never an inferred funding or reward policy.
  requireValue(
    Number.isFinite(input.zoneGapM) && input.zoneGapM >= 0,
    "Pin the geographic boundary gap.",
  );
  requireValue(
    Array.isArray(input.areas),
    "List the frozen zone ownership areas.",
  );
  const areas = new Set();
  for (const a of input.areas) {
    exactKeys(a, ["id", "requestedZones", "shortfallReason"], "zone area");
    const cell = a.id?.startsWith("cell:") ? a.id.slice(5) : null;
    requireValue(
      a.id === "city:plzen" || (isValidCell(cell) && getResolution(cell) === 7),
      "Zone area is city:plzen or a canonical H3 res-7 cell.",
    );
    requireValue(!areas.has(a.id), "Duplicate zone ownership area.");
    areas.add(a.id);
    requireValue(
      Number.isInteger(a.requestedZones) &&
        (a.id === "city:plzen"
          ? a.requestedZones === 6
          : a.requestedZones >= 1 && a.requestedZones <= 3),
      "Plzen has six slots; a global cell has one to three.",
    );
    if (a.shortfallReason !== undefined)
      requireValue(
        typeof a.shortfallReason === "string" && a.shortfallReason.trim(),
        "Empty area shortfall reason.",
      );
  }
  requireValue(
    Array.isArray(input.regions) && input.regions.length > 0,
    "A complete expected region inventory is required.",
  );
  const ids = new Set();
  for (const r of input.regions) {
    exactKeys(
      r,
      ["id", "status", "reason", "file", "sha256"],
      "region descriptor",
    );
    requireValue(
      isValidCell(r.id) && getResolution(r.id) === 5 && !ids.has(r.id),
      "Region owners must be distinct H3 res-5 cells.",
    );
    ids.add(r.id);
    requireValue(
      ["complete", "incomplete"].includes(r.status),
      "Region status must be explicit.",
    );
    if (r.status === "complete") {
      requireValue(
        typeof r.file === "string" &&
          /^[a-zA-Z0-9][a-zA-Z0-9_./-]*\.json$/.test(r.file) &&
          !r.file.split("/").some((s) => s === ".." || s === "."),
        "Use a relative JSON region path.",
      );
      requireValue(
        HEX.test(r.sha256),
        "A completed region needs an input hash.",
      );
    } else
      requireValue(
        typeof r.reason === "string" && r.reason.trim().length > 0,
        "An incomplete region needs a reason.",
      );
  }
  return {
    ...input,
    areas: [...input.areas].sort((a, b) => compare(a.id, b.id)),
    regions: [...input.regions].sort((a, b) => compare(a.id, b.id)),
  };
}

function location(p, label) {
  exactKeys(p, ["lat", "lng"], label);
  requireValue(
    Number.isFinite(p.lat) &&
      Math.abs(p.lat) <= 90 &&
      Number.isFinite(p.lng) &&
      Math.abs(p.lng) <= 180,
    `${label}: invalid coordinates.`,
  );
}

export function validateZonePolygon(geometry) {
  exactKeys(geometry, ["type", "coordinates"], "zone geometry");
  requireValue(
    geometry.type === "Polygon",
    "A zone must be one connected Polygon, with its holes preserved.",
  );
  requireValue(
    Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0,
    "Missing polygon rings.",
  );
  for (const ring of geometry.coordinates) {
    requireValue(
      Array.isArray(ring) && ring.length >= 4,
      "A polygon ring needs four positions.",
    );
    for (const p of ring) {
      requireValue(
        Array.isArray(p) && p.length === 2,
        "Use longitude/latitude positions.",
      );
      location({ lng: p[0], lat: p[1] }, "polygon position");
    }
    requireValue(
      canonical(ring[0]) === canonical(ring.at(-1)),
      "Polygon rings must be closed.",
    );
  }
  const f = feature(geometry),
    bounds = bbox(f);
  requireValue(
    bounds[2] - bounds[0] < 180,
    "Split date-line geometry before preparation.",
  );
  requireValue(
    booleanValid(f) && kinks(f).features.length === 0,
    "Invalid or self-intersecting polygon.",
  );
  // Turf's validity predicate does not establish that all hole rings are inside
  // the shell or disjoint from one another. Check those relationships explicitly.
  const shell = feature({
    type: "Polygon",
    coordinates: [geometry.coordinates[0]],
  });
  const rings = geometry.coordinates
    .slice(1)
    .map((ring) => feature({ type: "Polygon", coordinates: [ring] }));
  for (let i = 0; i < rings.length; i++) {
    for (const p of rings[i].geometry.coordinates[0])
      requireValue(
        booleanPointInPolygon(p, shell, { ignoreBoundary: true }),
        "Polygon hole lies outside the shell.",
      );
    requireValue(
      !booleanIntersects(polygonToLine(rings[i]), polygonToLine(shell)),
      "Polygon hole touches the shell.",
    );
    for (let j = 0; j < i; j++)
      requireValue(
        !booleanIntersects(rings[i], rings[j]),
        "Polygon holes overlap.",
      );
  }
  return f;
}

export function inside(geometry, p) {
  return booleanPointInPolygon(point([p.lng, p.lat]), feature(geometry), {
    ignoreBoundary: true,
  });
}

export function boundaryGap(a, b) {
  const fa = feature(a),
    fb = feature(b);
  if (booleanIntersects(fa, fb)) return 0;
  let minimum = Infinity;
  for (const [one, other] of [
    [fa, fb],
    [fb, fa],
  ])
    for (const ring of one.geometry.coordinates)
      for (const p of ring)
        flattenEach(polygonToLine(other), (line) => {
          minimum = Math.min(
            minimum,
            pointToLineDistance(p, line, { units: "meters" }),
          );
        });
  return minimum;
}

export function objectId(epoch, object) {
  // No player, shard, timezone or loading request participates in the identity.
  return `world:${epoch.day}:${object.kind}:${digest({ kind: object.kind, key: object.key })}`;
}

export function validateRegion(
  region,
  descriptor,
  epoch,
  windowCache = new Map(),
) {
  exactKeys(
    region,
    ["schema", "id", "countries", "coverage", "objects"],
    "region",
  );
  requireValue(
    region.schema === REGION_SCHEMA && region.id === descriptor.id,
    "Region identity/schema mismatch.",
  );
  requireValue(
    Array.isArray(region.countries) &&
      region.countries.length > 0 &&
      region.countries.every((c) => /^[A-Z]{2}$/.test(c)) &&
      new Set(region.countries).size === region.countries.length,
    "List distinct ISO country codes (coverage is not a border).",
  );
  exactKeys(region.coverage, ["status", "reason"], "coverage");
  requireValue(
    ["complete", "shortfall"].includes(region.coverage.status),
    "Unknown coverage status.",
  );
  if (region.coverage.status === "shortfall")
    requireValue(
      typeof region.coverage.reason === "string" &&
        region.coverage.reason.trim(),
      "A geographic shortfall needs a reason.",
    );
  requireValue(
    Array.isArray(region.objects) && region.objects.length <= 250_000,
    "Bound a region to 250,000 objects; split upstream input if needed.",
  );
  const seen = new Set(),
    zones = new Map(),
    objects = [];
  for (const o of region.objects) {
    exactKeys(
      o,
      [
        "key",
        "kind",
        "label",
        "target",
        "timezone",
        "localWindows",
        "areaId",
        "slot",
        "zoneKey",
        "geometry",
        "entries",
        "title",
        "instructions",
        "source",
        "fieldReview",
        "pathRef",
        "editionRef",
        "serverRequirements",
      ],
      "world object",
    );
    requireValue(
      KINDS.includes(o.kind) && typeof o.key === "string" && ID.test(o.key),
      "Use a known object kind and stable source key.",
    );
    requireValue(
      !seen.has(`${o.kind}:${o.key}`),
      "Duplicate object identity in region.",
    );
    seen.add(`${o.kind}:${o.key}`);
    location(o.label, "label");
    location(o.target, "target");
    requireValue(
      ownerCell(o.label) === descriptor.id,
      "Object belongs to another owner cell; ownership uses the label's res-7 parent, not the snapped target.",
    );
    requireValue(
      typeof o.timezone === "string" && o.timezone.length <= 100,
      "A timezone is required.",
    );
    const windowKey = canonical([o.timezone, o.localWindows]);
    if (!windowCache.has(windowKey)) {
      if (windowCache.size >= 4096) windowCache.clear();
      windowCache.set(
        windowKey,
        localWindows(epoch, o.timezone, o.localWindows),
      );
    }
    requireValue(
      ["unverified", "reviewed"].includes(o.fieldReview),
      "Preserve the field-review status.",
    );
    exactKeys(o.source, ["id", "url", "license", "sha256"], "object source");
    requireValue(
      typeof o.source.id === "string" &&
        o.source.id.length > 0 &&
        typeof o.source.license === "string" &&
        o.source.license.length > 0 &&
        HEX.test(o.source.sha256),
      "Preserve source identity, license and hash.",
    );
    requireValue(
      typeof o.source.url === "string" && /^https?:\/\//.test(o.source.url),
      "Preserve a source URL.",
    );
    requireValue(
      typeof o.pathRef === "string" && o.pathRef.length > 0,
      "Every prepared target requires a mapped public path reference.",
    );
    for (const field of ["title", "instructions"])
      requireValue(
        typeof o[field] === "string" &&
          o[field].trim().length > 0 &&
          o[field].length <= 2000,
        `Missing or excessive ${field}.`,
      );
    requireValue(
      o.serverRequirements &&
        Object.getPrototypeOf(o.serverRequirements) === Object.prototype &&
        Object.keys(o.serverRequirements).length > 0,
      "Server completion requirements must be frozen, never sent in the public bundle.",
    );
    if (o.kind === "zone") {
      requireValue(
        typeof o.areaId === "string" && Number.isInteger(o.slot) && o.slot >= 0,
        "Zone needs a canonical area and slot.",
      );
      if (o.areaId !== "city:plzen")
        requireValue(
          o.areaId === `cell:${latLngToCell(o.label.lat, o.label.lng, 7)}`,
          "Zone area must match its label cell.",
        );
      validateZonePolygon(o.geometry);
      requireValue(
        inside(o.geometry, o.target),
        "Zone target must be inside its polygon and outside its holes.",
      );
      requireValue(
        Array.isArray(o.entries) && o.entries.length > 0,
        "A zone requires mapped entry points.",
      );
      for (const p of o.entries) {
        location(p, "entry");
        requireValue(
          inside(o.geometry, p),
          "Entry must be inside the usable zone.",
        );
      }
      zones.set(o.key, o);
    } else
      requireValue(
        o.geometry === undefined &&
          o.entries === undefined &&
          o.areaId === undefined &&
          o.slot === undefined,
        "Only zones carry polygon geometry, entries and slots.",
      );
    if (["item", "chest"].includes(o.kind))
      requireValue(
        o.editionRef === null ||
          (typeof o.editionRef === "string" && ID.test(o.editionRef)),
        "Item/chest selection must specify an edition reference or explicit absence.",
      );
    else
      requireValue(
        o.editionRef === undefined,
        "Only item/chest objects carry edition references.",
      );
    if (o.zoneKey !== undefined)
      requireValue(
        o.kind !== "zone" && typeof o.zoneKey === "string",
        "Only a child object can reference a zone.",
      );
    const prepared = {
      ...o,
      id: objectId(epoch, o),
      windows: windowCache.get(windowKey),
    };
    if (o.kind === "zone") zones.set(o.key, prepared);
    objects.push(prepared);
  }
  for (const o of objects)
    if (o.zoneKey !== undefined) {
      const zone = zones.get(o.zoneKey);
      requireValue(
        zone && inside(zone.geometry, o.target),
        "Child object needs a same-region zone containing its target.",
      );
      requireValue(
        o.windows.every((w) =>
          zone.windows.some(
            (z) => z.startsAt <= w.startsAt && z.endsAt >= w.endsAt,
          ),
        ),
        "Child object cannot open outside its zone's frozen windows.",
      );
    }
  return { ...region, objects: objects.sort((a, b) => compare(a.id, b.id)) };
}

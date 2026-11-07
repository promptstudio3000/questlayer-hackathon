import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { bbox, feature } from "@turf/turf";
import { ATLAS } from "./atlas.mjs";
import {
  canonical,
  compare,
  digest,
  requireValue,
  sha256,
} from "./canonical.mjs";
import { utcEpoch } from "./calendar.mjs";
import {
  boundaryGap,
  KINDS,
  PREPARATION_SCHEMA,
  validateRegion,
  validateSnapshot,
} from "./schema.mjs";
import {
  atomicFile,
  immutableFile,
  inputFile,
  lockDirectory,
  MAX_INPUT_BYTES,
  readBounded,
} from "./storage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const COMPILER = {
  sourceHash: digest(
    readdirSync(here)
      .filter((name) => name.endsWith(".mjs"))
      .sort()
      .map((name) => [name, sha256(readFileSync(resolve(here, name)))]),
  ),
  dependencyHash: sha256(
    readFileSync(resolve(here, "../../package-lock.json")),
  ),
  node: process.versions.node,
  icu: process.versions.icu,
  timezoneData: process.versions.tz,
  zlib: process.versions.zlib,
};
const counts = () => Object.fromEntries(KINDS.map((kind) => [kind, 0]));

function save(root, directory, bytes, suffix) {
  const hash = sha256(bytes),
    path = `${directory}/${hash}.${suffix}`;
  immutableFile(resolve(root, path), bytes);
  return { path, sha256: hash, bytes: bytes.length };
}

function bundle(root, directory, body) {
  const bytes = Buffer.from(canonical(body));
  requireValue(
    bytes.length <= MAX_INPUT_BYTES,
    "Prepared region exceeds the 64 MiB decompression bound.",
  );
  return save(root, directory, gzipSync(bytes, { level: 9 }), "json.gz");
}

// The global duplicate audit uses 256 on-disk buckets. It never retains all
// world object identities in memory; readBounded also bounds an audit bucket.
function recordIdentities(audit, objects) {
  const groups = new Map();
  for (const o of objects) {
    const hash = sha256(o.id),
      key = hash.slice(0, 2);
    groups.set(key, (groups.get(key) || "") + `${hash}\n`);
  }
  for (const [key, text] of groups)
    appendFileSync(resolve(audit, key), text, { mode: 0o600 });
}

function auditIdentities(audit) {
  for (const name of readdirSync(audit).sort()) {
    const ids = readBounded(resolve(audit, name))
      .toString("utf8")
      .trim()
      .split("\n")
      .sort();
    for (let i = 1; i < ids.length; i++)
      requireValue(
        ids[i - 1] !== ids[i],
        "Duplicate world object identity across regions.",
      );
  }
}

// Only the geographic bounding index is held globally. Geometry stays in
// content-addressed files and is read for nearby candidates, including those
// in other countries/shards. A coarse index avoids an all-pairs world scan.
export class ZoneIndex {
  constructor(root, gap) {
    this.root = root;
    this.gap = gap;
    this.bins = new Map();
  }
  keys(bounds) {
    const [w, s, e, n] = bounds;
    const y = this.gap / 110_000;
    const x = Math.min(
      180,
      y /
        Math.max(
          0.00001,
          Math.cos((Math.max(Math.abs(s), Math.abs(n)) * Math.PI) / 180),
        ),
    );
    const cells = [];
    const fromX = Math.floor((w - x) * 10),
      toX = Math.floor((e + x) * 10);
    const fromY = Math.floor((s - y) * 10),
      toY = Math.floor((n + y) * 10);
    requireValue(
      (toX - fromX + 1) * (toY - fromY + 1) <= 100_000,
      "Zone geometry exceeds the spatial-index bound; split upstream geography.",
    );
    for (let a = fromX; a <= toX; a++)
      for (let b = fromY; b <= toY; b++)
        cells.push(`${(((a + 1800) % 3600) + 3600) % 3600}:${b}`);
    return cells;
  }
  add(o, geometryRef) {
    const keys = this.keys(bbox(feature(o.geometry))),
      nearby = new Map();
    for (const key of keys)
      for (const entry of this.bins.get(key) || []) nearby.set(entry.id, entry);
    for (const entry of nearby.values()) {
      const geometry = JSON.parse(readBounded(resolve(this.root, entry.path)));
      const gap = boundaryGap(o.geometry, geometry);
      requireValue(
        gap > 0 && gap >= this.gap,
        `Zones overlap, touch or violate the frozen boundary gap: ${o.key}, ${entry.key}.`,
      );
    }
    const entry = { id: o.id, key: o.key, path: geometryRef.path };
    for (const key of keys) {
      if (!this.bins.has(key)) this.bins.set(key, []);
      this.bins.get(key).push(entry);
    }
  }
}

function project(region, epoch, root, zoneIndex, areaSlots) {
  const publicObjects = [],
    privateObjects = [],
    totals = counts(),
    openCounts = counts();
  const editions = new Map();
  const zoneIds = new Map(
    region.objects.filter((o) => o.kind === "zone").map((o) => [o.key, o.id]),
  );
  for (const o of region.objects) {
    totals[o.kind]++;
    if (o.windows.length > 0) openCounts[o.kind]++;
    const visible = {
      id: o.id,
      kind: o.kind,
      epochId: epoch.id,
      ownerRegion: region.id,
      label: o.label,
      target: o.target,
      timezone: o.timezone,
      windows: o.windows,
      title: o.title,
      instructions: o.instructions,
      fieldReview: o.fieldReview,
      source: o.source,
    };
    if (o.kind === "quest") visible.author = ATLAS;
    if (o.kind === "zone") {
      const area = areaSlots.get(o.areaId);
      requireValue(
        area && o.slot < area.requestedZones && !area.slots.has(o.slot),
        "Unknown area, extra zone or duplicate city/cell slot.",
      );
      area.slots.add(o.slot);
      const geometry = save(
        root,
        "public/geometry",
        Buffer.from(canonical(o.geometry)),
        "json",
      );
      zoneIndex.add(o, geometry);
      Object.assign(visible, {
        geometry,
        entries: o.entries,
        areaId: o.areaId,
        slot: o.slot,
      });
    }
    if (o.zoneKey !== undefined) visible.zoneId = zoneIds.get(o.zoneKey);
    if (["item", "chest"].includes(o.kind)) {
      // Inventory reservation is a separate protected integration. No edition
      // or item is advertised as claimable merely because content was prepared.
      visible.itemAvailability = "not-reserved";
      if (o.editionRef)
        editions.set(o.editionRef, (editions.get(o.editionRef) || 0) + 1);
    }
    publicObjects.push(visible);
    privateObjects.push({
      id: o.id,
      key: o.key,
      kind: o.kind,
      pathRef: o.pathRef,
      serverRequirements: o.serverRequirements,
      ...(o.editionRef !== undefined ? { editionRef: o.editionRef } : {}),
    });
  }
  return {
    counts: totals,
    openCounts,
    editions: [...editions]
      .sort(([a], [b]) => compare(a, b))
      .map(([editionRef, objects]) => ({ editionRef, objects })),
    public: bundle(root, "public/regions", {
      schema: "questlayer.world-region-content/1",
      status: "content-only",
      epoch,
      region: region.id,
      countries: [...region.countries].sort(),
      coverage: region.coverage,
      objects: publicObjects,
    }),
    server: bundle(root, "server/regions", {
      schema: "questlayer.world-region-requirements/1",
      epochId: epoch.id,
      region: region.id,
      objects: privateObjects,
    }),
  };
}

/** Offline content compiler. No DB, server, signer, network or treasury calls.
 *  It deliberately cannot publish/activate a funded game day. The caller must
 *  first supply complete frozen content from the geography/gameplay adapters.
 */
export async function prepareGlobalDay({
  snapshotFile,
  outputDir,
  day,
  onRegion = () => {},
}) {
  const epoch = utcEpoch(day);
  const snapshot = validateSnapshot(JSON.parse(readBounded(snapshotFile)));
  const snapshotRoot = dirname(resolve(snapshotFile)),
    root = resolve(outputDir);
  requireValue(
    root !== snapshotRoot,
    "Keep outputs separate from supplied input files.",
  );
  const binding = {
    schema: PREPARATION_SCHEMA,
    epoch,
    snapshot,
    compiler: COMPILER,
  };
  const inputHash = digest(binding),
    release = lockDirectory(root);
  let audit;
  try {
    requireValue(
      existsSync(resolve(root, "snapshot.json")) ||
        readdirSync(root).every((name) => name === ".prepare.lock"),
      "A new preparation needs an empty isolated output directory.",
    );
    immutableFile(
      resolve(root, "snapshot.json"),
      Buffer.from(canonical(binding)),
    );
    const manifestPath = resolve(root, "manifest.json");
    if (existsSync(manifestPath)) {
      // A sealed candidate remains immutable. Re-validate its content rather
      // than trusting a checkpoint or silently replacing corrupt bundles.
      const old = JSON.parse(readBounded(manifestPath));
      requireValue(
        old.inputHash === inputHash,
        "Preparation input changed; use a new output directory.",
      );
    }
    audit = mkdtempSync(resolve(root, ".identity-audit-"));
    const index = new ZoneIndex(root, snapshot.zoneGapM),
      windowCache = new Map();
    const areas = new Map(
      snapshot.areas.map((a) => [a.id, { ...a, slots: new Set() }]),
    );
    const status = {
      schema: PREPARATION_SCHEMA,
      epochId: epoch.id,
      inputHash,
      state: "preparing",
      regions: [],
      problems: [],
    };
    const checkpoint = () =>
      atomicFile(resolve(root, "status.json"), Buffer.from(canonical(status)));
    checkpoint();
    for (const descriptor of snapshot.regions) {
      if (descriptor.status !== "complete") {
        status.regions.push({
          id: descriptor.id,
          state: "missing",
          reason: descriptor.reason,
        });
        checkpoint();
        continue;
      }
      try {
        const bytes = readBounded(inputFile(snapshotRoot, descriptor.file));
        requireValue(
          sha256(bytes) === descriptor.sha256,
          "Region input hash mismatch.",
        );
        const region = validateRegion(
          JSON.parse(bytes),
          descriptor,
          epoch,
          windowCache,
        );
        recordIdentities(audit, region.objects);
        const result = project(region, epoch, root, index, areas);
        status.regions.push({
          id: descriptor.id,
          state: "prepared",
          inputHash: descriptor.sha256,
          countries: [...region.countries].sort(),
          coverage: region.coverage,
          ...result,
        });
      } catch (error) {
        status.regions.push({
          id: descriptor.id,
          state: "failed",
          reason: String(error.message).slice(0, 600),
        });
      }
      checkpoint();
      // A stopped worker leaves verified immutable chunks and a readable
      // checkpoint. Retrying audits the whole frozen input and reuses bytes.
      await onRegion(status.regions.at(-1));
    }
    try {
      auditIdentities(audit);
    } catch (error) {
      status.problems.push(error.message);
    }
    const areaCoverage = [];
    for (const a of areas.values()) {
      const shortfall = a.requestedZones - a.slots.size;
      if (shortfall && !a.shortfallReason)
        status.problems.push(
          `Missing zone slots without a shortfall reason: ${a.id}.`,
        );
      areaCoverage.push({
        id: a.id,
        requestedZones: a.requestedZones,
        preparedZones: a.slots.size,
        shortfall,
        reason: shortfall ? a.shortfallReason || "unexplained-shortfall" : null,
      });
    }
    const complete =
      status.regions.every((r) => r.state === "prepared") &&
      status.problems.length === 0;
    status.state = complete ? "content-prepared" : "incomplete";
    status.areaCoverage = areaCoverage;
    checkpoint();
    if (!complete) return status;
    const total = counts(),
      openCounts = counts();
    for (const r of status.regions)
      for (const kind of KINDS) {
        total[kind] += r.counts[kind];
        openCounts[kind] += r.openCounts[kind];
      }
    const manifest = {
      schema: PREPARATION_SCHEMA,
      state: "content-prepared",
      inputHash,
      epoch,
      compiler: COMPILER,
      versions: snapshot.versions,
      sourceCommit: snapshot.sourceCommit,
      counts: total,
      openCounts,
      areaCoverage,
      regions: status.regions,
      activation: {
        permitted: false,
        blockers: [
          "owner-financial-reservation",
          "owner-inventory-reservation",
          "runtime-manifest-adapter",
          "release-geography-and-scale-acceptance",
        ],
      },
    };
    immutableFile(manifestPath, Buffer.from(canonical(manifest)));
    return manifest;
  } finally {
    if (audit) rmSync(audit, { recursive: true, force: true });
    release();
  }
}

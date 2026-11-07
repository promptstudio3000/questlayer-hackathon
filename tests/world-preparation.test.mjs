import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { cellToBoundary, gridDisk, latLngToCell } from "h3-js";
import {
  canonical,
  digest,
  sha256,
} from "../server/world-preparation/canonical.mjs";
import {
  utcEpoch,
  localWindows,
} from "../server/world-preparation/calendar.mjs";
import {
  validateRegion,
  validateSnapshot,
  objectId,
  REGION_SCHEMA,
  ownerCell,
} from "../server/world-preparation/schema.mjs";
import { prepareGlobalDay } from "../server/world-preparation/worker.mjs";
import { readPreparedContent } from "../server/world-preparation/read.mjs";
import {
  lockDirectory,
  inputFile,
} from "../server/world-preparation/storage.mjs";
import {
  fixtureRegions,
  object,
  zone,
  writeFixture,
} from "./fixtures/world-preparation/world.mjs";

const day = "2026-11-07",
  epoch = utcEpoch(day);
function workspace(t) {
  const root = mkdtempSync(resolve(tmpdir(), "questlayer-preparation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function job(root, regions, overrides) {
  return {
    snapshotFile: writeFixture(resolve(root, "input"), regions, overrides),
    outputDir: resolve(root, "output"),
    day,
  };
}
function regionFor(objects, country = "CZ") {
  return {
    schema: REGION_SCHEMA,
    id: ownerCell(objects[0].label),
    countries: [country],
    coverage: { status: "complete" },
    objects,
  };
}

test("six-continent content is complete, immutable, deterministic, private and explicitly unactivated", async (t) => {
  const root = workspace(t),
    args = job(root),
    result = await prepareGlobalDay(args);
  assert.equal(result.state, "content-prepared");
  assert.equal(result.activation.permitted, false);
  assert.equal(result.regions.length, 6);
  assert.deepEqual(result.counts, {
    zone: 6,
    quest: 6,
    coin: 6,
    npc: 6,
    chest: 6,
    item: 6,
  });
  const first = readFileSync(resolve(args.outputDir, "manifest.json"));
  for (const region of result.regions) {
    const publicData = readPreparedContent(
      resolve(args.outputDir, "manifest.json"),
      region.id,
    );
    const text = canonical(publicData);
    assert.ok(
      !text.includes("PRIVATE_FIXTURE_ANSWER") &&
        !text.includes("serverRequirements") &&
        !text.includes("editionRef"),
    );
    assert.equal(
      publicData.objects.find((o) => o.kind === "quest").author.name,
      "Atlas",
    );
    assert.equal(
      publicData.objects.find((o) => o.kind === "item").itemAvailability,
      "not-reserved",
    );
    assert.ok(
      gunzipSync(readFileSync(resolve(args.outputDir, region.server.path)))
        .toString()
        .includes("PRIVATE_FIXTURE_ANSWER"),
    );
    assert.ok(
      publicData.objects.every((o) =>
        o.windows.every(
          (w) => w.startsAt >= epoch.startsAt && w.endsAt <= epoch.endsAt,
        ),
      ),
    );
  }
  assert.deepEqual(await prepareGlobalDay(args), result);
  assert.deepEqual(
    readFileSync(resolve(args.outputDir, "manifest.json")),
    first,
  );
  const again = await prepareGlobalDay({
    ...args,
    outputDir: resolve(root, "second"),
  });
  assert.deepEqual(again, result);
  assert.deepEqual(readFileSync(resolve(root, "second/manifest.json")), first);
});

test("interrupted preparation resumes the same bytes without publishing a partial manifest", async (t) => {
  const root = workspace(t),
    args = job(root);
  await assert.rejects(
    prepareGlobalDay({
      ...args,
      onRegion() {
        throw Error("simulated interruption");
      },
    }),
    /simulated interruption/,
  );
  assert.equal(existsSync(resolve(args.outputDir, "manifest.json")), false);
  const partial = JSON.parse(
    readFileSync(resolve(args.outputDir, "status.json")),
  );
  assert.equal(partial.regions.length, 1);
  const before = readFileSync(
    resolve(args.outputDir, partial.regions[0].public.path),
  );
  const resumed = await prepareGlobalDay(args);
  assert.equal(resumed.state, "content-prepared");
  assert.deepEqual(
    readFileSync(resolve(args.outputDir, partial.regions[0].public.path)),
    before,
  );
  assert.equal(
    readdirSync(args.outputDir).some((n) => n.startsWith(".identity-audit")),
    false,
  );
});

test("missing and corrupt regions are reported and never sealed", async (t) => {
  const root = workspace(t),
    regions = fixtureRegions(),
    args = job(root, regions);
  const snapshot = JSON.parse(readFileSync(args.snapshotFile));
  snapshot.regions[0] = {
    id: snapshot.regions[0].id,
    status: "incomplete",
    reason: "missing public paths",
  };
  snapshot.regions[1].sha256 = "0".repeat(64);
  writeFileSync(args.snapshotFile, canonical(snapshot));
  const result = await prepareGlobalDay(args);
  assert.equal(result.state, "incomplete");
  assert.ok(result.regions.some((r) => r.reason === "missing public paths"));
  assert.ok(
    result.regions.some((r) => r.reason === "Region input hash mismatch."),
  );
  assert.equal(existsSync(resolve(args.outputDir, "manifest.json")), false);
});

test("a sealed directory rejects another epoch, snapshot or corrupt existing content", async (t) => {
  const root = workspace(t),
    args = job(root),
    result = await prepareGlobalDay(args);
  await assert.rejects(
    prepareGlobalDay({ ...args, day: "2026-11-08" }),
    /Immutable/,
  );
  const ref = result.regions[0].public;
  writeFileSync(resolve(args.outputDir, ref.path), "corrupt");
  assert.throws(
    () =>
      readPreparedContent(
        resolve(args.outputDir, "manifest.json"),
        result.regions[0].id,
      ),
    /checksum/,
  );
  const retry = await prepareGlobalDay(args);
  assert.equal(retry.state, "incomplete");
  assert.ok(retry.regions.some((r) => /corrupt/.test(r.reason)));
});

test("global duplicate identities fail even when their labels moved to another shard", async (t) => {
  const root = workspace(t),
    regions = fixtureRegions().slice(0, 2);
  regions[1].objects.find((o) => o.kind === "coin").key =
    regions[0].objects.find((o) => o.kind === "coin").key;
  const args = job(root, regions),
    result = await prepareGlobalDay(args);
  assert.equal(result.state, "incomplete");
  assert.ok(
    result.problems.some((p) => /Duplicate world object identity/.test(p)),
  );
  assert.equal(existsSync(resolve(args.outputDir, "manifest.json")), false);
});

test("UTC identities ignore timezone and shard changes; local windows cover DST and the date line", () => {
  const o = object("coin", "osm:n1", 50, 14);
  assert.equal(
    objectId(epoch, o),
    objectId(epoch, {
      ...o,
      timezone: "Pacific/Kiritimati",
      label: { lat: 0, lng: 180 },
    }),
  );
  assert.notEqual(objectId(epoch, o), objectId(utcEpoch("2026-11-08"), o));
  assert.deepEqual(
    localWindows(utcEpoch("2026-03-29"), "Europe/Prague", [[120, 180]]),
    [],
  );
  const repeat = localWindows(utcEpoch("2026-10-25"), "Europe/Prague", [
    [135, 150],
  ]);
  assert.equal(repeat.length, 2);
  assert.equal(
    repeat.reduce((sum, w) => sum + w.endsAt - w.startsAt, 0),
    30 * 60_000,
  );
  assert.deepEqual(localWindows(epoch, "Pacific/Kiritimati", [[0, 1440]]), [
    { startsAt: epoch.startsAt, endsAt: epoch.endsAt },
  ]);
  assert.equal(
    localWindows(epoch, "Asia/Kathmandu", [[480, 540]])[0].startsAt,
    Date.parse(`${day}T02:15:00Z`),
  );
  assert.throws(() => utcEpoch("2026-02-30"), /Invalid UTC/);
});

test("polygons preserve holes and reject self intersections, external holes and targets in holes", () => {
  const z = zone("hole", 49.75, 13.37, "UTC", 0.01);
  z.geometry.coordinates.push([
    [13.372, 49.752],
    [13.374, 49.752],
    [13.374, 49.754],
    [13.372, 49.754],
    [13.372, 49.752],
  ]);
  const r = regionFor([z]);
  assert.equal(
    validateRegion(r, { id: r.id }, epoch).objects[0].geometry.coordinates
      .length,
    2,
  );
  z.target = { lat: 49.753, lng: 13.373 };
  assert.throws(
    () => validateRegion(r, { id: r.id }, epoch),
    /target must be inside/,
  );
  z.target = { ...z.label };
  z.geometry.coordinates[1] = z.geometry.coordinates[1].map(([x, y]) => [
    x + 0.1,
    y,
  ]);
  assert.throws(() => validateRegion(r, { id: r.id }, epoch), /hole|polygon/);
  z.geometry.coordinates = [
    [
      [13.36, 49.74],
      [13.38, 49.76],
      [13.36, 49.76],
      [13.38, 49.74],
      [13.36, 49.74],
    ],
  ];
  assert.throws(() => validateRegion(r, { id: r.id }, epoch), /polygon/);
});

test("neighboring shards/countries cannot overlap zones", async (t) => {
  const root = workspace(t),
    cell = latLngToCell(49.75, 13.37, 5);
  const [lat, lng] = cellToBoundary(cell)[0];
  // Points on opposite sides of a shared res-5 vertex. Find two owners without
  // hardcoding a dependency's H3 boundary rounding behaviour.
  const candidates = [
    [-0.0002, 0],
    [0.0002, 0],
    [0, -0.0002],
    [0, 0.0002],
  ].map(([dy, dx], i) => zone(`border-${i}`, lat + dy, lng + dx, "UTC", 0.005));
  const a = candidates[0],
    b = candidates.find((v) => ownerCell(v.label) !== ownerCell(a.label));
  assert.ok(b);
  const areas = new Map(
    [a, b].map((z) => [z.areaId, { id: z.areaId, requestedZones: 1 }]),
  );
  const args = job(root, [regionFor([a], "CZ"), regionFor([b], "DE")], {
    areas: [...areas.values()],
  });
  const result = await prepareGlobalDay(args);
  assert.equal(result.state, "incomplete");
  assert.ok(result.regions.some((r) => /overlap|gap/.test(r.reason)));
});

test("Plzen has six shared slots and sparse areas need an explicit shortfall", async (t) => {
  const root = workspace(t),
    z = zone("plzen", 49.75, 13.37);
  z.areaId = "city:plzen";
  const args = job(root, [regionFor([z])]);
  assert.equal((await prepareGlobalDay(args)).state, "incomplete");
  const snapshot = JSON.parse(readFileSync(args.snapshotFile));
  snapshot.areas[0].shortfallReason = "fixture has one candidate";
  writeFileSync(args.snapshotFile, canonical(snapshot));
  const accepted = await prepareGlobalDay({
    ...args,
    outputDir: resolve(root, "shortfall"),
  });
  assert.equal(accepted.state, "content-prepared");
  assert.equal(accepted.areaCoverage[0].shortfall, 5);
  snapshot.areas[0].requestedZones = 7;
  assert.throws(() => validateSnapshot(snapshot), /six slots/);
});

test("unknown money/public fields, missing edition choices and wrong ownership are rejected", () => {
  const r = fixtureRegions()[0],
    descriptor = { id: r.id };
  r.objects[1].rewardYocto = "1000000000";
  assert.throws(
    () => validateRegion(r, descriptor, epoch),
    /unknown field rewardYocto/,
  );
  delete r.objects[1].rewardYocto;
  delete r.objects.find((o) => o.kind === "item").editionRef;
  assert.throws(
    () => validateRegion(r, descriptor, epoch),
    /edition reference/,
  );
  const clean = fixtureRegions()[0];
  assert.throws(
    () =>
      validateRegion(
        clean,
        { id: gridDisk(clean.id, 1).find((c) => c !== clean.id) },
        epoch,
      ),
    /identity/,
  );
  clean.objects[0].label = { lat: 0, lng: 0 };
  assert.throws(
    () => validateRegion(clean, descriptor, epoch),
    /another owner/,
  );
});

test("concurrent workers cannot mutate the same output and input symlinks cannot escape", async (t) => {
  const root = workspace(t),
    args = job(root),
    unlock = lockDirectory(args.outputDir);
  try {
    await assert.rejects(prepareGlobalDay(args), /already running/);
  } finally {
    unlock();
  }
  const external = resolve(root, "outside.json");
  writeFileSync(external, "{}");
  symlinkSync(external, resolve(root, "input/escaped.json"));
  assert.throws(
    () => inputFile(resolve(root, "input"), "escaped.json"),
    /within the supplied/,
  );
});

test("canonical input hashes do not depend on property order and reject non-JSON values", () => {
  assert.equal(
    digest({ b: 2, a: { y: 1, x: 0 } }),
    digest({ a: { x: 0, y: 1 }, b: 2 }),
  );
  assert.equal(sha256(canonical({ a: 1 })), digest({ a: 1 }));
  assert.throws(() => canonical({ a: NaN }), /finite JSON/);
});

test("a terminated worker's local lock can be recovered without changing prepared bytes", async (t) => {
  const root = workspace(t),
    args = job(root, fixtureRegions().slice(0, 1));
  const worker = new URL(
    "../server/world-preparation/worker.mjs",
    import.meta.url,
  ).href;
  const child = `import {prepareGlobalDay} from ${JSON.stringify(worker)}; await prepareGlobalDay({...${JSON.stringify(args)}, onRegion(){process.kill(process.pid, 'SIGKILL')}});`;
  assert.throws(() =>
    execFileSync(process.execPath, ["--input-type=module", "-e", child], {
      stdio: "pipe",
    }),
  );
  assert.equal(existsSync(resolve(args.outputDir, ".prepare.lock")), true);
  assert.equal(existsSync(resolve(args.outputDir, "manifest.json")), false);
  const status = JSON.parse(
    readFileSync(resolve(args.outputDir, "status.json")),
  );
  const bytes = readFileSync(
    resolve(args.outputDir, status.regions[0].public.path),
  );
  assert.equal((await prepareGlobalDay(args)).state, "content-prepared");
  assert.deepEqual(
    readFileSync(resolve(args.outputDir, status.regions[0].public.path)),
    bytes,
  );
  assert.equal(existsSync(resolve(args.outputDir, ".prepare.lock")), false);
});

test("preparation refuses an unrelated nonempty output directory", async (t) => {
  const root = workspace(t),
    args = job(root),
    unlock = lockDirectory(args.outputDir);
  unlock();
  const unrelated = resolve(args.outputDir, "do-not-touch.txt");
  writeFileSync(unrelated, "preserved");
  await assert.rejects(prepareGlobalDay(args), /empty isolated/);
  assert.equal(readFileSync(unrelated, "utf8"), "preserved");
});

test("shard ownership matches the POI builder at non-nested H3 edges", () => {
  // A measured point near an edge, away from vertices where these particular
  // class-II boundaries line up. Keep both index assertions as a real control.
  const edge = { lat: 49.71765310647777, lng: 13.246553922907362 };
  assert.equal(ownerCell(edge), "851e30d3fffffff");
  assert.equal(latLngToCell(edge.lat, edge.lng, 5), "851e36a7fffffff");
  const coin = object("coin", "edge-owned-coin", edge.lat, edge.lng);
  const region = regionFor([coin]);
  assert.equal(
    validateRegion(region, { id: ownerCell(edge) }, epoch).objects.length,
    1,
  );
  const independentlyIndexed = {
    ...region,
    id: latLngToCell(edge.lat, edge.lng, 5),
  };
  assert.throws(
    () =>
      validateRegion(
        independentlyIndexed,
        { id: independentlyIndexed.id },
        epoch,
      ),
    /res-7 parent/,
  );
});

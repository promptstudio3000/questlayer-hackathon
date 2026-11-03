// "Play in Brno" and "play in a village" (W12, docs/WORLD-COVERAGE.md).
//
// A phone (Chromium 390 x 844) starts outside the funded Plzeň demo: it
// names an explorer, turns on GPS at náměstí Svobody in Brno and on the
// village green of Holašovice, and must get a street world for that H3 cell
// with coins on mapped paths, the generic NPC cast, and POI quests available
// in the POI database. The server runs on a throwaway database with the
// Czechia POI fixture (tests/fixtures/world-coverage) as POI_DB_PATH, and the
// cells' path snapshots are pre-seeded, so the run needs no map network.
//
// Usage:  npm run build && npm run e2e:world
// Screenshots and journeys.json land in output/qa/world-journeys/ (override
// with E2E_SHOTS). E2E_BASE_URL is not supported: the journey owns its data.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { latLngToCell } from "h3-js";
import { chromium } from "playwright";
import {
  BRNO,
  VILLAGE,
  buildCzechiaFixture,
  pathsAround,
} from "../tests/fixtures/world-coverage/czechia.mjs";
import { coverageReport, openPoiDb } from "../server/poi/coverage.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS = resolve(
  process.env.E2E_SHOTS || join(ROOT, "output/qa/world-journeys"),
);
const JOURNEYS = [
  { id: "brno", title: "Play in Brno", spot: BRNO, minCoins: 5 },
  { id: "village", title: "Play in a village", spot: VILLAGE, minCoins: 3 },
];
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

async function freePort() {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

async function startServer(dir, poiDbPath) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const databasePath = join(dir, "e2e.sqlite");
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: url,
      DATABASE_PATH: databasePath,
      DISABLE_RELAYER: "1",
      POI_DB_PATH: poiDbPath,
      ACTORS_ENABLED: "1",
      // Generic actors keep 08:00-20:00 hours; the e2e runs at any hour.
      ACTORS_ALL_DAY: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 60_000;
  let health;
  for (;;) {
    try {
      health = await (await fetch(`${url}/api/health`)).json();
      if (health.worldPreparation?.days?.some((d) => d.state === "ready"))
        break;
    } catch {}
    if (Date.now() > deadline) throw Error("Server did not become ready.");
    await new Promise((r) => setTimeout(r, 500));
  }
  return { url, databasePath, health, stop: () => child.kill("SIGTERM") };
}

// The map adapter's cached snapshot, as server/spatial/map-data.mjs stores it.
function seedPaths(databasePath, spot) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    const now = Date.now(),
      region = latLngToCell(spot.lat, spot.lng, 7);
    const entry = {
      version: 1,
      paths: pathsAround(spot),
      observedAt: now,
      freshUntil: now + 6 * 86_400_000,
      retryAt: now + 6 * 86_400_000,
      attempts: 0,
    };
    db.prepare("INSERT OR REPLACE INTO geo_cache VALUES(?,?,?)").run(
      region,
      JSON.stringify(entry),
      entry.retryAt,
    );
    return region;
  } finally {
    db.close();
  }
}

async function journey(browser, server, j, expected) {
  console.log(`\n${j.title} (${j.spot.lat}, ${j.spot.lng})`);
  const context = await browser.newContext({
    ...PHONE,
    reducedMotion: "reduce",
    locale: "en-GB",
    geolocation: { latitude: j.spot.lat, longitude: j.spot.lng, accuracy: 8 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(server.url);
    await page.getByPlaceholder("Your explorer name").fill(`World ${j.id}`);
    await page.getByRole("button", { name: "Start exploring" }).click();
    const hide = page.getByRole("button", { name: "Hide first steps" });
    await hide.click({ timeout: 10_000 }).catch(() => {});
    const gpsWorld = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/world") &&
        r.request().method() === "POST" &&
        r.request().postDataJSON()?.arena === false,
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "Use GPS, my location" }).click();
    const world = await (await gpsWorld).json();
    const cell = latLngToCell(j.spot.lat, j.spot.lng, 7);
    // A city pack for this place (W5 auto cities) may own it later; either
    // way it must not be the Plzeň demo.
    assert.notEqual(world.cityId, "plzen", "GPS play left the Plzeň demo");
    if (!world.cityId) {
      assert.equal(world.region, cell, "street world is the player's H3 cell");
      assert.equal(world.coverage, "street-only");
    }
    assert.equal(world.arena, false);
    assert.ok(
      world.coins.length >= j.minCoins,
      `${world.coins.length} coins on mapped paths (want ≥ ${j.minCoins})`,
    );
    await page.waitForFunction(
      () => /GPS ±\d+ m/.test(document.body.innerText),
      null,
      { timeout: 15_000 },
    );
    const actors = await (
      await page.request.get(
        `${server.url}/api/actors?${new URLSearchParams({
          worldId: world.id,
          lat: String(j.spot.lat),
          lng: String(j.spot.lng),
        })}`,
      )
    ).json();
    const cast = (actors.actors || [])
      .map((a) => a.role || a.kind)
      .filter(Boolean);
    // The e2e server plans the cast all day (ACTORS_ALL_DAY), so this holds
    // at any hour; the 08:00-20:00 schedule itself is unit-tested.
    assert.ok(cast.length > 0, "the generic NPC/monster cast is on the map");
    // POI quests for this cell, from the database the server reads.
    assert.ok(
      expected.questsInCell > 0,
      "POI database has quests for this cell",
    );
    mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SHOTS, `${j.id}.png`) });
    assert.deepEqual(errors, [], "no page errors");
    const result = {
      journey: j.title,
      cell,
      worldId: world.id,
      cityId: world.cityId || null,
      coins: world.coins.length,
      zones: world.zones?.length || 0,
      cast: [...new Set(cast)],
      poiQuestsInCell: expected.questsInCell,
      nearestPoiQuestM: expected.nearestQuestM,
    };
    console.log(`  ${JSON.stringify(result)}`);
    return result;
  } finally {
    await context.close();
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-world-e2e-"));
  let server;
  const browser = await chromium.launch();
  try {
    const fixture = await buildCzechiaFixture(join(dir, "poi"));
    server = await startServer(dir, fixture.dbPath);
    const poi = server.health.poiWorld;
    assert.equal(
      poi?.status,
      "ready",
      `health poiWorld: ${JSON.stringify(poi)}`,
    );
    assert.equal(poi.version, "cz-fixture");
    assert.ok(poi.cellsWithQuests > 0);
    const db = openPoiDb(fixture.dbPath);
    const places = coverageReport(db, {
      cities: 2,
      days: 1,
      sample: 1,
      spotsList: JOURNEYS.map((j) => ({ name: j.id, ...j.spot })),
    }).places;
    db.close();
    for (const j of JOURNEYS) seedPaths(server.databasePath, j.spot);
    const results = [];
    for (const [i, j] of JOURNEYS.entries())
      results.push(await journey(browser, server, j, places[i]));
    writeFileSync(
      join(SHOTS, "journeys.json"),
      JSON.stringify(
        { poiWorld: { version: poi.version, status: poi.status }, results },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `\nWorld journeys passed: ${results.map((r) => r.journey).join(", ")}.`,
    );
  } finally {
    await browser.close();
    server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

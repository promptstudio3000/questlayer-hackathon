// "Play in Brno", "play in a village" and "an empty spot" (W12,
// docs/WORLD-COVERAGE.md): a newcomer's first session anywhere in Czechia.
//
// A phone starts outside the funded Plzeň demo: it names an explorer, turns
// on GPS at náměstí Svobody in Brno, on the village green of Holašovice and
// in a forest cell with no checked places, and must get a street world for
// that H3 cell with coins on mapped paths. In Brno and the village the
// first-steps coach must name the nearest POI quest, the map must mark that
// place as "Next quest", and tapping the coach line must open it; there the
// generic NPC cast must be out too. In the empty cell the coach must say so
// truthfully and the map marks nothing. The server runs on a throwaway
// database with the Czechia POI fixture (tests/fixtures/world-coverage) as
// POI_DB_PATH; the cells' path snapshots are pre-seeded (no map network).
// Server and browser clocks use a fixed afternoon on the same fixture date
// (scripts/lib/e2e-clock.mjs). Several coin waves must be open as well as POI
// quests, so the same checks apply at 02:00 and at noon on the CI host.
//
// Usage:  npm run build && npm run e2e:world [-- --device=<name>]
//   --device=phone-390  Chromium at 390 x 844 (default)
//   --device=iphone     WebKit with Playwright's iPhone 15 profile
//   --device=pixel      Chromium with Playwright's Pixel 7 profile
//   --device=all        all three in turn against one server
// E2E_DEVICE does the same. Screenshots and journeys.json land in
// output/qa/world-journeys/<device>/ (override the root with E2E_SHOTS).
// E2E_BASE_URL is not supported: the journey owns its data.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { latLngToCell } from "h3-js";
import { chromium, devices, webkit } from "playwright";
import {
  BRNO,
  EMPTY,
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
  { id: "brno", title: "Play in Brno", spot: BRNO, minCoins: 5, quests: true },
  {
    id: "village",
    title: "Play in a village",
    spot: VILLAGE,
    minCoins: 3,
    quests: true,
  },
  {
    id: "empty",
    title: "Play in an empty spot",
    spot: EMPTY,
    minCoins: 1,
    quests: false,
  },
];
const PHONE_390 = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const strip = ({ defaultBrowserType, ...profile }) => profile;
const DEVICES = {
  "phone-390": { engine: chromium, profile: PHONE_390 },
  iphone: { engine: webkit, profile: strip(devices["iPhone 15"]) },
  pixel: { engine: chromium, profile: strip(devices["Pixel 7"]) },
};
function chosenDevices() {
  const arg = process.argv.find((a) => a.startsWith("--device="));
  const name = (arg ? arg.slice(9) : process.env.E2E_DEVICE) || "phone-390";
  if (name === "all") return Object.keys(DEVICES);
  assert.ok(DEVICES[name], `Unknown device "${name}".`);
  return [name];
}
// Freeze the fixture date and wave phase, while keeping elapsed time flowing.
// Moving an evening run to 11:00 hid later coin waves and made the unchanged
// minimum-count assertions fail depending on when CI happened to run.
const CLOCK_OFFSET_MS = Date.parse("2026-11-07T16:00:00.000Z") - Date.now();

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
  const child = spawn(
    process.execPath,
    ["--import", "./scripts/lib/e2e-clock.mjs", "server/index.mjs"],
    {
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
      // The cast plays all day (test-only); POI quests keep 08:00-20:00, so
      // the clock is still moved into play hours for them.
      ACTORS_ALL_DAY: "1",
      E2E_CLOCK_OFFSET_MS: String(CLOCK_OFFSET_MS),
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
  );
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
    const now = Date.now() + CLOCK_OFFSET_MS,
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

async function journey(browser, server, device, j, expected) {
  console.log(`\n[${device}] ${j.title} (${j.spot.lat}, ${j.spot.lng})`);
  const context = await browser.newContext({
    ...DEVICES[device].profile,
    reducedMotion: "reduce",
    locale: "en-GB",
    geolocation: { latitude: j.spot.lat, longitude: j.spot.lng, accuracy: 8 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const shots = join(SHOTS, device);
  mkdirSync(shots, { recursive: true });
  try {
    if (CLOCK_OFFSET_MS)
      await page.clock.setSystemTime(new Date(Date.now() + CLOCK_OFFSET_MS));
    await page.goto(server.url);
    await page.getByPlaceholder("Your explorer name").fill(`World ${j.id}`);
    await page.getByRole("button", { name: "Start exploring" }).click();
    await page.getByRole("button", { name: "Let's explore", exact: true }).click();
    const coach = page.locator(".first-session");
    await coach
      .getByRole("heading", { name: "Reach the nearest find" })
      .waitFor({ timeout: 15_000 });
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
    const poiZones = world.zones.filter((z) => z.source === "poi");
    const result = {
      device,
      journey: j.title,
      cell,
      worldId: world.id,
      cityId: world.cityId || null,
      coins: world.coins.length,
      poiQuests: world.poiQuests?.status || null,
      poiZones: poiZones.length,
      poiQuestsInCell: expected.questsInCell,
      nearestPoiQuestM: expected.nearestQuestM,
    };
    if (j.quests) {
      assert.ok(
        expected.questsInCell > 0,
        "POI database has quests for this cell",
      );
      assert.equal(world.poiQuests?.status, "ready");
      assert.ok(poiZones.length > 0, "POI quests are in this street world");
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
      assert.ok(cast.length > 0, "the generic NPC/monster cast is on the map");
      result.cast = [...new Set(cast)];
      // The coach names the nearest open POI quest… Street coins next to
      // the spawn point are picked up on their own, so the coach may already
      // be on "Open your first chest". When that chest is the same POI quest
      // the coach hides its "Nearest quest" line and its main action opens
      // the quest instead, so either button counts.
      // With the one-objective map, a quest within reach replaces the
      // compact coach with a single "Open <quest>" action, so that counts too.
      const nearbyOpen = page.locator("button.nearby-open");
      await coach
        .getByRole("button", {
          name: /^(Nearest quest|Open the chest|Walk to the chest)/,
        })
        .first()
        .or(nearbyOpen)
        .filter({visible:true})
        .first()
        .waitFor({ timeout: 15_000 });
      // Let the auto pick-up of spawn-side coins settle before reading it.
      await page.waitForTimeout(2500);
      const chestButton = coach.getByRole("button", {
        name: /^(Open the chest|Walk to the chest)/,
      });
      const coachButton = coach
        .getByRole("button", { name: /^(Nearest quest|Open the chest|Walk to the chest)/ })
        .first();
      const nearbyLabel = (await nearbyOpen.isVisible())
        ? await nearbyOpen.innerText()
        : "";
      const nearbyQuest =
        !!nearbyLabel && world.quests.some((q) => nearbyLabel.includes(q.title));
      // An NPC or find within reach takes the single objective slot instead;
      // then the map's next-quest marker itself is the way in.
      const pinOnly = !nearbyQuest && !(await coachButton.isVisible());
      const opener = nearbyQuest
        ? nearbyOpen
        : pinOnly
          ? page.locator('.zone-map-pin[data-next="true"]')
          : (await chestButton.count())
            ? chestButton.first()
            : coach.getByRole("button", { name: /^Nearest quest/ });
      // …the map marks the same place…
      const pin = page.locator('.zone-map-pin[data-next="true"]');
      // Attached, not visible: map markers re-render on every world update
      // and WebKit can report one mid-swap as hidden.
      await pin.waitFor({ state: "attached", timeout: 15_000 }).catch(async (e) => {
        await page.screenshot({ path: join(shots, `${j.id}-no-next-pin.png`) });
        throw e;
      });
      assert.equal(await pin.count(), 1, "exactly one next-quest marker");
      const pinLabel = (await pin.getAttribute("aria-label")) || "";
      const zone = poiZones.find((z) => pinLabel.startsWith(`${z.name} · `));
      assert.ok(zone, `the next-quest marker "${pinLabel}" is a POI quest`);
      const label = pinOnly ? "" : await opener.innerText();
      let quest;
      if (pinOnly) {
        quest = world.quests.find((q) => q.zone_id === zone.id);
        assert.ok(quest, "the next-quest marker is one of today's quests");
      } else if (/^(Nearest quest|Open (?!the chest))/.test(label)) {
        quest = world.quests.find((q) => label.includes(q.title));
        assert.ok(quest, `coach quest "${label}" is one of today's quests`);
        assert.equal(
          quest.zone_id,
          zone.id,
          "the map's next-quest marker is the coach's quest",
        );
      } else {
        assert.match(
          await coach.innerText(),
          new RegExp(zone.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
          "the coach's chest is the map's next-quest marker",
        );
        quest = world.quests.find((q) => q.zone_id === zone.id);
        assert.ok(quest, "the coach's chest is one of today's quests");
      }
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(shots, `${j.id}-coach.png`) });
      // …and the coach opens it.
      if (pinOnly) await opener.dispatchEvent("click");
      else await opener.click();
      await page
        .getByRole("heading", { level: 1, name: zone.name })
        .waitFor({ timeout: 10_000 });
      await page
        .locator(
          world.quests
            .filter((q) => q.zone_id === zone.id)
            .map((q) => `[id="quest-${q.id}"]`)
            .join(", "),
        )
        .first()
        .waitFor({ state: "attached", timeout: 10_000 });
      result.coachQuest = quest.title;
      result.coachQuestKind = quest.kind;
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(shots, `${j.id}-quest.png`) });
    } else {
      assert.equal(world.poiQuests?.status, "empty", "empty cell is empty");
      assert.equal(poiZones.length, 0);
      await coach
        .getByText(/^No quests in this spot today\./)
        .waitFor({ timeout: 15_000 });
      assert.equal(
        await page.locator('.zone-map-pin[data-next="true"]').count(),
        0,
        "no next-quest marker without quests",
      );
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(shots, `${j.id}-coach.png`) });
      result.coachNote = "No quests in this spot today.";
    }
    assert.deepEqual(errors, [], "no page errors");
    console.log(`  ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    await page.screenshot({path:join(shots, `${j.id}-failure.png`)}).catch(() => {});
    writeFileSync(join(shots, `${j.id}-failure.json`),JSON.stringify(await page.evaluate(() => ({
      text:document.body.innerText.slice(-6000),
      coach:document.querySelector(".first-session")?.outerHTML,
      panelHidden:document.querySelector(".main-panel")?.hidden,
      panelClass:document.querySelector(".main-panel")?.className,
      dialogs:[...document.querySelectorAll("dialog[open]")].map(el=>el.getAttribute("aria-label")),
    })).catch(() => ({})),null,2));
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-world-e2e-"));
  let server;
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
    if (CLOCK_OFFSET_MS)
      console.log(`Clock moved by ${Math.round(CLOCK_OFFSET_MS / 60000)} min into play hours.`);
    const results = [];
    for (const device of chosenDevices()) {
      const browser = await DEVICES[device].engine.launch();
      try {
        for (const [i, j] of JOURNEYS.entries())
          results.push(await journey(browser, server, device, j, places[i]));
      } finally {
        await browser.close();
      }
    }
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(
      join(SHOTS, "journeys.json"),
      JSON.stringify(
        { poiWorld: { version: poi.version, status: poi.status }, results },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `\nWorld journeys passed: ${results.map((r) => `${r.device} ${r.journey}`).join(", ")}.`,
    );
  } finally {
    server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

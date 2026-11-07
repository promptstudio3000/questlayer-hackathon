// Local map-art integration journey. Uses the real solo demo on a loopback
// preview, never the public host, wallets, signing or production data.
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.MAP_KIT_PREVIEW || "http://127.0.0.1:5173";
assert(
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname),
  "Loopback preview only",
);
const out = "output/qa/map-kit-integration";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const servicesOnly = process.argv.includes("--services-only");
const report = servicesOnly
  ? JSON.parse(await readFile(`${out}/interaction-checks.json`, "utf8"))
  : { base, hardwareVerified: false, viewports: [], errors: [] };
try {
  for (const [name, width, height] of [
    ["phone-360", 360, 800],
    ["phone-390", 390, 844],
    ["landscape", 844, 390],
    ["desktop", 1440, 900],
  ].filter(() => !servicesOnly)) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [],
      assets = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().includes("/art/map-kit/"))
        assets.push({ url: r.url().replace(base, ""), status: r.status() });
    });
    await page.goto(base);
    await page.getByLabel("What should we call you?").fill(`Art check ${name}`);
    assert.equal(
      assets.filter((a) => a.url.endsWith(".glb")).length,
      0,
      "No model before joining",
    );
    await page
      .getByRole("button", { name: "Start exploring", exact: true })
      .click();
    await page
      .locator('.game-map[data-altar-models="6"]')
      .waitFor({ timeout: 60000 });
    await page.screenshot({ path: `${out}/${name}-map.png` });
    // List alternative selects the same zone as its native map button.
    if (
      await page
        .getByRole("button", { name: "Hide first steps", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "Hide first steps", exact: true })
        .click();
    const zone = page.locator(".zone-map-pin").first();
    await zone.focus();
    await zone.press("Enter");
    await page
      .locator(".quest-map-pin:not(.creator-map-pin)")
      .first()
      .waitFor();
    await page.locator(".map-guide-key").waitFor();
    assert.match(
      await page.locator(".map-guide-key").innerText(),
      /not a walking route/,
    );
    const sizes = await page
      .locator(".zone-map-pin,.quest-map-pin")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          w: n.getBoundingClientRect().width,
          h: n.getBoundingClientRect().height,
        })),
      );
    assert(
      sizes.every((s) => s.w >= 48 && s.h >= 48),
      "48 px pin controls",
    );
    await page.screenshot({ path: `${out}/${name}-zone.png` });
    // Select the chest via its real pin with keyboard; GLB changes with that
    // existing activity selection and opens the existing quest detail.
    const chest = page
      .locator(".quest-map-pin")
      .filter({ has: page.locator('[data-map-kit="chest"]') })
      .first();
    await chest.focus();
    await chest.press("Enter");
    await page.waitForFunction(() =>
      document.querySelector('.zone-map-pin [data-map-kit="chest"]'),
    );
    await page.waitForFunction(
      () =>
        Number(document.querySelector(".game-map")?.dataset.altarDrawCalls) >
          0 &&
        document.querySelector(".game-map")?.dataset.altarModels === "6" &&
        document
          .querySelector(".game-map")
          ?.dataset.altarModelIds?.includes("chest-tier-1"),
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".map-kit-checkpoint").length === 1,
    );
    await page.screenshot({ path: `${out}/${name}-chest.png` });
    if (name === "desktop") {
      await page.mouse.move(width * 0.6, height * 0.46);
      await page.mouse.wheel(0, -350);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/desktop-altar-detail.png` });
    }
    const state = await page.locator(".game-map").evaluate((el) => ({
      models: el.dataset.altarModels,
      drawCalls: el.dataset.altarDrawCalls,
      modelIds: el.dataset.altarModelIds,
    }));
    const original = await page.locator(".player-marker").innerHTML();
    assert(
      !original.includes("/art/map-kit/"),
      "Canonical character remains separate",
    );
    await page.locator(".map-guide-key").evaluate((el) => {
      el.style.fontSize = "28px";
    });
    assert(
      await page
        .locator(".map-guide-key")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "Enlarged guide text fits",
    );
    await page.screenshot({ path: `${out}/${name}-large-text.png` });
    await page.locator(".map-guide-key").evaluate((el) => {
      el.style.fontSize = "";
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "No horizontal page overflow",
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    report.viewports.push({
      name,
      width,
      height,
      state,
      sizes,
      assets,
      errors,
    });
    if (name === "desktop") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/desktop-to-phone-resize.png` });
    }
    await context.close();
  }
  // Failed GLBs keep all native extrusion fallbacks; an image outage keeps
  // authored object fallback buttons clickable. No server data is altered.
  if (!servicesOnly) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.route("**/art/map-kit/models/*.glb", (r) => r.abort());
    await page.route("**/art/map-kit/quests/*.png", (r) => r.abort());
    await page.goto(base);
    await page
      .getByLabel("What should we call you?")
      .fill("Art fallback check");
    await page
      .getByRole("button", { name: "Start exploring", exact: true })
      .click();
    await page
      .locator('.game-map[data-altar-fallbacks="6"]')
      .waitFor({ timeout: 60000 });
    await page.locator(".zone-map-pin .game-object-art").first().waitFor();
    assert.equal(
      await page.locator(".game-map").getAttribute("data-altar-models"),
      "0",
    );
    await page.locator(".zone-map-pin").first().focus();
    await page.locator(".zone-map-pin").first().press("Enter");
    await page.screenshot({ path: `${out}/phone-fallback.png` });
    report.fallback = "6 native extrusions and authored pin fallback retained";
    await context.close();
  }
  // Deterministic service fixture: proves artwork and original NPC sprites
  // coexist even when today's real schedule has no NPC in the viewport.
  // Intercepts browser responses only; never publishes or inserts world data.
  const services = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const servicePage = await services.newPage();
  const serviceLogs=[]; servicePage.on("pageerror",e=>serviceLogs.push(e.message)); servicePage.on("console",m=>{if(m.type()==="error")serviceLogs.push(m.text());});
  await servicePage.route("**/api/actors?*", async (route) => {
    const url = new URL(route.request().url()),
      lat = Number(url.searchParams.get("lat")),
      lng = Number(url.searchParams.get("lng")),
      now = Date.now();
    const roles = ["trader", "keeper", "storyteller", "quest_giver", "boss"];
    await route.fulfill({
      json: {
        enabled: true,
        worldId: url.searchParams.get("worldId"),
        now,
        actors: roles.map((archetype, i) => ({
          id: `fixture-${archetype}`,
          kind: archetype === "boss" ? "monster" : "npc",
          archetype,
          name: `Fixture ${archetype}`,
          model: ["merchant", "keeper", "chronicler", "pilgrim", "storm-golem"][
            i
          ],
          state: "active",
          segments: [
            {
              from: now - 60000,
              to: now + 3600000,
              dwell: true,
              path: [[lng + (i - 2) * 0.0004, lat - 0.0003]],
            },
          ],
          ...(archetype === "boss"
            ? {
                arena: {
                  model: "great-portal",
                  lat: lat - 0.0007,
                  lng: lng + 0.0008,
                },
              }
            : {}),
        })),
      },
    });
  });
  await servicePage.route("**/api/gold/map?*", async (route) => {
    const url = new URL(route.request().url()),
      lat = Number(url.searchParams.get("lat")),
      lng = Number(url.searchParams.get("lng"));
    await route.fulfill({
      json: {
        lures: [],
        now: Date.now(),
        places: [
          {
            id: "fixture-note",
            kind: "topic",
            text: "Fixture place note",
            posts: 1,
            lat: lat - 0.0007,
            lng: lng - 0.0008,
          },
        ],
      },
    });
  });
  await servicePage.goto(base);
  await servicePage
    .getByLabel("What should we call you?")
    .fill("Service art fixture");
  await servicePage
    .getByRole("button", { name: "Start exploring", exact: true })
    .click();
  await servicePage.waitForFunction(
    () => document.querySelectorAll(".map-kit-service").length === 5,
    null, {timeout:60000}
  ).catch(async error => {
    await servicePage.screenshot({path:`${out}/services-failure.png`});
    console.log(JSON.stringify({logs:serviceLogs,body:await servicePage.locator("body").innerText()},null,2)); throw error;
  });
  await servicePage.waitForFunction(
    () => document.querySelectorAll(".actor-marker .actor-sprite").length === 5,
  );
  await servicePage.locator(".actor-arena .actor-sprite").waitFor();
  await servicePage.locator(".map-kit-portal").waitFor();
  await servicePage.locator(".map-kit-note").waitFor();
  await servicePage.waitForFunction(() =>
    [
      ...document.querySelectorAll(
        ".map-kit-service,.map-kit-portal,.map-kit-note,.actor-sprite",
      ),
    ].every((img) => img.complete && img.naturalWidth > 0),
  );
  await servicePage.screenshot({ path: `${out}/services-fixture.png` });
  report.serviceFixture = {
    originalActorSprites: 5,
    originalPortalSprites: 1,
    npcAndBossPins: 5,
    portalPins: 1,
    notePins: 1,
    scope: "Browser-only fixture; not evidence of live service availability",
  };
  await services.close();
  await writeFile(
    `${out}/interaction-checks.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Map kit passed at ${report.viewports.length} viewports; asset failures retain fallbacks.`,
  );
} finally {
  await browser.close();
}

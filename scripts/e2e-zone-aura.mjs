// Isolated local UI evidence for the open, organic zone aura presentation.
import { chromium } from "playwright";
import sharp from "sharp";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  zoneWallFeatures,
  totemHeight,
  zoneRarity,
} from "../src/zone-landmarks.ts";
const base = process.env.ZONE_AURA_PREVIEW || "http://127.0.0.1:5173";
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
const out = "output/qa/zone-aura-2026-11-07";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const result = {
  scope:
    "Local demo and browser emulation; no production or field verification",
  viewports: [],
};
try {
  for (const [name, width, height] of [
    ["phone-360", 360, 800],
    ["phone-390", 390, 844],
    ["landscape", 844, 390],
    ["desktop", 1440, 900],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    await context.addInitScript(()=>{try{localStorage.setItem("questlayer.playMode","demo")}catch{}});  // Start in the city demo (src/play-here.ts).
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /THREE|shader|WebGL|React/.test(m.text()))
        errors.push(m.text());
    });
    await page.goto(base);
    await page.getByLabel("What should we call you?").fill(`Zone aura ${name}`);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/world") &&
        r.request().method() === "POST" &&
        r.status() === 200,
    );
    await page
      .getByRole("button", { name: "Start exploring", exact: true })
      .click();
    const world = await (await response).json();
    await page.waitForFunction(
      () =>
        Number(document.querySelector(".game-map")?.dataset.zoneAuraWalls) > 0,
      null,
      { timeout: 60000 },
    );
    const expected = zoneWallFeatures(
      world.zones,
      world.quests,
      Date.now(),
    ).length;
    assert.equal(
      Number(
        await page.locator(".game-map").getAttribute("data-zone-aura-walls"),
      ),
      expected,
    );
    if (name === "desktop") {
      const distance = (p) => {
        const a = world.center,
          r = Math.PI / 180;
        return Math.round(
          Math.hypot(
            (p.lng - a.lng) * r * Math.cos(((p.lat + a.lat) * r) / 2),
            (p.lat - a.lat) * r,
          ) * 6371000,
        );
      };
      result.city = {
        day: world.day,
        center: world.center,
        zones: world.zones.map((z) => ({
          name: z.name,
          tier: z.tier,
          color: z.color,
          rarityCap: zoneRarity(z.tier),
          lat: z.lat,
          lng: z.lng,
          straightLineMetersFromDefault: distance(z),
          opensAt: z.opensAt,
          closesAt: z.closesAt,
          altarHeight: totemHeight(z.tier),
        })),
      };
    }
    if (
      await page
        .getByRole("button", { name: "Hide first steps", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "Hide first steps", exact: true })
        .click();
    const pin = page.locator(".zone-map-pin").first();
    await pin.focus();
    await pin.press("Enter");
    await page.locator(".quest-map-pin").first().waitFor();
    await page
      .locator('.game-map[data-map-render-state="idle"]')
      .waitFor({ timeout: 60000 });
    const selectedFrame = await page.screenshot({
      path: `${out}/${name}-selected.png`,
    });
    if (name === "desktop") {
      const region = await sharp(selectedFrame)
        .extract({ left: 1180, top: 260, width: 120, height: 220 })
        .toBuffer();
      const stats = await sharp(region).stats();
      const variation = stats.channels.slice(0, 3).map((c) => c.stdev);
      assert(
        Math.max(...variation) > 5,
        "map tiles still render beside the 3D layer; no blank clipping region",
      );
    }
    // A future gold zone remains visibly upcoming, not playable by its art.
    const gold = page.locator(".zone-map-pin.tier-3").first();
    await gold.focus();
    await gold.press("Enter");
    await page
      .locator('.game-map[data-map-render-state="idle"]')
      .waitFor({ timeout: 60000 });
    await page.screenshot({ path: `${out}/${name}-gold.png` });
    const goldLabel = await gold.getAttribute("aria-label");
    // City overview must retain all six system locations and their tier colors.
    const tools = page.getByRole("button", { name: "Map tools", exact: true });
    if (await tools.isVisible()) await tools.click();
    await page
      .getByRole("button", { name: "City overview", exact: true })
      .click();
    await page.waitForTimeout(500);
    await page
      .locator('.game-map[data-map-render-state="idle"]')
      .waitFor({ timeout: 60000 });
    await page.screenshot({ path: `${out}/${name}-city.png` });
    assert.equal(await page.locator(".zone-map-pin").count(), 6);
    const rarityFrames = await page
      .locator(".zone-map-pin")
      .evaluateAll((nodes) => [
        ...new Set(nodes.map((n) => n.style.borderColor)),
      ]);
    assert.equal(rarityFrames.length, 3);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    result.viewports.push({
      name,
      width,
      height,
      walls: expected,
      goldLabel,
      errors,
    });
    await context.close();
  }
  await writeFile(
    `${out}/interaction-checks.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(
    "Open aura walls, preserved six-zone city and smaller altars verified at four viewports.",
  );
} finally {
  await browser.close();
}

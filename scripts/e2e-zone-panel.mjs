// Local solo-demo UI checks. No wallets, public host or production state.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const out = "output/qa/zone-panel-2026-11-07";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];
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
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByLabel("What should we call you?").fill(`Panel ${name}`);
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
    await page
      .locator('.game-map[data-map-render-state="idle"]')
      .waitFor({ timeout: 60000 });
    const skip = page.getByRole("button", {
      name: "Skip first steps",
      exact: true,
    });
    if (await skip.isVisible()) await skip.click();
    const zone = world.zones.find(
      (z) =>
        z.tier === 1 &&
        world.quests.some(
          (q) =>
            q.zone_id === z.id &&
            !q.completed &&
            q.opens_at <= Date.now() &&
            q.closes_at > Date.now(),
        ),
    );
    assert(zone, "An open free place exists in the real local demo");
    const pin = page.locator(`.zone-map-pin[data-zone-id="${zone.id}"]`);
    await pin.focus();
    await pin.press("Enter");
    const panel = page.locator(".zone-explore-panel");
    await page.locator(".activity-row").first().waitFor();
    assert.equal(await panel.locator(".first-session").count(), 0);
    assert.equal(await panel.locator(".quest-detail").count(), 1);
    assert.equal(
      await panel.locator(".activity-row").count(),
      world.quests.filter((q) => q.zone_id === zone.id).length,
    );
    const close = panel.getByRole("button", {
      name: "Close panel",
      exact: true,
    });
    const closeBox = await close.boundingBox();
    assert(
      closeBox.width >= 48 && closeBox.height >= 48,
      "Close target is at least 48 px",
    );
    assert(await close.isVisible());
    const metrics = await panel.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      bodyFont: getComputedStyle(el.querySelector(".activity-objective"))
        .fontSize,
      secondaryFont: getComputedStyle(el.querySelector(".activity-row small"))
        .fontSize,
    }));
    assert(
      metrics.scrollWidth <= metrics.clientWidth + 1,
      "No panel horizontal overflow",
    );
    assert(
      parseFloat(metrics.bodyFont) >= 16 &&
        parseFloat(metrics.secondaryFont) >= 14,
      "Readable text sizes",
    );
    assert(
      await panel
        .locator(".quest-thumbnail img")
        .evaluateAll((images) =>
          images.every((i) => i.complete && i.naturalWidth > 0),
        ),
    );
    if (name === "desktop") {
      const bottom = await page.locator(".player-bottom").count() ? await page.locator(".player-bottom").boundingBox() : { width: 420 };
      assert.equal(
        metrics.width,
        bottom.width,
        "Player and zone panel widths align",
      );
    }
    await page.screenshot({ path: `${out}/${name}-detail.png` });
    await panel.locator('.activity-row[aria-expanded="true"]').click();
    assert.equal(
      await panel.locator(".quest-detail").count(),
      0,
      "A selected activity can be collapsed",
    );
    await panel.locator(".activity-row").first().click();
    await panel.locator(".quest-detail").waitFor();
    // The list switches the one expanded detail instead of stacking cards.
    const chest = world.quests.find(
      (q) => q.zone_id === zone.id && q.kind === "chest",
    );
    if (chest) {
      await page.locator(`.activity-row[data-quest-id="${chest.id}"]`).click();
      const detail = page.locator(".quest-detail");
      assert.equal(await detail.count(), 1);
      assert.equal(await detail.getAttribute("id"), `quest-${chest.id}`);
      assert.match(
        await detail.innerText(),
        chest.itemAvailable === true
          ? /Aura chest/
          : chest.itemAvailable === false
            ? /XP only/
            : /Aura not confirmed/,
      );
      await page.screenshot({ path: `${out}/${name}-chest.png` });
    }
    const guide = panel.getByRole("button", { name: "Guide me", exact: true });
    await guide.click();
    await page.locator(".zone-explore-panel.sheet-compact").waitFor();
    assert.equal(await page.locator(".quest-detail").isVisible(), false);
    await page.locator(".map-guide-key").waitFor();
    if (chest)
      assert.equal(
        await page.locator(".map-kit-checkpoint").count(),
        1,
        "A chest guide ends at the selected chest, not another trail",
      );
    assert.match(
      await page.locator(".map-guide-key").innerText(),
      /not a walking route/,
    );
    await page
      .locator('.game-map[data-map-render-state="idle"]')
      .waitFor({ timeout: 60000 });
    const end = await page.locator(".map-kit-checkpoint").last().boundingBox();
    const padBox = await page.locator(".demo-pad").boundingBox();
    if (padBox && end)
      assert(
        !(
          end.x < padBox.x + padBox.width &&
          end.x + end.width > padBox.x &&
          end.y < padBox.y + padBox.height &&
          end.y + end.height > padBox.y
        ),
        "The guide endpoint stays clear of the demo pad",
      );
    await page.screenshot({ path: `${out}/${name}-guide.png` });
    const compact = page.locator(".compact-selection");
    assert(await compact.isVisible());
    assert.equal(
      await compact.evaluate((el) => el === document.activeElement),
      true,
      "Focus follows the collapsed objective",
    );
    await compact.click();
    await page.locator(".quest-detail").waitFor();
    // Enlarged text, without changing the world or rewards.
    await page.addStyleTag({
      content:
        ".zone-explore-panel {font-size:20px} .zone-explore-panel .activity-row strong,.zone-explore-panel .quest-detail .activity-objective {font-size:20px} .zone-explore-panel .activity-row small {font-size:18px}",
    });
    assert(await close.isVisible());
    assert(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: `${out}/${name}-enlarged.png` });
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".zone-explore-panel").count(),
      0,
      "Escape closes the selection",
    );
    assert.equal(
      await page.evaluate(
        (id) => document.activeElement?.dataset.zoneId === id,
        zone.id,
      ),
      true,
      "Focus returns to the originating zone pin",
    );
    await pin.press("Enter");
    await page.locator(".activity-row").first().waitFor();
    await close.click();
    assert.equal(
      await page.locator(".zone-explore-panel").count(),
      0,
      "Close button clears the selection",
    );
    assert.deepEqual(errors, []);
    results.push({
      name,
      width,
      height,
      metrics,
      checks:
        "Images, list selection, stock, guide, collapse/reopen, close, Escape, focus return, enlarged text",
    });
    await context.close();
    console.log(`${name} passed`);
  }
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  await browser.close();
}

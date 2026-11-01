// Evidence for slice 2 "Today's pot". Usage: node shots.cjs <outDir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:18787";
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const G = (gold) => (BigInt(Math.round(gold * 1000)) * 10n ** 18n).toString(); // GOLD -> yocto
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now() + 86400000);
const nowIso = new Date().toISOString();

function economy({ yieldPaid = "0", stakingStatus = "observed" } = {}) {
  return {
    version: 1, network: "testnet", unit: "yoctoNEAR", goldPerNear: 1000, generatedAt: nowIso, status: "observed",
    treasury: {
      status: "observed", observedAt: nowIso, blockHeight: 224110871, blockHash: "8kq2bV2v1oMZ1nF2e9GfJ7oTt3m3w4uM7JbXz6m7QeQd",
      data: {
        policy: "50/50-v1",
        buckets: {
          coins: { available: G(88), reserved: G(10.2), awarded: G(1.8) },
          zones: { available: G(88), reserved: G(11), awarded: G(1) },
        },
        funded: G(200), available: G(176), reserved: G(21.2), owed: G(2.8), pending: "0", withdrawn: "0",
        rewardLiabilities: G(200), reconciled: true,
        fundingLabel: "Confirmed reward funding; sponsors and realized yield are distinct sources.",
        excludes: ["player principal", "operating top-ups", "receipt storage fees"],
      },
    },
    staking: {
      status: stakingStatus, observedAt: nowIso,
      data: {
        complete: true, poolComplete: true,
        coverage: { registeredPositions: 2, observedPositions: 2, unavailablePositions: 0, observedPoolPositions: 2, staleVaultPoolObservations: 0, pendingCreationCount: 0 },
        totals: { principal: G(10), weightedStake: "0", ownerCredit: "0", ownerPending: "0", ownerPaid: "0", gameCredit: "0", gamePending: "0", realizedGameYieldPaid: yieldPaid },
        stakers: 1, contributingStakers: 1, poolBalances: { staked: G(10), unstaked: "0" }, phases: { active: 2 }, pools: [], unlocks: [],
        tierPolicy: "conservative-mature-principal-v1", contributionPolicy: "fixed-per-vault", apy: null,
        outlook: { day: null, week: null, month: null, quarter: null, year: null, reason: "No attributable realized-yield history supports a forecast yet." },
      },
    },
    worker: { status: "observed", queued: 0 },
  };
}
function distribution({ drift = false } = {}) {
  const checks = [
    { name: "ledger-conservation", ok: true, funded: G(200), accountedFor: G(200) },
    { name: "coin-reservations-explained", ok: true, reserved: G(10.2), openDaysOwe: G(10.2) },
    { name: "zone-reservations-explained", ok: !drift, reserved: G(11), openDaysOwe: drift ? G(12) : G(11) },
    { name: "open-days-match-manifests", ok: true },
    { name: "receipts-within-chain-claims", ok: true },
    { name: "date-totals-match-publications", ok: true, dates: [
      { date: today, ok: true, chainCoins: G(6), chainZones: G(6), ourCoins: G(6), ourZones: G(6), cap: G(50) },
      { date: tomorrow, ok: true, chainCoins: G(6), chainZones: G(6), ourCoins: G(6), ourZones: G(6), cap: G(50) },
    ] },
    { name: "account-covers-liabilities", ok: true, liquid: "9464537990940827400000000", liabilities: G(197.2), headroom: "9267337990940827400000000" },
  ];
  return {
    status: drift ? "drift" : "verified", network: "testnet", contractId: "questlayer-rewards-20261101.testnet", observedAt: Date.now() - 4 * 60000,
    failed: drift ? ["zone-reservations-explained"] : [], checks,
    totals: { funded: G(200), liabilities: G(197.2), awarded: G(2.8), withdrawn: "0" },
    days: [
      { id: `plzen-${today}-v1`, localState: "published", chain: "open", manifestMatches: true, unclaimedCoins: G(4.2), unwonPrizes: G(5), claimsAccepted: 4, localConfirmed: 4 },
      { id: `plzen-${tomorrow}-v1`, localState: "published", chain: "open", manifestMatches: true, unclaimedCoins: G(6), unwonPrizes: G(6), claimsAccepted: 0, localConfirmed: 0 },
    ],
    scope: "Reward treasury and published city days.",
  };
}

const VIEWPORTS = {
  "360": { width: 360, height: 780 },
  "390": { width: 390, height: 844 },
  "844x390": { width: 844, height: 390 },
  "1280": { width: 1280, height: 800 },
};
const CHAIN = /\b(NEAR|testnet|transactions?|wallets?|yocto\w*)\b/i;
const findings = [];
const note = (s) => { findings.push(s); console.log(s); };

async function start(browser, vp, scenario, extra = {}) {
  const context = await browser.newContext({ viewport: vp, deviceScaleFactor: extra.scale || 1, reducedMotion: extra.reducedMotion || "no-preference" });
  if (extra.native) await context.addInitScript(() => { try { localStorage.setItem("questlayer-play-mode", "near"); localStorage.setItem("questlayer-play-mode-chosen", "1"); } catch {} });
  const page = await context.newPage();
  // Never let the browser reach external tile/RPC hosts; tiles are blocked in this environment anyway.
  if (scenario !== "live") {
    await page.route("**/api/native/economy*", (route) => {
      if (scenario === "failed") return route.abort("failed");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(economy(extra.economy)) });
    });
    await page.route("**/api/native/distribution*", (route) => {
      if (scenario === "failed") return route.abort("failed");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(distribution(extra.distribution)) });
    });
  }
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const name = page.getByPlaceholder("Your explorer name");
  await name.waitFor({ timeout: 20000 });
  await name.fill("Mira");
  await page.getByRole("button", { name: /Start exploring/ }).click();
  await page.locator(".main-panel").waitFor({ timeout: 20000 });
  const toggle = page.locator(".sheet-toggle");
  if (await toggle.isVisible()) {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  }
  const pot = page.locator(".todays-pot");
  await pot.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => document.querySelector(".todays-pot")?.getAttribute("data-pot-state") !== "loading", null, { timeout: 15000 });
  await page.waitForTimeout(400);
  return { context, page, pot };
}

async function audit(page, selector, label) {
  const r = await page.evaluate(([sel, chain]) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const re = new RegExp(chain, "i");
    let minFont = 99, minFontText = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (el.closest('[aria-hidden="true"]')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < minFont) { minFont = fs; minFontText = n.textContent.trim().slice(0, 40); }
    }
    const small = [...root.querySelectorAll("button, a")].concat(root.matches("button") ? [root] : [])
      .map((b) => ({ t: b.innerText.trim().slice(0, 30), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
      .filter((b) => b.h < 48 || b.w < 48);
    const docW = document.documentElement.scrollWidth, winW = window.innerWidth;
    return { chainWord: (root.innerText.match(re) || [null])[0], minFont, minFontText, small, hScroll: docW > winW };
  }, [selector, CHAIN.source]);
  note(`${label} ${selector}: chainWord=${r?.chainWord} minFont=${r?.minFont} (${r?.minFontText}) smallTargets=${JSON.stringify(r?.small)} hScroll=${r?.hScroll}`);
}

async function shoot(page, file) { const later = page.getByRole("button", { name: "Later" }); if (await later.isVisible().catch(() => false)) { await later.click().catch(() => {}); await page.waitForTimeout(150); } await page.screenshot({ path: path.join(OUT, file) }); }

async function scrollPanel(page, to) {
  await page.evaluate((y) => { const p = document.querySelector(".main-panel"); if (p) p.scrollTop = y === "end" ? p.scrollHeight : y; }, to);
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch();
  const consoleErrors = [];
  // 1. Live QA server: endpoints answer 503 -> practice label. 2. Populated via route.fulfill.
  for (const scenario of ["live", "populated"]) {
    for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
      const { context, page, pot } = await start(browser, vp, scenario);
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${scenario}/${vpName}: ${m.text().slice(0, 160)}`));
      const tag = scenario === "live" ? "practice-503" : "populated";
      note(`${tag} ${vpName}: pot state=${await pot.getAttribute("data-pot-state")} text="${(await pot.innerText()).replace(/\s+/g, " ")}"`);
      await pot.scrollIntoViewIfNeeded();
      await shoot(page, `explore-${tag}-${vpName}.png`);
      await pot.screenshot({ path: path.join(OUT, `pot-${tag}-${vpName}.png`) });
      await audit(page, ".todays-pot", `${tag} ${vpName}`);
      await pot.click();
      await page.locator(".reward-funding").waitFor();
      await page.waitForTimeout(300);
      const h1 = await page.evaluate(() => ({ text: document.activeElement?.textContent, tag: document.activeElement?.tagName }));
      note(`${tag} ${vpName}: after open focus=${h1.tag} "${h1.text}"`);
      await shoot(page, `funding-${tag}-${vpName}-top.png`);
      await audit(page, ".reward-funding", `${tag} ${vpName}`);
      if (vpName === "390" || vpName === "1280" || vpName === "360") {
        const height = await page.evaluate(() => document.querySelector(".main-panel").scrollHeight);
        const client = await page.evaluate(() => document.querySelector(".main-panel").clientHeight);
        let i = 1;
        for (let y = client - 60; y < height; y += client - 60) {
          await scrollPanel(page, y);
          await shoot(page, `funding-${tag}-${vpName}-part${++i}.png`);
          if (i > 8) break;
        }
      }
      await scrollPanel(page, "end");
      await page.getByRole("button", { name: "Back to exploring" }).click();
      await page.locator(".todays-pot").waitFor();
      await page.waitForTimeout(200);
      const back = await page.evaluate(() => document.activeElement?.className);
      note(`${tag} ${vpName}: after "Back to exploring" focus class=${back}`);
      await context.close();
    }
  }
  // 3. Extra states at 390: drift, failed/offline, mixed yield, native ledger, reduced motion, 200% zoom.
  const vp = VIEWPORTS["390"];
  for (const [tag, scenario, extra] of [
    ["drift", "populated", { distribution: { drift: true } }],
    ["failed", "failed", {}],
    ["mixed-yield", "populated", { economy: { yieldPaid: G(0.002) } }],
    ["native-ledger", "populated", { native: true }],
    ["zoom200", "populated", { scale: 2 }],
  ]) {
    const v = tag === "zoom200" ? { width: 195, height: 422 } : vp;
    let s;
    try { s = await start(browser, v, scenario, extra); } catch (e) { note(`${tag}: could not reach pot: ${e.message.split("\n")[0]}`); continue; }
    const { context, page, pot } = s;
    note(`${tag}: pot state=${await pot.getAttribute("data-pot-state")} text="${(await pot.innerText()).replace(/\s+/g, " ")}"`);
    await pot.scrollIntoViewIfNeeded();
    await shoot(page, `explore-${tag}-390.png`);
    await pot.screenshot({ path: path.join(OUT, `pot-${tag}-390.png`) });
    await audit(page, ".todays-pot", tag);
    await pot.click();
    await page.locator(".reward-funding").waitFor();
    await page.waitForTimeout(300);
    await shoot(page, `funding-${tag}-390-top.png`);
    if (tag === "drift" || tag === "failed") {
      const target = tag === "drift" ? "#funding-books" : "#funding-today";
      await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "start" }), target);
      await page.waitForTimeout(150);
      await shoot(page, `funding-${tag}-390-detail.png`);
    }
    await audit(page, ".reward-funding", tag);
    await context.close();
  }
  // 4. Keyboard journey at 1280 (populated): Tab to the pot, Enter, check focus, Escape/back.
  {
    const { context, page } = await start(browser, VIEWPORTS["1280"], "populated");
    let reached = false;
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.classList.contains("todays-pot"))) { reached = i + 1; break; }
    }
    note(`keyboard: reached pot after ${reached} Tab presses`);
    await shoot(page, "keyboard-focus-pot-1280.png");
    await page.keyboard.press("Enter");
    await page.locator(".reward-funding").waitFor();
    await page.waitForTimeout(200);
    note(`keyboard: after Enter focus=${await page.evaluate(() => document.activeElement?.tagName + " " + document.activeElement?.textContent)}`);
    // Tab to the "Check again" button and activate it
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.textContent?.includes("Back to exploring"))) break;
    }
    await shoot(page, "keyboard-focus-back-1280.png");
    await page.keyboard.press("Enter");
    await page.locator(".todays-pot").waitFor();
    await page.waitForTimeout(200);
    note(`keyboard: after Back focus class=${await page.evaluate(() => document.activeElement?.className)}`);
    // Browser back from the page returns to Explore
    await page.locator(".todays-pot").click();
    await page.locator(".reward-funding").waitFor();
    await page.goBack();
    await page.waitForTimeout(400);
    note(`history: after browser Back, pot visible=${await page.locator(".todays-pot").isVisible()} page visible=${await page.locator(".reward-funding").count()}`);
    await context.close();
  }
  note(`console errors: ${consoleErrors.length ? consoleErrors.join(" | ") : "none"}`);
  fs.writeFileSync(path.join(OUT, "interaction-log.txt"), findings.join("\n") + "\n");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Every game journey, played against the LIVE testnet server
// (https://questlayer.promptstudio3000.com by default) on phone-sized
// browsers. Nothing is mocked: real worlds, real POI quests in Brno and in a
// village, the real NPC cast, the travel guard and the live API.
//
// Two layers:
//   api  device-independent rules, through the public HTTP API: coin → chest
//        → Aura, a POI quest in Brno, a landmark clue in a village, NPC talk,
//        an errand there and back (honouring the travel guard), the daily
//        board, a place badge, the trader, wisp rolls, the 2 NEAR staker step
//        and the creator community.
//   ui   per device (phone-390 Chromium, Pixel 7 Chromium, iPhone 15 WebKit):
//        the screens a player sees for the same journeys, with screenshots.
// The first-session journey itself (name → coin → chest → Aura → secure)
// stays in scripts/e2e-first-session.mjs; run it with E2E_BASE_URL.
//
// Every explorer this script makes is named "test …" (bot test accounts).
// POI quests are open 08:00–20:00 Prague, actors 07:00–22:00: run it then.
//
// Usage:  node scripts/e2e-live-journeys.mjs [--device=phone-390|pixel|iphone|all]
//                                            [--only=api|ui]
// E2E_BASE_URL overrides the server. Screenshots and report.json land in
// output/qa/live-journeys/ (override with E2E_SHOTS).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium, devices, webkit } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const BASE = (process.env.E2E_BASE_URL || "https://questlayer.promptstudio3000.com").replace(/\/$/, "");
const SHOTS = resolve(process.env.E2E_SHOTS || join(ROOT, "output/qa/live-journeys"));
const BRNO = { lat: 49.19522, lng: 16.60796 };
const VILLAGE = { name: "Holašovice", lat: 48.96965, lng: 14.27406 };
const RUN = Date.now().toString(36).slice(-4);

const PHONE_390 = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const strip = ({ defaultBrowserType, ...profile }) => profile;
const DEVICES = {
  "phone-390": { engine: chromium, profile: PHONE_390 },
  pixel: { engine: chromium, profile: strip(devices["Pixel 7"]) },
  iphone: { engine: webkit, profile: strip(devices["iPhone 15"]) },
};

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const meters = (a, b) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
const nearest = (list, p) => [...list].sort((a, b) => meters(a, p) - meters(b, p));
const fix = (p, accuracy = 8) => ({ lat: p.lat, lng: p.lng, accuracy, timestamp: Date.now() });

// ---------------------------------------------------------------- API layer
async function explorer(name) {
  const r = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assert.equal(r.status, 201, `new explorer ${name}: ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { player } = await r.json();
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data: data || {} };
  };
  return { player, call };
}

/** An actor's position now, from the server's published segments. */
function actorAt(actor, now = Date.now()) {
  const s = actor.segments.find((x) => x.from <= now && now < x.to) || actor.segments.at(-1);
  const pts = s.path.map(([lng, lat]) => ({ lat, lng }));
  if (pts.length === 1 || s.dwell) return pts[0];
  const lens = pts.slice(1).map((p, i) => meters(pts[i], p));
  let want = ((now - s.from) / (s.to - s.from)) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i]) {
      const t = lens[i] ? want / lens[i] : 0;
      return { lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, lng: pts[i].lng + (pts[i + 1].lng - pts[i].lng) * t };
    }
    want -= lens[i];
  }
  return pts.at(-1);
}

/**
 * Retries a GPS-checked call while the travel guard asks the explorer to
 * wait ("Rewards here open in about N min"), like a player walking there.
 * `make` builds a fresh request each time (fresh fix timestamp).
 */
async function walkThenCall(make, { maxWaitMs = 8 * 60_000 } = {}) {
  const until = Date.now() + maxWaitMs;
  for (;;) {
    const r = await make();
    if (r.data?.code !== "IMPLAUSIBLE_MOVE" || Date.now() > until) return r;
    const min = Number(/about (\d+) min/.exec(r.data.error || "")?.[1] || 1);
    await sleep(Math.min(min * 60_000, 60_000));
  }
}

async function worldAt(e, spot, extra = {}) {
  const r = await e.call("POST", "/api/world", { location: spot, arena: false, ...extra });
  assert.equal(r.status, 200, `world at ${spot.lat},${spot.lng}: ${JSON.stringify(r.data)}`);
  return r.data;
}

async function actorsIn(e, world, spot) {
  const q = new URLSearchParams({ worldId: world.id, lat: String(spot.lat), lng: String(spot.lng) });
  const r = await e.call("GET", `/api/actors?${q}`);
  assert.equal(r.status, 200, `actors: ${JSON.stringify(r.data)}`);
  return r.data.actors || [];
}

async function meet(e, world, actorId, spot) {
  return walkThenCall(async () => {
    const actor = (await actorsIn(e, world, spot)).find((a) => a.id === actorId);
    assert.ok(actor, `${actorId} is on the map`);
    return e.call("POST", `/api/actors/${actorId}/encounter`, { worldId: world.id, location: fix(actorAt(actor)) });
  });
}

const API_JOURNEYS = {
  async "coin → chest → Aura"(note) {
    const probe = await explorer(`test ${RUN} scout`);
    const w = await worldAt(probe, BRNO);
    const chest = nearest(
      w.quests.filter((q) => q.kind === "chest" && q.placeStatus === "open" && q.tier <= (w.playerTier || 1)),
      BRNO,
    )[0];
    assert.ok(chest, "an open chest in Brno");
    const coin = nearest(w.coins, chest)[0];
    const e = await explorer(`test ${RUN} coin`);
    await worldAt(e, coin);
    const c = await e.call("POST", "/api/coins/claim", { coinId: coin.id, fix: fix(coin) });
    assert.equal(c.status, 200, `coin: ${JSON.stringify(c.data)}`);
    note(`coin +${c.data.value / 1e6} GOLD, ${c.data.xp} XP, ${Math.round(meters(coin, chest))} m to the chest`);
    const r = await walkThenCall(() => e.call("POST", "/api/quests/claim", { questId: chest.id, fix: fix(chest) }));
    assert.equal(r.status, 200, `chest: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.item?.name, "the chest gives an Aura");
    note(`chest "${chest.title}" → ${r.data.item.name} (${r.data.item.rarity})`);
    const eq = await e.call("POST", "/api/equip", { itemId: r.data.item.id, desiredEquipped: true });
    assert.equal(eq.status, 200, `equip: ${JSON.stringify(eq.data)}`);
    assert.equal(eq.data.player.inventory.find((i) => i.id === r.data.item.id)?.equipped, 1, "Aura worn");
    note("Aura worn");
  },

  async "POI quest in Brno"(note) {
    const e = await explorer(`test ${RUN} brno`);
    const w = await worldAt(e, BRNO);
    assert.equal(w.poiQuests?.status, "ready", "POI quests ready in Brno");
    const poiZones = new Set(w.zones.filter((z) => z.source === "poi").map((z) => z.id));
    const visits = w.quests.filter((q) => poiZones.has(q.zone_id) && q.kind === "visit" && q.placeStatus === "open");
    assert.ok(visits.length, "an open POI visit in Brno");
    const q = visits.find((x) => !x.clue) || visits[0];
    const e2 = await explorer(`test ${RUN} brno visit`);
    await worldAt(e2, q);
    const r = await e2.call("POST", "/api/quests/claim", { questId: q.id, fix: fix(q), answer: q.clue?.options?.[0]?.id });
    assert.equal(r.status, 200, `claim: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.xp > 0, "XP for the visit");
    note(`"${q.title}" +${r.data.xp} XP (${poiZones.size} POI zones in the cell)`);
  },

  async "landmark clue in a village"(note) {
    const scout = await explorer(`test ${RUN} village`);
    const w = await worldAt(scout, VILLAGE, { lang: "en" });
    assert.equal(w.poiQuests?.status, "ready", `POI quests in ${VILLAGE.name}`);
    const q = w.quests.find((x) => x.clue);
    assert.ok(q, `a landmark clue in ${VILLAGE.name}`);
    assert.ok(q.clue.options.length >= 3 && !("answer" in q.clue), "options, never the answer");
    const e = await explorer(`test ${RUN} clue`);
    const w2 = await worldAt(e, q, { lang: "en" });
    const mine = w2.quests.find((x) => x.id === q.id);
    const r = await e.call("POST", "/api/quests/claim", { questId: q.id, fix: fix(q), answer: mine.clue.options[0].id });
    assert.equal(r.status, 200, `clue claim: ${JSON.stringify(r.data)}`);
    assert.equal(typeof r.data.clue?.correct, "boolean");
    assert.equal(r.data.xp, r.data.clue.correct ? q.clue.xp.correct : q.clue.xp.miss);
    note(`"${q.title}": ${r.data.clue.correct ? "right" : "wrong"} answer, +${r.data.xp} XP`);
    const again = await e.call("POST", "/api/quests/claim", { questId: q.id, fix: fix(q), answer: mine.clue.options[1].id });
    assert.equal(again.status, 200, "a second claim replays");
    const cs = await worldAt(e, q, { lang: "cs" });
    const kept = cs.quests.find((x) => x.id === q.id)?.clue?.result;
    assert.equal(kept?.choice, mine.clue.options[0].id, "a second answer never re-scores");
    note(`Czech question: "${cs.quests.find((x) => x.id === q.id)?.clue?.question?.slice(0, 60)}…"`);
  },

  async "NPC talk, errand and daily board"(note) {
    const scout = await explorer(`test ${RUN} npc scout`);
    const w0 = await worldAt(scout, BRNO);
    const giver = (await actorsIn(scout, w0, BRNO)).find((a) => a.archetype === "quest_giver" && a.state === "active");
    assert.ok(giver, "a quest giver is out in Brno");
    const at = actorAt(giver);
    const e = await explorer(`test ${RUN} npc`);
    const w = await worldAt(e, at);
    let enc = await meet(e, w, giver.id, at);
    assert.equal(enc.status, 200, `encounter: ${JSON.stringify(enc.data)}`);
    const g = await e.call("POST", `/api/actors/${giver.id}/greet`, { encounter: enc.data.encounter });
    assert.equal(g.status, 200, `greet: ${JSON.stringify(g.data)}`);
    assert.ok(g.data.say, "the NPC says hello");
    const t = await e.call("POST", `/api/actors/${giver.id}/talk`, {
      encounter: enc.data.encounter,
      message: "Hi! What is there to do around here today?",
    });
    assert.equal(t.status, 200, `talk: ${JSON.stringify(t.data)}`);
    assert.ok(t.data.say?.length > 10, "a real answer");
    note(`${giver.name}: "${t.data.say.slice(0, 90)}…"`);
    const board = await e.call("GET", `/api/daily-board?worldId=${encodeURIComponent(w.id)}`);
    assert.equal(board.status, 200);
    const npcGoal = board.data.goals.find((x) => x.kind === "npc");
    assert.ok(npcGoal?.done, `daily board counts the NPC talk: ${JSON.stringify(board.data.goals)}`);
    note(`daily board ${board.data.done}/${board.data.total}: ${board.data.goals.map((x) => `${x.label} ${x.progress}/${x.target}`).join(", ")}`);

    const errand = g.data.menu.find((m) => m.terms?.errand);
    assert.ok(errand, "the quest giver offers an errand");
    const acc = await e.call("POST", `/api/actors/${giver.id}/offers/${errand.id}/accept`, { encounter: enc.data.encounter });
    assert.equal(acc.status, 200, `accept: ${JSON.stringify(acc.data)}`);
    const step = errand.terms.steps[0];
    const place = w.quests.find((q) => q.id === step.questId);
    const trip = Math.round(meters(at, place));
    note(`errand "${errand.label}" (${trip} m away), walking there…`);
    const started = Date.now();
    const v = await walkThenCall(() =>
      e.call("POST", "/api/quests/claim", { questId: place.id, fix: fix(place), answer: place.clue?.options?.[0]?.id }),
    );
    assert.equal(v.status, 200, `errand visit: ${JSON.stringify(v.data)}`);
    // The travel guard must make the trip take walking/cycling time (15 m/s).
    if (trip > 500) assert.ok(Date.now() - started > 10_000, "the travel guard made the explorer travel");
    note(`visited after ${Math.round((Date.now() - started) / 1000)} s, walking back…`);
    const back = Date.now();
    enc = await meet(e, w, giver.id, at);
    assert.equal(enc.status, 200, `return encounter: ${JSON.stringify(enc.data)}`);
    if (trip > 500) assert.ok(Date.now() - back > 10_000, "the way back takes time too (shared travel anchor)");
    const done = await e.call("POST", `/api/actors/${giver.id}/offers/${errand.id}/complete`, { encounter: enc.data.encounter });
    assert.equal(done.status, 200, `turn in: ${JSON.stringify(done.data)}`);
    assert.equal(done.data.state, "completed");
    note(`errand turned in after ${Math.round((Date.now() - back) / 1000)} s: +${done.data.xp} XP`);
  },

  async "place badge"(note) {
    const e = await explorer(`test ${RUN} badge`);
    const all = await e.call("GET", `/api/badges?lat=${BRNO.lat}&lng=${BRNO.lng}`);
    assert.equal(all.status, 200);
    assert.ok(all.data.enabled, "badges on");
    const city = all.data.places.badges.find((b) => b.kind === "city" && meters(b, BRNO) < 15_000);
    assert.ok(city, "Brno has a city badge");
    await worldAt(e, city);
    const r = await e.call("POST", "/api/badges/check", { fix: fix(city, 10) });
    assert.equal(r.status, 200, `check: ${JSON.stringify(r.data)}`);
    const after = await e.call("GET", `/api/badges?lat=${city.lat}&lng=${city.lng}`);
    assert.ok(after.data.places.badges.find((b) => b.id === city.id)?.earnedAt, `${city.name} badge earned`);
    note(`${city.name} badge earned (${after.data.places.earned}/${after.data.places.total}); minting ${after.data.minting ?? "?"}`);
  },

  async "trader"(note) {
    const e = await explorer(`test ${RUN} trader`);
    const t = await e.call("GET", "/api/npc/traders");
    assert.equal(t.status, 200);
    assert.ok(t.data.traders?.length, "a trader account");
    const trader = t.data.traders[0];
    note(`${trader.actorId}: ${trader.held.length} Auras in stock, ${trader.trades.settled} trades settled`);
    const w = (await e.call("POST", "/api/world", {})).data;
    const actor = (await actorsIn(e, w, w.center)).find((a) => a.id === trader.actorId);
    assert.ok(actor, "the trader walks the city demo");
    const enc = await e.call("POST", `/api/actors/${actor.id}/encounter`, { worldId: w.id, location: fix(actorAt(actor)) });
    assert.equal(enc.status, 200, `encounter: ${JSON.stringify(enc.data)}`);
    const g = await e.call("POST", `/api/actors/${actor.id}/greet`, { encounter: enc.data.encounter });
    assert.equal(g.status, 200, `greet: ${JSON.stringify(g.data)}`);
    const kinds = [...new Set([...(g.data.menu || []), ...(g.data.locked || [])].map((m) => m.kind || m.id?.split(":")[0]))];
    assert.ok((g.data.menu || []).length + (g.data.locked || []).length > 0, "the trader offers something");
    note(`trader menu: ${kinds.join(", ")}`);
  },

  async "wisp roll"(note) {
    const e = await explorer(`test ${RUN} roll`);
    const r = await e.call("GET", "/api/npc-rolls");
    assert.equal(r.status, 200);
    assert.ok(r.data.enabled, `rolls on: ${r.data.reason}`);
    const total = r.data.odds.reduce((s, o) => s + o.chance, 0);
    assert.ok(Math.abs(total - 1) < 1e-6, "odds add up to 100 %");
    assert.equal(r.data.tickets.available, 0, "a newcomer has no ticket");
    const start = await e.call("POST", "/api/npc-rolls", { accountId: "nobody.testnet" });
    assert.ok(start.status >= 400, "no roll without an earned ticket");
    note(`table ${r.data.tableId} on ${r.data.contractId}; without a ticket: ${start.status} "${start.data.error}"`);
  },

  async "2 NEAR staker step"(note) {
    const e = await explorer(`test ${RUN} staker`);
    const g = await e.call("GET", "/api/staker/gates");
    assert.equal(g.status, 200);
    assert.equal(g.data.minNear, "2", "the Staker step is 2 NEAR");
    assert.equal(g.data.access.staker, false);
    const gate = Object.values(g.data.gates)[0];
    const label = gate.missing.find((m) => m.kind === "stake")?.label || "";
    assert.match(label, /^Stake 2 NEAR \(~\d+ €\)$/);
    note(`gates: ${Object.keys(g.data.gates).length}, newcomer sees "${label}" at ${g.data.priceEur} €/NEAR`);
    const y = await e.call("GET", "/api/yield/markets");
    assert.equal(y.status, 200);
    note(`yield markets: ${y.data.markets.map((m) => `${m.label} ${m.supplyAprPercent} %`).join(", ")}`);
  },

  async "creator community"(note) {
    const e = await explorer(`test ${RUN} creator`);
    const s = await e.call("GET", "/api/creator-community/status");
    assert.equal(s.status, 200);
    assert.ok(s.data.enabled, "creator community on");
    const feed = await e.call("GET", "/api/creator-community/quests?limit=50");
    assert.equal(feed.status, 200, `feed: ${JSON.stringify(feed.data).slice(0, 200)}`);
    const n = await e.call("GET", "/api/native/creators");
    const quests = feed.data.quests || feed.data.items || [];
    note(`policy ${s.data.policy.version}, ${quests.length} creator quests in the feed, rewards ${s.data.rewards}, native creators ${n.status}`);
  },
};

async function runApi(report) {
  for (const [name, fn] of Object.entries(API_JOURNEYS)) {
    const notes = [];
    const t0 = Date.now();
    process.stdout.write(`\n[api] ${name}\n`);
    try {
      await fn((s) => {
        notes.push(s);
        console.log(`  ${s}`);
      });
      report.push({ layer: "api", journey: name, ok: true, notes, ms: Date.now() - t0 });
    } catch (error) {
      console.log(`  FAIL ${error.message}`);
      report.push({ layer: "api", journey: name, ok: false, error: error.message, notes, ms: Date.now() - t0 });
    }
  }
}

// ----------------------------------------------------------------- UI layer
async function newPlayer(browser, device, name, spot) {
  const context = await browser.newContext({
    ...DEVICES[device].profile,
    reducedMotion: "reduce",
    locale: "en-GB",
    ...(spot
      ? { geolocation: { latitude: spot.lat, longitude: spot.lng, accuracy: 8 }, permissions: ["geolocation"] }
      : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  // The home-screen offer may pop up during a long journey; dismiss it.
  await page.addLocatorHandler(page.locator(".pwa-install"), async (card) => {
    await card.getByRole("button", { name: /Got it|Not now/ }).click().catch(() => {});
  });
  await page.goto(BASE);
  await page.getByPlaceholder("Your explorer name").fill(name);
  await page.getByRole("button", { name: "Start exploring" }).click();
  await page.locator(".first-session, .main-panel").first().waitFor({ timeout: 20_000 });
  let world = null;
  if (spot) {
    const gps = page.waitForResponse(
      (r) => r.url().endsWith("/api/world") && r.request().method() === "POST" && r.request().postDataJSON()?.arena === false,
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "Use GPS, my location" }).click();
    world = await (await gps).json();
    await page.waitForFunction(() => /GPS ±\d+ m/.test(document.body.innerText), null, { timeout: 15_000 });
  }
  return { context, page, errors, world };
}

async function openProfileTab(page, tabName) {
  await page.getByRole("button", { name: /^(Profile|Profil)$/ }).first().click();
  await page.getByRole("tab", { name: tabName }).first().click();
}

/** Opens a zone from its map pin (pins sit under the bottom sheet, so no hit test). */
async function openZone(page, zoneName) {
  const pin = page.locator(`[aria-label^="${zoneName} ·"]`).first();
  await pin.waitFor({ state: "attached", timeout: 30_000 });
  await pin.dispatchEvent("click");
}

function uiJourneys(device) {
  const who = (s) => `test ${device.slice(0, 5)} ${s}`;
  return {
    async "first steps start at the beginning"({ browser, shot, note }) {
      const { page, context, errors } = await newPlayer(browser, device, who("first"));
      try {
        const count = await page.locator(".first-session-count").innerText();
        await shot(page, "first-steps");
        // The testnet starter kit (TEST_SEED) must not tick off chest/Aura.
        assert.match(count, /1 of 6/, `coach count "${count}"`);
        note(count);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    },

    async "POI quest in Brno with a landmark clue"({ browser, shot, note, scout }) {
      const target = scout.brnoClue;
      assert.ok(target, "a Brno clue quest to stand at");
      const { page, context, errors } = await newPlayer(browser, device, who("brno"), target);
      try {
        const coach = page.locator(".first-session");
        await coach.getByRole("button", { name: /Nearest quest/ }).first().waitFor({ timeout: 20_000 }).catch(() => {});
        await shot(page, "brno-map");
        const pin = page.locator(".zone-map-pin").filter({ hasText: "" });
        note(`${await pin.count()} quest pins on the Brno map`);
        // Open the clue's place from its map pin.
        await openZone(page, target.zoneName);
        await page.getByRole("heading", { level: 1, name: target.zoneName }).waitFor({ timeout: 10_000 });
        const card = page.locator(`[id="quest-${target.id}"]`);
        await card.waitFor({ timeout: 10_000 });
        await card.scrollIntoViewIfNeeded();
        await card.getByRole("radio").first().check();
        await shot(page, "brno-clue");
        await card.locator(".primary-button").first().click();
        await page
          .getByText(/Right\. The answer comes from Wikidata\.|Not quite\. The highlighted answer/)
          .first()
          .or(page.getByRole("dialog"))
          .first()
          .waitFor({ timeout: 15_000 });
        await page.waitForTimeout(800);
        await shot(page, "brno-clue-result");
        note(`answered "${target.title}"`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    },

    async "POI quest in a village"({ browser, shot, note, scout }) {
      const target = scout.village;
      assert.ok(target, "a village quest to stand at");
      const { page, context, errors, world } = await newPlayer(browser, device, who("vesnice"), target);
      try {
        assert.equal(world.poiQuests?.status, "ready");
        await page.waitForTimeout(1500);
        await shot(page, "village-map");
        await openZone(page, target.zoneName);
        await page.getByRole("heading", { level: 1, name: target.zoneName }).waitFor({ timeout: 10_000 });
        const card = page.locator(`[id="quest-${target.id}"]`);
        await card.waitFor({ timeout: 10_000 });
        await card.scrollIntoViewIfNeeded();
        if (await card.getByRole("radio").count()) await card.getByRole("radio").first().check();
        await card.locator(".primary-button").first().click();
        await page.getByRole("dialog").or(page.getByText(/COMPLETED/)).first().waitFor({ timeout: 15_000 });
        await page.waitForTimeout(800);
        await shot(page, "village-done");
        note(`${world.quests.length} quests in the ${VILLAGE.name} cell, finished "${target.title}"`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    },

    async "NPC talk, errand and daily board"({ browser, shot, note, scout }) {
      const giver = scout.giver;
      assert.ok(giver, "a quest giver to meet");
      const { page, context, errors } = await newPlayer(browser, device, who("npc"), actorAt(giver));
      try {
        const marker = page.locator(`[data-actor-id="${giver.id}"]`);
        await marker.waitFor({ state: "attached", timeout: 30_000 });
        await marker.dispatchEvent("click");
        const sheet = page.getByRole("dialog", { name: new RegExp(giver.name) });
        await sheet.waitFor({ timeout: 15_000 });
        const bubble = sheet.locator(".npc-bubble");
        await page.waitForFunction(
          (el) => el && el.textContent && !/…$/.test(el.textContent.trim()) && el.textContent.trim().length > 10,
          await bubble.elementHandle(),
          { timeout: 20_000 },
        );
        await shot(page, "npc-greet");
        const input = sheet.getByRole("textbox");
        await input.fill("Where should I go today?");
        const said = page.waitForResponse((r) => /\/talk$/.test(r.url()), { timeout: 30_000 });
        await input.press("Enter");
        assert.equal((await said).status(), 200, "talk answered");
        await page.waitForTimeout(800);
        await shot(page, "npc-talk");
        note(`${giver.name}: "${(await bubble.innerText()).slice(0, 80)}"`);
        const errand = sheet.locator(".npc-action").filter({ hasText: /^.*Errand/ }).first();
        await errand.click();
        await page.getByText(/Task accepted/).first().waitFor({ timeout: 10_000 });
        await shot(page, "npc-errand-accepted");
        note("errand accepted");
        await sheet.getByRole("button", { name: /Close/ }).first().click();
        // Daily board: the NPC goal is done.
        await page.getByRole("button", { name: /Today's board/ }).first().click();
        const board = page.locator(".daily-board, [aria-label*='board' i]").first();
        await page.getByText(/Talk to an NPC/).first().waitFor({ timeout: 10_000 });
        await shot(page, "daily-board");
        const text = await page.locator("body").innerText();
        assert.match(text, /Talk to an NPC/);
        note(`board: ${(await board.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 100)}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    },

    async "trader"({ browser, shot, note, scout }) {
      const trader = scout.trader;
      assert.ok(trader, "the trader is out in Plzeň");
      const { page, context, errors } = await newPlayer(browser, device, who("trader"), actorAt(trader));
      try {
        const marker = page.locator(`[data-actor-id="${trader.id}"]`);
        await marker.waitFor({ state: "attached", timeout: 30_000 });
        await marker.dispatchEvent("click");
        const sheet = page.getByRole("dialog", { name: new RegExp(trader.name) });
        await sheet.waitFor({ timeout: 15_000 });
        await page.locator(".npc-sheet .npc-action, .npc-sheet .npc-empty").first().waitFor({ timeout: 20_000 });
        await page.waitForTimeout(800);
        await shot(page, "trader");
        const actions = await page.locator(".npc-sheet .npc-action-label").allInnerTexts();
        assert.ok(actions.length, "the trader offers trades");
        note(`${trader.name}: ${actions.slice(0, 3).join(" · ")}`);
        const say = await page.locator(".npc-sheet .npc-bubble").innerText();
        assert.doesNotMatch(say, /trading opens soon/, "the greeting matches the open stall");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    },

    async "badges, staking and language"({ browser, shot, note }) {
      const { page, context, errors } = await newPlayer(browser, device, who("profile"));
      try {
        await page.getByRole("button", { name: "Hide first steps" }).click().catch(() => {});
        await openProfileTab(page, "Character");
        await page.getByText(/badge/i).first().waitFor({ timeout: 15_000 });
        await page.getByText(/badge/i).first().scrollIntoViewIfNeeded();
        await shot(page, "badges");
        note("badge book on the Character tab");
        await page.getByRole("tab", { name: /Stak/ }).first().click();
        await page.getByText(/2 NEAR/).first().waitFor({ timeout: 15_000 });
        await shot(page, "staker-step");
        note("staking tab names the 2 NEAR step");
        await page.getByRole("tab", { name: "Settings" }).first().click();
        // Picking a language reloads the app in it (src/i18n.ts setLang).
        await page.locator("select.language-select").selectOption("cs");
        await page.waitForURL(/[?&]lang=cs/, { timeout: 15_000 });
        await page.getByRole("button", { name: "Průzkum" }).first().waitFor({ timeout: 20_000 });
        await page.waitForTimeout(1000);
        await shot(page, "language-cs");
        note(`Czech UI: html lang=${await page.evaluate(() => document.documentElement.lang)}`);
        await openProfileTab(page, "Nastavení");
        await page.locator("select.language-select").selectOption("en");
        await page.waitForURL((u) => !/[?&]lang=/.test(u.search), { timeout: 15_000 });
        await page.getByRole("button", { name: "Explore" }).first().waitFor({ timeout: 20_000 });
        note("back to English");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    },
  };
}

/** One explorer reads the live map so every device stands at the same spots. */
async function scoutUi() {
  const e = await explorer(`test ${RUN} ui scout`);
  const brno = await worldAt(e, BRNO, { lang: "en" });
  const zoneName = (w, q) => w.zones.find((z) => z.id === q.zone_id)?.name;
  const brnoClueQ = brno.quests.find((q) => q.clue && q.placeStatus === "open");
  const village = await worldAt(e, VILLAGE, { lang: "en" });
  const villageQ =
    village.quests.find((q) => q.kind === "visit" && q.placeStatus === "open") ||
    village.quests.find((q) => q.kind === "chest" && q.placeStatus === "open");
  const giver = (await actorsIn(e, brno, BRNO)).find((a) => a.archetype === "quest_giver" && a.state === "active");
  const PLZEN = { lat: 49.74745, lng: 13.3774 };
  const plzen = await worldAt(e, PLZEN);
  const trader = (await actorsIn(e, plzen, PLZEN)).find((a) => a.archetype === "trader" && a.state === "active");
  return {
    trader,
    brnoClue: brnoClueQ && { ...brnoClueQ, zoneName: zoneName(brno, brnoClueQ) },
    village: villageQ && { ...villageQ, zoneName: zoneName(village, villageQ) },
    giver,
  };
}

async function runUi(report, deviceNames) {
  const scout = await scoutUi();
  for (const device of deviceNames) {
    const dir = join(SHOTS, device);
    mkdirSync(dir, { recursive: true });
    let n = 0;
    const shot = async (page, label) => {
      n += 1;
      await page.screenshot({ path: join(dir, `${String(n).padStart(2, "0")}-${label}.png`) });
    };
    const browser = await DEVICES[device].engine.launch();
    console.log(`\n== ${device} (${DEVICES[device].engine.name()} ${browser.version()}) ==`);
    try {
      for (const [name, fn] of Object.entries(uiJourneys(device)).filter(([n]) => !arg("journey") || n.includes(arg("journey")))) {
        const notes = [];
        const t0 = Date.now();
        console.log(`[${device}] ${name}`);
        try {
          await fn({ browser, shot, scout, note: (s) => (notes.push(s), console.log(`  ${s}`)) });
          report.push({ layer: "ui", device, journey: name, ok: true, notes, ms: Date.now() - t0 });
        } catch (error) {
          console.log(`  FAIL ${error.message.split("\n")[0]}`);
          report.push({ layer: "ui", device, journey: name, ok: false, error: error.message.split("\n")[0], notes, ms: Date.now() - t0 });
        }
      }
    } finally {
      await browser.close();
    }
  }
}

async function main() {
  const want = arg("device") || process.env.E2E_DEVICE || "all";
  const deviceNames = want === "all" ? Object.keys(DEVICES) : want.split(",");
  for (const d of deviceNames) assert.ok(DEVICES[d], `unknown device ${d}`);
  const only = arg("only");
  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log(`Live server ${BASE}: ${health.network}, build ${health.source?.buildId?.slice(0, 7)}, run ${RUN}`);
  const report = [];
  if (only !== "ui") await runApi(report);
  if (only !== "api") await runUi(report, deviceNames);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(
    join(SHOTS, "report.json"),
    JSON.stringify({ base: BASE, build: health.source?.buildId, run: RUN, at: new Date().toISOString(), report }, null, 2) + "\n",
  );
  const failed = report.filter((r) => !r.ok);
  console.log(`\n${report.length - failed.length}/${report.length} journeys passed.`);
  for (const f of failed) console.log(`  FAIL [${f.layer}${f.device ? ` ${f.device}` : ""}] ${f.journey}: ${f.error}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer as newPlayer } from "../server/database.mjs";
import { GOLD, distance } from "../server/domain.mjs";
import { localDateStart } from "../server/spatial/calendar.mjs";
import { createActorService } from "../server/actors/service.mjs";
import { createHuntRewards } from "../server/actors/hunt/rewards.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";
import { ACTORS_SCHEMA } from "../server/actors/schema.mjs";
import { createGoldSpend, lureHoursOpen, PREMIUM_EMOTES, GEAR } from "../server/gold-spend/service.mjs";
import { createPlaces, placeText, PLACES } from "../server/gold-spend/places.mjs";
import { placeRecord } from "../server/gold-spend/social.mjs";
import { burnTotals, priceU, altarFee } from "../server/gold-spend/ledger.mjs";

// New explorers start with 0 GOLD (no practice faucet). These tests exercise
// the local practice paths, so each explorer gets a practice wallet here.
const PRACTICE_WALLET_U = 120_000 * 1_000_000;
function createPlayer(db, name, now) {
  const p = newPlayer(db, name, now);
  db.prepare("UPDATE players SET gold_u=? WHERE id=?").run(PRACTICE_WALLET_U, p);
  return p;
}

const DAY = "2026-11-02",
  dayStart = localDateStart(DAY, "Europe/Prague"),
  noon = dayStart + 12 * 3600_000;
const SQUARE = { lat: 49.74745, lng: 13.3774 };
const gold = (db, p) => db.prepare("SELECT gold_u FROM players WHERE id=?").get(p).gold_u;

function gpsWorld(db, { arena = false, id = `gps:test:${DAY}` } = {}) {
  const manifest = {
    id,
    day: DAY,
    cityId: "plzen",
    timezone: "Europe/Prague",
    arena,
    endsAt: dayStart + 86_400_000,
    zones: [{ id: `${id}:zone:0`, slot: 0, name: "Republic Square", lat: SQUARE.lat, lng: SQUARE.lng, tier: 1 }],
  };
  db.prepare("INSERT INTO worlds VALUES(?,?,?,?,?,?)").run(id, DAY, "city-plzen", "Europe/Prague", JSON.stringify(manifest), 0);
  return manifest;
}
const fixAt = (p, t) => ({ ...p, accuracy: 8, timestamp: t });

test("premium emotes and frames burn GOLD once; basic emotes are free", () => {
  const db = openDatabase(":memory:");
  const g = createGoldSpend(db, { now: () => noon });
  const p = createPlayer(db, "Spender");
  const before = gold(db, p);
  assert.ok(g.emote(p, { emote: "wave" }).until > noon);
  assert.throws(() => g.emote(p, { emote: "dragon" }), /Unlock this emote/);
  const dragon = PREMIUM_EMOTES.find((e) => e.id === "dragon");
  const r = g.buy(p, { sku: "emote:dragon" });
  assert.equal(r.burn.amountU, priceU(dragon.price));
  assert.equal(gold(db, p), before - priceU(dragon.price));
  assert.match(r.burn.memo, /^questlayer:burn:emote:dragon$/);
  assert.throws(() => g.buy(p, { sku: "emote:dragon" }), /already have/);
  g.emote(p, { emote: "dragon" });
  assert.deepEqual(g.lookOf(p, noon + 1000), { emote: "dragon", emoteUntil: noon + 30_000 });
  assert.equal(g.lookOf(p, noon + 31_000), null, "the emote fades");
  g.buy(p, { sku: "cosmetic:frame-gold" });
  assert.equal(g.lookOf(p, noon + 31_000).frame, "frame-gold");
  assert.throws(() => g.equip(p, { frame: "frame-void" }), /Unlock this frame/);
  g.equip(p, { frame: null });
  assert.equal(g.lookOf(p, noon + 31_000), null);
  const shop = g.shop(p);
  assert.ok(shop.emotes.find((e) => e.id === "dragon").owned);
  assert.ok(shop.emotes.filter((e) => e.free).length >= 6);
  // Nothing is credited anywhere: the whole price leaves circulation.
  const totals = burnTotals(db);
  assert.equal(totals.totalU, before - gold(db, p));
  assert.equal(db.prepare("SELECT SUM(gold_u) AS u FROM players WHERE id!=?").get(p).u ?? 0, 0);
});

test("a short balance burns nothing", () => {
  const db = openDatabase(":memory:");
  const g = createGoldSpend(db, { now: () => noon });
  const p = createPlayer(db, "Broke");
  db.prepare("UPDATE players SET gold_u=? WHERE id=?").run(1000, p);
  assert.throws(() => g.buy(p, { sku: "cosmetic:frame-gold" }), /Not enough GOLD/);
  assert.equal(gold(db, p), 1000);
  assert.equal(burnTotals(db).totalU, 0);
});

test("trader gear sells chest editions only", () => {
  assert.ok(GEAR.length >= 3);
  for (const g of GEAR) assert.ok(g.price > 0 && ["rare", "epic"].includes(g.rarity), g.id);
});

test("the altar shows its GOLD fee and blocks an offering without it", () => {
  const db = openDatabase(":memory:");
  ensureModuleVersion(db, ACTORS_SCHEMA);
  const rewards = createHuntRewards(db, { altarFees: true });
  const p = createPlayer(db, "Crafter");
  const s = rewards.summary(p, DAY);
  for (const r of s.altar.recipes) assert.equal(r.gold, altarFee(r.id));
  db.prepare("UPDATE players SET gold_u=0 WHERE id=?").run(p);
  assert.ok(rewards.summary(p, DAY).altar.recipes.every((r) => r.needs.includes("gold")));
  const off = createHuntRewards(db);
  assert.ok(off.summary(p, DAY).altar.recipes.every((r) => !r.needs.includes("gold") && r.gold === 0));
});

test("lures move a monster of the day to a safe place for 30 minutes", async () => {
  const db = openDatabase(":memory:");
  let t = noon;
  const actors = createActorService(db, { clock: () => t });
  const g = createGoldSpend(db, { actors, now: () => t });
  const w = gpsWorld(db);
  const p = createPlayer(db, "Lurer"),
    q = createPlayer(db, "Neighbour");
  const quote = g.lureQuote(p, { worldId: w.id, fix: fixAt(SQUARE, t) });
  assert.equal(quote.place.id, `zone:${w.zones[0].id}`);
  const monster = quote.options.find((o) => o.kind === "monster");
  assert.ok(monster.actorId, "a monster is out at noon");
  assert.ok(quote.options.some((o) => o.kind === "beacon" && o.price > 0));
  const before = gold(db, p);
  const set = g.setLure(p, { worldId: w.id, fix: fixAt(SQUARE, t), kind: "monster", actorId: monster.actorId });
  assert.equal(set.lure.endsAt, t + 30 * 60_000);
  assert.equal(gold(db, p), before - priceU(monster.price));
  t += 60_000;
  const list = await actors.list({ player: q, worldId: w.id, location: SQUARE });
  const lured = list.actors.find((a) => a.id === monster.actorId);
  assert.ok(lured, "the lured monster is listed");
  assert.equal(lured.luredUntil, set.lure.endsAt);
  const cast = actors.castNow(w.id).actors.find((a) => a.id === monster.actorId);
  assert.ok(distance(cast.pos, SQUARE) < 1);
  // One per player; another player can't stack a lure next to it.
  assert.throws(() => g.setLure(p, { worldId: w.id, fix: fixAt(SQUARE, t), kind: "beacon" }), /already have an active lure/);
  assert.throws(() => g.setLure(q, { worldId: w.id, fix: fixAt(SQUARE, t), kind: "beacon" }), /within 200 m/);
  assert.equal(g.luresNear(q, SQUARE, t).length, 1);
  // After 30 minutes the monster walks its own day again.
  t = set.lure.endsAt + 1;
  const back = actors.castNow(w.id).actors.find((a) => a.id === monster.actorId);
  assert.ok(!back.pos || distance(back.pos, SQUARE) > 1);
  assert.equal(g.luresNear(q, SQUARE, t).length, 0);
});

test("lures need GPS, a public place and game hours", () => {
  const db = openDatabase(":memory:");
  let t = noon;
  const actors = createActorService(db, { clock: () => t });
  const g = createGoldSpend(db, { actors, now: () => t });
  const w = gpsWorld(db),
    demo = gpsWorld(db, { arena: true, id: `demo:test:${DAY}` });
  const p = createPlayer(db, "Strict");
  assert.throws(() => g.lureQuote(p, { worldId: demo.id, fix: fixAt(SQUARE, t) }), /physically stand/);
  assert.throws(() => g.lureQuote(p, { worldId: w.id }), /GPS/);
  assert.throws(() => g.lureQuote(p, { worldId: w.id, fix: { ...fixAt(SQUARE, t), accuracy: 80 } }), /precise/);
  const field = { lat: SQUARE.lat + 0.01, lng: SQUARE.lng };
  assert.throws(() => g.lureQuote(p, { worldId: w.id, fix: fixAt(field, t) }), /public place/);
  t = dayStart + 22 * 3600_000 + 60_000;
  assert.throws(() => g.lureQuote(p, { worldId: w.id, fix: fixAt(SQUARE, t) }), /between 07:00 and 22:00/);
  assert.equal(lureHoursOpen(dayStart + 7 * 3600_000, "Europe/Prague"), true);
  assert.equal(lureHoursOpen(dayStart + 6 * 3600_000 + 59 * 60_000, "Europe/Prague"), false);
});

test("place text keeps links, contacts and private addresses out", () => {
  assert.equal(placeText("  Great view 🌇  ", 140), "Great view 🌇");
  assert.throws(() => placeText("see https://x.example", 140), /Links/);
  assert.throws(() => placeText("call +420 777 123 456", 140), /Links/);
  assert.throws(() => placeText("party at Husova 1234/12", 140), /private addresses/);
  assert.throws(() => placeText("x".repeat(141), 140), /1–140/);
});

test("shouts are paid per day up to 7; topics turn free with six authors", () => {
  const db = openDatabase(":memory:");
  let t = noon;
  const levels = new Map();
  const places = createPlaces(db, { now: () => t, levelOf: (p) => levels.get(p) ?? 1 });
  const a = createPlayer(db, "Author");
  const before = gold(db, a);
  const shout = places.create(a, { kind: "shout", text: "Sunset here is 🔥", days: 3, ...SQUARE, arena: true, publicConsent: true });
  assert.equal(gold(db, a), before - priceU(PLACES.shoutPerDay * 3));
  assert.equal(shout.thread.state, "live");
  assert.throws(() => places.extend(a, shout.thread.id, { days: 5 }), /at most 7 days/);
  places.extend(a, shout.thread.id, { days: 4 });
  assert.throws(() => places.post(a, shout.thread.id, { text: "hi" }), /level 2|no replies/);
  const topic = places.create(a, { kind: "topic", title: "Best bench?", text: "Where do you sit?", days: 1, ...SQUARE, arena: true, publicConsent: true }).thread;
  const others = Array.from({ length: 6 }, (_, i) => createPlayer(db, `P${i}`));
  assert.throws(() => places.post(others[0], topic.id, { text: "Here" }), /level 2/);
  for (const o of others) levels.set(o, 3);
  levels.set(a, 3);
  assert.throws(() => places.post(a, shout.thread.id, { text: "hi" }), /no replies/);
  let r;
  for (const o of others.slice(0, 4)) r = places.post(o, topic.id, { text: `I sit by the fountain 👋` });
  assert.equal(r.thread.authors, 5);
  assert.equal(r.thread.freeForever, false);
  r = places.post(others[4], topic.id, { text: "Same" });
  assert.equal(r.thread.authors, 6);
  assert.equal(r.becameFree, true);
  // Free topics outlive their paid days and archive only after 90 quiet days.
  t += 10 * 86_400_000;
  const feed = places.feed(others[5], { ...SQUARE, radiusKm: 1, sort: "latest" });
  assert.deepEqual(feed.items.map((x) => x.id), [topic.id], "the lapsed shout left the map");
  places.open(others[5], topic.id);
  t += 89 * 86_400_000;
  assert.equal(places.feed(a, { ...SQUARE, radiusKm: 1 }).items.length, 1, "a read 89 days ago keeps it");
  t += 2 * 86_400_000;
  assert.equal(places.feed(a, { ...SQUARE, radiusKm: 1 }).items.length, 0);
  assert.equal(db.prepare("SELECT state FROM place_threads WHERE id=?").get(topic.id).state, "archived");
});

test("feed sorts, follows, blocks and reports", () => {
  const db = openDatabase(":memory:");
  let t = noon;
  const places = createPlaces(db, { now: () => t, levelOf: () => 5 });
  const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map((n) => createPlayer(db, n));
  const make = (p, text, dLat = 0) => {
    t += 1000;
    return places.create(p, { kind: "topic", title: text, text, days: 2, lat: SQUARE.lat + dLat, lng: SQUARE.lng, arena: true, publicConsent: true }).thread.id;
  };
  const busy = make(a, "Busy"),
    quiet = make(b, "Quiet"),
    far = make(c, "Far", 0.05);
  places.post(b, busy, { text: "one" });
  places.post(c, busy, { text: "two" });
  assert.deepEqual(places.feed(d, { ...SQUARE, radiusKm: 1 }).items.map((x) => x.id), [busy, quiet], "latest activity first, far one out of range");
  assert.equal(places.feed(d, { ...SQUARE, radiusKm: 10, sort: "popular" }).items[0].id, busy);
  assert.equal(places.feed(d, { ...SQUARE, radiusKm: 10, sort: "following" }).items.length, 0);
  places.follow(d, b);
  assert.deepEqual(places.feed(d, { ...SQUARE, radiusKm: 10, sort: "following" }).items.map((x) => x.id), [quiet]);
  assert.ok(places.feed(d, { ...SQUARE, radiusKm: 10, sort: "recommended" }).items.length === 3);
  for (const p of [c, d, e]) places.report(p, quiet, { reason: "spam" });
  assert.ok(!places.feed(d, { ...SQUARE, radiusKm: 10 }).items.some((x) => x.id === quiet), "three reports hide it");
  assert.equal(places.remove(a, busy).refund, 0);
  assert.throws(() => places.remove(b, far), /Only the author/);
});

test("SocialDB records carry a geohash cell and the burn memo, never exact GPS", () => {
  const r = placeRecord({ id: "place_x", kind: "shout", title: "", text: "hi", lat: 49.74745, lng: 13.3774, place: "", created_at: 1 }, { mutationId: "record_1" });
  assert.equal(r.cell.length, 7);
  assert.equal(r.paid, "questlayer:burn:shout:place_x");
  assert.ok(!JSON.stringify(r).includes("49.74745"));
});

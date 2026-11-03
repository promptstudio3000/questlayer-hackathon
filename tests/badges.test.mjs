import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { loadPlaceBadges, placesAt, nearestPlaces, PLACE_KINDS } from "../server/badges/place-catalog.mjs";
import { createBadgeService, userBadgeSettings, placeFix } from "../server/badges/service.mjs";
import { claimMessage, createArgs, runBadgeQueue } from "../server/badges/chain.mjs";
import { createBadgeRoutes } from "../server/badges/routes.mjs";

const T0 = Date.parse("2026-11-02T10:00:00Z");
const SNEZKA = { lat: 50.73596, lng: 15.73993 };
const PLZEN_CATHEDRAL = { lat: 49.74763, lng: 13.37757 };

function setup({ linked = true, env = {} } = {}) {
  const db = openDatabase(":memory:");
  let t = T0;
  const clock = () => t;
  const alice = createPlayer(db, "Alice", T0);
  const bob = createPlayer(db, "Bob", T0);
  const accounts = new Map(linked ? [[alice, "alice.testnet"], [bob, "bob.testnet"]] : []);
  const badges = createBadgeService(db, {
    catalog: loadPlaceBadges(),
    linkedAccount: (p) => accounts.get(p) ?? null,
    settings: userBadgeSettings(env, "testnet"),
    now: clock,
  });
  return { db, badges, alice, bob, accounts, advance: (ms) => (t += ms), now: clock };
}
const fix = (p, now, accuracy = 10) => ({ ...p, accuracy, timestamp: now });

test("the curated catalog is valid: unique ids, every kind, sane radii", () => {
  const c = loadPlaceBadges();
  assert.ok(c.badges.length >= 60);
  assert.equal(new Set(c.badges.map((b) => b.id)).size, c.badges.length);
  for (const k of PLACE_KINDS) assert.ok(c.badges.some((b) => b.kind === k), k);
  assert.ok(c.byId.get("peak-snezka"));
  assert.ok(c.byId.get("city-plzen").radiusM >= 3000);
  // Plzeň (the live demo city) has places a demo player can actually reach.
  assert.ok(placesAt(c, PLZEN_CATHEDRAL).some((x) => x.badge.id === "landmark-plzen-cathedral"));
  assert.ok(placesAt(c, PLZEN_CATHEDRAL).some((x) => x.badge.id === "city-plzen"));
  const near = nearestPlaces(c, PLZEN_CATHEDRAL, { limit: 3, skip: new Set(["city-plzen"]) });
  assert.equal(near.length, 3);
  assert.equal(near[0].badge.region, "Plzeň");
});

test("reaching a peak earns its badge once, with no item, gold or XP", () => {
  const { db, badges, alice, now } = setup();
  const before = db.prepare("SELECT gold_u,xp FROM players WHERE id=?").get(alice);
  const items = db.prepare("SELECT count(*) AS n FROM inventory WHERE player_id=?").get(alice).n;
  const r = badges.check(alice, fix(SNEZKA, now()));
  assert.deepEqual(r.earned.map((b) => b.id), ["peak-snezka"]);
  assert.equal(badges.check(alice, fix(SNEZKA, now())).earned.length, 0, "only once");
  assert.deepEqual(db.prepare("SELECT gold_u,xp FROM players WHERE id=?").get(alice), before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM inventory WHERE player_id=?").get(alice).n, items, "never an inventory item, so never sellable");
  const view = badges.overview(alice, SNEZKA).places;
  assert.equal(view.earned, 1);
  assert.equal(view.byKind.peak.earned, 1);
  assert.equal(view.badges[0].id, "peak-snezka");
  assert.ok(view.badges[0].earnedAt);
  assert.ok(!view.next.some((n) => n.id === "peak-snezka"));
});

test("a city badge and a landmark badge can come from one fix", () => {
  const { badges, alice, now } = setup();
  const ids = badges.check(alice, fix(PLZEN_CATHEDRAL, now())).earned.map((b) => b.id).sort();
  assert.deepEqual(ids, ["city-plzen", "landmark-plzen-cathedral"]);
});

test("stale, imprecise and teleporting fixes do not earn badges", () => {
  const { badges, alice, advance, now } = setup();
  assert.throws(() => badges.check(alice, fix(SNEZKA, now() - 60_000)), /out of date/);
  assert.throws(() => badges.check(alice, fix(SNEZKA, now(), 900)), /not precise/);
  // 200 m off the summit with a 120 m radius: nothing.
  assert.equal(badges.check(alice, fix({ lat: SNEZKA.lat + 0.0018, lng: SNEZKA.lng }, now())).earned.length, 0);
  // Prague to Sněžka (~130 km) ten seconds later is not a real trip.
  advance(60_000);
  badges.check(alice, fix({ lat: 50.0875, lng: 14.42139 }, now()));
  advance(10_000);
  const r = badges.check(alice, fix(SNEZKA, now()));
  assert.equal(r.suspicious, true);
  assert.equal(r.earned.length, 0);
});

test("a city badge accepts a coarser fix than a summit", () => {
  const { badges, alice, now } = setup();
  const r = badges.check(alice, fix({ lat: 49.7384, lng: 13.3736 }, now(), 120));
  assert.deepEqual(r.earned.map((b) => b.id), ["city-plzen"]);
  assert.throws(() => placeFix(fix(SNEZKA, now(), 120), now(), 120), /not precise/);
});

test("player badges need a linked NEAR account", () => {
  const { badges, alice, now } = setup({ linked: false });
  assert.throws(() => badges.createUserBadge(alice, { title: "Summit club", kind: "place", fix: fix(SNEZKA, now()) }), /Link a NEAR account/);
});

test("a place badge is created where the creator stands and claimed on the spot", () => {
  const { db, badges, alice, bob, now } = setup();
  const b = badges.createUserBadge(alice, {
    title: "Sněžka sunrise club",
    description: "Up before the sun.",
    icon: "⛰️",
    color: "#2b7bc0",
    kind: "place",
    radiusM: 150,
    maxSupply: 2,
    fix: fix(SNEZKA, now()),
  });
  assert.match(b.id, /^snezka-sunrise-club-[0-9a-f]{6}$/);
  assert.equal(b.state, "queued");
  assert.equal(b.mine, true);
  assert.deepEqual(b.place, { lat: SNEZKA.lat, lng: SNEZKA.lng, radiusM: 150 });
  // Bob far away cannot claim; at the summit he can, once.
  assert.throws(() => badges.claimUserBadge(bob, { badgeId: b.id, fix: fix(PLZEN_CATHEDRAL, now()) }), /Get closer/);
  const c = badges.claimUserBadge(bob, { badgeId: b.id, fix: fix(SNEZKA, now()) });
  assert.equal(c.already, false);
  assert.equal(badges.claimUserBadge(bob, { badgeId: b.id, fix: fix(SNEZKA, now()) }).already, true);
  assert.equal(db.prepare("SELECT account_id FROM user_badge_claims WHERE badge_id=?").get(b.id).account_id, "bob.testnet");
  const near = badges.overview(bob, SNEZKA).user.nearby;
  assert.equal(near[0].id, b.id);
  assert.equal(near[0].holding.state, "queued");
  assert.equal(near[0].code, undefined);
});

test("event badges need the creator's code; supply and limits hold", () => {
  const { badges, alice, bob, accounts, db, now } = setup({ env: { USER_BADGES_MAX_PER_DAY: "2" } });
  const b = badges.createUserBadge(alice, { title: "Hackathon demo night", kind: "event", code: "Gotchi42", maxSupply: 1 });
  assert.equal(b.code, "Gotchi42");
  assert.equal(b.needsCode, true);
  assert.equal(badges.userBadge(bob, b.id).code, undefined, "only the creator sees the code");
  assert.throws(() => badges.claimUserBadge(bob, { badgeId: b.id, code: "nope" }), /does not match/);
  badges.claimUserBadge(bob, { badgeId: b.id, code: " gotchi42 " });
  const carol = createPlayer(db, "Carol", T0);
  accounts.set(carol, "carol.testnet");
  assert.throws(() => badges.claimUserBadge(carol, { badgeId: b.id, code: "gotchi42" }), /given out/);
  badges.createUserBadge(alice, { title: "Second one", kind: "event" });
  assert.throws(() => badges.createUserBadge(alice, { title: "Third one", kind: "event" }), /a day/);
});

test("quest badges only for the creator's own community quest, claimed after completion", () => {
  const { db, badges, alice, bob } = setup();
  db.exec("CREATE TABLE creator_quests(id TEXT PRIMARY KEY,author TEXT NOT NULL)");
  db.exec("CREATE TABLE creator_completion_receipts(quest_id TEXT,participant TEXT)");
  db.prepare("INSERT INTO creator_quests VALUES('cq_1',?)").run(alice);
  db.prepare("INSERT INTO creator_quests VALUES('cq_2',?)").run(bob);
  assert.throws(() => badges.createUserBadge(alice, { title: "Not mine", kind: "quest", questRef: "creator:cq_2" }), /your own/);
  const b = badges.createUserBadge(alice, { title: "Mural trail finisher", kind: "quest", questRef: "creator:cq_1" });
  assert.throws(() => badges.claimUserBadge(bob, { badgeId: b.id }), /Finish the quest/);
  db.prepare("INSERT INTO creator_completion_receipts VALUES('cq_1',?)").run(bob);
  assert.equal(badges.claimUserBadge(bob, { badgeId: b.id }).already, false);
});

test("claim message matches the contract text byte for byte", () => {
  assert.equal(
    claimMessage("badges.questlayer.testnet", "tower-climb", "ana.testnet", 99),
    "QuestLayer badge claim v1\nContract: badges.questlayer.testnet\nNetwork: testnet\nBadge: tower-climb\nAccount: ana.testnet\nExpires: 99",
  );
  const args = createArgs({
    id: "x-1",
    creator_account: "a.testnet",
    title: "T",
    description: "",
    icon: "🏅",
    color: "#c08a2b",
    kind: "place",
    lat: 50.73596,
    lng: 15.73993,
    radius_m: 120,
    max_supply: 5,
    starts_at: null,
    ends_at: null,
  });
  assert.deepEqual(args.input.kind, { Place: { lat_e6: 50735960, lng_e6: 15739930, radius_m: 120 } });
  assert.equal(args.creator_id, "a.testnet");
});

test("the queue creates designs before minting and survives lost responses", async () => {
  const { badges, alice, bob, now, db } = setup();
  const b = badges.createUserBadge(alice, { title: "Summit club", kind: "place", fix: fix(SNEZKA, now()) });
  badges.claimUserBadge(bob, { badgeId: b.id, fix: fix(SNEZKA, now()) });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const calls = [];
  let lose = true;
  const chain = {
    ready: true,
    contractId: "badges.questlayer.testnet",
    async createBadge(row) {
      calls.push(["create", row.id]);
      if (lose) {
        lose = false;
        throw new Error("Badge id already taken");
      }
      return "tx1";
    },
    async view(method, args) {
      if (method === "get_badge") return { creator_id: "alice.testnet" };
      if (method === "has_badge") return 1;
      throw new Error(method + JSON.stringify(args));
    },
    async claim(badgeId, accountId) {
      const msg = claimMessage(this.contractId, badgeId, accountId, 1);
      const sig = edSign(null, Buffer.from(msg), privateKey);
      assert.ok(edVerify(null, Buffer.from(msg), publicKey, sig));
      calls.push(["claim", badgeId, accountId]);
      return "tx2";
    },
  };
  const r = await runBadgeQueue(badges, chain);
  assert.deepEqual(r, { created: 1, minted: 1, failed: 0 });
  assert.deepEqual(calls.map((c) => c[0]), ["create", "claim"]);
  const row = db.prepare("SELECT state,token_id FROM user_badge_claims WHERE badge_id=?").get(b.id);
  assert.deepEqual({ ...row }, { state: "minted", token_id: `${b.id}:1` });
  assert.equal(badges.overview(bob).user.held[0].holding.state, "minted");
  assert.equal(badges.overview(alice).user.created[0].onChain, true);
  assert.deepEqual(await runBadgeQueue(badges, { ...chain, ready: false }), { created: 0, minted: 0, failed: 0 });
});

test("routes: overview, check and auth", async () => {
  const { badges, alice, now } = setup();
  const routes = createBadgeRoutes(badges);
  const out = [];
  const respond = (_res, v) => out.push(v);
  const assertFn = (c, m, s = 400) => {
    if (!c) throw Object.assign(new Error(m), { status: s });
  };
  const call = (method, path, player, input) =>
    routes.handle({ method }, {}, new URL("http://x" + path), { player, body: async () => input, respond, assert: assertFn });
  assert.equal(await call("GET", "/api/other", alice), false);
  await assert.rejects(() => call("GET", "/api/badges", null), /Sign in/);
  await call("POST", "/api/badges/check", alice, { fix: fix(SNEZKA, now()) });
  assert.equal(out.at(-1).earned[0].id, "peak-snezka");
  await call("GET", `/api/badges?lat=${SNEZKA.lat}&lng=${SNEZKA.lng}`, alice);
  assert.equal(out.at(-1).enabled, true);
  assert.equal(out.at(-1).places.earned, 1);
  assert.equal(out.at(-1).user.enabled, true);
  await createBadgeRoutes(null).handle({ method: "GET" }, {}, new URL("http://x/api/badges"), { player: alice, body: async () => ({}), respond, assert: assertFn });
  assert.deepEqual(out.at(-1), { enabled: false });
});

test("POI pipeline records become extra place badges, curated places win", async () => {
  const { poiBadges } = await import("../scripts/build-place-badges.mjs");
  const { readFileSync, writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const records = JSON.parse(readFileSync(new URL("./fixtures/poi/badge-pois.json", import.meta.url), "utf8"));
  const out = poiBadges(records);
  assert.deepEqual(out.map((b) => b.id), ["view-rozhledna-krkavec", "landmark-hrad-radyne"]);
  assert.equal(out[1].rarity, "rare");
  const dir = mkdtempSync(join(tmpdir(), "badges-"));
  const extraPath = join(dir, "extra.json");
  writeFileSync(extraPath, JSON.stringify({ version: "poi-test", badges: out }));
  const c = loadPlaceBadges({ extraPath });
  assert.equal(c.version, "place-badges-v1+poi-test");
  assert.equal(c.byId.get("landmark-hrad-radyne").source, "poi");
  assert.equal(c.byId.get("peak-snezka").source, "curated");
});

test("health status reports the catalog, chain readiness and the queue", () => {
  const { badges, alice, now } = setup();
  badges.check(alice, fix(SNEZKA, now()));
  badges.createUserBadge(alice, { title: "Queue me", kind: "event" });
  const s = badges.status();
  assert.equal(s.status, "on");
  assert.equal(s.places, 69);
  assert.equal(s.placeAwards, 1);
  assert.equal(s.minting, false);
  assert.deepEqual(s.queue, { designs: 1, claims: 0, failed: 0 });
});

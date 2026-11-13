import { DEMO_AURA_NAMES } from "../server/aura-catalog.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { openDatabase, createPlayer as newPlayer } from "../server/database.mjs";
import { HOME, ensureWorld, worldView } from "../server/world.mjs";
import {
  claimQuest,
  advanceRoute,
  equip,
  listItem,
  buyItem,
  cancelListing,
  stake,
} from "../server/game.mjs";
import { createAdventureResults } from "../server/adventure-results.mjs";
import { GOLD } from "../server/domain.mjs";

// New explorers start with 0 GOLD (no practice faucet). These tests exercise
// the local practice paths, so each explorer gets a practice wallet here.
const PRACTICE_WALLET_U = 120_000 * 1_000_000;
function createPlayer(db, name, now) {
  const p = newPlayer(db, name, now);
  db.prepare("UPDATE players SET gold_u=? WHERE id=?").run(PRACTICE_WALLET_U, p);
  return p;
}

const now = Date.parse("2026-11-02T12:00:00Z");
async function fixture(t, { path = ":memory:", arena = true } = {}) {
  const db = openDatabase(path);
  t.after(() => db.close());
  const a = createPlayer(db, "Receipt explorer", now),
    b = createPlayer(db, "Other explorer", now),
    service = createAdventureResults(db);
  const world = await ensureWorld(db, HOME, arena, now),
    quests = worldView(db, world.id, a).quests;
  return {
    db,
    a,
    b,
    service,
    world,
    quests,
    chest: quests.find((q) => q.kind === "chest" && q.tier === 1),
    visit: quests.find((q) => q.kind === "visit" && q.tier === 1),
    route: quests.find((q) => q.kind === "route" && q.tier === 1),
  };
}
function economy(db) {
  return Object.fromEntries(
    [
      "players",
      "treasury",
      "inventory",
      "editions",
      "quests",
      "quest_claims",
      "quest_progress",
      "history",
      "adventure_results",
    ].map((name) => [
      name,
      db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ]),
  );
}
test("a lost claim response recovers exact durable XP/GOLD/item without another award or read-side acknowledgement", async (t) => {
  const { db, a, service, chest } = await fixture(t),
    first = claimQuest(db, a, chest.id, chest, now);
  assert.equal(first.replayed, false);
  assert.equal(first.result.domain, "demo");
  assert.equal(first.result.source, "system-quest");
  assert.equal(first.result.realm, "arena");
  assert.equal(first.result.viewedAt, null);
  assert.equal(first.result.reward.item.id, first.item.id);
  assert.equal(first.result.reward.xp, first.xp);
  assert.equal(first.result.reward.goldU, first.reward);
  const before = economy(db),
    replay = claimQuest(db, a, chest.id, null, now + 2000);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.equal(replay.item.id, first.item.id);
  assert.deepEqual(economy(db), before);
  assert.equal(
    service.latest(a, { realm: "arena", unviewedOnly: true }).id,
    first.result.id,
  );
  assert.equal(service.get(a, first.result.id).viewedAt, null);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM adventure_result_views").get().n,
    0,
  );
  const raw = db.prepare("SELECT * FROM adventure_results").get();
  assert.equal(raw.item_id, first.item.id);
  assert.deepEqual(Object.keys(JSON.parse(raw.item_snapshot)), [
    "id",
    "kind",
    "name",
    "rarity",
    "slot",
    "color",
    "serial",
  ]);
  assert.ok(
    !["lat", "lng", "accuracy", "fix", "gps", "image"].some((key) =>
      Object.hasOwn(raw, key),
    ),
  );
});
test("receipt survives a real SQLite reopen and remains readable after expiry while a new claim stays closed", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-result-reopen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "copy.sqlite"),
    db = openDatabase(path),
    a = createPlayer(db, "Restart explorer", now),
    world = await ensureWorld(db, HOME, true, now),
    quests = worldView(db, world.id, a).quests,
    chest = quests.find((q) => q.kind === "chest" && q.tier === 1),
    visit = quests.find((q) => q.kind === "visit" && q.tier === 1);
  const first = claimQuest(db, a, chest.id, chest, now);
  db.close();
  const reopened = openDatabase(path);
  t.after(() => reopened.close());
  const service = createAdventureResults(reopened),
    before = economy(reopened);
  assert.deepEqual(service.get(a, first.result.id), first.result);
  assert.equal(
    claimQuest(reopened, a, chest.id, null, world.endsAt + 1).result.id,
    first.result.id,
  );
  assert.throws(
    () => claimQuest(reopened, a, visit.id, visit, world.endsAt + 1),
    /closed/,
  );
  assert.deepEqual(economy(reopened), before);
});
test("receipt insertion failure rolls back the mint, claim, XP, shared prize, history and edition counter", async (t) => {
  const { db, a, chest } = await fixture(t),
    before = economy(db);
  db.exec(
    "CREATE TEMP TRIGGER reject_adventure_result BEFORE INSERT ON adventure_results BEGIN SELECT RAISE(ABORT,'Result receipt unavailable'); END",
  );
  assert.throws(
    () => claimQuest(db, a, chest.id, chest, now),
    /Result receipt unavailable/,
  );
  assert.deepEqual(economy(db), before);
  db.exec("DROP TRIGGER reject_adventure_result");
  assert.equal(claimQuest(db, a, chest.id, chest, now).replayed, false);
});
test("the final route checkpoint and exact result commit together and duplicate final sends recover one result", async (t) => {
  const { db, a, route } = await fixture(t),
    points = route.activity.steps.map((s) => s.point);
  for (let i = 0; i < points.length - 1; i++)
    assert.equal(
      advanceRoute(db, a, route.id, points[i], i, now).awaiting,
      true,
    );
  const before = economy(db);
  db.exec(
    "CREATE TEMP TRIGGER reject_route_result BEFORE INSERT ON adventure_results BEGIN SELECT RAISE(ABORT,'Route result unavailable'); END",
  );
  assert.throws(
    () => advanceRoute(db, a, route.id, points.at(-1), points.length - 1, now),
    /Route result unavailable/,
  );
  assert.deepEqual(economy(db), before);
  db.exec("DROP TRIGGER reject_route_result");
  const first = advanceRoute(
      db,
      a,
      route.id,
      points.at(-1),
      points.length - 1,
      now,
    ),
    settled = economy(db);
  const replay = advanceRoute(db, a, route.id, null, -9, now + 1000);
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.id, first.result.id);
  assert.deepEqual(replay.progress, first.progress);
  assert.deepEqual(economy(db), settled);
});
test("zero-item chests and another player's shared prize retain their exact independent results", async (t) => {
  const { db, a, b, chest, quests } = await fixture(t);
  for (const name of DEMO_AURA_NAMES)
    db.prepare("INSERT INTO editions VALUES(?,256,256)").run(name);
  const empty = claimQuest(db, a, chest.id, chest, now);
  assert.equal(empty.item, null);
  assert.equal(empty.result.reward.item, null);
  assert.equal(empty.result.itemCurrent.status, "none");
  assert.equal(empty.result.reward.xp, chest.xp);
  const funded = quests.find((q) => q.tier === 2 && q.kind === "visit");
  // Zone prizes come from the daily zone budget (a funded cell zone).
  db.prepare(
    "UPDATE quests SET gold_u=1500,metadata=json_set(COALESCE(metadata,'{}'),'$.cellZone',json('{\"cell\":\"test\",\"prizeU\":1500}')) WHERE id=?",
  ).run(funded.id);
  stake(db, a, 100000 * GOLD, 50, "meadow", now);
  stake(db, b, 100000 * GOLD, 50, "river", now);
  const winner = claimQuest(db, a, funded.id, funded, now + 31000),
    personal = claimQuest(db, b, funded.id, funded, now + 32000),
    before = economy(db);
  assert.ok(winner.result.reward.goldU > 0);
  assert.equal(personal.result.reward.goldU, 0);
  assert.equal(personal.result.reward.xp, funded.xp);
  assert.notEqual(winner.result.id, personal.result.id);
  assert.equal(
    claimQuest(db, b, funded.id, null, now + 33000).result.reward.goldU,
    0,
  );
  assert.deepEqual(economy(db), before);
});
test("result inspection checks current ownership/listing/equipment without rewriting historical item identity", async (t) => {
  const { db, a, b, service, chest } = await fixture(t),
    first = claimQuest(db, a, chest.id, chest, now),
    resultId = first.result.id,
    itemId = first.item.id;
  assert.equal(service.get(a, resultId).itemCurrent.equippable, true);
  assert.equal(equip(db, a, itemId, true).equipped, true);
  assert.equal(equip(db, a, itemId, true).replayed, true);
  assert.equal(
    db.prepare("SELECT equipped FROM inventory WHERE id=?").get(itemId)
      .equipped,
    1,
  );
  assert.equal(service.get(a, resultId).itemCurrent.equipped, true);
  assert.equal(service.get(a, resultId).itemCurrent.equippable, false);
  db.prepare("UPDATE players SET native_outfit=1 WHERE id=?").run(a);
  assert.equal(service.get(a, resultId).itemCurrent.equipped, false);
  assert.equal(service.get(a, resultId).itemCurrent.equippable, true);
  assert.equal(equip(db, a, itemId, true).equipped, true);
  assert.equal(
    db.prepare("SELECT native_outfit FROM players WHERE id=?").get(a)
      .native_outfit,
    0,
  );
  assert.equal(service.get(a, resultId).itemCurrent.equipped, true);
  equip(db, a, itemId);
  const listing = listItem(db, a, itemId, 17250000, now);
  assert.equal(service.get(a, resultId).itemCurrent.status, "listed");
  assert.throws(() => equip(db, a, itemId, true), /Cancel/);
  cancelListing(db, a, listing.listing);
  const relisted = listItem(db, a, itemId, 17250000, now);
  buyItem(db, b, relisted.listing);
  const transferred = service.get(a, resultId);
  assert.equal(transferred.itemCurrent.status, "not-owned");
  assert.equal(transferred.reward.item.id, itemId);
  assert.equal(transferred.itemCurrent.item, undefined);
  assert.throws(() => equip(db, a, itemId, true), /not in your collection/);
  db.prepare("DELETE FROM listings WHERE item_id=?").run(itemId);
  db.prepare("DELETE FROM inventory WHERE id=?").run(itemId);
  assert.equal(service.get(a, resultId).itemCurrent.status, "missing");
  assert.equal(service.get(a, resultId).reward.item.id, itemId);
});
test("issued native vouchers stay reserved until verified restoration, even past wall-clock expiry", async (t) => {
  const { db, a, service, chest } = await fixture(t),
    first = claimQuest(db, a, chest.id, chest, now),
    itemId = first.item.id;
  db.prepare(
    "INSERT INTO native_awards(item_id,claim_id,player_id,receiver_id,edition,state,expires_at,created_at) VALUES(?,?,?,?,?,'issued',?,?)",
  ).run(
    itemId,
    "unit-claim",
    a,
    "explorer.testnet",
    "moon",
    now - 1,
    now - 1000,
  );
  assert.equal(service.get(a, first.result.id).itemCurrent.status, "reserved");
  assert.throws(
    () => equip(db, a, itemId, true),
    (e) => e.code === "ITEM_RESERVED",
  );
  db.prepare(
    "UPDATE native_awards SET state='minted',token_id='native-token' WHERE item_id=?",
  ).run(itemId);
  assert.equal(service.get(a, first.result.id).itemCurrent.status, "minted");
  assert.throws(() => equip(db, a, itemId, true), /Secured collection/);
  assert.equal(service.get(a, first.result.id).reward.item.id, itemId);
  db.prepare("DELETE FROM native_awards WHERE item_id=?").run(itemId);
  assert.equal(service.get(a, first.result.id).itemCurrent.equippable, true);
});
test("legacy completion never fabricates exact rewards or guesses an item ID from its name", async (t) => {
  const { db, a, b, service, chest } = await fixture(t);
  db.prepare("INSERT INTO quest_claims VALUES(?,?,?)").run(chest.id, a, now);
  db.prepare("INSERT INTO history VALUES(?,?,?,?,?,?,?)").run(
    "legacy-history",
    a,
    "quest",
    chest.title,
    123,
    JSON.stringify({ quest: chest.id, xp: 50, item: "Northern Lights" }),
    now,
  );
  db.prepare("INSERT INTO inventory VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    "different-unrelated-aura",
    a,
    "aura",
    "Northern Lights",
    "rare",
    "above",
    "#8dd8bd",
    0,
    77,
    now,
  );
  const before = economy(db),
    legacy = service.forQuest(a, chest.id);
  assert.equal(legacy.status, "legacy-unavailable");
  assert.equal(legacy.reward, null);
  assert.equal(legacy.itemCurrent.equippable, false);
  assert.equal(legacy.itemCurrent.status, "legacy-unavailable");
  assert.equal(service.get(a, legacy.id).id, legacy.id);
  assert.equal(service.list(a, { unviewedOnly: true }).results.length, 0);
  assert.equal(service.list(a).results[0].status, "legacy-unavailable");
  assert.equal(service.forQuest(b, chest.id), null);
  assert.throws(
    () => service.get(b, legacy.id),
    (e) => e.status === 404,
  );
  assert.throws(
    () => claimQuest(db, a, chest.id, null, now + 1),
    (e) => e.code === "RESULT_LEGACY_UNAVAILABLE",
  );
  assert.deepEqual(economy(db), before);
  assert.equal(service.markViewed(a, legacy.id, now + 2).viewedAt, now + 2);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM adventure_results").get().n,
    0,
  );
});
test("owner/realm filters, bounded stable pagination and deliberate viewed acknowledgement do not settle anything", async (t) => {
  const { db, a, b, service, chest, visit } = await fixture(t);
  const first = claimQuest(db, a, chest.id, chest, now),
    second = claimQuest(db, a, visit.id, visit, now + 1),
    before = economy(db);
  const page = service.list(a, {
    limit: 1,
    realm: "arena",
    unviewedOnly: true,
  });
  assert.equal(page.results[0].id, second.result.id);
  assert.ok(page.nextCursor);
  const next = service.list(a, {
    limit: 1,
    realm: "arena",
    unviewedOnly: true,
    cursor: page.nextCursor,
  });
  assert.equal(next.results[0].id, first.result.id);
  assert.equal(next.nextCursor, null);
  assert.equal(service.list(a, { realm: "gps" }).results.length, 0);
  assert.equal(service.latest(b), null);
  assert.throws(
    () => service.get(b, first.result.id),
    (e) => e.status === 404,
  );
  for (const options of [
    { limit: 0 },
    { limit: 51 },
    { realm: "native" },
    { unviewedOnly: "true" },
    { cursor: "broken" },
    { realm: "gps", unviewedOnly: true, cursor: page.nextCursor },
  ])
    assert.throws(() => service.list(a, options));
  assert.throws(() =>
    service.list(b, {
      limit: 1,
      realm: "arena",
      unviewedOnly: true,
      cursor: page.nextCursor,
    }),
  );
  assert.equal(service.get(a, first.result.id).viewedAt, null);
  assert.equal(
    service.markViewed(a, first.result.id, now + 100).viewedAt,
    now + 100,
  );
  assert.equal(
    service.markViewed(a, first.result.id, now + 200).viewedAt,
    now + 100,
  );
  assert.throws(
    () => service.markViewed(b, first.result.id, now + 300),
    (e) => e.status === 404,
  );
  assert.equal(service.list(a, { unviewedOnly: true }).results.length, 1);
  assert.deepEqual(economy(db), before);
});
test("physical demo receipts keep their realm but never save raw GPS evidence or authorize a native result", async (t) => {
  const { db, a, service, chest } = await fixture(t, { arena: false }),
    fix = { lat: chest.lat, lng: chest.lng, accuracy: 5, timestamp: now },
    result = claimQuest(db, a, chest.id, fix, now).result;
  assert.equal(result.realm, "gps");
  assert.equal(service.list(a, { realm: "arena" }).results.length, 0);
  assert.equal(service.list(a, { realm: "gps" }).results[0].id, result.id);
  const stored = db
    .prepare("SELECT * FROM adventure_results WHERE id=?")
    .get(result.id);
  assert.ok(!JSON.stringify(stored).includes('"accuracy"'));
  assert.ok(!JSON.stringify(stored).includes('"timestamp"'));
  const another = worldView(db, result.worldId, a).quests.find(
      (q) => q.kind === "visit" && q.tier === 1,
    ),
    manifest = JSON.parse(
      db.prepare("SELECT manifest FROM worlds WHERE id=?").get(result.worldId)
        .manifest,
    );
  manifest.id = "native:other-domain";
  db.prepare("UPDATE worlds SET manifest=? WHERE id=?").run(
    JSON.stringify(manifest),
    result.worldId,
  );
  const before = economy(db);
  assert.throws(
    () => claimQuest(db, a, another.id, fix, now),
    (e) => e.code === "RESULT_DOMAIN_MISMATCH",
  );
  assert.deepEqual(economy(db), before);
});
test("two independent database connections retry one quest concurrently and produce exactly one grant/receipt", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-result-race-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "race.sqlite");
  const db = openDatabase(path),
    a = createPlayer(db, "Concurrent explorer", now),
    world = await ensureWorld(db, HOME, true, now),
    chest = worldView(db, world.id, a).quests.find(
      (q) => q.kind === "chest" && q.tier === 1,
    );
  createAdventureResults(db);
  const initial = db.prepare("SELECT xp,gold_u FROM players WHERE id=?").get(a);
  db.close();
  const module = new URL("../server/game.mjs", import.meta.url).href,
    database = new URL("../server/database.mjs", import.meta.url).href;
  const workers = [0, 1].map(
    () =>
      new Worker(
        `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const game=await import(workerData.module);const {openDatabase}=await import(workerData.database);const db=openDatabase(workerData.path);parentPort.on('message',()=>{try{const r=game.claimQuest(db,workerData.a,workerData.chest.id,workerData.chest,workerData.now);parentPort.postMessage({result:r});}catch(e){parentPort.postMessage({error:e.message});}finally{db.close();}});parentPort.postMessage({ready:true});})().catch(e=>parentPort.postMessage({error:e.message}));`,
        { eval: true, workerData: { module, database, path, a, chest, now } },
      ),
  );
  t.after(() => Promise.all(workers.map((w) => w.terminate())));
  const output = await Promise.all(
    workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.on("error", reject);
          w.on("message", (m) => {
            if (m.ready) w.postMessage("go");
            else if (m.error) reject(Error(m.error));
            else resolve(m.result);
          });
        }),
    ),
  );
  assert.equal(new Set(output.map((r) => r.result.id)).size, 1);
  assert.deepEqual(output.map((r) => r.replayed).sort(), [false, true]);
  const reopened = openDatabase(path);
  t.after(() => reopened.close());
  assert.equal(
    reopened.prepare("SELECT COUNT(*) n FROM adventure_results").get().n,
    1,
  );
  assert.equal(
    reopened
      .prepare(
        "SELECT COUNT(*) n FROM inventory WHERE player_id=? AND kind='aura'",
      )
      .get(a).n,
    1,
  );
  assert.equal(
    reopened.prepare("SELECT xp FROM players WHERE id=?").get(a).xp,
    initial.xp + chest.xp,
  );
});

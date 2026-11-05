import test from "node:test";
import { latLngToCell, cellToLatLng } from "h3-js";
import assert from "node:assert/strict";
import { openDatabase, createPlayer, atomic } from "../server/database.mjs";
import {
  GOLD,
  COIN_VALUE,
  DAY,
  splitYield,
  positionTier,
  tierFor,
  validateFix,
} from "../server/domain.mjs";
import {
  ensureWorld,
  worldView,
  expireWorlds,
  HOME,
} from "../server/world.mjs";
import {
  claimCoin,
  claimQuest,
  reserveYield,
  stake,
  unstake,
  redeem,
  equip,
  listItem,
  buyItem,
  cancelListing,
  contribution,
  harvestDemo,
} from "../server/game.mjs";
const now = Date.parse("2026-11-02T12:00:00Z");
function setup() {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now),
    b = createPlayer(db, "Bob", now);
  return { db, a, b };
}
test("yield uses two conserved buckets and idempotent receipts", () => {
  const { db } = setup();
  assert.deepEqual(splitYield(101), { coins: 50, zones: 51 });
  assert.equal(reserveYield(db, "harvest-1", 101, now), true);
  assert.equal(reserveYield(db, "harvest-1", 101, now), false);
  assert.equal(
    db.prepare("SELECT available_u FROM treasury WHERE bucket='coins'").get()
      .available_u,
    50_000 * GOLD + 50,
  );
  assert.equal(
    db.prepare("SELECT available_u FROM treasury WHERE bucket='zones'").get()
      .available_u,
    50_000 * GOLD + 51,
  );
  db.close();
});
test("simultaneous activation shares a single world and one cell drop", async () => {
  const { db } = setup();
  const [w1, w2] = await Promise.all([
    ensureWorld(db, HOME, true, now),
    ensureWorld(db, HOME, true, now),
  ]);
  assert.equal(w1.id, w2.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM worlds").get().n, 1);
  // Map rewards: one cell drop. The demo arena's coins give XP only, so no
  // money is reserved anywhere.
  const c = db.prepare("SELECT COUNT(*) n,COALESCE(SUM(value_u),0) v FROM coins").get();
  assert.ok(c.n > 0);
  assert.equal(c.v, 0);
  assert.equal(
    db.prepare("SELECT reserved_u FROM treasury WHERE bucket='coins'").get()
      .reserved_u,
    0,
  );
  db.close();
});
test("shared coin pays one player once and cannot be farmed by retries", async () => {
  const { db, a, b } = setup();
  const w = await ensureWorld(db, HOME, true, now);
  const coin = worldView(db, w.id, null, { now }).coins[0];
  const start = db
    .prepare("SELECT gold_u FROM players WHERE id=?")
    .get(a).gold_u;
  assert.equal(claimCoin(db, a, coin.id, coin, now).value, coin.value_u);
  assert.equal(claimCoin(db, a, coin.id, coin, now).alreadyClaimed, true);
  assert.throws(() => claimCoin(db, b, coin.id, coin, now), /Another explorer/);
  assert.equal(
    db.prepare("SELECT gold_u FROM players WHERE id=?").get(a).gold_u,
    start + coin.value_u,
  );
  assert.equal(
    db.prepare("SELECT paid_u FROM treasury WHERE bucket='coins'").get().paid_u,
    coin.value_u,
  );
  db.close();
});
test("expired coins cannot be collected and unclaimed backing rolls over once", async () => {
  const { db, a } = setup();
  const w = await ensureWorld(db, HOME, true, now),
    coin = worldView(db, w.id, null, { now }).coins[0];
  const initial = db
    .prepare(
      "SELECT available_u+reserved_u AS n FROM treasury WHERE bucket='coins'",
    )
    .get().n;
  claimCoin(db, a, coin.id, coin, now);
  assert.throws(
    () => claimCoin(db, a, worldView(db, w.id).coins[0].id, coin, w.endsAt),
    /ended/,
  );
  expireWorlds(db, w.endsAt);
  expireWorlds(db, w.endsAt + 2);
  const t = db.prepare("SELECT * FROM treasury WHERE bucket='coins'").get();
  assert.equal(t.reserved_u, 0);
  assert.equal(t.available_u, initial - coin.value_u);
  db.close();
});
test("a solo player can complete a free quest and mint one bounded Aura", async () => {
  const { db, a } = setup();
  const w = await ensureWorld(db, HOME, true, now);
  const q = worldView(db, w.id).quests.find((q) => q.kind === "chest");
  const r = claimQuest(db, a, q.id, q, now);
  assert.ok(r.item);
  assert.equal(r.reward, 0);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM inventory WHERE player_id=? AND kind='aura'",
      )
      .get(a).n,
    1,
  );
  const replay = claimQuest(db, a, q.id, q, now);
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.id, r.result.id);
  db.close();
});
test("tier access matures, withdrawals remove it, decreases apply immediately", () => {
  const { db, a } = setup();
  const s = stake(db, a, 100_000 * GOLD, 100, "meadow", now);
  let p = db.prepare("SELECT * FROM positions WHERE id=?").get(s.position);
  assert.equal(tierFor(positionTier(p, now)), 1);
  assert.equal(tierFor(positionTier(p, now + 30_001)), 3);
  contribution(db, a, p.id, 50, now + 31_000);
  p = db.prepare("SELECT * FROM positions WHERE id=?").get(p.id);
  assert.equal(tierFor(positionTier(p, now + 31_001)), 2);
  contribution(db, a, p.id, 100, now + 32_000);
  p = db.prepare("SELECT * FROM positions WHERE id=?").get(p.id);
  assert.equal(tierFor(positionTier(p, now + 32_001)), 2);
  assert.equal(tierFor(positionTier(p, now + 62_001)), 3);
  unstake(db, a, p.id, now + 63_000);
  p = db.prepare("SELECT * FROM positions WHERE id=?").get(p.id);
  assert.equal(positionTier(p, now + 63_001), 0);
  db.close();
});
test("a funded quest has one GOLD payout while everyone can still earn personal XP", async () => {
  const { db, a, b } = setup();
  const w = await ensureWorld(db, HOME, true, now),
    q = worldView(db, w.id).quests.find((q) => q.tier === 2);
  stake(db, a, 100_000 * GOLD, 50, "meadow", now);
  stake(db, b, 100_000 * GOLD, 50, "river", now);
  assert.throws(() => claimQuest(db, a, q.id, q, now), /Tier/);
  const r = claimQuest(db, a, q.id, q, now + 31_000),
    r2 = claimQuest(db, b, q.id, q, now + 32_000);
  assert.equal(r.reward, 1000 * GOLD);
  assert.equal(r2.reward, 0);
  assert.equal(r2.xp, q.xp);
  assert.equal(
    db.prepare("SELECT paid_u FROM treasury WHERE bucket='zones'").get().paid_u,
    1000 * GOLD,
  );
  db.close();
});
test("unstaking preserves retained yield and withdrawal is redeemable once", () => {
  const { db, a } = setup();
  const s = stake(db, a, 100_000 * GOLD, 50, "meadow", now);
  const w = unstake(db, a, s.position, now + DAY);
  const value = db
    .prepare("SELECT amount_u FROM withdrawals WHERE id=?")
    .get(w.withdrawal).amount_u;
  assert.ok(value > 100_000 * GOLD);
  assert.throws(() => redeem(db, a, w.withdrawal, now + DAY), /unlocking/);
  redeem(db, a, w.withdrawal, now + DAY + 60_001);
  assert.throws(
    () => redeem(db, a, w.withdrawal, now + DAY + 60_002),
    /complete/,
  );
  db.close();
});
test("yield allocation before contribution change cannot be reassigned retroactively", () => {
  const { db, a } = setup();
  const s = stake(db, a, 100_000 * GOLD, 0, "meadow", now);
  contribution(db, a, s.position, 100, now + DAY);
  const p = db.prepare("SELECT * FROM positions WHERE id=?").get(s.position);
  assert.ok(p.accrued_u > 0);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM treasury_events WHERE kind='simulated-yield'",
      )
      .get().n,
    0,
  );
  contribution(db, a, s.position, 0, now + 2 * DAY);
  const ts = db
    .prepare(
      "SELECT coins_u,zones_u FROM treasury_events WHERE kind='simulated-yield'",
    )
    .all();
  assert.equal(ts.length, 1);
  assert.ok(Math.abs(ts[0].coins_u - ts[0].zones_u) <= 1);
  db.close();
});
test("market sale is atomic, conserves balances and transfers equipment rights", async () => {
  const { db, a, b } = setup();
  const w = await ensureWorld(db, HOME, true, now),
    q = worldView(db, w.id).quests.find((q) => q.kind === "chest");
  const item = claimQuest(db, a, q.id, q, now).item;
  equip(db, a, item.id);
  const { listing } = listItem(db, a, item.id, 10 * GOLD, now);
  assert.equal(
    db.prepare("SELECT equipped FROM inventory WHERE id=?").get(item.id)
      .equipped,
    0,
  );
  assert.throws(() => equip(db, a, item.id), /Cancel/);
  const sum = db.prepare("SELECT SUM(gold_u) AS n FROM players").get().n;
  buyItem(db, b, listing, now);
  assert.equal(
    db.prepare("SELECT player_id FROM inventory WHERE id=?").get(item.id)
      .player_id,
    b,
  );
  assert.equal(db.prepare("SELECT SUM(gold_u) AS n FROM players").get().n, sum);
  assert.throws(() => buyItem(db, a, listing, now), /available/);
  assert.throws(() => equip(db, a, item.id), /not in your collection/);
  equip(db, b, item.id);
  db.close();
});
test("cancelled listing cannot be filled or revive after relisting", async () => {
  const { db, a, b } = setup();
  const w = await ensureWorld(db, HOME, true, now),
    q = worldView(db, w.id).quests.find((q) => q.kind === "chest");
  const item = claimQuest(db, a, q.id, q, now).item;
  const old = listItem(db, a, item.id, GOLD, now);
  cancelListing(db, a, old.listing);
  const next = listItem(db, a, item.id, 2 * GOLD, now);
  assert.throws(() => buyItem(db, b, old.listing, now), /available/);
  buyItem(db, b, next.listing, now);
  db.close();
});
test("invalid monetary actions do not change wallet or treasury", () => {
  const { db, a } = setup();
  const before = db
    .prepare("SELECT gold_u FROM players WHERE id=?")
    .get(a).gold_u;
  for (const value of [NaN, -1, 0, 0.5, Number.MAX_SAFE_INTEGER])
    assert.throws(() => stake(db, a, value, 100, "meadow", now));
  assert.throws(() => stake(db, a, GOLD, 101, "meadow", now));
  assert.throws(() => stake(db, a, GOLD, 50, "unknown", now));
  assert.equal(
    db.prepare("SELECT gold_u FROM players WHERE id=?").get(a).gold_u,
    before,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM positions").get().n, 0);
  db.close();
});
test("failed transaction rolls back all writes", () => {
  const { db, a } = setup();
  const before = db
    .prepare("SELECT gold_u FROM players WHERE id=?")
    .get(a).gold_u;
  assert.throws(() =>
    atomic(db, () => {
      db.prepare("UPDATE players SET gold_u=0 WHERE id=?").run(a);
      throw new Error("crash");
    }),
  );
  assert.equal(
    db.prepare("SELECT gold_u FROM players WHERE id=?").get(a).gold_u,
    before,
  );
  db.close();
});
test("physical GPS validation rejects stale, inaccurate and distant evidence", () => {
  const good = { ...HOME, accuracy: 10, timestamp: now };
  validateFix(good, HOME, now);
  assert.throws(
    () => validateFix({ ...good, timestamp: now - 20000 }, HOME, now),
    /out of date/,
  );
  assert.throws(
    () => validateFix({ ...good, accuracy: 100 }, HOME, now),
    /not precise enough/,
  );
  assert.throws(
    () => validateFix({ ...good, lat: HOME.lat + 0.01 }, HOME, now),
    /closer/,
  );
});
test("local world rollover handles 23-hour and 25-hour days", async () => {
  for (const [start, hours] of [
    ["2026-03-28T23:00:00Z", 23],
    ["2026-10-24T22:00:00Z", 25],
  ]) {
    const { db } = setup();
    const time = Date.parse(start),
      w = await ensureWorld(db, HOME, true, time);
    assert.equal(w.endsAt - time, hours * 3600000);
    db.close();
  }
});

test("city snapshots share a fixed public center and never record the first visitor GPS", async () => {
  const { db } = setup();
  const first = { lat: HOME.lat + 0.0002, lng: HOME.lng + 0.0002 },
    w = await ensureWorld(db, first, false, now);
  assert.deepEqual(w.center, HOME);
  assert.notDeepEqual(w.center, first);
  db.prepare("UPDATE worlds SET manifest=? WHERE id=?").run(
    JSON.stringify({ ...w, center: first }),
    w.id,
  );
  assert.deepEqual(worldView(db, w.id).center, HOME);
  const second = await ensureWorld(db, { lat: 49.73, lng: 13.36 }, false, now);
  assert.equal(second.id, w.id);
  // Six reviewed city zones; pioneer chests of first-visited cells come on top.
  assert.equal(second.zones.filter((z) => z.source !== "pioneer").length, 6);
  db.close();
});

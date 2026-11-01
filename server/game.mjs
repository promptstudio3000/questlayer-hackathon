import { randomBytes } from "node:crypto";
import {
  GOLD,
  DAY,
  distance,
  assert,
  amount,
  id,
  hash,
  point,
  dayKey,
  levelFor,
  positionTier,
  tierFor,
  validateFix,
  splitYield,
  COIN_ARENA_RADIUS_M,
} from "./domain.mjs";
import { contains } from "./spatial/city-pack.mjs";
import { closedPlaces, assertPlaceOpen } from "./spatial/place-safety.mjs";
import { QUEST_POLICY } from "./quest-templates.mjs";
import { atomic, history, playerView, createPlayer } from "./database.mjs";
import {
  createAdventureResults,
  demoAdventureWorld,
  recordAdventureResult,
  replayAdventureResult,
} from "./adventure-results.mjs";

export function session(db, name, now = Date.now()) {
  assert(
    typeof name === "string" &&
      name.trim().length >= 2 &&
      name.trim().length <= 24,
    "Your name must be 2–24 characters.",
  );
  return atomic(db, () => {
    const player = createPlayer(db, name.trim(), now),
      token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      hash(token),
      player,
      now + 30 * DAY,
    );
    return { token, player: playerView(db, player) };
  });
}
export function reserveYield(db, jobKey, net, now = Date.now()) {
  amount(net, { min: 0 });
  return atomic(db, () => {
    if (db.prepare("SELECT 1 FROM treasury_events WHERE id=?").get(jobKey))
      return false;
    const { coins, zones } = splitYield(net);
    for (const [bucket, n] of [
      ["coins", coins],
      ["zones", zones],
    ])
      db.prepare(
        "UPDATE treasury SET available_u=available_u+? WHERE bucket=?",
      ).run(n, bucket);
    db.prepare("INSERT INTO treasury_events VALUES (?,?,?,?,?)").run(
      jobKey,
      "simulated-yield",
      coins,
      zones,
      now,
    );
    return true;
  });
}
export function claimCoin(db, player, coinId, fix, now = Date.now()) {
  return atomic(db, () => {
    const coin = db
      .prepare(
        "SELECT c.*,w.manifest FROM coins c JOIN worlds w ON w.id=c.world_id WHERE c.id=?",
      )
      .get(coinId);
    assert(coin, "This coin is gone. Pick another one nearby.", 404);
    const world = JSON.parse(coin.manifest);
    assert(
      world.endsAt > now,
      "Today's world has ended. Refresh the map for a new one.",
      410,
    );
    if (coin.claimant === player)
      return { alreadyClaimed: true, value: coin.value_u };
    assert(
      !coin.claimant,
      "Another explorer got this coin first. Pick another one nearby.",
      409,
      "ALREADY_CLAIMED",
    );
    assertPlaceOpen(closedPlaces(db, world.cityId), null, coin);
    if (!world.arena) validateFix(fix, coin, now);
    else {
      point(fix);
      assert(
        distance(fix, coin) <= COIN_ARENA_RADIUS_M,
        "Get a bit closer to pick up this coin.",
      );
    }
    const updated = db
      .prepare(
        "UPDATE coins SET claimant=?,claimed_at=? WHERE id=? AND claimant IS NULL",
      )
      .run(player, now, coinId);
    assert(
      updated.changes === 1,
      "This coin was just collected. Pick another one nearby.",
      409,
    );
    db.prepare(
      "UPDATE treasury SET reserved_u=reserved_u-?,paid_u=paid_u+? WHERE bucket=?",
    ).run(coin.value_u, coin.value_u, "coins");
    db.prepare("UPDATE players SET gold_u=gold_u+?,xp=xp+2 WHERE id=?").run(
      coin.value_u,
      player,
    );
    history(db, player, "coin", "Street coin", coin.value_u, { coin: coinId });
    return { value: coin.value_u, xp: 2 };
  });
}
export function claimQuest(db, player, questId, fix, now = Date.now()) {
  const results = createAdventureResults(db);
  return atomic(db, () => settleQuest(db, player, questId, fix, now, results));
}
function settleQuest(db, player, questId, fix, now, results) {
  const q = db
    .prepare(
      "SELECT q.*,w.manifest FROM quests q JOIN worlds w ON w.id=q.world_id WHERE q.id=?",
    )
    .get(questId);
  assert(q, "Quest not found.", 404);
  demoAdventureWorld(q);
  if (
    db
      .prepare("SELECT 1 FROM quest_claims WHERE quest_id=? AND player_id=?")
      .get(q.id, player)
  )
    return replayAdventureResult(results.forQuest(player, q.id));
  assert(
    now >= q.opens_at && now < q.closes_at,
    "This place is closed for today. Find another discovery.",
    410,
  );
  validateQuestEvidence(db, player, q, fix, now, q);
  const meta = JSON.parse(q.metadata || "{}");
  if (q.kind === "route")
    assert(
      (db
        .prepare(
          "SELECT checkpoint FROM quest_progress WHERE quest_id=? AND player_id=?",
        )
        .get(q.id, player)?.checkpoint || 0) >= (meta.checkpoints || []).length,
      "Complete the checkpoints in order first.",
      409,
    );
  // Everyone can finish the personal activity. The funded shared prize is paid once.
  const reward = !q.claimant ? q.gold_u : 0;
  if (!q.claimant) {
    db.prepare("UPDATE quests SET claimant=?,claimed_at=? WHERE id=?").run(
      player,
      now,
      q.id,
    );
    if (reward)
      db.prepare(
        "UPDATE treasury SET reserved_u=reserved_u-?,paid_u=paid_u+? WHERE bucket=?",
      ).run(reward, reward, "zones");
  }
  db.prepare("INSERT INTO quest_claims VALUES (?,?,?)").run(q.id, player, now);
  db.prepare("UPDATE players SET gold_u=gold_u+?,xp=xp+? WHERE id=?").run(
    reward,
    q.xp,
    player,
  );
  let item = null;
  if (q.kind === "chest") item = mintAura(db, player, now);
  const resultId = recordAdventureResult(db, {
    player,
    quest: q,
    reward,
    xp: q.xp,
    item,
    now,
  });
  history(db, player, "quest", q.title, reward, {
    quest: q.id,
    xp: q.xp,
    item: item?.name,
    resultId,
  });
  return {
    reward,
    xp: q.xp,
    item,
    result: results.get(player, resultId),
    replayed: false,
  };
}
function validateQuestEvidence(db, player, q, fix, now, target) {
  assert(
    now >= q.opens_at && now < q.closes_at,
    "This place is closed for today. Find another discovery.",
    410,
  );
  const positions = db
      .prepare("SELECT * FROM positions WHERE player_id=?")
      .all(player),
    tier = tierFor(positions.reduce((sum, p) => sum + positionTier(p, now), 0));
  assert(
    tier >= q.tier,
    `This place opens at Tier ${q.tier}. Try a free place nearby.`,
    403,
    "TIER_REQUIRED",
  );
  const world = JSON.parse(q.manifest),
    zone = world.zones.find((z) => z.id === q.zone_id);
  assertPlaceOpen(closedPlaces(db, world.cityId), zone?.sourceId, target);
  if (!world.arena) validateFix(fix, target, now, 25);
  else {
    point(fix);
    assert(
      distance(fix, target) <= 25,
      "Get a bit closer to the destination to confirm this visit.",
    );
  }
  if (zone?.geometry)
    assert(
      contains(zone.geometry, fix),
      "Enter the marked zone first, then confirm your visit.",
      422,
      "OUTSIDE_ZONE",
    );
}
export function advanceRoute(
  db,
  player,
  questId,
  fix,
  expectedCheckpoint,
  now = Date.now(),
) {
  const results = createAdventureResults(db);
  return atomic(db, () => {
    const q = db
      .prepare(
        "SELECT q.*,w.manifest FROM quests q JOIN worlds w ON w.id=q.world_id WHERE q.id=?",
      )
      .get(questId);
    assert(q?.kind === "route", "Walking expedition not found.", 404);
    demoAdventureWorld(q);
    const metadata = JSON.parse(q.metadata),
      checkpoints = metadata.checkpoints,
      saved = db
        .prepare(
          "SELECT checkpoint,updated_at FROM quest_progress WHERE quest_id=? AND player_id=?",
        )
        .get(q.id, player),
      current = saved?.checkpoint || 0;
    if (
      db
        .prepare("SELECT 1 FROM quest_claims WHERE quest_id=? AND player_id=?")
        .get(q.id, player)
    )
      return {
        ...replayAdventureResult(results.forQuest(player, q.id)),
        progress: { completed: current, total: checkpoints.length },
      };
    assert(
      Number.isInteger(expectedCheckpoint) && expectedCheckpoint === current,
      "Your expedition changed. Refresh its checkpoint.",
      409,
      "STALE_PROGRESS",
    );
    assert(
      current < checkpoints.length,
      "All checkpoints are already recorded.",
      409,
    );
    validateQuestEvidence(db, player, q, fix, now, checkpoints[current]);
    const requiresNewFix =
      metadata.activity?.policy === QUEST_POLICY &&
      !JSON.parse(q.manifest).arena;
    // A return stop cannot reuse the original starting fix. This only rejects
    // replayed observations; browser coordinates are not proof of physical truth.
    if (requiresNewFix && saved)
      assert(
        fix.timestamp > saved.updated_at,
        "Wait for a new GPS fix before recording the next stop.",
        422,
        "GPS_REPLAY",
      );
    db.prepare(
      "INSERT INTO quest_progress VALUES (?,?,?,?) ON CONFLICT(quest_id,player_id) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at",
    ).run(q.id, player, current + 1, requiresNewFix ? fix.timestamp : now);
    const progress = { completed: current + 1, total: checkpoints.length };
    if (progress.completed === progress.total)
      return {
        ...settleQuest(db, player, questId, fix, now, results),
        progress,
      };
    return { awaiting: true, progress };
  });
}
const AURAS = [
  ["Northern Lights", "rare", "above", "#8dd8bd"],
  ["Moon Ring", "epic", "below", "#b49beb"],
  ["Golden Dust", "legendary", "above", "#f2c869"],
];
function mintAura(db, player, now) {
  const count = db
    .prepare(
      "SELECT COUNT(*) AS n FROM inventory WHERE player_id=? AND kind='aura'",
    )
    .get(player).n;
  const rotated = [...AURAS.slice(count % 3), ...AURAS.slice(0, count % 3)];
  const chosen = rotated.find(
    ([name]) =>
      (db.prepare("SELECT minted FROM editions WHERE name=?").get(name)
        ?.minted || 0) < 256,
  );
  if (!chosen) return null;
  const [name, rarity, slot, color] = chosen;
  db.prepare("INSERT OR IGNORE INTO editions VALUES (?,0,256)").run(name);
  const e = db.prepare("SELECT * FROM editions WHERE name=?").get(name);
  if (e.minted >= e.max_supply) return null;
  const item = {
    id: id("aura"),
    name,
    rarity,
    slot,
    color,
    serial: e.minted + 1,
  };
  db.prepare("UPDATE editions SET minted=minted+1 WHERE name=?").run(name);
  db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    item.id,
    player,
    "aura",
    name,
    rarity,
    slot,
    color,
    0,
    item.serial,
    now,
  );
  return item;
}
export function stake(db, player, value, contribution, pool, now = Date.now()) {
  amount(value);
  assert(
    Number.isInteger(contribution) && contribution >= 0 && contribution <= 100,
    "The contribution must be 0–100%.",
  );
  assert(
    ["meadow", "river", "mountain"].includes(pool),
    "Unknown simulated pool.",
  );
  return atomic(db, () => {
    const p = db.prepare("SELECT gold_u FROM players WHERE id=?").get(player);
    assert(p.gold_u >= value, "Not enough practice GOLD for this stake.");
    db.prepare("UPDATE players SET gold_u=gold_u-? WHERE id=?").run(
      value,
      player,
    );
    const position = id("stake");
    db.prepare(
      "INSERT INTO positions(id,player_id,pool,active_u,contribution,matures_at,accrued_u,settled_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(position, player, pool, value, contribution, now + 30_000, 0, now);
    history(db, player, "stake", "Deposit into simulated staking", -value, {
      pool,
      contribution,
    });
    return { position, maturesAt: now + 30_000 };
  });
}
function settlePosition(db, p, now) {
  const net = Math.floor(
      (p.active_u * 0.05 * Math.max(0, now - p.settled_at)) / (365 * DAY),
    ),
    donated = Math.floor((net * p.contribution) / 100);
  const split = splitYield(donated);
  db.prepare(
    "UPDATE positions SET accrued_u=accrued_u+?,settled_at=? WHERE id=?",
  ).run(net - donated, now, p.id);
  for (const [bucket, n] of [
    ["coins", split.coins],
    ["zones", split.zones],
  ])
    db.prepare(
      "UPDATE treasury SET available_u=available_u+? WHERE bucket=?",
    ).run(n, bucket);
  if (donated)
    db.prepare("INSERT INTO treasury_events VALUES (?,?,?,?,?)").run(
      id("position-yield"),
      "simulated-yield",
      split.coins,
      split.zones,
      now,
    );
  return { personal: net - donated, game: donated };
}
export function contribution(db, player, positionId, value, now = Date.now()) {
  assert(
    Number.isInteger(value) && value >= 0 && value <= 100,
    "The contribution must be 0–100%.",
  );
  return atomic(db, () => {
    const p = db
      .prepare("SELECT * FROM positions WHERE id=? AND player_id=?")
      .get(positionId, player);
    assert(p && p.active_u > 0, "This stake is no longer active.");
    settlePosition(db, p, now);
    const eligible =
      p.matures_at <= now ? p.contribution : p.eligible_contribution;
    const matures =
      value > p.contribution
        ? now + 30_000
        : value <= eligible
          ? now
          : p.matures_at;
    db.prepare(
      "UPDATE positions SET contribution=?,eligible_contribution=?,matures_at=? WHERE id=?",
    ).run(value, Math.min(eligible, value), matures, p.id);
    history(
      db,
      player,
      "contribution",
      `Game contribution changed to ${value} %`,
    );
    return { maturesAt: matures };
  });
}
export function unstake(db, player, positionId, now = Date.now()) {
  return atomic(db, () => {
    const p = db
      .prepare("SELECT * FROM positions WHERE id=? AND player_id=?")
      .get(positionId, player);
    assert(p && p.active_u > 0, "This stake is no longer active.");
    const earned = settlePosition(db, p, now),
      withdrawal = id("withdrawal");
    db.prepare("INSERT INTO withdrawals VALUES (?,?,?,?,?,?)").run(
      withdrawal,
      player,
      p.active_u + p.accrued_u + earned.personal,
      now + 60_000,
      "pending",
      now,
    );
    db.prepare("UPDATE positions SET active_u=0,accrued_u=0 WHERE id=?").run(
      p.id,
    );
    history(db, player, "unstake", "Withdrawal requested", 0, {
      withdrawal,
      amount: p.active_u + p.accrued_u + earned.personal,
    });
    return { withdrawal, readyAt: now + 60_000 };
  });
}
export function redeem(db, player, withdrawalId, now = Date.now()) {
  return atomic(db, () => {
    const w = db
      .prepare("SELECT * FROM withdrawals WHERE id=? AND player_id=?")
      .get(withdrawalId, player);
    assert(w, "Withdrawal not found.", 404);
    assert(w.state === "pending", "Withdrawal is already complete.", 409);
    assert(
      w.ready_at <= now,
      "Your GOLD is still unlocking. Check back in a moment.",
    );
    db.prepare("UPDATE withdrawals SET state='paid' WHERE id=?").run(w.id);
    db.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(
      w.amount_u,
      player,
    );
    history(db, player, "withdraw", "Withdrawal completed", w.amount_u);
    return { amount: w.amount_u };
  });
}
export function equip(db, player, itemId, desiredEquipped) {
  assert(
    desiredEquipped === undefined || typeof desiredEquipped === "boolean",
    "Invalid equipment choice.",
  );
  return atomic(db, () => {
    const item = db
      .prepare("SELECT * FROM inventory WHERE id=? AND player_id=?")
      .get(itemId, player);
    assert(item, "You do not own this item.", 403);
    assert(
      !db
        .prepare("SELECT 1 FROM listings WHERE item_id=? AND state='open'")
        .get(itemId),
      "Cancel the listing before equipping this Aura.",
    );
    assert(
      !db
        .prepare(
          "SELECT 1 FROM native_awards WHERE item_id=? AND state='minted'",
        )
        .get(itemId),
      "Equip this Aura from your NEAR inventory.",
      409,
    );
    assert(
      !db
        .prepare(
          "SELECT 1 FROM native_awards WHERE item_id=? AND state='issued'",
        )
        .get(itemId),
      "This Aura is reserved for NEAR. Check or restore its claim before equipping it.",
      409,
      "ITEM_RESERVED",
    );
    const nextEquipped = desiredEquipped ?? !item.equipped;
    const nativeOutfit = !!db
      .prepare("SELECT native_outfit FROM players WHERE id=?")
      .get(player)?.native_outfit;
    if (
      desiredEquipped !== undefined &&
      !!item.equipped === desiredEquipped &&
      !(desiredEquipped && nativeOutfit)
    )
      return { equipped: desiredEquipped, replayed: true };
    db.prepare(
      "UPDATE inventory SET equipped=0 WHERE player_id=? AND slot=?",
    ).run(player, item.slot);
    db.prepare("UPDATE inventory SET equipped=? WHERE id=?").run(
      nextEquipped ? 1 : 0,
      item.id,
    );
    db.prepare("UPDATE players SET native_outfit=0 WHERE id=?").run(player);
    return { equipped: nextEquipped };
  });
}
export function listItem(db, player, itemId, price, now = Date.now()) {
  amount(price);
  return atomic(db, () => {
    const item = db
      .prepare(
        "SELECT * FROM inventory WHERE id=? AND player_id=? AND kind='aura'",
      )
      .get(itemId, player);
    assert(item, "Only your own Aura can be listed.", 403);
    assert(
      !db.prepare("SELECT 1 FROM native_awards WHERE item_id=?").get(itemId),
      "This Aura is reserved for NEAR and cannot enter the demo market.",
      409,
    );
    assert(
      !db
        .prepare("SELECT 1 FROM listings WHERE item_id=? AND state='open'")
        .get(itemId),
      "This Aura is already listed.",
      409,
    );
    db.prepare("UPDATE inventory SET equipped=0 WHERE id=?").run(itemId);
    const listing = id("listing");
    db.prepare(
      "INSERT INTO listings(id,item_id,seller,price_u,created_at) VALUES (?,?,?,?,?)",
    ).run(listing, itemId, player, price, now);
    history(db, player, "listing", `Listing: ${item.name}`, 0, { listing });
    return { listing };
  });
}
export function cancelListing(db, player, listingId) {
  return atomic(db, () => {
    const x = db.prepare("SELECT * FROM listings WHERE id=?").get(listingId);
    assert(x?.seller === player, "You do not own this listing.", 403);
    assert(x.state === "open", "The listing is already closed.", 409);
    db.prepare("UPDATE listings SET state='cancelled' WHERE id=?").run(x.id);
    return { cancelled: true };
  });
}
export function buyItem(db, player, listingId, now = Date.now()) {
  return atomic(db, () => {
    const x = db
      .prepare(
        "SELECT l.*,i.name,i.player_id FROM listings l JOIN inventory i ON i.id=l.item_id WHERE l.id=?",
      )
      .get(listingId);
    assert(
      x && x.state === "open",
      "This listing is no longer available. Pick another Aura.",
      409,
    );
    assert(
      x.seller !== player,
      "That is your own listing. Cancel it to get the Aura back.",
    );
    assert(
      x.player_id === x.seller,
      "This Aura changed hands. Refresh the market.",
      409,
    );
    const p = db.prepare("SELECT gold_u FROM players WHERE id=?").get(player);
    assert(p.gold_u >= x.price_u, "Not enough practice GOLD for this price.");
    db.prepare("UPDATE players SET gold_u=gold_u-? WHERE id=?").run(
      x.price_u,
      player,
    );
    db.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(
      x.price_u,
      x.seller,
    );
    db.prepare("UPDATE inventory SET player_id=?,equipped=0 WHERE id=?").run(
      player,
      x.item_id,
    );
    db.prepare("UPDATE listings SET state='sold',buyer=? WHERE id=?").run(
      player,
      x.id,
    );
    history(db, player, "purchase", `Purchase: ${x.name}`, -x.price_u);
    history(db, x.seller, "sale", `Sale: ${x.name}`, x.price_u);
    return { name: x.name };
  });
}
export function dashboard(db) {
  const buckets = db.prepare("SELECT * FROM treasury").all();
  const totals = db
    .prepare(
      "SELECT COUNT(DISTINCT player_id) AS stakers,COALESCE(SUM(active_u),0) AS staked,COALESCE(SUM(CAST(active_u*contribution/100 AS INTEGER)),0) AS contributing FROM positions WHERE active_u>0",
    )
    .get();
  return {
    buckets,
    ...totals,
    players: db.prepare("SELECT COUNT(*) AS n FROM players").get().n,
    coinsCollected: db
      .prepare("SELECT COUNT(*) AS n FROM coins WHERE claimant IS NOT NULL")
      .get().n,
    worlds: db.prepare("SELECT COUNT(*) AS n FROM worlds").get().n,
    events: db
      .prepare(
        "SELECT * FROM treasury_events ORDER BY created_at DESC LIMIT 20",
      )
      .all(),
    apr: 5,
    mode: "demo",
    split: { coins: 50, zones: 50 },
  };
}
export function harvestDemo(db, now = Date.now()) {
  const key = `yield:${dayKey(now, "UTC")}`;
  if (db.prepare("SELECT 1 FROM daily_jobs WHERE job_key=?").get(key))
    return false;
  return atomic(db, () => {
    let game = 0;
    const positions = db
      .prepare("SELECT * FROM positions WHERE active_u>0")
      .all();
    for (const p of positions) {
      const elapsed = Math.max(0, now - p.settled_at);
      const net = Math.floor((p.active_u * 0.05 * elapsed) / (365 * DAY));
      const donated = Math.floor((net * p.contribution) / 100);
      game += donated;
      db.prepare(
        "UPDATE positions SET accrued_u=accrued_u+?,settled_at=? WHERE id=?",
      ).run(net - donated, now, p.id);
    }
    const { coins, zones } = splitYield(game);
    for (const [bucket, n] of [
      ["coins", coins],
      ["zones", zones],
    ])
      db.prepare(
        "UPDATE treasury SET available_u=available_u+? WHERE bucket=?",
      ).run(n, bucket);
    db.prepare("INSERT INTO treasury_events VALUES (?,?,?,?,?)").run(
      key,
      "simulated-yield",
      coins,
      zones,
      now,
    );
    db.prepare("INSERT INTO daily_jobs VALUES (?,?)").run(key, now);
    return true;
  });
}

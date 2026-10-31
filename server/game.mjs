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
} from "./domain.mjs";
import { contains } from "./spatial/city-pack.mjs";
import { atomic, history, playerView, createPlayer } from "./database.mjs";

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
    assert(coin, "Coin not found.", 404);
    const world = JSON.parse(coin.manifest);
    assert(world.endsAt > now, "This daily world has ended.", 410);
    if (coin.claimant === player)
      return { alreadyClaimed: true, value: coin.value_u };
    assert(
      !coin.claimant,
      "Another explorer already collected this coin.",
      409,
      "ALREADY_CLAIMED",
    );
    if (!world.arena) validateFix(fix, coin, now);
    else {
      point(fix);
      assert(
        distance(fix, coin) <= 18,
        "Move closer to the coin in the arena.",
      );
    }
    const updated = db
      .prepare(
        "UPDATE coins SET claimant=?,claimed_at=? WHERE id=? AND claimant IS NULL",
      )
      .run(player, now, coinId);
    assert(updated.changes === 1, "This coin has already been collected.", 409);
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
  return atomic(db, () => {
    const q = db
      .prepare(
        "SELECT q.*,w.manifest FROM quests q JOIN worlds w ON w.id=q.world_id WHERE q.id=?",
      )
      .get(questId);
    assert(q, "Quest not found.", 404);
    assert(now >= q.opens_at && now < q.closes_at, "The zone is closed.", 410);
    assert(
      !db
        .prepare("SELECT 1 FROM quest_claims WHERE quest_id=? AND player_id=?")
        .get(q.id, player),
      "You have already completed this quest.",
      409,
    );
    validateQuestEvidence(db, player, q, fix, now, q);
    const meta = JSON.parse(q.metadata || "{}");
    if (q.kind === "route")
      assert(
        (db
          .prepare(
            "SELECT checkpoint FROM quest_progress WHERE quest_id=? AND player_id=?",
          )
          .get(q.id, player)?.checkpoint || 0) >=
          (meta.checkpoints || []).length,
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
    db.prepare("INSERT INTO quest_claims VALUES (?,?,?)").run(
      q.id,
      player,
      now,
    );
    db.prepare("UPDATE players SET gold_u=gold_u+?,xp=xp+? WHERE id=?").run(
      reward,
      q.xp,
      player,
    );
    let item = null;
    if (q.kind === "chest") item = mintAura(db, player, now);
    history(db, player, "quest", q.title, reward, {
      quest: q.id,
      xp: q.xp,
      item: item?.name,
    });
    return { reward, xp: q.xp, item };
  });
}
function validateQuestEvidence(db, player, q, fix, now, target) {
  assert(now >= q.opens_at && now < q.closes_at, "The zone is closed.", 410);
  const positions = db
      .prepare("SELECT * FROM positions WHERE player_id=?")
      .all(player),
    tier = tierFor(positions.reduce((sum, p) => sum + positionTier(p, now), 0));
  assert(
    tier >= q.tier,
    `This adventure requires Tier ${q.tier}.`,
    403,
    "TIER_REQUIRED",
  );
  const world = JSON.parse(q.manifest),
    zone = world.zones.find((z) => z.id === q.zone_id);
  if (!world.arena) validateFix(fix, target, now, 25);
  else {
    point(fix);
    assert(distance(fix, target) <= 25, "Move to the adventure destination.");
  }
  if (zone?.geometry)
    assert(
      contains(zone.geometry, fix),
      "Enter the marked zone before confirming this discovery.",
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
  const progress = atomic(db, () => {
    const q = db
      .prepare(
        "SELECT q.*,w.manifest FROM quests q JOIN worlds w ON w.id=q.world_id WHERE q.id=?",
      )
      .get(questId);
    assert(q?.kind === "route", "Walking expedition not found.", 404);
    assert(
      !db
        .prepare("SELECT 1 FROM quest_claims WHERE quest_id=? AND player_id=?")
        .get(q.id, player),
      "You have already completed this quest.",
      409,
    );
    const checkpoints = JSON.parse(q.metadata).checkpoints,
      current =
        db
          .prepare(
            "SELECT checkpoint FROM quest_progress WHERE quest_id=? AND player_id=?",
          )
          .get(q.id, player)?.checkpoint || 0;
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
    db.prepare(
      "INSERT INTO quest_progress VALUES (?,?,?,?) ON CONFLICT(quest_id,player_id) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at",
    ).run(q.id, player, current + 1, now);
    return { completed: current + 1, total: checkpoints.length };
  });
  if (progress.completed === progress.total)
    return { ...claimQuest(db, player, questId, fix, now), progress };
  return { awaiting: true, progress };
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
    assert(p.gold_u >= value, "Not enough available GOLD.");
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
    assert(p && p.active_u > 0, "Position is not available.");
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
    assert(p && p.active_u > 0, "Position is not available.");
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
    assert(w.ready_at <= now, "Funds are still unlocking.");
    db.prepare("UPDATE withdrawals SET state='paid' WHERE id=?").run(w.id);
    db.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(
      w.amount_u,
      player,
    );
    history(db, player, "withdraw", "Withdrawal completed", w.amount_u);
    return { amount: w.amount_u };
  });
}
export function equip(db, player, itemId) {
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
    db.prepare(
      "UPDATE inventory SET equipped=0 WHERE player_id=? AND slot=?",
    ).run(player, item.slot);
    db.prepare("UPDATE inventory SET equipped=? WHERE id=?").run(
      item.equipped ? 0 : 1,
      item.id,
    );
    db.prepare("UPDATE players SET native_outfit=0 WHERE id=?").run(player);
    return { equipped: !item.equipped };
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
    assert(x && x.state === "open", "The listing is no longer available.", 409);
    assert(x.seller !== player, "You cannot buy your own listing.");
    assert(x.player_id === x.seller, "Ownership has changed.", 409);
    const p = db.prepare("SELECT gold_u FROM players WHERE id=?").get(player);
    assert(p.gold_u >= x.price_u, "Not enough GOLD.");
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

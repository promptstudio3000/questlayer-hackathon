// Nightly QGOLD payouts for map coins and cell zones (docs/DAILY-PAYOUTS.md).
//
// Off until MAP_PAYOUTS=1 (testnet only) and the reward worker key holds the
// payout methods. Then, once per local day after midnight (Europe/Prague):
//   1. every backed map coin and funded cell-zone prize collected before
//      midnight in a GPS world, by a player with a NEAR account, and not yet
//      paid (neither here nor by an older claim_map), becomes a payout item in
//      yoctoNEAR at the backing rate its day was priced at;
//   2. items are summed per account (plus yesterday's carry), the tree is
//      built with server/payouts/payout-tree.mjs and published with
//      publish_payout_day; amounts below one QGOLD unit carry to the next day;
//   3. claim_payout sends the leaves in batches of 10: the contract mints each
//      account's QGOLD in the vault, so players sign nothing;
//   4. close_payout_day returns the unclaimed rest after the grace period.
// Items of players who have no account yet stay unassigned and join the first
// payout after their account exists. Map days (claim_map) are not sent while
// payouts are on, so a coin is never paid twice.
import { atomic } from "../database.mjs";
import { NETWORK } from "../native/network.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import { localDateBounds, shiftDate } from "../spatial/calendar.mjs";
import { mapDayBudget, yoctoPerUnit } from "../map-rewards/budget.mjs";
import { MAP_TIMEZONE, readDay } from "../map-rewards/day-plan.mjs";
import { DEFAULT_QGOLD_RATE_YOCTO } from "../map-rewards/policy.mjs";
import {
  PAYOUT_GRACE_MS,
  buildPayoutDay,
  claimBatches,
  payoutDayId,
} from "./payout-tree.mjs";

export const MAP_PAYOUTS_SCHEMA = registerModuleSchema({
  name: "map-payouts",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS payout_days(day_id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, root TEXT, publish TEXT, total_yocto TEXT NOT NULL, leaves INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','published','closed','empty')), tx TEXT, close_tx TEXT, published_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payout_items(ref TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('coin','zone')), day_id TEXT NOT NULL, player_id TEXT NOT NULL, account_id TEXT NOT NULL, amount_yocto TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payout_claims(day_id TEXT NOT NULL, idx INTEGER NOT NULL, account_id TEXT NOT NULL, amount_yocto TEXT NOT NULL, proof TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','sent','failed')), tx TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, run_after INTEGER NOT NULL, PRIMARY KEY(day_id,idx));
CREATE TABLE IF NOT EXISTS payout_carry(account_id TEXT PRIMARY KEY, amount_yocto TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS payout_items_player ON payout_items(player_id);
CREATE INDEX IF NOT EXISTS payout_claims_state ON payout_claims(state,run_after)`,
});
const ready = new WeakSet();
export function ensurePayoutSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, MAP_PAYOUTS_SCHEMA);
  ready.add(db);
}

export function payoutsEnabled(env = process.env) {
  return env.MAP_PAYOUTS === "1" && NETWORK === "testnet";
}

const localDay = (now) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: MAP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

function has(db, table) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
}

/** yoctoNEAR per micro-QGOLD for a map day: the rate its plan was priced at. */
function dayRate(db, day, cache) {
  if (!cache.has(day)) {
    const rate = readDay(db, day)?.summary?.budget?.rateYocto;
    cache.set(day, yoctoPerUnit(rate || DEFAULT_QGOLD_RATE_YOCTO));
  }
  return cache.get(day);
}

/**
 * Backed rewards collected before `before` and not paid yet, with the
 * collector's NEAR account (rows without one are left for a later payout).
 */
export function unpaidRewards(db, before, { unlinked = false } = {}) {
  ensurePayoutSchema(db);
  const out = [],
    rates = new Map();
  const account = (player) =>
    db
      .prepare(
        "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(player)?.account_id || null;
  const viaMapDays = has(db, "map_chain_claims")
    ? "AND NOT EXISTS(SELECT 1 FROM map_chain_claims q WHERE q.ref=x.id AND q.state!='failed')"
    : "";
  if (has(db, "map_coin_meta"))
    for (const r of db
      .prepare(
        `SELECT x.id,x.value_u,x.claimant,d.day FROM coins x
         JOIN map_coin_meta m ON m.coin_id=x.id
         JOIN map_cell_drops d ON d.world_id=m.world_id AND d.cell=m.cell
         JOIN worlds w ON w.id=x.world_id
         WHERE x.claimant IS NOT NULL AND x.claimed_at<? AND x.value_u>0
           AND COALESCE(json_extract(w.manifest,'$.arena'),0)=0
           AND NOT EXISTS(SELECT 1 FROM payout_items p WHERE p.ref=x.id) ${viaMapDays}
         ORDER BY x.claimed_at,x.id`,
      )
      .all(before)) {
      const acc = account(r.claimant);
      if (!acc && !unlinked) continue;
      out.push({
        kind: "coin",
        ref: r.id,
        player: r.claimant,
        accountId: acc,
        units: BigInt(r.value_u),
        amountYocto: BigInt(r.value_u) * dayRate(db, r.day, rates),
      });
    }
  for (const q of db
    .prepare(
      `SELECT x.id,x.gold_u,x.claimant,w.day FROM quests x JOIN worlds w ON w.id=x.world_id
       WHERE x.claimant IS NOT NULL AND x.claimed_at<? AND x.gold_u>0
         AND json_valid(x.metadata) AND json_extract(x.metadata,'$.cellZone.cell') IS NOT NULL
         AND COALESCE(json_extract(w.manifest,'$.arena'),0)=0
         AND NOT EXISTS(SELECT 1 FROM payout_items p WHERE p.ref=x.id) ${viaMapDays}
       ORDER BY x.claimed_at,x.id`,
    )
    .all(before)) {
    const acc = account(q.claimant);
    if (!acc && !unlinked) continue;
    out.push({
      kind: "zone",
      ref: q.id,
      player: q.claimant,
      accountId: acc,
      units: BigInt(q.gold_u),
      amountYocto: BigInt(q.gold_u) * dayRate(db, q.day, rates),
    });
  }
  return out;
}

/**
 * Builds and stores yesterday's payout day once (local time). Returns the
 * stored day row, or null when it already exists or today is not over.
 */
export function preparePayoutDay(db, now = Date.now()) {
  ensurePayoutSchema(db);
  const date = shiftDate(localDay(now), -1),
    dayId = payoutDayId(date);
  if (db.prepare("SELECT 1 FROM payout_days WHERE date=?").get(date))
    return null;
  const { endsAt } = localDateBounds(date, MAP_TIMEZONE);
  return atomic(db, () => {
    if (db.prepare("SELECT 1 FROM payout_days WHERE date=?").get(date))
      return null;
    const items = unpaidRewards(db, endsAt);
    const carry = db.prepare("SELECT * FROM payout_carry").all();
    const day = buildPayoutDay({
      dayId,
      entries: [
        ...items.map((i) => ({ accountId: i.accountId, amountYocto: i.amountYocto })),
        ...carry.map((c) => ({ accountId: c.account_id, amountYocto: c.amount_yocto })),
      ],
      coinsShareYocto: items
        .filter((i) => i.kind === "coin")
        .reduce((n, i) => n + i.amountYocto, 0n),
    });
    const insertItem = db.prepare(
      "INSERT INTO payout_items VALUES(?,?,?,?,?,?,?)",
    );
    for (const i of items)
      insertItem.run(i.ref, i.kind, dayId, i.player, i.accountId, String(i.amountYocto), now);
    db.prepare("DELETE FROM payout_carry").run();
    const insertCarry = db.prepare("INSERT INTO payout_carry VALUES(?,?,?)");
    for (const c of day.carry)
      insertCarry.run(c.accountId, String(c.amountYocto), now);
    const empty = !day.root;
    db.prepare(
      "INSERT INTO payout_days VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?)",
    ).run(
      dayId,
      date,
      day.root || null,
      empty ? null : JSON.stringify(day.publish),
      String(day.total),
      day.claims.length,
      empty ? "empty" : "pending",
      now,
      now,
    );
    const insertClaim = db.prepare(
      "INSERT INTO payout_claims VALUES(?,?,?,?,?,'queued',NULL,0,NULL,?)",
    );
    for (const c of day.claims)
      insertClaim.run(dayId, c.index, c.account_id, c.amount_yocto, JSON.stringify(c.proof), now);
    return db.prepare("SELECT * FROM payout_days WHERE day_id=?").get(dayId);
  });
}

const message = (error) => String(error?.message || error).slice(0, 300);

/**
 * One worker pass. `call(method, args)` sends a transaction and returns its
 * hash. Returns counts for the log.
 */
export async function runPayoutWorker(db, { call, now = Date.now(), maxBatches = 10 }) {
  ensurePayoutSchema(db);
  const result = { prepared: null, published: 0, sent: 0, failed: 0, closed: 0 };
  result.prepared = preparePayoutDay(db, now)?.day_id || null;
  for (const d of db.prepare("SELECT * FROM payout_days WHERE state='pending'").all()) {
    try {
      const tx = await call("publish_payout_day", JSON.parse(d.publish));
      db.prepare(
        "UPDATE payout_days SET state='published',tx=?,published_at=?,last_error=NULL,updated_at=? WHERE day_id=?",
      ).run(tx, now, now, d.day_id);
      result.published++;
    } catch (error) {
      const text = message(error);
      // A day the contract already has counts as published.
      const done = /Day exists/.test(text);
      db.prepare(
        "UPDATE payout_days SET state=?,published_at=COALESCE(published_at,?),last_error=?,updated_at=? WHERE day_id=?",
      ).run(done ? "published" : "pending", done ? now : null, text, now, d.day_id);
    }
  }
  // Claims of published days, at most 10 leaves per transaction.
  const due = db
    .prepare(
      "SELECT c.* FROM payout_claims c JOIN payout_days d ON d.day_id=c.day_id WHERE d.state='published' AND c.state='queued' AND c.run_after<=? ORDER BY c.day_id,c.idx LIMIT ?",
    )
    .all(now, maxBatches * 10);
  const byDay = new Map();
  for (const c of due) {
    if (!byDay.has(c.day_id)) byDay.set(c.day_id, []);
    byDay.get(c.day_id).push({
      index: c.idx,
      account_id: c.account_id,
      amount_yocto: c.amount_yocto,
      proof: JSON.parse(c.proof),
    });
  }
  for (const [dayId, claims] of byDay)
    for (const batch of claimBatches({ dayId, claims })) {
      const idx = batch.claims.map((c) => c.index);
      const mark = db.prepare(
        `UPDATE payout_claims SET state=?,tx=?,attempts=attempts+1,last_error=?,run_after=? WHERE day_id=? AND idx IN (${idx.map(() => "?").join(",")})`,
      );
      try {
        const tx = await call("claim_payout", batch);
        mark.run("sent", tx, null, now, dayId, ...idx);
        result.sent += idx.length;
      } catch (error) {
        const text = message(error);
        const attempts = db
          .prepare("SELECT MAX(attempts) n FROM payout_claims WHERE day_id=? AND idx=?")
          .get(dayId, idx[0]).n;
        const final = /Day closed|Unknown payout day|Invalid leaf|Invalid proof/i.test(text) || attempts >= 5;
        mark.run(final ? "failed" : "queued", null, text, now + 60_000 * 2 ** Math.min(attempts, 6), dayId, ...idx);
        result.failed += idx.length;
      }
    }
  for (const d of db.prepare("SELECT * FROM payout_days WHERE state='published'").all()) {
    if (now < (d.published_at || now) + PAYOUT_GRACE_MS + 60_000) continue;
    try {
      const tx = await call("close_payout_day", { day_id: d.day_id });
      db.prepare("UPDATE payout_days SET state='closed',close_tx=?,updated_at=? WHERE day_id=?").run(tx, now, d.day_id);
      result.closed++;
    } catch (error) {
      db.prepare("UPDATE payout_days SET last_error=?,updated_at=? WHERE day_id=?").run(message(error), now, d.day_id);
    }
  }
  return result;
}

/**
 * A player's QGOLD not on chain yet: collected and waiting for the nightly
 * payout, or in a published day whose claim is still on its way.
 */
export function pendingPayout(db, player) {
  ensurePayoutSchema(db);
  const waiting = unpaidRewards(db, Number.MAX_SAFE_INTEGER, { unlinked: true }).filter(
    (i) => i.player === player,
  );
  const linked = waiting.filter((i) => i.accountId);
  const queued = db
    .prepare(
      "SELECT i.amount_yocto FROM payout_items i JOIN payout_claims c ON c.day_id=i.day_id AND c.account_id=i.account_id WHERE i.player_id=? AND c.state='queued'",
    )
    .all(player);
  const queuedYocto = queued.reduce((n, r) => n + BigInt(r.amount_yocto), 0n);
  const yocto = linked.reduce((n, i) => n + i.amountYocto, 0n) + queuedYocto;
  // micro-QGOLD: exact for rewards not built into a payout day yet, at the
  // current backing rate for the ones already queued on chain.
  const perUnit = yoctoPerUnit(mapDayBudget(db).rateYocto);
  const units =
    waiting.reduce((n, i) => n + i.units, 0n) + (perUnit > 0n ? queuedYocto / perUnit : 0n);
  const accountId =
    db
      .prepare("SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY rowid DESC LIMIT 1")
      .get(player)?.account_id || null;
  return {
    accountId,
    yocto: String(yocto),
    units: Number(units),
    items: waiting.length + queued.length,
    // Collected before the player had a NEAR account: paid once they have one.
    awaitingAccount: waiting.length - linked.length,
  };
}

/** Public status of the last payout days. */
export function payoutStatus(db, limit = 7) {
  try {
    ensurePayoutSchema(db);
    return db
      .prepare(
        "SELECT d.day_id dayId,d.date,d.state,d.leaves,d.total_yocto totalYocto,d.tx,d.close_tx closeTx,(SELECT COUNT(*) FROM payout_claims c WHERE c.day_id=d.day_id AND c.state='sent') sent FROM payout_days d ORDER BY d.date DESC LIMIT ?",
      )
      .all(limit);
  } catch {
    return [];
  }
}

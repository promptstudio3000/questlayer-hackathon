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
//   3. claim_payout sends the leaves in batches of PAYOUT_MAX_BATCH (8): the contract mints each
//      account's QGOLD in the vault, so players sign nothing;
//   4. reconcile finalized per-leaf mint status; close only fully paid days.
// Items of players who have no account yet stay unassigned and join the first
// payout after their account exists. Map days (claim_map) are not sent while
// payouts are on, so a coin is never paid twice.
import { atomic } from "../database.mjs";
import { randomUUID } from "node:crypto";
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
  PAYOUT_MAX_BATCH,
  buildPayoutDay,
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
// Additive bookkeeping: submission is not payment. Existing claim identities
// and schema stay intact; only an authoritative finalized mint creates a receipt.
export const PAYOUT_SETTLEMENT_SCHEMA = registerModuleSchema({
  name: "payout-settlement",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS payout_confirmations(day_id TEXT NOT NULL,idx INTEGER NOT NULL,confirmed_at INTEGER NOT NULL,PRIMARY KEY(day_id,idx));
CREATE TABLE IF NOT EXISTS payout_worker_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,until_ms INTEGER NOT NULL DEFAULT 0)`,
});
const ready = new WeakSet();
export function ensurePayoutSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, MAP_PAYOUTS_SCHEMA);
  ensureModuleVersion(db, PAYOUT_SETTLEMENT_SCHEMA);
  db.prepare("INSERT OR IGNORE INTO payout_worker_lease(id) VALUES(1)").run();
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
export function preparePayoutDay(
  db,
  now = Date.now(),
  { assertOwned = () => {} } = {},
) {
  ensurePayoutSchema(db);
  const date = shiftDate(localDay(now), -1),
    dayId = payoutDayId(date);
  if (db.prepare("SELECT 1 FROM payout_days WHERE date=?").get(date))
    return null;
  const { endsAt } = localDateBounds(date, MAP_TIMEZONE);
  return atomic(db, () => {
    assertOwned();
    if (db.prepare("SELECT 1 FROM payout_days WHERE date=?").get(date))
      return null;
    const items = unpaidRewards(db, endsAt);
    const carry = db.prepare("SELECT * FROM payout_carry").all();
    const carriedItems = db
      .prepare(
        `SELECT i.* FROM payout_items i WHERE NOT EXISTS(
      SELECT 1 FROM payout_claims c WHERE c.day_id=i.day_id AND c.account_id=i.account_id)`,
      )
      .all();
    const day = buildPayoutDay({
      dayId,
      entries: [
        ...items.map((i) => ({
          accountId: i.accountId,
          amountYocto: i.amountYocto,
        })),
        ...carry.map((c) => ({
          accountId: c.account_id,
          amountYocto: c.amount_yocto,
        })),
      ],
      coinsShareYocto:
        items
          .filter((i) => i.kind === "coin")
          .reduce((n, i) => n + i.amountYocto, 0n) +
        carriedItems
          .filter((i) => i.kind === "coin")
          .reduce((n, i) => n + BigInt(i.amount_yocto), 0n),
    });
    // Keep each original player/item attached to the eventual leaf, including
    // dust carried across empty days. A carry is never a second earned item.
    const moveCarry = db.prepare(
      "UPDATE payout_items SET day_id=? WHERE ref=?",
    );
    for (const item of carriedItems) moveCarry.run(dayId, item.ref);
    const insertItem = db.prepare(
      "INSERT INTO payout_items VALUES(?,?,?,?,?,?,?)",
    );
    for (const i of items)
      insertItem.run(
        i.ref,
        i.kind,
        dayId,
        i.player,
        i.accountId,
        String(i.amountYocto),
        now,
      );
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
      insertClaim.run(
        dayId,
        c.index,
        c.account_id,
        c.amount_yocto,
        JSON.stringify(c.proof),
        now,
      );
    return db.prepare("SELECT * FROM payout_days WHERE day_id=?").get(dayId);
  });
}

const message = (error) => String(error?.message || error).slice(0, 300);

/** Exact immutable agreement, never an error-message shortcut. */
function publicationMatches(day, expected) {
  return (
    day &&
    day.root === expected.root &&
    day.leaves === expected.leaves &&
    day.coins_reserved === expected.coins_yocto &&
    day.zones_reserved === expected.zones_yocto &&
    Number.isSafeInteger(day.published_at) &&
    day.published_at > 0 &&
    typeof day.closed === "boolean"
  );
}

function validProgress(progress, expected, length) {
  return (
    progress &&
    progress.root === expected.root &&
    progress.leaves === expected.leaves &&
    typeof progress.closed === "boolean" &&
    Number.isSafeInteger(progress.paid_leaves) &&
    progress.paid_leaves >= 0 &&
    Number.isSafeInteger(progress.pending_leaves) &&
    progress.pending_leaves >= 0 &&
    progress.paid_leaves + progress.pending_leaves <= expected.leaves &&
    Array.isArray(progress.statuses) &&
    progress.statuses.length === length &&
    progress.statuses.every((s) =>
      ["unclaimed", "pending", "paid"].includes(s),
    ) &&
    progress.statuses.filter((s) => s === "paid").length <=
      progress.paid_leaves &&
    progress.statuses.filter((s) => s === "pending").length <=
      progress.pending_leaves &&
    (!progress.closed ||
      (progress.paid_leaves === expected.leaves &&
        progress.pending_leaves === 0 &&
        progress.statuses.every((s) => s === "paid")))
  );
}

const LEASE_MS = 120_000;
const POLL_MS = 30_000;
const retryDelay = (attempts) =>
  Math.min(15 * 60_000, 60_000 * 2 ** Math.min(attempts, 4));

/**
 * Views must be fresh FINAL reads of the configured, verified rewards contract.
 * A call/hash is only a submission. The contract's immutable leaf identity makes
 * an unknown-outcome resubmission safe even if the first receipt arrives late.
 */
export async function runPayoutWorker(
  db,
  {
    call,
    view,
    now = Date.now(),
    clock = Date.now,
    maxBatches = 10,
    maxChecks = 1024,
  },
) {
  ensurePayoutSchema(db);
  if (typeof view !== "function")
    throw Error("Payout reconciliation requires finalized contract views");
  if (
    !Number.isSafeInteger(maxBatches) ||
    maxBatches < 0 ||
    maxBatches > 100 ||
    !Number.isSafeInteger(maxChecks) ||
    maxChecks < 1 ||
    maxChecks > 1024
  )
    throw Error("Invalid payout work limit");
  const owner = randomUUID();
  const acquired =
    db
      .prepare(
        "UPDATE payout_worker_lease SET owner=?,until_ms=? WHERE id=1 AND until_ms<=?",
      )
      .run(owner, clock() + LEASE_MS, clock()).changes === 1;
  if (!acquired) return { busy: true };
  const fence = () => {
    const t = clock();
    if (
      db
        .prepare(
          "UPDATE payout_worker_lease SET until_ms=? WHERE id=1 AND owner=? AND until_ms>?",
        )
        .run(t + LEASE_MS, owner, t).changes !== 1
    )
      throw Error("Payout worker lease expired");
  };
  const write = (fn) =>
    atomic(db, () => {
      fence();
      return fn();
    });
  const read = async (method, args) => {
    fence();
    const value = await view(method, args);
    fence();
    return value;
  };
  const send = async (method, args) => {
    fence();
    const value = await call(method, args);
    fence();
    return value;
  };
  const result = {
    prepared: null,
    published: 0,
    sent: 0,
    paid: 0,
    failed: 0,
    closed: 0,
  };
  let batchesLeft = maxBatches,
    checksLeft = maxChecks;
  try {
    const config = await read("get_payout_config", {});
    if (config?.settlement_status !== true)
      throw Error(
        "Payout contract does not expose finalized settlement status",
      );
    result.prepared =
      preparePayoutDay(db, now, { assertOwned: fence })?.day_id || null;
    const days = db
      .prepare(
        `SELECT d.* FROM payout_days d WHERE d.state IN ('pending','published') OR
      (d.state='closed' AND EXISTS(SELECT 1 FROM payout_claims c WHERE c.day_id=d.day_id AND
       NOT EXISTS(SELECT 1 FROM payout_confirmations p WHERE p.day_id=c.day_id AND p.idx=c.idx)))
      ORDER BY d.updated_at,d.date`,
      )
      .all();
    for (const d of days) {
      if (checksLeft === 0) break;
      try {
        const expected = JSON.parse(d.publish);
        let onChain = await read("get_payout_day", { day_id: d.day_id });
        if (!onChain && d.state === "pending") {
          // Publication itself is idempotent by day id. A lost response is
          // recovered from the exact commitment, not from a "Day exists" string.
          try {
            const tx = await send("publish_payout_day", expected);
            write(() =>
              db
                .prepare("UPDATE payout_days SET tx=? WHERE day_id=?")
                .run(tx, d.day_id),
            );
          } catch (error) {
            write(() =>
              db
                .prepare(
                  "UPDATE payout_days SET last_error=?,updated_at=? WHERE day_id=?",
                )
                .run(message(error), now, d.day_id),
            );
          }
          onChain = await read("get_payout_day", { day_id: d.day_id });
          if (!onChain) continue;
        }
        if (!publicationMatches(onChain, expected))
          throw Error("Payout day commitment mismatch or unavailable");
        const rows = db
          .prepare(
            `SELECT c.* FROM payout_claims c WHERE c.day_id=? AND (c.state='sent' OR c.run_after<=?) AND
          NOT EXISTS(SELECT 1 FROM payout_confirmations p WHERE p.day_id=c.day_id AND p.idx=c.idx)
          ORDER BY c.run_after,c.idx LIMIT ?`,
          )
          .all(d.day_id, now, checksLeft);
        const progress = await read("get_payout_progress", {
          day_id: d.day_id,
          indexes: rows.map((c) => c.idx),
        });
        if (!validProgress(progress, expected, rows.length))
          throw Error("Payout settlement status unavailable or invalid");
        checksLeft -= rows.length;
        write(() =>
          db
            .prepare(
              "UPDATE payout_days SET state=?,published_at=?,last_error=NULL,updated_at=? WHERE day_id=?",
            )
            .run(
              progress.closed ? "closed" : "published",
              onChain.published_at,
              now,
              d.day_id,
            ),
        );
        if (d.state === "pending") result.published++;
        const retry = [];
        write(() => {
          for (let i = 0; i < rows.length; i++) {
            const c = rows[i],
              state = progress.statuses[i];
            if (state === "paid") {
              result.paid += db
                .prepare(
                  "INSERT OR IGNORE INTO payout_confirmations VALUES(?,?,?)",
                )
                .run(d.day_id, c.idx, now).changes;
              db.prepare(
                "UPDATE payout_claims SET state='sent',last_error=NULL WHERE day_id=? AND idx=?",
              ).run(d.day_id, c.idx);
            } else if (state === "pending") {
              db.prepare(
                "UPDATE payout_claims SET state='sent',run_after=? WHERE day_id=? AND idx=?",
              ).run(now + POLL_MS, d.day_id, c.idx);
            } else if (!progress.closed && c.run_after <= now) retry.push(c);
          }
        });
        if (progress.closed) {
          if (progress.paid_leaves !== d.leaves)
            throw Error("Closed payout day has unresolved obligations");
          if (d.state !== "closed") result.closed++;
          continue;
        }
        for (
          let offset = 0;
          offset < retry.length && batchesLeft > 0;
          offset += PAYOUT_MAX_BATCH
        ) {
          const rowsToSend = retry.slice(offset, offset + PAYOUT_MAX_BATCH);
          const batch = {
            day_id: d.day_id,
            claims: rowsToSend.map((c) => ({
              index: c.idx,
              account_id: c.account_id,
              amount_yocto: c.amount_yocto,
              proof: JSON.parse(c.proof),
            })),
          };
          // Persist intent before the network call. Every outcome, even a
          // thrown timeout or a process crash, must be reconciled on restart.
          write(() => {
            for (const c of rowsToSend)
              db.prepare(
                `UPDATE payout_claims SET state='sent',
              attempts=attempts+1,run_after=?,last_error=NULL WHERE day_id=? AND idx=?`,
              ).run(now + retryDelay(c.attempts), d.day_id, c.idx);
          });
          batchesLeft--;
          try {
            const tx = await send("claim_payout", batch);
            write(() => {
              for (const c of rowsToSend)
                db.prepare(
                  "UPDATE payout_claims SET tx=? WHERE day_id=? AND idx=?",
                ).run(tx, d.day_id, c.idx);
            });
            result.sent += rowsToSend.length;
          } catch (error) {
            write(() => {
              for (const c of rowsToSend)
                db.prepare(
                  "UPDATE payout_claims SET last_error=? WHERE day_id=? AND idx=?",
                ).run(message(error), d.day_id, c.idx);
            });
            result.failed += rowsToSend.length;
          }
        }
        // A grace period is a minimum age, never an expiry of earned rights.
        if (
          progress.paid_leaves === d.leaves &&
          progress.pending_leaves === 0 &&
          now >= onChain.published_at + PAYOUT_GRACE_MS
        ) {
          const tx = await send("close_payout_day", { day_id: d.day_id });
          write(() =>
            db
              .prepare("UPDATE payout_days SET close_tx=? WHERE day_id=?")
              .run(tx, d.day_id),
          );
          const closed = await read("get_payout_day", { day_id: d.day_id });
          if (!publicationMatches(closed, expected) || !closed.closed)
            throw Error("Payout closure not finalized");
          write(() =>
            db
              .prepare(
                "UPDATE payout_days SET state='closed',updated_at=? WHERE day_id=?",
              )
              .run(now, d.day_id),
          );
          result.closed++;
        }
      } catch (error) {
        // This write is fenced too: an expired owner may neither acknowledge
        // a payment nor overwrite its successor's error or confirmation.
        write(() =>
          db
            .prepare(
              "UPDATE payout_days SET last_error=?,updated_at=? WHERE day_id=?",
            )
            .run(message(error), now, d.day_id),
        );
      }
    }
    return result;
  } finally {
    db.prepare(
      "UPDATE payout_worker_lease SET owner=NULL,until_ms=0 WHERE id=1 AND owner=?",
    ).run(owner);
  }
}

/**
 * A player's QGOLD not on chain yet: collected and waiting for the nightly
 * payout, or in a published day whose claim is still on its way.
 */
export function pendingPayout(db, player) {
  ensurePayoutSchema(db);
  const waiting = unpaidRewards(db, Number.MAX_SAFE_INTEGER, {
    unlinked: true,
  }).filter((i) => i.player === player);
  const linked = waiting.filter((i) => i.accountId);
  const queued = db
    .prepare(
      "SELECT i.amount_yocto FROM payout_items i LEFT JOIN payout_claims c ON c.day_id=i.day_id AND c.account_id=i.account_id LEFT JOIN payout_confirmations p ON p.day_id=c.day_id AND p.idx=c.idx WHERE i.player_id=? AND p.idx IS NULL",
    )
    .all(player);
  const queuedYocto = queued.reduce((n, r) => n + BigInt(r.amount_yocto), 0n);
  const yocto = linked.reduce((n, i) => n + i.amountYocto, 0n) + queuedYocto;
  // micro-QGOLD: exact for rewards not built into a payout day yet, at the
  // current backing rate for the ones already queued on chain.
  const perUnit = yoctoPerUnit(mapDayBudget(db).rateYocto);
  const units =
    waiting.reduce((n, i) => n + i.units, 0n) +
    (perUnit > 0n ? queuedYocto / perUnit : 0n);
  const accountId =
    db
      .prepare(
        "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY rowid DESC LIMIT 1",
      )
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
        "SELECT d.day_id dayId,d.date,d.state,d.leaves,d.total_yocto totalYocto,d.tx,d.close_tx closeTx,(SELECT COUNT(*) FROM payout_confirmations c WHERE c.day_id=d.day_id) sent FROM payout_days d ORDER BY d.date DESC LIMIT ?",
      )
      .all(limit);
  } catch {
    return [];
  }
}

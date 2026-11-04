// Map days on chain (docs/MAP-REWARDS.md §5, contracts/rewards map_days.rs).
//
// Off until MAP_CHAIN=1, the rewards upgrade (PR #181) is deployed and the
// reward worker key also allows publish_map_day, claim_map and close_map_day.
//
// The worker, once per tick:
//   1. publishes today's map day: the stored Merkle root and the day's coin
//      budget (incl. the pioneer reserve) and zone budget, priced in NEAR by
//      one yocto-per-GOLD-unit rate that keeps the day under the per-date cap;
//   2. turns map coins and funded cell zones that players with a linked NEAR
//      wallet collected in GPS worlds into attested claims (leaf fields +
//      Merkle proof + coin index + value), at most MAP_CHAIN_DAILY_CLAIMS a day
//      (the contract keeps 256 receipt slots per day id);
//   3. sends the queued claims, then closes days whose grace period passed.
// The demo arena never goes on chain: its coins are practice only.
import { createHash } from "node:crypto";
import { atomic } from "../database.mjs";
import { assert, hash } from "../domain.mjs";
import { NETWORK } from "../native/network.mjs";
import { localDateBounds } from "../spatial/calendar.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import {
  MAP_TIMEZONE,
  cellProof,
  cellSeed,
  readCell,
  readDay,
} from "./day-plan.mjs";
import { MAP_REWARDS_POLICY } from "./policy.mjs";

export const MAP_DAY_VERSION = 1;
export const MAP_CHAIN_METHODS = Object.freeze([
  "publish_map_day",
  "claim_map",
  "close_map_day",
]);
// Contract bounds (map_days.rs).
export const MAP_MAX_COIN_U = 2_000_000;
export const MAP_MAX_COINS_PER_CELL = 1024;
export const MAP_RECEIPT_SLOTS = 256;
export const MAP_CHAIN_DAILY_CLAIMS = 240; // a margin under the 256 slots
// Per-date cap on testnet: 0.1 NEAR coins, 0.1 NEAR zones (shared with city days).
export const MAP_COIN_CAP_YOCTO = 10n ** 23n / 2n;
export const MAP_ZONE_CAP_YOCTO = 10n ** 23n / 2n;
const MAX_RATE = 10n ** 18n; // 1 GOLD unit = at most 1e-6 NEAR
const DAY_MS = 86_400_000;

export const MAP_CHAIN_SCHEMA = registerModuleSchema({
  name: "map-rewards-chain",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS map_chain_days(day_id TEXT PRIMARY KEY, day TEXT NOT NULL UNIQUE, args TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','published','closed','failed')), tx TEXT, close_tx TEXT, last_error TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS map_chain_claims(receipt_id TEXT PRIMARY KEY, day_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('coin','zone')), ref TEXT NOT NULL UNIQUE, player_id TEXT NOT NULL, account_id TEXT NOT NULL, body TEXT NOT NULL, signature TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','sent','failed')), tx TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, run_after INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS map_chain_claims_state ON map_chain_claims(state,run_after)`,
});
const ready = new WeakSet();
export function ensureMapChainSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, MAP_CHAIN_SCHEMA);
  ready.add(db);
}

// Testnet only: the contract's map_claim_message is fixed to testnet and
// mainnet needs Lubos's explicit go.
export function mapChainEnabled(env = process.env) {
  return env.MAP_CHAIN === "1" && NETWORK === "testnet";
}

export const mapDayId = (day, version = MAP_DAY_VERSION) =>
  `map-${day}-v${version}`;

/**
 * Arguments of publish_map_day for a stored plan. One rate turns GOLD units
 * into yoctoNEAR so that neither bucket exceeds its per-date cap.
 */
export function publishArgs(
  plan,
  { coinCap = MAP_COIN_CAP_YOCTO, zoneCap = MAP_ZONE_CAP_YOCTO } = {},
) {
  assert(plan?.root, "The map day has no funded cell.", 409);
  const coinsU = BigInt(plan.coinsU + plan.pioneerU),
    zonesU = BigInt(plan.zonesU);
  let rate = MAX_RATE;
  if (coinsU > 0n && coinCap / coinsU < rate) rate = coinCap / coinsU;
  if (zonesU > 0n && zoneCap / zonesU < rate) rate = zoneCap / zonesU;
  assert(rate > 0n, "The map day is too large for the per-date cap.", 409);
  const { startsAt, endsAt } = localDateBounds(plan.day, MAP_TIMEZONE);
  return {
    day_id: mapDayId(plan.day),
    policy: plan.policy || MAP_REWARDS_POLICY,
    root: plan.root,
    starts_at: String(startsAt),
    ends_at: String(endsAt),
    coins_u: coinsU.toString(),
    zones_u: zonesU.toString(),
    yocto_per_u: rate.toString(),
  };
}

/** Same text as the contract's map_claim_message. */
export function mapClaimMessage(contractId, c, network = NETWORK) {
  return [
    "QuestLayer map reward v1",
    `Network: ${network}`,
    `Contract: ${contractId}`,
    `Receipt: ${c.receipt_id}`,
    `Day: ${c.day_id}`,
    `Kind: ${c.kind}`,
    `Cell: ${c.cell}`,
    `Index: ${c.index}`,
    `Value: ${c.value_u}`,
    `Receiver: ${c.receiver_id}`,
    `Received: ${c.received_at}`,
    `Evidence: ${c.evidence_hash}`,
  ].join("\n");
}

/**
 * Index of a coin within its cell's leaf for the day (0-based). Several worlds
 * (GPS street world, city world) can open the same cell on one day; the leaf
 * is one, so the index runs over every drop of that day in drop order.
 */
export function coinIndexInCell(db, coinId) {
  const meta = db
    .prepare(
      "SELECT m.world_id,m.cell,d.day FROM map_coin_meta m JOIN map_cell_drops d ON d.world_id=m.world_id AND d.cell=m.cell WHERE m.coin_id=?",
    )
    .get(coinId);
  if (!meta) return null;
  const n = (s) => Number(String(s).split(":coin:")[1]);
  const ids = db
    .prepare(
      "SELECT m.coin_id,d.created_at,d.world_id FROM map_coin_meta m JOIN map_cell_drops d ON d.world_id=m.world_id AND d.cell=m.cell WHERE d.day=? AND m.cell=?",
    )
    .all(meta.day, meta.cell)
    .sort(
      (a, b) =>
        a.created_at - b.created_at ||
        (a.world_id < b.world_id ? -1 : a.world_id > b.world_id ? 1 : 0) ||
        n(a.coin_id) - n(b.coin_id),
    )
    .map((r) => r.coin_id);
  return { ...meta, index: ids.indexOf(coinId) };
}

/**
 * The claim body (without signature) for one collected map coin or zone
 * prize. `ref` is the coin id or the quest id.
 */
export function buildMapClaim(
  db,
  { kind, ref, day, cell, index, valueU, accountId, receivedAt },
) {
  const plan = readDay(db, day),
    leaf = plan && readCell(db, day, cell),
    proof = leaf && cellProof(db, day, cell);
  assert(plan && leaf && proof, "This cell has no leaf in the day's root.", 409);
  assert(
    Number.isInteger(index) && index >= 0 && index < (kind === "coin" ? MAP_MAX_COINS_PER_CELL : leaf.zones),
    "Invalid map claim index.",
    409,
  );
  assert(
    valueU > 0 && (kind !== "coin" || valueU <= MAP_MAX_COIN_U),
    "Invalid map claim value.",
    409,
  );
  const receiptId = `map-${createHash("sha256").update(`${kind}|${ref}`).digest("hex").slice(0, 40)}`;
  return {
    receipt_id: receiptId,
    day_id: mapDayId(day),
    kind,
    cell,
    coins_u: String(leaf.coinsU),
    zones_u: String(leaf.zonesU),
    zones: leaf.zones,
    pioneer: leaf.pioneer,
    seed: cellSeed(plan.seed, cell),
    proof: proof.proof,
    index,
    value_u: String(valueU),
    receiver_id: accountId,
    received_at: String(receivedAt),
    evidence_hash: hash(
      JSON.stringify({ policy: plan.policy, kind, ref, cell, accountId, at: receivedAt }),
    ),
  };
}

/** Collected map rewards of a day that can go on chain (GPS worlds, linked wallet). */
function collected(db, day) {
  const wallet = (player) =>
    db
      .prepare(
        "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(player)?.account_id || null;
  const out = [],
    zoneIndex = {};
  for (const r of db
    .prepare(
      `SELECT c.id,c.value_u,c.claimant,c.claimed_at,m.cell FROM coins c
       JOIN map_coin_meta m ON m.coin_id=c.id
       JOIN map_cell_drops d ON d.world_id=m.world_id AND d.cell=m.cell
       JOIN worlds w ON w.id=c.world_id
       WHERE d.day=? AND c.claimant IS NOT NULL AND COALESCE(json_extract(w.manifest,'$.arena'),0)=0
         AND NOT EXISTS(SELECT 1 FROM map_chain_claims q WHERE q.ref=c.id)
       ORDER BY c.claimed_at,c.id`,
    )
    .all(day)) {
    const account = wallet(r.claimant);
    if (!account) continue;
    const at = coinIndexInCell(db, r.id);
    out.push({ kind: "coin", ref: r.id, player: r.claimant, accountId: account, cell: r.cell, index: at.index, valueU: r.value_u, receivedAt: r.claimed_at });
  }
  for (const q of db
    .prepare(
      `SELECT q.id,q.gold_u,q.claimant,q.claimed_at,q.metadata FROM quests q JOIN worlds w ON w.id=q.world_id
       WHERE q.claimant IS NOT NULL AND q.gold_u>0 AND json_valid(q.metadata) AND json_extract(q.metadata,'$.cellZone.cell') IS NOT NULL
         AND COALESCE(json_extract(w.manifest,'$.arena'),0)=0 AND w.day=?
         AND NOT EXISTS(SELECT 1 FROM map_chain_claims c WHERE c.ref=q.id)
       ORDER BY q.claimed_at,q.id`,
    )
    .all(day)) {
    const account = wallet(q.claimant);
    if (!account) continue;
    const cell = JSON.parse(q.metadata).cellZone.cell;
    // Zone indexes are handed out in finishing order per cell.
    zoneIndex[cell] ??= db
      .prepare("SELECT COUNT(*) n FROM map_chain_claims WHERE day_id=? AND kind='zone' AND json_extract(body,'$.cell')=?")
      .get(mapDayId(day), cell).n;
    out.push({ kind: "zone", ref: q.id, player: q.claimant, accountId: account, cell, index: zoneIndex[cell]++, valueU: q.gold_u, receivedAt: q.claimed_at });
  }
  return out.sort((a, b) => a.receivedAt - b.receivedAt);
}

/** Sign and queue today's collected map rewards, within the daily slot budget. */
export function queueMapClaims(db, { signer, contractId, day, now = Date.now() }) {
  ensureMapChainSchema(db);
  const dayId = mapDayId(day);
  let queued = db
    .prepare("SELECT COUNT(*) n FROM map_chain_claims WHERE day_id=?")
    .get(dayId).n;
  let added = 0;
  for (const c of collected(db, day)) {
    if (queued >= MAP_CHAIN_DAILY_CLAIMS) break;
    let body;
    try {
      body = buildMapClaim(db, { ...c, day });
    } catch {
      continue; // a cell outside the plan (e.g. abroad) stays practice
    }
    const signature = signer.sign(mapClaimMessage(contractId, body));
    db.prepare(
      "INSERT OR IGNORE INTO map_chain_claims VALUES(?,?,?,?,?,?,?,?,'queued',NULL,0,NULL,?,?)",
    ).run(body.receipt_id, dayId, c.kind, c.ref, c.player, c.accountId, JSON.stringify(body), signature, now, now);
    queued++;
    added++;
  }
  return added;
}

/**
 * One worker pass. `call(method, args)` sends a transaction and returns its
 * hash; `signer.sign(text)` returns the attestor's base64 signature.
 */
export async function runMapChainWorker(
  db,
  { call, signer, contractId, now = Date.now(), maxClaims = 20 },
) {
  ensureMapChainSchema(db);
  const result = { published: null, queued: 0, sent: 0, closed: 0, failed: 0 };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: MAP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const plan = readDay(db, today);
  if (plan?.root) {
    const dayId = mapDayId(today);
    let row = db.prepare("SELECT * FROM map_chain_days WHERE day_id=?").get(dayId);
    if (!row) {
      db.prepare("INSERT OR IGNORE INTO map_chain_days VALUES(?,?,?,'pending',NULL,NULL,NULL,?)").run(
        dayId,
        today,
        JSON.stringify(publishArgs(plan)),
        now,
      );
      row = db.prepare("SELECT * FROM map_chain_days WHERE day_id=?").get(dayId);
    }
    if (row.state === "pending") {
      try {
        const tx = await call("publish_map_day", JSON.parse(row.args));
        db.prepare("UPDATE map_chain_days SET state='published',tx=?,last_error=NULL,updated_at=? WHERE day_id=?").run(tx, now, dayId);
        result.published = tx;
      } catch (error) {
        const message = String(error?.message || error).slice(0, 300);
        // A day the contract already has counts as published.
        const state = /Day exists/.test(message) ? "published" : "pending";
        db.prepare("UPDATE map_chain_days SET state=?,last_error=?,updated_at=? WHERE day_id=?").run(state, message, now, dayId);
      }
    }
    if (db.prepare("SELECT state FROM map_chain_days WHERE day_id=?").get(dayId).state === "published")
      result.queued = atomic(db, () => queueMapClaims(db, { signer, contractId, day: today, now }));
  }
  const due = db
    .prepare(
      "SELECT q.* FROM map_chain_claims q JOIN map_chain_days d ON d.day_id=q.day_id WHERE q.state='queued' AND q.run_after<=? AND d.state IN ('published','closed') ORDER BY q.created_at LIMIT ?",
    )
    .all(now, maxClaims);
  for (const q of due) {
    try {
      const tx = await call("claim_map", { claim: JSON.parse(q.body), signature: q.signature });
      db.prepare("UPDATE map_chain_claims SET state='sent',tx=?,attempts=attempts+1,last_error=NULL WHERE receipt_id=?").run(tx, q.receipt_id);
      result.sent++;
    } catch (error) {
      const message = String(error?.message || error).slice(0, 300);
      // Budget, slot and duplicate refusals are final; anything else retries.
      const final = /already claimed|budget spent|capacity reached|Day closed|not in the day's root|Invalid/i.test(message);
      db.prepare(
        "UPDATE map_chain_claims SET state=?,attempts=attempts+1,last_error=?,run_after=? WHERE receipt_id=?",
      ).run(final || q.attempts >= 5 ? "failed" : "queued", message, now + 60_000 * 2 ** Math.min(q.attempts, 6), q.receipt_id);
      result.failed++;
    }
  }
  for (const d of db.prepare("SELECT * FROM map_chain_days WHERE state='published'").all()) {
    const args = JSON.parse(d.args);
    if (now < Number(args.ends_at) + DAY_MS + 60_000) continue;
    try {
      const tx = await call("close_map_day", { day_id: d.day_id });
      db.prepare("UPDATE map_chain_days SET state='closed',close_tx=?,updated_at=? WHERE day_id=?").run(tx, now, d.day_id);
      result.closed++;
    } catch (error) {
      db.prepare("UPDATE map_chain_days SET last_error=?,updated_at=? WHERE day_id=?").run(String(error?.message || error).slice(0, 300), now, d.day_id);
    }
  }
  return result;
}

/** Public status for /api/map/rewards/day. */
export function mapChainStatus(db, day) {
  try {
    const row = db.prepare("SELECT day_id,state,tx,close_tx,last_error FROM map_chain_days WHERE day=?").get(day);
    const claims = db
      .prepare("SELECT state,COUNT(*) n FROM map_chain_claims WHERE day_id=? GROUP BY state")
      .all(mapDayId(day));
    return row
      ? { dayId: row.day_id, state: row.state, tx: row.tx, closeTx: row.close_tx, claims: Object.fromEntries(claims.map((c) => [c.state, c.n])) }
      : null;
  } catch {
    return null;
  }
}

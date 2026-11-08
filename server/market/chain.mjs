// QGOLD escrow bridge for the task market, Secrets and conditional sends
// (contracts/qgold-escrow, docs/QGOLD-ESCROW.md, docs/TASK-MARKET.md).
//
// Every GOLD amount in the market is real QGOLD (6 decimals = micro-GOLD):
// - The poster, buyer or sender funds an agreement with ONE sponsored
//   `ft_transfer_call` from their own NEAR account to the escrow. The market
//   row waits in `funding` until the escrow view shows the agreement with the
//   exact persisted terms and a verified lifecycle (`checkFunding`).
// - Every payout or refund is an escrow call by the game server's publisher
//   key (approve_task, confirm_visit, cancel_task, ...). The service enqueues
//   them in `mk_chain_ops` inside the same database transaction that changes
//   the market rows; `runEscrowWorker` sends them in order.
// - After a payout the worker pushes the recipient's escrow credit to their
//   account with `withdraw_for` (the escrow registers it on the token first).
// Nothing here touches players.gold_u: that is pending map credit, not money.
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { assert, id } from "../domain.mjs";
import { atomic } from "../database.mjs";
import { fundingAssessment } from "./funding.mjs";
import { ensureEscrowDeliverySchema, runEscrowDelivery } from "./delivery.mjs";
import { escrowDeliveryTransport } from "./delivery-transport.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";

export const FUNDING_GAS = "200000000000000"; // ft_transfer_call → ft_on_transfer
export const FUNDING_WAIT_MS = 2 * 3_600_000; // unfunded rows are dropped after this
export const PUBLISHER_METHODS = Object.freeze([
  "approve_task",
  "cancel_task",
  "open_dispute",
  "resolve_dispute",
  "confirm_visit",
  "release_secret",
  "dispute_secret",
  "resolve_secret",
  "confirm_transfer",
  "release_transfer",
  "confirm_transfer_gps",
  "refund_transfer",
  "decline_transfer",
  "withdraw_for",
]);

export const MARKET_CHAIN_SCHEMA = registerModuleSchema({
  name: "task-market-chain",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS mk_fundings(id TEXT PRIMARY KEY,target TEXT NOT NULL CHECK(target IN ('task','offer','sponsor','reveal','transfer')),ref TEXT NOT NULL,player TEXT NOT NULL,account TEXT NOT NULL,amount_u INTEGER NOT NULL CHECK(amount_u>0),msg TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('waiting','funded','dropped')),checked_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mk_fundings_wait ON mk_fundings(state,created_at);
CREATE TABLE IF NOT EXISTS mk_chain_ops(id TEXT PRIMARY KEY,seq INTEGER NOT NULL,escrow_id TEXT,method TEXT NOT NULL,args TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('queued','sent','failed')),tx TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,run_after INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mk_chain_ops_due ON mk_chain_ops(state,seq);
CREATE TABLE IF NOT EXISTS mk_chain_holds(escrow_id TEXT NOT NULL,account TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(escrow_id,account))`,
});
const ready = new WeakSet();
export function ensureMarketChainSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, MARKET_CHAIN_SCHEMA);
  ensureEscrowDeliverySchema(db);
  ready.add(db);
}

// ------------------------------------------------------------ configuration
let configured = null;
/** The live escrow (public/native-qgold-escrow-<network>.json), or null. */
export function escrowConfig() {
  return configured;
}
/** Tests and the server set the escrow once; null turns the money paths off. */
export function setEscrowConfig(config) {
  configured = config
    ? {
        contractId: config.contractId,
        tokenId: config.tokenId,
        treasuryId: config.treasuryId || null,
        publisherId: config.publisherId || null,
      }
    : null;
}
export function loadEscrowManifest(appRoot, network, env = process.env) {
  if (env.QGOLD_ESCROW_ENABLED === "0") return null;
  const path = resolve(appRoot, `public/native-qgold-escrow-${network}.json`);
  if (!existsSync(path)) return null;
  const m = JSON.parse(readFileSync(path, "utf8"));
  if (!m.contractId || !m.tokenId) return null;
  return m;
}
export function requireEscrow() {
  const c = configured;
  assert(c, "Paying with QGOLD is not open yet. Try again soon.", 503, "ESCROW_UNAVAILABLE");
  return c;
}

/** The NEAR account that holds this explorer's QGOLD (explorer account first). */
export function accountOf(db, player) {
  try {
    const p = db.prepare("SELECT native_account FROM players WHERE id=?").get(player);
    if (p?.native_account) return p.native_account;
  } catch {}
  return (
    db
      .prepare("SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY rowid DESC LIMIT 1")
      .get(player)?.account_id || null
  );
}
export function requireAccount(db, player, who = "You need") {
  const account = accountOf(db, player);
  assert(account, `${who} a NEAR account for QGOLD. It is created when you open the game.`, 409, "NO_NEAR_ACCOUNT");
  return account;
}

// ------------------------------------------------------------------ funding
/**
 * Records an agreement that waits for its ft_transfer_call and returns the
 * exact call the player signs (sponsored: 1 yocto, no popup on the explorer
 * account).
 */
export function openFunding(db, { escrowId, target, ref, player, account, amount, msg }, now) {
  ensureMarketChainSchema(db);
  const c = requireEscrow();
  const body = JSON.stringify(msg);
  db.prepare("INSERT INTO mk_fundings VALUES (?,?,?,?,?,?,?,'waiting',NULL,?,?)").run(
    escrowId, target, ref, player, account, amount, body, now, now,
  );
  return fundingCall(c, { id: escrowId, account, amount, msg: body });
}
export function fundingCall(c, f) {
  return {
    id: f.id,
    signerId: f.account,
    receiverId: c.tokenId,
    methodName: "ft_transfer_call",
    args: { receiver_id: c.contractId, amount: String(f.amount), memo: null, msg: f.msg },
    gas: FUNDING_GAS,
    deposit: "1",
  };
}
/** The funding call again, for a player who closed the app before signing. */
export function pendingFunding(db, escrowId, player) {
  ensureMarketChainSchema(db);
  const f = db.prepare("SELECT * FROM mk_fundings WHERE id=? AND player=? AND state='waiting'").get(escrowId, player);
  return f && configured ? fundingCall(configured, { id: f.id, account: f.account, amount: f.amount_u, msg: f.msg }) : null;
}

/** Pure: does the escrow view match what this funding asked for? */
export function fundingMatches(f, view) {
  return fundingAssessment(f, view) !== null;
}
const VIEW_METHOD = { task: "get_task", secret: "get_secret", transfer: "get_transfer" };
export function fundingView(f) {
  try {
    const m = JSON.parse(f.msg), method = VIEW_METHOD[m.kind];
    return typeof method === "string" && m.id === f.id ? { method, args: { id: f.id } } : null;
  } catch { return null; }
}
const sameFunding = (a, b) => b && ["id", "target", "ref", "player", "account", "amount_u", "msg", "created_at"]
  .every((key) => a[key] === b[key]);

/**
 * Applies a funded agreement to its market row (inside one transaction).
 * `activate[target](db, ref, now)` is supplied by the market service.
 */
export function markFunded(db, f, activate, now, onChain) {
  return atomic(db, () => {
    const fresh = db.prepare("SELECT * FROM mk_fundings WHERE id=?").get(f.id);
    if (!sameFunding(f, fresh) || fresh.state !== "waiting") return false;
    const evidence = fundingAssessment(fresh, onChain);
    if (!evidence) return false;
    db.prepare("UPDATE mk_fundings SET state='funded',checked_at=?,updated_at=? WHERE id=?").run(now, now, f.id);
    activate[fresh.target](db, fresh.ref, now, fresh, evidence);
    return true;
  });
}
export function dropFunding(db, f, drop, now) {
  return atomic(db, () => {
    const fresh = db.prepare("SELECT * FROM mk_fundings WHERE id=? AND state='waiting'").get(f.id);
    if (!sameFunding(f, fresh)) return false;
    db.prepare("UPDATE mk_fundings SET state='dropped',updated_at=? WHERE id=?").run(now, f.id);
    drop[f.target](db, f.ref, now, fresh);
    return true;
  });
}

// ---------------------------------------------------------------- outbox
let seq = 0;
/** Queues one publisher call; ops of one escrow id run strictly in order. */
export function enqueue(db, escrowId, method, args, now) {
  ensureMarketChainSchema(db);
  assert(PUBLISHER_METHODS.includes(method), "Unsupported escrow call.", 500);
  const last = db.prepare("SELECT MAX(seq) AS s FROM mk_chain_ops").get().s ?? 0;
  seq = Math.max(seq, last) + 1;
  db.prepare("INSERT INTO mk_chain_ops VALUES (?,?,?,?,?,'queued',NULL,0,NULL,?,?)").run(
    id("eop"), seq, escrowId, method, JSON.stringify(args), now, now,
  );
}
/** Coalesce only before a delivery pass can observe or consume the credit. */
export function payOut(db, account, now) {
  if (!account) return;
  ensureMarketChainSchema(db);
  const queued = db
    .prepare(`SELECT 1 FROM mk_chain_ops o WHERE method='withdraw_for' AND state='queued' AND attempts=0 AND tx IS NULL
       AND json_extract(args,'$.account_id')=?
       AND NOT EXISTS(SELECT 1 FROM mk_delivery_lease)
       AND NOT EXISTS(SELECT 1 FROM mk_delivery_attempts a WHERE a.op_id=o.id)
       AND NOT EXISTS(SELECT 1 FROM mk_chain_ops later WHERE later.seq>o.seq AND later.method!='withdraw_for')`)
    .get(account);
  if (!queued) enqueue(db, null, "withdraw_for", { account_id: account }, now);
}
export function hold(db, escrowId, account, now) {
  ensureMarketChainSchema(db);
  db.prepare("INSERT OR IGNORE INTO mk_chain_holds VALUES (?,?,?)").run(escrowId, account, now);
}
/** Removes a hold; true when one existed (then the slot is resolved, not approved). */
export function release(db, escrowId, account) {
  ensureMarketChainSchema(db);
  return db.prepare("DELETE FROM mk_chain_holds WHERE escrow_id=? AND account=?").run(escrowId, account).changes > 0;
}

/**
 * One worker pass: confirm waiting fundings, then send due publisher calls.
 * `view(method, args)` reads the escrow; `call` prepares, replays and queries
 * durable signed transactions. A hash-only sender cannot deliver money safely.
 */
export async function runEscrowWorker(db, { view, call, activate, drop, now = Date.now(), maxOps = 20, maxChecks = 20 }) {
  ensureMarketChainSchema(db);
  const result = { funded: 0, dropped: 0, fundingFailed: 0, sent: 0, failed: 0 };
  for (const f of db
    .prepare("SELECT * FROM mk_fundings WHERE state='waiting' ORDER BY COALESCE(checked_at,0),created_at,id LIMIT ?")
    .all(maxChecks)) {
    const v = fundingView(f);
    db.prepare("UPDATE mk_fundings SET checked_at=? WHERE id=? AND state='waiting'").run(now, f.id);
    if (!v) continue;
    let onChain = null;
    try {
      onChain = await view(v.method, v.args);
    } catch {
      continue;
    }
    try {
      if (onChain && fundingMatches(f, onChain)) {
        if (markFunded(db, f, activate, now, onChain)) result.funded++;
      } else if (onChain === null && now - f.created_at > FUNDING_WAIT_MS) {
        if (dropFunding(db, f, drop, now)) result.dropped++;
      }
    } catch {
      // The transaction rolled back. One inconsistent order must not block
      // other confirmations or the settlement outbox in this worker pass.
      result.fundingFailed++;
    }
  }
  Object.assign(result, await runEscrowDelivery(db, { call, view, now, maxOps }));
  return result;
}
/** The player says they signed: check that one funding right away. */
export async function checkFunding(db, escrowId, player, { view, activate, now }) {
  ensureMarketChainSchema(db);
  const f = db.prepare("SELECT * FROM mk_fundings WHERE id=? AND player=?").get(escrowId, player);
  assert(f, "Unknown payment.", 404);
  if (f.state !== "waiting") return { state: f.state };
  const v = fundingView(f);
  if (!v) return { state: "waiting" };
  const onChain = await view(v.method, v.args).catch(() => null);
  if (onChain && fundingMatches(f, onChain)) {
    markFunded(db, f, activate, now, onChain);
  }
  // Another worker may have committed or dropped this intent while RPC waited.
  return { state: db.prepare("SELECT state FROM mk_fundings WHERE id=? AND player=?").get(escrowId, player)?.state ?? "waiting" };
}
export function escrowHealth(db) {
  ensureMarketChainSchema(db);
  const n = (sql) => db.prepare(sql).get().n;
  return {
    enabled: !!configured,
    contractId: configured?.contractId ?? null,
    waitingFunding: n("SELECT COUNT(*) AS n FROM mk_fundings WHERE state='waiting'"),
    queued: n("SELECT COUNT(*) AS n FROM mk_chain_ops WHERE state='queued'"),
    failed: n("SELECT COUNT(*) AS n FROM mk_chain_ops WHERE state='failed'"),
    // Operator surface: publisher calls the contract rejected with a FINAL
    // receipt. They never block other operations; re-queue one after
    // reconciling its agreement (UPDATE mk_chain_ops SET state='queued').
    rejected: db
      .prepare(`SELECT o.id,o.method,o.escrow_id,o.tx,o.last_error,o.attempts,o.created_at FROM mk_chain_ops o
        WHERE o.state='failed' AND (SELECT a.state FROM mk_delivery_attempts a WHERE a.op_id=o.id ORDER BY a.attempt DESC LIMIT 1)='retry'
        ORDER BY o.seq LIMIT 20`)
      .all()
      .map((o) => ({ id: o.id, method: o.method, escrowId: o.escrow_id, tx: o.tx, reason: o.last_error, attempts: o.attempts, createdAt: o.created_at })),
  };
}

// --------------------------------------------------------------- transport
/**
 * Publisher transport: a function-call key of the publisher account limited to
 * the escrow and PUBLISHER_METHODS (never a full-access key on the server).
 */
export async function escrowTransport(provider, escrow, keyPath, { Account, KeyPairSigner }) {
  assert((statSync(keyPath).mode & 0o077) === 0, "Escrow publisher key permissions must be private.", 503);
  const config = JSON.parse(readFileSync(keyPath, "utf8"));
  assert(config.accountId === escrow.publisherId, "Wrong escrow publisher identity.", 503);
  const signer = KeyPairSigner.fromSecretKey(config.secretKey);
  const publicKey = (await signer.getPublicKey()).toString();
  const access = await provider.query({
    request_type: "view_access_key",
    account_id: config.accountId,
    public_key: publicKey,
    finality: "final",
  });
  const p = access.permission?.FunctionCall;
  assert(
    p && p.receiver_id === escrow.contractId && p.method_names.every((m) => PUBLISHER_METHODS.includes(m)),
    "Escrow publisher key must be a function-call key for the escrow.",
    503,
  );
  const account = new Account(config.accountId, provider, signer);
  return escrowDeliveryTransport(provider, account, escrow, p.method_names);
}
export function escrowView(provider, contractId) {
  return async (method, args) => {
    const r = await provider.query({
      request_type: "call_function",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "final",
    });
    return JSON.parse(Buffer.from(r.result).toString("utf8"));
  };
}

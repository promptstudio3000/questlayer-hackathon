// Player task market, Secrets and conditional transfers (QGOLD stream 3).
//
// Money model (docs/TASK-MARKET.md):
// - Every amount is integer micro-GOLD = QGOLD base units (6 decimals). All of
//   it is real QGOLD held by the qgold-escrow contract (./chain.mjs): the
//   poster, buyer or sender funds a row with one sponsored ft_transfer_call,
//   the row waits in `funding` until the escrow shows it, and every payout or
//   refund is a queued escrow call. players.gold_u is never touched.
// - A task poster pays the reward PLUS a 10 % fee on top. The fee goes to the
//   treasury only when a completion is paid; refunds return reward and fee.
// - A Secret buyer pays the price; on release the creator gets 90 % and the
//   treasury 10 %. A sponsored Secret is free to reveal: the sponsor prepays
//   the visit rewards plus 10 % on top.
// - Conditional P2P transfers carry no fee.
// - Every GOLD that leaves a player sits in exactly one escrow row until it is
//   paid or refunded; `marketInvariant` checks the sum.
import { publicLook } from "../public-look.mjs";
import { randomBytes, createHash } from "node:crypto";
import { assert, distance, id, point, DAY, GOLD } from "../domain.mjs";
import { atomic, history } from "../database.mjs";
import { MARKET_FEE_BPS, SECRET_RELEASE_MS } from "./funding.mjs";
export { MARKET_FEE_BPS, SECRET_RELEASE_MS } from "./funding.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";
import {
  accountOf,
  enqueue,
  ensureMarketChainSchema,
  escrowConfig,
  hold,
  openFunding,
  payOut,
  pendingFunding,
  release,
  requireAccount,
  requireEscrow,
} from "./chain.mjs";

export const REVIEW_WINDOW_MS = 72 * 3_600_000; // unreviewed proof pays the worker.
export const RESERVATION_MS = 3 * 3_600_000;
export const TASK_TYPES = Object.freeze([
  "go",
  "photo",
  "deliver",
  "meet",
  "collect",
  "event",
  "answer",
  "create",
  "recurring",
  "chain",
]);
/** Types the server verifies itself (GPS at the place, or the right answer). */
const MACHINE_CHECKED = new Set(["go", "meet", "collect", "event", "deliver", "answer"]);
export const VISIBILITIES = Object.freeze(["public", "link", "private", "user", "group"]);
export const PAYOUT_MODES = Object.freeze(["auto", "review", "best"]);
export const SECRET_KINDS = Object.freeze(["place", "route", "sponsored", "private"]);
export const TRANSFER_CONDITIONS = Object.freeze(["both_confirm", "after", "gps"]);
const NEARBY_TASK_M = 5_000;
const NEARBY_SECRET_M = 10_000;
const VISIT_RADIUS_M = 60;
const MAX_OPEN_PER_PLAYER = 30;
const SPONSOR_DAYS = 180; // a sponsored Secret's finder budget stays this long at most

export const MARKET_SCHEMA = registerModuleSchema({
  name: "task-market",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS mk_tasks(id TEXT PRIMARY KEY,poster TEXT NOT NULL REFERENCES players(id),title TEXT NOT NULL,description TEXT NOT NULL,type TEXT NOT NULL,visibility TEXT NOT NULL,link_key TEXT,assignee TEXT,group_ids TEXT NOT NULL DEFAULT '[]',lat REAL NOT NULL,lng REAL NOT NULL,radius_m INTEGER NOT NULL,reward_u INTEGER NOT NULL CHECK(reward_u>0),slots INTEGER NOT NULL CHECK(slots>0),rounds INTEGER NOT NULL DEFAULT 1,every_ms INTEGER NOT NULL DEFAULT 0,payout_mode TEXT NOT NULL,answer_hash TEXT,parent_id TEXT,currency TEXT NOT NULL DEFAULT 'practice',held_u INTEGER NOT NULL DEFAULT 0 CHECK(held_u>=0),fee_held_u INTEGER NOT NULL DEFAULT 0 CHECK(fee_held_u>=0),paid_slots INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,deadline INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mk_tasks_open ON mk_tasks(state,lat,lng);
CREATE TABLE IF NOT EXISTS mk_claims(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES mk_tasks(id),worker TEXT NOT NULL REFERENCES players(id),state TEXT NOT NULL,offer_u INTEGER,evidence TEXT,fix TEXT,round INTEGER NOT NULL DEFAULT 0,paid_u INTEGER NOT NULL DEFAULT 0,note TEXT,reserved_until INTEGER,submitted_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mk_claims_task ON mk_claims(task_id,state);
CREATE INDEX IF NOT EXISTS mk_claims_worker ON mk_claims(worker,state);
CREATE TABLE IF NOT EXISTS mk_messages(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES mk_tasks(id),claim_id TEXT,sender TEXT NOT NULL REFERENCES players(id),text TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mk_messages_task ON mk_messages(task_id,created_at);
CREATE TABLE IF NOT EXISTS mk_ratings(claim_id TEXT NOT NULL REFERENCES mk_claims(id),rater TEXT NOT NULL REFERENCES players(id),ratee TEXT NOT NULL REFERENCES players(id),stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),text TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,PRIMARY KEY(claim_id,rater));
CREATE TABLE IF NOT EXISTS mk_secrets(id TEXT PRIMARY KEY,creator TEXT NOT NULL REFERENCES players(id),kind TEXT NOT NULL,title TEXT NOT NULL,teaser TEXT NOT NULL,reveal TEXT NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL,route TEXT NOT NULL DEFAULT '[]',fog_lat REAL NOT NULL,fog_lng REAL NOT NULL,fog_radius_m INTEGER NOT NULL,price_u INTEGER NOT NULL CHECK(price_u>=0),link_key TEXT,visit_reward_u INTEGER NOT NULL DEFAULT 0,visits_left INTEGER NOT NULL DEFAULT 0,held_u INTEGER NOT NULL DEFAULT 0 CHECK(held_u>=0),fee_held_u INTEGER NOT NULL DEFAULT 0 CHECK(fee_held_u>=0),currency TEXT NOT NULL DEFAULT 'practice',state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mk_secrets_open ON mk_secrets(state,fog_lat,fog_lng);
CREATE TABLE IF NOT EXISTS mk_reveals(id TEXT PRIMARY KEY,secret_id TEXT NOT NULL REFERENCES mk_secrets(id),buyer TEXT NOT NULL REFERENCES players(id),price_u INTEGER NOT NULL,held_u INTEGER NOT NULL DEFAULT 0 CHECK(held_u>=0),state TEXT NOT NULL,visited_at INTEGER,dispute TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(secret_id,buyer));
CREATE TABLE IF NOT EXISTS mk_transfers(id TEXT PRIMARY KEY,sender TEXT NOT NULL REFERENCES players(id),receiver TEXT NOT NULL REFERENCES players(id),amount_u INTEGER NOT NULL CHECK(amount_u>0),held_u INTEGER NOT NULL CHECK(held_u>=0),condition TEXT NOT NULL,at_ms INTEGER,lat REAL,lng REAL,radius_m INTEGER,sender_ok INTEGER NOT NULL DEFAULT 0,receiver_ok INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',currency TEXT NOT NULL DEFAULT 'practice',state TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mk_transfers_people ON mk_transfers(state,sender,receiver);
CREATE TABLE IF NOT EXISTS mk_fees(id TEXT PRIMARY KEY,source TEXT NOT NULL,ref TEXT NOT NULL,amount_u INTEGER NOT NULL CHECK(amount_u>=0),currency TEXT NOT NULL,created_at INTEGER NOT NULL)`,
});

const ready = new WeakSet();
export function ensureMarketSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, MARKET_SCHEMA);
  ensureMarketChainSchema(db);
  ready.add(db);
}
const CURRENCY = "qgold";
/** Most completions one escrow task can pay (contracts/qgold-escrow MAX_SLOTS). */
const MAX_ESCROW_SLOTS = 50;

// ---------------------------------------------------------------- helpers
/** 10 % on top, rounded up so the treasury never gets less than its share. */
export const feeOnTop = (amount) => Math.ceil((amount * MARKET_FEE_BPS) / 10_000);
const key = () => randomBytes(12).toString("base64url");
const answerHash = (text) =>
  createHash("sha256")
    .update(String(text).normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
const text = (value, min, max, message) => {
  assert(typeof value === "string" && value.trim().length >= min && value.length <= max, message);
  return value.trim();
};
const int = (value, min, max, message) => {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, message);
  return value;
};
const parse = (json, fallback) => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};
/** A history line for the player; the QGOLD itself moves on chain. */
function note(db, player, kind, title, amount, meta) {
  if (amount) history(db, player, kind, title, amount, { ...meta, currency: CURRENCY });
}
/** Pays an escrow credit out to a player's account, and the treasury's fee. */
function payOutPlayer(db, player, now) {
  payOut(db, accountOf(db, player), now);
}
function payOutTreasury(db, now) {
  const t = escrowConfig()?.treasuryId;
  if (t) payOut(db, t, now);
}
function fee(db, source, ref, amount, currency, now) {
  if (amount <= 0) return;
  db.prepare("INSERT INTO mk_fees VALUES (?,?,?,?,?,?)").run(id("fee"), source, ref, amount, currency, now);
}
function playerExists(db, player) {
  return !!db.prepare("SELECT 1 FROM players WHERE id=?").get(player);
}
/** A player id, or a NEAR account linked to a player. */
export function resolvePlayer(db, who) {
  if (typeof who !== "string" || !who.trim() || who.length > 100) return null;
  const v = who.trim();
  if (playerExists(db, v)) return v;
  const link = db.prepare("SELECT player_id FROM wallet_links WHERE account_id=?").get(v);
  if (link) return link.player_id;
  try {
    const managed = db.prepare("SELECT id FROM players WHERE native_account=?").get(v);
    if (managed) return managed.id;
  } catch {}
  return null;
}
const name = (db, player) => db.prepare("SELECT name FROM players WHERE id=?").get(player)?.name || "Explorer";
/** Validates a client GPS fix and checks it is within `radius` of `target`. */
function atPlace(fix, target, radius, now) {
  assert(fix && typeof fix === "object", "Share your location first.", 422, "GPS_REQUIRED");
  point(fix);
  assert(
    Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 50,
    "Your location is not precise enough yet. Step into the open and try again.",
    422,
    "GPS_ACCURACY",
  );
  assert(
    Number.isFinite(fix.timestamp) && fix.timestamp <= now + 2_000 && now - fix.timestamp <= 30_000,
    "Your location is out of date. Wait a moment for a fresh one, then try again.",
    422,
    "GPS_STALE",
  );
  assert(distance(fix, target) <= radius + Math.min(fix.accuracy, 25), "Get closer to the place, then try again.", 422, "OUT_OF_RANGE");
  return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, timestamp: fix.timestamp };
}
/** Deterministic fog centre: offset from the true place by 20–60 % of the radius. */
export function fogCentre(secretId, lat, lng, radius) {
  const h = createHash("sha256").update(`fog:${secretId}`).digest();
  const angle = (h.readUInt32BE(0) / 2 ** 32) * 2 * Math.PI,
    meters = radius * (0.2 + (h.readUInt32BE(4) / 2 ** 32) * 0.4);
  const dLat = (meters * Math.cos(angle)) / 111_320,
    dLng = (meters * Math.sin(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}
const box = (lat, lng, meters) => {
  const dLat = meters / 111_320,
    dLng = meters / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lat + dLat, lng - dLng, lng + dLng];
};

// ---------------------------------------------------------------- tasks
function taskRound(task, now) {
  if (task.rounds <= 1 || task.every_ms <= 0) return 0;
  return Math.min(task.rounds - 1, Math.max(0, Math.floor((now - task.created_at) / task.every_ms)));
}
function canSeeTask(db, viewer, task, linkKey) {
  if (task.poster === viewer) return true;
  if (task.visibility === "public" || task.visibility === "link") return true;
  if (task.visibility === "private") return !!linkKey && linkKey === task.link_key;
  if (task.visibility === "user") return task.assignee === viewer;
  if (task.visibility === "group") return parse(task.group_ids, []).includes(viewer);
  return false;
}
function parentDone(db, task, worker) {
  if (!task.parent_id) return true;
  return !!db
    .prepare("SELECT 1 FROM mk_claims WHERE task_id=? AND worker=? AND state='paid'")
    .get(task.parent_id, worker);
}

export function createTask(db, poster, input, now = Date.now()) {
  ensureMarketSchema(db);
  const title = text(input.title, 5, 100, "Give the task a title (5–100 characters).");
  const description = text(input.description ?? "", 0, 1000, "The description is too long.");
  const type = input.type ?? "go";
  assert(TASK_TYPES.includes(type), "Choose a task type.");
  const visibility = input.visibility ?? "public";
  assert(VISIBILITIES.includes(visibility), "Choose who can see the task.");
  point(input);
  const radius = int(input.radiusM ?? 50, 20, 500, "The place radius must be 20–500 m.");
  const reward = int(input.reward, 0.01 * GOLD, 100_000 * GOLD, "Set a reward between 0.01 and 100,000 GOLD.");
  const slots = int(input.slots ?? 1, 1, 50, "A task can pay 1–50 completions.");
  const rounds = type === "recurring" ? int(input.rounds ?? 4, 2, 12, "A recurring task runs 2–12 rounds.") : 1;
  const everyMs =
    type === "recurring" ? int(input.everyDays ?? 7, 1, 30, "Repeat every 1–30 days.") * DAY : 0;
  const days = int(input.days ?? 7, 1, 30, "A task stays open 1–30 days.");
  const deadline = type === "recurring" ? now + rounds * everyMs : now + days * DAY;
  let payoutMode = input.payoutMode ?? (MACHINE_CHECKED.has(type) ? "auto" : "review");
  assert(PAYOUT_MODES.includes(payoutMode), "Choose how completions are paid.");
  assert(payoutMode !== "auto" || MACHINE_CHECKED.has(type), "Only place and answer tasks can pay automatically.");
  let answer = null;
  if (type === "answer") answer = answerHash(text(input.answer, 1, 200, "Set the correct answer."));
  let assignee = null,
    groupIds = [];
  if (visibility === "user") {
    assignee = resolvePlayer(db, input.assignee);
    assert(assignee && assignee !== poster, "Choose another player for this task.");
  }
  if (visibility === "group") {
    assert(Array.isArray(input.group) && input.group.length >= 2 && input.group.length <= 20, "Invite 2–20 players.");
    groupIds = [...new Set(input.group.map((g) => resolvePlayer(db, g)))];
    assert(groupIds.every((g) => g && g !== poster), "One of the invited players was not found.");
  }
  let parent = null;
  if (type === "chain") {
    parent = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(input.parentId);
    assert(parent && parent.poster === poster, "A chain step follows one of your own tasks.");
  }
  assert(slots * rounds <= MAX_ESCROW_SLOTS, "A task can pay at most 50 completions over all its rounds.");
  requireEscrow();
  const account = requireAccount(db, poster);
  const assigneeAccount = assignee ? requireAccount(db, assignee, "The invited player needs") : null;
  const total = reward * slots * rounds,
    feeU = feeOnTop(total);
  const taskId = id("task"),
    link = ["link", "private"].includes(visibility) ? key() : null;
  const funding = atomic(db, () => {
    const open = db
      .prepare("SELECT COUNT(*) AS n FROM mk_tasks WHERE poster=? AND state IN ('open','funding')")
      .get(poster).n;
    assert(open < MAX_OPEN_PER_PLAYER, "You have too many open tasks. Close one first.");
    db.prepare(
      `INSERT INTO mk_tasks(id,poster,title,description,type,visibility,link_key,assignee,group_ids,lat,lng,radius_m,reward_u,slots,rounds,every_ms,payout_mode,answer_hash,parent_id,currency,held_u,fee_held_u,state,deadline,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'funding',?,?,?)`,
    ).run(
      taskId, poster, title, description, type, visibility, link, assignee, JSON.stringify(groupIds),
      input.lat, input.lng, radius, reward, slots, rounds, everyMs, payoutMode, answer, parent?.id ?? null,
      CURRENCY, total, feeU, deadline, now, now,
    );
    const msg = { kind: "task", id: taskId, reward: String(total), deadline_ms: String(deadline), slots: slots * rounds };
    if (assigneeAccount) msg.assignee = assigneeAccount;
    return openFunding(db, { escrowId: taskId, target: "task", ref: taskId, player: poster, account, amount: total + feeU, msg }, now);
  });
  return { id: taskId, linkKey: link, total, fee: feeU, charged: total + feeU, state: "funding", funding };
}

function holdSlot(db, task, worker, now) {
  const account = accountOf(db, worker);
  if (!account) return;
  hold(db, task.id, account, now);
  enqueue(db, task.id, "open_dispute", { id: task.id, worker: account }, now);
}
function unholdSlot(db, task, worker, now) {
  const account = accountOf(db, worker);
  if (account && release(db, task.id, account))
    enqueue(db, task.id, "resolve_dispute", { id: task.id, worker: account, pay: false }, now);
}
/** Pays one completion out of escrow: reward to the worker, its fee share to the treasury. */
function payClaim(db, task, claim, now, how) {
  const totalSlots = task.slots * task.rounds,
    last = task.paid_slots + 1 === totalSlots;
  const base = task.reward_u;
  const extra = claim.offer_u && claim.offer_u > base ? claim.offer_u - base : 0;
  const pay = base + extra;
  const slotFee = last ? task.fee_held_u : Math.min(task.fee_held_u, feeOnTop(base) + (extra ? feeOnTop(extra) : 0));
  assert(task.held_u >= pay, "The task escrow is short. Ask a moderator.", 409);
  const worker = requireAccount(db, claim.worker, "The player needs");
  // A proof that waited for review holds its slot on chain (open_dispute).
  if (release(db, task.id, worker)) enqueue(db, task.id, "resolve_dispute", { id: task.id, worker, pay: true }, now);
  else enqueue(db, task.id, "approve_task", { id: task.id, worker }, now);
  if (extra) {
    const offer = offerEscrow(db, claim.id);
    assert(offer, "The counteroffer is not funded.", 409);
    enqueue(db, offer, "approve_task", { id: offer, worker }, now);
  }
  payOutPlayer(db, claim.worker, now);
  payOutTreasury(db, now);
  db.prepare(
    "UPDATE mk_tasks SET held_u=held_u-?,fee_held_u=fee_held_u-?,paid_slots=paid_slots+1,state=CASE WHEN paid_slots+1>=slots*rounds THEN 'done' ELSE state END,updated_at=? WHERE id=?",
  ).run(pay, slotFee, now, task.id);
  db.prepare("UPDATE mk_claims SET state='paid',paid_u=?,note=COALESCE(note,?),updated_at=? WHERE id=?").run(pay, how, now, claim.id);
  note(db, claim.worker, "task", `Task reward: ${task.title}`, pay, { taskId: task.id, claimId: claim.id });
  fee(db, "task", claim.id, slotFee, task.currency, now);
  return pay;
}
/** The funded escrow id of a claim's counteroffer extra. */
function offerEscrow(db, claimId) {
  return db.prepare("SELECT id FROM mk_fundings WHERE target='offer' AND ref=? AND state='funded'").get(claimId)?.id ?? null;
}
function slotsTaken(db, task, round) {
  return db
    .prepare(
      "SELECT COUNT(*) AS n FROM mk_claims WHERE task_id=? AND round=? AND state IN ('reserved','submitted','disputed','paid')",
    )
    .get(task.id, round).n;
}
function slotsRemaining(db, task, now) {
  return Math.max(0, task.slots - slotsTaken(db, task, taskRound(task, now)));
}

export function reserveTask(db, worker, taskId, { linkKey, offer } = {}, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    sweepTask(db, taskId, now);
    const task = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(taskId);
    assert(task && canSeeTask(db, worker, task, linkKey), "This task is not available.", 404);
    assert(task.state === "open" && task.deadline > now, "This task is closed.");
    assert(task.poster !== worker, "You cannot take your own task.");
    // Test-world examples (server/test-seed) have no QGOLD in escrow.
    assert(!task.id.startsWith("seed-"), "This is an example task from a demo bot. Real tasks from explorers pay QGOLD.", 409);
    assert(parentDone(db, task, worker), "Finish the previous step of this chain first.");
    requireAccount(db, worker);
    // The escrow pays each account once per task, also across rounds.
    assert(
      !db.prepare("SELECT 1 FROM mk_claims WHERE task_id=? AND worker=? AND state='paid'").get(task.id, worker),
      "You were already paid for this task.",
    );
    const round = taskRound(task, now);
    assert(
      !db
        .prepare("SELECT 1 FROM mk_claims WHERE task_id=? AND worker=? AND round=? AND state IN ('reserved','submitted','disputed','paid')")
        .get(task.id, worker, round),
      "You already took this task.",
    );
    assert(task.payout_mode === "best" || slotsRemaining(db, task, now) > 0, "All places on this task are taken.");
    let offerU = null;
    if (offer !== undefined && offer !== null) {
      offerU = int(offer, task.reward_u + 1, task.reward_u * 10, "A counteroffer must be above the reward and at most 10×.");
    }
    const claimId = id("claim");
    db.prepare(
      "INSERT INTO mk_claims(id,task_id,worker,state,offer_u,round,reserved_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(claimId, task.id, worker, offerU ? "offered" : "reserved", offerU, round, now + RESERVATION_MS, now, now);
    return { id: claimId, state: offerU ? "offered" : "reserved", reservedUntil: now + RESERVATION_MS };
  });
}

/** Poster accepts a counteroffer and pays the difference plus 10 % on it. */
export function acceptOffer(db, poster, claimId, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const claim = db.prepare("SELECT * FROM mk_claims WHERE id=?").get(claimId);
    const task = claim && db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(claim.task_id);
    assert(task && task.poster === poster, "You do not own this task.", 403);
    assert(claim.state === "offered" && task.state === "open", "This offer is no longer open.");
    const waiting = db.prepare("SELECT id FROM mk_fundings WHERE target='offer' AND ref=? AND state='waiting'").get(claimId);
    if (waiting) return { state: "funding", funding: pendingFunding(db, waiting.id, poster) };
    const extra = claim.offer_u - task.reward_u,
      extraFee = feeOnTop(extra);
    const msg = {
      kind: "task",
      id: id("offer"),
      reward: String(extra),
      deadline_ms: String(Math.max(task.deadline, now + DAY)),
      slots: 1,
      assignee: requireAccount(db, claim.worker, "The player needs"),
    };
    const funding = openFunding(
      db,
      { escrowId: msg.id, target: "offer", ref: claimId, player: poster, account: requireAccount(db, poster), amount: extra + extraFee, msg },
      now,
    );
    return { charged: extra + extraFee, state: "funding", funding };
  });
}

export function submitClaim(db, worker, claimId, { evidence, answer, fix } = {}, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const claim = db.prepare("SELECT * FROM mk_claims WHERE id=?").get(claimId);
    assert(claim && claim.worker === worker, "This is not your task.", 403);
    const task = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(claim.task_id);
    assert(claim.state === "reserved", "This task is not waiting for your proof.");
    assert(task.state === "open" && task.deadline > now, "This task is closed.");
    let checked = false,
      at = null;
    if (task.type === "answer") {
      const given = text(answer, 1, 200, "Type your answer.");
      if (answerHash(given) !== task.answer_hash) {
        db.prepare("UPDATE mk_claims SET updated_at=? WHERE id=?").run(now, claimId);
        return { state: "reserved", correct: false };
      }
      checked = true;
    } else if (MACHINE_CHECKED.has(task.type)) {
      at = atPlace(fix, task, task.radius_m, now);
      checked = true;
    }
    const proof = evidence === undefined || evidence === null ? "" : text(evidence, 0, 1000, "The proof note is too long.");
    if (!checked) assert(proof.length >= 10, "Describe what you did in at least ten characters.");
    db.prepare("UPDATE mk_claims SET state='submitted',evidence=?,fix=?,submitted_at=?,updated_at=? WHERE id=?").run(
      proof, at ? JSON.stringify(at) : null, now, now, claimId,
    );
    if (checked && task.payout_mode === "auto") {
      const paid = payClaim(db, task, { ...claim, state: "submitted" }, now, "auto");
      return { state: "paid", paid, correct: true };
    }
    // The proof waits for review: its slot is held on chain so the poster
    // cannot cancel it away. "Best" tasks take more proofs than slots.
    if (task.payout_mode !== "best") holdSlot(db, task, worker, now);
    return { state: "submitted", correct: checked || undefined };
  });
}

export function reviewClaim(db, poster, claimId, approve, reason = "", now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const claim = db.prepare("SELECT * FROM mk_claims WHERE id=?").get(claimId);
    const task = claim && db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(claim.task_id);
    assert(task && task.poster === poster, "You do not own this task.", 403);
    assert(claim.state === "submitted", "This proof is not waiting for review.");
    if (approve) {
      if (task.payout_mode === "best") {
        const paid = db.prepare("SELECT COUNT(*) AS n FROM mk_claims WHERE task_id=? AND state='paid'").get(task.id).n;
        assert(paid < task.slots * task.rounds, "You already picked every winner.");
      }
      return { state: "paid", paid: payClaim(db, task, claim, now, "approved") };
    }
    db.prepare("UPDATE mk_claims SET state='rejected',note=?,updated_at=? WHERE id=?").run(
      text(reason, 3, 300, "Tell the player why (3–300 characters)."), now, claimId,
    );
    unholdSlot(db, task, claim.worker, now);
    return { state: "rejected" };
  });
}

export function disputeClaim(db, actor, claimId, reason, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const claim = db.prepare("SELECT * FROM mk_claims WHERE id=?").get(claimId);
    const task = claim && db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(claim.task_id);
    assert(task && (claim.worker === actor || task.poster === actor), "This is not your task.", 403);
    assert(["submitted", "rejected"].includes(claim.state), "Only a submitted or rejected proof can be disputed.");
    assert(claim.state !== "rejected" || now - claim.updated_at <= 3 * DAY, "The dispute window has closed.");
    db.prepare("UPDATE mk_claims SET state='disputed',note=?,updated_at=? WHERE id=?").run(
      `${actor === task.poster ? "poster" : "worker"}: ${text(reason, 5, 500, "Explain the problem (5–500 characters).")}`, now, claimId,
    );
    return { state: "disputed" };
  });
}

export function resolveDispute(db, claimId, pay, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const claim = db.prepare("SELECT * FROM mk_claims WHERE id=?").get(claimId);
    assert(claim?.state === "disputed", "No open dispute.");
    const task = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(claim.task_id);
    if (pay && task.held_u >= task.reward_u) return { state: "paid", paid: payClaim(db, task, claim, now, "moderator") };
    db.prepare("UPDATE mk_claims SET state='rejected',note='moderator',updated_at=? WHERE id=?").run(now, claimId);
    unholdSlot(db, task, claim.worker, now);
    return { state: "rejected" };
  });
}

/** Refunds everything not yet paid (reward and its fee) to the poster. */
function closeTask(db, task, state, now) {
  const open = db
    .prepare("SELECT COUNT(*) AS n FROM mk_claims WHERE task_id=? AND state IN ('submitted','disputed')")
    .get(task.id).n;
  if (open) return false;
  db.prepare("UPDATE mk_claims SET state='cancelled',updated_at=? WHERE task_id=? AND state IN ('reserved','offered')").run(now, task.id);
  const back = task.held_u + task.fee_held_u;
  db.prepare("UPDATE mk_tasks SET held_u=0,fee_held_u=0,state=?,updated_at=? WHERE id=?").run(state, now, task.id);
  // The publisher refunds every unpaid slot, and unpaid counteroffer extras.
  if (back > 0) enqueue(db, task.id, "cancel_task", { id: task.id }, now);
  for (const c of db.prepare("SELECT id FROM mk_claims WHERE task_id=? AND offer_u IS NOT NULL AND state!='paid'").all(task.id)) {
    const offer = offerEscrow(db, c.id);
    if (offer) enqueue(db, offer, "cancel_task", { id: offer }, now);
  }
  payOutPlayer(db, task.poster, now);
  note(db, task.poster, "refund", `Task refund: ${task.title}`, back, { taskId: task.id });
  return back;
}
export function cancelTask(db, poster, taskId, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const task = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(taskId);
    assert(task && task.poster === poster, "You do not own this task.", 403);
    assert(task.state === "open", "This task is already closed.");
    const back = closeTask(db, task, "cancelled", now);
    assert(back !== false, "Review the waiting proofs first. A dispute must be resolved before you close the task.");
    return { refunded: back };
  });
}
/** Lazy maintenance for one task: expired reservations, overdue reviews, deadline. */
function sweepTask(db, taskId, now) {
  const task = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(taskId);
  if (!task || task.state !== "open") return;
  db.prepare("UPDATE mk_claims SET state='expired',updated_at=? WHERE task_id=? AND state IN ('reserved','offered') AND reserved_until<?").run(now, task.id, now);
  for (const claim of db
    .prepare("SELECT * FROM mk_claims WHERE task_id=? AND state='submitted' AND submitted_at<?")
    .all(task.id, now - REVIEW_WINDOW_MS)) {
    const fresh = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(task.id);
    if (fresh.state === "open" && fresh.held_u >= fresh.reward_u) payClaim(db, fresh, claim, now, "review timeout");
  }
  const fresh = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(task.id);
  if (fresh.state === "open" && fresh.deadline <= now) closeTask(db, fresh, "expired", now);
}

function taskView(db, viewer, task, now, { full = false } = {}) {
  const mine = task.poster === viewer;
  const myClaim = db
    .prepare("SELECT * FROM mk_claims WHERE task_id=? AND worker=? ORDER BY created_at DESC LIMIT 1")
    .get(task.id, viewer);
  const view = {
    id: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    visibility: task.visibility,
    poster: { id: task.poster, name: name(db, task.poster), rating: ratingOf(db, task.poster), look: publicLook(db, task.poster, now) },
    // A demo bot's example in the test world: shown, never funded or taken.
    demo: task.id.startsWith("seed-"),
    lat: task.lat,
    lng: task.lng,
    radiusM: task.radius_m,
    reward: task.reward_u,
    slots: task.slots,
    rounds: task.rounds,
    everyDays: task.every_ms ? task.every_ms / DAY : 0,
    round: taskRound(task, now),
    remaining: task.state === "open" ? slotsRemaining(db, task, now) : 0,
    paidSlots: task.paid_slots,
    payoutMode: task.payout_mode,
    parentId: task.parent_id,
    currency: task.currency,
    state: task.state,
    deadline: task.deadline,
    createdAt: task.created_at,
    mine,
    myClaim: myClaim ? claimView(db, myClaim) : null,
  };
  if (mine) {
    view.linkKey = task.link_key;
    view.held = task.held_u;
    view.feeHeld = task.fee_held_u;
    view.assignee = task.assignee ? { id: task.assignee, name: name(db, task.assignee) } : null;
  }
  if (full && mine)
    view.claims = db
      .prepare("SELECT * FROM mk_claims WHERE task_id=? ORDER BY created_at")
      .all(task.id)
      .map((c) => claimView(db, c));
  if (full && (mine || myClaim))
    view.messages = db
      .prepare(
        "SELECT m.*,p.name FROM mk_messages m JOIN players p ON p.id=m.sender WHERE task_id=? AND (?=1 OR claim_id IS NULL OR claim_id IN (SELECT id FROM mk_claims WHERE worker=?)) ORDER BY m.created_at DESC LIMIT 50",
      )
      .all(task.id, mine ? 1 : 0, viewer)
      .reverse()
      .map((m) => ({ id: m.id, claimId: m.claim_id, from: { id: m.sender, name: m.name }, text: m.text, at: m.created_at }));
  return view;
}
function claimView(db, c) {
  return {
    id: c.id,
    worker: { id: c.worker, name: name(db, c.worker), rating: ratingOf(db, c.worker) },
    state: c.state,
    offer: c.offer_u,
    evidence: c.evidence,
    round: c.round,
    paid: c.paid_u,
    note: c.note,
    reservedUntil: c.reserved_until,
    submittedAt: c.submitted_at,
  };
}
export function ratingOf(db, player) {
  const r = db.prepare("SELECT COUNT(*) AS n, AVG(stars) AS avg FROM mk_ratings WHERE ratee=?").get(player);
  return r.n ? { count: r.n, average: Math.round(r.avg * 10) / 10 } : null;
}

export function getTask(db, viewer, taskId, linkKey, now = Date.now()) {
  ensureMarketSchema(db);
  atomic(db, () => sweepTask(db, taskId, now));
  const task = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(taskId);
  assert(task && canSeeTask(db, viewer, task, linkKey), "This task is not available.", 404);
  return taskView(db, viewer, task, now, { full: true });
}

export function postMessage(db, sender, taskId, input, now = Date.now()) {
  ensureMarketSchema(db);
  const task = db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(taskId);
  assert(task, "This task is not available.", 404);
  const body = text(input.text, 1, 500, "Write a message (up to 500 characters).");
  let claimId = input.claimId ?? null;
  if (task.poster !== sender) {
    const claim = db.prepare("SELECT id FROM mk_claims WHERE task_id=? AND worker=? ORDER BY created_at DESC LIMIT 1").get(task.id, sender);
    assert(claim, "Take the task before messaging its poster.", 403);
    claimId = claim.id;
  } else if (claimId) {
    assert(db.prepare("SELECT 1 FROM mk_claims WHERE id=? AND task_id=?").get(claimId, task.id), "Unknown player.");
  }
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM mk_messages WHERE sender=? AND created_at>?")
    .get(sender, now - 3_600_000).n;
  assert(count < 60, "You are sending messages too fast.", 429);
  const msgId = id("msg");
  db.prepare("INSERT INTO mk_messages VALUES (?,?,?,?,?,?)").run(msgId, task.id, claimId, sender, body, now);
  return { id: msgId };
}

export function rateClaim(db, rater, claimId, stars, comment = "", now = Date.now()) {
  ensureMarketSchema(db);
  const claim = db.prepare("SELECT * FROM mk_claims WHERE id=?").get(claimId);
  const task = claim && db.prepare("SELECT * FROM mk_tasks WHERE id=?").get(claim.task_id);
  assert(task && (task.poster === rater || claim.worker === rater), "This is not your task.", 403);
  assert(["paid", "rejected"].includes(claim.state), "Rate after the task is settled.");
  int(stars, 1, 5, "Give 1–5 stars.");
  const ratee = rater === task.poster ? claim.worker : task.poster;
  db.prepare("INSERT INTO mk_ratings VALUES (?,?,?,?,?,?) ON CONFLICT(claim_id,rater) DO UPDATE SET stars=excluded.stars,text=excluded.text").run(
    claimId, rater, ratee, stars, text(comment, 0, 300, "Keep the comment under 300 characters."), now,
  );
  return { ok: true };
}

// ---------------------------------------------------------------- secrets
export function createSecret(db, creator, input, now = Date.now()) {
  ensureMarketSchema(db);
  const kind = input.kind ?? "place";
  assert(SECRET_KINDS.includes(kind), "Choose a Secret type.");
  const title = text(input.title, 3, 80, "Give the Secret a title (3–80 characters).");
  const teaser = text(input.teaser ?? "", 0, 300, "Keep the teaser under 300 characters.");
  const reveal = text(input.reveal, 10, 2000, "Describe what the explorer finds (at least 10 characters).");
  let route = [];
  let target = point(input);
  if (kind === "route") {
    assert(Array.isArray(input.route) && input.route.length >= 2 && input.route.length <= 30, "A route has 2–30 points.");
    route = input.route.map((p) => {
      point(p);
      return { lat: p.lat, lng: p.lng };
    });
    target = route.at(-1);
  }
  // The creator stands at the hidden place (or the route's start) when hiding it.
  atPlace(input.fix, kind === "route" ? route[0] : target, 150, now);
  const radius = int(input.fogRadiusM ?? 700, 500, 1000, "The fog circle is 500–1000 m.");
  const price = kind === "sponsored" ? 0 : int(input.price ?? 0, 0, 10_000 * GOLD, "Set a price up to 10,000 GOLD.");
  let visitReward = 0,
    visits = 0,
    held = 0,
    feeHeld = 0;
  if (kind === "sponsored") {
    visitReward = int(input.visitReward, 0.01 * GOLD, 1_000 * GOLD, "Set a visit reward between 0.01 and 1,000 GOLD.");
    visits = int(input.visits ?? 10, 1, MAX_ESCROW_SLOTS, "Fund 1–50 visits.");
    held = visitReward * visits;
    feeHeld = feeOnTop(held);
  }
  // A paid or sponsored Secret moves QGOLD: the creator needs an account.
  const account = held || price ? (requireEscrow(), requireAccount(db, creator)) : null;
  const secretId = id("secret"),
    fog = fogCentre(secretId, target.lat, target.lng, radius),
    link = kind === "private" ? key() : null;
  const funding = atomic(db, () => {
    const open = db.prepare("SELECT COUNT(*) AS n FROM mk_secrets WHERE creator=? AND state IN ('open','funding')").get(creator).n;
    assert(open < MAX_OPEN_PER_PLAYER, "You have too many open Secrets.");
    db.prepare(
      "INSERT INTO mk_secrets(id,creator,kind,title,teaser,reveal,lat,lng,route,fog_lat,fog_lng,fog_radius_m,price_u,link_key,visit_reward_u,visits_left,held_u,fee_held_u,currency,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(secretId, creator, kind, title, teaser, reveal, target.lat, target.lng, JSON.stringify(route), fog.lat, fog.lng, radius, price, link, visitReward, visits, held, feeHeld, CURRENCY, held ? "funding" : "open", now, now);
    if (!held) return null;
    // The sponsor's finder rewards are one escrow task: a slot per visit.
    const msg = { kind: "task", id: secretId, reward: String(held), deadline_ms: String(now + SPONSOR_DAYS * DAY), slots: visits };
    return openFunding(db, { escrowId: secretId, target: "sponsor", ref: secretId, player: creator, account, amount: held + feeHeld, msg }, now);
  });
  return { id: secretId, linkKey: link, charged: held + feeHeld, state: held ? "funding" : "open", funding };
}

function canSeeSecret(secret, viewer, linkKey) {
  if (secret.creator === viewer) return true;
  if (secret.kind === "private") return !!linkKey && linkKey === secret.link_key;
  return true;
}
function secretView(db, viewer, s, reveal, from) {
  const mine = s.creator === viewer;
  const open = mine || (reveal && !["refunded", "funding"].includes(reveal.state));
  const view = {
    id: s.id,
    kind: s.kind,
    title: s.title,
    teaser: s.teaser,
    creator: { id: s.creator, name: name(db, s.creator), rating: ratingOf(db, s.creator) },
    fog: { lat: s.fog_lat, lng: s.fog_lng, radiusM: s.fog_radius_m },
    price: s.price_u,
    visitReward: s.visit_reward_u,
    visitsLeft: s.visits_left,
    currency: s.currency,
    state: s.state,
    inside: from ? distance(from, { lat: s.fog_lat, lng: s.fog_lng }) <= s.fog_radius_m : false,
    revealed: !!open,
    mine,
    reveal: reveal ? { id: reveal.id, state: reveal.state, visitedAt: reveal.visited_at, releaseAt: reveal.created_at + SECRET_RELEASE_MS } : null,
  };
  if (open) {
    view.place = { lat: s.lat, lng: s.lng };
    view.route = parse(s.route, []);
    view.text = s.reveal;
  }
  if (mine) {
    view.linkKey = s.link_key;
    view.reveals = db.prepare("SELECT COUNT(*) AS n FROM mk_reveals WHERE secret_id=?").get(s.id).n;
    view.held = s.held_u;
  }
  return view;
}
function sweepReveals(db, now, where = "1=1", args = []) {
  for (const r of db
    .prepare(`SELECT * FROM mk_reveals WHERE state='held' AND created_at<? AND ${where}`)
    .all(now - SECRET_RELEASE_MS, ...args))
    releaseReveal(db, r, now, "7 days");
}
const RELEASE_CALL = {
  visit: ["confirm_visit", (id) => ({ id })],
  "7 days": ["release_secret", (id) => ({ id })],
  moderator: ["resolve_secret", (id) => ({ id, refund: false })],
};
function releaseReveal(db, reveal, now, how) {
  const s = db.prepare("SELECT * FROM mk_secrets WHERE id=?").get(reveal.secret_id);
  const cut = Math.ceil((reveal.held_u * MARKET_FEE_BPS) / 10_000);
  db.prepare("UPDATE mk_reveals SET held_u=0,state='released',updated_at=? WHERE id=?").run(now, reveal.id);
  const [method, args] = RELEASE_CALL[how];
  enqueue(db, reveal.id, method, args(reveal.id), now);
  payOutPlayer(db, s.creator, now);
  payOutTreasury(db, now);
  note(db, s.creator, "secret", `Secret sold: ${s.title}`, reveal.held_u - cut, { secretId: s.id, revealId: reveal.id, how });
  fee(db, "secret", reveal.id, cut, s.currency, now);
}

export function getSecret(db, viewer, secretId, { linkKey, from } = {}, now = Date.now()) {
  ensureMarketSchema(db);
  atomic(db, () => sweepReveals(db, now, "secret_id=?", [secretId]));
  const s = db.prepare("SELECT * FROM mk_secrets WHERE id=?").get(secretId);
  assert(s && canSeeSecret(s, viewer, linkKey), "This Secret is not available.", 404);
  const reveal = db.prepare("SELECT * FROM mk_reveals WHERE secret_id=? AND buyer=?").get(s.id, viewer);
  return secretView(db, viewer, s, reveal, from);
}

export function revealSecret(db, buyer, secretId, { linkKey } = {}, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const s = db.prepare("SELECT * FROM mk_secrets WHERE id=?").get(secretId);
    assert(s && canSeeSecret(s, buyer, linkKey), "This Secret is not available.", 404);
    assert(s.state === "open", "This Secret is closed.");
    assert(s.creator !== buyer, "This is your own Secret.");
    const before = db.prepare("SELECT * FROM mk_reveals WHERE secret_id=? AND buyer=?").get(s.id, buyer);
    if (before?.state === "funding")
      return { id: before.id, state: "funding", funding: pendingFunding(db, before.id, buyer), secret: secretView(db, buyer, s, before) };
    assert(!before, "You already revealed it.");
    const revealId = id("reveal");
    let funding = null;
    if (s.price_u > 0) {
      requireEscrow();
      const msg = { kind: "secret", id: revealId, secret_id: s.id, creator: requireAccount(db, s.creator, "The creator needs"), price: String(s.price_u) };
      funding = openFunding(db, { escrowId: revealId, target: "reveal", ref: revealId, player: buyer, account: requireAccount(db, buyer), amount: s.price_u, msg }, now);
    } else if (s.kind === "sponsored") requireAccount(db, buyer);
    db.prepare("INSERT INTO mk_reveals(id,secret_id,buyer,price_u,held_u,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(
      revealId, s.id, buyer, s.price_u, s.price_u, s.price_u > 0 ? "funding" : "free", now, now,
    );
    const r = db.prepare("SELECT * FROM mk_reveals WHERE id=?").get(revealId);
    return { id: revealId, state: r.state, funding, secret: secretView(db, buyer, s, r) };
  });
}

/** The buyer reached the place: releases the creator's 90 % and pays a sponsored visit reward. */
export function visitSecret(db, buyer, secretId, fix, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const s = db.prepare("SELECT * FROM mk_secrets WHERE id=?").get(secretId);
    const reveal = s && db.prepare("SELECT * FROM mk_reveals WHERE secret_id=? AND buyer=?").get(s.id, buyer);
    assert(reveal && !["refunded", "funding"].includes(reveal.state), "Reveal the Secret first.");
    assert(!reveal.visited_at, "You already found it.");
    atPlace(fix, { lat: s.lat, lng: s.lng }, VISIT_RADIUS_M, now);
    db.prepare("UPDATE mk_reveals SET visited_at=?,updated_at=? WHERE id=?").run(now, now, reveal.id);
    if (reveal.state === "held") releaseReveal(db, reveal, now, "visit");
    let reward = 0;
    if (s.kind === "sponsored" && s.visits_left > 0 && s.held_u >= s.visit_reward_u) {
      reward = s.visit_reward_u;
      const last = s.visits_left === 1,
        cut = last ? s.fee_held_u : Math.min(s.fee_held_u, feeOnTop(reward));
      db.prepare("UPDATE mk_secrets SET held_u=held_u-?,fee_held_u=fee_held_u-?,visits_left=visits_left-1,state=CASE WHEN visits_left-1<=0 THEN 'done' ELSE state END,updated_at=? WHERE id=?").run(reward, cut, now, s.id);
      const finder = requireAccount(db, buyer);
      enqueue(db, s.id, "approve_task", { id: s.id, worker: finder }, now);
      payOutPlayer(db, buyer, now);
      payOutTreasury(db, now);
      note(db, buyer, "secret", `Found: ${s.title}`, reward, { secretId: s.id });
      fee(db, "sponsored", reveal.id, cut, s.currency, now);
    }
    return { found: true, reward };
  });
}

export function disputeReveal(db, buyer, secretId, reason, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const reveal = db.prepare("SELECT * FROM mk_reveals WHERE secret_id=? AND buyer=?").get(secretId, buyer);
    assert(reveal?.state === "held", "Only a paid Secret that is not yet released can be disputed.");
    assert(now - reveal.created_at < SECRET_RELEASE_MS, "The dispute window has closed.");
    db.prepare("UPDATE mk_reveals SET state='disputed',dispute=?,updated_at=? WHERE id=?").run(
      text(reason, 5, 500, "Explain the problem (5–500 characters)."), now, reveal.id,
    );
    enqueue(db, reveal.id, "dispute_secret", { id: reveal.id }, now);
    return { state: "disputed" };
  });
}
export function resolveReveal(db, revealId, refund, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const reveal = db.prepare("SELECT * FROM mk_reveals WHERE id=?").get(revealId);
    assert(reveal?.state === "disputed", "No open dispute.");
    if (!refund) return releaseReveal(db, reveal, now, "moderator"), { state: "released" };
    const s = db.prepare("SELECT title FROM mk_secrets WHERE id=?").get(reveal.secret_id);
    db.prepare("UPDATE mk_reveals SET held_u=0,state='refunded',updated_at=? WHERE id=?").run(now, reveal.id);
    enqueue(db, reveal.id, "resolve_secret", { id: reveal.id, refund: true }, now);
    payOutPlayer(db, reveal.buyer, now);
    note(db, reveal.buyer, "refund", `Secret refund: ${s.title}`, reveal.held_u, { revealId });
    return { state: "refunded" };
  });
}
export function closeSecret(db, creator, secretId, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    const s = db.prepare("SELECT * FROM mk_secrets WHERE id=?").get(secretId);
    assert(s && s.creator === creator, "This is not your Secret.", 403);
    assert(s.state === "open", "This Secret is already closed.");
    const back = s.held_u + s.fee_held_u;
    db.prepare("UPDATE mk_secrets SET held_u=0,fee_held_u=0,state='closed',updated_at=? WHERE id=?").run(now, s.id);
    if (back > 0) {
      enqueue(db, s.id, "cancel_task", { id: s.id }, now);
      payOutPlayer(db, creator, now);
    }
    note(db, creator, "refund", `Secret closed: ${s.title}`, back, { secretId: s.id });
    return { refunded: back };
  });
}

// ---------------------------------------------------------------- transfers
export function createTransfer(db, sender, input, now = Date.now()) {
  ensureMarketSchema(db);
  const receiver = resolvePlayer(db, input.to);
  assert(receiver && receiver !== sender, "Choose another player to send to.");
  const amountU = int(input.amount, 0.01 * GOLD, 100_000 * GOLD, "Send between 0.01 and 100,000 GOLD.");
  const condition = input.condition ?? "both_confirm";
  assert(TRANSFER_CONDITIONS.includes(condition), "Choose when the GOLD is released.");
  const expires = now + int(input.days ?? 7, 1, 60, "A conditional send lasts 1–60 days.") * DAY;
  let atMs = null,
    place = null,
    radius = null;
  if (condition === "after") {
    atMs = int(input.at, now + 60_000, expires - 60_000, "Pick a release time before the send expires.");
  }
  if (condition === "gps") {
    place = point(input.place ?? {});
    radius = int(input.radiusM ?? 60, 20, 500, "The place radius must be 20–500 m.");
  }
  const memo = text(input.note ?? "", 0, 200, "Keep the note under 200 characters.");
  requireEscrow();
  const account = requireAccount(db, sender);
  const to = requireAccount(db, receiver, "The receiver needs");
  const transferId = id("xfer");
  const chainCondition =
    condition === "after"
      ? { type: "after", at_ms: String(atMs) }
      : condition === "gps"
        ? { type: "gps", place_id: transferId, radius_m: radius }
        : { type: "both_confirm" };
  const funding = atomic(db, () => {
    db.prepare(
      "INSERT INTO mk_transfers(id,sender,receiver,amount_u,held_u,condition,at_ms,lat,lng,radius_m,note,currency,state,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'funding',?,?,?)",
    ).run(transferId, sender, receiver, amountU, amountU, condition, atMs, place?.lat ?? null, place?.lng ?? null, radius, memo, CURRENCY, expires, now, now);
    const msg = { kind: "transfer", id: transferId, to, condition: chainCondition, expires_ms: String(expires) };
    return openFunding(db, { escrowId: transferId, target: "transfer", ref: transferId, player: sender, account, amount: amountU, msg }, now);
  });
  return { id: transferId, state: "funding", funding };
}
function settleTransfer(db, t, to, state, now, method) {
  db.prepare("UPDATE mk_transfers SET held_u=0,state=?,updated_at=? WHERE id=?").run(state, now, t.id);
  enqueue(db, t.id, method, { id: t.id }, now);
  payOutPlayer(db, to, now);
  note(db, to, state === "released" ? "transfer" : "refund",
    state === "released" ? `GOLD from ${name(db, t.sender)}` : `Send returned: ${name(db, t.receiver)}`, t.held_u, { transferId: t.id });
}
function sweepTransfers(db, now, player) {
  for (const t of db
    .prepare("SELECT * FROM mk_transfers WHERE state='held' AND (sender=? OR receiver=?) AND ((condition='after' AND at_ms<=?) OR expires_at<=?)")
    .all(player, player, now, now)) {
    if (t.condition === "after" && t.at_ms <= now) settleTransfer(db, t, t.receiver, "released", now, "release_transfer");
    else settleTransfer(db, t, t.sender, "refunded", now, "refund_transfer");
  }
}
export function actOnTransfer(db, player, transferId, action, { fix } = {}, now = Date.now()) {
  ensureMarketSchema(db);
  return atomic(db, () => {
    sweepTransfers(db, now, player);
    const t = db.prepare("SELECT * FROM mk_transfers WHERE id=?").get(transferId);
    assert(t && (t.sender === player || t.receiver === player), "This send is not yours.", 404);
    assert(t.state === "held", "This send is already settled.");
    if (action === "decline") {
      assert(player === t.receiver, "Only the receiver can decline.");
      settleTransfer(db, t, t.sender, "refunded", now, "decline_transfer");
      return { state: "refunded" };
    }
    if (action === "cancel") {
      assert(player === t.sender, "Only the sender can cancel.");
      assert(t.condition !== "after", "A timed send releases on its date. The receiver can decline it.");
      // The escrow returns a held send to its sender only after it expires.
      assert(now >= t.expires_at, "A send comes back after it expires. The receiver can decline it sooner.");
      settleTransfer(db, t, t.sender, "refunded", now, "refund_transfer");
      return { state: "refunded" };
    }
    if (action === "confirm") {
      assert(t.condition === "both_confirm", "This send releases by itself.");
      const column = player === t.sender ? "sender_ok" : "receiver_ok";
      db.prepare(`UPDATE mk_transfers SET ${column}=1,updated_at=? WHERE id=?`).run(now, t.id);
      const fresh = db.prepare("SELECT * FROM mk_transfers WHERE id=?").get(t.id);
      if (fresh.sender_ok && fresh.receiver_ok) {
        settleTransfer(db, fresh, fresh.receiver, "released", now, "confirm_transfer");
        return { state: "released" };
      }
      return { state: "held", waitingFor: fresh.sender_ok ? "receiver" : "sender" };
    }
    if (action === "arrive") {
      assert(t.condition === "gps" && player === t.receiver, "Only the receiver can claim this at the place.");
      atPlace(fix, { lat: t.lat, lng: t.lng }, t.radius_m, now);
      settleTransfer(db, t, t.receiver, "released", now, "confirm_transfer_gps");
      return { state: "released" };
    }
    assert(false, "Unknown action.");
  });
}
function transferView(db, viewer, t) {
  return {
    id: t.id,
    from: { id: t.sender, name: name(db, t.sender) },
    to: { id: t.receiver, name: name(db, t.receiver) },
    amount: t.amount_u,
    condition: t.condition,
    at: t.at_ms,
    place: t.lat === null ? null : { lat: t.lat, lng: t.lng, radiusM: t.radius_m },
    senderConfirmed: !!t.sender_ok,
    receiverConfirmed: !!t.receiver_ok,
    note: t.note,
    state: t.state,
    expiresAt: t.expires_at,
    incoming: t.receiver === viewer,
  };
}
export function listTransfers(db, player, now = Date.now()) {
  ensureMarketSchema(db);
  atomic(db, () => sweepTransfers(db, now, player));
  return db
    .prepare("SELECT * FROM mk_transfers WHERE sender=? OR receiver=? ORDER BY created_at DESC LIMIT 40")
    .all(player, player)
    .map((t) => transferView(db, player, t));
}

// ---------------------------------------------------------------- nearby
/** Explorer "Nearby" tab: public tasks around, tasks for me, Secrets as fog circles. */
export function nearby(db, viewer, at, now = Date.now()) {
  ensureMarketSchema(db);
  point(at);
  const [a, b, c, d] = box(at.lat, at.lng, NEARBY_TASK_M);
  const near = db
    .prepare("SELECT * FROM mk_tasks WHERE state='open' AND visibility='public' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 200")
    .all(a, b, c, d);
  const forMe = db
    .prepare(
      "SELECT * FROM mk_tasks WHERE state='open' AND (assignee=? OR (visibility='group' AND EXISTS (SELECT 1 FROM json_each(group_ids) WHERE value=?))) LIMIT 50",
    )
    .all(viewer, viewer);
  const mine = db.prepare("SELECT * FROM mk_tasks WHERE poster=? AND state='open' ORDER BY created_at DESC LIMIT 30").all(viewer);
  const taking = db
    .prepare("SELECT t.* FROM mk_tasks t JOIN mk_claims c ON c.task_id=t.id WHERE c.worker=? AND c.state IN ('reserved','offered','submitted','disputed') ORDER BY c.updated_at DESC LIMIT 30")
    .all(viewer);
  const seen = new Set();
  const view = (rows) =>
    rows
      .filter((t) => !seen.has(t.id) && seen.add(t.id))
      .filter((t) => t.deadline > now && parentDone(db, t, viewer))
      .map((t) => ({ ...taskView(db, viewer, t, now), distanceM: Math.round(distance(at, t)) }));
  const takingView = view(taking),
    forMeView = view(forMe),
    mineView = view(mine);
  const tasks = view(near)
    .filter((t) => t.remaining > 0 || t.payoutMode === "best")
    .sort((x, y) => x.distanceM - y.distanceM)
    .slice(0, 50);
  const [e, f, g, h] = box(at.lat, at.lng, NEARBY_SECRET_M);
  const secrets = db
    .prepare("SELECT * FROM mk_secrets WHERE state='open' AND kind!='private' AND fog_lat BETWEEN ? AND ? AND fog_lng BETWEEN ? AND ? LIMIT 100")
    .all(e, f, g, h)
    .concat(db.prepare("SELECT * FROM mk_secrets WHERE creator=? AND state='open' AND kind='private'").all(viewer))
    .map((s) => {
      const reveal = db.prepare("SELECT * FROM mk_reveals WHERE secret_id=? AND buyer=?").get(s.id, viewer);
      return { ...secretView(db, viewer, s, reveal, at), distanceM: Math.round(distance(at, { lat: s.fog_lat, lng: s.fog_lng })) };
    })
    .sort((x, y) => x.distanceM - y.distanceM);
  return { tasks, forMe: forMeView, taking: takingView, mine: mineView, secrets, transfers: listTransfers(db, viewer, now).filter((t) => t.state === "held") };
}

// ---------------------------------------------------------------- audit
/** Escrow totals and fee totals; every held GOLD is in exactly one row. */
export function marketStats(db) {
  ensureMarketSchema(db);
  const one = (sql) => db.prepare(sql).get().n ?? 0;
  return {
    feeBps: MARKET_FEE_BPS,
    held: {
      tasks: one("SELECT SUM(held_u+fee_held_u) AS n FROM mk_tasks"),
      secrets: one("SELECT SUM(held_u+fee_held_u) AS n FROM mk_secrets") + one("SELECT SUM(held_u) AS n FROM mk_reveals"),
      transfers: one("SELECT SUM(held_u) AS n FROM mk_transfers"),
    },
    fees: one("SELECT SUM(amount_u) AS n FROM mk_fees"),
    openTasks: one("SELECT COUNT(*) AS n FROM mk_tasks WHERE state='open'"),
    openSecrets: one("SELECT COUNT(*) AS n FROM mk_secrets WHERE state='open'"),
  };
}
/** Closed rows must hold nothing; open rows never hold a negative amount (CHECKs). */
export function marketInvariant(db) {
  ensureMarketSchema(db);
  const bad = [
    db.prepare("SELECT COUNT(*) AS n FROM mk_tasks WHERE state NOT IN ('open','funding') AND (held_u>0 OR fee_held_u>0)").get().n,
    db.prepare("SELECT COUNT(*) AS n FROM mk_secrets WHERE state NOT IN ('open','funding') AND (held_u>0 OR fee_held_u>0)").get().n,
    db.prepare("SELECT COUNT(*) AS n FROM mk_reveals WHERE state NOT IN ('held','disputed','funding') AND held_u>0").get().n,
    db.prepare("SELECT COUNT(*) AS n FROM mk_transfers WHERE state NOT IN ('held','funding') AND held_u>0").get().n,
  ];
  return { ok: bad.every((n) => n === 0), bad };
}

// ---------------------------------------------------------------- funding
function fundingTarget(db, table, ref) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(ref);
  assert(row?.state === "funding", "Payment needs reconciliation with its original order.", 409, "FUNDING_RECONCILIATION_REQUIRED");
  return row;
}
function activateTaskFunding(db, ref, now, f, evidence, sponsored = false) {
  const table = sponsored ? "mk_secrets" : "mk_tasks";
  fundingTarget(db, table, ref);
  if (evidence.status === "open") {
    db.prepare(`UPDATE ${table} SET state='open',updated_at=? WHERE id=?`).run(now, ref);
    return;
  }
  const paid = evidence.status === "paid";
  if (sponsored)
    db.prepare("UPDATE mk_secrets SET state=?,held_u=0,fee_held_u=0,visits_left=0,updated_at=? WHERE id=?")
      .run(paid ? "done" : "closed", now, ref);
  else
    db.prepare("UPDATE mk_tasks SET state=?,held_u=0,fee_held_u=0,paid_slots=?,updated_at=? WHERE id=?")
      .run(paid ? "done" : "cancelled", evidence.paidSlots, now, ref);
  if (paid) {
    for (const account of evidence.paidWorkers) payOut(db, account, now);
    payOutTreasury(db, now);
    fee(db, sponsored ? "sponsored" : "task", ref, evidence.fee, CURRENCY, now);
  } else payOut(db, f.account, now);
}

/** Called atomically with an exact, lifecycle-checked FINAL escrow snapshot. */
export const ACTIVATE = Object.freeze({
  task: (db, ref, now, f, evidence) => activateTaskFunding(db, ref, now, f, evidence),
  sponsor: (db, ref, now, f, evidence) => activateTaskFunding(db, ref, now, f, evidence, true),
  reveal: (db, ref, now, f, evidence) => {
    fundingTarget(db, "mk_reveals", ref);
    const settled = ["released", "refunded"].includes(evidence.status);
    db.prepare("UPDATE mk_reveals SET state=?,held_u=?,created_at=?,updated_at=? WHERE id=?")
      .run(evidence.status, settled ? 0 : f.amount_u, evidence.fundedAt, now, ref);
    if (evidence.status === "released") {
      payOut(db, evidence.creator, now);
      payOutTreasury(db, now);
      fee(db, "secret", ref, evidence.fee, CURRENCY, now);
    } else if (evidence.status === "refunded") payOut(db, f.account, now);
  },
  transfer: (db, ref, now, f, evidence) => {
    fundingTarget(db, "mk_transfers", ref);
    db.prepare("UPDATE mk_transfers SET state=?,held_u=?,sender_ok=?,receiver_ok=?,updated_at=? WHERE id=?")
      .run(evidence.status, evidence.status === "held" ? f.amount_u : 0,
        Number(evidence.senderConfirmed), Number(evidence.receiverConfirmed), now, ref);
    if (evidence.status === "released") payOut(db, evidence.to, now);
    else if (evidence.status === "refunded") payOut(db, f.account, now);
  },
  offer: (db, ref, now, f) => {
    const claim = db.prepare("SELECT * FROM mk_claims WHERE id=?").get(ref);
    assert(claim, "Payment needs its original counteroffer.", 409, "FUNDING_RECONCILIATION_REQUIRED");
    const extra = Number(JSON.parse(f.msg).reward);
    db.prepare("UPDATE mk_tasks SET held_u=held_u+?,fee_held_u=fee_held_u+?,updated_at=? WHERE id=?").run(extra, f.amount_u - extra, now, claim.task_id);
    const task = db.prepare("SELECT state FROM mk_tasks WHERE id=?").get(claim.task_id);
    if (claim.state === "offered" && task?.state === "open")
      db.prepare("UPDATE mk_claims SET state='reserved',reserved_until=?,updated_at=? WHERE id=?").run(now + RESERVATION_MS, now, ref);
    else {
      // The task closed while the extra was on its way: return it at once.
      db.prepare("UPDATE mk_tasks SET held_u=held_u-?,fee_held_u=fee_held_u-?,updated_at=? WHERE id=?").run(extra, f.amount_u - extra, now, claim.task_id);
      enqueue(db, f.id, "cancel_task", { id: f.id }, now);
      payOut(db, f.account, now);
    }
  },
});
/** Applied when a funding never arrived: the row holds nothing. */
export const DROP = Object.freeze({
  task: (db, ref, now) =>
    db.prepare("UPDATE mk_tasks SET state='unfunded',held_u=0,fee_held_u=0,updated_at=? WHERE id=? AND state='funding'").run(now, ref),
  sponsor: (db, ref, now) =>
    db.prepare("UPDATE mk_secrets SET state='unfunded',held_u=0,fee_held_u=0,updated_at=? WHERE id=? AND state='funding'").run(now, ref),
  reveal: (db, ref) => db.prepare("DELETE FROM mk_reveals WHERE id=? AND state='funding'").run(ref),
  transfer: (db, ref, now) =>
    db.prepare("UPDATE mk_transfers SET state='unfunded',held_u=0,updated_at=? WHERE id=? AND state='funding'").run(now, ref),
  offer: () => {},
});

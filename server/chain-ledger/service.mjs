// On-chain ledger of every coin, XP and street find (docs/CHAIN-LEDGER.md).
//
// Game code calls recordChainAction() inside the same SQLite transaction that
// credits the player. That writes one row to chain_actions: kind, XP, GOLD, a
// geohash-7 cell (about 150 m; the exact fix stays on this server), the time
// and the sha256 of the evidence. The worker (./chain.mjs) then:
//   - binds the action to the player's NEAR account (a wallet link) as soon
//     as there is one, so actions made before registering still go on chain;
//   - mode "each" (default): one chain record per action, sent in batches of
//     everything collected in the last ~2 s (one transaction);
//   - mode "daily": nothing per action; after the UTC day ends one record per
//     account and kind carries the day's totals;
//   - in both modes commits one Merkle root per UTC day (commit_day), so any
//     single action can be proven against the chain.
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { CHAIN_LEDGER_SCHEMA } from "./schema.mjs";

export { CHAIN_LEDGER_SCHEMA };
import { geohash, leafOf, merkle, sha256Hex } from "./merkle.mjs";
import { EXPLORER_BASE } from "../native/network.mjs";

const explorerTxUrl = (tx) => `${EXPLORER_BASE}/txns/${tx}`;

export const KINDS = new Set([
  "coin",
  "find",
  "quest",
  "chest",
  "clue",
  "monster",
  "boss",
  "errand",
  "board",
  "roll",
  "other",
]);
export const MAX_BATCH = 25;
const DAY_MS = 86_400_000;
const enabled = new WeakMap();

/** Settings from the environment. Mainnet stays off unless set explicitly. */
export function chainLedgerSettings(env = process.env, network = "testnet") {
  const raw = String(
    env.CHAIN_RECORD_MODE || (network === "mainnet" ? "off" : "each"),
  ).toLowerCase();
  const mode = ["each", "daily", "off"].includes(raw) ? raw : "each";
  const batchMs = Math.max(
    500,
    Math.min(60_000, Number(env.CHAIN_BATCH_MS) || 2_000),
  );
  // Grace after a UTC day ends before its root is committed (late requests).
  const dayGraceMs = Math.max(0, Number(env.CHAIN_DAY_GRACE_MS ?? 10 * 60_000));
  return {
    mode,
    batchMs,
    dayGraceMs,
    dayRoots: env.CHAIN_DAY_ROOTS !== "0",
    network,
  };
}

/** The exact fix as evidence (hashed on chain, kept on this server). */
export function fixEvidence(fix) {
  if (!fix || typeof fix !== "object") return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    lat: n(fix.lat),
    lng: n(fix.lng),
    accuracy: n(fix.accuracy),
    at: n(fix.at ?? fix.timestamp),
  };
}

export const dayOf = (at) => new Date(at).toISOString().slice(0, 10);

/** Turns recording on for this database (the server does this at start). */
export function enableChainLedger(db, settings) {
  ensureModuleVersion(db, CHAIN_LEDGER_SCHEMA);
  if (settings?.mode && settings.mode !== "off") enabled.set(db, settings);
  else enabled.delete(db);
}

export const chainLedgerEnabled = (db) => enabled.has(db);

/**
 * Records one earning action for the chain. Call inside the transaction that
 * credits the player. Returns { id, status } for the API response, or null
 * when recording is off or the action earned nothing.
 *   kind: coin | find | quest | chest | clue | monster | boss | errand | board | roll | other
 *   at:   { lat, lng } of the place (cell only goes on chain), optional
 *   evidence: what the server checked (coin id, fix, accuracy...), kept here
 */
export function recordChainAction(
  db,
  {
    player,
    kind,
    xp = 0,
    gold = 0,
    at = null,
    ref = null,
    evidence = {},
    now = Date.now(),
  },
) {
  const settings = enabled.get(db);
  if (!settings) return null;
  xp = Math.max(0, Math.floor(Number(xp) || 0));
  gold = Math.max(0, Math.floor(Number(gold) || 0));
  if (!player || (!xp && !gold)) return null;
  const k = KINDS.has(kind) ? kind : "other";
  const cell =
    at && Number.isFinite(at.lat) && Number.isFinite(at.lng)
      ? geohash(at.lat, at.lng, 7)
      : null;
  const id = `ca_${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const evidenceJson = JSON.stringify({
    v: 1,
    id,
    kind: k,
    ref,
    xp,
    gold,
    at: now,
    ...evidence,
  });
  let account = null;
  try {
    account =
      db
        .prepare(
          "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at LIMIT 1",
        )
        .get(player)?.account_id ?? null;
  } catch {
    /* No wallet links on this database: the worker binds later. */
  }
  db.prepare(
    "INSERT INTO chain_actions(id,player_id,kind,xp,gold_u,cell,at,day,evidence,evidence_json,account_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    player,
    k,
    xp,
    gold,
    cell,
    now,
    dayOf(now),
    sha256Hex(evidenceJson),
    evidenceJson,
    account,
    now,
  );
  return {
    id,
    status: account ? "queued" : "no-account",
    mode: settings.mode,
    tx: null,
    explorer: null,
  };
}

export function createChainLedger(
  db,
  { settings, linkedAccount, now = () => Date.now() },
) {
  enableChainLedger(db, settings);
  const q = {
    unboundPlayers: db.prepare(
      "SELECT DISTINCT player_id FROM chain_actions WHERE account_id IS NULL LIMIT ?",
    ),
    bind: db.prepare(
      "UPDATE chain_actions SET account_id=? WHERE player_id=? AND account_id IS NULL",
    ),
    eachPending: db.prepare(
      "SELECT * FROM chain_actions WHERE account_id IS NOT NULL AND record_id IS NULL ORDER BY at,id LIMIT ?",
    ),
    seq: db.prepare("SELECT last_seq FROM chain_seq WHERE account_id=?"),
    setSeq: db.prepare(
      "INSERT INTO chain_seq(account_id,last_seq) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET last_seq=excluded.last_seq",
    ),
    insertRecord: db.prepare(
      "INSERT INTO chain_records(id,account_id,seq,kind,xp,gold_u,count,cell,at,ev,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?)",
    ),
    link: db.prepare("UPDATE chain_actions SET record_id=? WHERE id=?"),
    due: db.prepare(
      "SELECT * FROM chain_records WHERE status='queued' AND next_at<=? ORDER BY seq,id LIMIT 200",
    ),
    action: db.prepare("SELECT * FROM chain_actions WHERE id=?"),
    record: db.prepare("SELECT * FROM chain_records WHERE id=?"),
    day: db.prepare("SELECT * FROM chain_days WHERE day=?"),
  };

  function nextSeq(account, chainLastSeq = 0) {
    const last = Math.max(q.seq.get(account)?.last_seq ?? 0, chainLastSeq);
    q.setSeq.run(account, last + 1);
    return last + 1;
  }

  /** Binds unbound actions to the player's NEAR account, when there is one. */
  function bindAccounts(limit = 50) {
    let bound = 0;
    for (const { player_id } of q.unboundPlayers.all(limit)) {
      const account = linkedAccount(player_id);
      if (account) bound += q.bind.run(account, player_id).changes;
    }
    return bound;
  }

  /** Accounts that will get a new seq: the caller may seed them from the chain. */
  function accountsNeedingSeq() {
    const accounts = new Set();
    if (settings.mode === "each")
      for (const a of q.eachPending.all(MAX_BATCH * 4))
        if (!q.seq.get(a.account_id)) accounts.add(a.account_id);
    return [...accounts];
  }

  /** Mode each: one record per bound action. `chainSeq` seeds new accounts. */
  function planEach(chainSeq = {}) {
    if (settings.mode !== "each") return 0;
    const rows = q.eachPending.all(MAX_BATCH * 4);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const a of rows) {
        const seq = nextSeq(a.account_id, chainSeq[a.account_id] || 0);
        q.insertRecord.run(
          a.id,
          a.account_id,
          seq,
          a.kind,
          a.xp,
          a.gold_u,
          1,
          a.cell,
          a.at,
          a.evidence,
          now(),
        );
        q.link.run(a.id, a.id);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return rows.length;
  }

  /** Days that ended (plus grace) and have no root yet. */
  function daysToCommit() {
    if (!settings.dayRoots && settings.mode !== "daily") return [];
    return db
      .prepare(
        "SELECT DISTINCT a.day FROM chain_actions a LEFT JOIN chain_days d ON d.day=a.day WHERE d.day IS NULL AND a.day<? ORDER BY a.day LIMIT 3",
      )
      .all(dayOf(now()))
      .map((r) => r.day)
      .filter(
        (d) =>
          Date.parse(d + "T00:00:00Z") + DAY_MS + settings.dayGraceMs <= now(),
      );
  }

  /** Builds and stores a day's root (leaves are fixed at this moment). */
  function prepareDay(day) {
    const existing = q.day.get(day);
    if (existing) return existing;
    const rows = db
      .prepare("SELECT * FROM chain_actions WHERE day=? ORDER BY at,id")
      .all(day);
    if (!rows.length) return null;
    const leaves = rows.map(leafOf);
    const { root } = merkle(leaves);
    db.exec("BEGIN IMMEDIATE");
    try {
      const setLeaf = db.prepare("UPDATE chain_actions SET leaf=? WHERE id=?");
      rows.forEach((r, i) => setLeaf.run(leaves[i], r.id));
      db.prepare(
        "INSERT INTO chain_days(day,root,count,xp,gold_u,status,created_at) VALUES(?,?,?,?,?,'queued',?)",
      ).run(
        day,
        root,
        rows.length,
        rows.reduce((s, r) => s + r.xp, 0),
        rows.reduce((s, r) => s + r.gold_u, 0),
        now(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return q.day.get(day);
  }

  /** Mode daily: one record per account and kind for each committed day. */
  function planDaily(chainSeq = {}) {
    if (settings.mode !== "daily") return 0;
    const groups = db
      .prepare(
        `SELECT a.account_id,a.day,a.kind,SUM(a.xp) xp,SUM(a.gold_u) gold_u,COUNT(*) n,MAX(a.at) at,d.root
         FROM chain_actions a JOIN chain_days d ON d.day=a.day AND d.status='confirmed'
         WHERE a.account_id IS NOT NULL AND a.record_id IS NULL AND a.leaf IS NOT NULL
         GROUP BY a.account_id,a.day,a.kind ORDER BY a.day,a.account_id,a.kind LIMIT ?`,
      )
      .all(MAX_BATCH * 4);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const g of groups) {
        const id = `cd_${g.day.replaceAll("-", "")}_${g.kind}_${sha256Hex(`${g.account_id}|${g.day}|${g.kind}|${now()}`).slice(0, 10)}`;
        const seq = nextSeq(g.account_id, chainSeq[g.account_id] || 0);
        q.insertRecord.run(
          id,
          g.account_id,
          seq,
          g.kind,
          g.xp,
          g.gold_u,
          g.n,
          null,
          g.at,
          g.root,
          now(),
        );
        db.prepare(
          "UPDATE chain_actions SET record_id=? WHERE account_id=? AND day=? AND kind=? AND record_id IS NULL AND leaf IS NOT NULL",
        ).run(id, g.account_id, g.day, g.kind);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return groups.length;
  }

  /** Next batch: due records, oldest seq first, at most one gap-free run per account. */
  function nextBatch(limit = MAX_BATCH) {
    const out = [],
      blocked = new Set();
    for (const r of q.due.all(now())) {
      if (out.length >= limit) break;
      if (blocked.has(r.account_id)) continue;
      // A lower queued seq that is not due yet holds the account back.
      const lower = db
        .prepare(
          "SELECT 1 FROM chain_records WHERE account_id=? AND status='queued' AND seq<? AND next_at>?",
        )
        .get(r.account_id, r.seq, now());
      if (lower) {
        blocked.add(r.account_id);
        continue;
      }
      out.push(r);
    }
    return out;
  }

  const contractAction = (r) => ({
    account_id: r.account_id,
    seq: String(r.seq),
    kind: r.kind,
    xp: String(r.xp),
    gold: String(r.gold_u),
    count: r.count,
    cell: r.cell,
    at_ms: String(r.at),
    ev: r.ev,
    ref_id: r.id,
  });

  function markConfirmed(ids, tx) {
    const st = db.prepare(
      "UPDATE chain_records SET status='confirmed',tx=COALESCE(?,tx),error=NULL,confirmed_at=? WHERE id=?",
    );
    for (const id of ids) st.run(tx, now(), id);
  }

  function markRetry(ids, error, { final = false } = {}) {
    const st = db.prepare(
      "UPDATE chain_records SET attempts=attempts+1,error=?,next_at=?,status=CASE WHEN ? OR attempts+1>=8 THEN 'failed' ELSE 'queued' END WHERE id=?",
    );
    for (const id of ids) {
      const attempts = (q.record.get(id)?.attempts || 0) + 1;
      st.run(
        String(error).slice(0, 300),
        now() + Math.min(300_000, 2_000 * 2 ** attempts),
        final ? 1 : 0,
        id,
      );
    }
  }

  /** A first-time record the contract skipped has a stale seq: give it a new one. */
  function reseq(id, chainLastSeq) {
    const r = q.record.get(id);
    if (!r) return;
    const seq = nextSeq(r.account_id, chainLastSeq);
    db.prepare("UPDATE chain_records SET seq=?,next_at=0 WHERE id=?").run(
      seq,
      id,
    );
  }

  function markDay(day, { tx = null, error = null, confirmed = false }) {
    if (confirmed)
      db.prepare(
        "UPDATE chain_days SET status='confirmed',tx=COALESCE(?,tx),error=NULL,confirmed_at=? WHERE day=?",
      ).run(tx, now(), day);
    else
      db.prepare(
        "UPDATE chain_days SET attempts=attempts+1,error=?,next_at=?,status=CASE WHEN attempts+1>=8 THEN 'failed' ELSE 'queued' END WHERE day=?",
      ).run(String(error).slice(0, 300), now() + 60_000, day);
  }

  const dueDays = () =>
    db
      .prepare(
        "SELECT * FROM chain_days WHERE status='queued' AND next_at<=? ORDER BY day LIMIT 3",
      )
      .all(now());

  /** Proof of one action against its day's root (after the day is committed). */
  function proofOf(action) {
    if (!action.leaf) return null;
    const day = q.day.get(action.day);
    if (!day) return null;
    const rows = db
      .prepare(
        "SELECT id,leaf FROM chain_actions WHERE day=? AND leaf IS NOT NULL ORDER BY at,id",
      )
      .all(action.day);
    const i = rows.findIndex((r) => r.id === action.id);
    if (i < 0) return null;
    const { root, proofs } = merkle(rows.map((r) => r.leaf));
    return {
      day: action.day,
      leaf: action.leaf,
      root,
      proof: proofs[i],
      dayTx: day.tx,
      dayStatus: day.status,
    };
  }

  /** The API view of one action (ChainLink icon). */
  function view(action, { proof = false } = {}) {
    if (!action) return null;
    const record = action.record_id ? q.record.get(action.record_id) : null;
    const day = q.day.get(action.day);
    let status;
    if (!action.account_id) status = "no-account";
    else if (!record) status = "queued";
    else
      status =
        record.status === "confirmed"
          ? "confirmed"
          : record.status === "failed"
            ? "failed"
            : record.attempts
              ? "sent"
              : "queued";
    const tx = record?.status === "confirmed" ? record.tx : null;
    return {
      id: action.id,
      kind: action.kind,
      xp: action.xp,
      gold: action.gold_u,
      cell: action.cell,
      at: action.at,
      mode: settings.mode,
      status,
      account: action.account_id,
      tx,
      explorer: tx ? explorerTxUrl(tx) : null,
      dayTx: day?.status === "confirmed" ? day.tx : null,
      dayExplorer:
        day?.status === "confirmed" && day.tx ? explorerTxUrl(day.tx) : null,
      ...(proof ? { proof: proofOf(action) } : {}),
    };
  }

  function get(id, player) {
    const a = q.action.get(id);
    if (!a || a.player_id !== player) return null;
    return view(a, { proof: true });
  }

  function list(player, limit = 50) {
    return db
      .prepare(
        "SELECT * FROM chain_actions WHERE player_id=? ORDER BY at DESC,id DESC LIMIT ?",
      )
      .all(player, Math.max(1, Math.min(200, limit)))
      .map((a) => view(a));
  }

  function status() {
    const counts = Object.fromEntries(
      db
        .prepare("SELECT status,COUNT(*) n FROM chain_records GROUP BY status")
        .all()
        .map((r) => [r.status, r.n]),
    );
    const unbound = db
      .prepare("SELECT COUNT(*) n FROM chain_actions WHERE account_id IS NULL")
      .get().n;
    const days = db
      .prepare("SELECT day,status,tx FROM chain_days ORDER BY day DESC LIMIT 3")
      .all();
    return {
      mode: settings.mode,
      batchMs: settings.batchMs,
      records: counts,
      unbound,
      days,
    };
  }

  return {
    settings,
    bindAccounts,
    accountsNeedingSeq,
    planEach,
    planDaily,
    daysToCommit,
    prepareDay,
    dueDays,
    nextBatch,
    contractAction,
    markConfirmed,
    markRetry,
    markDay,
    reseq,
    get,
    list,
    view,
    status,
    record: (id) => q.record.get(id),
  };
}

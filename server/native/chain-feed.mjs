// The player's "On chain" feed and the chain proof attached to History rows.
// Read-only: it gathers what other modules already record (relayed explorer
// account transactions, native reward claims, badge mints, history rows that
// carry a transaction) into one newest-first list. Every item has the same
// small shape the client's ChainLink renders:
//   { id, kind, method, status: pending|confirmed|failed, tx, account,
//     receiver, at }
// Coin/XP records written by the chain-record worker are served by their own
// route (/api/chain/actions) and merged on the client.
import { EXPLORER_BASE } from "./network.mjs";

const TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
export const txHash = (value) =>
  typeof value === "string" && TX.test(value) ? value : null;
export const explorerTx = (hash) =>
  txHash(hash) ? `${EXPLORER_BASE}/txns/${hash}` : null;

const RELAY_STATUS = {
  queued: "pending",
  retrying: "pending",
  sent: "pending",
  confirmed: "confirmed",
  failed: "failed",
};
// Relayed calls by method. Unknown methods stay visible as "other".
const RELAY_KIND = {
  redeem_aura: "aura",
  mint_avatar: "avatar",
  equip_aura: "wardrobe",
  unequip_aura: "wardrobe",
  nft_transfer_call: "market",
  nft_transfer: "transfer",
  buy: "market",
  fill_sell_order: "market",
  fill_buy_order: "market",
  deposit_near: "market",
  cancel: "market",
  cancel_order: "market",
  cancel_all_orders: "market",
  add_signing_key: "market",
  remove_signing_key: "market",
  // The key that signs NEAR Intents trades, at the verifier.
  add_public_key: "key",
  remove_public_key: "key",
  start_roll: "roll",
  resolve_roll: "roll",
  claim_timeout: "roll",
  set: "profile",
  create_position: "stake",
  register_position: "stake",
  withdraw_refund: "stake",
  request_partial_exit: "stake",
  set_contribution: "stake",
  deposit_and_stake: "stake",
  request_exit: "stake",
  withdraw_owner: "stake",
  refresh: "stake",
  advance: "stake",
  harvest: "stake",
  buy_access: "creator",
  donate: "creator",
};

const tables = (db) =>
  new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
const parse = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

function relayItem(row) {
  const call = parse(row.call) || {};
  const method = row.method_name || call.kind || null;
  const kind =
    row.kind === "create-account"
      ? "account"
      : RELAY_KIND[method] ||
        (call.kind === "addKey" || call.kind === "deleteKey" ? "key" : "other");
  const args = call.args && typeof call.args === "object" ? call.args : {};
  // A stable reference other screens can look a proof up by.
  const ref =
    kind === "aura" && typeof args.claim_id === "string"
      ? `aura:${args.claim_id}`
      : kind === "roll" && typeof args.roll_id === "string"
        ? `roll:${args.roll_id}`
        : null;
  return {
    id: `relay:${row.id}`,
    ref,
    kind,
    method,
    status: RELAY_STATUS[row.state] || "pending",
    tx: txHash(row.transaction_hash),
    account: row.account_id,
    receiver: row.receiver_id,
    at: row.created_at,
  };
}

// One-time calls: a failed attempt stops mattering once the same thing
// succeeded (a retried Aura claim, a second explorer mint).
const onceKey = (item) =>
  item.kind === "aura" && item.ref
    ? item.ref
    : item.kind === "avatar" || item.kind === "account"
      ? `${item.kind}:${item.account}`
      : null;

/**
 * Removes failed relay rows whose action later succeeded, so the feed does not
 * show "Not saved" next to the "Final" row of the same Aura or explorer.
 */
function dropSuperseded(db, have, items) {
  const done = new Set(
    items
      .filter((i) => i.status === "confirmed")
      .map(onceKey)
      .filter(Boolean),
  );
  if (have.has("native_awards"))
    for (const ref of items
      .filter((i) => i.status === "failed" && i.kind === "aura" && i.ref)
      .map((i) => i.ref))
      if (
        db
          .prepare(
            "SELECT 1 FROM native_awards WHERE claim_id=? AND state='minted'",
          )
          .get(ref.slice("aura:".length))
      )
        done.add(ref);
  for (let i = items.length - 1; i >= 0; i--)
    if (items[i].status === "failed" && done.has(onceKey(items[i])))
      items.splice(i, 1);
}

/**
 * The newest on-chain actions of one player. `limit` caps the list (1..100).
 */
export function chainFeed(db, playerId, { limit = 50 } = {}) {
  const n = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 50));
  const have = tables(db);
  const items = [];
  if (have.has("relay_jobs"))
    for (const row of db
      .prepare(
        "SELECT * FROM relay_jobs WHERE player_id=? ORDER BY created_at DESC LIMIT ?",
      )
      .all(playerId, n))
      items.push(relayItem(row));
  dropSuperseded(db, have, items);
  if (have.has("native_reward_claims"))
    for (const row of db
      .prepare(
        "SELECT id,kind,state,transaction_hash,account_id,created_at,confirmed_at FROM native_reward_claims WHERE player_id=? ORDER BY created_at DESC LIMIT ?",
      )
      .all(playerId, n))
      items.push({
        id: `reward:${row.id}`,
        ref: `reward:${row.id}`,
        kind: row.kind === "quest" ? "reward-quest" : "reward-coin",
        method: "claim",
        status: row.state === "confirmed" ? "confirmed" : "pending",
        tx: txHash(row.transaction_hash),
        account: row.account_id,
        receiver: null,
        at: row.created_at,
      });
  if (have.has("user_badge_claims"))
    for (const row of db
      .prepare(
        "SELECT badge_id,state,chain_tx,account_id,created_at FROM user_badge_claims WHERE player_id=? ORDER BY created_at DESC LIMIT ?",
      )
      .all(playerId, n))
      items.push({
        id: `badge:${row.badge_id}`,
        ref: `badge:${row.badge_id}`,
        kind: "badge",
        method: "mint",
        status:
          row.state === "minted"
            ? "confirmed"
            : row.state === "failed"
              ? "failed"
              : "pending",
        tx: txHash(row.chain_tx),
        account: row.account_id,
        receiver: null,
        at: row.created_at,
      });
  // History rows that already carry a transaction (and are not one of the
  // rows above under another name).
  for (const row of db
    .prepare(
      "SELECT id,kind,meta,created_at FROM history WHERE player_id=? ORDER BY created_at DESC LIMIT 80",
    )
    .all(playerId)) {
    const chain = historyChain(row);
    if (!chain?.tx) continue;
    if (items.some((i) => i.tx === chain.tx)) continue;
    items.push({
      id: `history:${row.id}`,
      ref: null,
      kind: row.kind,
      method: null,
      status: chain.status || "confirmed",
      tx: chain.tx,
      account: chain.account || null,
      receiver: null,
      at: row.created_at,
    });
  }
  items.sort((a, b) => b.at - a.at);
  return {
    explorer: EXPLORER_BASE,
    items: items.slice(0, n).map((i) => ({ ...i, explorer: explorerTx(i.tx) })),
  };
}

/** Current state of a few feed items, for ChainLink polling. */
export function chainItems(db, playerId, ids) {
  const wanted = new Set(
    (Array.isArray(ids) ? ids : [])
      .filter((x) => typeof x === "string" && x.length <= 120)
      .slice(0, 20),
  );
  if (!wanted.size) return { items: [] };
  const have = tables(db),
    out = [];
  for (const key of wanted) {
    const [source, ...rest] = key.split(":"),
      value = rest.join(":");
    if (source === "relay" && have.has("relay_jobs")) {
      const row = db
        .prepare("SELECT * FROM relay_jobs WHERE id=? AND player_id=?")
        .get(value, playerId);
      if (row) out.push(relayItem(row));
    } else if (source === "latest") {
      // "latest:<kind>:<since ms>": the newest action of that kind since a
      // moment, for screens that just sent one and hold no reference.
      const [kind, since] = value.split(":");
      const found = chainFeed(db, playerId, { limit: 30 }).items.find(
        (i) => i.kind === kind && i.at >= (Number(since) || 0),
      );
      if (found) out.push({ ...found, id: key });
    } else if (source === "aura" || source === "roll") {
      const row = refJob(db, have, playerId, source, value);
      if (row) out.push({ ...relayItem(row), id: key });
    } else {
      const found = chainFeed(db, playerId, { limit: 100 }).items.find(
        (i) => i.id === key || i.ref === key,
      );
      if (found) out.push(found);
    }
  }
  return {
    items: out.map((i) => ({ ...i, explorer: explorerTx(i.tx) })),
  };
}

function refJob(db, have, playerId, source, value) {
  if (!have.has("relay_jobs") || !value) return null;
  const methods =
    source === "aura"
      ? ["redeem_aura"]
      : ["start_roll", "resolve_roll", "claim_timeout"];
  const arg = source === "aura" ? "$.args.claim_id" : "$.args.roll_id";
  // The latest attempt wins; a confirmed job beats a later failed retry.
  return db
    .prepare(
      `SELECT * FROM relay_jobs WHERE player_id=? AND method_name IN (${methods.map(() => "?").join(",")}) AND json_extract(call,'${arg}')=? ORDER BY (state='confirmed') DESC, seq DESC LIMIT 1`,
    )
    .get(playerId, ...methods, value);
}

/**
 * The chain proof of one history row, from its meta: an explicit `chain`
 * object (written by the chain-record worker), or a transaction hash stored
 * under one of the names modules already use.
 */
export function historyChain(row) {
  const meta = typeof row.meta === "string" ? parse(row.meta) : row.meta;
  if (!meta || typeof meta !== "object") return null;
  if (meta.chain && typeof meta.chain === "object") {
    const c = meta.chain;
    return {
      id: typeof c.id === "string" ? c.id : null,
      status: typeof c.status === "string" ? c.status : null,
      tx: txHash(c.tx),
      account: typeof c.account === "string" ? c.account : null,
      poll: typeof c.poll === "string" ? c.poll : null,
    };
  }
  const tx = txHash(
    meta.transaction ?? meta.transactionHash ?? meta.txHash ?? meta.tx,
  );
  const account =
    typeof meta.accountId === "string"
      ? meta.accountId
      : typeof meta.receiver === "string"
        ? meta.receiver
        : null;
  if (tx) return { status: "confirmed", tx, account };
  // Rows that point at a relayed job; withChain resolves the job.
  if (typeof meta.rollId === "string")
    return { ref: `roll:${meta.rollId}`, account };
  if (typeof meta.claimId === "string")
    return { ref: `aura:${meta.claimId}`, account };
  if (account && /^(native-aura|native_profile)$/.test(row.kind))
    return { status: "confirmed", tx: null, account };
  return null;
}

/** History rows with their chain proof (if any) under `chain`. */
export function withChain(db, playerId, rows) {
  let have = null;
  return rows.map((row) => {
    let chain = historyChain(row);
    if (!chain) return row;
    if (chain.ref) {
      have ??= tables(db);
      const [source, value] = [
        chain.ref.slice(0, chain.ref.indexOf(":")),
        chain.ref.slice(chain.ref.indexOf(":") + 1),
      ];
      const job = refJob(db, have, playerId, source, value);
      if (job) {
        const item = relayItem(job);
        chain = {
          id: item.id,
          status: item.status,
          tx: item.tx,
          account: item.account,
          poll: item.status === "pending" ? "feed" : null,
        };
      } else if (chain.account) chain = { status: "confirmed", tx: null, account: chain.account };
      else return row;
    }
    return { ...row, chain };
  });
}

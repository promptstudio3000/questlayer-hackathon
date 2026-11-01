// NPC trader ledger (N3): every signed order the traders issue, the Auras they
// hold with their cost basis, and the surplus swept to the rewards contract.
// The market contract stays the authority for fills; this ledger is the
// trader's books, rebuilt from the order index and on-chain ownership.
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";
import { id } from "../domain.mjs";
import { lotProfit } from "./trader-pricing.mjs";

export const NPC_TRADER_SCHEMA = registerModuleSchema({
  name: "npc-trader",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS npc_trader_trades(
 id TEXT PRIMARY KEY,
 trader TEXT NOT NULL,
 player_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('trade_buy','trade_sell','trade_up')),
 offer_id TEXT NOT NULL,
 token_id TEXT NOT NULL,
 price TEXT NOT NULL CHECK(price GLOB '[0-9]*'),
 premium TEXT NOT NULL DEFAULT '0' CHECK(premium GLOB '[0-9]*'),
 order_id TEXT,
 deadline_ms INTEGER NOT NULL,
 day_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('issued','filled','expired','cancelled','completed')),
 data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
 created_at INTEGER NOT NULL,
 settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS npc_trader_trades_player ON npc_trader_trades(trader,player_id,day_id);
CREATE INDEX IF NOT EXISTS npc_trader_trades_open ON npc_trader_trades(state,deadline_ms);
CREATE INDEX IF NOT EXISTS npc_trader_trades_offer ON npc_trader_trades(trader,player_id,offer_id);
CREATE TABLE IF NOT EXISTS npc_trader_lots(
 id TEXT PRIMARY KEY,
 trader TEXT NOT NULL,
 token_id TEXT NOT NULL,
 cost TEXT NOT NULL CHECK(cost GLOB '[0-9]*'),
 source TEXT NOT NULL CHECK(source IN ('buy','trade_up','seed')),
 trade_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('held','sold')),
 sold_price TEXT CHECK(sold_price IS NULL OR sold_price GLOB '[0-9]*'),
 acquired_at INTEGER NOT NULL,
 sold_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS npc_trader_lots_held ON npc_trader_lots(trader,token_id) WHERE state='held';
CREATE TABLE IF NOT EXISTS npc_trader_sweeps(
 id TEXT PRIMARY KEY,
 trader TEXT NOT NULL,
 amount TEXT NOT NULL CHECK(amount GLOB '[0-9]*'),
 receipt_id TEXT NOT NULL UNIQUE,
 tx_hash TEXT,
 state TEXT NOT NULL CHECK(state IN ('pending','done','failed')),
 created_at INTEGER NOT NULL
);
`,
});

const DAY = 86_400_000;
const sum = (rows, f) => rows.reduce((t, r) => t + f(r), 0n);

export function createTraderLedger(db, { clock = Date.now } = {}) {
  ensureModuleVersion(db, NPC_TRADER_SCHEMA);
  const q = (sql) => db.prepare(sql);
  const parse = (r) => (r ? { ...r, data: JSON.parse(r.data || "{}") } : null);
  return {
    trade: (tradeId) => parse(q("SELECT * FROM npc_trader_trades WHERE id=?").get(tradeId)),
    /** The live (issued, unexpired) or settled trade for an offer, if any. */
    tradeFor: (trader, player, offerId) =>
      parse(
        q(
          "SELECT * FROM npc_trader_trades WHERE trader=? AND player_id=? AND offer_id=? AND (state IN ('filled','completed') OR (state='issued' AND deadline_ms>?)) ORDER BY created_at DESC",
        ).get(trader, player, offerId, clock()),
      ),
    insertTrade(t) {
      const tradeId = id("npctrade");
      q(
        `INSERT INTO npc_trader_trades(id,trader,player_id,account_id,kind,offer_id,token_id,price,premium,order_id,deadline_ms,day_id,state,data,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'issued',?,?)`,
      ).run(
        tradeId,
        t.trader,
        t.player,
        t.accountId,
        t.kind,
        t.offerId,
        t.tokenId,
        String(t.price),
        String(t.premium ?? 0n),
        t.orderId ?? null,
        t.deadlineMs,
        t.dayId,
        JSON.stringify(t.data || {}),
        clock(),
      );
      return tradeId;
    },
    settle(tradeId, state) {
      return q("UPDATE npc_trader_trades SET state=?,settled_at=? WHERE id=? AND state='issued'").run(state, clock(), tradeId)
        .changes;
    },
    openTrades: (kind = null) =>
      q(`SELECT * FROM npc_trader_trades WHERE state='issued' ${kind ? "AND kind=?" : ""} ORDER BY created_at`)
        .all(...(kind ? [kind] : []))
        .map(parse),
    /** Trades that count against the daily caps: issued or settled, not lapsed. */
    tradesToday(trader, dayId, player = null) {
      return q(
        `SELECT count(*) n FROM npc_trader_trades WHERE trader=? AND day_id=? AND state IN ('issued','filled','completed') ${player ? "AND player_id=?" : ""}`,
      ).get(...[trader, dayId, ...(player ? [player] : [])]).n;
    },
    settledCount(trader, player) {
      return q(
        "SELECT count(*) n FROM npc_trader_trades WHERE trader=? AND player_id=? AND state IN ('filled','completed')",
      ).get(trader, player).n;
    },
    /** Premiums committed today (issued or filled buy orders). */
    premiumsToday(trader, dayId) {
      return sum(
        q("SELECT premium FROM npc_trader_trades WHERE trader=? AND day_id=? AND kind='trade_buy' AND state IN ('issued','filled')").all(
          trader,
          dayId,
        ),
        (r) => BigInt(r.premium),
      );
    },
    /** Credit promised to open buy orders (each could be filled). */
    reservedForBuys(trader) {
      return sum(
        q("SELECT price FROM npc_trader_trades WHERE trader=? AND kind='trade_buy' AND state='issued' AND deadline_ms>?").all(
          trader,
          clock(),
        ),
        (r) => BigInt(r.price),
      );
    },
    openSellFor: (trader, tokenId) =>
      parse(
        q("SELECT * FROM npc_trader_trades WHERE trader=? AND kind='trade_sell' AND token_id=? AND state='issued' AND deadline_ms>?").get(
          trader,
          tokenId,
          clock(),
        ),
      ),
    tokenInTradeUp(tokenId) {
      return !!q(
        "SELECT 1 FROM npc_trader_trades WHERE kind='trade_up' AND state IN ('issued','completed') AND EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.tokens')) WHERE value=?)",
      ).get(tokenId);
    },
    held: (trader) => q("SELECT * FROM npc_trader_lots WHERE trader=? AND state='held' ORDER BY acquired_at").all(trader),
    heldLot: (trader, tokenId) => q("SELECT * FROM npc_trader_lots WHERE trader=? AND token_id=? AND state='held'").get(trader, tokenId),
    addLot({ trader, tokenId, cost, source, tradeId = null }) {
      return q(
        "INSERT OR IGNORE INTO npc_trader_lots(id,trader,token_id,cost,source,trade_id,state,acquired_at) VALUES(?,?,?,?,?,?,'held',?)",
      ).run(id("npclot"), trader, tokenId, String(cost), source, tradeId, clock()).changes;
    },
    sellLot(trader, tokenId, price) {
      return q("UPDATE npc_trader_lots SET state='sold',sold_price=?,sold_at=? WHERE trader=? AND token_id=? AND state='held'").run(
        String(price),
        clock(),
        trader,
        tokenId,
      ).changes;
    },
    /** Realized profit of lots sold since `since` (ms). */
    profitSince(trader, since) {
      return sum(
        q("SELECT cost,sold_price FROM npc_trader_lots WHERE trader=? AND state='sold' AND sold_at>=?").all(trader, since),
        lotProfit,
      );
    },
    profit7d(trader) {
      return this.profitSince(trader, clock() - 7 * DAY);
    },
    firstActivity(trader) {
      return q("SELECT min(created_at) t FROM npc_trader_trades WHERE trader=?").get(trader).t;
    },
    recordSweep({ trader, amount, receiptId }) {
      const sweepId = id("npcsweep");
      q("INSERT INTO npc_trader_sweeps(id,trader,amount,receipt_id,state,created_at) VALUES(?,?,?,?,'pending',?)").run(
        sweepId,
        trader,
        String(amount),
        receiptId,
        clock(),
      );
      return sweepId;
    },
    finishSweep(sweepId, state, txHash = null) {
      q("UPDATE npc_trader_sweeps SET state=?,tx_hash=COALESCE(?,tx_hash) WHERE id=?").run(state, txHash, sweepId);
    },
    sweepsToday(trader, dayKey) {
      return q("SELECT count(*) n FROM npc_trader_sweeps WHERE trader=? AND receipt_id LIKE ?").get(trader, `%-${dayKey}-%`).n;
    },
    sweptTotal(trader) {
      return sum(q("SELECT amount FROM npc_trader_sweeps WHERE trader=? AND state='done'").all(trader), (r) => BigInt(r.amount));
    },
    sweeps: (trader, limit = 10) =>
      q("SELECT amount,receipt_id,tx_hash,state,created_at FROM npc_trader_sweeps WHERE trader=? ORDER BY created_at DESC LIMIT ?").all(
        trader,
        limit,
      ),
    stats(trader) {
      const row = q(
        "SELECT sum(state IN ('filled','completed')) settled, sum(kind='trade_buy' AND state='filled') bought, sum(kind='trade_sell' AND state='filled') sold, sum(kind='trade_up' AND state='completed') tradeups FROM npc_trader_trades WHERE trader=?",
      ).get(trader);
      return {
        settled: row.settled || 0,
        bought: row.bought || 0,
        sold: row.sold || 0,
        tradeUps: row.tradeups || 0,
      };
    },
  };
}

// The one place GOLD leaves a player for good (QGOLD build plan, stream 4).
// burnGold() must run inside the caller's transaction: it checks the balance,
// takes the amount out of players.gold_u, writes the burn row with its memo
// and a history line. Nothing is credited to anyone: in the QGOLD model the
// backing stays in the vault, so every burn raises R for all holders.
import { readFileSync } from "node:fs";
import { assert, GameError, id } from "../domain.mjs";
import { history } from "../database.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { GOLD_SPEND_SCHEMA } from "./schema.mjs";
import { takeQgoldCredit } from "./qgold-burn.mjs";

// "qgold" once the QGOLD vault is open (server/index.mjs): every spend needs a
// verified ft_burn credit (qgold-burn.mjs) and players.gold_u is not touched.
let realm = "practice";
export function setSpendRealm(next) {
  realm = next === "qgold" ? "qgold" : "practice";
}
export const spendRealm = () => realm;

export const GOLD_SPEND = Object.freeze(
  JSON.parse(readFileSync(new URL("../data/gold-spend.json", import.meta.url), "utf8")),
);
export const BURN_KINDS = Object.freeze(["emote", "cosmetic", "gear", "altar", "lure", "shout", "topic"]);
/**
 * Price-table GOLD to integer units. 1 in-game GOLD is the smallest QGOLD
 * unit (micro-QGOLD, owner 11 Nov 2026), so prices are already units.
 */
export const GAME_GOLD_U = 1;
export const priceU = (gold) => Math.round(Number(gold) * GAME_GOLD_U);

/** GOLD the Golden Altar takes for a recipe (whole GOLD). */
export function altarFee(recipeId) {
  return GOLD_SPEND.altar.byRecipe[recipeId] ?? GOLD_SPEND.altar.default;
}

const ready = new WeakSet();
export function ensureGoldSpend(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, GOLD_SPEND_SCHEMA);
  ready.add(db);
}

export const burnMemo = (kind, ref) => `questlayer:burn:${kind}:${ref}`.slice(0, 200);

/**
 * burnGold(db, { player, kind, ref, amountU, title, now }) -> { id, amountU, memo, balanceU }
 * Call inside atomic(). Throws 402 GOLD_LOW when the balance is short.
 */
export function burnGold(db, { player, kind, ref, amountU, title, now = Date.now(), meta = {} }) {
  ensureGoldSpend(db);
  assert(BURN_KINDS.includes(kind), "Unknown QGOLD spend.", 400, "BURN_KIND");
  assert(Number.isSafeInteger(amountU) && amountU > 0, "Invalid QGOLD amount.", 400, "BURN_AMOUNT");
  const row = db.prepare("SELECT gold_u FROM players WHERE id=?").get(player);
  assert(row, "Sign in to spend QGOLD.", 401, "AUTH");
  const burn = id("burn");
  let memo = burnMemo(kind, ref);
  if (realm === "qgold") {
    const credit = takeQgoldCredit(db, { player, kind, amountU, burnId: burn, now });
    if (!credit) {
      const error = new GameError("Burn the QGOLD for this first.", 402, "QGOLD_BURN");
      error.details = { kind, amountU };
      throw error;
    }
    memo = credit.memo;
  } else {
    assert(row.gold_u >= amountU, "Not enough QGOLD for this.", 402, "GOLD_LOW");
    db.prepare("UPDATE players SET gold_u=gold_u-? WHERE id=? AND gold_u>=?").run(amountU, player, amountU);
  }
  db.prepare(
    "INSERT INTO gold_burns(id,player_id,kind,ref,amount_u,memo,realm,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(burn, player, kind, String(ref).slice(0, 120), amountU, memo, realm, now);
  history(db, player, "burn", title || `Spent QGOLD: ${kind}`, -amountU, { burn, kind, ref, memo, realm, ...meta });
  return { id: burn, amountU, memo, realm, balanceU: realm === "qgold" ? null : row.gold_u - amountU };
}

/** Public burn totals for the economy page. */
export function burnTotals(db, now = Date.now()) {
  ensureGoldSpend(db);
  const rows = db
    .prepare("SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount_u),0) AS u FROM gold_burns GROUP BY kind")
    .all();
  const day = db
    .prepare("SELECT COALESCE(SUM(amount_u),0) AS u FROM gold_burns WHERE created_at>?")
    .get(now - 86_400_000).u;
  return {
    realm,
    totalU: rows.reduce((a, r) => a + r.u, 0),
    last24hU: day,
    byKind: Object.fromEntries(rows.map((r) => [r.kind, { count: r.n, u: r.u }])),
  };
}

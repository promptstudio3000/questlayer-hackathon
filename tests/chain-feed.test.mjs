import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer, playerView } from "../server/database.mjs";
import { EXPLORER_BASE } from "../server/native/network.mjs";
import { initializeManagedAccounts } from "../server/relayer/schema.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";
import { BADGES_SCHEMA } from "../server/badges/schema.mjs";
import {
  chainFeed,
  chainItems,
  historyChain,
  txHash,
} from "../server/native/chain-feed.mjs";

const TX1 = "9xYz1111111111111111111111111111111111111111";
const TX2 = "8AbC2222222222222222222222222222222222222222";
const T0 = Date.parse("2026-11-04T08:00:00Z");

function setup() {
  const db = openDatabase(":memory:");
  initializeManagedAccounts(db);
  ensureModuleVersion(db, BADGES_SCHEMA);
  const alice = createPlayer(db, "Alice", T0),
    bob = createPlayer(db, "Bob", T0);
  for (const [p, a] of [
    [alice, "alice.qlx.testnet"],
    [bob, "bob.qlx.testnet"],
  ])
    db.prepare(
      "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,'testnet','ready',?,?)",
    ).run(a, p, a.split(".")[0], "qlx.testnet", T0, T0);
  let seq = 0;
  const job = (player, account, { method, args = {}, state = "confirmed", tx = null, at }) =>
    db
      .prepare(
        "INSERT INTO relay_jobs(id,player_id,account_id,kind,state,call,receiver_id,method_name,run_after,transaction_hash,created_at,updated_at) VALUES(?,?,?,'relay',?,?,?,?,?,?,?,?)",
      )
      .run(
        `relay_${++seq}`,
        player,
        account,
        state,
        JSON.stringify({ kind: "call", methodName: method, args, deposit: "0" }),
        "c.testnet",
        method,
        at,
        tx,
        at,
        at,
      );
  return { db, alice, bob, job };
}

test("txHash accepts NEAR base58 hashes only", () => {
  assert.equal(txHash(TX1), TX1);
  assert.equal(txHash("0x" + "a".repeat(64)), null);
  assert.equal(txHash("<script>"), null);
  assert.equal(txHash(undefined), null);
});

test("the feed lists one player's relayed calls newest first with proof state", () => {
  const { db, alice, bob, job } = setup();
  job(alice, "alice.qlx.testnet", { method: "redeem_aura", args: { claim_id: "c1" }, tx: TX1, at: T0 + 1 });
  job(alice, "alice.qlx.testnet", { method: "start_roll", args: { roll_id: "r1" }, state: "sent", at: T0 + 2 });
  job(alice, "alice.qlx.testnet", { method: "set", state: "failed", at: T0 + 3 });
  job(bob, "bob.qlx.testnet", { method: "redeem_aura", tx: TX2, at: T0 + 4 });
  const { items } = chainFeed(db, alice);
  assert.deepEqual(
    items.map((i) => [i.kind, i.status, i.tx]),
    [
      ["profile", "failed", null],
      ["roll", "pending", null],
      ["aura", "confirmed", TX1],
    ],
  );
  assert.equal(items[2].explorer, `${EXPLORER_BASE}/txns/${TX1}`);
  assert.equal(items[2].ref, "aura:c1");
  assert.equal(items[1].ref, "roll:r1");
  assert.ok(!items.some((i) => i.tx === TX2), "never another player's actions");
});

test("ChainLink polling resolves feed ids, refs and the latest action of a kind", () => {
  const { db, alice, bob, job } = setup();
  job(alice, "alice.qlx.testnet", { method: "start_roll", args: { roll_id: "r9" }, state: "confirmed", tx: TX1, at: T0 });
  job(alice, "alice.qlx.testnet", { method: "fill_sell_order", state: "sent", at: T0 + 10 });
  const byRef = chainItems(db, alice, ["roll:r9"]).items;
  assert.equal(byRef[0].status, "confirmed");
  assert.equal(byRef[0].tx, TX1);
  assert.equal(byRef[0].id, "roll:r9");
  const latest = chainItems(db, alice, [`latest:market:${T0}`]).items;
  assert.equal(latest[0].status, "pending");
  assert.equal(chainItems(db, alice, [`latest:market:${T0 + 11}`]).items.length, 0);
  assert.equal(chainItems(db, bob, ["roll:r9"]).items.length, 0, "scoped to the player");
  assert.equal(chainItems(db, alice, ["relay_1"]).items.length, 0);
  assert.equal(chainItems(db, alice, ["relay:relay_1"]).items[0].tx, TX1);
});

test("badge mints and reward claims join the feed", () => {
  const { db, alice } = setup();
  db.prepare(
    "INSERT INTO user_badges(id,creator_player,creator_account,title,description,icon,color,kind,max_supply,state,created_at,updated_at) VALUES('b1',?,?,'T','','x','#fff','event',5,'live',?,?)",
  ).run(alice, "alice.qlx.testnet", T0, T0);
  db.prepare(
    "INSERT INTO user_badge_claims(badge_id,player_id,account_id,state,chain_tx,created_at,updated_at) VALUES('b1',?,?,'minted',?,?,?)",
  ).run(alice, "alice.qlx.testnet", TX2, T0 + 5, T0 + 5);
  const { items } = chainFeed(db, alice);
  assert.equal(items[0].kind, "badge");
  assert.equal(items[0].status, "confirmed");
  assert.equal(chainItems(db, alice, ["badge:b1"]).items[0].tx, TX2);
});

test("history rows carry their chain proof in the player view", () => {
  const { db, alice, job } = setup();
  job(alice, "alice.qlx.testnet", { method: "resolve_roll", args: { roll_id: "r2" }, tx: TX1, at: T0 });
  const add = (id, kind, meta) =>
    db.prepare("INSERT INTO history VALUES (?,?,?,?,0,?,?)").run(id, alice, kind, kind, JSON.stringify(meta), T0);
  add("h1", "npc-roll", { rollId: "r2" });
  add("h2", "native_profile", { accountId: "alice.qlx.testnet", mutationId: "m" });
  add("h3", "coin", { chain: { id: "act_1", status: "queued", tx: null } });
  add("h4", "quest", { xp: 5 });
  add("h5", "npc-roll", { rollId: "gone" });
  const rows = Object.fromEntries(playerView(db, alice).history.map((h) => [h.id, h.chain]));
  assert.equal(rows.h1.status, "confirmed");
  assert.equal(rows.h1.tx, TX1);
  assert.deepEqual(rows.h2, { status: "confirmed", tx: null, account: "alice.qlx.testnet" });
  assert.equal(rows.h3.id, "act_1");
  assert.equal(rows.h3.status, "queued");
  assert.equal(rows.h4, undefined);
  assert.equal(rows.h5, undefined, "a roll without a relayed job shows no proof");
  assert.equal(historyChain({ meta: "not json" }), null);
});

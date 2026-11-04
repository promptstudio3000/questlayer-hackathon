import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer, playerView } from "../server/database.mjs";
import { initializeManagedAccounts } from "../server/relayer/schema.mjs";

// A secured Aura shows the redeem_aura transaction for the explorer link.
test("a secured Aura carries its relayed redeem_aura transaction hash", () => {
  const db = openDatabase(":memory:");
  const t = Date.now();
  const p = createPlayer(db, "A", t);
  db.prepare("INSERT INTO inventory(id,player_id,kind,name,rarity,slot,color,equipped,created_at) VALUES('aura1',?,'aura','Ember Aura','rare','aura','#ff8800',0,?)").run(p, t);
  db.prepare("INSERT INTO native_awards(item_id,claim_id,player_id,receiver_id,edition,state,expires_at,token_id,created_at) VALUES('aura1','earned:x1',?,'a.testnet','ember','minted',?,'aura:ember:1',?)").run(p, t, t);
  assert.equal(playerView(db, p).inventory.find((i) => i.id === "aura1").native_claim_tx, undefined, "no relayer, no column");
  initializeManagedAccounts(db);
  db.prepare("INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES('a.testnet',?,'a','f.testnet','testnet','ready',?,?)").run(p, t, t);
  db.prepare(
    "INSERT INTO relay_jobs(id,player_id,account_id,kind,state,call,receiver_id,method_name,run_after,transaction_hash,created_at,updated_at) VALUES('j1',?,'a.testnet','relay','confirmed',?,'c.testnet','redeem_aura',?,'TxHash1',?,?)",
  ).run(p, JSON.stringify({ methodName: "redeem_aura", args: { claim_id: "earned:x1" } }), t, t, t);
  assert.equal(playerView(db, p).inventory.find((i) => i.id === "aura1").native_claim_tx, "TxHash1");
});

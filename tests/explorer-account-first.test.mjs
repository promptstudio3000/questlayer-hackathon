import test from "node:test";
import assert from "node:assert/strict";
import { linkedWallets } from "../server/database.mjs";
import { fixture } from "./relayer-fixture.mjs";
import { explorerAccountMessage } from "../src/explorer-account.ts";

test("the explorer's own account is listed first, so screens default to it and sign without a wallet popup", (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const link = f.db.prepare("INSERT INTO wallet_links(account_id,player_id,verified_at) VALUES(?,?,?)");
  link.run("someone-wallet.testnet", f.player, 1);
  const own = "explorer-1.questlayer-factory.testnet";
  f.db
    .prepare(
      "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(own, f.player, "explorer-1", "questlayer-factory.testnet", "testnet", "creating", 1, 1);
  link.run(own, f.player, 2);
  // Still being created: the older external wallet stays first.
  assert.deepEqual(linkedWallets(f.db, f.player).map((w) => w.account_id), ["someone-wallet.testnet", own]);
  f.db.prepare("UPDATE managed_accounts SET state='ready' WHERE account_id=?").run(own);
  assert.deepEqual(linkedWallets(f.db, f.player).map((w) => w.account_id), [own, "someone-wallet.testnet"]);
});

test("every reason the explorer account cannot sign yet has a plain message, never a wallet request", () => {
  for (const reason of ["play-first", "needs-recovery", "creating", "error", "idle"]) {
    const text = explorerAccountMessage(reason);
    assert.ok(text.length > 10, reason);
    assert.doesNotMatch(text, /wallet/i, reason);
  }
  assert.notEqual(explorerAccountMessage("play-first"), explorerAccountMessage("needs-recovery"));
});

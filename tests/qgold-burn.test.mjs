import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer, atomic } from "../server/database.mjs";
import { burnGold, ensureGoldSpend, setSpendRealm, BURN_KINDS } from "../server/gold-spend/ledger.mjs";
import {
  ensureQgoldBurns,
  burnEvents,
  confirmQgoldBurn,
  prepareQgoldBurn,
} from "../server/gold-spend/qgold-burn.mjs";

const TOKEN = "qgold.questlayer.testnet";
const HASH = "8".repeat(44);
const outcome = (signer, amount, memo, { contract = TOKEN, failed = false } = {}) => ({
  transaction: { signer_id: signer, receiver_id: contract, hash: HASH },
  receipts_outcome: [
    {
      outcome: {
        executor_id: contract,
        status: failed ? { Failure: {} } : { SuccessValue: "" },
        logs: [
          `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_burn", data: [{ owner_id: signer, amount, memo }] })}`,
        ],
      },
    },
  ],
});

test("a spend in the QGOLD realm uses one verified ft_burn and never the practice balance", async () => {
  const db = openDatabase(":memory:");
  setSpendRealm("qgold");
  try {
    ensureQgoldBurns(db);
    ensureGoldSpend(db);
    const player = createPlayer(db, "Burner", Date.now());
    db.prepare("UPDATE players SET gold_u=0 WHERE id=?").run(player);
    const call = prepareQgoldBurn({ contract: TOKEN, accountId: "burner.testnet", kind: "emote", amountU: 500_000, kinds: BURN_KINDS });
    assert.equal(call.methodName, "ft_burn");
    assert.equal(call.deposit, "1");
    assert.equal(call.args.amount, "500000");
    assert.match(call.args.memo, /^questlayer:burn:emote:[0-9a-f]{16}$/);

    // Without a burn the spend asks for one, with the kind and amount.
    assert.throws(
      () => atomic(db, () => burnGold(db, { player, kind: "emote", ref: "wave", amountU: 500_000 })),
      (e) => e.code === "QGOLD_BURN" && e.status === 402 && e.details.amountU === 500_000,
    );

    // A burn by someone else, on another contract or failed is refused.
    const status = (o) => async () => o;
    await assert.rejects(
      confirmQgoldBurn(db, { player, accountIds: ["burner.testnet"], contract: TOKEN, txHash: HASH, txStatus: status(outcome("eve.testnet", "500000", call.args.memo)) }),
      (e) => e.code === "BURN_SIGNER",
    );
    await assert.rejects(
      confirmQgoldBurn(db, { player, accountIds: ["burner.testnet"], contract: TOKEN, txHash: HASH, txStatus: status(outcome("burner.testnet", "500000", call.args.memo, { failed: true })) }),
      (e) => e.code === "BURN_EVENT",
    );
    assert.equal(burnEvents(outcome("a.testnet", "1", "m", { contract: "other.testnet" }), TOKEN).length, 0);

    const credit = await confirmQgoldBurn(db, {
      player,
      accountIds: ["burner.testnet"],
      contract: TOKEN,
      txHash: HASH,
      txStatus: status(outcome("burner.testnet", "500000", call.args.memo)),
    });
    assert.equal(credit.amount_u, 500_000);
    assert.equal(credit.kind, "emote");
    // The same transaction twice is one credit; another player cannot take it.
    await confirmQgoldBurn(db, { player, accountIds: ["burner.testnet"], contract: TOKEN, txHash: HASH, txStatus: async () => null });
    const other = createPlayer(db, "Other", Date.now());
    await assert.rejects(
      confirmQgoldBurn(db, { player: other, accountIds: ["other.testnet"], contract: TOKEN, txHash: HASH, txStatus: async () => null }),
      (e) => e.code === "BURN_OWNER",
    );

    const burn = atomic(db, () => burnGold(db, { player, kind: "emote", ref: "wave", amountU: 500_000 }));
    assert.equal(burn.realm, "qgold");
    assert.equal(burn.memo, call.args.memo);
    assert.equal(db.prepare("SELECT realm FROM gold_burns WHERE id=?").get(burn.id).realm, "qgold");
    assert.equal(db.prepare("SELECT gold_u FROM players WHERE id=?").get(player).gold_u, 0);
    // The credit is spent: the next spend needs a new burn.
    assert.throws(
      () => atomic(db, () => burnGold(db, { player, kind: "emote", ref: "wave2", amountU: 500_000 })),
      (e) => e.code === "QGOLD_BURN",
    );
  } finally {
    setSpendRealm("practice");
    db.close();
  }
});

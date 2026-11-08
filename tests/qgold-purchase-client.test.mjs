import test from "node:test";
import assert from "node:assert/strict";
import { setSpendRealm } from "../server/gold-spend/ledger.mjs";
import { createGoldSpendRoutes } from "../server/gold-spend/routes.mjs";
import { assert as domainAssert } from "../server/domain.mjs";
import {
  purchaseFixture,
  burnOutcome,
  OWNER,
  TOKEN,
} from "./fixtures/qgold-purchase.mjs";
class Storage {
  values = new Map();
  getItem(k) {
    return this.values.get(k) ?? null;
  }
  setItem(k, v) {
    this.values.set(k, v);
  }
  removeItem(k) {
    this.values.delete(k);
  }
}
for (const lost of ["prepare", "confirm", "delivery", "none", "validation"])
  test(`purchase browser reload after lost ${lost} reply burns and delivers at most once`, async (t) => {
    const f = purchaseFixture(),
      storage = new Storage();
    let burned = 0,
      proof,
      dropped = false;
    setSpendRealm("qgold");
    const previous = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    t.after(() => {
      f.db.close();
      setSpendRealm("practice");
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else delete globalThis.localStorage;
    });
    const routes = createGoldSpendRoutes({
      db: f.db,
      gold: f.gold,
      qgold: {
        contract: TOKEN,
        accountIds: () => [OWNER],
        balanceU: async () => 1_000_000,
        txStatus: async () => proof,
      },
    });
    t.mock.method(globalThis, "fetch", async (url, options) => {
      let response;
      try {
        const handled = await routes.handle(
          {
            method: options.method,
            headers: {
              "x-questlayer-purchase": options.headers["X-Questlayer-Purchase"],
            },
          },
          {},
          new URL(url, "http://127.0.0.1"),
          {
            player: f.player,
            body: async () => JSON.parse(options.body),
            assert: domainAssert,
            respond: (_, value) => {
              response = Response.json(value);
            },
          },
        );
        assert.equal(handled, true);
      } catch (error) {
        response = Response.json(
          { error: error.message, code: error.code, details: error.details },
          { status: error.status ?? 500 },
        );
      }
      const point = url.endsWith("/prepare")
        ? "prepare"
        : url.endsWith("/confirm")
          ? "confirm"
          : "delivery";
      if (!dropped && lost === point && response.ok) {
        dropped = true;
        throw Error("response lost");
      }
      return response;
    });
    const burner = async (call) => {
      burned++;
      const row = f.db
        .prepare("SELECT * FROM qgold_purchases WHERE id=?")
        .get(call.purchaseId);
      proof = burnOutcome(row);
      return proof.transaction.hash;
    };
    const first = await import(`../src/qgold-burn.ts?first-${lost}`);
    first.setQgoldBurner(burner, f.player);
    if (lost === "validation") {
      for (let i = 0; i < 9; i++) {
        await assert.rejects(
          first.withQgoldBurn("/gold/buy", { sku: `cosmetic:unknown${i}` }),
          /not in the shop/,
        );
        assert.deepEqual(JSON.parse([...storage.values.values()][0]), []);
      }
      assert.equal(burned, 0);
      assert.equal(
        f.db.prepare("SELECT COUNT(*) n FROM qgold_purchases").get().n,
        0,
      );
    }
    if (lost !== "none" && lost !== "validation")
      await assert.rejects(
        first.withQgoldBurn("/gold/buy", { sku: "emote:dragon" }),
        /response lost/,
      );
    const reloaded = await import(`../src/qgold-burn.ts?reload-${lost}`);
    reloaded.setQgoldBurner(burner, f.player);
    const replies = await Promise.all(
      Array.from({ length: 6 }, () =>
        reloaded.withQgoldBurn("/gold/buy", { sku: "emote:dragon" }),
      ),
    );
    assert.ok(
      replies.every(
        (r) => r.sku === "emote:dragon" && r.burn.id === replies[0].burn.id,
      ),
    );
    assert.equal(burned, 1);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM gold_unlocks").get().n,
      1,
    );
    assert.deepEqual(JSON.parse([...storage.values.values()][0]), []);
  });

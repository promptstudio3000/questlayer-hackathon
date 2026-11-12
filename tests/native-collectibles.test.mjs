import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeCollectibles,
  nativeItem,
} from "../server/native/collectibles.mjs";
import {
  NETWORK,
  ACCOUNT_SUFFIX as SUFFIX,
} from "../server/native/network.mjs";
const account = `alice${SUFFIX}`,
  contract = `nfts.project${SUFFIX}`;
const token = (id, owner = account) => ({
  token_id: id,
  owner_id: owner,
  metadata: { title: id, media: null },
});
function provider(methods) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    viewNodeStatus: async () => ({ chain_id: NETWORK }),
    query: async (q) => {
      calls++;
      const args = JSON.parse(Buffer.from(q.args_base64, "base64"));
      return {
        result: Array.from(
          Buffer.from(JSON.stringify(await methods[q.method_name](args))),
        ),
      };
    },
  };
}
test("native wardrobe verifies ownership and removes stale or duplicate equipment", async () => {
  const p = provider({
      nft_tokens_for_owner: async () => [
        token(`avatar:alice${SUFFIX}`),
        token("aura:polar:1"),
        token("aura:moon:1", `bob${SUFFIX}`),
      ],
      get_equipment: async () => ({
        above: "aura:polar:1",
        below: "aura:moon:1",
      }),
      nft_supply_for_owner: async () => "2",
      nft_token: async (a) =>
        a.token_id === "aura:moon:1"
          ? token(a.token_id, `bob${SUFFIX}`)
          : token(a.token_id),
    }),
    n = new NativeCollectibles(p, contract),
    r = await n.wardrobe([account]);
  assert.equal(r.accounts[0].items.length, 2);
  assert.deepEqual(r.accounts[0].equipment, {
    above: "aura:polar:1",
    below: null,
  });
  assert.equal(r.accounts[0].starterOwned, true);
  const calls = p.calls;
  await n.wardrobe([account]);
  assert.equal(p.calls, calls);
});
test("native holdings retain equipped items beyond the first page and coalesce RPC calls", async () => {
  const p = provider({
      nft_tokens_for_owner: async () => [],
      get_equipment: async () => ({
        above: "aura:gold:256",
        below: "aura:gold:256",
      }),
      nft_supply_for_owner: async () => "150",
      nft_token: async (a) =>
        a.token_id.startsWith("avatar:") ? null : token(a.token_id),
    }),
    n = new NativeCollectibles(p, contract);
  const [a, b] = await Promise.all([
    n.wardrobe([account]),
    n.wardrobe([account]),
  ]);
  assert.deepEqual(a, b);
  assert.equal(p.calls, 5);
  assert.equal(a.accounts[0].truncated, true);
  assert.deepEqual(a.accounts[0].equipment, {
    above: "aura:gold:256",
    below: null,
  });
});
test("native asset normalization rejects foreign kinds and out-of-range editions", () => {
  assert.equal(nativeItem(token("spam:1")), null);
  assert.equal(nativeItem(token("aura:gold:0")), null);
  assert.ok(nativeItem(token("aura:gold:257")), "editions are uncapped");
  assert.equal(nativeItem(token("aura:polar:1")).color, "#9edfc5");
  assert.equal(
    nativeItem({
      ...token(`avatar:alice${SUFFIX}`),
      metadata: { media: "javascript:alert(1)" },
    }).media,
    null,
  );
  assert.throws(
    () =>
      new NativeCollectibles(
        {},
        NETWORK === "mainnet" ? "nfts.project.testnet" : "nfts.project.near",
      ),
    new RegExp(`${NETWORK}-only`),
  );
});

test("a confirmed refresh cannot be overwritten by an older in-flight ownership read", async () => {
  let release, started;
  const held = new Promise((resolve) => (release = resolve)),
    began = new Promise((resolve) => (started = resolve));
  let calls = 0;
  const p = {
    viewNodeStatus: async () => ({ chain_id: NETWORK }),
    query: async () => {
      const sequence = ++calls;
      if (sequence === 1) {
        started();
        await held;
      }
      const value = token(
        "aura:polar:1",
        sequence === 1 ? `alice${SUFFIX}` : `bob${SUFFIX}`,
      );
      return { result: Array.from(Buffer.from(JSON.stringify(value))) };
    },
  };
  const n = new NativeCollectibles(p, contract),
    old = n.view("nft_token", { token_id: "aura:polar:1" });
  await began;
  assert.equal(
    (await n.view("nft_token", { token_id: "aura:polar:1" }, true)).owner_id,
    `bob${SUFFIX}`,
  );
  release();
  await old;
  assert.equal(
    (await n.view("nft_token", { token_id: "aura:polar:1" })).owner_id,
    `bob${SUFFIX}`,
  );
  assert.equal(calls, 2);
});

test("parallel native reads share network verification and a failed check can retry", async () => {
  const { assertTestnetRpc } = await import("../server/identity/near.mjs");
  let finish,
    calls = 0;
  const p = {
    viewNodeStatus: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const checks = Array.from({ length: 12 }, () => assertTestnetRpc(p));
  assert.equal(calls, 1);
  finish({ chain_id: NETWORK });
  await Promise.all(checks);
  await assertTestnetRpc(p);
  assert.equal(calls, 1);
  let attempts = 0;
  const unavailable = {
    viewNodeStatus: async () => {
      attempts++;
      if (attempts === 1) throw Error("offline");
      return { chain_id: NETWORK };
    },
  };
  await assert.rejects(assertTestnetRpc(unavailable), /unavailable/);
  await assertTestnetRpc(unavailable);
  assert.equal(attempts, 2);
});

test("claim expiry proof reads the timestamp of the exact finalized claim state block", async () => {
  const p = {
    viewNodeStatus: async () => ({ chain_id: NETWORK }),
    query: async (args) => {
      assert.equal(args.finality, "final");
      assert.equal(args.method_name, "get_claim");
      return {
        result: Array.from(
          Buffer.from(
            JSON.stringify({
              token_id: "aura:polar:1",
              receiver_id: `alice${SUFFIX}`,
              edition: "polar",
            }),
          ),
        ),
        block_hash: "final-block-hash",
      };
    },
    viewBlock: async (args) => {
      assert.deepEqual(args, { blockId: "final-block-hash" });
      return { header: { timestamp_nanosec: "1793417000123456789" } };
    },
  };
  const result = await new NativeCollectibles(p, contract).claimSnapshot(
    "earned:test",
  );
  assert.equal(result.blockTimestampMs, 1793417000123);
  assert.equal(result.receiverId, `alice${SUFFIX}`);
  assert.equal(result.tokenId, "aura:polar:1");
});

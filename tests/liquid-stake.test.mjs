import test from "node:test";
import assert from "node:assert/strict";
import {
  liquidStakeSettings,
  checkpointHeights,
  matureOf,
  readLiquidStake,
  createLiquidStake,
} from "../server/native/liquid-stake.mjs";

const N = 10n ** 24n;
const enc = (v) => [...Buffer.from(JSON.stringify(v))];

// Fake RPC: 1 block per second, balances by height per contract.
function fakeProvider({ head = 1_000_000, price = { "meta-v2.pool.testnet": 3n * N, "linear-protocol.testnet": 2n * N }, fee = 30, gc = Infinity } = {}) {
  const calls = [];
  return {
    calls,
    async viewBlock(ref) {
      const height = ref.finality ? head : ref.blockId;
      return { header: { height, timestamp_nanosec: String(BigInt(height) * 1_000_000_000n) } };
    },
    async query(q) {
      calls.push(q);
      const h = q.block_id ?? head;
      if (head - h > gc) throw new Error("GARBAGE_COLLECTED_BLOCK");
      if (q.method_name === "get_st_near_price" || q.method_name === "ft_price") return { result: enc(price[q.account_id].toString()) };
      if (q.method_name === "get_contract_state") return { result: enc({ nslp_current_discount_basis_points: fee }) };
      throw new Error("unexpected " + q.method_name);
    },
  };
}

const settings = (env = {}) => liquidStakeSettings({ LIQUID_STAKE_ENABLED: "1", ...env }, "testnet");

test("settings: off by default, testnet allowlist, mainnet needs an explicit list, hold window bounded", () => {
  assert.equal(liquidStakeSettings({}, "testnet").enabled, false);
  assert.deepEqual(settings().tokens.map((t) => t.id), ["stnear", "linear"]);
  assert.deepEqual(liquidStakeSettings({ LIQUID_STAKE_ENABLED: "1" }, "mainnet").tokens, []);
  assert.deepEqual(
    liquidStakeSettings({ LIQUID_STAKE_ENABLED: "1", LIQUID_STAKE_TOKENS: "rnear,unknown" }, "mainnet").tokens.map((t) => t.contract),
    ["lst.rhealab.near"],
  );
  assert.equal(settings({ LIQUID_HOLD_HOURS: "500" }).holdHours, 36);
  assert.equal(settings().holdHours, 24);
});

test("checkpoints span the hold window evenly from now", () => {
  const h = checkpointHeights({ height: 100_000, timestampMs: 100_000_000 }, { height: 90_000, timestampMs: 90_000_000 }, 24, 7);
  assert.equal(h.length, 7);
  assert.equal(h[0], 100_000);
  assert.equal(h[6], 100_000 - 86_400);
  assert.ok(h.every((x, i) => i === 0 || x < h[i - 1]));
});

test("mature balance is the lowest checkpoint", () => {
  assert.equal(matureOf([5n, 3n, 4n]), 3n);
  assert.equal(matureOf([2n, 2n]), 2n);
  assert.throws(() => matureOf([1n]));
});

function provider(balanceByHeight, opts = {}) {
  const p = fakeProvider(opts);
  const query = p.query.bind(p);
  p.query = async (q) => {
    if (q.method_name === "ft_balance_of") {
      const h = q.block_id ?? 1_000_000;
      const args = JSON.parse(Buffer.from(q.args_base64, "base64"));
      p.calls.push(q);
      if (1_000_000 - h > (opts.gc ?? Infinity)) throw new Error("GARBAGE_COLLECTED_BLOCK");
      return { result: enc(balanceByHeight(q.account_id, h, args.account_id).toString()) };
    }
    return query(q);
  };
  return p;
}

test("held for the whole window counts at the on-chain price, not 1:1", async () => {
  const p = provider((contract) => (contract === "meta-v2.pool.testnet" ? N : 0n));
  const r = await readLiquidStake(p, "alice.testnet", settings(), { now: 1 });
  const st = r.tokens.find((t) => t.id === "stnear");
  assert.equal(st.near, (3n * N).toString());
  assert.equal(st.matureNear, (3n * N).toString());
  assert.equal(st.instantExitFeeBps, 30);
  assert.equal(r.matureNear, (3n * N).toString());
  assert.equal(r.pendingCountsBy, null);
});

test("a fresh purchase shows value but does not count yet", async () => {
  // Bought 1 h ago: zero at every older checkpoint.
  const p = provider((contract, h) => (contract === "meta-v2.pool.testnet" && h > 1_000_000 - 3600 ? N : 0n));
  const r = await readLiquidStake(p, "alice.testnet", settings(), { now: 1000 });
  assert.equal(r.near, (3n * N).toString());
  assert.equal(r.matureNear, "0");
  assert.equal(r.pendingCountsBy, 1000 + 24 * 3600_000);
});

test("tokens lent to another account in the window reset the count", async () => {
  // Present now and 24 h ago, gone at one checkpoint in between.
  const gap = 1_000_000 - 4 * 14_400;
  const p = provider((contract, h) => (contract === "linear-protocol.testnet" && Math.abs(h - gap) > 5 ? 2n * N : 0n));
  const r = await readLiquidStake(p, "alice.testnet", settings(), { now: 1 });
  assert.equal(r.near, (4n * N).toString());
  assert.equal(r.matureNear, "0");
});

test("history beyond what the node keeps fails closed", async () => {
  const p = provider(() => N, { gc: 50_000 });
  await assert.rejects(readLiquidStake(p, "alice.testnet", settings(), { now: 1 }), /earlier balance/);
});

test("forPlayer sums linked accounts, unreadable ones count as zero, reads are cached", async () => {
  const p = provider((contract, h, account) => (contract === "meta-v2.pool.testnet" && account === "a.testnet" ? N : 0n));
  const db = {
    prepare: () => ({ all: () => [{ account_id: "a.testnet" }, { account_id: "BAD ACCOUNT" }] }),
  };
  let t = 0;
  const ls = createLiquidStake({ provider: p, settings: settings(), clock: () => t });
  const out = await ls.forPlayer(db, "p1");
  assert.equal(out.matureNear, (3n * N).toString());
  assert.equal(out.linked, 2);
  assert.equal(out.unreadable, 1);
  const before = p.calls.length;
  await ls.forPlayer(db, "p1");
  assert.equal(p.calls.length, before);
  t = 11 * 60_000;
  await ls.forPlayer(db, "p1");
  assert.ok(p.calls.length > before);
});

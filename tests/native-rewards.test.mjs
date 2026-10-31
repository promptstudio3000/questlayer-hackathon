import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { NativeRewards } from "../server/native/rewards.mjs";
import {
  nativeManifest,
  rewardMessage,
  publicationArgs,
} from "../server/native/reward-manifest.mjs";
import { runRewardWorker } from "../server/native/reward-worker.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
const NOW = Date.parse("2026-10-31T10:00:00Z"),
  plan = buildCityPlan(PLZEN, "2026-10-31");
function fixture() {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Native test explorer", NOW),
    accountId = "alice.testnet",
    contractId = "rewards.testnet";
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    accountId,
    player,
    NOW,
  );
  const keys = generateKeyPairSync("ed25519"),
    signer = {
      publicKey: keys.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64"),
      sign: (m) =>
        sign(null, Buffer.from(m), keys.privateKey).toString("base64"),
    };
  let now = NOW;
  const n = new NativeRewards(db, {}, { contractId, vaults: [] }, signer, {
    clock: () => now,
  });
  const state = { days: new Map(), receipts: new Map(), sent: [] };
  n.view = async (method, args = {}) => {
    if (method === "get_config")
      return {
        attestor: signer.publicKey,
        publisher: contractId,
        paused: false,
      };
    if (method === "get_treasury")
      return {
        coins: { available: "100000000000000000000000" },
        zones: { available: "100000000000000000000000" },
      };
    if (method === "get_day") return state.days.get(args.day_id) || null;
    if (method === "get_receipt")
      return state.receipts.get(args.receipt_id) || null;
    if (method === "get_account") return { credit: "0", xp: 0 };
    throw Error(method);
  };
  const send = async (method, args) => {
    state.sent.push({ method, args });
    if (method === "publish_day")
      state.days.set(args.day_id, {
        ...args,
        manifest_hash: args.manifest_hash,
        closed: false,
        claims_accepted: 0,
        claims_limit: 256,
        storage_reserved: true,
      });
    else if (method === "close_day") state.days.get(args.day_id).closed = true;
    else if (method === "claim") {
      state.days.get(args.claim.day_id).claims_accepted++;
      state.receipts.set(args.claim.receipt_id, {
        receiver_id: args.claim.receiver_id,
        message_hash: createHash("sha256")
          .update(rewardMessage(contractId, args.claim))
          .digest("hex"),
        amount: args.claim.kind === "coin" ? "1000000000000000000" : "0",
        xp: args.claim.kind === "coin" ? 2 : 80,
      });
    }
    return "test-transaction";
  };
  return {
    db,
    n,
    player,
    accountId,
    state,
    send,
    clock: () => now,
    setNow: (t) => {
      now = t;
    },
    fix: (p) => ({ ...p, accuracy: 5, timestamp: now }),
  };
}
async function ready(f) {
  await runRewardWorker(f.n, f.send, { clock: f.clock });
  f.n.enroll(f.player, f.accountId, true);
  return f.n.day("plzen-2026-10-31-v1");
}
function input(f, m, p = {}) {
  return {
    accountId: f.accountId,
    dayId: m.id,
    kind: "coin",
    index: 0,
    mode: "gps",
    fix: f.fix(m.coins[0]),
    ...p,
  };
}
test("native funding uses finite actual buckets, six city slots, free XP and small shared coins", () => {
  const m = nativeManifest(plan, {
    coins: { available: "6000000000000000000000" },
    zones: { available: "6000000000000000000000" },
  });
  assert.equal(m.quests.length, 6);
  assert.equal(m.coins.length, 6000);
  assert.equal(BigInt(m.coinUnit) * 6000n, 6000000000000000000000n);
  assert.equal(
    m.quests.filter((q) => q.tier === 1).every((q) => q.reward === "0"),
    true,
  );
  assert.equal(
    m.quests.reduce((s, q) => s + BigInt(q.reward), 0n),
    6000000000000000000000n,
  );
  assert.equal(publicationArgs(m).coin_count, 6000);
  assert.equal(
    nativeManifest(plan, {
      coins: { available: "0" },
      zones: { available: "9000" },
    }),
    null,
  );
});
test("arena, absent consent, unlinked wallet and wrong GPS cannot issue native rewards", async () => {
  const f = fixture();
  try {
    await runRewardWorker(f.n, f.send, { clock: f.clock });
    const m = f.n.day("plzen-2026-10-31-v1");
    await assert.rejects(f.n.submit(f.player, input(f, m)), /Join the testnet/);
    assert.throws(
      () => f.n.enroll(f.player, f.accountId, false),
      /public testnet/,
    );
    f.n.enroll(f.player, f.accountId, true);
    await assert.rejects(
      f.n.submit(f.player, input(f, m, { mode: "arena" })),
      /GPS mode/,
    );
    await assert.rejects(
      f.n.submit(f.player, input(f, m, { accountId: "bob.testnet" })),
      /Link/,
    );
    await assert.rejects(
      f.n.submit(
        f.player,
        input(f, m, { fix: { ...f.fix(m.coins[0]), accuracy: 100 } }),
      ),
      /accurate/,
    );
    await assert.rejects(
      f.n.submit(
        f.player,
        input(f, m, { fix: { ...f.fix(m.coins[0]), lat: 0, lng: 0 } }),
      ),
      /closer/,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM native_reward_claims").get().n,
      0,
    );
  } finally {
    f.db.close();
  }
});
test("GPS coin acceptance is durable; retry after send-before-ack reads the original on-chain receipt", async () => {
  const f = fixture();
  try {
    const m = await ready(f),
      r = await f.n.submit(f.player, input(f, m));
    assert.equal(r.state, "queued");
    assert.equal((await f.n.submit(f.player, input(f, m))).id, r.id);
    let crashed = false;
    const send = async (method, args) => {
      const tx = await f.send(method, args);
      if (method === "claim" && !crashed) {
        crashed = true;
        throw Error("lost response after finalization");
      }
      return tx;
    };
    await assert.rejects(
      runRewardWorker(f.n, send, { clock: f.clock }),
      /lost response/,
    );
    f.setNow(NOW + 6000);
    await runRewardWorker(f.n, send, { clock: f.clock });
    const row = f.db
      .prepare("SELECT * FROM native_reward_claims WHERE id=?")
      .get(r.id);
    assert.equal(row.state, "confirmed");
    assert.equal(row.amount, "1000000000000000000");
    assert.equal(f.state.sent.filter((r) => r.method === "claim").length, 1);
  } finally {
    f.db.close();
  }
});
test("a second linked player cannot consume the same native street coin", async () => {
  const f = fixture();
  try {
    const m = await ready(f);
    await f.n.submit(f.player, input(f, m));
    const player = createPlayer(f.db, "Second explorer", NOW);
    f.db
      .prepare("INSERT INTO wallet_links VALUES(?,?,?)")
      .run("bob.testnet", player, NOW);
    f.n.enroll(player, "bob.testnet", true);
    await assert.rejects(
      f.n.submit(player, input(f, m, { accountId: "bob.testnet" })),
      /already been collected/,
    );
  } finally {
    f.db.close();
  }
});
test("three ordered solo checkpoints produce one XP receipt; demo staking cannot unlock native tiers", async () => {
  const f = fixture();
  try {
    const m = await ready(f),
      q = m.quests.find((q) => q.tier === 1),
      locked = m.quests.find((q) => q.tier === 2);
    await assert.rejects(
      f.n.submit(
        f.player,
        input(f, m, {
          kind: "quest",
          index: q.index,
          checkpoint: 2,
          fix: f.fix(q.targets[2]),
        }),
      ),
      /in order/,
    );
    for (let i = 0; i < 3; i++) {
      f.setNow(NOW + i * 60000);
      const r = await f.n.submit(
        f.player,
        input(f, m, {
          kind: "quest",
          index: q.index,
          checkpoint: i,
          fix: f.fix(q.targets[i]),
        }),
      );
      assert.equal(r.state, i === 2 ? "queued" : "progress");
    }
    f.setNow(Math.max(NOW + 300000, locked.opensAt + 10000));
    await assert.rejects(
      f.n.submit(
        f.player,
        input(f, m, {
          kind: "quest",
          index: locked.index,
          checkpoint: 0,
          fix: f.fix(locked.targets[0]),
        }),
      ),
      /native Tier/,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM native_reward_claims").get().n,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("worker lease excludes overlap; unavailable chain leaves accepted rights reserved", async () => {
  const f = fixture();
  try {
    const m = await ready(f);
    f.db
      .prepare("UPDATE native_worker_lease SET owner=?,until_ms=? WHERE id=1")
      .run("other", NOW + 30000);
    assert.deepEqual(await runRewardWorker(f.n, f.send, { clock: f.clock }), {
      busy: true,
    });
    f.db.prepare("UPDATE native_worker_lease SET until_ms=0 WHERE id=1").run();
    await f.n.submit(f.player, input(f, m));
    f.setNow(m.endsAt + 86400001);
    await assert.rejects(
      runRewardWorker(
        f.n,
        async () => {
          throw Error("RPC unavailable");
        },
        { clock: f.clock },
      ),
      /RPC unavailable/,
    );
    assert.equal(
      f.db.prepare("SELECT state FROM native_days WHERE id=?").get(m.id).state,
      "published",
    );
    assert.equal(f.state.days.get(m.id).closed, false);
  } finally {
    f.db.close();
  }
});

test("native receipt capacity includes accepted pending rights before another explorer can join the queue", async () => {
  const f = fixture();
  try {
    const m = await ready(f);
    f.state.days.get(m.id).claims_accepted = 255;
    await f.n.submit(f.player, input(f, m));
    f.setNow(NOW + 5000);
    await assert.rejects(
      f.n.submit(f.player, input(f, m, { index: 1, fix: f.fix(m.coins[1]) })),
      /daily native pilot capacity/,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM native_reward_claims").get().n,
      1,
    );
  } finally {
    f.db.close();
  }
});

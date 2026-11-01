import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { NativeRewards } from "../server/native/rewards.mjs";
import {
  nativeManifest,
  rewardMessage,
  publicationArgs,
  nativePublicationMatches,
} from "../server/native/reward-manifest.mjs";
import { runRewardWorker } from "../server/native/reward-worker.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { changeSystemPlace } from "../server/spatial/place-safety.mjs";
const NOW = Date.parse("2026-10-31T10:00:00Z"),
  plan = buildCityPlan(PLZEN, "2026-10-31");
function fixture({ city = PLZEN } = {}) {
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
  const n = new NativeRewards(
    db,
    { query: async () => ({ code_hash: "reviewed-test-code" }) },
    { contractId, codeHash: "reviewed-test-code", vaults: [] },
    signer,
    {
      clock: () => now,
      city,
    },
  );
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
test("operator closure blocks new native visits but accepted receipts still settle and remain recoverable", async () => {
  const f = fixture();
  try {
    const m = await ready(f),
      q = m.quests.find((q) => q.tier === 1);
    let accepted;
    for (let checkpoint = 0; checkpoint < 3; checkpoint++) {
      f.setNow(f.clock() + 90000);
      accepted = await f.n.submit(f.player, {
        accountId: f.accountId,
        dayId: m.id,
        kind: "quest",
        index: q.index,
        checkpoint,
        mode: "gps",
        fix: f.fix(q.targets[checkpoint]),
      });
    }
    const blueprint = JSON.parse(
      f.db
        .prepare(
          "SELECT body FROM world_blueprints WHERE city_id=? AND day=? AND source_hash=?",
        )
        .get(m.cityId, m.day, m.sourceHash).body,
    );
    changeSystemPlace(
      f.db,
      PLZEN,
      {
        actor: "qa-operator",
        operationId: "close-native-place",
        candidateId: blueprint.zones[q.index].sourceId,
        action: "close",
        reason: "Temporary public access closure",
        expectedVersion: 0,
      },
      { isOperator: () => true, clock: f.clock },
    );
    const bob = createPlayer(f.db, "Another native explorer", f.clock());
    f.db
      .prepare("INSERT INTO wallet_links VALUES(?,?,?)")
      .run("bob.testnet", bob, f.clock());
    f.n.enroll(bob, "bob.testnet", true);
    await assert.rejects(
      f.n.submit(bob, {
        accountId: "bob.testnet",
        dayId: m.id,
        kind: "quest",
        index: q.index,
        checkpoint: 0,
        mode: "gps",
        fix: f.fix(q.targets[0]),
      }),
      (e) => e.code === "PLACE_CLOSED",
    );
    assert.equal(
      (await f.n.snapshot(f.player, { accountId: f.accountId })).day.quests[
        q.index
      ].placeStatus,
      "closed",
    );
    assert.equal(
      (
        await f.n.submit(f.player, {
          accountId: f.accountId,
          dayId: m.id,
          kind: "quest",
          index: q.index,
          checkpoint: 2,
          mode: "gps",
          fix: f.fix(q.targets[2]),
        })
      ).id,
      accepted.id,
    );
    await runRewardWorker(f.n, f.send, { clock: f.clock });
    assert.equal(
      f.db
        .prepare("SELECT state FROM native_reward_claims WHERE id=?")
        .get(accepted.id).state,
      "confirmed",
    );
  } finally {
    f.db.close();
  }
});
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

function maintenanceVault(f) {
  const vault = {
    accountId: "exit.factory.testnet",
    beneficiary: f.accountId,
    codeHash: "verified-vault-code",
  };
  const probe = {
    codeHash: vault.codeHash,
    keys: [],
    state: {
      beneficiary: f.accountId,
      rewards: f.n.contractId,
      pool: "aurora.pool.f863973.m0",
      stage: "unlocking",
      epoch: "106",
      unlock_epoch: "106",
      exit_requested: true,
      owner_pending: "0",
      game_pending: "0",
    },
  };
  f.n.vaultList = async () => [vault];
  f.n.provider = {
    viewNodeStatus: async () => ({ chain_id: "testnet" }),
    query: async (q) => {
      assert.equal(q.account_id, vault.accountId);
      if (q.request_type === "view_account")
        return { code_hash: probe.codeHash };
      if (q.request_type === "view_access_key_list")
        return { keys: probe.keys };
      assert.equal(q.method_name, "get_state");
      return { result: [...Buffer.from(JSON.stringify(probe.state))] };
    },
  };
  return probe;
}
test("publication survives a lost acknowledgement without repricing a funded day from new source or treasury data", async () => {
  const f = fixture();
  try {
    let lost = false;
    const send = async (method, args) => {
      const tx = await f.send(method, args);
      if (method === "publish_day" && !lost) {
        lost = true;
        throw Error("lost publication acknowledgement");
      }
      return tx;
    };
    await assert.rejects(
      runRewardWorker(f.n, send, { clock: f.clock }),
      /lost publication/,
    );
    const before = f.db
      .prepare("SELECT * FROM native_days ORDER BY day LIMIT 1")
      .get();
    assert.equal(before.state, "prepared");
    f.n.city = { ...PLZEN, version: "changed-after-publication" };
    const view = f.n.view;
    f.n.view = async (method, args, fresh) =>
      method === "get_treasury"
        ? { coins: { available: "0" }, zones: { available: "0" } }
        : view(method, args, fresh);
    await runRewardWorker(f.n, send, { clock: f.clock });
    const recovered = f.db
      .prepare("SELECT * FROM native_days WHERE id=?")
      .get(before.id);
    assert.equal(recovered.state, "published");
    assert.equal(recovered.body, before.body);
    assert.equal(recovered.hash, before.hash);
    assert.equal(
      f.state.sent.filter((s) => s.method === "publish_day").length,
      1,
    );
  } finally {
    f.db.close();
  }
});

test("a missing local publication intent never reconstructs a chain commitment from the remaining money", async () => {
  const f = fixture();
  try {
    const m = await ready(f);
    f.db.prepare("DELETE FROM native_days WHERE id=?").run(m.id);
    f.state.sent.length = 0;
    await assert.rejects(
      runRewardWorker(f.n, f.send, { clock: f.clock }),
      /Restore its exact publication intent/,
    );
    assert.equal(f.state.sent.length, 0);
    assert.equal(
      f.db.prepare("SELECT 1 FROM native_days WHERE id=?").get(m.id),
      undefined,
    );
  } finally {
    f.db.close();
  }
});

test("publication checks exact chain windows, prices, XP, tiers and receipt storage rather than a matching hash alone", async () => {
  const f = fixture();
  try {
    const m = await ready(f),
      original = structuredClone(f.state.days.get(m.id));
    const changes = [
      (d) => {
        d.starts_at = String(Number(d.starts_at) + 1);
      },
      (d) => {
        d.coin_count--;
      },
      (d) => {
        d.coin_unit = "1";
      },
      (d) => {
        d.quests[0].xp++;
      },
      (d) => {
        d.quests[0].reward = "123";
      },
      (d) => {
        d.quests[0].tier = 3;
      },
      (d) => {
        d.storage_reserved = false;
      },
      (d) => {
        d.claims_accepted = d.claims_limit + 1;
      },
    ];
    for (const change of changes) {
      f.db
        .prepare("UPDATE native_days SET state='published' WHERE id=?")
        .run(m.id);
      const broken = structuredClone(original);
      change(broken);
      assert.equal(nativePublicationMatches(m, broken), false);
      f.state.days.set(m.id, broken);
      assert.equal(
        (
          await f.n.snapshot(f.player, {
            accountId: f.accountId,
            location: m.coins[0],
          })
        ).collection.available,
        false,
      );
      await assert.rejects(
        f.n.submit(f.player, input(f, m)),
        /publication or storage backing/,
      );
      f.db
        .prepare("UPDATE native_days SET state='prepared' WHERE id=?")
        .run(m.id);
      f.state.sent.length = 0;
      await assert.rejects(
        runRewardWorker(f.n, f.send, { clock: f.clock }),
        /differs from the durable manifest/,
      );
      assert.equal(f.state.sent.length, 0);
    }
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM native_reward_claims").get().n,
      0,
    );
  } finally {
    f.db.close();
  }
});

test("corrupt prepared bodies are rejected before another publication transaction", async () => {
  const f = fixture();
  try {
    await ready(f);
    f.db
      .prepare(
        "UPDATE native_days SET state='prepared',body=json_set(body,'$.coinUnit','1')",
      )
      .run();
    f.state.sent.length = 0;
    await assert.rejects(
      runRewardWorker(f.n, f.send, { clock: f.clock }),
      /manifest integrity/,
    );
    assert.equal(f.state.sent.length, 0);
  } finally {
    f.db.close();
  }
});

test("an explicitly supplied pack owns its paths, city id and local midnight without changing legacy Plzen ids", async () => {
  // These coordinates are QA fixtures, not an approved additional city.
  const city = { ...PLZEN, id: "qa-city", timezone: "America/New_York" };
  const f = fixture({ city });
  try {
    f.setNow(Date.parse("2026-11-01T01:00:00Z"));
    await runRewardWorker(f.n, f.send, { clock: f.clock });
    const ids = f.db
      .prepare("SELECT id FROM native_days ORDER BY day")
      .all()
      .map((r) => r.id);
    assert.deepEqual(ids, ["qa-city-2026-10-31-v1", "qa-city-2026-11-01-v1"]);
    const m = f.n.day(ids[0]);
    assert.equal(m.cityId, city.id);
    assert.equal(m.timezone, city.timezone);
    assert.equal(m.startsAt, Date.parse("2026-10-31T04:00:00Z"));
    assert.equal((await f.n.snapshot(f.player)).day.id, ids[0]);
    assert.throws(
      () =>
        nativeManifest(
          { ...plan, cityId: "qa-city" },
          { coins: { available: "1000" }, zones: { available: "1000" } },
        ),
      /Supply bounded public-path/,
    );
  } finally {
    f.db.close();
  }
});

test("native v1 refuses a map-only shortfall before sending and without changing the contract's six-slot rule", async () => {
  const city = {
    ...PLZEN,
    candidates: PLZEN.candidates.filter((c) => c.sector !== "west"),
  };
  const f = fixture({ city });
  try {
    await assert.rejects(
      runRewardWorker(f.n, f.send, { clock: f.clock }),
      /Native v1 requires six/,
    );
    assert.equal(f.state.sent.length, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM native_days").get().n, 0);
    assert.equal(
      JSON.parse(f.db.prepare("SELECT body FROM world_blueprints").get().body)
        .zones.length,
      5,
    );
  } finally {
    f.db.close();
  }
});

test("an already published day is audited again and mismatched terms cannot be closed or republished", async () => {
  for (const atClosure of [false, true]) {
    const f = fixture();
    try {
      const m = await ready(f);
      f.state.days.get(m.id).coin_unit = "1";
      if (atClosure) f.setNow(m.endsAt + 86400001);
      f.state.sent.length = 0;
      await assert.rejects(
        runRewardWorker(f.n, f.send, { clock: f.clock }),
        /no longer matches|before closure/,
      );
      assert.equal(f.state.sent.length, 0);
      assert.equal(
        f.db.prepare("SELECT state FROM native_days WHERE id=?").get(m.id)
          .state,
        "published",
      );
      assert.equal(f.state.days.get(m.id).closed, false);
    } finally {
      f.db.close();
    }
  }
});

test("crossing midnight during preparation keeps expired intent and publishes only the still-valid date", async () => {
  const f = fixture();
  try {
    f.setNow(plan.endsAt - 100);
    const view = f.n.view;
    let advanced = false;
    f.n.view = async (method, args, fresh) => {
      const result = await view(method, args, fresh);
      if (method === "get_treasury" && !advanced) {
        advanced = true;
        f.setNow(plan.endsAt + 1);
      }
      return result;
    };
    await runRewardWorker(f.n, f.send, { clock: f.clock });
    assert.deepEqual(
      f.state.sent
        .filter((s) => s.method === "publish_day")
        .map((s) => s.args.day_id),
      ["plzen-2026-11-01-v1"],
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM native_days WHERE id='plzen-2026-10-31-v1'")
        .get().state,
      "prepared",
    );
    assert.equal(f.state.days.has("plzen-2026-10-31-v1"), false);
  } finally {
    f.db.close();
  }
});

test("a pack without public path samples cannot publish unbacked or foreign-city coins", async () => {
  const f = fixture({ city: { ...PLZEN, paths: [] } });
  try {
    await runRewardWorker(f.n, f.send, { clock: f.clock });
    assert.equal(f.state.sent.length, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM native_days").get().n, 0);
  } finally {
    f.db.close();
  }
});
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

test("paused claims preserve accepted rights while verified exit maintenance continues", async () => {
  const f = fixture();
  try {
    const m = await ready(f);
    const receipt = await f.n.submit(f.player, input(f, m));
    maintenanceVault(f);
    const original = f.n.view;
    f.n.view = async (method, args, fresh) => {
      const value = await original(method, args, fresh);
      return method === "get_config" ? { ...value, paused: true } : value;
    };
    f.setNow(m.endsAt + 86400001);
    f.state.sent.length = 0;
    await assert.rejects(
      runRewardWorker(f.n, f.send, { clock: f.clock }),
      /claims are paused/,
    );
    assert.deepEqual(f.state.sent, [
      {
        method: "maintain_vault",
        args: { vault_id: "exit.factory.testnet", action: "advance" },
      },
    ]);
    assert.equal(
      f.db
        .prepare("SELECT state FROM native_reward_claims WHERE id=?")
        .get(receipt.id).state,
      "queued",
    );
    assert.equal(
      f.db.prepare("SELECT state FROM native_days WHERE id=?").get(m.id).state,
      "published",
    );
    assert.equal(f.state.days.get(m.id).closed, false);
    assert.match(f.n.workerStatus().last_error, /paused/);
    assert.equal(
      f.db.prepare("SELECT last_action FROM native_vault_jobs").get()
        .last_action,
      "advance",
    );
  } finally {
    f.db.close();
  }
});

test("a failing oldest claim cannot stop exit maintenance or let a later receipt overtake it", async () => {
  const f = fixture();
  try {
    const m = await ready(f);
    const first = await f.n.submit(f.player, input(f, m));
    f.setNow(NOW + 3600000);
    const second = await f.n.submit(
      f.player,
      input(f, m, { index: 1, fix: f.fix(m.coins[1]) }),
    );
    maintenanceVault(f);
    f.setNow(m.endsAt + 86400001);
    f.state.sent.length = 0;
    const attempted = [];
    const send = async (method, args) => {
      attempted.push({ method, args });
      if (method === "claim")
        throw Error("oldest claim is temporarily unavailable");
      return f.send(method, args);
    };
    await assert.rejects(
      runRewardWorker(f.n, send, { clock: f.clock }),
      /oldest claim/,
    );
    assert.deepEqual(
      attempted.map((x) => x.method),
      ["claim", "maintain_vault"],
    );
    assert.equal(attempted[0].args.claim.receipt_id, first.id);
    assert.equal(attempted[1].args.action, "advance");
    assert.equal(
      f.db
        .prepare("SELECT state FROM native_reward_claims WHERE id=?")
        .get(first.id).state,
      "retrying",
    );
    assert.equal(
      f.db
        .prepare("SELECT state FROM native_reward_claims WHERE id=?")
        .get(second.id).state,
      "queued",
    );
    assert.equal(
      f.db.prepare("SELECT state FROM native_days WHERE id=?").get(m.id).state,
      "published",
    );
    assert.equal(f.state.days.get(m.id).closed, false);
    assert.match(f.n.workerStatus().last_error, /oldest claim/);
  } finally {
    f.db.close();
  }
});

test("worker identity mismatch blocks maintenance as well as settlement", async () => {
  const f = fixture();
  try {
    maintenanceVault(f);
    const original = f.n.view;
    f.n.view = async (method, args, fresh) => {
      const value = await original(method, args, fresh);
      return method === "get_config" ? { ...value, attestor: "wrong" } : value;
    };
    await assert.rejects(
      runRewardWorker(f.n, f.send, { clock: f.clock }),
      /identity prevents/,
    );
    assert.equal(f.state.sent.length, 0);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM native_vault_jobs").get().n,
      0,
    );
  } finally {
    f.db.close();
  }
});

test("maintenance rejects changed code, non-keyless children and another strategy during pause", async () => {
  for (const alter of [
    (p) => {
      p.codeHash = "changed";
    },
    (p) => {
      p.keys = [{}];
    },
    (p) => {
      p.state.pool = "unreviewed.pool.testnet";
    },
    (p) => {
      p.state.beneficiary = "another.testnet";
    },
  ]) {
    const f = fixture();
    try {
      const probe = maintenanceVault(f);
      alter(probe);
      const original = f.n.view;
      f.n.view = async (method, args, fresh) => {
        const value = await original(method, args, fresh);
        return method === "get_config" ? { ...value, paused: true } : value;
      };
      await assert.rejects(
        runRewardWorker(f.n, f.send, { clock: f.clock }),
        /paused/,
      );
      assert.equal(f.state.sent.length, 0);
      assert.ok(
        f.db.prepare("SELECT last_error FROM native_vault_jobs").get()
          .last_error,
      );
    } finally {
      f.db.close();
    }
  }
});

test("automatic collection metadata follows reviewed publication, actual pending rights and pause", async () => {
  const f = fixture(),
    m = await ready(f);
  const snapshot = () =>
    f.n.snapshot(f.player, {
      accountId: f.accountId,
      location: m.coins[0],
      fresh: true,
    });
  const first = await snapshot();
  assert.equal(first.network, "testnet");
  assert.equal(first.accountId, f.accountId);
  assert.equal(first.generatedAt, f.clock());
  assert.deepEqual(first.collection, {
    available: true,
    paused: false,
    coinLimit: 100,
    coinsAcceptedToday: 0,
    pendingCoinsToday: 0,
    minimumIntervalMs: 3000,
  });
  const receipt = await f.n.submit(f.player, input(f, m));
  assert.equal(receipt.dayId, m.id);
  assert.equal(receipt.accountId, f.accountId);
  const queued = await snapshot();
  assert.equal(queued.collection.coinsAcceptedToday, 1);
  assert.equal(queued.collection.pendingCoinsToday, 1);
  await runRewardWorker(f.n, f.send, { clock: f.clock });
  assert.equal((await snapshot()).collection.pendingCoinsToday, 0);
  const view = f.n.view;
  f.n.view = async (method, args) =>
    method === "get_config"
      ? { ...(await view(method, args)), paused: true }
      : view(method, args);
  assert.equal((await snapshot()).collection.available, false);
  assert.equal((await snapshot()).collection.paused, true);
  f.n.view = view;
  f.state.days.delete(m.id);
  assert.equal((await snapshot()).collection.available, false);
  f.db.close();
});

test("changed reward code pauses automatic collection and blocks new capabilities but preserves old receipts", async () => {
  const f = fixture(),
    m = await ready(f);
  const receipt = await f.n.submit(f.player, input(f, m));
  f.n.provider.query = async () => ({ code_hash: "unexpected-code" });
  const s = await f.n.snapshot(f.player, {
    accountId: f.accountId,
    location: m.coins[0],
  });
  assert.equal(s.collection.available, false);
  assert.equal(s.collection.paused, true);
  assert.equal((await f.n.submit(f.player, input(f, m))).id, receipt.id);
  await assert.rejects(
    f.n.submit(f.player, input(f, m, { index: 1, fix: f.fix(m.coins[1]) })),
    (e) => e.code === "NATIVE_PAUSED",
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM native_reward_claims").get().n,
    1,
  );
  f.db.close();
});

function replaceWorker(f) {
  f.db
    .prepare(
      "UPDATE native_worker_lease SET owner=?,until_ms=?,last_success=?,last_error=? WHERE id=1",
    )
    .run("successor-worker", f.clock() + 120000, f.clock(), "successor-status");
}
function assertSuccessorUntouched(f) {
  const lease = f.db
    .prepare("SELECT * FROM native_worker_lease WHERE id=1")
    .get();
  assert.equal(lease.owner, "successor-worker");
  assert.equal(lease.last_error, "successor-status");
  assert.equal(lease.until_ms, f.clock() + 120000);
}

test("an expired worker cannot submit a claim after its receipt read or change retry state", async () => {
  for (const takeover of [false, true]) {
    const f = fixture();
    try {
      const m = await ready(f),
        accepted = await f.n.submit(f.player, input(f, m));
      const before = f.db
        .prepare("SELECT * FROM native_reward_claims WHERE id=?")
        .get(accepted.id);
      const view = f.n.view;
      f.n.view = async (method, args, fresh) => {
        const value = await view(method, args, fresh);
        if (method === "get_receipt") {
          f.setNow(f.clock() + 120001);
          if (takeover) replaceWorker(f);
        }
        return value;
      };
      f.state.sent.length = 0;
      await assert.rejects(
        runRewardWorker(f.n, f.send, { clock: f.clock }),
        /lease expired/,
      );
      assert.equal(f.state.sent.length, 0);
      assert.deepEqual(
        f.db
          .prepare("SELECT * FROM native_reward_claims WHERE id=?")
          .get(accepted.id),
        before,
      );
      if (takeover) assertSuccessorUntouched(f);
    } finally {
      f.db.close();
    }
  }
});

test("a transaction completed after takeover cannot overwrite a successor's confirmed receipt", async () => {
  const f = fixture();
  try {
    const m = await ready(f),
      accepted = await f.n.submit(f.player, input(f, m));
    f.state.sent.length = 0;
    const send = async (method, args) => {
      const result = await f.send(method, args);
      replaceWorker(f);
      f.db
        .prepare(
          "UPDATE native_reward_claims SET state='confirmed',transaction_hash='successor-transaction',attempts=0,last_error=NULL WHERE id=?",
        )
        .run(accepted.id);
      return result;
    };
    await assert.rejects(
      runRewardWorker(f.n, send, { clock: f.clock }),
      /lease expired/,
    );
    assert.equal(f.state.sent.length, 1);
    const row = f.db
      .prepare("SELECT * FROM native_reward_claims WHERE id=?")
      .get(accepted.id);
    assert.equal(row.state, "confirmed");
    assert.equal(row.transaction_hash, "successor-transaction");
    assert.equal(row.last_error, null);
    assert.equal(row.attempts, 0);
    assertSuccessorUntouched(f);
  } finally {
    f.db.close();
  }
});

test("publication fences a late chain lookup before any new transaction", async () => {
  const f = fixture();
  try {
    const view = f.n.view;
    f.n.view = async (method, args, fresh) => {
      const value = await view(method, args, fresh);
      if (method === "get_day") replaceWorker(f);
      return value;
    };
    await assert.rejects(
      runRewardWorker(f.n, f.send, { clock: f.clock }),
      /lease expired/,
    );
    assert.equal(f.state.sent.length, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM native_days").get().n, 0);
    assertSuccessorUntouched(f);
  } finally {
    f.db.close();
  }
});

test("closure cannot send or replace a successor's day reconciliation after a late read", async () => {
  for (const alreadyClosed of [false, true]) {
    const f = fixture();
    try {
      const m = await ready(f);
      f.setNow(m.endsAt + 86400001);
      const view = f.n.view;
      f.n.view = async (method, args, fresh) => {
        const value = await view(method, args, fresh);
        if (method === "get_day") {
          replaceWorker(f);
          f.db
            .prepare("UPDATE native_days SET updated_at=7 WHERE id=?")
            .run(m.id);
          return { ...value, closed: alreadyClosed };
        }
        return value;
      };
      f.state.sent.length = 0;
      await assert.rejects(
        runRewardWorker(f.n, f.send, { clock: f.clock }),
        /lease expired/,
      );
      assert.equal(f.state.sent.length, 0);
      const row = f.db
        .prepare("SELECT state,updated_at FROM native_days WHERE id=?")
        .get(m.id);
      assert.equal(row.state, "published");
      assert.equal(row.updated_at, 7);
      assertSuccessorUntouched(f);
    } finally {
      f.db.close();
    }
  }
});

test("a late vault observation cannot replace another keeper's state or failure", async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    try {
      maintenanceVault(f);
      const original = f.n.view;
      f.n.view = async (method, args, fresh) => {
        const value = await original(method, args, fresh);
        return method === "get_config" ? { ...value, paused: true } : value;
      };
      const query = f.n.provider.query;
      f.n.provider.query = async (request) => {
        const value = await query(request);
        if (request.method_name === "get_state") {
          replaceWorker(f);
          f.db
            .prepare("INSERT INTO native_vault_jobs VALUES(?,?,?,?,?)")
            .run(
              "exit.factory.testnet",
              987654321,
              "successor-action",
              "successor-state",
              "successor-error",
            );
          if (fail) throw Error("old RPC failed after takeover");
        }
        return value;
      };
      await assert.rejects(
        runRewardWorker(f.n, f.send, { clock: f.clock }),
        /lease expired/,
      );
      assert.equal(f.state.sent.length, 0);
      const job = f.db.prepare("SELECT * FROM native_vault_jobs").get();
      assert.equal(job.next_check, 987654321);
      assert.equal(job.last_state, "successor-state");
      assert.equal(job.last_action, "successor-action");
      assert.equal(job.last_error, "successor-error");
      assertSuccessorUntouched(f);
    } finally {
      f.db.close();
    }
  }
});

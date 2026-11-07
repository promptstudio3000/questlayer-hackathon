import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/database.mjs";
import {
  ensurePayoutSchema,
  runPayoutWorker,
  pendingPayout,
} from "../server/payouts/worker.mjs";
import {
  buildPayoutDay,
  PAYOUT_MIN_YOCTO,
  PAYOUT_GRACE_MS,
} from "../server/payouts/payout-tree.mjs";

const NOW = Date.parse("2026-11-06T01:00:00Z");
const DAY = "payout-2026-11-05-v1";
function fixture(t, count = 2, path = ":memory:") {
  const db = openDatabase(path);
  t.after(() => {
    if (db.isOpen) db.close();
  });
  ensurePayoutSchema(db);
  const tree = buildPayoutDay({
    dayId: DAY,
    entries: Array.from({ length: count }, (_, i) => ({
      accountId: `player${i}.testnet`,
      amountYocto: PAYOUT_MIN_YOCTO * BigInt(i + 1),
    })),
  });
  db.prepare(
    "INSERT INTO payout_days VALUES(?,?,?,?,?,?,'pending',NULL,NULL,NULL,NULL,?,?)",
  ).run(
    DAY,
    "2026-11-05",
    tree.root,
    JSON.stringify(tree.publish),
    String(tree.total),
    count,
    NOW,
    NOW,
  );
  for (const c of tree.claims) {
    db.prepare(
      "INSERT INTO payout_claims VALUES(?,?,?,?,?,'queued',NULL,0,NULL,?)",
    ).run(
      DAY,
      c.index,
      c.account_id,
      c.amount_yocto,
      JSON.stringify(c.proof),
      NOW,
    );
    db.prepare("INSERT INTO payout_items VALUES(?,'coin',?,?,?,?,?)").run(
      `coin-${c.index}`,
      DAY,
      `player-${c.index}`,
      c.account_id,
      c.amount_yocto,
      NOW,
    );
  }
  const chain = fakeChain(tree);
  return { db, tree, chain };
}

function fakeChain(tree) {
  let day = null;
  const statuses = tree.claims.map(() => "unclaimed"),
    mints = tree.claims.map(() => 0),
    calls = [];
  const chain = {
    statuses,
    mints,
    calls,
    get day() {
      return day;
    },
    settle(index, success = true) {
      assert.equal(statuses[index], "pending");
      statuses[index] = success ? "paid" : "unclaimed";
      if (success) mints[index]++;
    },
    async view(method, args) {
      if (method === "get_payout_config") return { settlement_status: true };
      if (method === "get_payout_day") return day;
      if (method === "get_payout_progress")
        return (
          day && {
            root: day.root,
            leaves: day.leaves,
            closed: day.closed,
            paid_leaves: statuses.filter((x) => x === "paid").length,
            pending_leaves: statuses.filter((x) => x === "pending").length,
            statuses: args.indexes.map((i) => statuses[i]),
          }
        );
      throw Error(`Unexpected view ${method}`);
    },
    async call(method, args) {
      calls.push({ method, args });
      if (method === "publish_payout_day") {
        if (day) throw Error("Day exists");
        day = {
          ...args,
          coins_reserved: args.coins_yocto,
          zones_reserved: args.zones_yocto,
          published_at: NOW,
          closed: false,
        };
      } else if (method === "claim_payout") {
        assert.equal(day.closed, false);
        for (const c of args.claims)
          if (statuses[c.index] === "unclaimed") statuses[c.index] = "pending";
      } else if (method === "close_payout_day") {
        assert.ok(
          statuses.every((x) => x === "paid"),
          "unpaid rights must prevent closure",
        );
        day.closed = true;
      } else throw Error(`Unexpected call ${method}`);
      return `tx-${calls.length}`;
    },
  };
  return chain;
}

test("a transaction hash leaves rewards pending until each mint is confirmed", async (t) => {
  const { db, tree, chain } = fixture(t);
  await runPayoutWorker(db, { ...chain, now: NOW });
  assert.equal(
    pendingPayout(db, "player-0").yocto,
    tree.claims[0].amount_yocto,
  );
  chain.settle(0);
  await runPayoutWorker(db, { ...chain, now: NOW + 60_000 });
  assert.equal(pendingPayout(db, "player-0").yocto, "0");
  assert.equal(
    pendingPayout(db, "player-1").yocto,
    tree.claims[1].amount_yocto,
  );
  assert.deepEqual(chain.mints, [1, 0]);
});

test("partial failure retries only the failed leaf after worker restart", async (t) => {
  const { db, chain } = fixture(t);
  await runPayoutWorker(db, { ...chain, now: NOW });
  chain.settle(0);
  chain.settle(1, false);
  await runPayoutWorker(db, { ...chain, now: NOW + 60_000 });
  const batches = chain.calls.filter((c) => c.method === "claim_payout");
  assert.deepEqual(
    batches.map((c) => c.args.claims.map((x) => x.index)),
    [[0, 1], [1]],
  );
  chain.settle(1);
  await runPayoutWorker(db, { ...chain, now: NOW + 120_000 });
  assert.deepEqual(chain.mints, [1, 1]);
  assert.equal(pendingPayout(db, "player-1").yocto, "0");
});

test("an unresolved day cannot close after the grace period", async (t) => {
  const { db, chain } = fixture(t);
  await runPayoutWorker(db, { ...chain, now: NOW });
  await runPayoutWorker(db, { ...chain, now: NOW + PAYOUT_GRACE_MS + 120_000 });
  assert.equal(
    chain.calls.filter((c) => c.method === "close_payout_day").length,
    0,
  );
  assert.ok(BigInt(pendingPayout(db, "player-0").yocto) > 0n);
});

test("a lost claim reply is recovered from finalized state without another mint", async (t) => {
  const { db, chain } = fixture(t);
  const call = async (method, args) => {
    const tx = await chain.call(method, args);
    if (method === "claim_payout") {
      chain.settle(0);
      chain.settle(1);
      throw Error("Connection lost after execution");
    }
    return tx;
  };
  await runPayoutWorker(db, { view: chain.view, call, now: NOW });
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n,
    0,
  );
  await runPayoutWorker(db, { ...chain, now: NOW + 60_000 });
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n,
    2,
  );
  assert.equal(
    chain.calls.filter((c) => c.method === "claim_payout").length,
    1,
  );
  assert.deepEqual(chain.mints, [1, 1]);
});

test("lost publication reply requires the exact stored commitment", async (t) => {
  const { db, chain } = fixture(t);
  await runPayoutWorker(db, {
    view: chain.view,
    now: NOW,
    call: async (method, args) => {
      const tx = await chain.call(method, args);
      if (method === "publish_payout_day") throw Error("Day exists");
      return tx;
    },
  });
  assert.equal(
    chain.calls.filter((c) => c.method === "publish_payout_day").length,
    1,
  );
  assert.equal(
    chain.calls.filter((c) => c.method === "claim_payout").length,
    1,
  );
  await runPayoutWorker(db, { ...chain, now: NOW + 60_000 });
  assert.equal(
    chain.calls.filter((c) => c.method === "publish_payout_day").length,
    1,
  );
});

test("Day exists with another root or reservation never activates or pays the day", async (t) => {
  const { db, tree, chain } = fixture(t);
  await chain.call("publish_payout_day", {
    ...tree.publish,
    root: "f".repeat(64),
  });
  const result = await runPayoutWorker(db, { ...chain, now: NOW });
  assert.equal(result.published, 0);
  assert.equal(
    chain.calls.filter((c) => c.method === "claim_payout").length,
    0,
  );
  assert.match(
    db.prepare("SELECT last_error FROM payout_days WHERE day_id=?").get(DAY)
      .last_error,
    /commitment mismatch/,
  );
  assert.ok(BigInt(pendingPayout(db, "player-0").yocto) > 0n);
});

test("repeated transport failures keep rights and retry beyond five attempts", async (t) => {
  const { db, chain } = fixture(t);
  const call = async (method, args) => {
    if (method === "claim_payout")
      throw Error("RPC unavailable before broadcast");
    return chain.call(method, args);
  };
  for (let i = 0; i < 7; i++)
    await runPayoutWorker(db, {
      view: chain.view,
      call,
      now: NOW + i * 3_600_000,
    });
  assert.equal(
    db.prepare("SELECT MIN(attempts) n FROM payout_claims").get().n,
    7,
  );
  assert.ok(BigInt(pendingPayout(db, "player-0").yocto) > 0n);
  await runPayoutWorker(db, { ...chain, now: NOW + 8 * 3_600_000 });
  chain.settle(0);
  chain.settle(1);
  await runPayoutWorker(db, { ...chain, now: NOW + 9 * 3_600_000 });
  assert.deepEqual(chain.mints, [1, 1]);
  assert.equal(pendingPayout(db, "player-0").yocto, "0");
});

test("a missing or invalid final status keeps the reward visible and sends nothing", async (t) => {
  const { db, chain } = fixture(t);
  await runPayoutWorker(db, { ...chain, now: NOW });
  const count = chain.calls.length;
  for (const broken of [null, { statuses: ["paid", "paid"] }]) {
    await runPayoutWorker(db, {
      call: chain.call,
      now: NOW + 60_000,
      view: async (method, args) =>
        method === "get_payout_progress" ? broken : chain.view(method, args),
    });
    assert.equal(chain.calls.length, count);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n,
      0,
    );
    assert.ok(BigInt(pendingPayout(db, "player-0").yocto) > 0n);
  }
});

test("an incompatible contract cannot start publication or payout", async (t) => {
  const { db, chain } = fixture(t);
  await assert.rejects(
    runPayoutWorker(db, {
      ...chain,
      now: NOW,
      view: async () => ({ settlement_status: false }),
    }),
    /finalized settlement status/,
  );
  assert.equal(chain.calls.length, 0);
});

test("two workers share one durable lease", async (t) => {
  const { db, chain } = fixture(t);
  let release, entered;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = runPayoutWorker(db, {
    view: chain.view,
    now: NOW,
    call: async (method, args) => {
      const tx = await chain.call(method, args);
      if (method === "claim_payout") {
        entered();
        await wait;
      }
      return tx;
    },
  });
  await started;
  assert.deepEqual(await runPayoutWorker(db, { ...chain, now: NOW }), {
    busy: true,
  });
  release();
  await first;
  assert.equal(
    chain.calls.filter((c) => c.method === "claim_payout").length,
    1,
  );
});

test("an expired worker cannot overwrite its successor after a delayed reply", async (t) => {
  const { db, chain } = fixture(t);
  let clock = NOW,
    release,
    entered;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = runPayoutWorker(db, {
    view: chain.view,
    now: NOW,
    clock: () => clock,
    call: async (method, args) => {
      const tx = await chain.call(method, args);
      if (method === "claim_payout") {
        entered();
        await wait;
      }
      return tx;
    },
  });
  const rejected = assert.rejects(first, /lease expired/);
  await started;
  chain.settle(0);
  chain.settle(1);
  clock += 120_001;
  await runPayoutWorker(db, { ...chain, now: clock, clock: () => clock });
  release();
  await rejected;
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n,
    2,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM payout_claims WHERE tx IS NOT NULL")
      .get().n,
    0,
  );
  assert.equal(
    db.prepare("SELECT last_error FROM payout_days WHERE day_id=?").get(DAY)
      .last_error,
    null,
  );
  assert.deepEqual(chain.mints, [1, 1]);
});

test("fully paid days close and retain confirmations after a lost close response", async (t) => {
  const { db, chain } = fixture(t);
  await runPayoutWorker(db, { ...chain, now: NOW });
  chain.settle(0);
  chain.settle(1);
  await runPayoutWorker(db, {
    view: chain.view,
    now: NOW + PAYOUT_GRACE_MS + 60_000,
    call: async (method, args) => {
      await chain.call(method, args);
      throw Error("Lost close reply");
    },
  });
  assert.equal(chain.day.closed, true);
  await runPayoutWorker(db, { ...chain, now: NOW + PAYOUT_GRACE_MS + 120_000 });
  assert.equal(
    db.prepare("SELECT state FROM payout_days WHERE day_id=?").get(DAY).state,
    "closed",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n,
    2,
  );
  assert.equal(
    chain.calls.filter((c) => c.method === "close_payout_day").length,
    1,
  );
});

test("bounded reconciliation advances across pending and paid leaves", async (t) => {
  const { db, chain } = fixture(t, 12);
  await runPayoutWorker(db, { ...chain, now: NOW, maxChecks: 5 });
  assert.equal(chain.statuses.filter((x) => x === "pending").length, 5);
  await runPayoutWorker(db, { ...chain, now: NOW + 60_000, maxChecks: 5 });
  assert.equal(chain.statuses.filter((x) => x === "pending").length, 10);
  await runPayoutWorker(db, { ...chain, now: NOW + 120_000, maxChecks: 5 });
  assert.equal(chain.statuses.filter((x) => x === "pending").length, 12);
  chain.statuses.forEach((_, i) => chain.settle(i));
  for (let i = 3; i <= 6; i++)
    await runPayoutWorker(db, {
      ...chain,
      now: NOW + i * 60_000,
      maxChecks: 5,
    });
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n,
    12,
  );
  assert.deepEqual(chain.mints, Array(12).fill(1));
});

test("reopening the durable database recovers a submission without its transaction hash", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-payout-restart-"));
  const path = join(dir, "fixture.sqlite");
  const { db, chain } = fixture(t, 2, path);
  await runPayoutWorker(db, {
    view: chain.view,
    now: NOW,
    call: async (method, args) => {
      const tx = await chain.call(method, args);
      if (method === "claim_payout")
        throw Error("Process lost the submission reply");
      return tx;
    },
  });
  db.close();
  chain.settle(0);
  chain.settle(1, false);
  const reopened = openDatabase(path);
  t.after(() => {
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await runPayoutWorker(reopened, { ...chain, now: NOW + 60_000 });
  assert.equal(
    reopened.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n,
    1,
  );
  assert.deepEqual(
    chain.calls
      .filter((c) => c.method === "claim_payout")
      .at(-1)
      .args.claims.map((c) => c.index),
    [1],
  );
  chain.settle(1);
  await runPayoutWorker(reopened, { ...chain, now: NOW + 120_000 });
  assert.deepEqual(chain.mints, [1, 1]);
  assert.equal(pendingPayout(reopened, "player-1").yocto, "0");
});

test("a first submission arriving after a successor's payment cannot mint twice", async (t) => {
  const { db, chain } = fixture(t);
  let clock = NOW,
    release,
    entered;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = runPayoutWorker(db, {
    view: chain.view,
    now: NOW,
    clock: () => clock,
    call: async (method, args) => {
      if (method === "claim_payout") {
        entered();
        await wait;
      }
      return chain.call(method, args);
    },
  });
  const rejected = assert.rejects(first, /lease expired/);
  await started;
  clock += 120_001;
  await runPayoutWorker(db, { ...chain, now: clock, clock: () => clock });
  chain.settle(0);
  chain.settle(1);
  release();
  await rejected;
  await runPayoutWorker(db, {
    ...chain,
    now: clock + 60_000,
    clock: () => clock,
  });
  assert.equal(
    chain.calls.filter((c) => c.method === "claim_payout").length,
    2,
  );
  assert.deepEqual(chain.mints, [1, 1]);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM payout_confirmations").get().n,
    2,
  );
});

test("an older pending day cannot starve a later day at the reconciliation limit", async (t) => {
  const { db, chain } = fixture(t, 1);
  const nextId = "payout-2026-11-06-v1";
  const next = buildPayoutDay({
    dayId: nextId,
    entries: [{ accountId: "later.testnet", amountYocto: PAYOUT_MIN_YOCTO }],
  });
  const later = fakeChain(next);
  const view = (method, args) =>
    args?.day_id === nextId
      ? later.view(method, args)
      : chain.view(method, args);
  const call = (method, args) =>
    args.day_id === nextId
      ? later.call(method, args)
      : chain.call(method, args);
  await runPayoutWorker(db, { view, call, now: NOW, maxChecks: 1 });
  db.prepare(
    "INSERT INTO payout_days VALUES(?,?,?,?,?,?,'pending',NULL,NULL,NULL,NULL,?,?)",
  ).run(
    nextId,
    "2026-11-06",
    next.root,
    JSON.stringify(next.publish),
    String(next.total),
    1,
    NOW,
    NOW,
  );
  const c = next.claims[0];
  db.prepare(
    "INSERT INTO payout_claims VALUES(?,?,?,?,?,'queued',NULL,0,NULL,?)",
  ).run(nextId, 0, c.account_id, c.amount_yocto, JSON.stringify(c.proof), NOW);
  for (let i = 1; i <= 3; i++)
    await runPayoutWorker(db, {
      view,
      call,
      now: NOW + i * 60_000,
      maxChecks: 1,
    });
  assert.deepEqual(chain.statuses, ["pending"]);
  assert.deepEqual(later.statuses, ["pending"]);
  later.settle(0);
  for (let i = 4; i <= 6; i++)
    await runPayoutWorker(db, {
      view,
      call,
      now: NOW + i * 60_000,
      maxChecks: 1,
    });
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM payout_confirmations WHERE day_id=?")
      .get(nextId).n,
    1,
  );
  assert.deepEqual(chain.mints, [0]);
  assert.deepEqual(later.mints, [1]);
});

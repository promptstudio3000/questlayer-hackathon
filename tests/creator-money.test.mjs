// Creator money publisher and quotes against a fake chain: no network.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorLifecycle } from "../server/creators/lifecycle.mjs";
import { CreatorMoney } from "../server/native/creator-money.mjs";

const NOW = Date.parse("2026-11-02T09:00:00Z");
const CONTRACT = "questlayer-creators-20261101.testnet";
const NEAR = 10n ** 24n;
const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64");
const manifest = {
  network: "testnet",
  contractId: CONTRACT,
  policy: { max_round_budget: (5n * NEAR).toString() },
};

// Minimal creators contract state machine behind an RPC `call_function` view.
function fakeChain() {
  const state = {
    quests: new Map(),
    access: new Map(),
    creators: new Map(),
    rounds: new Map(),
    fund: 3n * NEAR,
    openRound: null,
    calls: [],
    failNext: null,
  };
  const creator = (id) =>
    state.creators.get(id) ?? { credit: "0", pending: "0", withdrawn: "0" };
  const views = {
    get_config: () => ({
      treasury_bps: "2000",
      open_round: state.openRound,
      policy: { version: "creator-money-v1" },
    }),
    get_treasury: () => ({
      fund_available: state.fund.toString(),
      rounds_reserved: "0",
    }),
    get_quest: ({ quest_id }) => state.quests.get(quest_id) ?? null,
    get_access: ({ quest_id, account_id }) =>
      state.access.get(`${quest_id}|${account_id}`) ?? null,
    get_creator: ({ account_id }) => creator(account_id),
    get_round: ({ day }) => state.rounds.get(day) ?? null,
  };
  const provider = {
    async viewNodeStatus() {
      return { chain_id: "testnet", sync_info: { syncing: false } };
    },
    async query(q) {
      assert.equal(q.request_type, "call_function");
      assert.equal(q.account_id, CONTRACT);
      const args = JSON.parse(Buffer.from(q.args_base64, "base64").toString());
      const fn = views[q.method_name];
      assert.ok(fn, `unknown view ${q.method_name}`);
      return {
        result: [...Buffer.from(JSON.stringify(fn(args)))],
        block_height: 1,
        logs: [],
      };
    },
  };
  let n = 0;
  const transport = {
    accountId: CONTRACT,
    async sign({ receiverId, actions }) {
      const hash = `P${++n}`;
      const [a] = actions;
      const method = a.functionCall.methodName;
      const args = JSON.parse(Buffer.from(a.functionCall.args).toString());
      return {
        hash,
        async send() {
          state.calls.push({ hash, receiverId, method, args });
          if (state.failNext) {
            const f = state.failNext;
            state.failNext = null;
            if (f instanceof Error) throw f;
            return { status: { Failure: f } };
          }
          if (method === "register_quest") {
            if (state.quests.has(args.quest_id))
              return {
                status: {
                  Failure: {
                    ActionError: {
                      kind: {
                        FunctionCallError: {
                          ExecutionError:
                            "Smart contract panicked: Quest exists",
                        },
                      },
                    },
                  },
                },
              };
            state.quests.set(args.quest_id, {
              author: args.author_id,
              price: args.price,
              open: true,
            });
          }
          if (method === "open_round") {
            if (state.openRound)
              return {
                status: {
                  Failure: {
                    ActionError: {
                      kind: {
                        FunctionCallError: {
                          ExecutionError:
                            "Smart contract panicked: A round is already open",
                        },
                      },
                    },
                  },
                },
              };
            state.openRound = args.day;
            state.rounds.set(args.day, { budget: args.budget, finalized: false });
          }
          if (method === "finalize_round") {
            state.openRound = null;
            const r = state.rounds.get(args.day);
            if (r) r.finalized = true;
          }
          if (state.loseReply) {
            // The call landed on chain, but its reply never reached us.
            state.loseReply = false;
            throw new Error("fetch failed");
          }
          return { status: { SuccessValue: encode(true) } };
        },
      };
    },
  };
  return { state, provider, transport };
}

function fixture({ transport = true } = {}) {
  const db = openDatabase(":memory:");
  createCreatorLifecycle(db, { policy: { version: "test", xpCommitment: 1 } });
  const author = createPlayer(db, "Author", NOW),
    walker = createPlayer(db, "Walker", NOW),
    nobody = createPlayer(db, "No account yet", NOW);
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    "author.players.questlayer.testnet",
    author,
    NOW,
  );
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    "walker.players.questlayer.testnet",
    walker,
    NOW,
  );
  const chain = fakeChain();
  let now = NOW;
  const money = new CreatorMoney(db, chain.provider, manifest, {
    transport: transport ? chain.transport : null,
    clock: () => now,
    roundBudgetYocto: NEAR,
  });
  const publish = (id, by = author) => {
    db.prepare(
      "INSERT INTO creator_quests(id,author,state,version,latest_revision,published_revision,created_at,updated_at) VALUES(?,?,'published',1,1,1,?,?)",
    ).run(id, by, NOW, NOW);
    db.prepare(
      "INSERT INTO creator_revisions(quest_id,revision,content,state) VALUES(?,1,'{}','approved')",
    ).run(id);
  };
  const complete = (id, who, reference = "receipt-1") =>
    db
      .prepare(
        "INSERT INTO creator_participations(quest_id,participant,revision,state,started_at,resolved_at,resolved_by,resolution_reference) VALUES(?,?,1,'resolved',?,?,'validator',?)",
      )
      .run(id, who, NOW, NOW, reference);
  return {
    db,
    author,
    walker,
    nobody,
    chain,
    money,
    publish,
    complete,
    advance: (ms) => (now += ms),
    jobs: () =>
      db
        .prepare(
          "SELECT kind,state,args,transaction_hash,last_error FROM creator_money_jobs ORDER BY seq",
        )
        .all(),
  };
}

test("published quests by linked authors are registered once; the first UTC round opens with the capped budget", async () => {
  const f = fixture();
  f.publish("q-castle");
  f.publish("q-no-account", f.nobody);
  const r = await f.money.run();
  assert.deepEqual(r, { confirmed: 2, failed: 0, retried: 0 });
  const calls = f.chain.state.calls.map((c) => [c.method, c.args]);
  assert.deepEqual(calls, [
    [
      "register_quest",
      {
        quest_id: "q-castle",
        author_id: "author.players.questlayer.testnet",
        price: "0",
      },
    ],
    ["open_round", { day: "2026-11-02", budget: NEAR.toString() }],
  ]);
  assert.equal(f.chain.state.openRound, "2026-11-02");
  // A second run changes nothing: the mirror is idempotent.
  assert.deepEqual(await f.money.run(), {
    confirmed: 0,
    failed: 0,
    retried: 0,
  });
  assert.equal(f.chain.state.calls.length, 2);
  const rows = f.db
    .prepare(
      "SELECT quest_id,author_account,transaction_hash FROM creator_money_quests WHERE registered_at IS NOT NULL",
    )
    .all();
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      {
        quest_id: "q-castle",
        author_account: "author.players.questlayer.testnet",
        transaction_hash: "P1",
      },
    ],
  );
  assert.equal(
    f.db
      .prepare("SELECT state FROM creator_money_rounds WHERE day='2026-11-02'")
      .get().state,
    "open",
  );
});

test("verified completions and single likes become record_support; self-likes and unlinked players are refused", async () => {
  const f = fixture();
  f.publish("q-river");
  await f.money.run();
  f.complete("q-river", f.walker);
  assert.deepEqual(f.money.like(f.walker, "q-river"), {
    liked: true,
    recorded: false,
  });
  assert.deepEqual(f.money.like(f.walker, "q-river"), {
    liked: true,
    recorded: false,
  });
  assert.throws(() => f.money.like(f.author, "q-river"), /your own quest/);
  assert.throws(
    () => f.money.like(f.nobody, "q-river"),
    /still being prepared/,
  );
  assert.throws(() => f.money.like(f.walker, "q-missing"), /not published/);
  const r = await f.money.run();
  assert.equal(r.confirmed, 2);
  const support = f.chain.state.calls
    .filter((c) => c.method === "record_support")
    .map((c) => c.args);
  assert.deepEqual(
    support.sort((a, b) => a.kind.localeCompare(b.kind)),
    [
      {
        quest_id: "q-river",
        player_id: "walker.players.questlayer.testnet",
        kind: "completion",
      },
      {
        quest_id: "q-river",
        player_id: "walker.players.questlayer.testnet",
        kind: "like",
      },
    ],
  );
  assert.deepEqual(f.money.like(f.walker, "q-river"), {
    liked: true,
    recorded: true,
  });
  const rows = f.db
    .prepare(
      "SELECT kind,transaction_hash FROM creator_money_support WHERE recorded_at IS NOT NULL ORDER BY kind",
    )
    .all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.transaction_hash));
});

test("a new UTC day finalizes yesterday before opening today; network errors retry with backoff and contract rejections are terminal", async () => {
  const f = fixture();
  await f.money.run();
  assert.equal(f.chain.state.openRound, "2026-11-02");
  f.advance(24 * 3600 * 1000);
  f.chain.state.failNext = new Error("fetch failed");
  let r = await f.money.run();
  assert.deepEqual(r, { confirmed: 0, failed: 0, retried: 1 });
  let job = f.jobs().find((j) => j.kind === "finalize_round");
  assert.equal(job.state, "retrying");
  assert.match(job.last_error, /fetch failed/);
  // Not due yet: nothing is resent.
  assert.deepEqual(await f.money.run(), {
    confirmed: 0,
    failed: 0,
    retried: 0,
  });
  f.advance(15000);
  r = await f.money.run();
  assert.equal(r.confirmed, 1);
  assert.equal(f.chain.state.openRound, null);
  assert.equal(
    f.db
      .prepare("SELECT state FROM creator_money_rounds WHERE day='2026-11-02'")
      .get().state,
    "finalized",
  );
  // Today's round opens on the next pass.
  r = await f.money.run();
  assert.equal(r.confirmed, 1);
  assert.equal(f.chain.state.openRound, "2026-11-03");
  // A quest the chain already knows is marked registered without another send.
  f.chain.state.quests.set("q-dup", { author: "x", price: "0", open: true });
  f.publish("q-dup");
  r = await f.money.run();
  assert.deepEqual(r, { confirmed: 0, failed: 1, retried: 0 });
  assert.ok(
    f.db
      .prepare(
        "SELECT registered_at FROM creator_money_quests WHERE quest_id='q-dup'",
      )
      .get().registered_at,
  );
});

test("a round opened on chain whose reply was lost is adopted and finalized, not left blocking every later round", async () => {
  const f = fixture();
  f.chain.state.loseReply = true;
  let r = await f.money.run();
  assert.deepEqual(r, { confirmed: 0, failed: 0, retried: 1 });
  assert.equal(f.chain.state.openRound, "2026-11-02");
  // The retry is refused because the round is already open on chain.
  f.advance(15000);
  r = await f.money.run();
  assert.equal(r.failed, 1);
  // The next pass adopts the chain's open round instead of opening another.
  r = await f.money.run();
  assert.equal(
    f.db
      .prepare("SELECT state,budget_yocto FROM creator_money_rounds WHERE day='2026-11-02'")
      .get().state,
    "open",
  );
  assert.equal(
    f.chain.state.calls.filter((c) => c.method === "open_round").length,
    2,
  );
  // Next UTC day: yesterday's round is finalized and today's opens.
  f.advance(24 * 3600 * 1000);
  await f.money.run();
  await f.money.run();
  assert.equal(f.chain.state.rounds.get("2026-11-02").finalized, true);
  assert.equal(f.chain.state.openRound, "2026-11-03");
});

test("round budget never exceeds the treasury or the policy cap, and no round opens on an empty fund", async () => {
  const f = fixture();
  f.chain.state.fund = NEAR / 4n;
  await f.money.run();
  assert.equal(f.chain.state.calls.at(-1).args.budget, (NEAR / 4n).toString());
  const g = fixture();
  g.chain.state.fund = 0n;
  await g.money.run();
  assert.equal(g.chain.state.calls.length, 0);
  assert.equal(
    g.db.prepare("SELECT COUNT(*) AS n FROM creator_money_rounds").get().n,
    0,
  );
});

test("quotes for buy, donate and withdraw are reviewed against live state", async () => {
  const f = fixture();
  f.chain.state.quests.set("q-paid", {
    author: "author.players.questlayer.testnet",
    price: (NEAR / 2n).toString(),
    open: true,
  });
  f.chain.state.quests.set("q-free", {
    author: "author.players.questlayer.testnet",
    price: "0",
    open: true,
  });
  const buy = await f.money.prepare("walker.players.questlayer.testnet", {
    kind: "buy",
    questId: "q-paid",
  });
  assert.equal(buy.receiverId, CONTRACT);
  assert.equal(buy.actions[0].params.methodName, "buy_access");
  assert.equal(buy.actions[0].params.deposit, (NEAR / 2n).toString());
  assert.equal(buy.creatorShare, ((NEAR * 4n) / 10n).toString());
  assert.equal(buy.treasuryShare, (NEAR / 10n).toString());
  await assert.rejects(
    f.money.prepare("walker.players.questlayer.testnet", {
      kind: "buy",
      questId: "q-free",
    }),
    /free/,
  );
  await assert.rejects(
    f.money.prepare("author.players.questlayer.testnet", {
      kind: "buy",
      questId: "q-paid",
    }),
    /wrote this quest/,
  );
  f.chain.state.access.set("q-paid|walker.players.questlayer.testnet", {
    paid: "1",
  });
  await assert.rejects(
    f.money.prepare("walker.players.questlayer.testnet", {
      kind: "buy",
      questId: "q-paid",
    }),
    /already have access/,
  );
  const donate = await f.money.prepare("walker.players.questlayer.testnet", {
    kind: "donate",
    questId: "q-free",
    amount: "1000",
  });
  assert.equal(donate.actions[0].params.methodName, "donate");
  assert.equal(donate.actions[0].params.deposit, "1000");
  await assert.rejects(
    f.money.prepare("walker.players.questlayer.testnet", {
      kind: "donate",
      questId: "q-free",
      amount: "0",
    }),
    /donation amount/,
  );
  await assert.rejects(
    f.money.prepare("author.players.questlayer.testnet", { kind: "withdraw" }),
    /Nothing to withdraw/,
  );
  f.chain.state.creators.set("author.players.questlayer.testnet", {
    credit: "777",
    pending: "0",
  });
  const w = await f.money.prepare("author.players.questlayer.testnet", {
    kind: "withdraw",
  });
  assert.equal(w.amount, "777");
  assert.equal(w.actions[0].params.deposit, "1");
  await assert.rejects(
    f.money.prepare("walker.players.questlayer.testnet", { kind: "swap" }),
    /Unknown/,
  );
});

test("without a publisher key the service only reads and quotes", async () => {
  const f = fixture({ transport: false });
  f.publish("q-x");
  assert.deepEqual(await f.money.run(), { skipped: "not-configured" });
  const snap = await f.money.snapshot(
    f.author,
    "author.players.questlayer.testnet",
  );
  assert.equal(snap.publisher, "not-configured");
  assert.equal(snap.contractId, CONTRACT);
  assert.equal(snap.treasury.fund_available, (3n * NEAR).toString());
  assert.equal(f.money.workerStatus().enabled, false);
});

test("without the creator community module the publisher still runs rounds and refuses likes", async () => {
  const db = openDatabase(":memory:");
  const chain = fakeChain();
  const money = new CreatorMoney(db, chain.provider, manifest, {
    transport: chain.transport,
    clock: () => NOW,
    roundBudgetYocto: NEAR,
  });
  assert.deepEqual(await money.run(), { confirmed: 1, failed: 0, retried: 0 });
  assert.equal(chain.state.openRound, "2026-11-02");
  assert.throws(
    () => money.like(createPlayer(db, "P", NOW), "q-1"),
    /not enabled/,
  );
});

test("the approved revision's access price is registered, then mirrored once with set_price when it changes", async () => {
  const f = fixture();
  f.publish("q-paid");
  const price = (10n ** 23n).toString();
  f.db
    .prepare("UPDATE creator_revisions SET content=? WHERE quest_id='q-paid'")
    .run(JSON.stringify({ price }));
  await f.money.run();
  const register = f.chain.state.calls.find(
    (c) => c.method === "register_quest",
  );
  assert.equal(register.args.price, price);
  // Unchanged price: nothing more.
  await f.money.run();
  assert.equal(
    f.chain.state.calls.filter((c) => c.method === "set_price").length,
    0,
  );
  // A newly approved revision with another price is mirrored exactly once.
  f.db
    .prepare(
      "INSERT INTO creator_revisions(quest_id,revision,content,state) VALUES('q-paid',2,?,'approved')",
    )
    .run(JSON.stringify({ price: "0" }));
  f.db
    .prepare("UPDATE creator_quests SET published_revision=2 WHERE id='q-paid'")
    .run();
  await f.money.run();
  await f.money.run();
  const sets = f.chain.state.calls.filter((c) => c.method === "set_price");
  assert.deepEqual(
    sets.map((c) => c.args),
    [{ quest_id: "q-paid", price: "0" }],
  );
  // An out-of-bounds stored price never reaches the chain.
  f.publish("q-wild");
  f.db
    .prepare("UPDATE creator_revisions SET content=? WHERE quest_id='q-wild'")
    .run(JSON.stringify({ price: (10n ** 30n).toString() }));
  await f.money.run();
  assert.equal(
    f.chain.state.calls.find(
      (c) => c.method === "register_quest" && c.args.quest_id === "q-wild",
    ).args.price,
    "0",
  );
});

test("paid quests start only after access is bought; free and own quests pass", async () => {
  const f = fixture();
  const author = "author.players.questlayer.testnet",
    walker = "walker.players.questlayer.testnet";
  f.chain.state.quests.set("q-free", { author, price: "0", open: true });
  f.chain.state.quests.set("q-paid", {
    author,
    price: (NEAR / 2n).toString(),
    open: true,
  });
  assert.equal(await f.money.admitStart(f.walker, "q-free", {}), true);
  await assert.rejects(f.money.admitStart(f.walker, "q-paid", {}), {
    status: 402,
    code: "CREATOR_ACCESS_REQUIRED",
  });
  await assert.rejects(f.money.admitStart(f.nobody, "q-paid", {}), {
    code: "ACCOUNT_NOT_READY",
  });
  assert.equal(await f.money.admitStart(f.author, "q-paid", {}), true);
  f.chain.state.access.set(`q-paid|${walker}`, { paid: "1" });
  assert.equal(await f.money.admitStart(f.walker, "q-paid", {}), true);
  // Reviewed as paid but not yet listed on chain: nothing can be bought yet.
  await assert.rejects(
    f.money.admitStart(f.walker, "q-later", { price: "1" }),
    { status: 409, code: "CREATOR_ACCESS_PENDING" },
  );
  assert.equal(await f.money.admitStart(f.walker, "q-later", {}), true);
});

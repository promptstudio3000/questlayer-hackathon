// Community vote on the daily creator bonus, and how creator money honours it.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorLifecycle } from "../server/creators/lifecycle.mjs";
import {
  CreatorBonusVote,
  bonusVoteSettings,
  createBonusVoteRoutes,
} from "../server/creators/bonus-vote.mjs";
import { CreatorMoney } from "../server/native/creator-money.mjs";
import { NETWORK } from "../server/native/network.mjs";

const DAY = 86400000;
const NOW = Date.parse("2026-11-02T09:00:00Z");
const CONTRACT = "questlayer-creators-20261101.testnet";

function fixture({ community = true, policy = {} } = {}) {
  const db = openDatabase(":memory:");
  if (community)
    createCreatorLifecycle(db, {
      policy: { version: "test", xpCommitment: 1 },
    });
  let now = NOW;
  const player = (name, { linked = true, active = true } = {}) => {
    const id = createPlayer(db, name, NOW - 30 * DAY);
    if (linked)
      db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
        `${name.toLowerCase()}.players.questlayer.testnet`,
        id,
        NOW - 30 * DAY,
      );
    if (active)
      db.prepare(
        "INSERT INTO history(id,player_id,kind,title,gold_u,meta,created_at) VALUES(?,?,'coin','Coin',0,'{}',?)",
      ).run(`h-${id}`, id, NOW - DAY);
    return id;
  };
  const author = player("Author"),
    maker = player("Maker"),
    walker = player("Walker"),
    runner = player("Runner"),
    idle = player("Idle", { active: false }),
    fresh = player("Fresh", { linked: false });
  const publish = (id, by = author, title = id) => {
    db.prepare(
      "INSERT INTO creator_quests(id,author,state,version,latest_revision,published_revision,created_at,updated_at) VALUES(?,?,'published',1,1,1,?,?)",
    ).run(id, by, NOW, NOW);
    db.prepare(
      "INSERT INTO creator_revisions(quest_id,revision,content,state) VALUES(?,1,?,'approved')",
    ).run(id, JSON.stringify({ title }));
  };
  const vote = new CreatorBonusVote(db, {
    clock: () => now,
    network: "testnet",
    ...policy,
  });
  return {
    db,
    vote,
    publish,
    author,
    maker,
    walker,
    runner,
    idle,
    fresh,
    advance: (ms) => (now += ms),
    now: () => now,
  };
}

test("only active explorers with an account vote, never for their own quest, within their vote budget", () => {
  const f = fixture({ policy: { votesPerExplorer: 2 } });
  f.publish("q-castle", f.author, "Castle walk");
  f.publish("q-river", f.maker);
  f.publish("q-park", f.maker);
  const ballot = f.vote.ballot(f.walker);
  assert.equal(ballot.day, "2026-11-03");
  assert.equal(ballot.closesAt, Date.parse("2026-11-03T00:00:00Z"));
  assert.equal(ballot.eligible, true);
  assert.equal(ballot.votesLeft, 2);
  assert.deepEqual(
    ballot.candidates.map((c) => [c.questId, c.title, c.votes]),
    [
      ["q-castle", "Castle walk", 0],
      ["q-park", "q-park", 0],
      ["q-river", "q-river", 0],
    ],
  );
  assert.throws(
    () => f.vote.vote(f.idle, "q-castle"),
    (e) => e.code === "NOT_ACTIVE" && e.status === 403,
  );
  assert.throws(
    () => f.vote.vote(f.fresh, "q-castle"),
    (e) => e.code === "ACCOUNT_NOT_READY",
  );
  assert.throws(() => f.vote.vote(f.author, "q-castle"), /your own quest/);
  assert.throws(() => f.vote.vote(f.walker, "q-missing"), /not on the ballot/);
  assert.throws(() => f.vote.vote(f.walker, "bad id!"), /Invalid quest id/);
  f.vote.vote(f.walker, "q-castle");
  // Repeating a vote is a no-op, not a second vote.
  let b = f.vote.vote(f.walker, "q-castle");
  assert.equal(b.votesLeft, 1);
  b = f.vote.vote(f.walker, "q-river");
  assert.equal(b.votesLeft, 0);
  assert.throws(
    () => f.vote.vote(f.walker, "q-park"),
    (e) => e.code === "NO_VOTES_LEFT",
  );
  // Taking a vote back frees it before the ballot closes.
  b = f.vote.unvote(f.walker, "q-river");
  assert.equal(b.votesLeft, 1);
  b = f.vote.vote(f.walker, "q-park");
  assert.deepEqual(
    b.candidates.filter((c) => c.mine).map((c) => c.questId),
    ["q-castle", "q-park"],
  );
});

test("the closed ballot is tallied once into the next day's bonus quests; ties go to the earlier count", () => {
  const f = fixture({ policy: { winners: 2 } });
  f.publish("q-castle");
  f.publish("q-river", f.maker);
  f.publish("q-park", f.maker);
  f.publish("q-hidden", f.maker);
  f.vote.vote(f.walker, "q-castle");
  f.advance(1000);
  f.vote.vote(f.runner, "q-river");
  f.advance(1000);
  f.vote.vote(f.walker, "q-river");
  f.vote.vote(f.runner, "q-park");
  f.vote.vote(f.runner, "q-hidden");
  f.vote.vote(f.walker, "q-hidden");
  // Still open: no result for the ballot day yet.
  assert.equal(f.vote.results("2026-11-03"), null);
  // Moderation hides a quest before the ballot closes; it drops out.
  f.db.exec(
    `CREATE TABLE IF NOT EXISTS moderation_suppressions(kind TEXT, target_id TEXT, state TEXT, reason TEXT, operator TEXT, updated_at INTEGER, PRIMARY KEY(kind,target_id))`,
  );
  f.db
    .prepare(
      "INSERT INTO moderation_suppressions VALUES('quest','q-hidden','hidden','spam','op',?)",
    )
    .run(f.now());
  f.advance(Date.parse("2026-11-03T00:00:01Z") - f.now());
  const result = f.vote.results("2026-11-03");
  assert.deepEqual(result.winners, ["q-river", "q-castle"]);
  assert.deepEqual(result.tally, [
    { questId: "q-river", votes: 2 },
    { questId: "q-castle", votes: 1 },
    { questId: "q-park", votes: 1 },
  ]);
  assert.equal(result.voters, 2);
  assert.equal(result.gated, true);
  // The stored tally is final even if a quest closes afterwards.
  f.db.exec("UPDATE creator_quests SET state='closed' WHERE id='q-castle'");
  assert.deepEqual(f.vote.results("2026-11-03").winners, [
    "q-river",
    "q-castle",
  ]);
  assert.equal(f.vote.counts("q-river"), true);
  assert.equal(f.vote.counts("q-park"), false);
  // The ballot now open is for the following day and starts empty.
  const b = f.vote.ballot(f.walker);
  assert.equal(b.day, "2026-11-04");
  assert.ok(b.candidates.every((c) => c.votes === 0));
  assert.deepEqual(b.today.winners, ["q-river", "q-castle"]);
});

test("a day without enough voters gates nothing", () => {
  const f = fixture({ policy: { minVoters: 2 } });
  f.publish("q-castle");
  f.publish("q-river", f.maker);
  f.vote.vote(f.walker, "q-castle");
  f.advance(DAY);
  const r = f.vote.results("2026-11-03");
  assert.deepEqual(r.winners, []);
  assert.equal(r.gated, false);
  assert.equal(f.vote.counts("q-river"), true);
});

test("mainnet refuses the vote and hosts without creators create no tables", () => {
  assert.throws(
    () =>
      new CreatorBonusVote(openDatabase(":memory:"), { network: "mainnet" }),
    (e) => e.code === "BONUS_VOTE_TESTNET_ONLY",
  );
  const f = fixture({ community: false });
  assert.equal(f.vote.counts("q-any"), true);
  assert.throws(
    () => f.vote.ballot(f.walker),
    (e) => e.code === "CREATORS_DISABLED",
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'creator_bonus%'",
      )
      .get().n,
    0,
  );
});

test("settings read bounded integers from the environment", () => {
  assert.deepEqual(bonusVoteSettings({}), {
    votesPerExplorer: 3,
    winners: 3,
    activeDays: 7,
    minVoters: 1,
  });
  assert.deepEqual(
    bonusVoteSettings({
      CREATOR_BONUS_VOTES_PER_EXPLORER: "5",
      CREATOR_BONUS_WINNERS: "999",
      CREATOR_BONUS_ACTIVE_DAYS: "x",
      CREATOR_BONUS_MIN_VOTERS: "4",
    }),
    { votesPerExplorer: 5, winners: 3, activeDays: 7, minVoters: 4 },
  );
});

test("routes answer the ballot and take votes for the authenticated explorer", async () => {
  const f = fixture();
  f.publish("q-castle");
  const routes = createBonusVoteRoutes(f.vote);
  const sent = [];
  const ctx = (input) => ({
    player: f.walker,
    body: async () => input,
    respond: (_res, value) => sent.push(value),
    assert: (ok, message) => {
      if (!ok) throw new Error(message);
    },
  });
  const url = new URL("http://x/api/creators/bonus-vote");
  assert.equal(
    await routes.handle(
      { method: "GET" },
      {},
      new URL("http://x/api/other"),
      ctx({}),
    ),
    false,
  );
  assert.equal(await routes.handle({ method: "GET" }, {}, url, ctx({})), true);
  assert.equal(sent[0].votesLeft, 3);
  await routes.handle(
    { method: "POST" },
    {},
    url,
    ctx({ questId: "q-castle" }),
  );
  assert.equal(sent[1].candidates[0].votes, 1);
  await routes.handle(
    { method: "POST" },
    {},
    url,
    ctx({ questId: "q-castle", action: "unvote" }),
  );
  assert.equal(sent[2].candidates[0].votes, 0);
  await assert.rejects(
    createBonusVoteRoutes(null).handle({ method: "GET" }, {}, url, ctx({})),
    /not enabled/,
  );
});

// Minimal creators contract: records which support reaches the open round.
function chain() {
  const state = { calls: [], openRound: null };
  const views = {
    get_treasury: () => ({ fund_available: (10n ** 24n).toString() }),
    get_config: () => ({ treasury_bps: "2000", open_round: state.openRound }),
  };
  const provider = {
    async viewNodeStatus() {
      return { chain_id: "testnet", sync_info: { syncing: false } };
    },
    async query(q) {
      const args = JSON.parse(Buffer.from(q.args_base64, "base64").toString());
      return {
        result: [...Buffer.from(JSON.stringify(views[q.method_name](args)))],
        block_height: 1,
        logs: [],
      };
    },
  };
  let n = 0;
  const transport = {
    accountId: CONTRACT,
    async sign({ actions }) {
      const hash = `P${++n}`;
      const method = actions[0].functionCall.methodName;
      const args = JSON.parse(
        Buffer.from(actions[0].functionCall.args).toString(),
      );
      return {
        hash,
        async send() {
          state.calls.push({ method, args });
          if (method === "open_round") state.openRound = args.day;
          if (method === "finalize_round") state.openRound = null;
          return { status: { SuccessValue: "dHJ1ZQ==" } };
        },
      };
    },
  };
  return { state, provider, transport };
}

// Creator money reads a testnet contract; the mainnet pass skips this case.
test(
  "creator money records support only for the day's bonus quests and keeps the rest for a day they win",
  { skip: NETWORK === "mainnet" && "creators contract is testnet-only" },
  async () => {
    const f = fixture();
    f.publish("q-castle");
    f.publish("q-river", f.maker);
    const c = chain();
    const money = new CreatorMoney(
      f.db,
      c.provider,
      { network: "testnet", contractId: CONTRACT },
      {
        transport: c.transport,
        clock: f.now,
        roundBudgetYocto: 10n ** 22n,
        bonusVote: f.vote,
      },
    );
    // Day 2 Nov: registrations and the round; explorers vote for 3 Nov.
    await money.run();
    f.vote.vote(f.walker, "q-river");
    f.vote.vote(f.runner, "q-river");
    // Move into 3 Nov: the 3 Nov round opens with q-river as the bonus quest.
    f.advance(Date.parse("2026-11-03T08:00:00Z") - f.now());
    await money.run();
    await money.run();
    assert.equal(c.state.openRound, "2026-11-03");
    money.like(f.walker, "q-river");
    money.like(f.walker, "q-castle");
    const r = await money.run();
    assert.equal(r.held, 1);
    assert.equal(r.confirmed, 1);
    const support = () =>
      c.state.calls
        .filter((x) => x.method === "record_support")
        .map((x) => x.args.quest_id);
    assert.deepEqual(support(), ["q-river"]);
    const held = f.db
      .prepare(
        "SELECT state,run_after,last_error FROM creator_money_jobs WHERE kind='record_support' AND json_extract(args,'$.quest_id')='q-castle'",
      )
      .get();
    assert.equal(held.state, "queued");
    assert.equal(held.run_after, Date.parse("2026-11-04T00:00:00Z"));
    assert.match(held.last_error, /community bonus/);
    const snap = await money.snapshot(f.walker);
    assert.deepEqual(snap.bonusVote.winners, ["q-river"]);
    // 4 Nov has no vote, so nothing is gated: the held like is recorded.
    f.advance(Date.parse("2026-11-04T01:00:00Z") - f.now());
    // The 3 Nov round is still open at first, so the like waits a minute
    // instead of leaking into it.
    await money.run();
    assert.deepEqual(support(), ["q-river"]);
    await money.run();
    assert.equal(c.state.openRound, "2026-11-04");
    f.advance(61000);
    await money.run();
    assert.deepEqual(support(), ["q-river", "q-castle"]);
  },
);

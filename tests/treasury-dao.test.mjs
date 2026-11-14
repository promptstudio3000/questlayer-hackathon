import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from "near-api-js";
import {
  buildPolicy,
  explorersRole,
  describe,
  parseMeta,
  normalizeProposal,
  tallyPoll,
  adoptedMix,
  dailyRun,
  checkDailyRun,
  weekOf,
  eligibleExplorers,
  createTreasuryDaoView,
  daoManifest,
  MIX_PRESETS,
  RECOMMENDED_MIX,
  sameTargets,
  LEGACY_MIX_PRESETS,
  mixPreset,
  mixShort,
  NEVER,
  VOTING_POWER,
  KEEPER_POWER,
  powerFromCounts,
  votingPowers,
} from "../server/native/treasury-dao.mjs";
import { HARD_LIMITS, mixSettings } from "../server/native/treasury-mix.mjs";
import { decodeSignedDelegate } from "../server/relayer/delegate.mjs";
import { RelayPolicyError, validateDelegate } from "../server/relayer/policy.mjs";
import { needsProtection } from "../src/signing-vault/policy.ts";
import { openDatabase, createPlayer, history } from "../server/database.mjs";
import { initializeManagedAccounts } from "../server/relayer/schema.mjs";

const DAO = "questlayer-treasury.sputnik-v2.testnet";
const DAY = 86_400_000;
const KEEPER = "keeper.op.testnet";
const COUNCIL = ["op.testnet", "council-a.op.testnet", "council-b.op.testnet"];

test("the policy uses Trezu's role names, 2 of 3 council approvals and explorer votes that never finalize", () => {
  const p = buildPolicy({ council: COUNCIL, keeper: KEEPER, explorers: ["b.testnet", "a.testnet"] });
  assert.deepEqual(p.roles.map((r) => r.name), ["Requestor", "Admin", "Approver", "Explorers"]);
  const role = (n) => p.roles.find((r) => r.name === n);
  // The keeper only files proposals.
  assert.ok(role("Requestor").permissions.every((x) => x.endsWith(":AddProposal")));
  assert.deepEqual(role("Requestor").kind.Group, [KEEPER]);
  // Explorers can only approve polls, and their quorum is out of reach.
  assert.deepEqual(role("Explorers").permissions, ["vote:VoteApprove"]);
  assert.deepEqual(role("Explorers").kind.Group, ["a.testnet", "b.testnet", KEEPER].sort());
  assert.equal(role("Explorers").vote_policy.vote.quorum, NEVER);
  assert.equal(p.default_vote_policy.threshold, "2");
  assert.equal(p.proposal_bond, "0");
  assert.throws(() => buildPolicy({ council: ["x.testnet"], keeper: KEEPER }));
  assert.throws(() => buildPolicy({ council: COUNCIL, keeper: COUNCIL[0] }));
});

test("every mix option stays inside the treasury-mix hard limits", () => {
  const s = mixSettings({}, "testnet");
  assert.ok(MIX_PRESETS.some((p) => p.id === RECOMMENDED_MIX));
  for (const { targets } of [...MIX_PRESETS, ...LEGACY_MIX_PRESETS]) {
    assert.equal(targets.staked + targets.lst + targets.stable + targets.near, 10_000);
    // Stables are all one protocol (Rhea Lend); LSTs split across two providers;
    // staked NEAR spreads over the treasury's validator pools (3+ at 40 % each).
    assert.ok(targets.stable <= HARD_LIMITS.maxProtocolBps && targets.stable <= s.maxProtocolBps);
    assert.ok(targets.lst <= 2 * s.maxProtocolBps);
    assert.ok(targets.staked <= 3 * s.maxProtocolBps);
  }
  // Lubos 11 Nov 2026: on testnet only validator staking earns: 90 % staked, 5 % USDC, 5 % USDT.
  assert.equal(RECOMMENDED_MIX, "staking-first");
  assert.deepEqual(mixPreset("staking-first").targets, { staked: 9000, lst: 0, stable: 1000, near: 0 });
  assert.equal(mixPreset("balanced").targets.lst, 5000, "polls filed before the change still tally");
  assert.equal(mixShort(mixPreset("staking-first").targets), "90/10/0");
  // Mixes adopted before "staked" existed compare as staked = 0.
  assert.ok(sameTargets({ lst: 5000, stable: 4000, near: 1000 }, mixPreset("balanced").targets));
  assert.ok(!sameTargets(mixPreset("balanced").targets, mixPreset("staking-first").targets));
});

const raw = (id, description, { proposer = KEEPER, votes = {}, status = "InProgress", kind = "Vote" } = {}) => ({
  id,
  proposer,
  description,
  kind,
  status,
  votes,
  vote_counts: {},
  submission_time: String(BigInt(Date.UTC(2026, 10, 9)) * 1_000_000n),
});

test("polls tally by approvals, ties go to the recommended option, and only the keeper's proposals count", () => {
  const closes = Date.UTC(2026, 10, 16);
  const poll = (id, option, recommended, votes) =>
    normalizeProposal(raw(id, describe(`Mix: ${option}`, { t: "poll", kind: "mix", poll: "mix-2026-W46", option, label: option, recommended, closes }), { votes }), KEEPER);
  let p = [poll(1, "balanced", true, { [KEEPER]: "Approve" }), poll(2, "staking", false, { "a.testnet": "Approve" }), poll(3, "reserve", false, {})];
  let t = tallyPoll(p, "mix-2026-W46");
  assert.equal(t.winner, "balanced");
  assert.equal(t.voters, 2);
  p[1] = poll(2, "staking", false, { "a.testnet": "Approve", "b.testnet": "Approve" });
  assert.equal(tallyPoll(p, "mix-2026-W46").winner, "staking");
  // A look-alike proposal from someone else is ignored.
  const fake = normalizeProposal(raw(9, describe("Mix: reserve", { t: "poll", kind: "mix", poll: "mix-2026-W46", option: "reserve" }), { proposer: "eve.testnet" }), KEEPER);
  assert.equal(fake.meta, null);
  assert.equal(parseMeta("no machine line"), null);
});

test("the adopted mix is the newest approved adopt proposal; today's run is found by date", () => {
  const adopt = (id, option, status) =>
    normalizeProposal(raw(id, describe(`Adopt ${option}`, { t: "adopt", kind: "mix", poll: "x", option, targets: mixPreset(option).targets }), { status }), KEEPER);
  const p = [adopt(1, "balanced", "Approved"), adopt(2, "staking", "Approved"), adopt(3, "reserve", "InProgress")];
  assert.equal(adoptedMix(p).option, "staking");
  const run = normalizeProposal(raw(4, describe("Run", { t: "daily", date: "2026-11-11", target: {}, action: "hold" }), { status: "Approved" }), KEEPER);
  assert.equal(dailyRun([...p, run], "2026-11-11").id, 4);
  assert.equal(dailyRun([...p, run], "2026-11-12"), null);
});

test("the council keys refuse a run that leaves the adopted mix or the move limit", () => {
  const settings = mixSettings({}, "testnet");
  const adopted = { targets: MIX_PRESETS[0].targets };
  const ok = { action: "rebalance", target: adopted.targets, maxMoveBps: settings.maxMoveBps, totalYocto: "1000", movedYocto: "250" };
  assert.deepEqual(checkDailyRun(ok, { adopted, settings }), []);
  assert.equal(checkDailyRun({ ...ok, target: MIX_PRESETS[1].targets }, { adopted, settings }).length, 1);
  assert.equal(checkDailyRun({ ...ok, movedYocto: "251" }, { adopted, settings }).length, 1);
  assert.equal(checkDailyRun({ ...ok, maxMoveBps: 9000 }, { adopted, settings }).length, 1);
  assert.equal(checkDailyRun(ok, { adopted: null, settings }).length, 1);
});

test("weeks are ISO weeks starting Monday 00:00 UTC", () => {
  const w = weekOf(Date.UTC(2026, 10, 11, 12));
  assert.equal(w.id, "2026-W46");
  assert.equal(new Date(w.start).toISOString(), "2026-11-09T00:00:00.000Z");
  assert.equal(weekOf(Date.UTC(2026, 0, 1)).id, "2026-W01");
  assert.equal(weekOf(Date.UTC(2027, 0, 3)).id, "2026-W53");
});

test("voters are ready explorer accounts at level 3+ who played this week, never demo bots", () => {
  const db = openDatabase(":memory:");
  initializeManagedAccounts(db);
  const now = Date.now();
  const add = (name, xp, played, id = null) => {
    const pid = id || createPlayer(db, name, now);
    if (id) db.prepare("INSERT INTO players(id,name,gold_u,created_at) VALUES (?,?,0,?)").run(id, name, now);
    db.prepare("UPDATE players SET xp=? WHERE id=?").run(xp, pid);
    db.prepare("INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,?,'ready',?,?)").run(`${name}.players.testnet`, pid, name, "players.testnet", "testnet", now, now);
    if (played) history(db, pid, "quest", "Played", 0, {});
  };
  add("ada", 400, true);
  add("bob", 399, true);
  add("cid", 900, false);
  add("bot", 900, true, "seed-bot-1");
  assert.deepEqual(eligibleExplorers(db, { network: "testnet", now }), ["ada.players.testnet"]);
  assert.deepEqual(eligibleExplorers(db, { network: "testnet", now: now + 8 * 86_400_000 }), []);
});

test("the view shows this week's vote, the explorer's own vote and the adopted mix", async () => {
  const week = weekOf(Date.now());
  const pollMeta = (option, recommended) => ({ t: "poll", kind: "mix", poll: `mix-${week.id}`, title: "Mix", option, label: option, recommended, closes: week.end });
  const proposals = [
    raw(0, describe("Adopt", { t: "adopt", kind: "mix", poll: "genesis", option: "balanced", targets: MIX_PRESETS[0].targets }), { status: "Approved" }),
    raw(1, describe("Balanced", pollMeta("balanced", true)), { votes: { [KEEPER]: "Approve" } }),
    raw(2, describe("Staking", pollMeta("staking", false)), { votes: { "ada.players.testnet": "Approve" } }),
  ];
  const policy = buildPolicy({ council: COUNCIL, keeper: KEEPER, explorers: ["ada.players.testnet"] });
  const provider = {
    async query({ method_name, args_base64 }) {
      const args = JSON.parse(Buffer.from(args_base64, "base64").toString());
      const out = method_name === "get_policy" ? policy : method_name === "get_last_proposal_id" ? proposals.length : proposals.slice(args.from_index, args.from_index + args.limit);
      return { result: [...Buffer.from(JSON.stringify(out))] };
    },
  };
  const view = createTreasuryDaoView({ provider, manifest: daoManifest({ network: "testnet", contractId: DAO }, "testnet") });
  const v = await view.read({ account: "ada.players.testnet" });
  assert.equal(v.exists, true);
  assert.equal(v.explorers, 1);
  assert.equal(v.me.member, true);
  assert.equal(v.weeklyMix.options.find((o) => o.option === "staking").mine, true);
  assert.equal(v.weeklyMix.options.find((o) => o.option === "balanced").mine, false);
  assert.equal(v.adopted.option, "balanced");
  assert.throws(() => daoManifest({ network: "testnet", contractId: "evil.testnet" }, "testnet"));
});

const device = KeyPair.fromRandom("ed25519"),
  signer = new KeyPairSigner(device);
const SENDER = "ada.players.questlayer.testnet";
async function delegate(receiverId, action) {
  const d = buildDelegateAction({ senderId: SENDER, receiverId, actions: [action], nonce: 101n, maxBlockHeight: 5100n, publicKey: await signer.getPublicKey() });
  const { signedDelegate } = await signer.signDelegateAction(d);
  return decodeSignedDelegate(Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64"));
}
const ctx = () => ({
  accountId: SENDER,
  keys: [device.getPublicKey().toString()],
  nonce: 100n,
  blockHeight: 5000,
  blockTtl: 120,
  maxGas: 300_000_000_000_000n,
  contracts: { collectibles: "nfts.testnet", treasuryDao: DAO },
});
const GAS = 50_000_000_000_000n;

test("the relayer sponsors an explorer's poll vote on the DAO and nothing else there", async () => {
  const ok = validateDelegate(await delegate(DAO, actions.functionCall("act_proposal", { id: 3, action: "VoteApprove", proposal: "Vote" }, GAS, 0n)), ctx());
  assert.equal(ok.receiverId, DAO);
  for (const [method, args, deposit] of [
    ["act_proposal", { id: 3, action: "VoteReject", proposal: "Vote" }, 0n],
    ["act_proposal", { id: 3, action: "VoteApprove", proposal: { Transfer: {} } }, 0n],
    ["act_proposal", { id: 3, action: "VoteApprove", proposal: "Vote" }, 1n],
    ["add_proposal", { proposal: { description: "x", kind: "Vote" } }, 0n],
  ])
    await assert.rejects(
      async () => validateDelegate(await delegate(DAO, actions.functionCall(method, args, GAS, deposit)), ctx()),
      (e) => e instanceof RelayPolicyError,
    );
  // Without the DAO in the allowlist it is just another unsponsored contract.
  await assert.rejects(
    async () => validateDelegate(await delegate(DAO, actions.functionCall("act_proposal", { id: 3, action: "VoteApprove", proposal: "Vote" }, GAS, 0n)), { ...ctx(), contracts: { collectibles: "nfts.testnet" } }),
    (e) => e instanceof RelayPolicyError && e.code === "RELAY_RECEIVER",
  );
});

test("the signing vault signs a poll vote without the approval window, anything else on the DAO keeps it", async () => {
  const config = { appOrigin: "https://app.example", vaultOrigin: "https://vault.example", network: "testnet", rpcUrl: "https://rpc.example", contracts: { treasuryDao: DAO } };
  const call = (methodName, args, deposit = "0") => ({ accountId: SENDER, receiverId: DAO, actions: [{ kind: "functionCall", methodName, args, gas: "50000000000000", deposit }] });
  assert.equal(await needsProtection(call("act_proposal", { id: 3, action: "VoteApprove", proposal: "Vote" }), config), false);
  assert.equal(await needsProtection(call("act_proposal", { id: 3, action: "VoteRemove", proposal: "Vote" }), config), true);
  assert.equal(await needsProtection(call("add_proposal", { proposal: {} }), config), true);
});

test("explorersRole rebuilds the role with the same never-finalizing vote policy", () => {
  assert.deepEqual(explorersRole(["b.testnet", "a.testnet", "a.testnet"]).kind.Group, ["a.testnet", "b.testnet"]);
});

test("voting power mixes days of play, XP, followers and quests others played, each capped, 100 at most", () => {
  // Level 3 (400 XP) after three days of play: 3 + 9.
  assert.deepEqual(powerFromCounts({ days: 3, xp: 400 }).parts, { days: 3, xp: 9, followers: 0, plays: 0 });
  assert.equal(powerFromCounts({ days: 3, xp: 400 }).power, 12);
  // Every part has its own cap, so no single habit dominates.
  const huge = powerFromCounts({ days: 999, xp: 10_000_000, followers: 999, plays: 999 });
  assert.deepEqual(huge.parts, { days: 30, xp: 30, followers: 20, plays: 20 });
  assert.equal(huge.power, VOTING_POWER.max);
  assert.equal(powerFromCounts({ followers: 4, plays: 5, days: 0, xp: 0 }).power, 3 + 8 + 5);
  assert.equal(powerFromCounts({}).power, 3, "level 1 alone");
  assert.equal(KEEPER_POWER, 10);
});

test("tallies add up voting power; without a power list every vote counts one", () => {
  const closes = Date.UTC(2026, 10, 16);
  const poll = (id, option, recommended, votes) =>
    normalizeProposal(raw(id, describe(`Mix: ${option}`, { t: "poll", kind: "mix", poll: "mix-2026-W47", option, label: option, recommended, closes }), { votes }), KEEPER);
  const p = [
    poll(1, "staking-first", true, { [KEEPER]: "Approve", "a.testnet": "Approve" }),
    poll(2, "more-stables", false, { "b.testnet": "Approve", "c.testnet": "Approve" }),
  ];
  // Head count: 2 : 2, the tie goes to the recommended option.
  assert.equal(tallyPoll(p, "mix-2026-W47").winner, "staking-first");
  // Weighted: keeper 10 + a 12 = 22 against b 40 + c 5 = 45.
  const t = tallyPoll(p, "mix-2026-W47", { power: { "a.testnet": 12, "b.testnet": 40, "c.testnet": 5 }, keeper: KEEPER });
  assert.equal(t.winner, "more-stables");
  assert.deepEqual(t.options.map((o) => [o.approvals, o.votes]), [[22, 2], [45, 2]]);
  assert.equal(t.voters, 4);
  // A voter missing from the list still counts one; a value above the cap is clipped.
  const u = tallyPoll(p, "mix-2026-W47", { power: { "b.testnet": 500 }, keeper: KEEPER });
  assert.deepEqual(u.options.map((o) => o.approvals), [KEEPER_POWER + 1, VOTING_POWER.max + 1]);
});

test("voting power reads real play from the database and ignores demo bots", () => {
  const db = openDatabase(":memory:");
  initializeManagedAccounts(db);
  const now = Date.UTC(2026, 10, 14, 12);
  const player = (name, xp, id = null) => {
    const pid = id || createPlayer(db, name, now);
    if (id) db.prepare("INSERT INTO players(id,name,gold_u,created_at) VALUES (?,?,0,?)").run(id, name, now);
    db.prepare("UPDATE players SET xp=? WHERE id=?").run(xp, pid);
    db.prepare("INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,?,'ready',?,?)").run(`${name}.players.testnet`, pid, name.replace(/[^a-z]/g, ""), "players.testnet", "testnet", now, now);
    return pid;
  };
  const ada = player("ada", 900); // level 4
  const fan = player("fan", 150);
  const newbie = player("new", 50);
  const bot = player("bot", 900, "seed-bot-1");
  // XP on three different days, one of them twice, one outside the 30-day window.
  const event = (at, meta) => db.prepare("INSERT INTO history(id,player_id,kind,title,gold_u,meta,created_at) VALUES(?,?,?,?,0,?,?)").run(`h${at}${meta}`, ada, "monster", "Won", meta, at);
  for (const at of [now, now - 2 * DAY, now - 2 * DAY + 60_000, now - 5 * DAY, now - 40 * DAY]) event(at, JSON.stringify({ xp: 10 }));
  event(now - 9 * DAY, "{}"); // no XP: not a day of play
  db.exec(`CREATE TABLE IF NOT EXISTS creator_follows(follower TEXT NOT NULL, creator TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(follower,creator))`);
  for (const f of [fan, newbie, bot]) db.prepare("INSERT INTO creator_follows VALUES(?,?,?)").run(f, ada, now);
  db.exec(`CREATE TABLE IF NOT EXISTS creator_quests(id TEXT PRIMARY KEY, author TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS creator_participations(quest_id TEXT NOT NULL, participant TEXT NOT NULL, started_at INTEGER NOT NULL, PRIMARY KEY(quest_id,participant))`);
  db.prepare("INSERT INTO creator_quests VALUES('q1',?)").run(ada);
  for (const [who, at] of [[fan, now], [newbie, now - DAY], [bot, now], [ada, now], [fan + "-old", now - 40 * DAY]])
    db.prepare("INSERT INTO creator_participations VALUES('q1',?,?)").run(who, at);
  const powers = votingPowers(db, { network: "testnet", now });
  assert.deepEqual(powers["ada.players.testnet"].counts, { days: 3, xp: 900, followers: 1, plays: 2 });
  assert.equal(powers["ada.players.testnet"].power, 3 + 12 + 2 + 2);
  assert.equal(powers["bot.players.testnet"], undefined, "demo bots have no voting power");
  assert.deepEqual(Object.keys(votingPowers(db, { network: "testnet", now, accounts: ["fan.players.testnet"] })), ["fan.players.testnet"]);
});

test("the view weighs the tally and shows the explorer's own voting power", async () => {
  const week = weekOf(Date.now());
  const pollMeta = (option, recommended) => ({ t: "poll", kind: "mix", poll: `mix-${week.id}`, title: "Mix", option, label: option, recommended, closes: week.end });
  const proposals = [
    raw(0, describe("Staking first", pollMeta("staking-first", true)), { votes: { [KEEPER]: "Approve" } }),
    raw(1, describe("More stables", pollMeta("more-stables", false)), { votes: { "ada.players.testnet": "Approve" } }),
  ];
  const policy = buildPolicy({ council: COUNCIL, keeper: KEEPER, explorers: ["ada.players.testnet"] });
  const provider = {
    async query({ method_name, args_base64 }) {
      const args = JSON.parse(Buffer.from(args_base64, "base64").toString());
      const out = method_name === "get_policy" ? policy : method_name === "get_last_proposal_id" ? proposals.length : proposals.slice(args.from_index, args.from_index + args.limit);
      return { result: [...Buffer.from(JSON.stringify(out))] };
    },
  };
  const ada = powerFromCounts({ days: 6, xp: 900, followers: 1, plays: 0 });
  const view = createTreasuryDaoView({ provider, manifest: daoManifest({ network: "testnet", contractId: DAO }, "testnet"), powers: () => ({ "ada.players.testnet": ada }) });
  const v = await view.read({ account: "ada.players.testnet" });
  assert.equal(v.me.power.power, 6 + 12 + 2);
  assert.deepEqual(v.weeklyMix.options.map((o) => o.approvals), [KEEPER_POWER, 20]);
  assert.equal(v.weeklyMix.winner, "more-stables");
  assert.equal(v.votingPower.max, 100);
});

// Treasury DAO (docs/TREASURY-DAO.md): the QuestLayer treasury decides on a
// Sputnik DAO v2 (`questlayer-treasury.sputnik-v2.testnet`, the factory Trezu
// uses), not on one key.
//
// Roles (Trezu names, so the DAO opens in Trezu as a normal treasury):
//   Requestor  the keeper bot: files proposals only, never votes
//   Admin      the council: members, roles and settings (2 of 3)
//   Approver   the council: approves money moves and decisions (2 of 3)
//   Explorers  players at level 3+ who played in the last 7 days, plus the
//              keeper (it casts the visible automatic vote for the
//              recommended option). They vote on polls only.
//
// Polls are Sputnik `Vote` proposals, one per option. The Explorers role has a
// quorum no poll can reach, so a poll never finalizes: votes stay open for the
// week and the winner is the option with the most approvals at the tally.
// The keeper then files an "adopt" proposal with the tally and the council
// approves it. The daily treasury run is filed the same way ("daily") and the
// mix script runs only when today's run was approved in the DAO.
//
// Every proposal the game acts on carries a machine line in its description:
//   <title for people>\n\nquestlayer:{json}
// and counts only when the keeper filed it. Pure helpers plus read-only views.
import { assert, dayKey, levelFor } from "../domain.mjs";

export const DAO_FACTORY = { testnet: "sputnik-v2.testnet" };
export const DAO_NAME = "questlayer-treasury";
export const META_PREFIX = "questlayer:";
export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
/** Polls stay open a little past the week so the Monday tally still sees them. */
export const PROPOSAL_PERIOD_MS = 8 * DAY_MS;
/** Explorer votes never finalize a proposal: tallies are counted, not executed. */
export const NEVER = "1000000000000";
export const EXPLORER_RULE = Object.freeze({ minLevel: 3, minXp: 400, activeDays: 7 });

/**
 * Voting power (Lubos 14 Nov 2026): not one explorer one vote. Every vote an
 * explorer casts on chain counts with their voting power at the tally, earned
 * by play and never for sale. Four parts, each capped, 100 at most:
 *   days      days in the last 30 on which the explorer earned XP, 1 each, up to 30
 *   xp        3 per level (level from XP), up to 30 at level 10
 *   followers 2 per follower who is a real explorer (level 2+), up to 20
 *   plays     1 per time another explorer took on one of their quests, last 30 days, up to 20
 * The keeper's automatic vote for the recommended option counts KEEPER_POWER.
 */
export const VOTING_POWER = Object.freeze({
  windowDays: 30,
  days: { per: 1, cap: 30 },
  xp: { perLevel: 3, cap: 30 },
  followers: { per: 2, cap: 20, minXp: 100 },
  plays: { per: 1, cap: 20 },
  max: 100,
  keeper: 10,
});
export const KEEPER_POWER = VOTING_POWER.keeper;

/** The capped parts and their sum, from raw counts. Pure. */
export function powerFromCounts({ days = 0, xp = 0, followers = 0, plays = 0 }, rule = VOTING_POWER) {
  const cap = (n, per, max) => Math.min(max, Math.max(0, Math.floor(n)) * per);
  const parts = {
    days: cap(days, rule.days.per, rule.days.cap),
    xp: Math.min(rule.xp.cap, levelFor(Math.max(0, xp)) * rule.xp.perLevel),
    followers: cap(followers, rule.followers.per, rule.followers.cap),
    plays: cap(plays, rule.plays.per, rule.plays.cap),
  };
  const power = Math.max(1, Math.min(rule.max, parts.days + parts.xp + parts.followers + parts.plays));
  return { power, parts, counts: { days, xp, followers, plays } };
}

/**
 * Weekly treasury mix options (staked NEAR / stablecoins / NEAR reserve).
 * Since 11 Nov 2026 (Lubos): on testnet only validator staking earns, so the
 * recommended mix is 90 % staked, 5 % USDC and 5 % USDT on Rhea Lend. All of
 * them stay inside the hard limits of server/native/treasury-mix.mjs: at most
 * 40 % per protocol, where every validator pool is its own protocol and the
 * stables (all Rhea Lend) stay at or under 40 % together.
 */
export const MIX_PRESETS = Object.freeze([
  { id: "staking-first", label: "Staking first 90 / 10 / 0", targets: { staked: 9000, lst: 0, stable: 1000, near: 0 } },
  { id: "more-stables", label: "More stables 70 / 20 / 10", targets: { staked: 7000, lst: 0, stable: 2000, near: 1000 } },
  { id: "bigger-reserve", label: "Bigger reserve 60 / 20 / 20", targets: { staked: 6000, lst: 0, stable: 2000, near: 2000 } },
]);
export const RECOMMENDED_MIX = "staking-first";
/** Earlier presets, so a poll filed before the change still tallies to its targets. */
export const LEGACY_MIX_PRESETS = Object.freeze([
  { id: "balanced", label: "Balanced 50 / 40 / 10", targets: { staked: 0, lst: 5000, stable: 4000, near: 1000 } },
  { id: "staking", label: "More staking 70 / 20 / 10", targets: { staked: 0, lst: 7000, stable: 2000, near: 1000 } },
  { id: "reserve", label: "Bigger reserve 40 / 30 / 30", targets: { staked: 0, lst: 4000, stable: 3000, near: 3000 } },
]);
export const mixPreset = (id) => MIX_PRESETS.find((p) => p.id === id) || LEGACY_MIX_PRESETS.find((p) => p.id === id) || null;

const NS = 1_000_000n;
export const nsToMs = (ns) => Number(BigInt(ns || 0) / NS);
export const msToNs = (ms) => (BigInt(Math.floor(ms)) * NS).toString();

/** ISO week of a UTC time: { id: "2026-W46", start, end } (Monday 00:00 UTC). */
export function weekOf(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY_MS;
  const thursday = new Date(start + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / WEEK_MS) + 1;
  return { id: `${year}-W${String(week).padStart(2, "0")}`, start, end: start + WEEK_MS };
}
export const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

export function describe(title, meta) {
  assert(typeof title === "string" && title && !title.includes(META_PREFIX), "Invalid proposal title.");
  return `${title}\n\n${META_PREFIX}${JSON.stringify(meta)}`;
}
export function parseMeta(description) {
  if (typeof description !== "string") return null;
  const at = description.lastIndexOf("\n" + META_PREFIX);
  if (at < 0) return null;
  try {
    const meta = JSON.parse(description.slice(at + 1 + META_PREFIX.length));
    return meta && typeof meta === "object" && typeof meta.t === "string" ? meta : null;
  } catch {
    return null;
  }
}
export const titleOf = (description) => String(description || "").split("\n")[0].slice(0, 200);

const MIX_KEYS = ["staked", "lst", "stable", "near"];
/** A mix target; "staked" may be missing on mixes adopted before 11 Nov 2026 (= 0). */
const validTargets = (t) =>
  !!t &&
  MIX_KEYS.every((k) => (k === "staked" && t[k] === undefined) || (Number.isInteger(t[k]) && t[k] >= 0 && t[k] <= 10_000)) &&
  MIX_KEYS.reduce((a, k) => a + (t[k] ?? 0), 0) === 10_000;
export const sameTargets = (a, b) => validTargets(a) && validTargets(b) && MIX_KEYS.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
/** "90/10/0" style label: staked + liquid staking / stablecoins / NEAR reserve. */
export const mixShort = (t) => `${((t.staked ?? 0) + (t.lst ?? 0)) / 100}/${(t.stable ?? 0) / 100}/${(t.near ?? 0) / 100}`;

const group = (members) => ({ Group: [...new Set(members)].sort() });
const weight = (n) => ({ weight_kind: "RoleWeight", quorum: "0", threshold: String(n) });

/** Sputnik v2 policy for the treasury DAO. */
export function buildPolicy({ council, keeper, explorers = [], approvals = 2, proposalPeriodMs = PROPOSAL_PERIOD_MS }) {
  assert(Array.isArray(council) && council.length >= approvals && approvals >= 1, "The council needs at least as many members as approvals.");
  assert(typeof keeper === "string" && !council.includes(keeper), "The keeper is not a council member.");
  return {
    roles: [
      {
        name: "Requestor",
        kind: group([keeper]),
        permissions: ["vote:AddProposal", "call:AddProposal", "transfer:AddProposal", "policy_add_or_update_role:AddProposal"],
        vote_policy: {},
      },
      {
        name: "Admin",
        kind: group(council),
        permissions: [
          "config:*",
          "policy:*",
          "add_member_to_role:*",
          "remove_member_from_role:*",
          "policy_add_or_update_role:*",
          "policy_remove_role:*",
          "policy_update_default_vote_policy:*",
          "policy_update_parameters:*",
          "upgrade_self:*",
          "upgrade_remote:*",
        ],
        vote_policy: {},
      },
      {
        name: "Approver",
        kind: group(council),
        permissions: [
          "vote:AddProposal",
          "call:AddProposal",
          "transfer:AddProposal",
          "vote:VoteApprove",
          "vote:VoteReject",
          "call:VoteApprove",
          "call:VoteReject",
          "call:VoteRemove",
          "transfer:VoteApprove",
          "transfer:VoteReject",
          "transfer:VoteRemove",
        ],
        vote_policy: {},
      },
      explorersRole([keeper, ...explorers]),
    ],
    default_vote_policy: weight(approvals),
    proposal_bond: "0",
    proposal_period: msToNs(proposalPeriodMs),
    bounty_bond: "100000000000000000000000",
    bounty_forgiveness_period: msToNs(DAY_MS),
  };
}
export function explorersRole(members) {
  return {
    name: "Explorers",
    kind: group(members),
    permissions: ["vote:VoteApprove"],
    vote_policy: { vote: { weight_kind: "RoleWeight", quorum: NEVER, threshold: NEVER } },
  };
}

export const roleMembers = (policy, name) => policy?.roles?.find((r) => r.name === name)?.kind?.Group || [];

/** The DAO's own proposals, normalized; `meta` only when the keeper filed it. */
export function normalizeProposal(p, keeper) {
  const meta = p.proposer === keeper ? parseMeta(p.description) : null;
  const kind = typeof p.kind === "string" ? p.kind : Object.keys(p.kind || {})[0] || "unknown";
  const votes = p.votes || {};
  return {
    id: p.id,
    proposer: p.proposer,
    title: titleOf(p.description),
    kind,
    status: p.status,
    submittedAt: nsToMs(p.submission_time),
    approvals: Object.values(votes).filter((v) => v === "Approve").length,
    voters: Object.keys(votes),
    votes,
    meta,
  };
}

/**
 * One poll's options with their weighted approvals, and the winner (ties:
 * recommended, then order). `power` maps account -> voting power; without it
 * every vote counts 1. A voter missing from the map counts 1 (the keeper
 * counts KEEPER_POWER), so a vote is never lost.
 */
export function tallyPoll(proposals, pollId, { power = null, keeper = null } = {}) {
  const weightOf = (a) => (!power ? 1 : a === keeper ? KEEPER_POWER : Number.isInteger(power[a]) && power[a] > 0 ? Math.min(VOTING_POWER.max, power[a]) : 1);
  const options = proposals
    .filter((p) => p.meta?.t === "poll" && p.meta.poll === pollId)
    .sort((a, b) => a.id - b.id)
    .map((p) => ({
      proposalId: p.id,
      option: p.meta.option,
      label: p.meta.label || p.title,
      targets: p.meta.targets || null,
      recommended: !!p.meta.recommended,
      votes: p.voters.filter((v) => p.votes[v] === "Approve").length,
      approvals: p.voters.filter((v) => p.votes[v] === "Approve").reduce((a, v) => a + weightOf(v), 0),
      voters: p.voters.filter((v) => p.votes[v] === "Approve"),
    }));
  if (!options.length) return null;
  const first = proposals.find((p) => p.meta?.t === "poll" && p.meta.poll === pollId);
  const ranked = [...options].sort((a, b) => b.approvals - a.approvals || (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0) || a.proposalId - b.proposalId);
  const voters = new Set(options.flatMap((o) => o.voters));
  return {
    poll: pollId,
    kind: first.meta.kind || "extra",
    title: first.meta.title || first.title,
    closesAt: first.meta.closes || null,
    options,
    winner: ranked[0].option,
    voters: voters.size,
    weighted: !!power,
  };
}
export const pollIds = (proposals, kind) =>
  [...new Set(proposals.filter((p) => p.meta?.t === "poll" && (!kind || p.meta.kind === kind)).map((p) => p.meta.poll))];

/** The mix the DAO adopted last (an approved "adopt" proposal), or null. */
export function adoptedMix(proposals) {
  const p = proposals
    .filter((x) => x.meta?.t === "adopt" && x.meta.kind === "mix" && x.status === "Approved" && validTargets(x.meta.targets))
    .sort((a, b) => b.id - a.id)[0];
  return p ? { proposalId: p.id, poll: p.meta.poll, option: p.meta.option, targets: p.meta.targets, tally: p.meta.tally || null } : null;
}
/** Today's daily run proposal (approved or not). */
export const dailyRun = (proposals, date) =>
  proposals.filter((p) => p.meta?.t === "daily" && p.meta.date === date).sort((a, b) => b.id - a.id)[0] || null;

/**
 * Checks the keeper's daily run before the council keys approve it: the
 * target is the adopted mix and the plan stays inside the treasury-mix limits.
 */
export function checkDailyRun(meta, { adopted, settings }) {
  const problems = [];
  if (!adopted) problems.push("The DAO has not adopted a mix yet.");
  else if (!sameTargets(meta.target, adopted.targets)) problems.push("The run's target is not the adopted mix.");
  if (!Number.isInteger(meta.maxMoveBps) || meta.maxMoveBps > settings.maxMoveBps) problems.push("The run may move more than the move limit.");
  const total = BigInt(meta.totalYocto || "0"),
    moved = BigInt(meta.movedYocto || "0");
  if (total > 0n && moved * 10_000n > total * BigInt(settings.maxMoveBps)) problems.push("The plan moves more than the move limit.");
  if (!["rebalance", "hold"].includes(meta.action)) problems.push("Unknown run action.");
  return problems;
}

async function view(provider, accountId, method, args = {}) {
  const r = await provider.query({
    request_type: "call_function",
    account_id: accountId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

/** Policy and the last `limit` proposals of the DAO, or { exists: false }. */
export async function readDao(provider, daoId, { limit = 150 } = {}) {
  let policy;
  try {
    policy = await view(provider, daoId, "get_policy");
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCOUNT|CodeDoesNotExist|doesn't exist/i.test(String(e?.message || e))) return { exists: false, daoId };
    throw e;
  }
  const last = await view(provider, daoId, "get_last_proposal_id");
  const from = Math.max(0, last - limit);
  const raw = [];
  for (let i = from; i < last; i += 50) raw.push(...(await view(provider, daoId, "get_proposals", { from_index: i, limit: Math.min(50, last - i) })));
  const keeper = roleMembers(policy, "Requestor")[0] || null;
  return { exists: true, daoId, policy, keeper, proposals: raw.map((p) => normalizeProposal(p, keeper)) };
}

/** The DAO manifest (public/native-treasury-dao-<network>.json), checked. */
export function daoManifest(raw, network) {
  if (!raw) return null;
  assert(raw.network === network && typeof raw.contractId === "string" && raw.contractId.endsWith(`.${DAO_FACTORY[network]}`), "The treasury DAO manifest is for another network.", 503);
  return raw;
}

/** Public view for GET /api/treasury/dao; `account` adds that explorer's votes. */
/**
 * `powers()` returns votingPowers() for the host's explorers (account -> { power,
 * parts, counts }); with it every tally is weighted and `me` carries the
 * explorer's own voting power.
 */
export function createTreasuryDaoView({ provider, manifest, clock = Date.now, cacheMs = 30_000, powers = null }) {
  let hit = null;
  async function load() {
    if (hit && clock() - hit.at < cacheMs) return hit.dao;
    const dao = await readDao(provider, manifest.contractId);
    hit = { at: clock(), dao };
    return dao;
  }
  return {
    contractId: manifest.contractId,
    forget: () => (hit = null),
    async read({ account = null } = {}) {
      const dao = await load();
      const now = clock();
      const base = { dao: manifest.contractId, network: manifest.network, factory: DAO_FACTORY[manifest.network], trezu: manifest.trezuUrl || null, exists: dao.exists };
      if (!dao.exists) return { ...base, rule: EXPLORER_RULE, observedAt: now };
      const p = dao.proposals;
      const week = weekOf(now);
      const pw = powers ? powers() : null;
      const weights = pw && Object.fromEntries(Object.entries(pw).map(([a, v]) => [a, v.power]));
      const tally = (id) => tallyPoll(p, id, { power: weights, keeper: dao.keeper });
      const shape = (t) =>
        t && {
          ...t,
          open: !!t.closesAt && t.closesAt > now,
          options: t.options.map(({ voters, ...o }) => ({ ...o, mine: !!account && voters.includes(account) })),
        };
      const current = shape(tally(`mix-${week.id}`));
      const extras = pollIds(p, "extra")
        .map((id) => tally(id))
        .filter((t) => t && t.closesAt && t.closesAt > week.start)
        .map(shape);
      const decisions = p
        .filter((x) => x.meta && ["adopt", "daily", "members"].includes(x.meta.t))
        .sort((a, b) => b.id - a.id)
        .slice(0, 12)
        .map((x) => ({ id: x.id, type: x.meta.t, title: x.title, status: x.status, approvals: x.approvals, submittedAt: x.submittedAt, date: x.meta.date || null }));
      const explorers = roleMembers(dao.policy, "Explorers").filter((a) => a !== dao.keeper);
      return {
        ...base,
        council: roleMembers(dao.policy, "Approver"),
        approvals: Number(dao.policy.default_vote_policy?.threshold) || null,
        keeper: dao.keeper,
        explorers: explorers.length,
        rule: EXPLORER_RULE,
        votingPower: VOTING_POWER,
        week: week.id,
        weeklyMix: current,
        extras,
        adopted: adoptedMix(p),
        today: (() => {
          const d = dailyRun(p, utcDate(now));
          return d ? { id: d.id, status: d.status, approvals: d.approvals, action: d.meta.action } : null;
        })(),
        decisions,
        me: account ? { account, member: explorers.includes(account), power: pw?.[account] || null } : null,
        observedAt: now,
      };
    },
  };
}

/**
 * Accounts that may vote: a ready explorer (managed) account, level 3+
 * (QXP >= 400) and real play in the last `activeDays`. Demo bots never vote.
 */
export function eligibleExplorers(db, { network, now = Date.now(), rule = EXPLORER_RULE } = {}) {
  const has = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!has("managed_accounts")) return [];
  const since = now - rule.activeDays * DAY_MS;
  const played = [
    "EXISTS(SELECT 1 FROM history h WHERE h.player_id=p.id AND h.kind!='welcome' AND h.created_at>=@since)",
    has("coins") && "EXISTS(SELECT 1 FROM coins c WHERE c.claimant=p.id AND c.claimed_at>=@since)",
  ].filter(Boolean);
  return db
    .prepare(
      `SELECT m.account_id AS account FROM managed_accounts m JOIN players p ON p.id=m.player_id
       WHERE m.state='ready' AND m.network=@network AND p.xp>=@minXp AND p.id NOT LIKE 'seed-%'
       AND (${played.join(" OR ")}) ORDER BY m.account_id`,
    )
    .all({ network, since, minXp: rule.minXp })
    .map((r) => r.account);
}

/**
 * Voting power of explorer accounts (VOTING_POWER), keyed by account. Without
 * `accounts` it covers every ready explorer account on `network`. Demo bots
 * (seed-*) never count: not as voters, followers or players of a quest.
 */
export function votingPowers(db, { network, now = Date.now(), accounts = null, rule = VOTING_POWER } = {}) {
  const has = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const out = {};
  if (!has("managed_accounts")) return out;
  const since = now - rule.windowDays * DAY_MS;
  const sinceDay = dayKey(since);
  const rows = db
    .prepare(
      `SELECT m.account_id AS account, p.id AS player, p.xp FROM managed_accounts m JOIN players p ON p.id=m.player_id
       WHERE m.state='ready' AND m.network=? AND p.id NOT LIKE 'seed-%' ORDER BY m.account_id`,
    )
    .all(network)
    .filter((r) => !accounts || accounts.includes(r.account));
  const q = (sql) => db.prepare(sql);
  const xpDays = has("fair_play_xp") && q("SELECT DISTINCT day FROM fair_play_xp WHERE player_id=? AND xp>0 AND day>=?");
  const xpHistory = q("SELECT created_at FROM history WHERE player_id=? AND created_at>=? AND COALESCE(json_extract(meta,'$.xp'),0)>0");
  const followers =
    has("creator_follows") &&
    q(`SELECT COUNT(*) AS n FROM creator_follows f JOIN players p ON p.id=f.follower
       WHERE f.creator=? AND f.follower!=f.creator AND p.id NOT LIKE 'seed-%' AND p.xp>=?`);
  const questPlays =
    has("creator_participations") &&
    has("creator_quests") &&
    q(`SELECT COUNT(*) AS n FROM creator_participations c JOIN creator_quests k ON k.id=c.quest_id
       WHERE k.author=? AND c.participant!=k.author AND c.participant NOT LIKE 'seed-%' AND c.started_at>=?`);
  const taskPlays =
    has("mk_claims") &&
    has("mk_tasks") &&
    q(`SELECT COUNT(*) AS n FROM mk_claims c JOIN mk_tasks t ON t.id=c.task_id
       WHERE t.poster=? AND c.worker!=t.poster AND c.worker NOT LIKE 'seed-%' AND c.created_at>=?`);
  for (const r of rows) {
    const days = new Set(xpDays ? xpDays.all(r.player, sinceDay).map((d) => d.day) : []);
    for (const h of xpHistory.all(r.player, since)) days.add(dayKey(h.created_at));
    const counts = {
      days: [...days].filter((d) => d >= sinceDay).length,
      xp: r.xp,
      followers: followers ? followers.get(r.player, rule.followers.minXp).n : 0,
      plays: (questPlays ? questPlays.get(r.player, since).n : 0) + (taskPlays ? taskPlays.get(r.player, since).n : 0),
    };
    out[r.account] = powerFromCounts(counts, rule);
  }
  return out;
}

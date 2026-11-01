// Community vote on the daily creator bonus (W08 governance, testnet only).
//
// Active explorers vote during UTC day D-1 for the community quests whose
// support should count toward day D's creator round. When D starts the ballot
// closes and is tallied once; the top quests become D's bonus quests. The
// creator-money publisher then records likes and completions on chain only for
// those quests while D's round is open. Support for other quests is kept and
// waits for a day its quest wins (or a day without a vote, which gates
// nothing), because the contract counts each player's support once.
//
// It is server-side policy, not an on-chain vote: a tally is an operator
// decision the creators contract cannot verify. Mainnet hosts refuse it.
import { assert } from "../domain.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import { moderationSuppression } from "../moderation.mjs";
import { NETWORK } from "../native/network.mjs";

export const CREATOR_BONUS_VOTE_SCHEMA = registerModuleSchema({
  name: "creator-bonus-vote",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS creator_bonus_votes(
 day TEXT NOT NULL CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 voter TEXT NOT NULL,
 quest_id TEXT NOT NULL,
 cast_at INTEGER NOT NULL,
 PRIMARY KEY(day,voter,quest_id)
);
CREATE TABLE IF NOT EXISTS creator_bonus_results(
 day TEXT PRIMARY KEY CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 winners TEXT NOT NULL CHECK(json_valid(winners)),
 tally TEXT NOT NULL CHECK(json_valid(tally)),
 voters INTEGER NOT NULL CHECK(voters>=0),
 policy TEXT NOT NULL CHECK(json_valid(policy)),
 tallied_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS creator_bonus_votes_quest ON creator_bonus_votes(day,quest_id)`,
});

const DAY = 86400000;
const QUEST_ID = /^[a-z0-9:_-]{1,64}$/i;
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (day) => Date.parse(`${day}T00:00:00Z`);
const has = (db, table) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
const int = (value, fallback, min, max) => {
  const n = Number(value ?? fallback);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
};

export function bonusVoteSettings(env = process.env) {
  return {
    votesPerExplorer: int(env.CREATOR_BONUS_VOTES_PER_EXPLORER, 3, 1, 10),
    winners: int(env.CREATOR_BONUS_WINNERS, 3, 1, 20),
    activeDays: int(env.CREATOR_BONUS_ACTIVE_DAYS, 7, 1, 60),
    minVoters: int(env.CREATOR_BONUS_MIN_VOTERS, 1, 1, 1000),
  };
}

export class CreatorBonusVote {
  constructor(
    db,
    {
      clock = Date.now,
      network = NETWORK,
      votesPerExplorer = 3,
      winners = 3,
      activeDays = 7,
      minVoters = 1,
    } = {},
  ) {
    assert(
      network !== "mainnet",
      "The creator bonus vote is a testnet pilot.",
      503,
      "BONUS_VOTE_TESTNET_ONLY",
    );
    this.db = db;
    this.network = network;
    this.clock = clock;
    this.policy = { votesPerExplorer, winners, activeDays, minVoters };
    this.ready = false;
  }
  // Lazy: a host that mounts the vote but never uses it gains no tables.
  schema() {
    if (!this.ready) {
      ensureModuleVersion(this.db, CREATOR_BONUS_VOTE_SCHEMA);
      this.ready = true;
    }
  }
  available() {
    return has(this.db, "creator_quests") && has(this.db, "creator_revisions");
  }
  requireCommunity() {
    assert(
      this.available(),
      "Creator quests are not enabled on this host.",
      503,
      "CREATORS_DISABLED",
    );
    this.schema();
  }
  /// The day whose round today's ballot decides.
  ballotDay(now = this.clock()) {
    return utcDay(now + DAY);
  }
  /// An active explorer has a verified NEAR account and real play (not just
  /// the welcome grant) within the activity window.
  eligibility(playerId, now = this.clock()) {
    const linked = this.db
      .prepare("SELECT 1 FROM wallet_links WHERE player_id=? LIMIT 1")
      .get(playerId);
    if (!linked) return { eligible: false, reason: "ACCOUNT_NOT_READY" };
    const since = now - this.policy.activeDays * DAY;
    const played =
      this.db
        .prepare(
          "SELECT 1 FROM history WHERE player_id=? AND kind!='welcome' AND created_at>=? LIMIT 1",
        )
        .get(playerId, since) ||
      this.db
        .prepare(
          "SELECT 1 FROM coins WHERE claimant=? AND claimed_at>=? LIMIT 1",
        )
        .get(playerId, since) ||
      this.db
        .prepare(
          "SELECT 1 FROM creator_participations WHERE participant=? AND started_at>=? LIMIT 1",
        )
        .get(playerId, since);
    return played
      ? { eligible: true, reason: null }
      : { eligible: false, reason: "NOT_ACTIVE" };
  }
  /// Published community quests that moderation has not hidden.
  candidates() {
    return this.db
      .prepare(
        `SELECT q.id, q.author, json_extract(r.content,'$.title') AS title
        FROM creator_quests q
        LEFT JOIN creator_revisions r ON r.quest_id=q.id AND r.revision=q.published_revision
        WHERE q.state='published' ORDER BY q.created_at, q.id`,
      )
      .all()
      .filter((q) => !moderationSuppression(this.db, "quest", q.id));
  }
  ballot(playerId, now = this.clock()) {
    this.requireCommunity();
    const day = this.ballotDay(now);
    const counts = new Map(
      this.db
        .prepare(
          "SELECT quest_id, COUNT(*) AS n FROM creator_bonus_votes WHERE day=? GROUP BY quest_id",
        )
        .all(day)
        .map((r) => [r.quest_id, r.n]),
    );
    const mine = new Set(
      this.db
        .prepare(
          "SELECT quest_id FROM creator_bonus_votes WHERE day=? AND voter=?",
        )
        .all(day, playerId)
        .map((r) => r.quest_id),
    );
    const { eligible, reason } = this.eligibility(playerId, now);
    const today = this.results(utcDay(now), now);
    return {
      network: this.network,
      day,
      closesAt: dayStart(day),
      eligible,
      reason,
      policy: this.policy,
      votesLeft: eligible
        ? Math.max(0, this.policy.votesPerExplorer - mine.size)
        : 0,
      candidates: this.candidates().map((q) => ({
        questId: q.id,
        title: typeof q.title === "string" ? q.title : null,
        votes: counts.get(q.id) ?? 0,
        mine: mine.has(q.id),
        own: q.author === playerId,
      })),
      today,
    };
  }
  vote(playerId, questId, now = this.clock()) {
    this.requireCommunity();
    assert(QUEST_ID.test(questId || ""), "Invalid quest id.", 400);
    const { eligible, reason } = this.eligibility(playerId, now);
    assert(
      eligible,
      reason === "ACCOUNT_NOT_READY"
        ? "Your explorer account is still being prepared."
        : "Only explorers who played this week can vote.",
      403,
      reason,
    );
    const quest = this.candidates().find((q) => q.id === questId);
    assert(quest, "This quest is not on the ballot.", 404);
    assert(
      quest.author !== playerId,
      "You cannot vote for your own quest.",
      409,
    );
    const day = this.ballotDay(now);
    const exists = this.db
      .prepare(
        "SELECT 1 FROM creator_bonus_votes WHERE day=? AND voter=? AND quest_id=?",
      )
      .get(day, playerId, questId);
    if (!exists) {
      const used = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM creator_bonus_votes WHERE day=? AND voter=?",
        )
        .get(day, playerId).n;
      assert(
        used < this.policy.votesPerExplorer,
        `You have used all ${this.policy.votesPerExplorer} votes for this round.`,
        409,
        "NO_VOTES_LEFT",
      );
      this.db
        .prepare(
          "INSERT INTO creator_bonus_votes(day,voter,quest_id,cast_at) VALUES(?,?,?,?)",
        )
        .run(day, playerId, questId, now);
    }
    return this.ballot(playerId, now);
  }
  unvote(playerId, questId, now = this.clock()) {
    this.requireCommunity();
    assert(QUEST_ID.test(questId || ""), "Invalid quest id.", 400);
    this.db
      .prepare(
        "DELETE FROM creator_bonus_votes WHERE day=? AND voter=? AND quest_id=?",
      )
      .run(this.ballotDay(now), playerId, questId);
    return this.ballot(playerId, now);
  }
  /// Tallies a closed ballot once. Quests unpublished or hidden since the vote
  /// drop out; ties go to the quest that reached its count first.
  tally(day, now = this.clock()) {
    this.schema();
    if (now < dayStart(day)) return null;
    const stored = this.db
      .prepare("SELECT * FROM creator_bonus_results WHERE day=?")
      .get(day);
    if (stored) return stored;
    const live = new Set(this.candidates().map((q) => q.id));
    const rows = this.db
      .prepare(
        "SELECT quest_id, COUNT(*) AS n, MAX(cast_at) AS last FROM creator_bonus_votes WHERE day=? GROUP BY quest_id",
      )
      .all(day)
      .filter((r) => live.has(r.quest_id))
      .sort(
        (a, b) =>
          b.n - a.n || a.last - b.last || (a.quest_id < b.quest_id ? -1 : 1),
      );
    const voters = this.db
      .prepare(
        "SELECT COUNT(DISTINCT voter) AS n FROM creator_bonus_votes WHERE day=?",
      )
      .get(day).n;
    const winners =
      voters >= this.policy.minVoters
        ? rows.slice(0, this.policy.winners).map((r) => r.quest_id)
        : [];
    this.db
      .prepare(
        "INSERT OR IGNORE INTO creator_bonus_results(day,winners,tally,voters,policy,tallied_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        day,
        JSON.stringify(winners),
        JSON.stringify(rows.map((r) => [r.quest_id, r.n])),
        voters,
        JSON.stringify(this.policy),
        now,
      );
    return this.db
      .prepare("SELECT * FROM creator_bonus_results WHERE day=?")
      .get(day);
  }
  results(day, now = this.clock()) {
    if (!this.available()) return null;
    const row = this.tally(day, now);
    if (!row) return null;
    return {
      day: row.day,
      winners: JSON.parse(row.winners),
      tally: JSON.parse(row.tally).map(([questId, votes]) => ({
        questId,
        votes,
      })),
      voters: row.voters,
      gated: JSON.parse(row.winners).length > 0,
      talliedAt: row.tallied_at,
    };
  }
  /// Whether support for a quest counts toward the round of a UTC day (the
  /// round open on chain, which can lag the clock around midnight). A day
  /// without winners (no vote, too few voters) gates nothing.
  counts(questId, day = utcDay(this.clock()), now = this.clock()) {
    const result = this.results(day, now);
    return !result || !result.gated || result.winners.includes(questId);
  }
  /// When held support should be looked at again: the next UTC midnight.
  nextCheck(now = this.clock()) {
    return dayStart(utcDay(now + DAY));
  }
}

// Player routes; the parent server authenticates and owns response helpers.
export function createBonusVoteRoutes(vote) {
  return {
    async handle(req, res, url, { player, body, respond, assert: check }) {
      if (url.pathname !== "/api/creators/bonus-vote") return false;
      check(
        vote,
        "The creator bonus vote is not enabled on this host.",
        503,
        "BONUS_VOTE_DISABLED",
      );
      const method = req.method || "GET";
      if (method === "GET") {
        respond(res, vote.ballot(player));
        return true;
      }
      if (method === "POST") {
        const input = await body(req);
        const questId = String(input.questId || "");
        respond(
          res,
          input.action === "unvote"
            ? vote.unvote(player, questId)
            : vote.vote(player, questId),
        );
        return true;
      }
      return false;
    },
  };
}

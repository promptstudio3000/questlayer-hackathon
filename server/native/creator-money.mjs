// Creator money on NEAR (W09): reads the creators contract, prepares reviewed
// player transactions (buy access, donate, withdraw) for the relayer or a
// wallet, and runs the durable publisher outbox that mirrors the local creator
// lifecycle on chain: register published quests, record verified completions
// and eligible likes, open and finalize the UTC daily support round.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { actions } from "near-api-js";
import { NativeContractReader } from "./reader.mjs";
import { assert } from "../domain.mjs";
import { nearAccountId } from "../identity/near.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import {
  loadServiceAccount,
  relayTransport,
} from "../relayer/key-transport.mjs";
import { NETWORK, manifestName } from "./network.mjs";

export const CREATOR_MONEY_SCHEMA = registerModuleSchema({
  name: "creator-money",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS creator_money_quests(
 quest_id TEXT PRIMARY KEY,
 author_account TEXT NOT NULL,
 registered_at INTEGER,
 transaction_hash TEXT
);
CREATE TABLE IF NOT EXISTS creator_money_support(
 quest_id TEXT NOT NULL,
 player_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('like','completion')),
 account_id TEXT NOT NULL,
 recorded_at INTEGER,
 transaction_hash TEXT,
 PRIMARY KEY(quest_id,player_id,kind)
);
CREATE TABLE IF NOT EXISTS creator_money_rounds(
 day TEXT PRIMARY KEY,
 budget_yocto TEXT NOT NULL CHECK(budget_yocto GLOB '[0-9]*'),
 state TEXT NOT NULL CHECK(state IN ('opening','open','finalizing','finalized')),
 opened_tx TEXT,
 finalized_tx TEXT,
 paid_yocto TEXT,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS creator_money_jobs(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('register_quest','set_price','close_quest','record_support','open_round','finalize_round')),
 args TEXT NOT NULL CHECK(json_valid(args)),
 state TEXT NOT NULL CHECK(state IN ('queued','retrying','confirmed','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 run_after INTEGER NOT NULL,
 transaction_hash TEXT,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS creator_money_jobs_due ON creator_money_jobs(state,run_after,seq);
CREATE TABLE IF NOT EXISTS creator_money_lease(
 id INTEGER PRIMARY KEY CHECK(id=1),
 owner TEXT,
 until_ms INTEGER NOT NULL DEFAULT 0,
 last_success INTEGER,
 last_error TEXT
)`,
});

const TGAS = 10n ** 12n;
const QUEST_ID = /^[a-z0-9:_-]{1,64}$/i;
const backoff = (attempts) =>
  Math.min(300000, 5000 * 2 ** Math.min(attempts, 6));
const MAX_PRICE = 10n * 10n ** 24n;
const validPrice = (value) =>
  typeof value === "string" &&
  /^(0|[1-9]\d{0,30})$/.test(value) &&
  BigInt(value) <= MAX_PRICE
    ? value
    : "0";
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function loadCreatorsManifest(
  url = new URL(
    `../../public/${manifestName("native-creators")}`,
    import.meta.url,
  ),
) {
  const manifest = JSON.parse(readFileSync(url, "utf8"));
  assert(
    manifest.network === NETWORK && typeof manifest.contractId === "string",
    "Invalid creators manifest.",
    503,
  );
  nearAccountId(manifest.contractId);
  return manifest;
}

export class CreatorMoney {
  constructor(
    db,
    provider,
    manifest,
    {
      transport = null,
      clock = Date.now,
      roundBudgetYocto = 10n ** 22n,
      maxRoundBudgetYocto = null,
      bonusVote = null,
    } = {},
  ) {
    this.db = db;
    this.manifest = manifest;
    this.reader = new NativeContractReader(provider, manifest.contractId);
    this.transport = transport;
    this.clock = clock;
    this.roundBudget = BigInt(roundBudgetYocto);
    this.maxRoundBudget =
      maxRoundBudgetYocto === null ? null : BigInt(maxRoundBudgetYocto);
    // Optional community vote (server/creators/bonus-vote.mjs): when a day has
    // voted bonus quests, only their support is recorded into that day's round.
    this.bonusVote = bonusVote;
    ensureModuleVersion(db, CREATOR_MONEY_SCHEMA);
    db.exec("INSERT OR IGNORE INTO creator_money_lease(id) VALUES(1)");
  }
  get contractId() {
    return this.manifest.contractId;
  }
  get enabled() {
    return !!this.transport;
  }
  // ---- Reads ---------------------------------------------------------------------
  async snapshot(playerId, accountId = null) {
    const [treasury, config] = await Promise.all([
      this.reader.view("get_treasury"),
      this.reader.view("get_config"),
    ]);
    const quests = this.db
      .prepare(
        "SELECT quest_id,author_account,registered_at,transaction_hash FROM creator_money_quests WHERE registered_at IS NOT NULL",
      )
      .all();
    const creator = accountId
      ? await this.reader.view("get_creator", { account_id: accountId })
      : null;
    const mine = accountId
      ? quests.filter((q) => q.author_account === accountId)
      : [];
    return {
      network: NETWORK,
      contractId: this.contractId,
      publisher: this.enabled ? "configured" : "not-configured",
      policy: config.policy,
      treasuryBps: config.treasury_bps,
      openRound: config.open_round,
      treasury,
      creator,
      registeredQuests: quests.length,
      ...(this.bonusVote && {
        bonusVote: this.bonusVote.results(utcDay(this.clock())),
      }),
      myQuests: mine.map((q) => q.quest_id),
      pendingJobs: this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM creator_money_jobs WHERE state IN ('queued','retrying')",
        )
        .get().n,
    };
  }
  async quest(questId) {
    assert(QUEST_ID.test(questId), "Invalid quest id.", 400);
    return this.reader.view("get_quest", { quest_id: questId }, true);
  }
  async access(questId, accountId) {
    assert(QUEST_ID.test(questId), "Invalid quest id.", 400);
    nearAccountId(accountId);
    return this.reader.view(
      "get_access",
      { quest_id: questId, account_id: accountId },
      true,
    );
  }
  /** Paid quests need bought access before a start; free quests pass through. */
  async admitStart(playerId, questId, localQuest = {}) {
    const localPrice = BigInt(localQuest?.price || "0");
    let chain;
    try {
      chain = await this.quest(questId);
    } catch {
      assert(
        localPrice === 0n,
        "We could not check your unlock right now. Try again in a moment.",
        503,
        "CREATOR_ACCESS_UNKNOWN",
      );
      return true;
    }
    const price = chain ? BigInt(chain.price || "0") : localPrice;
    if (price === 0n) return true;
    assert(
      chain,
      "This paid quest opens for unlocking shortly after publishing.",
      409,
      "CREATOR_ACCESS_PENDING",
    );
    const account = this.accountFor(playerId);
    assert(
      account,
      "Your explorer account is still being prepared.",
      409,
      "ACCOUNT_NOT_READY",
    );
    if (chain.author === account) return true;
    let access;
    try {
      access = await this.access(questId, account);
    } catch {
      assert(
        false,
        "We could not check your unlock right now. Try again in a moment.",
        503,
        "CREATOR_ACCESS_UNKNOWN",
      );
    }
    assert(
      access,
      "Unlock this quest before starting it.",
      402,
      "CREATOR_ACCESS_REQUIRED",
    );
    return true;
  }
  // ---- Reviewed player transactions ----------------------------------------------
  async prepare(accountId, { kind, questId, amount } = {}) {
    nearAccountId(accountId);
    const base = {
      network: NETWORK,
      signerId: accountId,
      receiverId: this.contractId,
    };
    if (kind === "buy") {
      const q = await this.quest(questId);
      assert(q && q.open, "This quest is not for sale.", 409);
      assert(BigInt(q.price) > 0n, "This quest is free.", 409);
      assert(q.author !== accountId, "You wrote this quest.", 409);
      const existing = await this.access(questId, accountId);
      assert(!existing, "You already have access.", 409);
      const config = await this.reader.view("get_config");
      const bps = BigInt(config.treasury_bps),
        price = BigInt(q.price),
        treasuryShare = (price * bps) / 10000n;
      return {
        ...base,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "buy_access",
              args: { quest_id: questId },
              gas: (60n * TGAS).toString(),
              deposit: q.price,
            },
          },
        ],
        price: q.price,
        creatorShare: (price - treasuryShare).toString(),
        treasuryShare: treasuryShare.toString(),
      };
    }
    if (kind === "donate") {
      const q = await this.quest(questId);
      assert(q && q.open, "This quest cannot receive donations.", 409);
      assert(q.author !== accountId, "You wrote this quest.", 409);
      assert(
        typeof amount === "string" && /^[1-9]\d{0,30}$/.test(amount),
        "Enter a donation amount.",
        400,
      );
      return {
        ...base,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "donate",
              args: { quest_id: questId },
              gas: (40n * TGAS).toString(),
              deposit: amount,
            },
          },
        ],
        creatorShare: amount,
        treasuryShare: "0",
      };
    }
    if (kind === "withdraw") {
      const creator = await this.reader.view(
        "get_creator",
        { account_id: accountId },
        true,
      );
      assert(
        BigInt(creator.credit) > 0n && BigInt(creator.pending) === 0n,
        "Nothing to withdraw yet.",
        409,
      );
      return {
        ...base,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "withdraw",
              args: {},
              gas: (60n * TGAS).toString(),
              deposit: "1",
            },
          },
        ],
        amount: creator.credit,
      };
    }
    assert(false, "Unknown creator payment.", 400);
  }
  // ---- Publisher outbox ----------------------------------------------------------
  enqueue(kind, args, now = this.clock()) {
    const id = `cm_${randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO creator_money_jobs(id,kind,args,state,run_after,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)",
      )
      .run(id, kind, JSON.stringify(args), now, now, now);
    return id;
  }
  // The creator community module owns these tables; without it only rounds run.
  hasLifecycle() {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('creator_quests','creator_participations')",
        )
        .get().n === 2
    );
  }
  accountFor(playerId) {
    const row = this.db
      .prepare(
        "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at LIMIT 1",
      )
      .get(playerId);
    return row?.account_id ?? null;
  }
  /// One eligible like per player and quest; enqueued once the player has an account.
  like(playerId, questId) {
    assert(QUEST_ID.test(questId), "Invalid quest id.", 400);
    assert(
      this.hasLifecycle(),
      "Creator quests are not enabled on this host.",
      503,
      "CREATORS_DISABLED",
    );
    const quest = this.db
      .prepare(
        "SELECT author FROM creator_quests WHERE id=? AND state='published'",
      )
      .get(questId);
    assert(quest, "This quest is not published.", 404);
    assert(quest.author !== playerId, "You cannot like your own quest.", 409);
    const accountId = this.accountFor(playerId);
    assert(
      accountId,
      "Your explorer account is still being prepared.",
      409,
      "ACCOUNT_NOT_READY",
    );
    const existing = this.db
      .prepare(
        "SELECT recorded_at FROM creator_money_support WHERE quest_id=? AND player_id=? AND kind='like'",
      )
      .get(questId, playerId);
    if (existing)
      return { liked: true, recorded: existing.recorded_at !== null };
    const now = this.clock();
    this.db
      .prepare(
        "INSERT INTO creator_money_support(quest_id,player_id,kind,account_id) VALUES(?,?,'like',?)",
      )
      .run(questId, playerId, accountId);
    this.enqueue(
      "record_support",
      {
        quest_id: questId,
        player_id: accountId,
        kind: "like",
        localPlayer: playerId,
      },
      now,
    );
    return { liked: true, recorded: false };
  }
  /// Mirrors the local lifecycle: published quests, accepted completions, rounds.
  sync(now = this.clock()) {
    const enqueued = [];
    if (!this.hasLifecycle()) return enqueued;
    const published = this.db
      .prepare(
        `SELECT q.id, q.author, json_extract(r.content,'$.price') AS price
        FROM creator_quests q
        LEFT JOIN creator_money_quests m ON m.quest_id=q.id
        LEFT JOIN creator_revisions r ON r.quest_id=q.id AND r.revision=q.published_revision
        WHERE q.state IN ('published','closing') AND m.quest_id IS NULL`,
      )
      .all();
    for (const q of published) {
      const account = this.accountFor(q.author);
      if (!account) continue;
      this.db
        .prepare(
          "INSERT INTO creator_money_quests(quest_id,author_account) VALUES(?,?)",
        )
        .run(q.id, account);
      enqueued.push(
        this.enqueue(
          "register_quest",
          { quest_id: q.id, author_id: account, price: validPrice(q.price) },
          now,
        ),
      );
    }
    // A newly approved revision may change the access price; mirror it once.
    // The last job for the quest (any state) is the price already asked for,
    // so a terminal failure is not retried until the author changes it again.
    const priced = this.db
      .prepare(
        `SELECT q.id, json_extract(r.content,'$.price') AS price,
          (SELECT json_extract(j.args,'$.price') FROM creator_money_jobs j
            WHERE j.kind IN ('register_quest','set_price') AND json_extract(j.args,'$.quest_id')=q.id
            ORDER BY j.seq DESC LIMIT 1) AS asked
        FROM creator_quests q
        JOIN creator_money_quests m ON m.quest_id=q.id AND m.registered_at IS NOT NULL
        JOIN creator_revisions r ON r.quest_id=q.id AND r.revision=q.published_revision
        WHERE q.state='published'`,
      )
      .all();
    for (const q of priced) {
      const price = validPrice(q.price);
      if (q.asked === null || q.asked === price) continue;
      enqueued.push(this.enqueue("set_price", { quest_id: q.id, price }, now));
    }
    const completions = this.db
      .prepare(
        "SELECT p.quest_id, p.participant FROM creator_participations p JOIN creator_money_quests m ON m.quest_id=p.quest_id LEFT JOIN creator_money_support s ON s.quest_id=p.quest_id AND s.player_id=p.participant AND s.kind='completion' WHERE p.state='resolved' AND p.resolution_reference IS NOT NULL AND s.quest_id IS NULL",
      )
      .all();
    for (const c of completions) {
      const account = this.accountFor(c.participant);
      if (!account) continue;
      this.db
        .prepare(
          "INSERT INTO creator_money_support(quest_id,player_id,kind,account_id) VALUES(?,?,'completion',?)",
        )
        .run(c.quest_id, c.participant, account);
      enqueued.push(
        this.enqueue(
          "record_support",
          {
            quest_id: c.quest_id,
            player_id: account,
            kind: "completion",
            localPlayer: c.participant,
          },
          now,
        ),
      );
    }
    return enqueued;
  }
  async rounds(now = this.clock()) {
    const today = utcDay(now);
    const open = this.db
      .prepare(
        "SELECT day,state FROM creator_money_rounds WHERE state IN ('opening','open','finalizing') ORDER BY day LIMIT 1",
      )
      .get();
    if (open && open.day !== today && open.state === "open") {
      this.db
        .prepare(
          "UPDATE creator_money_rounds SET state='finalizing',updated_at=? WHERE day=?",
        )
        .run(now, open.day);
      return this.enqueue("finalize_round", { day: open.day }, now);
    }
    if (open) return null;
    if (
      this.db
        .prepare("SELECT day FROM creator_money_rounds WHERE day=?")
        .get(today)
    )
      return null;
    const treasury = await this.reader.view("get_treasury", {}, true);
    let budget = this.roundBudget;
    if (this.maxRoundBudget !== null && budget > this.maxRoundBudget)
      budget = this.maxRoundBudget;
    if (BigInt(treasury.fund_available) < budget)
      budget = BigInt(treasury.fund_available);
    if (budget <= 0n) return null;
    this.db
      .prepare(
        "INSERT INTO creator_money_rounds(day,budget_yocto,state,updated_at) VALUES(?,?,'opening',?)",
      )
      .run(today, budget.toString(), now);
    return this.enqueue(
      "open_round",
      { day: today, budget: budget.toString() },
      now,
    );
  }
  lease(owner, now) {
    const r = this.db
      .prepare(
        "UPDATE creator_money_lease SET owner=?,until_ms=? WHERE id=1 AND (owner IS NULL OR owner=? OR until_ms<?)",
      )
      .run(owner, now + 120000, owner, now);
    return r.changes === 1;
  }
  async run({ maxJobs = 8, owner = `cm-${process.pid}` } = {}) {
    if (!this.enabled) return { skipped: "not-configured" };
    const now = this.clock();
    if (!this.lease(owner, now)) return { busy: true };
    let confirmed = 0,
      failed = 0,
      retried = 0,
      held = 0;
    try {
      this.sync(now);
      await this.rounds(now);
      const due = this.db
        .prepare(
          "SELECT * FROM creator_money_jobs WHERE state IN ('queued','retrying') AND run_after<=? ORDER BY seq LIMIT ?",
        )
        .all(this.clock(), maxJobs);
      for (const job of due) {
        if (!this.lease(owner, this.clock())) break;
        if (job.kind === "record_support" && this.bonusVote) {
          const at = this.clock();
          // Gate by the round actually open on chain, not by the clock.
          const round = this.db
            .prepare(
              "SELECT day FROM creator_money_rounds WHERE state IN ('open','finalizing') ORDER BY day LIMIT 1",
            )
            .get();
          if (
            round &&
            !this.bonusVote.counts(JSON.parse(job.args).quest_id, round.day, at)
          ) {
            // Not a bonus quest today: keep the support for a day it wins.
            this.db
              .prepare(
                "UPDATE creator_money_jobs SET run_after=?,last_error=?,updated_at=? WHERE id=?",
              )
              .run(
                // Yesterday's round is still closing: look again shortly.
                round.day === utcDay(at)
                  ? this.bonusVote.nextCheck(at)
                  : at + 60000,
                "Held: not among today's community bonus quests.",
                at,
                job.id,
              );
            held++;
            continue;
          }
        }
        try {
          const hash = await this.send(job);
          this.complete(job, hash);
          confirmed++;
        } catch (error) {
          const attempts = job.attempts + 1;
          const terminal =
            /Quest exists|Unknown quest|Round exists|Unknown round|A round is already open|Quest closed|Unknown support kind/.test(
              String(error?.message),
            );
          if (terminal) {
            failed++;
            this.fail(job, error);
          } else {
            retried++;
            this.db
              .prepare(
                "UPDATE creator_money_jobs SET state='retrying',attempts=?,run_after=?,last_error=?,updated_at=? WHERE id=?",
              )
              .run(
                attempts,
                this.clock() + backoff(attempts),
                String(error?.message).slice(0, 400),
                this.clock(),
                job.id,
              );
          }
        }
      }
      this.db
        .prepare(
          "UPDATE creator_money_lease SET last_success=?,last_error=NULL WHERE id=1",
        )
        .run(this.clock());
    } catch (error) {
      this.db
        .prepare("UPDATE creator_money_lease SET last_error=? WHERE id=1")
        .run(String(error?.message).slice(0, 400));
      throw error;
    } finally {
      this.db
        .prepare(
          "UPDATE creator_money_lease SET owner=NULL,until_ms=0 WHERE id=1 AND owner=?",
        )
        .run(owner);
    }
    return this.bonusVote
      ? { confirmed, failed, retried, held }
      : { confirmed, failed, retried };
  }
  async send(job) {
    const args = JSON.parse(job.args);
    const { localPlayer, ...callArgs } = args;
    void localPlayer;
    const signed = await this.transport.sign({
      receiverId: this.contractId,
      actions: [actions.functionCall(job.kind, callArgs, 80n * TGAS, 0n)],
    });
    this.db
      .prepare(
        "UPDATE creator_money_jobs SET transaction_hash=?,updated_at=? WHERE id=?",
      )
      .run(signed.hash, this.clock(), job.id);
    const outcome = await signed.send("FINAL");
    if (outcome?.status?.Failure)
      throw new Error(
        "Publisher action failed: " +
          JSON.stringify(outcome.status.Failure).slice(0, 300),
      );
    return signed.hash;
  }
  complete(job, hash) {
    const now = this.clock(),
      args = JSON.parse(job.args);
    this.db
      .prepare(
        "UPDATE creator_money_jobs SET state='confirmed',transaction_hash=?,updated_at=?,last_error=NULL WHERE id=?",
      )
      .run(hash, now, job.id);
    if (job.kind === "register_quest")
      this.db
        .prepare(
          "UPDATE creator_money_quests SET registered_at=?,transaction_hash=? WHERE quest_id=?",
        )
        .run(now, hash, args.quest_id);
    if (job.kind === "record_support")
      this.db
        .prepare(
          "UPDATE creator_money_support SET recorded_at=?,transaction_hash=? WHERE quest_id=? AND player_id=? AND kind=?",
        )
        .run(now, hash, args.quest_id, args.localPlayer, args.kind);
    if (job.kind === "open_round")
      this.db
        .prepare(
          "UPDATE creator_money_rounds SET state='open',opened_tx=?,updated_at=? WHERE day=?",
        )
        .run(hash, now, args.day);
    if (job.kind === "finalize_round")
      this.db
        .prepare(
          "UPDATE creator_money_rounds SET state='finalized',finalized_tx=?,updated_at=? WHERE day=?",
        )
        .run(hash, now, args.day);
  }
  fail(job, error) {
    const now = this.clock(),
      args = JSON.parse(job.args);
    this.db
      .prepare(
        "UPDATE creator_money_jobs SET state='failed',last_error=?,updated_at=? WHERE id=?",
      )
      .run(String(error?.message).slice(0, 400), now, job.id);
    if (job.kind === "open_round")
      this.db
        .prepare(
          "DELETE FROM creator_money_rounds WHERE day=? AND state='opening'",
        )
        .run(args.day);
    if (
      job.kind === "register_quest" &&
      /Quest exists/.test(String(error?.message))
    )
      this.db
        .prepare(
          "UPDATE creator_money_quests SET registered_at=? WHERE quest_id=? AND registered_at IS NULL",
        )
        .run(now, args.quest_id);
  }
  workerStatus() {
    const lease = this.db
      .prepare(
        "SELECT owner,until_ms,last_success,last_error FROM creator_money_lease WHERE id=1",
      )
      .get();
    const jobs = Object.fromEntries(
      this.db
        .prepare(
          "SELECT state, COUNT(*) AS n FROM creator_money_jobs GROUP BY state",
        )
        .all()
        .map((r) => [r.state, r.n]),
    );
    return { enabled: this.enabled, contractId: this.contractId, lease, jobs };
  }
}

export async function loadCreatorsPublisher(provider, keyPath, contractId) {
  const service = await loadServiceAccount(provider, keyPath, {
    expectAccountId: contractId,
    requireFullAccess: false,
  });
  return relayTransport(service);
}

export function startCreatorMoneyWorker(money, { intervalMs = 30000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await money.run();
    } catch (error) {
      console.error("Creator money worker:", error?.message || error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  setTimeout(tick, 2000).unref?.();
  return { stop: async () => clearInterval(timer), tick };
}

// Player routes; the parent server authenticates and owns response helpers.
export function createCreatorMoneyRoutes(money) {
  return {
    async handle(
      req,
      res,
      url,
      { player, body, respond, assert: check, accountFor },
    ) {
      const path = url.pathname,
        method = req.method || "GET";
      if (!path.startsWith("/api/native/creators")) return false;
      check(
        money,
        "Creator money is not configured yet.",
        503,
        "CREATORS_DISABLED",
      );
      if (path === "/api/native/creators" && method === "GET") {
        respond(res, await money.snapshot(player, accountFor(player)));
        return true;
      }
      if (path === "/api/native/creators/quest" && method === "GET") {
        const questId = url.searchParams.get("quest") || "";
        const account = accountFor(player);
        respond(res, {
          quest: await money.quest(questId),
          access: account ? await money.access(questId, account) : null,
        });
        return true;
      }
      if (path === "/api/native/creators/prepare" && method === "POST") {
        const input = await body(req);
        const account = accountFor(player);
        check(
          account,
          "Your explorer account is still being prepared.",
          409,
          "ACCOUNT_NOT_READY",
        );
        respond(
          res,
          await money.prepare(account, {
            kind: input.kind,
            questId: input.questId,
            amount: input.amount,
          }),
        );
        return true;
      }
      if (path === "/api/native/creators/like" && method === "POST") {
        const input = await body(req);
        respond(res, money.like(player, String(input.questId || "")));
        return true;
      }
      return false;
    },
  };
}

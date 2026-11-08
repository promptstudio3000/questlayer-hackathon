import { randomBytes } from "node:crypto";
import { PublicKey, actions } from "near-api-js";
import { atomic } from "../database.mjs";
import { assert, dayKey, id } from "../domain.mjs";
import { nearAccountId } from "../identity/near.mjs";
import { rpcErrorText } from "../near-provider.mjs";
import { initializeManagedAccounts } from "./schema.mjs";
import { RelayJobError, retryLater, terminal } from "./errors.mjs";
import { classifyFailure, relayFailure } from "./outcome.mjs";
import { NETWORK, NETWORK_LABEL } from "../native/network.mjs";
import { SubsidyBudget } from "./subsidy-budget.mjs";
import { FundingJournal } from "./funding-journal.mjs";

const MAX_SLUG = 32,
  MAX_KEYS = 10;
const yoctoText = (value) => {
  const n = BigInt(value);
  assert(n >= 0n && n < 2n ** 128n, "Invalid yoctoNEAR amount.", 503);
  return n;
};
const missing = (error) =>
  /does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist|UNKNOWN_ACCESS_KEY|AccessKeyDoesNotExist/i.test(
    rpcErrorText(error),
  );
function devicePublicKey(value) {
  assert(
    typeof value === "string" && value.length <= 128,
    "Provide the device public key.",
  );
  let key;
  try {
    key = PublicKey.fromString(value);
  } catch {
    assert(false, "The device public key is invalid.");
  }
  assert(key.keyType === 0, "Only ed25519 device keys are supported.");
  return key.toString();
}

// One sponsored sub-account per player under the factory. The player's device key
// is the only full-access key; the service holds no player key.
export class ManagedAccounts {
  constructor(
    db,
    provider,
    factory,
    { factoryId, fundYocto, topupCapYocto = 0n, clock = Date.now, subsidyBudget = null } = {},
  ) {
    this.db = db;
    this.provider = provider;
    this.factory = factory;
    this.factoryId = nearAccountId(factoryId ?? factory?.accountId);
    assert(
      !factory || factory.accountId === this.factoryId,
      "Factory identity mismatch.",
      503,
    );
    this.fundYocto = yoctoText(fundYocto ?? 0n);
    this.topupCapYocto = yoctoText(topupCapYocto);
    this.clock = clock;
    this.subsidyBudget = subsidyBudget ?? new SubsidyBudget(db, { clock });
    this.funding = new FundingJournal(db, factory, this.subsidyBudget, clock);
    initializeManagedAccounts(db);
  }
  /** NEAR account ids are at most 64 characters: slug + "." + factory. */
  get maxSlug() {
    return Math.max(8, Math.min(MAX_SLUG, 63 - String(this.factoryId || "").length));
  }
  slugFor(name) {
    const base = String(name ?? "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, this.maxSlug)
      .replace(/-+$/g, "");
    const slug = base.length >= 2 ? base : "explorer";
    assert(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
        `${slug}.${this.factoryId}`.length <= 64,
      "Choose a shorter account name.",
    );
    return slug;
  }
  async exists(accountId) {
    try {
      await this.provider.query({
        request_type: "view_account",
        account_id: accountId,
        finality: "final",
      });
      return true;
    } catch (error) {
      if (missing(error)) return false;
      assert(
        false,
        `${NETWORK_LABEL} is unavailable. Try again shortly.`,
        503,
        "RPC_UNAVAILABLE",
      );
    }
  }
  async accessKey(accountId, publicKey) {
    try {
      return await this.provider.query({
        request_type: "view_access_key",
        account_id: accountId,
        public_key: publicKey,
        finality: "final",
      });
    } catch (error) {
      if (missing(error)) return null;
      throw retryLater("RPC_UNAVAILABLE", `${NETWORK_LABEL} is unavailable.`);
    }
  }
  row(playerId) {
    return (
      this.db
        .prepare("SELECT * FROM managed_accounts WHERE player_id=?")
        .get(playerId) || null
    );
  }
  byAccount(accountId) {
    return (
      this.db
        .prepare("SELECT * FROM managed_accounts WHERE account_id=?")
        .get(accountId) || null
    );
  }
  owned(playerId, accountId) {
    nearAccountId(accountId);
    const row = this.byAccount(accountId);
    assert(
      row && row.player_id === playerId,
      "This managed account belongs to another explorer.",
      403,
      "ACCOUNT_FORBIDDEN",
    );
    return row;
  }
  keys(accountId, states = ["active"]) {
    return this.db
      .prepare(
        `SELECT public_key FROM managed_account_keys WHERE account_id=? AND state IN (${states.map(() => "?").join(",")}) ORDER BY created_at, rowid`,
      )
      .all(accountId, ...states)
      .map((k) => k.public_key);
  }
  async create(player, { publicKey, name, authorizeEnrollment = () => {} } = {}) {
    assert(
      this.factory,
      "Managed accounts are not configured on this host.",
      503,
      "ACCOUNT_DISABLED",
    );
    assert(
      typeof player === "string" && player.length > 0,
      "Sign in to create your account.",
      401,
    );
    assert(
      this.db.prepare("SELECT 1 FROM players WHERE id=?").get(player),
      "Player not found.",
      404,
    );
    const key = devicePublicKey(publicKey);
    const playerName = this.db
      .prepare("SELECT name FROM players WHERE id=?")
      .get(player).name;
    const existing = this.row(player);
    if (existing && existing.state !== "failed") return this.view(player);
    authorizeEnrollment();
    let slug = this.slugFor(name ?? playerName),
      accountId = `${slug}.${this.factoryId}`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const taken =
        this.db
          .prepare(
            "SELECT 1 FROM managed_accounts WHERE slug=? OR account_id=?",
          )
          .get(slug, accountId) || (await this.exists(accountId));
      if (!taken) break;
      assert(
        attempt < 5,
        "Choose a different account name.",
        409,
        "ACCOUNT_TAKEN",
      );
      slug = `${this.slugFor(name ?? playerName).slice(0, this.maxSlug - 5).replace(/-+$/g, "")}-${randomBytes(3).toString("hex").slice(0, 4)}`;
      accountId = `${slug}.${this.factoryId}`;
    }
    const now = this.clock(), jobId = id("relay");
    atomic(this.db, () => {
      authorizeEnrollment();
      const current = this.row(player);
      assert(
        !current || current.state === "failed",
        "You already have a managed account.",
        409,
        "ACCOUNT_EXISTS",
      );
      if (current) {
        for (const table of [
          "relay_budget",
          "managed_account_funding",
          "managed_account_keys",
          "relay_jobs",
        ])
          this.db
            .prepare(`DELETE FROM ${table} WHERE account_id=?`)
            .run(current.account_id);
        this.db
          .prepare("DELETE FROM managed_accounts WHERE account_id=?")
          .run(current.account_id);
      }
      this.subsidyBudget.reserve(jobId, { kind: "create-account", accountId, principal: this.fundYocto });
      this.db
        .prepare(
          "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,?,'creating',?,?)",
        )
        .run(accountId, player, slug, this.factoryId, NETWORK, now, now);
      this.db
        .prepare(
          "INSERT INTO managed_account_keys VALUES(?,?,'device','pending',?,?,?)",
        )
        .run(accountId, key, "first device", now, now);
      this.db
        .prepare(
          "INSERT INTO relay_jobs(id,player_id,account_id,kind,state,call,receiver_id,method_name,run_after,created_at,updated_at) VALUES(?,?,?,'create-account','queued',?,?,'create_account',?,?,?)",
        )
        .run(
          jobId,
          player,
          accountId,
          JSON.stringify({
            publicKey: key,
            fundYocto: this.fundYocto.toString(),
            factoryId: this.factoryId,
          }),
          accountId,
          now,
          now,
          now,
        );
    });
    return this.view(player);
  }
  async requestKey(player, { publicKey, kind = "device", label = null } = {}) {
    const row = this.row(player);
    assert(
      row?.state === "ready",
      "Create your managed account first.",
      409,
      "ACCOUNT_NOT_READY",
    );
    const key = devicePublicKey(publicKey);
    assert(["device", "recovery"].includes(kind), "Unknown key kind.");
    assert(
      label === null || (typeof label === "string" && label.length <= 40),
      "Key label is too long.",
    );
    const known = this.db
      .prepare(
        "SELECT state FROM managed_account_keys WHERE account_id=? AND public_key=?",
      )
      .get(row.account_id, key);
    assert(
      known ||
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM managed_account_keys WHERE account_id=? AND state!='removed'",
          )
          .get(row.account_id).n < MAX_KEYS,
      `An explorer can keep at most ${MAX_KEYS} devices. Remove one first.`,
      409,
      "ACCOUNT_KEY_LIMIT",
    );
    const now = this.clock();
    this.db
      .prepare(
        "INSERT INTO managed_account_keys VALUES(?,?,?,'pending',?,?,?) ON CONFLICT(account_id,public_key) DO UPDATE SET state=CASE WHEN managed_account_keys.state='removed' THEN 'pending' ELSE managed_account_keys.state END,updated_at=excluded.updated_at",
      )
      .run(row.account_id, key, kind, label, now, now);
    return this.view(player);
  }
  requestKeyRemoval(player, { publicKey } = {}) {
    const row = this.row(player);
    assert(
      row?.state === "ready",
      "Create your managed account first.",
      409,
      "ACCOUNT_NOT_READY",
    );
    const key = devicePublicKey(publicKey);
    const current = this.db
      .prepare(
        "SELECT state FROM managed_account_keys WHERE account_id=? AND public_key=?",
      )
      .get(row.account_id, key)?.state;
    if (current === "pending") {
      // Never added on chain by this explorer's request yet: forget it.
      this.db
        .prepare(
          "UPDATE managed_account_keys SET state='removed',updated_at=? WHERE account_id=? AND public_key=? AND state='pending'",
        )
        .run(this.clock(), row.account_id, key);
      return this.view(player);
    }
    // A repeated request for a key already being removed is idempotent, so a
    // failed deleteKey can simply be signed again.
    if (current === "removing") return this.view(player);
    assert(current === "active", "This key is not active.", 409);
    assert(
      this.keys(row.account_id).filter((k) => k !== key).length > 0,
      "Keep at least one active key.",
      409,
      "ACCOUNT_LAST_KEY",
    );
    this.db
      .prepare(
        "UPDATE managed_account_keys SET state='removing',updated_at=? WHERE account_id=? AND public_key=? AND state='active'",
      )
      .run(this.clock(), row.account_id, key);
    return this.view(player);
  }
  // Called by the relay worker under its lease. Idempotent: a lost response is
  // reconciled from the chain (account + key) before anything durable changes.
  async finalize(job, { write = (work) => atomic(this.db, work) } = {}) {
    assert(
      this.factory,
      "Managed accounts are not configured on this host.",
      503,
      "ACCOUNT_DISABLED",
    );
    const row = this.byAccount(job.account_id);
    if (!row)
      throw terminal(
        "ACCOUNT_MISSING",
        "The managed account record is missing.",
      );
    if (row.state === "ready")
      return {
        accountId: row.account_id,
        transactionHash: row.transaction_hash,
      };
    const call = JSON.parse(job.call),
      publicKey = call.publicKey,
      fund = BigInt(call.fundYocto ?? this.fundYocto);
    let transactionHash = job.transaction_hash || row.transaction_hash || null;
    let key = (await this.exists(row.account_id))
      ? await this.accessKey(row.account_id, publicKey)
      : undefined;
    if (key === null)
      throw terminal(
        "ACCOUNT_TAKEN",
        "The account name was taken by someone else.",
      );
    if (key === undefined || this.funding.latest(job.id)?.state === "prepared") {
      let result;
      try {
        result = await this.funding.perform(job.id, { kind: "create-account", accountId: row.account_id, principal: String(fund), publicKey }, { write });
      } catch (error) {
        if (error instanceof RelayJobError || error.message === "Relay worker lease expired.") throw error;
        throw classifyFailure(error, {});
      }
      transactionHash = result?.transaction?.hash || transactionHash;
      const failure = relayFailure(result);
      if (failure) {
        const verdict = classifyFailure(failure, {});
        if (verdict.code === "RELAY_INSUFFICIENT_BALANCE")
          throw retryLater(
            "FACTORY_UNDERFUNDED",
            "The player factory account cannot fund a new account right now.",
          );
        if (verdict.code !== "ACCOUNT_TAKEN") throw verdict;
      }
      key = await this.accessKey(row.account_id, publicKey);
      if (!key)
        throw terminal(
          "ACCOUNT_TAKEN",
          "The account name was taken by someone else.",
        );
    }
    if (key.permission !== "FullAccess")
      throw terminal(
        "ACCOUNT_KEY",
        "The device key did not receive full access.",
      );
    const now = this.clock();
    write(() => {
      if (!this.funding.latest(job.id)) this.subsidyBudget.settle(job.id, transactionHash);
      const link = this.db
        .prepare("SELECT player_id FROM wallet_links WHERE account_id=?")
        .get(row.account_id);
      if (link && link.player_id !== row.player_id)
        throw terminal(
          "ACCOUNT_LINKED_ELSEWHERE",
          "This account is linked to another explorer.",
        );
      this.db
        .prepare(
          "INSERT INTO wallet_links(account_id,player_id,verified_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET verified_at=excluded.verified_at",
        )
        .run(row.account_id, row.player_id, now);
      if (
        this.db
          .prepare("PRAGMA table_info(players)")
          .all()
          .some((c) => c.name === "native_account")
      )
        this.db
          .prepare(
            "UPDATE players SET native_account=COALESCE(native_account,?) WHERE id=?",
          )
          .run(row.account_id, row.player_id);
      this.db
        .prepare(
          "UPDATE managed_accounts SET state='ready',funded_yocto=?,transaction_hash=?,ready_at=?,updated_at=?,error_code=NULL,last_error=NULL WHERE account_id=?",
        )
        .run(fund.toString(), transactionHash, now, now, row.account_id);
      this.db
        .prepare(
          "UPDATE managed_account_keys SET state='active',updated_at=? WHERE account_id=? AND public_key=?",
        )
        .run(now, row.account_id, publicKey);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO managed_account_funding VALUES(?,?,'initial',?,?,?,?)",
        )
        .run(
          `fund_${job.id}`,
          row.account_id,
          fund.toString(),
          job.id,
          transactionHash,
          now,
        );
    });
    return { accountId: row.account_id, transactionHash };
  }
  markFailed(
    accountId,
    error,
    { write = (work) => atomic(this.db, work) } = {},
  ) {
    write(() =>
      this.db
        .prepare(
          "UPDATE managed_accounts SET state='failed',error_code=?,last_error=?,updated_at=? WHERE account_id=? AND state='creating'",
        )
        .run(
          error.code || "ACCOUNT_FAILED",
          String(error.message).slice(0, 200),
          this.clock(),
          accountId,
        ),
    );
  }
  async balance(accountId) {
    try {
      const view = await this.provider.query({
        request_type: "view_account",
        account_id: accountId,
        finality: "final",
      });
      return BigInt(view.amount);
    } catch (error) {
      if (missing(error))
        throw terminal(
          "ACCOUNT_MISSING",
          "The managed account no longer exists.",
        );
      throw retryLater("RPC_UNAVAILABLE", `${NETWORK_LABEL} is unavailable.`);
    }
  }
  // Tops the account up to neededYocto within the daily cap. Deposits the game
  // sponsors are storage; a purchase price is never topped up.
  async ensureFunded(
    accountId,
    neededYocto,
    { jobId = null, write = (work) => atomic(this.db, work) } = {},
  ) {
    const operationId = `topup:${jobId ?? `${accountId}:${dayKey(this.clock(), "UTC")}:${neededYocto}`}`;
    const saved = this.funding.latest(operationId);
    const needed = yoctoText(neededYocto),
      current = await this.balance(accountId);
    if (current >= needed && !saved)
      return { toppedUp: false, balance: current.toString() };
    if (!this.factory)
      throw terminal(
        "RELAY_INSUFFICIENT_BALANCE",
        "Your account balance does not cover the attached deposit.",
      );
    const amount = saved ? BigInt(JSON.parse(saved.request).principal) : needed - current,
      day = dayKey(this.clock(), "UTC");
    const used = BigInt(
      this.db
        .prepare(
          "SELECT topup_yocto FROM relay_budget WHERE account_id=? AND day=?",
        )
        .get(accountId, day)?.topup_yocto ?? "0",
    );
    if (!saved && used + amount > this.topupCapYocto)
      throw terminal(
        "RELAY_TOPUP_CAP",
        "Today's sponsored funding for this account is used up.",
      );
    let result;
    try {
      result = await this.funding.perform(operationId, { kind: "topup", accountId, principal: String(amount) }, { write: work => write(() => {
        if (!this.funding.latest(operationId)) {
          const freshUsed = BigInt(this.db.prepare("SELECT topup_yocto FROM relay_budget WHERE account_id=? AND day=?").get(accountId, day)?.topup_yocto ?? "0");
          assert(freshUsed + amount <= this.topupCapYocto, "Today's sponsored funding is reserved.", 429, "RELAY_TOPUP_CAP");
          this.db.prepare("INSERT INTO relay_budget(account_id,day,jobs,topup_yocto) VALUES(?,?,0,?) ON CONFLICT(account_id,day) DO UPDATE SET topup_yocto=excluded.topup_yocto").run(accountId, day, String(freshUsed + amount));
        }
        return work();
      }) });
    } catch (error) {
      if (error instanceof RelayJobError || error.message === "Relay worker lease expired.") throw error;
      throw classifyFailure(error, {});
    }
    const failure = relayFailure(result);
    if (failure)
      throw retryLater(
        "FACTORY_UNDERFUNDED",
        "The player factory account cannot top up right now.",
      );
    const now = this.clock(),
      hash = result?.transaction?.hash || null;
    write(() => {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO managed_account_funding VALUES(?,?,'topup',?,?,?,?)",
        )
        .run(operationId, accountId, amount.toString(), jobId, hash, now);
    });
    return { toppedUp: true, amount: amount.toString(), transactionHash: hash };
  }
  view(playerId) {
    const row = this.row(playerId);
    if (!row)
      return {
        network: NETWORK,
        factoryId: this.factoryId,
        enabled: !!this.factory,
        account: null,
      };
    const keys = this.db
      .prepare(
        "SELECT public_key,kind,state,label,created_at FROM managed_account_keys WHERE account_id=? ORDER BY created_at, rowid",
      )
      .all(row.account_id)
      .map((k) => ({
        publicKey: k.public_key,
        kind: k.kind,
        state: k.state,
        label: k.label,
        createdAt: k.created_at,
      }));
    const pending = this.db
      .prepare(
        "SELECT id,state,error_code,last_error,transaction_hash FROM relay_jobs WHERE account_id=? AND kind='create-account' ORDER BY seq DESC LIMIT 1",
      )
      .get(row.account_id);
    return {
      network: NETWORK,
      factoryId: this.factoryId,
      enabled: !!this.factory,
      account: {
        accountId: row.account_id,
        state: row.state,
        fundedYocto: row.funded_yocto,
        transactionHash: row.transaction_hash,
        createdAt: row.created_at,
        readyAt: row.ready_at,
        errorCode: row.error_code,
        error: row.last_error,
        keys,
        creation: pending
          ? {
              jobId: pending.id,
              state: pending.state,
              errorCode: pending.error_code,
              error: pending.last_error,
            }
          : null,
      },
    };
  }
}

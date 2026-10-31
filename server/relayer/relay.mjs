import { actions } from "near-api-js";
import { atomic } from "../database.mjs";
import { assert, dayKey, id } from "../domain.mjs";
import { nearAccountId } from "../identity/near.mjs";
import { rpcErrorText } from "../near-provider.mjs";
import { decodeSignedDelegate, verifySignedDelegate } from "./delegate.mjs";
import { RelayJobError, retryLater } from "./errors.mjs";
import {
  classifyFailure,
  relayFailure,
  verifyRelayOutcome,
} from "./outcome.mjs";
import {
  RelayPolicyError,
  SOCIAL_CONTRACT,
  validateDelegate,
} from "./policy.mjs";
import { initializeManagedAccounts } from "./schema.mjs";
import { relayTransport } from "./key-transport.mjs";

const OPEN = "('queued','retrying','sent')";
const LEASE_MS = 120000;
export const backoff = (attempts) =>
  Math.min(300000, 5000 * 2 ** Math.min(attempts, 6));
// Sender-side headroom for the account's own state when a sponsored deposit is attached.
const STATE_MARGIN = 10n ** 22n; // 0.01 NEAR
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const missing = (error) =>
  /does not exist|UNKNOWN_TRANSACTION|UnknownTransaction/i.test(
    rpcErrorText(error),
  );
function jobView(row) {
  if (!row) return null;
  const call = JSON.parse(row.call);
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    accountId: row.account_id,
    receiverId: row.receiver_id,
    methodName: row.method_name,
    deposit: call.deposit ?? null,
    sponsorDeposit: call.sponsorDeposit ?? null,
    attempts: row.attempts,
    nextAttemptAt:
      row.state === "retrying" || row.state === "queued" ? row.run_after : null,
    transactionHash: row.transaction_hash,
    result: row.result ? JSON.parse(row.result) : null,
    errorCode: row.error_code,
    error: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
  };
}

// Sponsors gas for allowlisted meta-transactions signed by managed accounts.
// Nothing here can move a player's assets: every action is signed by the player's
// own key and verified against the allowlist before and after execution.
export class Relayer {
  constructor(
    db,
    provider,
    relayerAccount,
    {
      accounts,
      contracts,
      clock = Date.now,
      blockTtl = 120,
      maxJobsPerDay = 40,
      maxGas = 300000000000000n,
      maxBuyDeposit = 5n * 10n ** 24n,
      policyContext = null,
      vaults = null,
      factorySetupDeposit = null,
      factoryPools = [],
    } = {},
  ) {
    assert(accounts, "Managed accounts are required by the relayer.", 503);
    assert(
      contracts &&
        ["collectibles", "market", "rewards"].every(
          (n) => typeof contracts[n] === "string",
        ),
      "Relayer contract allowlist is incomplete.",
      503,
    );
    assert(
      integer(blockTtl) && blockTtl <= 1000 && integer(maxJobsPerDay),
      "Invalid relayer limits.",
      503,
    );
    this.db = db;
    this.provider = provider;
    this.transport = relayerAccount
      ? relayerAccount.sign
        ? relayerAccount
        : relayTransport(relayerAccount)
      : null;
    this.accounts = accounts;
    this.vaults = vaults;
    this.factorySetupDeposit = factorySetupDeposit;
    this.factoryPools = factoryPools;
    this.contracts = {
      ...contracts,
      social: contracts.social || SOCIAL_CONTRACT,
    };
    this.clock = clock;
    this.blockTtl = blockTtl;
    this.maxJobsPerDay = maxJobsPerDay;
    this.maxGas = BigInt(maxGas);
    this.maxBuyDeposit = BigInt(maxBuyDeposit);
    this.customContext = policyContext;
    initializeManagedAccounts(db);
  }
  get enabled() {
    return !!this.transport;
  }
  get relayerId() {
    return this.transport?.accountId || null;
  }
  requireEnabled() {
    assert(
      this.transport,
      "Sponsored transactions are disabled on this host.",
      503,
      "RELAY_DISABLED",
    );
  }
  async finalBlockHeight() {
    try {
      const block = await this.provider.viewBlock({ finality: "final" });
      assert(integer(block?.header?.height), "", 503);
      return block.header.height;
    } catch {
      assert(
        false,
        "NEAR testnet is unavailable. Try again shortly.",
        503,
        "RPC_UNAVAILABLE",
      );
    }
  }
  async chainNonce(accountId, publicKey) {
    const key = await this.accounts.accessKey(accountId, publicKey);
    assert(
      key,
      "The signing key is not registered on your account.",
      403,
      "RELAY_KEY",
    );
    return BigInt(key.nonce);
  }
  pendingNonce(accountId, publicKey) {
    let max = 0n;
    for (const row of this.db
      .prepare(
        `SELECT call FROM relay_jobs WHERE account_id=? AND kind='relay' AND state IN ${OPEN}`,
      )
      .all(accountId)) {
      const call = JSON.parse(row.call);
      if (call.publicKey === publicKey && BigInt(call.nonce) > max)
        max = BigInt(call.nonce);
    }
    return max;
  }
  async nextNonce(accountId, publicKey) {
    const chain = await this.chainNonce(accountId, publicKey),
      pending = this.pendingNonce(accountId, publicKey);
    return chain > pending ? chain : pending;
  }
  budget(accountId) {
    const day = dayKey(this.clock(), "UTC"),
      row = this.db
        .prepare(
          "SELECT jobs,topup_yocto FROM relay_budget WHERE account_id=? AND day=?",
        )
        .get(accountId, day);
    return {
      day,
      jobs: row?.jobs ?? 0,
      topupYocto: row?.topup_yocto ?? "0",
      maxJobsPerDay: this.maxJobsPerDay,
    };
  }
  async context(playerId, accountId, publicKey) {
    const row = this.accounts.owned(playerId, accountId);
    assert(
      row.state === "ready",
      "Your managed account is not ready yet.",
      409,
      "ACCOUNT_NOT_READY",
    );
    const keys = this.accounts.keys(accountId);
    const key = publicKey ?? keys[0];
    assert(
      keys.includes(key),
      "The signing key is not an active key of this account.",
      403,
      "RELAY_KEY",
    );
    const [nonce, blockHeight] = await Promise.all([
      this.nextNonce(accountId, key),
      this.finalBlockHeight(),
    ]);
    const base = {
      accountId,
      keys,
      pendingKeys: this.accounts.keys(accountId, ["pending", "removing"]),
      linkedWallets: this.db
        .prepare(
          "SELECT account_id FROM wallet_links WHERE player_id=? AND account_id!=?",
        )
        .all(playerId, accountId)
        .map((w) => w.account_id),
      nonce,
      blockHeight,
      blockTtl: this.blockTtl,
      maxGas: this.maxGas,
      maxBuyDeposit: this.maxBuyDeposit,
      contracts: this.contracts,
      factorySetupDeposit: this.factorySetupDeposit,
      factoryPools: this.factoryPools,
      ownedVaults: this.vaults
        ? (await this.vaults.positions(accountId, true))
            .filter((p) => p.beneficiary === accountId && p.state === "ready")
            .map((p) => p.account_id)
        : [],
    };
    return this.customContext
      ? await this.customContext(base, { playerId, publicKey: key })
      : base;
  }
  async prepare(
    playerId,
    { accountId, receiverId, methodName, publicKey } = {},
  ) {
    this.requireEnabled();
    nearAccountId(accountId);
    assert(
      receiverId === undefined ||
        (typeof receiverId === "string" && receiverId.length <= 64),
      "Invalid receiver.",
    );
    assert(
      methodName === undefined ||
        (typeof methodName === "string" && methodName.length <= 64),
      "Invalid method.",
    );
    const ctx = await this.context(playerId, accountId, publicKey);
    const budget = this.budget(accountId);
    return {
      network: "testnet",
      relayer: this.relayerId,
      accountId,
      publicKey: publicKey ?? ctx.keys[0],
      nonce: (ctx.nonce + 1n).toString(),
      blockHeight: ctx.blockHeight,
      maxBlockHeight: String(ctx.blockHeight + ctx.blockTtl),
      blockTtl: ctx.blockTtl,
      maxGas: this.maxGas.toString(),
      maxBuyDeposit: this.maxBuyDeposit.toString(),
      receiverId: receiverId ?? null,
      methodName: methodName ?? null,
      contracts: this.contracts,
      budget,
      remainingJobs: Math.max(0, this.maxJobsPerDay - budget.jobs),
    };
  }
  async submit(playerId, { signedDelegateBase64, preview } = {}) {
    this.requireEnabled();
    const decoded = decodeSignedDelegate(signedDelegateBase64);
    if (!verifySignedDelegate(decoded))
      throw new RelayPolicyError(
        "RELAY_SIGNATURE",
        "The signed delegate signature is invalid.",
        400,
      );
    const senderId = decoded.delegateAction.senderId;
    assert(
      typeof senderId === "string",
      "Invalid delegate sender.",
      400,
      "RELAY_SHAPE",
    );
    // A failed job does not pin its hash: the chain nonce and the policy decide whether
    // the identical signed action may be relayed again (e.g. after RELAY_BLOCKED).
    const existing = this.db
      .prepare(
        "SELECT * FROM relay_jobs WHERE delegate_hash=? AND state!='failed'",
      )
      .get(decoded.delegateHash);
    if (existing) {
      assert(
        existing.player_id === playerId,
        "This action was submitted by another explorer.",
        403,
        "RELAY_FORBIDDEN",
      );
      return { ...jobView(existing), duplicate: true };
    }
    const ctx = await this.context(playerId, senderId, decoded.publicKey);
    const call = validateDelegate(decoded, ctx);
    if (preview !== undefined) {
      assert(
        preview &&
          typeof preview === "object" &&
          (preview.receiverId === undefined ||
            preview.receiverId === call.receiverId) &&
          (preview.methodName === undefined ||
            preview.methodName === call.methodName) &&
          (preview.deposit === undefined ||
            String(preview.deposit) === call.deposit),
        "The signed action differs from the reviewed preview.",
        409,
        "RELAY_PREVIEW_MISMATCH",
      );
    }
    const now = this.clock(),
      day = dayKey(now, "UTC"),
      jobId = id("relay");
    const row = atomic(this.db, () => {
      const again = this.db
        .prepare(
          "SELECT * FROM relay_jobs WHERE delegate_hash=? AND state!='failed'",
        )
        .get(decoded.delegateHash);
      if (again) {
        assert(
          again.player_id === playerId,
          "This action was submitted by another explorer.",
          403,
          "RELAY_FORBIDDEN",
        );
        return again;
      }
      const used =
        this.db
          .prepare("SELECT jobs FROM relay_budget WHERE account_id=? AND day=?")
          .get(senderId, day)?.jobs ?? 0;
      assert(
        used < this.maxJobsPerDay,
        "Today's sponsored actions for this account are used up.",
        429,
        "RELAY_BUDGET",
      );
      this.db
        .prepare(
          "INSERT INTO relay_budget(account_id,day,jobs) VALUES(?,?,1) ON CONFLICT(account_id,day) DO UPDATE SET jobs=jobs+1",
        )
        .run(senderId, day);
      this.db
        .prepare(
          "INSERT INTO relay_jobs(id,player_id,account_id,kind,state,delegate_hash,delegate,call,receiver_id,method_name,run_after,created_at,updated_at) VALUES(?,?,?,'relay','queued',?,?,?,?,?,?,?,?)",
        )
        .run(
          jobId,
          playerId,
          senderId,
          decoded.delegateHash,
          signedDelegateBase64,
          JSON.stringify(call),
          call.receiverId,
          call.methodName ?? call.kind,
          now,
          now,
          now,
        );
      return this.db.prepare("SELECT * FROM relay_jobs WHERE id=?").get(jobId);
    });
    return { ...jobView(row), duplicate: row.id !== jobId };
  }
  status(playerId, jobId) {
    assert(
      typeof jobId === "string" && jobId.length <= 80,
      "Invalid relay reference.",
    );
    const row = this.db
      .prepare("SELECT * FROM relay_jobs WHERE id=?")
      .get(jobId);
    assert(
      row && row.player_id === playerId,
      "Relay job not found.",
      404,
      "RELAY_NOT_FOUND",
    );
    return jobView(row);
  }
  list(playerId, accountId) {
    const rows = accountId
      ? this.db
          .prepare(
            "SELECT * FROM relay_jobs WHERE player_id=? AND account_id=? ORDER BY seq DESC LIMIT 50",
          )
          .all(playerId, nearAccountId(accountId))
      : this.db
          .prepare(
            "SELECT * FROM relay_jobs WHERE player_id=? ORDER BY seq DESC LIMIT 50",
          )
          .all(playerId);
    return { jobs: rows.map(jobView) };
  }
  workerStatus() {
    const lease = this.db
      .prepare("SELECT * FROM relay_worker_lease WHERE id=1")
      .get();
    const counts = Object.fromEntries(
      this.db
        .prepare("SELECT state,COUNT(*) AS n FROM relay_jobs GROUP BY state")
        .all()
        .map((r) => [r.state, r.n]),
    );
    return {
      enabled: this.enabled,
      relayer: this.relayerId,
      lease: {
        owner: lease?.owner ?? null,
        untilMs: lease?.until_ms ?? 0,
        lastSuccess: lease?.last_success ?? null,
        lastError: lease?.last_error ?? null,
      },
      jobs: counts,
    };
  }
  // One pass over due jobs. The lease fences every durable write so a stalled
  // process that wakes late can never overwrite a successor's result.
  async runRelayJobs({ maxJobs = 8 } = {}) {
    const db = this.db,
      owner = id("relay-lease"),
      now = this.clock();
    const acquired = atomic(
      db,
      () =>
        db
          .prepare(
            "UPDATE relay_worker_lease SET owner=?,until_ms=? WHERE id=1 AND until_ms<=?",
          )
          .run(owner, now + LEASE_MS, now).changes === 1,
    );
    if (!acquired) return { busy: true };
    const renew = () => {
      assert(
        db
          .prepare(
            "UPDATE relay_worker_lease SET until_ms=? WHERE id=1 AND owner=? AND until_ms>?",
          )
          .run(this.clock() + LEASE_MS, owner, this.clock()).changes === 1,
        "Relay worker lease expired.",
        503,
      );
    };
    const write = (work) =>
      atomic(db, () => {
        renew();
        return work();
      });
    const run = (sql, ...parameters) =>
      write(() => db.prepare(sql).run(...parameters));
    let completed = 0,
      failed = 0,
      retried = 0,
      firstError = null;
    try {
      for (let n = 0; n < maxJobs; n++) {
        const job = db
          .prepare(
            `SELECT * FROM relay_jobs j WHERE state IN ${OPEN} AND run_after<=? AND seq=(SELECT MIN(seq) FROM relay_jobs WHERE account_id=j.account_id AND state IN ${OPEN}) ORDER BY seq LIMIT 1 OFFSET ?`,
          )
          .get(this.clock(), 0);
        if (!job) break;
        renew();
        try {
          const result =
            job.kind === "create-account"
              ? await this.finalizeAccount(job, { renew, write })
              : await this.relay(job, { renew, write });
          run(
            "UPDATE relay_jobs SET state='confirmed',result=?,transaction_hash=COALESCE(?,transaction_hash),confirmed_at=?,updated_at=?,error_code=NULL,last_error=NULL WHERE id=?",
            JSON.stringify(result ?? {}),
            result?.transactionHash ?? null,
            this.clock(),
            this.clock(),
            job.id,
          );
          completed++;
        } catch (error) {
          if (error.message === "Relay worker lease expired.") throw error;
          const verdict =
            error instanceof RelayJobError
              ? error
              : classifyFailure(error, JSON.parse(job.call));
          if (verdict.terminal) {
            write(() => {
              db.prepare(
                "UPDATE relay_jobs SET state='failed',attempts=attempts+1,error_code=?,last_error=?,updated_at=? WHERE id=?",
              ).run(
                verdict.code,
                String(verdict.message).slice(0, 200),
                this.clock(),
                job.id,
              );
              // Later actions of this account were signed with following nonces; they
              // cannot execute anymore and would only consume the player's day budget.
              db.prepare(
                `UPDATE relay_jobs SET state='failed',error_code='RELAY_BLOCKED',last_error=?,updated_at=? WHERE account_id=? AND kind='relay' AND state IN ${OPEN} AND seq>?`,
              ).run(
                "An earlier action of this account failed. Prepare this action again.",
                this.clock(),
                job.account_id,
                job.seq,
              );
              if (job.kind === "create-account")
                this.accounts.markFailed(job.account_id, verdict, {
                  write: (work) => work(),
                });
            });
            failed++;
          } else {
            run(
              "UPDATE relay_jobs SET state='retrying',attempts=attempts+1,run_after=?,error_code=?,last_error=?,updated_at=? WHERE id=?",
              this.clock() + backoff(job.attempts),
              verdict.code,
              String(verdict.message).slice(0, 200),
              this.clock(),
              job.id,
            );
            retried++;
            firstError ||= verdict;
          }
        }
      }
      run(
        "UPDATE relay_worker_lease SET last_success=?,last_error=? WHERE id=1 AND owner=?",
        this.clock(),
        firstError ? String(firstError.message).slice(0, 200) : null,
        owner,
      );
      return { completed, failed, retried };
    } catch (error) {
      db.prepare(
        "UPDATE relay_worker_lease SET last_error=? WHERE id=1 AND owner=?",
      ).run(String(error.message).slice(0, 200), owner);
      throw error;
    } finally {
      db.prepare(
        "UPDATE relay_worker_lease SET until_ms=0,owner=NULL WHERE id=1 AND owner=?",
      ).run(owner);
    }
  }
  async finalizeAccount(job, { write }) {
    return this.accounts.finalize(job, { write });
  }
  async relay(job, { renew, write }) {
    this.requireEnabled();
    const call = JSON.parse(job.call),
      decoded = decodeSignedDelegate(job.delegate);
    let outcome = null;
    if (job.transaction_hash) {
      try {
        outcome = await this.transport.status(job.transaction_hash);
      } catch (error) {
        if (!missing(error))
          throw retryLater("RELAY_NETWORK", rpcErrorText(error).slice(0, 160));
      }
      renew();
    }
    if (!outcome) {
      if (call.sponsorDeposit && BigInt(call.deposit) > 0n) {
        await this.accounts.ensureFunded(
          call.senderId,
          BigInt(call.deposit) + STATE_MARGIN,
          { jobId: job.id, write },
        );
        renew();
      }
      const signed = await this.transport.sign({
        receiverId: call.senderId,
        actions: [actions.signedDelegate(decoded.signedDelegate)],
      });
      write(() =>
        this.db
          .prepare(
            "UPDATE relay_jobs SET state='sent',transaction_hash=?,updated_at=? WHERE id=?",
          )
          .run(signed.hash, this.clock(), job.id),
      );
      try {
        outcome = await signed.send("FINAL");
      } catch (error) {
        if (
          error?.name === "InvalidNonceError" ||
          /InvalidNonce/.test(rpcErrorText(error))
        )
          write(() =>
            this.db
              .prepare("UPDATE relay_jobs SET transaction_hash=NULL WHERE id=?")
              .run(job.id),
          );
        throw retryLater("RELAY_NETWORK", rpcErrorText(error).slice(0, 160));
      }
      renew();
    }
    const failure = relayFailure(outcome);
    if (failure) {
      const verdict = classifyFailure(failure, call);
      if (verdict.topup && job.attempts === 0) {
        // The delegate nonce may already be consumed; one funded retry proves it either way.
        await this.accounts.ensureFunded(
          call.senderId,
          BigInt(call.deposit) + STATE_MARGIN,
          { jobId: job.id, write },
        );
        write(() =>
          this.db
            .prepare("UPDATE relay_jobs SET transaction_hash=NULL WHERE id=?")
            .run(job.id),
        );
        throw retryLater(
          "RELAY_INSUFFICIENT_BALANCE",
          "The account was topped up; retrying the signed action.",
        );
      }
      throw verdict;
    }
    const result = verifyRelayOutcome(outcome, {
      relayerId: this.relayerId,
      call,
    });
    if (call.kind === "addKey" || call.kind === "deleteKey")
      write(() =>
        this.db
          .prepare(
            "UPDATE managed_account_keys SET state=?,updated_at=? WHERE account_id=? AND public_key=?",
          )
          .run(
            call.kind === "addKey" ? "active" : "removed",
            this.clock(),
            call.senderId,
            call.args.publicKey,
          ),
      );
    return {
      ...result,
      methodName: call.methodName,
      receiverId: call.receiverId,
    };
  }
}
export function startRelayWorker(relayer, { intervalMs = 15000 } = {}) {
  let stopped = false,
    running = null,
    timer;
  async function tick() {
    if (stopped || running) return;
    running = (async () => {
      try {
        await relayer.runRelayJobs();
      } catch (error) {
        console.error("Relay worker:", String(error.message).slice(0, 200));
      }
    })();
    await running;
    running = null;
  }
  timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

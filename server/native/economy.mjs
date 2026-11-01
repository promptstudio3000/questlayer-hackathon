import { assert } from "../domain.mjs";
import { assertTestnetRpc, nearAccountId } from "../identity/near.mjs";
import { nativeInteger } from "./staking-pool.mjs";
import { VAULT_POOLS } from "./vaults.mjs";
import { NETWORK } from "./network.mjs";

const POOL_HASH = "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY";
const MAX_POSITIONS = 33;
const MAX_QUEUE = 10000;
const amount = (value) => nativeInteger(value).toString();
const sum = (values) =>
  values.reduce((total, value) => total + BigInt(value), 0n).toString();
const iso = (value) => new Date(value).toISOString();

async function mapLimit(rows, limit, work) {
  const results = new Array(rows.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, rows.length) }, async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        try {
          results[index] = { ok: true, value: await work(rows[index]) };
        } catch {
          results[index] = { ok: false };
        }
      }
    }),
  );
  return results;
}

function exitPhase(state, pool) {
  if (BigInt(state.owner_pending) > 0n) return "owner_transfer_pending";
  if (BigInt(state.owner_credit) > 0n) return "owner_withdrawable";
  if (state.stage === "awaiting_cash") return "awaiting_pool_cash";
  if (state.stage === "unlocking") {
    if (BigInt(state.epoch) < BigInt(state.unlock_epoch))
      return "unlocking_epochs";
    return pool?.canWithdraw
      ? "pool_withdrawal_ready"
      : "awaiting_pool_release";
  }
  if (state.exit_requested && state.stage === "idle" && state.principal === "0")
    return "settled";
  if (state.exit_requested)
    return state.stage === "idle" ? "exit_queued" : "operation_pending";
  return state.stage === "idle" ? "active" : "operation_pending";
}

function stateTotals(rows) {
  return {
    principal: sum(rows.map(({ state }) => state.principal)),
    weightedStake: sum(rows.map(({ state }) => state.weighted_stake)),
    ownerCredit: sum(rows.map(({ state }) => state.owner_credit)),
    ownerPending: sum(rows.map(({ state }) => state.owner_pending)),
    ownerPaid: sum(rows.map(({ state }) => state.owner_paid)),
    gameCredit: sum(rows.map(({ state }) => state.game_credit)),
    gamePending: sum(rows.map(({ state }) => state.game_pending)),
    realizedGameYieldPaid: sum(rows.map(({ state }) => state.game_paid)),
  };
}

// Public read model only. It has no signer, transaction sender or player identity input.
export class NativeEconomy {
  constructor(
    native,
    {
      clock = Date.now,
      cacheMs = 30000,
      timeoutMs = 8000,
      refreshTimeoutMs = 20000,
    } = {},
  ) {
    this.native = native;
    this.provider = native.provider;
    this.config = native.config;
    this.clock = clock;
    this.cacheMs = cacheMs;
    this.timeoutMs = timeoutMs;
    this.refreshTimeoutMs = refreshTimeoutMs;
    this.deadline = 0;
    this.cached = null;
    this.pending = null;
    this.lastObserved = new Map();
  }

  async bounded(task, timeout = this.timeoutMs) {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Observation timed out")),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async query(block, accountId, request) {
    nearAccountId(accountId);
    const remaining = this.deadline - Date.now();
    assert(remaining > 0, "Observation budget exhausted.");
    const value = await this.bounded(
      this.provider.query({
        ...request,
        account_id: accountId,
        block_id: block.header.hash,
      }),
      Math.min(remaining, this.timeoutMs),
    );
    assert(
      value.block_hash === block.header.hash &&
        value.block_height === block.header.height,
      "Observation anchor mismatch.",
    );
    return value;
  }

  async view(block, accountId, method, args = {}) {
    const result = await this.query(block, accountId, {
      request_type: "call_function",
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    assert(
      Array.isArray(result.result) && result.result.length <= 100000,
      "Observation exceeds its bound.",
    );
    return JSON.parse(Buffer.from(result.result).toString());
  }

  async verifyCode(block, accountId, codeHash, keyless = false) {
    const account = await this.query(block, accountId, {
      request_type: "view_account",
    });
    assert(
      typeof codeHash === "string" && account.code_hash === codeHash,
      "Code fingerprint mismatch.",
    );
    if (keyless) {
      const keys = await this.query(block, accountId, {
        request_type: "view_access_key_list",
      });
      assert(
        Array.isArray(keys.keys) && keys.keys.length === 0,
        "Keyless ownership changed.",
      );
    }
  }

  async observe(name, block, work) {
    try {
      assert(block, "No finalized anchor.");
      const data = await work();
      const result = {
        status: "observed",
        observedAt: iso(this.clock()),
        blockHeight: block.header.height,
        blockHash: block.header.hash,
        data,
      };
      this.lastObserved.set(name, result);
      return result;
    } catch {
      const old = this.lastObserved.get(name);
      return old
        ? {
            ...old,
            status: "stale",
            reason:
              "Refresh unavailable; this is the last verified observation.",
          }
        : {
            status: "unavailable",
            observedAt: null,
            data: null,
            reason: "A verified observation is unavailable.",
          };
    }
  }

  async treasury(block) {
    await this.verifyCode(block, this.config.contractId, this.config.codeHash);
    const t = await this.view(block, this.config.contractId, "get_treasury");
    assert(t.policy === "50/50-v1", "Unknown treasury policy.");
    const buckets = Object.fromEntries(
      ["coins", "zones"].map((name) => [
        name,
        {
          available: amount(t[name].available),
          reserved: amount(t[name].reserved),
          awarded: amount(t[name].awarded),
        },
      ]),
    );
    const funded = amount(t.funded),
      owed = amount(t.owed),
      pending = amount(t.pending),
      withdrawn = amount(t.withdrawn);
    const available = sum(Object.values(buckets).map((b) => b.available));
    const reserved = sum(Object.values(buckets).map((b) => b.reserved));
    assert(
      sum([available, reserved, owed, pending, withdrawn]) === funded,
      "Treasury conservation failed.",
    );
    return {
      policy: t.policy,
      buckets,
      funded,
      available,
      reserved,
      owed,
      pending,
      withdrawn,
      rewardLiabilities: sum([available, reserved, owed, pending]),
      reconciled: true,
      fundingLabel:
        "Confirmed reward funding; sponsors and realized yield are distinct sources.",
      excludes: [
        "player principal",
        "operating top-ups",
        "receipt storage fees",
      ],
    };
  }

  async positions(block) {
    const legacy = this.config.vaults || [];
    assert(
      Array.isArray(legacy) && legacy.length <= 1,
      "Unexpected legacy registry size.",
    );
    const list = legacy.map((p) => ({ ...p, keyless: false }));
    let pendingCreationCount = 0;
    if (this.config.factory) {
      const f = this.config.factory;
      await this.verifyCode(block, f.contractId, f.codeHash);
      const cfg = await this.view(block, f.contractId, "get_config");
      assert(
        cfg.rewards === this.config.contractId &&
          cfg.vault_sha256 === f.vaultWasmSha256,
        "Factory binding changed.",
      );
      const positions = await this.view(block, f.contractId, "get_positions", {
        beneficiary: null,
      });
      assert(
        Array.isArray(positions) && positions.length <= 32,
        "Position registry exceeds its limit.",
      );
      for (const p of positions) {
        if (p.state !== "ready") {
          pendingCreationCount++;
          continue;
        }
        list.push({
          accountId: p.account_id,
          beneficiary: p.beneficiary,
          pool: p.pool,
          codeHash: f.vaultCodeHash,
          keyless: true,
        });
      }
    }
    assert(
      list.length <= MAX_POSITIONS &&
        new Set(list.map((p) => p.accountId)).size === list.length,
      "Invalid position registry.",
    );
    return { list, pendingCreationCount };
  }

  async position(block, p, pools) {
    await this.verifyCode(block, p.accountId, p.codeHash, p.keyless);
    const state = await this.view(block, p.accountId, "get_state");
    assert(
      state.network === NETWORK &&
        state.beneficiary === p.beneficiary &&
        state.pool === p.pool &&
        state.rewards === this.config.contractId,
      "Vault binding changed.",
    );
    assert(
      Number.isInteger(state.contribution_bps) &&
        state.contribution_bps >= 0 &&
        state.contribution_bps <= 10000 &&
        typeof state.exit_requested === "boolean",
      "Invalid contribution.",
    );
    for (const field of [
      "principal",
      "high_water_basis",
      "staked",
      "unstaked",
      "pending_pool_cash",
      "weighted_stake",
      "owner_credit",
      "owner_pending",
      "owner_paid",
      "game_credit",
      "game_pending",
      "game_paid",
      "epoch",
      "observed_epoch",
      "unlock_epoch",
    ])
      state[field] = amount(state[field]);
    const cachedPoolObservationStale =
      BigInt(state.observed_epoch) + 1n < BigInt(state.epoch);
    assert(
      !(state.exit_requested || cachedPoolObservationStale) ||
        state.weighted_stake === "0",
      "Ineligible position reports tier stake.",
    );
    let pool = null;
    try {
      assert(pools.get(p.pool)?.ok, "Pool verification unavailable.");
      const r = await this.view(block, p.pool, "get_account", {
        account_id: p.accountId,
      });
      assert(
        r.account_id === p.accountId && typeof r.can_withdraw === "boolean",
        "Pool returned another account.",
      );
      pool = {
        staked: amount(r.staked_balance),
        unstaked: amount(r.unstaked_balance),
        canWithdraw: r.can_withdraw,
      };
    } catch {
      /* An unavailable pool observation is never a zero balance. */
    }
    return {
      state,
      pool,
      beneficiary: p.beneficiary,
      cachedPoolObservationStale,
      phase: exitPhase(state, pool),
    };
  }

  async staking(block) {
    const { list, pendingCreationCount } = await this.positions(block);
    const poolIds = [...new Set(list.map((p) => p.pool))];
    const checks = await mapLimit(poolIds, 3, async (pool) => {
      assert(
        VAULT_POOLS.some((p) => p.id === pool),
        "Unknown pool.",
      );
      await this.verifyCode(block, pool, POOL_HASH, true);
      const fee = await this.view(block, pool, "get_reward_fee_fraction");
      assert(
        Number.isSafeInteger(fee.numerator) &&
          Number.isSafeInteger(fee.denominator) &&
          fee.numerator >= 0 &&
          fee.denominator > 0 &&
          fee.numerator <= fee.denominator,
        "Invalid validator fee.",
      );
      return fee;
    });
    const pools = new Map(poolIds.map((id, i) => [id, checks[i]]));
    const results = await mapLimit(list, 4, (p) =>
      this.position(block, p, pools),
    );
    const rows = results.filter((r) => r.ok).map((r) => r.value);
    const complete = rows.length === list.length;
    const poolComplete = complete && rows.every((r) => r.pool);
    const observed = stateTotals(rows);
    const phases = {};
    for (const row of rows) phases[row.phase] = (phases[row.phase] || 0) + 1;
    const active = rows.filter(
      (r) => !r.state.exit_requested && BigInt(r.state.principal) > 0n,
    );
    return {
      complete,
      poolComplete,
      coverage: {
        registeredPositions: list.length,
        observedPositions: rows.length,
        unavailablePositions: list.length - rows.length,
        observedPoolPositions: rows.filter((r) => r.pool).length,
        staleVaultPoolObservations: rows.filter(
          (r) => r.cachedPoolObservationStale,
        ).length,
        pendingCreationCount,
      },
      totals: complete ? observed : null,
      observedSubtotals: observed,
      stakers: complete ? new Set(active.map((r) => r.beneficiary)).size : null,
      contributingStakers: complete
        ? new Set(
            active
              .filter((r) => r.state.contribution_bps > 0)
              .map((r) => r.beneficiary),
          ).size
        : null,
      poolBalances: poolComplete
        ? {
            staked: sum(rows.map((r) => r.pool.staked)),
            unstaked: sum(rows.map((r) => r.pool.unstaked)),
          }
        : null,
      phases,
      pools: poolIds.map((id) => {
        const registered = list.filter((p) => p.pool === id).length;
        const observed = rows.filter((r) => r.state.pool === id && r.pool);
        const ready = observed.length === registered && pools.get(id)?.ok;
        return {
          id,
          name:
            VAULT_POOLS.find((p) => p.id === id)?.name || "Unknown validator",
          status: ready ? "observed" : "unavailable",
          registeredPositions: registered,
          observedPositions: observed.length,
          staked: ready ? sum(observed.map((r) => r.pool.staked)) : null,
          unstaked: ready ? sum(observed.map((r) => r.pool.unstaked)) : null,
          rewardFee: pools.get(id)?.ok ? pools.get(id).value : null,
        };
      }),
      unlocks: rows
        .filter((r) => r.state.stage === "unlocking")
        .map((r) => ({
          currentEpoch: r.state.epoch,
          unlockEpoch: r.state.unlock_epoch,
          canWithdraw: r.pool?.canWithdraw ?? null,
          phase: r.phase,
        })),
      tierPolicy: "conservative-mature-principal-v1",
      contributionPolicy: "fixed-per-vault",
      apy: null,
      outlook: {
        day: null,
        week: null,
        month: null,
        quarter: null,
        year: null,
        reason:
          "No attributable realized-yield history supports a forecast yet.",
      },
    };
  }

  worker() {
    try {
      const now = this.clock(),
        db = this.native.db;
      const lease = db
        .prepare(
          "SELECT until_ms,last_success,last_error FROM native_worker_lease WHERE id=1",
        )
        .get();
      const pending = db
        .prepare(
          "SELECT attempts,run_after,created_at FROM native_reward_claims WHERE state!='confirmed' ORDER BY seq LIMIT ?",
        )
        .all(MAX_QUEUE + 1);
      const jobs = db
        .prepare(
          "SELECT next_check,last_error FROM native_vault_jobs ORDER BY account_id LIMIT ?",
        )
        .all(MAX_POSITIONS + 1);
      const rows = pending.slice(0, MAX_QUEUE),
        success = lease?.last_success ?? null;
      return {
        status: !lease
          ? "unavailable"
          : lease.last_error
            ? "attention"
            : success === null
              ? "not_started"
              : now - success > 120000
                ? "stale"
                : "observed",
        lastSuccessAt: success === null ? null : iso(success),
        ageMs: success === null ? null : Math.max(0, now - success),
        running: !!lease && lease.until_ms > now,
        needsAttention: !!lease?.last_error,
        queued: rows.length,
        queueCountCapped: pending.length > MAX_QUEUE,
        retrying: rows.filter((r) => r.attempts > 0).length,
        ready: rows.filter((r) => r.run_after <= now).length,
        oldestQueuedAgeMs: rows.length
          ? Math.max(0, now - Math.min(...rows.map((r) => r.created_at)))
          : null,
        vaultsDue: jobs
          .slice(0, MAX_POSITIONS)
          .filter((r) => r.next_check <= now).length,
        vaultsWithErrors: jobs
          .slice(0, MAX_POSITIONS)
          .filter((r) => r.last_error).length,
        vaultCountCapped: jobs.length > MAX_POSITIONS,
      };
    } catch {
      return {
        status: "unavailable",
        queued: null,
        reason: "Worker observation unavailable.",
      };
    }
  }

  async refresh() {
    this.deadline = Date.now() + this.refreshTimeoutMs;
    let block = null;
    try {
      await this.bounded(assertTestnetRpc(this.provider));
      block = await this.bounded(
        this.provider.viewBlock({ finality: "final" }),
      );
      assert(
        block?.header?.hash && Number.isSafeInteger(block.header.height),
        "No finalized anchor.",
      );
    } catch {
      block = null;
    }
    const [treasury, staking] = await Promise.all([
      this.observe("treasury", block, () => this.treasury(block)),
      this.observe("staking", block, () => this.staking(block)),
    ]);
    if (
      staking.status === "observed" &&
      (!staking.data.complete || !staking.data.poolComplete)
    )
      staking.status = "partial";
    const status =
      treasury.status === "observed" && staking.status === "observed"
        ? "observed"
        : treasury.status === "unavailable" && staking.status === "unavailable"
          ? "unavailable"
          : [treasury.status, staking.status].includes("observed") ||
              staking.status === "partial"
            ? "partial"
            : "stale";
    return {
      version: 1,
      network: NETWORK,
      unit: "yoctoNEAR",
      goldPerNear: 1000,
      generatedAt: iso(this.clock()),
      status,
      treasury,
      staking,
      worker: this.worker(),
    };
  }

  async snapshot() {
    if (this.cached && this.cached.until > this.clock())
      return { ...this.cached.value, worker: this.worker() };
    if (this.pending) return this.pending;
    this.pending = this.refresh();
    try {
      const value = await this.pending;
      this.cached = { until: this.clock() + this.cacheMs, value };
      return value;
    } finally {
      this.pending = null;
    }
  }
}

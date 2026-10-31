import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { NativeRewards } from "../server/native/rewards.mjs";
import { NativeEconomy } from "../server/native/economy.mjs";

const NOW = Date.parse("2026-10-31T14:00:00Z");
const POOL = "aurora.pool.f863973.m0";
const UNIT = 10n ** 24n;
function fixture() {
  const db = openDatabase(":memory:");
  const config = {
    contractId: "rewards.testnet",
    codeHash: "rewards-code",
    factory: {
      contractId: "factory.testnet",
      codeHash: "factory-code",
      vaultCodeHash: "vault-code",
      vaultWasmSha256: "vault-digest",
    },
    vaults: [],
  };
  const f = {
    db,
    now: NOW,
    calls: [],
    fail: null,
    mismatch: false,
    network: "testnet",
    positions: [
      {
        account_id: "v0.factory.testnet",
        beneficiary: "private-player.testnet",
        pool: POOL,
        state: "ready",
      },
    ],
    state: {
      network: "testnet",
      beneficiary: "private-player.testnet",
      pool: POOL,
      rewards: config.contractId,
      contribution_bps: 5000,
      stage: "idle",
      operation: "",
      exit_requested: false,
      principal: String(101n * UNIT + 7n),
      high_water_basis: String(101n * UNIT + 7n),
      staked: String(101n * UNIT),
      unstaked: "7",
      pending_pool_cash: "0",
      weighted_stake: String(50n * UNIT + UNIT / 2n),
      owner_credit: "0",
      owner_pending: "0",
      owner_paid: "0",
      game_credit: "0",
      game_pending: "0",
      game_paid: "0",
      epoch: "102",
      observed_epoch: "102",
      unlock_epoch: "0",
    },
    pool: {
      account_id: "v0.factory.testnet",
      staked_balance: String(101n * UNIT + 8n),
      unstaked_balance: "3",
      can_withdraw: true,
    },
    treasury: {
      policy: "50/50-v1",
      funded: "200",
      coins: { available: "70", reserved: "20", awarded: "10" },
      zones: { available: "60", reserved: "30", awarded: "10" },
      owed: "10",
      pending: "3",
      withdrawn: "7",
    },
  };
  const provider = {
    viewNodeStatus: async () => ({ chain_id: f.network }),
    viewBlock: async () => ({
      header: { hash: "finalized-hash", height: 12345 },
    }),
    query: async (q) => {
      f.calls.push(q);
      if (f.fail?.(q)) throw new Error("private internal error key=hidden");
      const result = {
        block_hash: f.mismatch ? "wrong" : "finalized-hash",
        block_height: 12345,
      };
      if (q.request_type === "view_account")
        return {
          ...result,
          code_hash:
            q.account_id === POOL
              ? "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY"
              : q.account_id === "factory.testnet"
                ? "factory-code"
                : q.account_id === "rewards.testnet"
                  ? "rewards-code"
                  : "vault-code",
        };
      if (q.request_type === "view_access_key_list")
        return { ...result, keys: [] };
      const values = {
        get_treasury: f.treasury,
        get_config: {
          rewards: config.contractId,
          vault_sha256: "vault-digest",
        },
        get_positions: f.positions,
        get_reward_fee_fraction: { numerator: 5, denominator: 100 },
        get_state: f.state,
        get_account: f.pool,
      };
      assert.ok(q.method_name in values, q.method_name);
      return {
        ...result,
        result: [...Buffer.from(JSON.stringify(values[q.method_name]))],
      };
    },
  };
  f.native = new NativeRewards(db, provider, config, null, {
    clock: () => f.now,
  });
  f.economy = new NativeEconomy(f.native, { clock: () => f.now, cacheMs: 10 });
  return f;
}

test("economy preserves yocto precision, treasury conservation and independently observed pool balances", async () => {
  const f = fixture();
  try {
    const r = await f.economy.snapshot();
    assert.equal(r.status, "observed");
    assert.equal(r.treasury.data.available, "130");
    assert.equal(r.treasury.data.reserved, "50");
    assert.equal(r.treasury.data.rewardLiabilities, "193");
    assert.equal(r.staking.data.totals.principal, String(101n * UNIT + 7n));
    assert.equal(r.staking.data.poolBalances.staked, String(101n * UNIT + 8n));
    assert.equal(r.staking.data.totals.realizedGameYieldPaid, "0");
    assert.equal(r.staking.data.stakers, 1);
    assert.equal(r.staking.data.contributingStakers, 1);
    assert.equal(r.staking.data.apy, null);
    assert.equal(r.staking.data.outlook.year, null);
    assert.ok(
      f.calls.every((q) => q.block_id === "finalized-hash" && !q.finality),
    );
  } finally {
    f.db.close();
  }
});

test("a failed pool read is missing balance, never zero or the vault's cached balance", async () => {
  const f = fixture();
  f.fail = (q) => q.method_name === "get_account";
  try {
    const r = await f.economy.snapshot();
    assert.equal(r.status, "partial");
    assert.equal(r.staking.data.poolBalances, null);
    assert.equal(r.staking.data.pools[0].staked, null);
    assert.equal(r.staking.data.coverage.observedPoolPositions, 0);
    assert.equal(r.staking.data.totals.principal, f.state.principal);
  } finally {
    f.db.close();
  }
});

test("a failed position read cannot become an aggregate zero or omit a known position", async () => {
  const f = fixture();
  f.fail = (q) => q.method_name === "get_state";
  try {
    const r = await f.economy.snapshot();
    assert.equal(r.staking.status, "partial");
    assert.equal(r.staking.data.totals, null);
    assert.equal(r.staking.data.stakers, null);
    assert.equal(r.staking.data.coverage.unavailablePositions, 1);
    assert.equal(r.staking.data.coverage.registeredPositions, 1);
  } finally {
    f.db.close();
  }
});

test("RPC outage preserves an explicitly stale observation and its original timestamp", async () => {
  const f = fixture();
  try {
    const good = await f.economy.snapshot();
    f.now += 60000;
    f.fail = () => true;
    const stale = await f.economy.snapshot();
    assert.equal(stale.status, "stale");
    assert.equal(stale.treasury.status, "stale");
    assert.equal(stale.treasury.observedAt, good.treasury.observedAt);
    assert.equal(stale.treasury.data.funded, "200");
    assert.notEqual(stale.generatedAt, good.generatedAt);
  } finally {
    f.db.close();
  }
});

test("first failed observation reports unavailable without fabricated amounts", async () => {
  const f = fixture();
  f.fail = () => true;
  try {
    const r = await f.economy.snapshot();
    assert.equal(r.status, "unavailable");
    assert.equal(r.staking.data, null);
    assert.equal(r.treasury.data, null);
    assert.doesNotMatch(JSON.stringify(r), /hidden|private-player/);
  } finally {
    f.db.close();
  }
});

test("treasury rejects broken conservation instead of silently displaying the balance", async () => {
  const f = fixture();
  f.treasury.funded = "201";
  try {
    const r = await f.economy.snapshot();
    assert.equal(r.treasury.status, "unavailable");
    assert.equal(r.treasury.data, null);
  } finally {
    f.db.close();
  }
});

test("wrong network and mixed finalized blocks fail closed", async () => {
  for (const change of [
    (f) => {
      f.network = "mainnet";
    },
    (f) => {
      f.mismatch = true;
    },
  ]) {
    const f = fixture();
    change(f);
    try {
      assert.equal((await f.economy.snapshot()).status, "unavailable");
    } finally {
      f.db.close();
    }
  }
});

test("stale vault observation is disclosed while a fresh pool view remains separate", async () => {
  const f = fixture();
  f.state.observed_epoch = "99";
  f.state.weighted_stake = "0";
  try {
    const r = await f.economy.snapshot();
    assert.equal(r.staking.data.coverage.staleVaultPoolObservations, 1);
    assert.equal(r.staking.data.totals.weightedStake, "0");
    assert.equal(r.staking.data.poolBalances.staked, f.pool.staked_balance);
  } finally {
    f.db.close();
  }
});

test("exit phases require both epoch maturity and pool release; owner credit is separate", async () => {
  const f = fixture();
  f.state.exit_requested = true;
  f.state.weighted_stake = "0";
  f.state.stage = "unlocking";
  f.state.unlock_epoch = "106";
  try {
    assert.equal(
      (await f.economy.snapshot()).staking.data.phases.unlocking_epochs,
      1,
    );
    f.now += 11;
    f.state.epoch = "106";
    f.pool.can_withdraw = false;
    assert.equal(
      (await f.economy.snapshot()).staking.data.phases.awaiting_pool_release,
      1,
    );
    f.now += 11;
    f.pool.can_withdraw = true;
    assert.equal(
      (await f.economy.snapshot()).staking.data.phases.pool_withdrawal_ready,
      1,
    );
    f.now += 11;
    f.state.stage = "awaiting_cash";
    assert.equal(
      (await f.economy.snapshot()).staking.data.phases.awaiting_pool_cash,
      1,
    );
    f.now += 11;
    f.state.stage = "idle";
    f.state.owner_credit = "101";
    const result = await f.economy.snapshot();
    assert.equal(result.staking.data.phases.owner_withdrawable, 1);
    assert.equal(result.staking.data.stakers, 0);
    assert.equal(result.staking.data.totals.realizedGameYieldPaid, "0");
  } finally {
    f.db.close();
  }
});

test("factory code and keyless checks cannot be bypassed by healthy pool readings", async () => {
  for (const target of ["factory.testnet", "v0.factory.testnet"]) {
    const f = fixture();
    const original = f.native.provider.query;
    f.native.provider.query = async (q) => {
      const r = await original(q);
      if (q.account_id === target && q.request_type === "view_account")
        r.code_hash = "changed";
      return r;
    };
    try {
      const r = await f.economy.snapshot();
      assert.ok(!r.staking.data || r.staking.data.totals === null);
    } finally {
      f.db.close();
    }
  }
  const f = fixture();
  const original = f.native.provider.query;
  f.native.provider.query = async (q) => ({
    ...(await original(q)),
    ...(q.account_id === "v0.factory.testnet" &&
    q.request_type === "view_access_key_list"
      ? { keys: [{}] }
      : {}),
  });
  try {
    assert.equal((await f.economy.snapshot()).staking.data.totals, null);
  } finally {
    f.db.close();
  }
});

test("worker reports age and attention without exposing account, errors or private evidence", async () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "UPDATE native_worker_lease SET last_success=?,last_error=?,until_ms=? WHERE id=1",
      )
      .run(NOW - 300000, "key=private-error", NOW + 1000);
    f.db
      .prepare(
        "INSERT INTO native_vault_jobs(account_id,next_check,last_error) VALUES(?,?,?)",
      )
      .run("secret-vault.testnet", NOW - 1, "private-path");
    const r = await f.economy.snapshot();
    assert.equal(r.worker.status, "attention");
    assert.equal(r.worker.ageMs, 300000);
    assert.equal(r.worker.running, true);
    assert.equal(r.worker.vaultsWithErrors, 1);
    assert.doesNotMatch(
      JSON.stringify(r),
      /secret-vault|private-error|private-path|private-player/,
    );
  } finally {
    f.db.close();
  }
});

test("shared cache avoids duplicate expensive observations while worker data stays current", async () => {
  const f = fixture();
  try {
    await Promise.all(Array.from({ length: 5 }, () => f.economy.snapshot()));
    assert.equal(
      f.calls.filter((q) => q.method_name === "get_treasury").length,
      1,
    );
    f.db
      .prepare("UPDATE native_worker_lease SET last_success=? WHERE id=1")
      .run(NOW);
    assert.equal((await f.economy.snapshot()).worker.status, "observed");
    assert.equal(
      f.calls.filter((q) => q.method_name === "get_treasury").length,
      1,
    );
  } finally {
    f.db.close();
  }
});

test("oversized factory registries fail before reading positions", async () => {
  const f = fixture();
  f.positions = Array.from({ length: 33 }, () => f.positions[0]);
  try {
    assert.equal((await f.economy.snapshot()).staking.status, "unavailable");
    assert.equal(
      f.calls.some((q) => q.method_name === "get_state"),
      false,
    );
  } finally {
    f.db.close();
  }
});

test("worker queue counters are capped and never publish claim payloads", () => {
  const f = fixture();
  try {
    const insert = f.db.prepare(
      "INSERT INTO native_reward_claims(id,day_id,kind,item_index,account_id,player_id,body,signature,attempts,run_after,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    );
    f.db.exec("BEGIN");
    for (let index = 0; index < 10001; index++)
      insert.run(
        `claim-${index}`,
        "day",
        "coin",
        index,
        "private-wallet.testnet",
        "private-profile",
        "private-evidence",
        "private-signature",
        index % 2,
        NOW + index,
        NOW - index,
      );
    f.db.exec("COMMIT");
    const r = f.economy.worker();
    assert.equal(r.queued, 10000);
    assert.equal(r.queueCountCapped, true);
    assert.equal(r.retrying, 5000);
    assert.equal(r.ready, 1);
    assert.doesNotMatch(JSON.stringify(r), /private/);
  } finally {
    f.db.close();
  }
});

test("a hanging RPC is bounded and returns unavailable, not a pending request forever", async () => {
  const f = fixture();
  f.native.provider.query = () => new Promise(() => {});
  const economy = new NativeEconomy(f.native, {
    timeoutMs: 5,
    refreshTimeoutMs: 20,
  });
  try {
    assert.equal((await economy.snapshot()).status, "unavailable");
  } finally {
    f.db.close();
  }
});

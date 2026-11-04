import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { NativeVaults, FACTORY_ID } from "../server/native/vaults.mjs";
function fixture() {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Vault QA");
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    "alice.testnet",
    player,
    Date.now(),
  );
  const n = new NativeVaults(
    db,
    {},
    {
      contractId: "rewards.testnet",
      factory: {
        contractId: FACTORY_ID,
        codeHash: "factory-code",
        vaultCodeHash: "vault-code",
        vaultWasmSha256: "digest",
      },
    },
  );
  n.validate = async () => ({
    created: 1,
    capacity: 32,
    setup_deposit: "3520000000000000000000000",
  });
  n.positions = async () => [
    {
      id: "0",
      account_id: "v0." + FACTORY_ID,
      beneficiary: "alice.testnet",
      state: "ready",
      pool: "aurora.pool.f863973.m0",
    },
  ];
  n.state = async () => ({
    stage: "idle",
    exit_requested: false,
    owner_credit: "0",
    owner_pending: "0",
  });
  return { db, n, player };
}
test("native vault preparation cannot operate an unlinked wallet, another position or arbitrary pool", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.n.prepare(f.player, {
        accountId: "bob.testnet",
        action: "deposit",
        vaultId: "v0." + FACTORY_ID,
        amount: "1000000000000000000000",
      }),
      /Link/,
    );
    await assert.rejects(
      f.n.prepare(f.player, {
        accountId: "alice.testnet",
        action: "deposit",
        vaultId: "v1." + FACTORY_ID,
        amount: "1000000000000000000000",
      }),
      /own factory/,
    );
    await assert.rejects(
      f.n.prepare(f.player, {
        accountId: "alice.testnet",
        action: "create",
        poolId: "attacker.testnet",
        contributionBps: 5000,
      }),
      /supported pool/,
    );
  } finally {
    f.db.close();
  }
});
test("native position quotes preserve integer deposits and reject a new deposit during exit", async () => {
  const f = fixture();
  try {
    const input = {
        accountId: "alice.testnet",
        action: "deposit",
        vaultId: "v0." + FACTORY_ID,
        amount: "1000000000000000000000",
      },
      q = await f.n.prepare(f.player, input);
    assert.equal(q.receiverId, input.vaultId);
    assert.equal(q.methodName, "deposit_and_stake");
    assert.equal(q.deposit, input.amount);
    await assert.rejects(
      f.n.prepare(f.player, { ...input, amount: "0.1" }),
      /native integer/,
    );
    f.n.state = async () => ({ stage: "unlocking", exit_requested: true });
    await assert.rejects(f.n.prepare(f.player, input), /Wait for/);
  } finally {
    f.db.close();
  }
});
test("factory bytecode mismatch disables preparation before returning a wallet transaction", async () => {
  const db = openDatabase(":memory:"),
    n = new NativeVaults(
      db,
      { query: async () => ({ code_hash: "changed" }) },
      {
        contractId: "rewards.testnet",
        factory: { contractId: FACTORY_ID, codeHash: "expected" },
      },
    );
  try {
    await assert.rejects(n.validate(), /Factory code changed/);
  } finally {
    db.close();
  }
});
test("partial exit and contribution change are offered only on an idle v2 position", async () => {
  const f = fixture();
  const v2 = {
    version: 2,
    stage: "idle",
    exit_requested: false,
    owner_credit: "0",
    owner_pending: "0",
    principal: (10n ** 24n).toString(),
    contribution_bps: 5000,
    partial_exit: "0",
    pending_contribution_bps: null,
  };
  const base = { accountId: "alice.testnet", vaultId: "v0." + FACTORY_ID };
  try {
    // v1 state (no version 2): neither method is prepared.
    await assert.rejects(
      f.n.prepare(f.player, { ...base, action: "partial", amount: "1000000000000000000000" }),
      /predates/,
    );
    await assert.rejects(
      f.n.prepare(f.player, { ...base, action: "contribution", contributionBps: 0 }),
      /predates/,
    );
    f.n.state = async () => v2;
    const p = await f.n.prepare(f.player, {
      ...base,
      action: "partial",
      amount: "500000000000000000000000",
    });
    assert.deepEqual(
      [p.methodName, p.deposit, p.args],
      ["request_partial_exit", "1", { amount: "500000000000000000000000" }],
    );
    // Must leave 0.001 behind, and take at least 0.001.
    for (const amount of ["1000000000000000000000000", "999000000000000000001", "1"])
      await assert.rejects(
        f.n.prepare(f.player, { ...base, action: "partial", amount }),
        /Leave at least/,
      );
    const c = await f.n.prepare(f.player, {
      ...base,
      action: "contribution",
      contributionBps: 2500,
    });
    assert.deepEqual(
      [c.methodName, c.deposit, c.args],
      ["set_contribution", "1", { contribution_bps: 2500 }],
    );
    for (const contributionBps of [5000, 10001, -1, 2.5])
      await assert.rejects(
        f.n.prepare(f.player, { ...base, action: "contribution", contributionBps }),
      );
    // While a partial exit is in flight, nothing else is offered.
    f.n.state = async () => ({ ...v2, partial_exit: "1" });
    await assert.rejects(
      f.n.prepare(f.player, { ...base, action: "contribution", contributionBps: 0 }),
      /Wait for/,
    );
    f.n.state = async () => ({ ...v2, stage: "unstaking" });
    await assert.rejects(
      f.n.prepare(f.player, { ...base, action: "partial", amount: "500000000000000000000000" }),
      /Wait for/,
    );
  } finally {
    f.db.close();
  }
});

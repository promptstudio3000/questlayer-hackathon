import test from "node:test";
import assert from "node:assert/strict";
import {
  assertVaultQuote,
  parseTestNear,
  NATIVE_VAULT_FACTORY as factory,
} from "../src/native-vault-quote.ts";
test("native amounts stay integer-exact and reject exponents, negatives and oversized deposits", () => {
  assert.equal(parseTestNear("0.001"), "1000000000000000000000");
  assert.equal(
    parseTestNear("1.123456789012345678901234"),
    "1123456789012345678901234",
  );
  for (const s of [
    "-1",
    "1e3",
    ".1",
    "01",
    "0",
    "1001",
    "0.0009",
    "1.1234567890123456789012345",
  ])
    assert.throws(() => parseTestNear(s));
});
test("wallet quote binds receiver, selected contribution, method and exact deposit before signing", () => {
  const r = {
    accountId: "alice.testnet",
    action: "create",
    poolId: "aurora.pool.f863973.m0",
    contributionBps: 5000,
    setupDeposit: "3520000000000000000000000",
  };
  const q = {
    network: "testnet",
    signerId: r.accountId,
    receiverId: factory,
    factoryId: factory,
    methodName: "create_position",
    args: { pool_id: r.poolId, contribution_bps: 5000 },
    deposit: r.setupDeposit,
    gas: "280000000000000",
  };
  assert.doesNotThrow(() => assertVaultQuote(q, r));
  for (const patch of [
    { network: "mainnet" },
    { receiverId: "attacker.testnet" },
    { signerId: "bob.testnet" },
    { deposit: "9999999999999999999999999" },
    { methodName: "withdraw" },
    { args: { pool_id: r.poolId, contribution_bps: 10000 } },
    { args: { ...q.args, receiver: "attacker.testnet" } },
    { gas: "300000000000000" },
  ])
    assert.throws(() => assertVaultQuote({ ...q, ...patch }, r));
  const d = {
    accountId: "alice.testnet",
    action: "deposit",
    vaultId: "v0." + factory,
    amount: parseTestNear("0.1"),
  };
  assert.doesNotThrow(() =>
    assertVaultQuote(
      {
        ...q,
        receiverId: d.vaultId,
        methodName: "deposit_and_stake",
        args: {},
        deposit: d.amount,
      },
      d,
    ),
  );
  assert.throws(() =>
    assertVaultQuote(
      {
        ...q,
        receiverId: "v1." + factory,
        methodName: "deposit_and_stake",
        args: {},
        deposit: d.amount,
      },
      d,
    ),
  );
});
test("v2 partial exit and contribution quotes bind the exact amount, share and 1 yocto", () => {
  const vaultId = "v0." + factory;
  const q = {
    network: "testnet",
    signerId: "alice.testnet",
    receiverId: vaultId,
    factoryId: factory,
    gas: "280000000000000",
    deposit: "1",
  };
  const partial = {
    accountId: "alice.testnet",
    action: "partial",
    vaultId,
    amount: parseTestNear("0.5"),
  };
  const pq = { ...q, methodName: "request_partial_exit", args: { amount: partial.amount } };
  assert.doesNotThrow(() => assertVaultQuote(pq, partial));
  for (const patch of [
    { args: { amount: parseTestNear("5") } },
    { deposit: "0" },
    { methodName: "request_exit", args: {} },
    { receiverId: "v1." + factory },
  ])
    assert.throws(() => assertVaultQuote({ ...pq, ...patch }, partial));
  const share = {
    accountId: "alice.testnet",
    action: "contribution",
    vaultId,
    contributionBps: 2500,
  };
  const sq = { ...q, methodName: "set_contribution", args: { contribution_bps: 2500 } };
  assert.doesNotThrow(() => assertVaultQuote(sq, share));
  for (const patch of [
    { args: { contribution_bps: 10000 } },
    { deposit: "0" },
    { methodName: "request_partial_exit" },
  ])
    assert.throws(() => assertVaultQuote({ ...sq, ...patch }, share));
});

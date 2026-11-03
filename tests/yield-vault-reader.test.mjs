import test from "node:test";
import assert from "node:assert/strict";
import { yieldVaultSettings, rowNear, createYieldVaultReader, combineStakeReaders } from "../server/native/yield-vault-reader.mjs";

const N = 10n ** 24n;
const db = (accounts) => ({ prepare: () => ({ all: () => accounts.map((account_id) => ({ account_id })) }) });

test("settings: off without a contract, env wins over the manifest, rates bounded", () => {
  assert.equal(yieldVaultSettings({}).enabled, false);
  assert.equal(yieldVaultSettings({}, { contractId: "questlayer-yield-20261102.testnet" }).contract, "questlayer-yield-20261102.testnet");
  assert.equal(yieldVaultSettings({ YIELD_VAULT_ACCOUNT: "x.testnet" }, { contractId: "y.testnet" }).contract, "x.testnet");
  assert.equal(yieldVaultSettings({ YIELD_VAULT_ACCOUNT: "x.testnet", YIELD_VAULT_ENABLED: "0" }).enabled, false);
  assert.equal(yieldVaultSettings({ YIELD_STABLE_EUR: "9" }).stableEur, 0.85);
});

test("LST principal is yoctoNEAR; stables convert through the EUR price or not at all", () => {
  const s = yieldVaultSettings({ YIELD_VAULT_ACCOUNT: "v.testnet" });
  assert.equal(rowNear({ kind: "lst", value_unit: "yoctoNEAR", principal: (2n * N).toString() }, s, null), 2n * N);
  // 10 USDC × 0.85 €/USD at 2.5 €/NEAR = 3.4 NEAR.
  assert.equal(rowNear({ kind: "stable", value_unit: "token", principal: "10000000" }, s, 2.5), (34n * N) / 10n);
  assert.equal(rowNear({ kind: "stable", value_unit: "token", principal: "10000000" }, s, null), 0n);
  assert.equal(rowNear({ kind: "weird", principal: "5" }, s, 2), 0n);
});

test("a locked deposit counts at once, across linked accounts; readers combine", async () => {
  const provider = {
    calls: 0,
    async query(q) {
      this.calls++;
      const { account_id } = JSON.parse(Buffer.from(q.args_base64, "base64"));
      if (account_id === "bad.testnet") throw new Error("rpc");
      const rows = [
        { token_id: "meta-v2.pool.testnet", kind: "lst", value_unit: "yoctoNEAR", principal: (2n * N).toString(), withdrawable: "0", queued: "0", tranches: [{ amount: (2n * N).toString(), locked_until_ms: 99 }] },
      ];
      return { result: [...Buffer.from(JSON.stringify(rows))] };
    },
  };
  const reader = createYieldVaultReader({ provider, settings: yieldVaultSettings({ YIELD_VAULT_ACCOUNT: "v.testnet" }), clock: () => 0 });
  const out = await reader.forPlayer(db(["a.testnet", "bad.testnet"]), "p");
  assert.equal(out.matureNear, (2n * N).toString());
  assert.equal(out.unreadable, 1);
  assert.equal(out.readings[0].tokens[0].tranches[0].locked_until_ms, 99);
  const wallet = { forPlayer: async () => ({ matureNear: N.toString(), holdHours: 24, unreadable: 0, readings: [{ near: (3n * N).toString() }] }) };
  const broken = { forPlayer: async () => { throw new Error("down"); } };
  const both = await combineStakeReaders([wallet, reader, broken, null]).forPlayer(db(["a.testnet"]), "p");
  assert.equal(both.matureNear, (3n * N).toString());
  assert.equal(both.holdHours, 24);
  assert.equal(both.unreadable, 1);
  assert.equal(combineStakeReaders([null]), null);
});

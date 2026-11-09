import test from "node:test";
import assert from "node:assert/strict";
import { assessVault, createQgoldVaultReader, qgoldVaultSettings } from "../server/native/qgold-vault.mjs";

const state = (o = {}) => ({ backing: "1000", supply: "1000000", rate: "1000", r_peak: "1000", paused: false, exit: { queue_count: 0 }, insurance: "5", ...o });
const audit = (o = {}) => ({ ok: true, shortfall: "0", backing_covers_supply_at_peak: true, ...o });

test("settings come from the manifest or the env, and can be switched off", () => {
  assert.equal(qgoldVaultSettings({}, null).enabled, false);
  const m = { vaultContract: "questlayer-qgold-vault-20261104.testnet" };
  assert.equal(qgoldVaultSettings({}, m).contract, m.vaultContract);
  assert.equal(qgoldVaultSettings({ QGOLD_VAULT_ENABLED: "0" }, m).enabled, false);
  assert.equal(qgoldVaultSettings({ QGOLD_VAULT_ACCOUNT: "Bad Account" }, m).enabled, false);
});

test("the operating balance is a warning, never an impairment", () => {
  const a = (slack) => audit({ operating_slack: slack, min_operating_slack: "100000000000000000000000" });
  assert.deepEqual(assessVault(state(), a("500000000000000000000000")).warnings, []);
  const low = assessVault(state(), a("150000000000000000000000"));
  assert.deepEqual(low, { status: "ok", issues: [], warnings: ["operating-slack-low"] });
  const gone = assessVault(state(), a("99999999999999999999999"));
  assert.deepEqual(gone, { status: "ok", issues: [], warnings: ["operating-slack-exhausted"] });
  // A vault that does not report its operating balance warns about nothing.
  assert.deepEqual(assessVault(state(), audit()).warnings, []);
});

test("the monitor flags a short balance, a rate below its peak and a pause", () => {
  assert.deepEqual(assessVault(state(), audit()), { status: "ok", issues: [], warnings: [] });
  assert.equal(assessVault(state({ paused: true }), audit()).status, "paused");
  const short = assessVault(state(), audit({ shortfall: "7" }));
  assert.equal(short.status, "impaired");
  assert.deepEqual(short.issues, ["balance-short"]);
  assert.deepEqual(assessVault(state({ rate: "999" }), audit()).issues, ["rate-below-peak"]);
  assert.deepEqual(assessVault(state({ backing: "0" }), audit()).issues, ["no-backing"]);
  // Empty vault: rate below peak is meaningless without holders.
  assert.equal(assessVault(state({ supply: "0", rate: "1", backing: "0" }), audit()).status, "ok");
  assert.equal(assessVault(null, null).status, "unknown");
});

function fakeProvider(views) {
  const calls = [];
  return {
    calls,
    async query(q) {
      calls.push(q.method_name);
      const args = JSON.parse(Buffer.from(q.args_base64, "base64").toString());
      const v = views[q.method_name];
      return { result: [...Buffer.from(JSON.stringify(typeof v === "function" ? v(args) : v))] };
    },
  };
}

test("reader caches, reports health and lists claimable exits", async () => {
  let now = 1_000;
  const provider = fakeProvider({
    get_state: state({ exit: { queue_count: 1 } }),
    audit: audit(),
    ft_balance_of: "5000000",
    storage_balance_of: { total: "1", available: "0" },
    get_account_exits: [
      { id: 1, account_id: "alice.testnet", ready_at: "900" },
      { id: 2, account_id: "alice.testnet", ready_at: "5000" },
    ],
  });
  const r = createQgoldVaultReader({ provider, settings: { contract: "q.testnet", cacheMs: 100 }, clock: () => now });
  assert.equal(r.status().status, "starting");
  const v = await r.read();
  assert.equal(v.assessment.status, "ok");
  await r.read();
  assert.equal(provider.calls.filter((c) => c === "get_state").length, 1, "cached");
  now += 200;
  await r.read();
  assert.equal(provider.calls.filter((c) => c === "get_state").length, 2);
  assert.equal(r.status().queue, 1);
  const acc = await r.account("alice.testnet");
  assert.equal(acc.balance, "5000000");
  assert.equal(acc.registered, true);
  assert.deepEqual(acc.exits.map((e) => e.claimable), [true, false]);
  await assert.rejects(() => r.account("Not An Account"), /Invalid NEAR account/);
});

test("reader keeps the last good reading when the RPC fails", async () => {
  let fail = false;
  const provider = {
    async query(q) {
      if (fail) throw new Error("rpc down");
      return { result: [...Buffer.from(JSON.stringify(q.method_name === "audit" ? audit() : state()))] };
    },
  };
  const r = createQgoldVaultReader({ provider, settings: { contract: "q.testnet", cacheMs: 0 } });
  await r.read();
  fail = true;
  const v = await r.read({ fresh: true });
  assert.equal(v.stale, true);
  assert.equal(r.status().error, "rpc down");
});

test("an unreadable or empty reply never breaks the health block", async () => {
  const provider = { async query() { return { result: [...Buffer.from("null")] }; } };
  const r = createQgoldVaultReader({ provider, settings: { contract: "q.testnet", cacheMs: 0 } });
  const v = await r.read();
  assert.equal(v.assessment.status, "unknown");
  assert.equal(r.status().status, "unknown");
});

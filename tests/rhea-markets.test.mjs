import test from "node:test";
import assert from "node:assert/strict";
import { marketRow, readRheaMarkets, rheaSettings, createRheaMarkets } from "../server/native/rhea-markets.mjs";

const def = { id: "usdc", label: "USDC", token: "usdc.fakes.testnet", kind: "stable" };
const asset = (supplied, borrowed, apr = "0.14", can = true) => ({
  token_id: def.token,
  supplied: { balance: String(supplied) },
  borrowed: { balance: String(borrowed) },
  supply_apr: apr,
  config: { can_deposit: can, extra_decimals: 12 },
});

test("settings: testnet Rhea Lend, cap defaults to 95 % and is bounded", () => {
  const s = rheaSettings({}, "testnet");
  assert.equal(s.contract, "contract.burrow.testnet");
  assert.equal(s.maxUtilization, 95);
  assert.equal(rheaSettings({ RHEA_MAX_UTILIZATION: "120" }, "testnet").maxUtilization, 95);
  assert.equal(rheaSettings({ RHEA_MAX_UTILIZATION: "90" }, "testnet").maxUtilization, 90);
  assert.equal(rheaSettings({ RHEA_MARKETS_ENABLED: "0" }, "testnet").enabled, false);
  assert.equal(rheaSettings({}, "mainnet").contract, "contract.main.burrow.near");
});

test("utilization and APR; a full pool is not offered", () => {
  const ok = marketRow(def, asset(1000, 890), 95);
  assert.equal(ok.utilizationPercent, 89);
  assert.equal(ok.supplyAprPercent, 14);
  assert.equal(ok.offered, true);
  assert.equal(ok.freeLiquidity, "110");
  const full = marketRow(def, asset(1000, 1000), 95);
  assert.equal(full.full, true);
  assert.equal(full.offered, false);
  assert.match(full.reason, /100 % lent out/);
  assert.equal(marketRow(def, asset(1000, 950), 95).offered, false, "at the cap counts as full");
  assert.equal(marketRow(def, asset(1000, 10, "0.01", false), 95).reason, "deposits closed");
  assert.equal(marketRow(def, undefined, 95).reason, "not listed");
  assert.equal(marketRow(def, asset(0, 0), 95).utilizationPercent, 0);
});

test("reads one view, sorts offered markets by APR, caches for five minutes", async () => {
  let calls = 0;
  const provider = {
    async query(q) {
      calls++;
      assert.equal(q.method_name, "get_assets_paged_detailed");
      const rows = [
        { ...asset(1000, 100, "0.02"), token_id: "wrap.testnet" },
        { ...asset(1000, 1000, "0.30"), token_id: "usdt.fakes.testnet" },
        asset(1000, 500, "0.10"),
      ];
      return { result: [...Buffer.from(JSON.stringify(rows))], block_height: 7 };
    },
  };
  const settings = rheaSettings({}, "testnet");
  const r = await readRheaMarkets(provider, settings, { now: 1 });
  assert.deepEqual(r.markets.map((m) => [m.id, m.offered]), [["usdc", true], ["wnear", true], ["usdt", false], ["linear", false]]);
  let t = 0;
  const m = createRheaMarkets({ provider, settings, clock: () => t });
  await m.read();
  await m.read();
  t = 6 * 60_000;
  await m.read();
  assert.equal(calls, 3);
});

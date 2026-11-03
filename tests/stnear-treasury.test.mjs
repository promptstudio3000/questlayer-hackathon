import test from "node:test";
import assert from "node:assert/strict";
import {
  treasurySettings,
  planHarvest,
  harvestReceiptId,
  valueOf,
  sharesFor,
  fundingAttachment,
  SPONSOR_STORAGE_FEE,
  createTreasuryView,
  readTreasury,
} from "../server/native/stnear-treasury.mjs";

const N = 10n ** 24n;
const settings = treasurySettings({}, "testnet");
const date = "2026-11-02";
// 10 stNEAR at 1.21 NEAR → 12.1 NEAR worth, principal 12 NEAR → 0.1 NEAR growth.
const base = {
  balance: 10n * N,
  price: (121n * N) / 100n,
  principal: 12n * N,
  settings,
  date,
};

test("settings: Meta Pool testnet, sane defaults and bounds", () => {
  assert.equal(settings.contract, "meta-v2.pool.testnet");
  assert.equal(settings.minHarvest, N / 100n);
  assert.equal(settings.maxFeeBps, 100);
  assert.equal(treasurySettings({ STNEAR_MAX_FEE_BPS: "9999" }).maxFeeBps, 500);
  assert.equal(
    treasurySettings({ STNEAR_MIN_HARVEST_NEAR: "0.2" }).minHarvest,
    (2n * N) / 10n,
  );
  assert.equal(treasurySettings({}, "mainnet").contract, "meta-pool.near");
});

test("value and shares round so the treasury never oversells", () => {
  const price = 3198752259237337050198977n;
  const shares = sharesFor(N, price);
  assert(valueOf(shares, price) <= N);
  assert(valueOf(shares + 1n, price) > N);
});

test("harvest sells only the growth; the principal stays", () => {
  const rough = planHarvest(base);
  assert.equal(rough.action, "harvest");
  assert.equal(rough.growth, N / 10n);
  assert(valueOf(base.balance - rough.sell, base.price) >= base.principal);
  const quote = (valueOf(rough.sell, base.price) * 9_970n) / 10_000n; // 0.3 % pool fee
  const plan = planHarvest({ ...base, quote });
  assert.equal(plan.action, "harvest");
  assert.equal(plan.feeBps, 30);
  assert.equal(plan.receiptId, "stnear-yield-2026-11-02");
  assert(plan.minExpected < quote && plan.minExpected > (quote * 99n) / 100n);
});

test("skips: no principal, small growth, price drop, high exit fee, done today, implausible growth", () => {
  assert.equal(planHarvest({ ...base, principal: 0n }).reason, "no-principal");
  assert.equal(
    planHarvest({ ...base, principal: 12n * N + (95n * N) / 1000n }).reason,
    "growth-below-minimum",
  );
  assert.equal(
    planHarvest({ ...base, price: N }).reason,
    "growth-below-minimum",
  );
  const rough = planHarvest(base);
  const quote = (valueOf(rough.sell, base.price) * 9_700n) / 10_000n; // 3 %
  assert.equal(planHarvest({ ...base, quote }).reason, "exit-fee-too-high");
  assert.equal(
    planHarvest({ ...base, harvested: ["stnear-yield-2026-11-02"] }).reason,
    "already-harvested",
  );
  // Lost/zeroed principal record → would look like 12 NEAR "growth"; refused.
  assert.equal(
    planHarvest({ ...base, principal: 1n }).reason,
    "growth-implausible",
  );
});

test("receipt ids are labelled and dated; funding adds the sponsor storage fee", () => {
  assert.throws(() => harvestReceiptId("2 Nov"));
  assert.match(harvestReceiptId(date), /^stnear-yield-\d{4}-\d{2}-\d{2}$/);
  assert.equal(fundingAttachment(N), N + SPONSOR_STORAGE_FEE);
});

test("public view combines the record with the live balance", async () => {
  const enc = (v) => [...Buffer.from(JSON.stringify(v))];
  const provider = {
    async query(q) {
      if (q.method_name === "ft_balance_of")
        return { result: enc((10n * N).toString()) };
      if (q.method_name === "get_st_near_price")
        return { result: enc(((121n * N) / 100n).toString()) };
      throw new Error(q.method_name);
    },
  };
  const read = createTreasuryView({
    provider,
    record: () => ({
      network: "testnet",
      account: "op.testnet",
      contract: "meta-v2.pool.testnet",
      principal: (12n * N).toString(),
      harvests: [
        {
          receiptId: "stnear-yield-2026-11-01",
          received: (N / 20n).toString(),
        },
      ],
    }),
  });
  const v = await read();
  assert.equal(v.growth, (N / 10n).toString());
  assert.equal(v.harvested, (N / 20n).toString());
  await assert.rejects(
    createTreasuryView({ provider, record: () => null }),
    /not in stNEAR/,
  );
});

test("stNEAR parked in the yield vault counts as treasury value, but only wallet stNEAR is sold", async () => {
  const settings = treasurySettings({}, "testnet");
  assert.equal(settings.vault, "questlayer-yield-20261102.testnet");
  assert.equal(
    treasurySettings({ STNEAR_TREASURY_VAULT: "off" }, "testnet").vault,
    null,
  );
  const price = 3n * N;
  // 2 stNEAR in the wallet (6 NEAR) + 4 NEAR parked, principal 9.9 NEAR.
  const base = {
    balance: 2n * N,
    price,
    principal: (99n * N) / 10n,
    settings: { ...settings, maxHarvestBps: 200 },
    date,
  };
  const without = planHarvest(base);
  assert.equal(without.reason, "growth-below-minimum");
  const withVault = planHarvest({ ...base, parked: 4n * N });
  assert.equal(withVault.action, "harvest");
  assert.equal(withVault.growth, N / 10n);
  // Growth larger than the wallet can cover is never sold from the vault.
  const tiny = planHarvest({
    ...base,
    balance: N / 1000n,
    parked: (99n * N) / 10n + N / 10n - (3n * N) / 1000n,
  });
  assert.equal(tiny.reason, "growth-not-in-wallet");

  const enc = (v) => [...Buffer.from(JSON.stringify(v))];
  const provider = {
    async query(q) {
      if (q.method_name === "ft_balance_of")
        return { result: enc((2n * N).toString()) };
      if (q.method_name === "get_st_near_price")
        return { result: enc(price.toString()) };
      if (q.method_name === "get_position")
        return {
          result: enc([
            {
              token_id: "usdc.fakes.testnet",
              kind: "stable",
              withdrawable: "5",
            },
            {
              token_id: "meta-v2.pool.testnet",
              kind: "lst",
              withdrawable: (4n * N).toString(),
            },
          ]),
        };
      throw new Error(q.method_name);
    },
  };
  const live = await readTreasury(provider, {
    contract: "meta-v2.pool.testnet",
    account: "op.testnet",
    vault: settings.vault,
  });
  assert.equal(live.parked, 4n * N);
  assert.equal(live.value, 10n * N);
  const broken = {
    query: async (q) =>
      q.method_name === "get_position"
        ? Promise.reject(new Error("x"))
        : provider.query(q),
  };
  const safe = await readTreasury(broken, {
    contract: "meta-v2.pool.testnet",
    account: "op.testnet",
    vault: settings.vault,
  });
  assert.equal(safe.parked, 0n);
});

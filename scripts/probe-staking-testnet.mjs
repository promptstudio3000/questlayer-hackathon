import { mkdir, writeFile } from "node:fs/promises";
import { createNearProvider } from "../server/near-provider.mjs";
import { assertTestnetRpc } from "../server/identity/near.mjs";
import { readStakingPool } from "../server/native/staking-pool.mjs";

// A bounded read-only watchlist, not a deposit allowlist or a validator recommendation.
const poolIds = [
  "aurora.pool.f863973.m0",
  "stakely_v2.pool.f863973.m0",
  "ts.pool.f863973.m0",
];
const provider = createNearProvider();
await assertTestnetRpc(provider);
const block = await provider.viewBlock({ finality: "final" });
const [validators, config] = await Promise.all([
  provider.viewValidators({ epochId: block.header.epoch_id }),
  provider.experimental_protocolConfig({ blockId: block.header.hash }),
]);
const results = await Promise.allSettled(
  poolIds.map((accountId) =>
    readStakingPool(
      provider,
      {
        accountId,
        observerId:
          process.env.STAKING_OBSERVER || "auratrail-dev-20261030.testnet",
      },
      block,
    ),
  ),
);
const pools = results.map((result, index) => {
  if (result.status === "rejected")
    return {
      accountId: poolIds[index],
      available: false,
      error: String(result.reason?.message || result.reason).slice(0, 300),
      depositsEnabled: false,
    };
  const validator = validators.current_validators.find(
    (v) => v.account_id === result.value.accountId,
  );
  return {
    ...result.value,
    available: true,
    activeValidator: !!validator,
    currentEpochProduction: validator
      ? {
          expectedBlocks: validator.num_expected_blocks,
          producedBlocks: validator.num_produced_blocks,
        }
      : null,
  };
});
const report = {
  version: 1,
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  mode: "read-only; no vault, staking transaction or game funding",
  blockHash: block.header.hash,
  blockHeight: block.header.height,
  blockTime: new Date(
    Number(BigInt(block.header.timestamp_nanosec) / 1000000n),
  ).toISOString(),
  epochId: block.header.epoch_id,
  epochHeight: validators.epoch_height,
  epochStartHeight: validators.epoch_start_height,
  nominalEpochBlocks: config.epoch_length,
  protocolVersion: config.protocol_version,
  pools,
  remainingGates: [
    "reproducible deployed-code/source review",
    "vault share and high-water attribution",
    "provisional fee loss/recovery policy",
    "native asynchronous deposit/withdraw reconciliation",
    "live full unstake cycle",
    "independent financial review",
  ],
};
await mkdir("output/qa/W05", { recursive: true });
await writeFile(
  "output/qa/W05/staking-pools.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    blockHeight: report.blockHeight,
    epochHeight: report.epochHeight,
    pools: pools.map((p) => ({
      accountId: p.accountId,
      available: p.available,
      feeBps: p.rewardFeeBps,
      keyless: p.keyless,
      activeValidator: p.activeValidator,
      depositsEnabled: false,
    })),
  }),
);
if (pools.some((p) => !p.available)) process.exitCode = 1;

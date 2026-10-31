// Read-only reconciliation at one finalized testnet block. No signer is loaded.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createNearProvider } from "../server/near-provider.mjs";
import { assertTestnetRpc } from "../server/identity/near.mjs";
import { NativeEconomy } from "../server/native/economy.mjs";

const config = JSON.parse(readFileSync("public/native-rewards-testnet.json"));
const pilot = JSON.parse(readFileSync("public/native-pilot-proof.json"));
const provider = createNearProvider();
const reader = new NativeEconomy({ provider, config }, { timeoutMs: 10000 });
await reader.bounded(assertTestnetRpc(provider));
const block = await reader.bounded(provider.viewBlock({ finality: "final" }));
reader.deadline = Date.now() + 45000;
const [treasury, staking, registry] = await Promise.all([
  reader.treasury(block),
  reader.staking(block),
  reader.positions(block),
]);
assert(
  staking.complete && staking.poolComplete,
  "Position or pool coverage is incomplete",
);
const position = registry.list.find((p) => p.accountId === pilot.vaultId);
assert(
  position,
  "The project pilot position is absent from the reviewed registry",
);
const pools = new Map(
  staking.pools.map((p) => [p.id, { ok: p.status === "observed" }]),
);
const exit = await reader.position(block, position, pools);
const report = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  mode: "read-only; no signer, transaction, epoch bypass or account mutation",
  newTransactions: 0,
  blockHash: block.header.hash,
  blockHeight: block.header.height,
  blockTime: new Date(
    Number(BigInt(block.header.timestamp_nanosec) / 1000000n),
  ).toISOString(),
  treasury,
  staking,
  pilot: { accountId: position.accountId, ...exit },
  exitEpochReached: BigInt(exit.state.epoch) >= BigInt(exit.state.unlock_epoch),
  fullExitCycleComplete:
    exit.phase === "settled" &&
    BigInt(exit.state.owner_paid) > 0n &&
    exit.state.owner_credit === "0" &&
    exit.state.owner_pending === "0",
  gameYieldReceived: BigInt(staking.totals.realizedGameYieldPaid) > 0n,
  boundaries: [
    "All contract, pool and treasury reads use the same finalized block and reviewed code fingerprints",
    "Pool unstaked balance is not beneficiary cash; epoch maturity alone does not establish pool release",
    "Only game_paid establishes a vault's realized yield transfer; sponsor-funded treasury balances are not yield",
    "An aggregate 50/50 treasury reconciliation does not independently establish each historical funding receipt",
    "This observation does not exercise a physical wallet or multi-epoch live failure recovery",
  ],
};
mkdirSync("output/qa/W05-lifecycle", { recursive: true });
writeFileSync(
  "output/qa/W05-lifecycle/read-only-proof.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    blockHeight: report.blockHeight,
    epoch: exit.state.epoch,
    unlockEpoch: exit.state.unlock_epoch,
    canWithdraw: exit.pool?.canWithdraw,
    phase: exit.phase,
    ownerCredit: exit.state.owner_credit,
    ownerPaid: exit.state.owner_paid,
    realizedGameYieldPaid: staking.totals.realizedGameYieldPaid,
    funded: treasury.funded,
    reconciled: treasury.reconciled,
  }),
);

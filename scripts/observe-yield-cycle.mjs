// Read-only observation of the realized-yield cycle: vault gain → harvest →
// unlock → flush_game → rewards treasury. Sends no transaction and needs no key.
//
//   node scripts/observe-yield-cycle.mjs \
//     --vault questlayer-vault-20261101.testnet \
//     --rewards questlayer-rewards-20261101.testnet \
//     [--rpc https://rpc.testnet.near.org] [--out public/native-yield-observation.json]
//
// With --out the observation is appended to that file's `history` (one entry
// per call) and `latest` is replaced, so repeated runs build the timeline.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const vaultId = arg("vault", "questlayer-vault-20261101.testnet");
const rewardsId = arg("rewards", "questlayer-rewards-20261101.testnet");
const rpcUrl = arg("rpc", "https://rpc.testnet.near.org");
const out = arg("out", null);
for (const id of [vaultId, rewardsId])
  if (!/^[a-z0-9._-]+\.testnet$/.test(id))
    throw new Error(`Testnet accounts only: ${id}`);

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 300));
  return body.result;
}
const view = async (account_id, method_name, args = {}) =>
  JSON.parse(
    Buffer.from(
      (
        await rpc("query", {
          request_type: "call_function",
          finality: "final",
          account_id,
          method_name,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        })
      ).result,
    ).toString(),
  );

const [validators, block, vault, treasury, rewardsAccount] = await Promise.all([
  rpc("validators", [null]),
  rpc("block", { finality: "final" }),
  view(vaultId, "get_state"),
  view(rewardsId, "get_treasury"),
  rpc("query", {
    request_type: "view_account",
    finality: "final",
    account_id: rewardsId,
  }),
]);
const big = (v) => BigInt(v ?? "0");
const gain =
  big(vault.staked) + big(vault.unstaked) - big(vault.high_water_basis);
// Where the game share is in its journey, from the vault's own state.
let phase;
if (big(vault.game_paid) > 0n) phase = "flushed-to-treasury";
else if (big(vault.game_credit) > 0n) phase = "credit-ready-to-flush";
else if (big(vault.game_pending) > 0n || vault.operation === "harvest")
  phase = "harvested-unlocking";
else if (gain > 10n ** 18n) phase = "gain-awaiting-harvest";
else phase = "accruing";
const observation = {
  observedAt: new Date(
    Number(BigInt(block.header.timestamp_nanosec) / 1000000n),
  ).toISOString(),
  source: `read-only RPC views at finality=final via ${new URL(rpcUrl).host}; no transaction was sent`,
  chain: {
    epochHeight: validators.epoch_height,
    epochStartHeight: validators.epoch_start_height,
    blockHeight: block.header.height,
  },
  phase,
  vault: {
    accountId: vaultId,
    rewards: vault.rewards,
    stage: vault.stage,
    operation: vault.operation,
    unlockEpoch: vault.unlock_epoch,
    epoch: vault.epoch,
    principal: vault.principal,
    highWaterBasis: vault.high_water_basis,
    staked: vault.staked,
    unstaked: vault.unstaked,
    unharvestedGain: (gain > 0n ? gain : 0n).toString(),
    contributionBps: vault.contribution_bps,
    gamePending: vault.game_pending,
    gameCredit: vault.game_credit,
    gamePaid: vault.game_paid,
  },
  treasury: {
    accountId: rewardsId,
    funded: treasury.funded,
    coinsAvailable: treasury.coins.available,
    zonesAvailable: treasury.zones.available,
    accountBalance: rewardsAccount.amount,
  },
};
if (vault.rewards !== rewardsId)
  observation.warning = `Vault pays ${vault.rewards}, not ${rewardsId}.`;
if (out) {
  const file = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
  const history = Array.isArray(file.history) ? file.history : [];
  history.push(observation);
  writeFileSync(
    out,
    JSON.stringify(
      {
        network: "testnet",
        description:
          "Timeline of the realized-yield cycle (harvest → unlock → flush_game → rewards treasury), from read-only views.",
        latest: observation,
        history,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(JSON.stringify(observation, null, 2));

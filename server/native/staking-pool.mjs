import { assert } from "../domain.mjs";
import { nearAccountId, assertTestnetRpc } from "../identity/near.mjs";

export const YOCTO = 10n ** 24n;
export const MICRO_GOLD = 10n ** 15n;
export function nativeInteger(value) {
  assert(
    typeof value === "bigint" ||
      (typeof value === "string" && /^(0|[1-9]\d{0,38})$/.test(value)),
    "Invalid native integer.",
  );
  const amount = BigInt(value);
  assert(amount >= 0n && amount < 2n ** 128n, "Native amount is outside u128.");
  return amount;
}

// A view adapter, not a vault or permission to deposit. No transaction is signed here.
export async function readStakingPool(
  provider,
  { accountId, observerId, expectedCodeHash },
  block,
) {
  nearAccountId(accountId);
  if (observerId) nearAccountId(observerId);
  await assertTestnetRpc(provider);
  assert(
    block?.header?.hash && Number.isSafeInteger(block.header.height),
    "A finalized block anchor is required.",
  );
  const anchor = { block_id: block.header.hash };
  const query = async (request) => {
    const response = await provider.query({
      ...request,
      account_id: accountId,
      ...anchor,
    });
    assert(
      response.block_hash === block.header.hash &&
        response.block_height === block.header.height,
      "Pool reads do not share the finalized anchor.",
      503,
    );
    return response;
  };
  const view = async (method, args = {}) => {
    const response = await query({
      request_type: "call_function",
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    assert(
      Array.isArray(response.result) && response.result.length <= 100000,
      "Pool view is too large.",
      503,
    );
    return JSON.parse(Buffer.from(response.result).toString());
  };
  const [account, keys, total, fee, paused, owner, observer] =
    await Promise.all([
      query({ request_type: "view_account" }),
      query({ request_type: "view_access_key_list" }),
      view("get_total_staked_balance"),
      view("get_reward_fee_fraction"),
      view("is_staking_paused"),
      view("get_owner_id"),
      observerId ? view("get_account", { account_id: observerId }) : null,
    ]);
  const totalStaked = nativeInteger(total).toString();
  assert(
    Number.isSafeInteger(fee?.numerator) &&
      Number.isSafeInteger(fee?.denominator) &&
      fee.numerator <= 4294967295 &&
      fee.denominator <= 4294967295 &&
      fee.denominator > 0 &&
      fee.numerator >= 0 &&
      fee.numerator <= fee.denominator,
    "Invalid staking reward fee.",
    503,
  );
  assert(
    typeof paused === "boolean" && Array.isArray(keys.keys),
    "Invalid pool configuration.",
    503,
  );
  nearAccountId(owner);
  if (observer) {
    assert(
      observer.account_id === observerId &&
        typeof observer.can_withdraw === "boolean",
      "Pool returned another observer.",
      503,
    );
    nativeInteger(observer.staked_balance);
    nativeInteger(observer.unstaked_balance);
  }
  return {
    accountId,
    ownerId: owner,
    totalStaked,
    rewardFee: fee,
    rewardFeeBps: Math.floor((fee.numerator * 10000) / fee.denominator),
    paused,
    codeHash: account.code_hash,
    fingerprintMatches: expectedCodeHash
      ? expectedCodeHash === account.code_hash
      : null,
    accessKeyCount: keys.keys.length,
    keyless: keys.keys.length === 0,
    observer: observer
      ? {
          accountId: observerId,
          staked: observer.staked_balance,
          unstaked: observer.unstaked_balance,
          canWithdraw: observer.can_withdraw,
        }
      : null,
    blockHash: block.header.hash,
    blockHeight: block.header.height,
    apy: null,
    apyReason: "No attributable reward history has been established.",
    depositsEnabled: false,
    reviewStatus: "read-only interface probe",
  };
}

// These are estimates only. High-water accounting must exclude external cash flows.
export function quoteNetYield({
  value,
  flowAdjustedHighWater,
  contributionBps,
}) {
  value = nativeInteger(value);
  const basis = nativeInteger(flowAdjustedHighWater);
  assert(
    Number.isInteger(contributionBps) &&
      contributionBps >= 0 &&
      contributionBps <= 10000,
    "Invalid contribution.",
  );
  const gain = value > basis ? value - basis : 0n;
  const lossToRecover = basis > value ? basis - value : 0n;
  const game = (gain * BigInt(contributionBps)) / 10000n;
  return {
    gain,
    lossToRecover,
    gameEstimate: game,
    retainedEstimate: gain - game,
    spendable: 0n,
  };
}

export function weightedAccess({ tranches, epoch, contributionHistory }) {
  assert(Number.isSafeInteger(epoch) && epoch >= 0, "Invalid epoch.");
  let priorEpoch = -1,
    base = 0,
    eligible = 0;
  for (const change of contributionHistory) {
    assert(
      Number.isSafeInteger(change.epoch) &&
        change.epoch >= priorEpoch &&
        change.epoch <= epoch &&
        Number.isInteger(change.bps) &&
        change.bps >= 0 &&
        change.bps <= 10000,
      "Invalid contribution history.",
    );
    priorEpoch = change.epoch;
    if (change.epoch <= epoch - 2) base = change.bps;
  }
  eligible = base;
  for (const change of contributionHistory)
    if (change.epoch > epoch - 2) eligible = Math.min(eligible, change.bps);
  let active = 0n;
  for (const tranche of tranches) {
    assert(
      Number.isSafeInteger(tranche.confirmedEpoch) &&
        tranche.confirmedEpoch >= 0 &&
        tranche.confirmedEpoch <= epoch,
      "Invalid stake epoch.",
    );
    const value = nativeInteger(tranche.activeValue);
    if (tranche.confirmedEpoch + 2 <= epoch) active += value;
  }
  nativeInteger(active);
  const weighted = (active * BigInt(eligible)) / 10000n;
  return {
    eligibleBps: eligible,
    maturedActiveValue: active,
    weighted,
    tier: weighted >= 100n * YOCTO ? 3 : weighted >= 50n * YOCTO ? 2 : 1,
  };
}

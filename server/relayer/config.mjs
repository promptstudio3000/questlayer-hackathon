import { assert } from "../domain.mjs";

const yocto = (value, fallback, name) => {
  const text = value === undefined || value === "" ? fallback : value;
  assert(
    /^(0|[1-9]\d{0,38})$/.test(text),
    `${name} must be a yoctoNEAR integer.`,
    503,
  );
  return BigInt(text);
};
const count = (value, fallback, name, max) => {
  const n = value === undefined || value === "" ? fallback : Number(value);
  assert(
    Number.isSafeInteger(n) && n > 0 && n <= max,
    `${name} must be a positive integer up to ${max}.`,
    503,
  );
  return n;
};
// Environment contract for the invisible-account relayer. Keys stay in private
// files; no secret is read from the environment itself.
export function relayerConfiguration(env = process.env) {
  const disabled = env.DISABLE_RELAYER === "1";
  return {
    enabled: !disabled && !!env.RELAYER_KEY_PATH,
    accountsEnabled:
      !disabled &&
      !!env.PLAYER_FACTORY_KEY_PATH &&
      !!env.PLAYER_FACTORY_ACCOUNT,
    relayerKeyPath: env.RELAYER_KEY_PATH || null,
    factoryKeyPath: env.PLAYER_FACTORY_KEY_PATH || null,
    factoryAccount: env.PLAYER_FACTORY_ACCOUNT || null,
    fundYocto: yocto(
      env.PLAYER_FACTORY_FUND_YOCTO,
      "20000000000000000000000",
      "PLAYER_FACTORY_FUND_YOCTO",
    ),
    topupCapYocto: yocto(
      env.RELAY_TOPUP_CAP_YOCTO,
      "50000000000000000000000",
      "RELAY_TOPUP_CAP_YOCTO",
    ),
    maxJobsPerDay: count(
      env.RELAY_MAX_JOBS_PER_DAY,
      40,
      "RELAY_MAX_JOBS_PER_DAY",
      10000,
    ),
    maxDepositYoctoPerDay: yocto(
      env.RELAY_MAX_DEPOSIT_YOCTO_PER_DAY,
      "500000000000000000000000",
      "RELAY_MAX_DEPOSIT_YOCTO_PER_DAY",
    ),
    maxGas: yocto(env.RELAY_MAX_GAS, "300000000000000", "RELAY_MAX_GAS"),
    // Sponsored single-order cancels (market v2 nonce slots), per account and
    // service-wide per UTC day.
    maxCancelsPerDay: count(env.RELAY_MAX_CANCELS_PER_DAY, 4, "RELAY_MAX_CANCELS_PER_DAY", 100),
    maxCancelsGlobalPerDay: count(env.RELAY_MAX_CANCELS_GLOBAL_PER_DAY, 16, "RELAY_MAX_CANCELS_GLOBAL_PER_DAY", 500),
    blockTtl: count(env.RELAY_BLOCK_TTL, 120, "RELAY_BLOCK_TTL", 1000),
    // No guessed treasury allowance: financial sponsorship fails closed until
    // an operator reviews all three limits. Solo play has no dependency on it.
    subsidyDailyYocto: yocto(env.SUBSIDY_DAILY_YOCTO, "0", "SUBSIDY_DAILY_YOCTO"),
    subsidyDailyOperations: env.SUBSIDY_DAILY_OPERATIONS ? count(env.SUBSIDY_DAILY_OPERATIONS, 0, "SUBSIDY_DAILY_OPERATIONS", 100000) : 0,
    subsidyGasReserveYocto: yocto(env.SUBSIDY_GAS_RESERVE_YOCTO, "0", "SUBSIDY_GAS_RESERVE_YOCTO"),
  };
}

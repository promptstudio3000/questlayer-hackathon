// TEST_SEED=1 turns the testnet test world on (docs/TEST-SEED.md). Any other
// value, or no value, removes whatever an earlier run seeded. Mainnet refuses
// to start with TEST_SEED=1.
export function testSeedMode(env = process.env, network = "testnet") {
  const flag = env.TEST_SEED;
  if (flag !== undefined && !["", "0", "1"].includes(flag))
    throw new Error("TEST_SEED must be 0 or 1.");
  if (flag !== "1") return "purge";
  if (network !== "testnet")
    throw new Error("TEST_SEED=1 is only allowed on testnet.");
  return "apply";
}

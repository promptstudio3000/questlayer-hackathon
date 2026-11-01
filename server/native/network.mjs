// Single source of truth for the NEAR network this process talks to. Every
// server module imports from here instead of spelling "testnet"; the value
// comes from NEAR_NETWORK and defaults to testnet. Mainnet is a deliberate
// configuration, never an inference (see docs/MAINNET-PLAN.md).
const requested = process.env.NEAR_NETWORK || "testnet";
if (!["testnet", "mainnet"].includes(requested))
  throw new Error(
    `NEAR_NETWORK must be "testnet" or "mainnet", got "${requested}".`,
  );
export const NETWORK = requested;
export const ACCOUNT_SUFFIX = NETWORK === "mainnet" ? ".near" : ".testnet";
export const NETWORK_LABEL = NETWORK === "mainnet" ? "NEAR" : "NEAR testnet";
export const DEFAULT_RPC =
  NETWORK === "mainnet"
    ? "https://free.rpc.fastnear.com"
    : "https://test.rpc.fastnear.com";
export const SOCIAL_CONTRACT_ID =
  NETWORK === "mainnet" ? "social.near" : "v1.social08.testnet";
export const EXPLORER_BASE =
  NETWORK === "mainnet"
    ? "https://nearblocks.io"
    : "https://testnet.nearblocks.io";
/** Manifest file name for this network, e.g. `native-market-testnet.json`. */
export const manifestName = (name) => `${name}-${NETWORK}.json`;
/** True when the account id belongs to the configured network. */
export const onNetwork = (accountId) =>
  typeof accountId === "string" && accountId.endsWith(ACCOUNT_SUFFIX);

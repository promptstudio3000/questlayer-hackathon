// The NEAR network this bundle was built for. It is fixed at build time
// (VITE_NEAR_NETWORK, default testnet) rather than taken from the server, so a
// misconfigured or hostile server cannot move the client to another network:
// every validator compares server quotes against this value, and
// `/api/config` must report the same network before the client signs anything
// itself (see self-paid-native-transaction.ts). Mirrors server/native/network.mjs.
export type NearNetwork = "testnet" | "mainnet";
const requested =
  (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_NEAR_NETWORK || "testnet";
if (requested !== "testnet" && requested !== "mainnet")
  throw new Error(`VITE_NEAR_NETWORK must be "testnet" or "mainnet".`);
export const NEAR_NETWORK: NearNetwork = requested;
export const ACCOUNT_SUFFIX = NEAR_NETWORK === "mainnet" ? ".near" : ".testnet";
export const NETWORK_LABEL =
  NEAR_NETWORK === "mainnet" ? "NEAR" : "NEAR testnet";
export const SOCIAL_CONTRACT_ID =
  NEAR_NETWORK === "mainnet" ? "social.near" : "v1.social08.testnet";
export const EXPLORER_BASE =
  NEAR_NETWORK === "mainnet"
    ? "https://nearblocks.io"
    : "https://testnet.nearblocks.io";
/** True when the account id belongs to the bundle's network. */
export const onNearNetwork = (accountId: unknown): accountId is string =>
  typeof accountId === "string" && accountId.endsWith(ACCOUNT_SUFFIX);

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
// Which world this process serves (docs/TEST-LAYER.md). "world" is the real
// game (QuestLayer World). "test" is the Test Layer: the same game on its own
// testnet contract set with Test QGOLD, temporary accounts, bots and the guided
// tour. The Test Layer exists only on testnet; mainnet refuses to start with it.
const layerRequested = process.env.QL_LAYER || "world";
if (!["world", "test"].includes(layerRequested))
  throw new Error(`QL_LAYER must be "world" or "test", got "${layerRequested}".`);
if (layerRequested === "test" && NETWORK === "mainnet")
  throw new Error("QL_LAYER=test is testnet only; mainnet serves the real game only.");
export const LAYER = layerRequested;
export const TEST_LAYER = LAYER === "test";
/** Explorer sessions: 30 days in World; temporary 4-hour explorers in the Test Layer. */
export const SESSION_TTL_MS = (TEST_LAYER ? 4 : 30 * 24) * 60 * 60 * 1000;
/** Manifest family: the network's own, or the Test Layer's contract set. */
export const MANIFEST_SET = TEST_LAYER ? "testlayer" : NETWORK;
/** Manifest file name, e.g. `native-market-testnet.json` (`-testlayer` in the Test Layer). */
export const manifestName = (name) => `${name}-${MANIFEST_SET}.json`;
/** True when the account id belongs to the configured network. */
export const onNetwork = (accountId) =>
  typeof accountId === "string" && accountId.endsWith(ACCOUNT_SUFFIX);

// Mainnet slices (docs/MAINNET-PLAN.md §3 step 7). On testnet every slice is
// on, as before. On mainnet only the slices named in MAINNET_FEATURES are on;
// anything else answers "not configured" even when its manifest exists.
// Collectibles are the minimal mainnet slice and the server's core reader, so
// a mainnet host must list them explicitly.
export const FEATURES = Object.freeze([
  "collectibles",
  "market",
  "rewards",
  "vaults",
  "relayer",
  "social",
  "creators",
  "tasks",
]);
export function parseFeatures(network, value) {
  if (network !== "mainnet") return [...FEATURES];
  const listed = String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of listed)
    if (!FEATURES.includes(name))
      throw new Error(
        `MAINNET_FEATURES has an unknown slice "${name}"; known: ${FEATURES.join(", ")}.`,
      );
  if (!listed.includes("collectibles"))
    throw new Error(
      'NEAR_NETWORK=mainnet requires MAINNET_FEATURES to include "collectibles".',
    );
  // Vaults need the rewards contract they pay into.
  if (listed.includes("vaults") && !listed.includes("rewards"))
    throw new Error('MAINNET_FEATURES "vaults" requires "rewards".');
  return FEATURES.filter((f) => listed.includes(f));
}
export const ENABLED_FEATURES = Object.freeze(
  parseFeatures(NETWORK, process.env.MAINNET_FEATURES),
);
export function featureEnabled(name) {
  if (!FEATURES.includes(name)) throw new Error(`Unknown feature "${name}".`);
  return ENABLED_FEATURES.includes(name);
}

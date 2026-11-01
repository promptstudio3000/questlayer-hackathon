// Runs the application suite a second time with NEAR_NETWORK=mainnet and fake
// providers (docs/MAINNET-PLAN.md §3, "tests run twice"). Files listed below
// still build `.testnet` fixture accounts and assert testnet literals; they
// stay testnet-only until their fixtures take the network from
// server/native/network.mjs. Every other test file, including new ones, must
// pass on both networks. What keeps the rest here (1 November):
// - they boot the full server from the repository, which on mainnet needs
//   public/mainnet-deployment.json (written only by a real slice deploy;
//   tests/mainnet-slice.test.mjs boots a copy instead): http, http-social,
//   near-auth, creator-runtime, original-art-http, world-pilot;
// - they need rewards, market, tasks or creators manifests, which are outside
//   the mainnet slice: creator-money, native-economy, native-market,
//   native-progression, native-rewards, native-tasks,
//   native-transaction-confirmation, native-vaults;
// - they compare with the client network module, fixed at build time to
//   testnet under node: near-network-client, native-profile;
// - schema-module-upgrade proves the version 1 testnet-only CHECK.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const TESTNET_FIXTURE_FILES = [
  "creator-money",
  "creator-runtime",
  "http-social",
  "http",
  "native-economy",
  "native-market",
  "native-profile",
  "native-progression",
  "native-rewards",
  "native-tasks",
  "native-transaction-confirmation",
  "native-vaults",
  "near-auth",
  "near-network-client",
  "original-art-http",
  "schema-module-upgrade",
  "world-pilot",
].map((name) => `${name}.test.mjs`);

const files = readdirSync("tests")
  .filter((f) => f.endsWith(".test.mjs") && !TESTNET_FIXTURE_FILES.includes(f))
  .sort()
  .map((f) => `tests/${f}`);
console.log(
  `Mainnet pass: ${files.length} files; ${TESTNET_FIXTURE_FILES.length} testnet-fixture files skipped.`,
);
const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=4", ...files],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEAR_NETWORK: "mainnet",
      MAINNET_FEATURES:
        process.env.MAINNET_FEATURES ||
        "collectibles,rewards,vaults,relayer,social",
    },
  },
);
process.exit(result.status ?? 1);

// Network selection for operator scripts. Testnet is the default; mainnet needs
// three independent confirmations so a stray shell variable or a copied
// command cannot spend real NEAR:
//   1. the script itself opts in (allowMainnet), otherwise it stays testnet only;
//   2. `--network mainnet` on the command line and NEAR_NETWORK=mainnet in the
//      environment (server modules read the latter when they are imported);
//   3. NEAR_MAINNET_CONFIRM equal to the operator account in the key file,
//      which itself must say network "mainnet" and end in ".near".
// Pure: takes argv/env explicitly and performs no IO, so it is unit tested.
const NETWORKS = {
  testnet: { suffix: ".testnet", rpcUrl: "https://test.rpc.fastnear.com" },
  mainnet: { suffix: ".near", rpcUrl: "https://free.rpc.fastnear.com" },
};

export class NetworkGuardError extends Error {
  constructor(message) {
    super(message);
    this.code = "NETWORK_GUARD";
  }
}
const refuse = (message) => {
  throw new NetworkGuardError(message);
};

export function requestedNetwork(argv = process.argv.slice(2)) {
  const at = argv.findIndex(
    (a) => a === "--network" || a.startsWith("--network="),
  );
  if (at < 0) return "testnet";
  const value = argv[at].includes("=") ? argv[at].split("=")[1] : argv[at + 1];
  if (!Object.hasOwn(NETWORKS, value || ""))
    refuse('--network must be "testnet" or "mainnet".');
  return value;
}

export function scriptNetwork({
  operator,
  allowMainnet = false,
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const network = requestedNetwork(argv);
  if ((env.NEAR_NETWORK || "testnet") !== network)
    refuse(
      `NEAR_NETWORK (${env.NEAR_NETWORK || "unset, meaning testnet"}) does not match --network ${network}. Set both.`,
    );
  if (network === "mainnet" && !allowMainnet)
    refuse("This script is testnet only.");
  const { suffix, rpcUrl } = NETWORKS[network];
  if (operator) {
    if (
      operator.network !== network ||
      typeof operator.accountId !== "string" ||
      !operator.accountId.endsWith(suffix)
    )
      refuse(`The operator key file is not a ${network} account.`);
    if (
      network === "mainnet" &&
      env.NEAR_MAINNET_CONFIRM !== operator.accountId
    )
      refuse(
        `Mainnet requires NEAR_MAINNET_CONFIRM=${operator.accountId} (the operator account) to be set explicitly.`,
      );
  } else if (network === "mainnet")
    refuse("Mainnet scripts must name their operator key file.");
  return {
    network,
    accountSuffix: suffix,
    rpcUrl: env.NEAR_RPC_URL || rpcUrl,
  };
}

/** Refuses when the RPC node serves another chain than the selected network. */
export async function assertChain(provider, network) {
  const { chain_id } = await provider.viewNodeStatus();
  if (chain_id !== network)
    refuse(`The RPC node serves ${chain_id}, not ${network}.`);
}

// Creates the player-account factory and the gas relayer accounts as
// sub-accounts of the developer operator, funded from the operator balance.
// Writes private key files the server reads through PLAYER_FACTORY_KEY_PATH and
// RELAYER_KEY_PATH. Testnet by default. Mainnet is part of the minimal slice in
// docs/MAINNET-PLAN.md and needs `--network mainnet`, NEAR_NETWORK=mainnet,
// NEAR_MAINNET_CONFIRM=<operator account> and explicit funding amounts.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider } from "near-api-js";
import { scriptNetwork, assertChain } from "./lib/network-guard.mjs";

const operatorPath = process.env.NEAR_OPERATOR_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
const { network, rpcUrl } = scriptNetwork({ operator, allowMainnet: true });
const provider = new JsonRpcProvider({ url: rpcUrl });
await assertChain(provider, network);
const root = new Account(
  operator.accountId,
  provider,
  KeyPairSigner.fromSecretKey(operator.secretKey),
);
const NEAR = 10n ** 24n;
const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
// Testnet keeps its generous defaults; mainnet amounts are always written down.
function fundNear(name, testnetDefault) {
  const raw = process.env[name];
  if (raw === undefined && network === "testnet") return BigInt(testnetDefault) * NEAR;
  if (!/^[1-9][0-9]{0,3}$/.test(raw || ""))
    throw new Error(`${name} must be set to a whole NEAR amount (1-9999) on ${network}.`);
  return BigInt(raw) * NEAR;
}
const keyFile = (name) =>
  network === "testnet" ? `.data/${name}.json` : `.data/${name}-${network}.json`;
const plan = [
  {
    file: keyFile("player-factory"),
    accountId: process.env.PLAYER_FACTORY_ACCOUNT || `play-${stamp}.${operator.accountId}`,
    fund: fundNear("PLAYER_FACTORY_FUND_NEAR", 20),
    role: "player factory (creates and funds player sub-accounts)",
  },
  {
    file: keyFile("relayer"),
    accountId: process.env.RELAYER_ACCOUNT || `relay-${stamp}.${operator.accountId}`,
    fund: fundNear("RELAYER_FUND_NEAR", 5),
    role: "relayer (pays gas for allowlisted delegate actions)",
  },
];
mkdirSync(".data", { recursive: true, mode: 0o700 });
async function exists(accountId) {
  try {
    await provider.query({ request_type: "view_account", account_id: accountId, finality: "final" });
    return true;
  } catch (e) {
    if (String(e.message).includes("does not exist") || String(e.message).includes("UNKNOWN_ACCOUNT")) return false;
    throw e;
  }
}
const summary = [];
for (const entry of plan) {
  let record;
  if (existsSync(entry.file)) {
    record = JSON.parse(readFileSync(entry.file, "utf8"));
    if (record.network !== network)
      throw new Error(`${entry.file} is a ${record.network} key file, not ${network}.`);
    if (record.accountId !== entry.accountId)
      throw new Error(`${entry.file} belongs to ${record.accountId}; set the matching account env or move the file.`);
  } else {
    const key = KeyPair.fromRandom("ed25519");
    record = {
      network,
      accountId: entry.accountId,
      publicKey: key.getPublicKey().toString(),
      secretKey: key.toString(),
      role: entry.role,
    };
    writeFileSync(entry.file, JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" });
  }
  if (!(await exists(entry.accountId))) {
    const outcome = await root.createAccount({
      newAccountId: entry.accountId,
      publicKey: record.publicKey,
      nearToTransfer: entry.fund,
    });
    summary.push({ accountId: entry.accountId, created: true, transaction: outcome.transaction_outcome?.id || outcome.transaction?.hash });
  } else summary.push({ accountId: entry.accountId, created: false });
}
console.log(JSON.stringify({ status: "ready", network, accounts: summary }, null, 2));
console.log(`\nAdd to runtime configuration:\nPLAYER_FACTORY_ACCOUNT=${plan[0].accountId}\nPLAYER_FACTORY_KEY_PATH=${plan[0].file}\nRELAYER_KEY_PATH=${plan[1].file}`);

// Creates the player-account factory and the gas relayer accounts on testnet as
// sub-accounts of the developer operator, funded from the operator balance.
// Writes private key files the server reads through PLAYER_FACTORY_KEY_PATH and
// RELAYER_KEY_PATH. Testnet only; never run with mainnet funds.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider } from "near-api-js";

const operatorPath = process.env.NEAR_OPERATOR_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
if (operator.network !== "testnet" || !operator.accountId.endsWith(".testnet"))
  throw new Error("Testnet only.");
const provider = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com",
});
const root = new Account(
  operator.accountId,
  provider,
  KeyPairSigner.fromSecretKey(operator.secretKey),
);
const NEAR = 10n ** 24n;
const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const plan = [
  {
    file: ".data/player-factory.json",
    accountId: process.env.PLAYER_FACTORY_ACCOUNT || `play-${stamp}.${operator.accountId}`,
    fund: BigInt(process.env.PLAYER_FACTORY_FUND_NEAR || 20) * NEAR,
    role: "player factory (creates and funds player sub-accounts)",
  },
  {
    file: ".data/relayer.json",
    accountId: process.env.RELAYER_ACCOUNT || `relay-${stamp}.${operator.accountId}`,
    fund: BigInt(process.env.RELAYER_FUND_NEAR || 5) * NEAR,
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
    if (record.accountId !== entry.accountId)
      throw new Error(`${entry.file} belongs to ${record.accountId}; set the matching account env or move the file.`);
  } else {
    const key = KeyPair.fromRandom("ed25519");
    record = {
      network: "testnet",
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
console.log(JSON.stringify({ status: "ready", accounts: summary }, null, 2));
console.log(`\nAdd to runtime configuration:\nPLAYER_FACTORY_ACCOUNT=${plan[0].accountId}\nPLAYER_FACTORY_KEY_PATH=${plan[0].file}\nRELAYER_KEY_PATH=${plan[1].file}`);

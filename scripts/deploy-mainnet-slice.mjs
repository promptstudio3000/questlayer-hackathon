// One command for the minimal mainnet slice (docs/MAINNET-PLAN.md §1):
// collectibles contract, player factory + relayer accounts, NEAR Social check,
// then public/<network>-deployment.json and public/native-claims-<network>.json.
//
//   Plan only (reads the chain, signs nothing, writes nothing):
//     NEAR_NETWORK=mainnet NEAR_MAINNET_CONFIRM=<operator>.near \
//       NEAR_OPERATOR_PATH=.data/near-operator-mainnet.json \
//       AWARD_SIGNER_PATH=.data/award-attestor-mainnet.pem \
//       COLLECTIBLES_FUND_NEAR=4.5 PLAYER_FACTORY_FUND_NEAR=5 RELAYER_FUND_NEAR=5 \
//       node scripts/deploy-mainnet-slice.mjs --network mainnet
//   Execute: the same command with --execute. Re-running is safe: finished steps
//   are checked and skipped, and a mismatch stops the run.
//
// Testnet works the same without --network (default amounts, no confirmation),
// which is how the slice is rehearsed against a real chain. See
// docs/OWNER-RUNBOOK.md §7.
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import { dirname } from "node:path";
import {
  Account,
  KeyPair,
  KeyPairSigner,
  JsonRpcProvider,
  PublicKey,
  actions,
} from "near-api-js";
import { scriptNetwork, requestedNetwork } from "./lib/network-guard.mjs";
import {
  slicePlan,
  runSlice,
  describePlan,
  runtimeEnvText,
} from "./lib/mainnet-slice.mjs";

const argv = process.argv.slice(2);
const execute = argv.includes("--execute");
const requested = requestedNetwork(argv);
const operatorPath =
  process.env.NEAR_OPERATOR_PATH ||
  (requested === "mainnet"
    ? ".data/near-operator-mainnet.json"
    : ".data/near-operator.json");
const privateFile = (path, what) => {
  if (!existsSync(path)) throw new Error(`${what} ${path} does not exist.`);
  if ((statSync(path).mode & 0o077) !== 0)
    throw new Error(`${what} ${path} must be mode 600.`);
};
privateFile(operatorPath, "The operator key file");
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
const { network, rpcUrl } = scriptNetwork({
  operator,
  allowMainnet: true,
  argv,
});
if (network === "mainnet" && !process.env.AWARD_SIGNER_PATH)
  throw new Error(
    "Mainnet requires AWARD_SIGNER_PATH (a mainnet-only Ed25519 PEM, never the testnet one).",
  );
const awardPath = process.env.AWARD_SIGNER_PATH || ".data/award-attestor.pem";

// The award signer key: created once (exclusive, mode 600) when executing;
// a plan never creates it.
function awardPublicKey() {
  if (!existsSync(awardPath)) {
    if (!execute) return "A".repeat(43) + "="; // placeholder for the plan only
    mkdirSync(dirname(awardPath), { recursive: true, mode: 0o700 });
    const pair = generateKeyPairSync("ed25519");
    writeFileSync(
      awardPath,
      pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      { flag: "wx", mode: 0o600 },
    );
  }
  privateFile(awardPath, "The award signer key");
  return createPublicKey(createPrivateKey(readFileSync(awardPath)))
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("base64");
}

const provider = new JsonRpcProvider({ url: rpcUrl });
const signer = KeyPairSigner.fromSecretKey(operator.secretKey);
const root = new Account(operator.accountId, provider, signer);
// The operator key must be a full-access key of the operator account; a plan
// only warns so it can run with a placeholder key file.
const operatorKey = (await signer.getPublicKey()).toString();
const access = await provider
  .query({
    request_type: "view_access_key",
    account_id: operator.accountId,
    public_key: operatorKey,
    finality: "final",
  })
  .catch(() => null);
if (access?.permission !== "FullAccess") {
  if (execute)
    throw new Error(
      `${operatorKey} is not a full-access key of ${operator.accountId}.`,
    );
  console.log(
    `warning: ${operatorKey} is not a full-access key of ${operator.accountId}; --execute would stop here.`,
  );
}
const wasmPath =
  process.env.COLLECTIBLES_WASM_PATH ||
  "contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm";
if (!existsSync(wasmPath))
  throw new Error(
    `${wasmPath} is missing; run bash scripts/build-contracts.sh first.`,
  );
const wasm = readFileSync(wasmPath);
// The reviewed build's fingerprint is recorded in the repository
// (contracts/collectibles/WASM_SHA256, docs/COLLECTIBLES-REVIEW.md); the env
// value, when given, must agree with it.
const recordedPath = "contracts/collectibles/WASM_SHA256";
const recorded = existsSync(recordedPath)
  ? readFileSync(recordedPath, "utf8").trim().split(/\s+/)[0]
  : undefined;
const reviewedEnv = process.env.COLLECTIBLES_WASM_SHA256;
if (recorded && reviewedEnv && reviewedEnv.toLowerCase() !== recorded)
  throw new Error(
    `COLLECTIBLES_WASM_SHA256 differs from ${recordedPath} (${recorded}).`,
  );
const plan = slicePlan({
  network,
  operatorId: operator.accountId,
  env: { ...process.env, COLLECTIBLES_WASM_SHA256: reviewedEnv || recorded },
  wasm,
  awardPublicKey: awardPublicKey(),
  stamp: new Date().toISOString().slice(0, 10).replaceAll("-", ""),
});
console.log(
  JSON.stringify(
    { mode: execute ? "execute" : "plan", plan: describePlan(plan) },
    null,
    2,
  ),
);

const GAS = 100n * 10n ** 12n;
const hashOf = (r) => {
  if (r?.status?.Failure)
    throw new Error(`Transaction failed: ${JSON.stringify(r.status.Failure)}`);
  return r?.transaction?.hash || r?.transaction_outcome?.id;
};
const chain = {
  chainId: async () => (await provider.viewNodeStatus()).chain_id,
  async account(accountId) {
    try {
      return await provider.query({
        request_type: "view_account",
        account_id: accountId,
        finality: "final",
      });
    } catch (e) {
      if (/does not exist|UNKNOWN_ACCOUNT/.test(String(e?.message || e)))
        return null;
      throw e;
    }
  },
  async view(accountId, method, args = {}) {
    const r = await provider.query({
      request_type: "call_function",
      account_id: accountId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "final",
    });
    return JSON.parse(Buffer.from(r.result).toString() || "null");
  },
  // One transaction: the account never exists without its initialised code.
  // The operator's key is added so the owner can ship reviewed upgrades.
  deployContractAccount: async ({ accountId, fund, wasm, initArgs }) =>
    hashOf(
      await root.signAndSendTransaction({
        receiverId: accountId,
        actions: [
          actions.createAccount(),
          actions.transfer(fund),
          actions.addFullAccessKey(PublicKey.fromString(operatorKey)),
          actions.deployContract(wasm),
          actions.functionCall("new", initArgs, GAS, 0n),
        ],
        waitUntil: "FINAL",
      }),
    ),
  createAccount: async ({ accountId, publicKey, fund }) =>
    hashOf(
      await root.createAccount({
        newAccountId: accountId,
        publicKey,
        nearToTransfer: fund,
      }),
    ),
  call: async (contractId, methodName, args, deposit) =>
    hashOf(
      await root.callFunctionRaw({
        contractId,
        methodName,
        args,
        deposit,
        gas: GAS,
        waitUntil: "FINAL",
      }),
    ),
};
const keys = {
  read: (file) =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null,
  create(file, record) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(record, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  },
  newKeyPair() {
    const key = KeyPair.fromRandom("ed25519");
    return {
      publicKey: key.getPublicKey().toString(),
      secretKey: key.toString(),
    };
  },
};

const result = await runSlice({ plan, chain, keys, execute, wasm });
console.log(
  JSON.stringify({ status: result.status, steps: result.steps }, null, 2),
);
if (result.status !== "deployed") {
  console.log("\nNothing was signed. Re-run with --execute to deploy.");
  process.exit(0);
}
// Mainnet manifests go where the server reads them. A testnet rehearsal must
// not replace the live testnet manifests, so it writes next to its output.
const manifestDir =
  process.env.SLICE_MANIFEST_DIR ||
  (network === "mainnet" ? "public" : "output/mainnet-slice-testnet");
mkdirSync(manifestDir, { recursive: true });
// A resumed run keeps the transactions recorded by the earlier one.
for (const [name, body] of Object.entries(result.manifests)) {
  const path = `${manifestDir}/${name}`;
  const before = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : null;
  if (
    before &&
    (before.network !== network ||
      (before.contractId ?? before.collectiblesContract) !==
        (body.contractId ?? body.collectiblesContract))
  )
    throw new Error(
      `${path} describes another deployment; move it aside first.`,
    );
  if (before && body.transactions.length === 0) {
    console.log(`${path} unchanged (nothing new was sent)`);
    continue;
  }
  if (before)
    body.transactions = [...(before.transactions || []), ...body.transactions];
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n");
  console.log(`wrote ${path}`);
}
const envFile = `.data/runtime-${network}.env`;
writeFileSync(envFile, runtimeEnvText(result.runtimeEnv), { mode: 0o600 });
console.log(
  `wrote ${envFile} (merge into the VPS runtime.env; key paths are the Mac paths)`,
);

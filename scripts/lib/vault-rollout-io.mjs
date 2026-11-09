// IO shared by the two vault rollout scripts: RPC views, pinned WASM, the
// operator key (only with --execute), code backups, deploys and the plan log.
// Pure logic lives in ./vault-rollout.mjs.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Account, JsonRpcProvider, KeyPairSigner, actions } from "near-api-js";
import { assertChain, scriptNetwork } from "./network-guard.mjs";
import { codeHashOf, sha256Hex } from "./vault-rollout.mjs";

export const TGAS = 10n ** 12n;
export const PINS_PATH = "contracts/wasm-sha256.json";

export function connect(opts) {
  const { network, rpcUrl } = scriptNetwork({ argv: ["--network", opts.network] });
  assert.equal(network, "testnet", "Testnet only.");
  const provider = new JsonRpcProvider({ url: rpcUrl }, { retries: 2, wait: 250, backoff: 1.5 });
  const ref = (block) => (block ? { block_id: block } : { finality: "final" });
  const query = (params, block) => provider.query({ ...params, ...ref(block) });
  const rpc = {
    provider,
    network,
    rpcUrl,
    assertChain: () => assertChain(provider, network),
    async view(accountId, method, args = {}, block) {
      const r = await query({ request_type: "call_function", account_id: accountId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") }, block);
      return JSON.parse(Buffer.from(r.result).toString());
    },
    account: (accountId, block) => query({ request_type: "view_account", account_id: accountId }, block),
    async keys(accountId) {
      return (await query({ request_type: "view_access_key_list", account_id: accountId })).keys;
    },
    async code(accountId, block) {
      return Buffer.from((await query({ request_type: "view_code", account_id: accountId }, block)).code_base64, "base64");
    },
    async rawState(accountId, block) {
      const r = await query({ request_type: "view_state", account_id: accountId, prefix_base64: "" }, block);
      return { blockHeight: r.block_height, values: r.values.map(({ key, value }) => ({ key, value })) };
    },
    async finalHeight() {
      return (await provider.viewBlock({ finality: "final" })).header.height;
    },
  };
  return rpc;
}

/** Reads one pinned contract WASM and refuses anything but the reproducible build. */
export function pinnedWasm(name, wasmDir) {
  const path = join(wasmDir, `${name}.wasm`);
  assert(existsSync(path), `${path} is missing: run npm run contracts:docker, or pass --wasm-dir with the CI artifact contract-wasm-linux-amd64.`);
  const bytes = readFileSync(path);
  const pin = JSON.parse(readFileSync(PINS_PATH, "utf8")).contracts[name];
  const sha = sha256Hex(bytes);
  assert.equal(sha, pin, `${path} is not the reproducible build pinned in ${PINS_PATH} (macOS builds hash differently).`);
  return { name, path, bytes, sha256: sha, codeHash: codeHashOf(bytes), size: bytes.length };
}

/** The operator key, only for --execute. Never printed. */
export function loadOperator() {
  const path = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
  assert.equal(statSync(path).mode & 0o077, 0, `${path} must be private (chmod 600).`);
  const operator = JSON.parse(readFileSync(path, "utf8"));
  scriptNetwork({ operator, argv: ["--network", "testnet"] });
  return { accountId: operator.accountId, publicKey: operator.publicKey, signer: KeyPairSigner.fromSecretKey(operator.secretKey) };
}

export async function assertFullAccessKey(rpc, accountId, publicKey) {
  const keys = await rpc.keys(accountId);
  assert(
    keys.some((k) => k.public_key === publicKey && k.access_key.permission === "FullAccess"),
    `${accountId} has no FullAccess key for the operator key in this machine's key file.`,
  );
}

/** Saves the currently deployed code so it can be redeployed as a rollback. */
export async function backupCode(rpc, accountId, expectedCodeHash) {
  const bytes = await rpc.code(accountId);
  assert.equal(codeHashOf(bytes), expectedCodeHash, `${accountId}: downloaded code does not hash to ${expectedCodeHash}.`);
  const dir = ".data/contract-backups";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = `${dir}/${accountId}-${expectedCodeHash}.wasm`;
  if (!existsSync(path)) writeFileSync(path, bytes, { mode: 0o600 });
  else assert.equal(codeHashOf(readFileSync(path)), expectedCodeHash, `${path} exists with other bytes.`);
  return { path, sha256: sha256Hex(bytes), size: bytes.length };
}

/**
 * Sends one transaction from `signerId` (to itself unless `receiverId` is given)
 * and waits for finality; returns the hash and the block that executed it.
 * A deploy is always signed by the account itself; an owner call by the owner.
 */
export async function sendActions(rpc, signer, signerId, acts, receiverId = signerId) {
  const out = await new Account(signerId, rpc.provider, signer).signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL" });
  const failed = [out.status, ...(out.receipts_outcome || []).map((r) => r.outcome.status)].find((s) => s?.Failure);
  assert(!failed, `${signerId} -> ${receiverId}: transaction failed ${JSON.stringify(failed)}`);
  const blockHash = out.receipts_outcome?.at(-1)?.block_hash;
  const block = blockHash ? (await rpc.provider.viewBlock({ blockId: blockHash })).header.height : null;
  return { transactionHash: out.transaction.hash, executedAtBlock: block };
}
export const deployAction = (bytes) => actions.deployContract(bytes);
export const callAction = (method, args, gasTgas = 30n, deposit = 0n) => actions.functionCall(method, args, gasTgas * TGAS, deposit);

/** Plan/journal printer: every action is printed; only --execute sends. */
export function planLog(execute) {
  const steps = [];
  return {
    steps,
    info: (step, data = {}) => console.log(JSON.stringify({ step, ...data })),
    action(label, data = {}) {
      steps.push({ label, ...data });
      console.log(JSON.stringify({ [execute ? "send" : "dry-run would send"]: label, ...data }));
    },
  };
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}
export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

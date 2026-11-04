// Deploys the on-chain ledger (docs/CHAIN-LEDGER.md) on testnet: the QXP
// ledger contract and its QGOLD token, installs a bounded recorder key for the
// game server and proves one recorded action end to end:
//   recorder key -> record_batch -> QXP ft_mint + QGOLD ft_mint (same tx)
//   -> profile view -> ft_transfer refused (soulbound).
//
// Testnet only. Deploys the Linux/Docker WASM pinned in contracts/wasm-sha256.json.
//
//   node scripts/deploy-ledger-testnet.mjs
//   then: bash scripts/install-ledger-recorder-vps.sh, commit public/native-ledger-testnet.json, deploy
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer);
const ledgerId =
  process.env.NEAR_LEDGER_ACCOUNT || "questlayer-ledger-20261104.testnet";
const goldId =
  process.env.NEAR_QGOLD_ACCOUNT || "questlayer-qgold-20261104.testnet";
assert(
  ledgerId.endsWith(".testnet") && goldId.endsWith(".testnet"),
  "Testnet only",
);

const pins = JSON.parse(readFileSync("contracts/wasm-sha256.json")).contracts;
function wasmOf(name) {
  const path = `contracts/target/wasm32-unknown-unknown/release/${name}.wasm`;
  const bytes = readFileSync(path);
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    sha,
    pins[name],
    `${path} is not the reproducible build (run npm run contracts:docker or use the CI artifact)`,
  );
  return { bytes, sha };
}
const ledgerWasm = wasmOf("questlayer_ledger"),
  goldWasm = wasmOf("questlayer_soulbound_ft");

// Recorder: a function-call key on the ledger account for record_batch, commit_day and retry_gold only.
const recorderPath = ".data/ledger-recorder.json";
if (!existsSync(recorderPath)) {
  const pair = KeyPair.fromRandom("ed25519");
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(
    recorderPath,
    JSON.stringify({
      network: "testnet",
      accountId: ledgerId,
      secretKey: pair.toString(),
      publicKey: pair.getPublicKey().toString(),
    }),
    { mode: 0o600, flag: "wx" },
  );
}
const recorder = JSON.parse(readFileSync(recorderPath));
assert.equal(
  recorder.accountId,
  ledgerId,
  `${recorderPath} belongs to another contract`,
);

const journal = ".data/ledger-deploy-journal.json",
  transactions = existsSync(journal) ? JSON.parse(readFileSync(journal)) : [];
async function record(label, fn) {
  const r = await fn();
  assert(!r.status?.Failure, label + " failed: " + JSON.stringify(r.status));
  const tx = r.transaction?.hash || r.transaction_outcome?.id;
  transactions.push({ label, transaction: tx });
  writeFileSync(journal, JSON.stringify(transactions, null, 2));
  console.log(JSON.stringify({ label, transaction: tx }));
  return r;
}
async function view(contractId, method, args = {}) {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
}
async function ensureAccount(accountId) {
  try {
    return await provider.viewAccount({ accountId });
  } catch (e) {
    if (!/does not exist|unknown_account/i.test(rpcErrorText(e))) throw e;
  }
  const r = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: operator.publicKey,
    }),
    signal: AbortSignal.timeout(30000),
  });
  assert(
    r.ok,
    "Testnet helper could not create " +
      accountId +
      ": " +
      (await r.text()).slice(0, 200),
  );
  console.log(
    JSON.stringify({
      step: "Create account through the official testnet helper",
      accountId,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return provider.viewAccount({ accountId });
}
async function deployOnce(accountId, wasm, initArgs) {
  const account = new Account(accountId, provider, signer);
  const state = await provider.query({
    request_type: "view_state",
    account_id: accountId,
    prefix_base64: "",
    finality: "final",
  });
  if (!state.values?.some((v) => v.key === "U1RBVEU=")) {
    await record("Deploy and initialize " + accountId, () =>
      account.signAndSendTransaction({
        receiverId: accountId,
        actions: [
          actions.deployContract(wasm.bytes),
          actions.functionCall("new", initArgs, 100n * 10n ** 12n, 0n),
        ],
        waitUntil: "FINAL",
      }),
    );
  } else {
    const code = await provider.query({
      request_type: "view_code",
      account_id: accountId,
      finality: "final",
    });
    assert(
      Buffer.from(code.code_base64, "base64").equals(wasm.bytes),
      `${accountId}: deployed code differs; refusing an implicit upgrade.`,
    );
  }
  return account;
}

const icon = (letter, color) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="${color}"/><text x="16" y="21" font-family="sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`,
  );
const meta = (name, symbol, decimals, i) => ({
  spec: "ft-1.0.0",
  name,
  symbol,
  icon: i,
  reference: null,
  reference_hash: null,
  decimals,
});

await ensureAccount(goldId);
await ensureAccount(ledgerId);
await deployOnce(goldId, goldWasm, {
  owner_id: operator.accountId,
  minter_id: ledgerId,
  metadata: meta(
    "QuestLayer Gold (soulbound)",
    "QGOLD",
    6,
    icon("G", "#c08a2b"),
  ),
});
const ledger = await deployOnce(ledgerId, ledgerWasm, {
  owner_id: operator.accountId,
  gold_token: goldId,
  metadata: meta("QuestLayer XP (soulbound)", "QXP", 0, icon("XP", "#6b3fa0")),
  level_base_xp: "100",
  max_level: 10,
});
assert.equal((await view(goldId, "get_config")).minter_id, ledgerId);
assert.equal((await view(ledgerId, "get_config")).gold_token, goldId);

const keys = await provider.query({
  request_type: "view_access_key_list",
  account_id: ledgerId,
  finality: "final",
});
if (!keys.keys.some((k) => k.public_key === recorder.publicKey))
  await record(
    "Install the bounded recorder key (record_batch, commit_day, retry_gold)",
    () =>
      ledger.signAndSendTransaction({
        receiverId: ledgerId,
        actions: [
          actions.addFunctionCallAccessKey(
            KeyPair.fromString(recorder.secretKey).getPublicKey(),
            ledgerId,
            ["record_batch", "commit_day", "retry_gold"],
            5n * 10n ** 24n,
          ),
        ],
        waitUntil: "FINAL",
      }),
  );

// Smoke: the recorder records one action for the operator.
const recorderAccount = new Account(
  ledgerId,
  provider,
  KeyPairSigner.fromSecretKey(recorder.secretKey),
);
let smoke = await view(ledgerId, "profile", { account_id: operator.accountId });
if (!smoke) {
  const ev = createHash("sha256")
    .update("questlayer ledger testnet smoke")
    .digest("hex");
  await record("Recorder records a smoke action (QXP + QGOLD mint)", () =>
    recorderAccount.callFunctionRaw({
      contractId: ledgerId,
      methodName: "record_batch",
      args: {
        actions: [
          {
            account_id: operator.accountId,
            seq: "1",
            kind: "other",
            xp: "1",
            gold: "1000000",
            count: 1,
            cell: "u2fkb7x",
            at_ms: String(Date.now()),
            ev,
            ref_id: "smoke-ledger-testnet",
          },
        ],
      },
      deposit: 0n,
      gas: 150n * 10n ** 12n,
      waitUntil: "FINAL",
    }),
  );
  smoke = await view(ledgerId, "profile", { account_id: operator.accountId });
}
assert.equal(smoke.xp, "1");
assert.equal(
  await view(ledgerId, "ft_balance_of", { account_id: operator.accountId }),
  "1",
);
assert.equal(
  await view(goldId, "ft_balance_of", { account_id: operator.accountId }),
  "1000000",
);
let refused = false;
try {
  const r = await root.callFunctionRaw({
    contractId: ledgerId,
    methodName: "ft_transfer",
    args: { receiver_id: ledgerId, amount: "1" },
    deposit: 1n,
    gas: 30n * 10n ** 12n,
    waitUntil: "FINAL",
  });
  refused = !!r.status?.Failure;
} catch (e) {
  // The release WASM aborts without its panic text ("unreachable" trap), so
  // any contract execution failure counts as the refusal.
  refused =
    /soulbound/i.test(rpcErrorText(e)) || e?.name === "ContractExecutionError" || e?.constructor?.name === "ContractExecutionError";
}
assert(refused, "QXP ft_transfer must fail");

const ledgerAccount = await provider.viewAccount({ accountId: ledgerId }),
  goldAccount = await provider.viewAccount({ accountId: goldId });
mkdirSync("output/qa/2026-11-testnet", { recursive: true });
const manifest = {
  network: "testnet",
  verifiedAt: new Date().toISOString(),
  contractId: ledgerId,
  codeHash: ledgerAccount.code_hash,
  wasmSha256: ledgerWasm.sha,
  token: { symbol: "QXP", decimals: 0 },
  goldToken: {
    contractId: goldId,
    symbol: "QGOLD",
    decimals: 6,
    codeHash: goldAccount.code_hash,
    wasmSha256: goldWasm.sha,
  },
  recorderPublicKey: recorder.publicKey,
  recorderMethods: ["record_batch", "commit_day", "retry_gold"],
  levelBaseXp: 100,
  maxLevel: 10,
  cellPrecision: 7,
  transferable: false,
  capabilities: [
    "soulbound-nep141",
    "action-memos",
    "batched-records",
    "seq-idempotent",
    "profile-view",
    "daily-merkle-root",
    "verify-proof",
  ],
};
writeFileSync(
  "public/native-ledger-testnet.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
writeFileSync(
  "output/qa/2026-11-testnet/ledger-proof.json",
  JSON.stringify(
    { ...manifest, smoke: { profile: smoke }, transactions },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    status: "verified",
    ledgerId,
    goldId,
    next: "bash scripts/install-ledger-recorder-vps.sh, commit public/native-ledger-testnet.json, deploy",
  }),
);

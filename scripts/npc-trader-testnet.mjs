// NPC trader accounts on testnet (N3, docs/NPC-TRADERS.md). Runs on the
// operator's machine: it reads .data/near-operator.json and writes the private
// traders file .data/npc-traders.json (mode 600, never committed).
//
//   node scripts/npc-trader-testnet.mjs setup                 # dry run: show the plan
//   node scripts/npc-trader-testnet.mjs setup --execute       # create + fund + register
//   node scripts/npc-trader-testnet.mjs status                # float, stock, signing keys
//   node scripts/npc-trader-testnet.mjs cancel-all --execute  # emergency: void every NPC order
//
// setup, per trader in server/data/actors/<city>.json (archetype "trader"):
//   1. create npc-<actor>.<operator>.testnet with 2.6 test NEAR (2 float + gas/storage),
//   2. add_signing_key on the market (1 yocto) with a separate order-signing key,
//   3. deposit_near 2 test NEAR: the trader's float.
// Then install the file on the VPS with scripts/install-npc-traders-vps.sh.
// Testnet only; mainnet is refused.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

const [command = "status", ...rest] = process.argv.slice(2);
const EXECUTE = rest.includes("--execute");
const cityArg = rest.find((a) => a.startsWith("--city="))?.slice(7) || "plzen";
const NEAR = 10n ** 24n;
const FLOAT = 2n * NEAR;
const ACCOUNT_FUND = 26n * (NEAR / 10n);
const TGAS = 10n ** 12n;
const FILE = ".data/npc-traders.json";

const operator = JSON.parse(readFileSync(".data/near-operator.json", "utf8"));
assert.equal(operator.network, "testnet", "Testnet only.");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0, "Operator key must be private.");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet RPC only.");
const marketId = JSON.parse(readFileSync("public/native-market-testnet.json", "utf8")).marketContract;
assert.ok(marketId.endsWith(".testnet"));
const actors = JSON.parse(readFileSync(`server/data/actors/${cityArg}.json`, "utf8")).actors.filter(
  (a) => a.kind === "npc" && a.archetype === "trader" && a.enabled,
);
const log = (o) => console.log(JSON.stringify(o));
const view = async (contractId, method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
const exists = async (accountId) => {
  try {
    await provider.query({ request_type: "view_account", account_id: accountId, finality: "final" });
    return true;
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(rpcErrorText(e))) return false;
    throw e;
  }
};
const txHash = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const loadFile = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { network: "testnet", traders: [] });
const saveFile = (data) => {
  writeFileSync(FILE + ".tmp", JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(FILE, readFileSync(FILE + ".tmp"), { mode: 0o600 });
};

if (command === "setup") {
  const file = loadFile();
  assert.equal(file.network, "testnet");
  const root = new Account(operator.accountId, provider, KeyPairSigner.fromSecretKey(operator.secretKey));
  for (const actor of actors) {
    const accountId = `npc-${actor.id}.${operator.accountId}`;
    assert.ok(accountId.length <= 64, `${accountId} is too long for a NEAR account.`);
    let entry = file.traders.find((t) => t.actorId === actor.id);
    if (!entry) {
      entry = {
        actorId: actor.id,
        accountId,
        accountKey: KeyPair.fromRandom("ed25519").toString(),
        signingKey: KeyPair.fromRandom("ed25519").toString(),
        fundedAt: null,
      };
      file.traders.push(entry);
    }
    assert.equal(entry.accountId, accountId, "Traders file names another account.");
    const accountPub = KeyPair.fromString(entry.accountKey).getPublicKey().toString();
    const signingPub = KeyPair.fromString(entry.signingKey).getPublicKey().toString();
    const plan = { actorId: actor.id, accountId, accountPublicKey: accountPub, signingPublicKey: signingPub, steps: [] };
    if (EXECUTE) saveFile(file); // keys are on disk before any NEAR moves
    if (!(await exists(accountId))) {
      plan.steps.push({ step: "create", fund: "2.6" });
      if (EXECUTE)
        plan.steps.at(-1).tx = txHash(
          await root.createAccount({ newAccountId: accountId, publicKey: accountPub, nearToTransfer: ACCOUNT_FUND }),
        );
    }
    const npc = new Account(accountId, provider, KeyPairSigner.fromSecretKey(entry.accountKey));
    const signer = (await exists(accountId)) ? await view(marketId, "get_signer", { account_id: accountId }) : { keys: [] };
    if (!signer.keys.includes(signingPub)) {
      plan.steps.push({ step: "add_signing_key" });
      if (EXECUTE)
        plan.steps.at(-1).tx = txHash(
          await npc.callFunctionRaw({ contractId: marketId, methodName: "add_signing_key", args: { public_key: signingPub }, deposit: 1n, gas: 30n * TGAS, waitUntil: "FINAL" }),
        );
    }
    const credit = (await exists(accountId)) ? BigInt((await view(marketId, "get_account", { account_id: accountId })).credit) : 0n;
    if (!entry.fundedAt && credit < FLOAT) {
      plan.steps.push({ step: "deposit_near", amount: (FLOAT - credit).toString() });
      if (EXECUTE) {
        plan.steps.at(-1).tx = txHash(
          await npc.callFunctionRaw({ contractId: marketId, methodName: "deposit_near", args: {}, deposit: FLOAT - credit, gas: 30n * TGAS, waitUntil: "FINAL" }),
        );
      }
    }
    if (EXECUTE && !entry.fundedAt) {
      entry.fundedAt = new Date().toISOString();
      saveFile(file);
    }
    log({ ...plan, execute: EXECUTE });
  }
  if (!EXECUTE) log({ note: "Dry run. Re-run with --execute to create, fund and register the traders." });
} else if (command === "status") {
  const file = loadFile();
  for (const t of file.traders) {
    const ok = await exists(t.accountId);
    const signer = ok ? await view(marketId, "get_signer", { account_id: t.accountId }) : null;
    const acct = ok ? await view(marketId, "get_account", { account_id: t.accountId }) : null;
    log({
      actorId: t.actorId,
      accountId: t.accountId,
      exists: ok,
      signingKeyRegistered: !!signer?.keys.includes(KeyPair.fromString(t.signingKey).getPublicKey().toString()),
      epoch: signer?.epoch ?? null,
      marketCredit: acct?.credit ?? null,
      listed: acct?.listed ?? null,
      fundedAt: t.fundedAt,
    });
  }
} else if (command === "cancel-all") {
  for (const t of loadFile().traders) {
    const step = { actorId: t.actorId, step: "cancel_all_orders", execute: EXECUTE };
    if (EXECUTE) {
      const npc = new Account(t.accountId, provider, KeyPairSigner.fromSecretKey(t.accountKey));
      step.tx = txHash(
        await npc.callFunctionRaw({ contractId: marketId, methodName: "cancel_all_orders", args: {}, deposit: 1n, gas: 30n * TGAS, waitUntil: "FINAL" }),
      );
    }
    log(step);
  }
} else {
  console.error("Usage: node scripts/npc-trader-testnet.mjs setup|status|cancel-all [--execute]");
  process.exit(2);
}

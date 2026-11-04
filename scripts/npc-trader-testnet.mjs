// NPC trader accounts on testnet (N3, docs/NPC-TRADERS.md). Runs on the
// operator's machine: it reads .data/near-operator.json and writes the private
// traders file .data/npc-traders.json (mode 600, never committed).
//
//   node scripts/npc-trader-testnet.mjs setup                    # dry run: show the plan
//   node scripts/npc-trader-testnet.mjs setup --execute          # create + register + fund
//   node scripts/npc-trader-testnet.mjs status                   # purse, stock, signing key
//   node scripts/npc-trader-testnet.mjs leave-market --execute   # once: take stock + credit out of market v2
//   node scripts/npc-trader-testnet.mjs cancel-all --execute     # emergency: remove the signing key
//
// Traders trade on the game's NEAR Intents verifier (public/native-intents-testnet.json).
// setup, per trader in server/data/actors/<city>.json (archetype "trader"):
//   1. create npc-<actor>.<operator>.testnet with 2.6 test NEAR (2 float + gas/storage),
//   2. add_public_key on the verifier (1 yocto) with a separate intent-signing key,
//   3. wrap 2 test NEAR and deposit it into the verifier: the trader's float.
// The VPS keeper repeats 2 and 3 when needed and deposits stock into the verifier.
// Then install the file on the VPS with scripts/install-npc-traders-vps.sh.
// leave-market: traders used market v2 before 4 Nov 2026; this returns their
// escrowed Auras (cancel) and credit (withdraw) to the trader account, where
// the keeper picks them up. Testnet only; mainnet is refused.
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
const intents = JSON.parse(readFileSync("public/native-intents-testnet.json", "utf8"));
const verifierId = intents.verifierContract,
  WNEAR = intents.wnear,
  WNEAR_STORAGE = 125n * 10n ** 19n;
assert.ok(marketId.endsWith(".testnet") && verifierId.endsWith(".testnet") && WNEAR.endsWith(".testnet"));
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
    const call = (contractId, methodName, args, deposit, gas = 30n * TGAS) =>
      npc.callFunctionRaw({ contractId, methodName, args, deposit, gas, waitUntil: "FINAL" }).then(txHash);
    const registered = (await exists(accountId)) ? await view(verifierId, "has_public_key", { account_id: accountId, public_key: signingPub }) : false;
    if (!registered) {
      plan.steps.push({ step: "add_public_key", verifier: verifierId });
      if (EXECUTE) plan.steps.at(-1).tx = await call(verifierId, "add_public_key", { public_key: signingPub }, 1n);
    }
    const purse = (await exists(accountId)) ? BigInt(await view(verifierId, "mt_balance_of", { account_id: accountId, token_id: `nep141:${WNEAR}` })) : 0n;
    if (!entry.fundedAt && purse < FLOAT) {
      const amount = FLOAT - purse;
      plan.steps.push({ step: "wrap and deposit into the verifier", amount: amount.toString() });
      if (EXECUTE) {
        await call(WNEAR, "storage_deposit", { account_id: accountId, registration_only: true }, WNEAR_STORAGE);
        await call(WNEAR, "near_deposit", {}, amount);
        plan.steps.at(-1).tx = await call(WNEAR, "ft_transfer_call", { receiver_id: verifierId, amount: amount.toString(), msg: "" }, 1n, 100n * TGAS);
      }
    }
    if (EXECUTE && !entry.fundedAt) {
      entry.fundedAt = new Date().toISOString();
      saveFile(file);
    }
    log({ ...plan, execute: EXECUTE });
  }
  if (!EXECUTE) log({ note: "Dry run. Re-run with --execute to create, register and fund the traders on the verifier." });
} else if (command === "status") {
  const file = loadFile();
  for (const t of file.traders) {
    const ok = await exists(t.accountId);
    const signingPub = KeyPair.fromString(t.signingKey).getPublicKey().toString();
    const owned = ok ? await view(verifierId, "mt_tokens_for_owner", { account_id: t.accountId, from_index: "0", limit: 100 }) : [];
    const market = ok ? await view(marketId, "get_account", { account_id: t.accountId }) : null;
    const listings = ok ? (await view(marketId, "get_listings", { from_index: 0, limit: 100 })).filter((l) => l.seller === t.accountId) : [];
    log({
      actorId: t.actorId,
      accountId: t.accountId,
      exists: ok,
      verifier: verifierId,
      signingKeyRegistered: ok ? await view(verifierId, "has_public_key", { account_id: t.accountId, public_key: signingPub }) : false,
      purse: ok ? await view(verifierId, "mt_balance_of", { account_id: t.accountId, token_id: `nep141:${WNEAR}` }) : null,
      stock: owned.map((x) => x.token_id).filter((id) => id.startsWith("nep171:")),
      leftInMarketV2: { credit: market?.credit ?? null, listings: listings.map((l) => l.token_id) },
      fundedAt: t.fundedAt,
    });
  }
} else if (command === "leave-market") {
  // One time: market v2 escrow and credit back to the trader account. The
  // keeper then deposits the Auras and the NEAR into the verifier.
  for (const t of loadFile().traders) {
    if (!(await exists(t.accountId))) continue;
    const npc = new Account(t.accountId, provider, KeyPairSigner.fromSecretKey(t.accountKey));
    const call = (methodName, args) =>
      npc.callFunctionRaw({ contractId: marketId, methodName, args, deposit: 1n, gas: 100n * TGAS, waitUntil: "FINAL" }).then(txHash);
    const listings = (await view(marketId, "get_listings", { from_index: 0, limit: 100 })).filter(
      (l) => l.seller === t.accountId && /deposited|active/i.test(String(l.state)),
    );
    for (const l of listings) {
      const step = { actorId: t.actorId, step: "cancel", tokenId: l.token_id, execute: EXECUTE };
      if (EXECUTE) step.tx = await call("cancel", { token_id: l.token_id, listing_id: l.id });
      log(step);
    }
    const credit = BigInt((await view(marketId, "get_account", { account_id: t.accountId }))?.credit || "0");
    if (credit > 0n) {
      const step = { actorId: t.actorId, step: "withdraw", amount: credit.toString(), execute: EXECUTE };
      if (EXECUTE) step.tx = await call("withdraw", {});
      log(step);
    }
  }
  if (!EXECUTE) log({ note: "Dry run. Re-run with --execute to move the traders out of market v2." });
} else if (command === "cancel-all") {
  // Emergency: removing the signing key voids every intent it signed. Turn
  // the traders off first (NPC_TRADER_ENABLED=0), or the keeper adds it back.
  for (const t of loadFile().traders) {
    const step = { actorId: t.actorId, step: "remove_public_key", verifier: verifierId, execute: EXECUTE };
    if (EXECUTE) {
      const npc = new Account(t.accountId, provider, KeyPairSigner.fromSecretKey(t.accountKey));
      const public_key = KeyPair.fromString(t.signingKey).getPublicKey().toString();
      step.tx = txHash(
        await npc.callFunctionRaw({ contractId: verifierId, methodName: "remove_public_key", args: { public_key }, deposit: 1n, gas: 30n * TGAS, waitUntil: "FINAL" }),
      );
    }
    log(step);
  }
} else {
  console.error("Usage: node scripts/npc-trader-testnet.mjs setup|status|leave-market|cancel-all [--execute]");
  process.exit(2);
}

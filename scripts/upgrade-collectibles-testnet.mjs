// Atomic V1 upgrade and public testnet proofs. The existing development key stays local.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, JsonRpcProvider, actions } from "near-api-js";
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.ok(operator.accountId.endsWith(".testnet"));
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer),
  contractId = `nfts.${operator.accountId}`,
  contract = new Account(contractId, provider, signer),
  explorer = new Account(`explorer.${operator.accountId}`, provider, signer),
  NEAR = 10n ** 24n;
const wasm = readFileSync(
    "contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm",
  ),
  records = [];
const view = async (method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
async function record(label, fn) {
  const r = await fn();
  assert.ok(!r.status?.Failure, `${label} failed`);
  const transaction = r.transaction?.hash || r.transaction_outcome?.id;
  assert.ok(transaction);
  records.push({ label, transaction });
  console.log(JSON.stringify({ step: label, transaction }));
  return r;
}
const call = (account, method, args = {}, deposit = 0n) =>
  account.callFunctionRaw({
    contractId,
    methodName: method,
    args,
    deposit,
    gas: 150n * 10n ** 12n,
    waitUntil: "FINAL",
  });
const originalId = JSON.parse(
    readFileSync("public/testnet-deployment.json"),
  ).tokenId,
  beforeToken = await view("nft_token", { token_id: originalId }),
  beforeSupply = await view("nft_total_supply"),
  beforeMetadata = await view("nft_metadata"),
  beforeCode = await provider.query({
    request_type: "view_code",
    account_id: contractId,
    finality: "final",
  });
mkdirSync("output/qa/W04", { recursive: true });
writeFileSync(
  ".data/collectibles-before-v2.json",
  JSON.stringify(
    {
      contractId,
      token: beforeToken,
      supply: beforeSupply,
      metadata: beforeMetadata,
      codeHash: beforeCode.hash,
      codeBase64: beforeCode.code_base64,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
let version = 1;
try {
  version = await view("get_version");
} catch (e) {
  if (!/MethodNotFound|method .*not found|method not found/i.test(String(e?.message || e)))
    throw e;
}
if (version === 1) {
  await record("atomic deploy and state-preserving V1 migration", () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.deployContract(wasm),
        actions.functionCall("migrate", {}, 150n * 10n ** 12n, 0n),
      ],
      waitUntil: "FINAL",
    }),
  );
} else {
  assert.equal(version, 2);
  assert.ok(
    Buffer.from(beforeCode.code_base64, "base64").equals(wasm),
    "Existing V2 code differs; review a subsequent upgrade explicitly.",
  );
}
assert.equal(await view("get_version"), 2);
assert.deepEqual(
  await view("nft_token", { token_id: originalId }),
  beforeToken,
);
assert.equal(await view("nft_total_supply"), beforeSupply);
const avatarId = `avatar:${operator.accountId}`;
if (!(await view("nft_token", { token_id: avatarId })))
  await record("mint caller-owned native explorer avatar", () =>
    call(root, "mint_avatar", {}, NEAR / 20n),
  );
const avatar = await view("nft_token", { token_id: avatarId });
assert.equal(avatar.owner_id, operator.accountId);
assert.ok(avatar.metadata.media.startsWith("data:image/svg+xml;base64,"));
const claimId = "questlayer-wardrobe-v2-proof-moon",
  metadata = {
    title: "Moonwake Aura",
    description: "QuestLayer native cosmetic. Testnet proof.",
    copies: 256,
    extra: JSON.stringify({
      kind: "aura",
      edition: "moon",
      rarity: "epic",
      slots: ["above", "below"],
    }),
  };
await record("mint an idempotent native Aura claim", () =>
  call(
    root,
    "mint_aura_once",
    {
      claim_id: claimId,
      edition: "moon",
      receiver_id: operator.accountId,
      metadata,
    },
    NEAR / 20n,
  ),
);
const moon = await view("get_claim_token", { claim_id: claimId });
assert.ok(moon);
const mintedBefore = await view("edition_minted", { edition: "moon" });
await record("equip original Aura above the explorer", () =>
  call(root, "equip_aura", { token_id: originalId, slot: "above" }),
);
await record("equip Moonwake independently below", () =>
  call(root, "equip_aura", { token_id: moon, slot: "below" }),
);
assert.deepEqual(
  await view("get_equipment", { account_id: operator.accountId }),
  { above: originalId, below: moon },
);
await record("transfer equipped Aura and clear only its slot", () =>
  call(
    root,
    "nft_transfer",
    { receiver_id: explorer.accountId, token_id: moon },
    1n,
  ),
);
assert.deepEqual(
  await view("get_equipment", { account_id: operator.accountId }),
  { above: originalId, below: null },
);
await record("replay the mint claim after ownership changed", () =>
  call(
    root,
    "mint_aura_once",
    {
      claim_id: claimId,
      edition: "moon",
      receiver_id: operator.accountId,
      metadata,
    },
    NEAR / 20n,
  ),
);
assert.equal(await view("edition_minted", { edition: "moon" }), mintedBefore);
assert.equal(
  (await view("nft_token", { token_id: moon })).owner_id,
  explorer.accountId,
);
await record("return the test Aura to its development owner", () =>
  call(
    explorer,
    "nft_transfer",
    { receiver_id: operator.accountId, token_id: moon },
    1n,
  ),
);
await record("restore the below slot", () =>
  call(root, "equip_aura", { token_id: moon, slot: "below" }),
);
const equipment = await view("get_equipment", {
    account_id: operator.accountId,
  }),
  afterCode = await provider.query({
    request_type: "view_code",
    account_id: contractId,
    finality: "final",
  });
assert.ok(Buffer.from(afterCode.code_base64, "base64").equals(wasm));
assert.deepEqual(equipment, { above: originalId, below: moon });
const result = {
  network: "testnet",
  verifiedAt: new Date().toISOString(),
  contractId,
  schemaVersion: 2,
  codeHash: afterCode.hash,
  wasmSha256: createHash("sha256").update(wasm).digest("hex"),
  originalTokenPreserved: true,
  originalSupplyPreservedDuringMigration: true,
  avatarTokenId: avatarId,
  auraTokenId: moon,
  proofOwner: operator.accountId,
  equipment,
  claimReplayMintedNoAdditionalToken: true,
  transactions: records,
};
writeFileSync(
  "public/native-wardrobe-testnet.json",
  JSON.stringify(result, null, 2) + "\n",
);
writeFileSync(
  "output/qa/W04/live-wardrobe.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    status: "verified",
    contractId,
    transactions: records.length,
    schemaVersion: 2,
  }),
);

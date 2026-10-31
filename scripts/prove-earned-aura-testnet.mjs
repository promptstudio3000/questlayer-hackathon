// An end-to-end DEMO ARENA quest → native NFT proof, signed only by our local developer account.
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { createNearProvider } from "../server/near-provider.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const account = new Account(
    operator.accountId,
    provider,
    KeyPairSigner.fromSecretKey(operator.secretKey),
  ),
  base = process.env.CLAIM_API_URL || "https://questlayer.promptstudio3000.com",
  origin = process.env.CLAIM_ORIGIN || base;
assert.ok(
  ["questlayer.promptstudio3000.com", "localhost", "127.0.0.1"].includes(
    new URL(base).hostname,
  ),
);
let cookie;
async function api(path, data, expected = 200) {
  const r = await fetch(base + "/api" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      ...(data === undefined
        ? {}
        : { "Content-Type": "application/json", Origin: origin }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(45000),
  });
  const result = await r.json();
  assert.equal(
    r.status,
    expected,
    `Application request failed: ${r.status} ${result.error || ""}`,
  );
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  return result;
}
const challenge = await api("/auth/near/challenge", {
  accountId: operator.accountId,
  name: "Native proof explorer",
});
assert.equal(challenge.recipient, origin);
const signed = await signMessage({
  signerAccount: account,
  payload: {
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: new Uint8Array(Buffer.from(challenge.nonce, "base64")),
  },
});
let session = await api("/auth/near/verify", {
  challengeId: challenge.challengeId,
  accountId: operator.accountId,
  publicKey: signed.publicKey.toString(),
  signature: Buffer.from(signed.signature).toString("base64"),
});
let item = session.player.inventory.find(
  (i) => i.kind === "aura" && i.native_claim_state !== "minted",
);
let arenaQuest = null;
if (!item) {
  const world = await api("/world", { location: PLZEN.center, arena: true });
  const quest = world.quests.find(
    (q) => q.kind === "chest" && q.tier === 1 && !q.completed,
  );
  assert.ok(quest, "No free arena chest is available for this proof");
  const result = await api("/quests/claim", {
    questId: quest.id,
    fix: { lat: quest.lat, lng: quest.lng, accuracy: 0, timestamp: Date.now() },
  });
  assert.ok(result.item);
  item = result.player.inventory.find((i) => i.id === result.item.id);
  arenaQuest = quest.id;
}
assert.ok(item);
const claim = await api("/native/claims", {
  itemId: item.id,
  accountId: operator.accountId,
});
assert.equal(claim.receiver_id, operator.accountId);
assert.ok(claim.contractId.endsWith(".testnet"));
await api("/market/list", { itemId: item.id, price: 1000000 }, 409);
const view = async (method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: claim.contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
const supplyBefore = await view("nft_total_supply"),
  transactions = [];
async function redeem(label) {
  const result = await account.callFunctionRaw({
    contractId: claim.contractId,
    methodName: "redeem_aura",
    args: {
      claim_id: claim.claim_id,
      edition: claim.edition,
      receiver_id: claim.receiver_id,
      expires_at_ms: claim.expires_at,
      signature: claim.signature,
    },
    deposit: 5n * 10n ** 22n,
    gas: 150n * 10n ** 12n,
    waitUntil: "FINAL",
  });
  assert.ok(!result.status?.Failure);
  const transaction =
    result.transaction?.hash || result.transaction_outcome?.id;
  transactions.push({ label, transaction });
  console.log(JSON.stringify({ step: label, transaction }));
}
await redeem("Redeem signed earned Aura");
let confirmed = await api("/native/claims/confirm", { itemId: item.id });
assert.equal(confirmed.claim.state, "minted");
const tokenId = confirmed.claim.token_id;
assert.equal(
  (await view("nft_token", { token_id: tokenId })).owner_id,
  operator.accountId,
);
const afterFirst = await view("nft_total_supply");
await redeem("Idempotent retry of the same signed claim");
assert.equal(await view("nft_total_supply"), afterFirst);
await api("/native/claims/confirm", { itemId: item.id });
await api("/market/list", { itemId: item.id, price: 1000000 }, 409);
const equip = await account.callFunctionRaw({
  contractId: claim.contractId,
  methodName: "equip_aura",
  args: { token_id: tokenId, slot: "above" },
  deposit: 0n,
  gas: 80n * 10n ** 12n,
  waitUntil: "FINAL",
});
assert.ok(!equip.status?.Failure);
transactions.push({
  label: "Wear earned native Aura above the explorer",
  transaction: equip.transaction?.hash || equip.transaction_outcome?.id,
});
await api("/native/outfit", { enabled: true, accountId: operator.accountId });
const wardrobe = await api("/native/wardrobe?refresh=1");
assert.equal(
  wardrobe.accounts.find((a) => a.accountId === operator.accountId).equipment
    .above,
  tokenId,
);
const proof = {
  verifiedAt: new Date().toISOString(),
  application: base,
  network: "testnet",
  accountId: operator.accountId,
  contractId: claim.contractId,
  questMode: "demo arena; no physical GPS presence claimed",
  arenaQuest,
  itemId: item.id,
  claimId: claim.claim_id,
  tokenId,
  edition: claim.edition,
  supplyBefore,
  supplyAfter: afterFirst,
  duplicateRetryDidNotMint: true,
  demoTradingLocked: true,
  confirmedByApplication: true,
  nativeEquipmentVerified: true,
  playerPrivateKeyUploaded: false,
  serverWalletAccessKeysUsed: false,
  transactions,
};
mkdirSync("output/qa/W06-claims", { recursive: true });
writeFileSync(
  "output/qa/W06-claims/earned-aura-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
writeFileSync(
  "public/earned-aura-testnet.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    minted: tokenId,
    duplicateRetryDidNotMint: true,
    nativeEquipmentVerified: true,
  }),
);

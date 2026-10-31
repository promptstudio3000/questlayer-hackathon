// Own project developer account only. Writes a public, testnet-only alias and avatar reference.
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { createNearProvider } from "../server/near-provider.mjs";
import { SOCIAL_TESTNET } from "../server/native/social-profile.mjs";
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
assert.ok(operator.accountId.endsWith(".testnet"));
const base = process.env.PROFILE_API_URL || "http://127.0.0.1:8787",
  origin = process.env.PROFILE_ORIGIN || "http://localhost:5173";
assert.ok(
  ["127.0.0.1", "localhost", "questlayer.promptstudio3000.com"].includes(
    new URL(base).hostname,
  ),
);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const account = new Account(
  operator.accountId,
  provider,
  KeyPairSigner.fromSecretKey(operator.secretKey),
);
async function request(path, data, cookie) {
  const response = await fetch(base + "/api" + path, {
      method: data ? "POST" : "GET",
      headers: {
        ...(data ? { "Content-Type": "application/json", Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(45000),
    }),
    json = await response.json();
  assert.equal(
    response.status,
    200,
    `Profile request failed: ${response.status} ${json.error || ""}`,
  );
  return {
    data: json,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
const { data: challenge } = await request("/auth/near/challenge", {
  accountId: operator.accountId,
  name: "Native proof explorer",
});
assert.equal(challenge.network, "testnet");
assert.equal(challenge.recipient, origin);
const signature = await signMessage({
  signerAccount: account,
  payload: {
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: new Uint8Array(Buffer.from(challenge.nonce, "base64")),
  },
});
const session = await request("/auth/near/verify", {
  challengeId: challenge.challengeId,
  accountId: operator.accountId,
  publicKey: signature.publicKey.toString(),
  signature: Buffer.from(signature.signature).toString("base64"),
});
const before = (
  await request(
    `/native/profile?accountId=${operator.accountId}&refresh=1`,
    undefined,
    session.cookie,
  )
).data;
const quote = (
  await request(
    "/native/profile/prepare",
    { accountId: operator.accountId, publicConsent: true },
    session.cookie,
  )
).data;
assert.equal(quote.receiverId, SOCIAL_TESTNET);
assert.equal(quote.network, "testnet");
assert.deepEqual(Object.keys(quote.args.data), [operator.accountId]);
assert.ok(BigInt(quote.deposit) <= 5n * 10n ** 22n);
const response = await account.callFunctionRaw({
  contractId: SOCIAL_TESTNET,
  methodName: "set",
  args: quote.args,
  deposit: BigInt(quote.deposit),
  gas: 80n * 10n ** 12n,
  waitUntil: "FINAL",
});
assert.ok(!response.status?.Failure, "Native profile transaction failed");
let confirmation;
for (let attempt = 0; attempt < 5; attempt++) {
  confirmation = (
    await request(
      "/native/profile/confirm",
      { accountId: operator.accountId, mutationId: quote.profile.mutation_id },
      session.cookie,
    )
  ).data;
  if (confirmation.confirmed) break;
  await new Promise((resolve) => setTimeout(resolve, 800));
}
assert.equal(confirmation.confirmed, true);
assert.equal(confirmation.snapshot.profile.name, session.data.player.name);
const retry = (
  await request(
    "/native/profile/confirm",
    { accountId: operator.accountId, mutationId: quote.profile.mutation_id },
    session.cookie,
  )
).data;
assert.equal(retry.confirmed, true);
assert.equal(
  retry.player.history.filter(
    (h) =>
      h.id ===
      `native-profile:${operator.accountId}:${quote.profile.mutation_id}`,
  ).length,
  1,
);
assert.equal(retry.player.gold_u, session.data.player.gold_u);
const proof = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  api: base,
  contractId: SOCIAL_TESTNET,
  accountId: operator.accountId,
  transaction: response.transaction?.hash || response.transaction_outcome?.id,
  attachment: quote.deposit,
  previousStorage: before.storage,
  profile: confirmation.snapshot.profile,
  storage: confirmation.snapshot.storage,
  avatarVerified: confirmation.snapshot.avatarVerified,
  duplicateHistoryPrevented: true,
  demoBalanceUnchanged: true,
  playerPrivateKeysOnServer: false,
  signer:
    "Own local project developer key; not a browser or hardware-wallet approval",
  scope:
    "Only account/questlayer/profile; no location, inventory, balance or original EVM link",
};
mkdirSync("output/qa/W03-profiles", { recursive: true });
const target = process.env.PROFILE_PROOF_LABEL || "local-native-profile";
assert.ok(/^[a-z-]+$/.test(target));
writeFileSync(
  `output/qa/W03-profiles/${target}.json`,
  JSON.stringify(proof, null, 2) + "\n",
);
if(process.env.PROFILE_PROOF_PUBLISH!=="0")writeFileSync(
  "public/native-profile-testnet.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(JSON.stringify(proof));

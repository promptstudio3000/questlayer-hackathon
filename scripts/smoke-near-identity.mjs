// Uses only this project's local testnet operator. Never submits a chain transaction.
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { Account } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
const file = ".data/near-operator.json",
  operator = JSON.parse(readFileSync(file));
assert.equal(
  statSync(file).mode & 0o077,
  0,
  "Operator file must remain private",
);
assert.equal(operator.network, "testnet");
assert.ok(operator.accountId.endsWith(".testnet"));
const base = process.env.IDENTITY_API_URL || "http://127.0.0.1:8787",
  origin = process.env.IDENTITY_ORIGIN || "http://localhost:5173";
assert.ok(
  ["localhost", "127.0.0.1", "questlayer.promptstudio3000.com"].includes(
    new URL(base).hostname,
  ),
);
const account = new Account(
  operator.accountId,
  "https://rpc.testnet.near.org",
  operator.secretKey,
);
async function request(path, data, cookie) {
  const r = await fetch(base + "/api" + path, {
    method: data ? "POST" : "GET",
    headers: {
      ...(data ? { "Content-Type": "application/json", Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(45000),
  });
  const json = await r.json();
  assert.equal(
    r.status,
    200,
    `Identity request failed: ${r.status} ${json.error || ""}`,
  );
  return { data: json, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
async function login() {
  const { data: c } = await request("/auth/near/challenge", {
    accountId: operator.accountId,
    name: "Native proof explorer",
  });
  assert.equal(c.network, "testnet");
  assert.equal(c.recipient, origin);
  assert.ok(
    c.message.includes("QuestLayer") &&
      c.message.includes(operator.accountId) &&
      c.message.includes("testnet"),
  );
  const s = await signMessage({
    signerAccount: account,
    payload: {
      message: c.message,
      recipient: c.recipient,
      nonce: new Uint8Array(Buffer.from(c.nonce, "base64")),
    },
  });
  return request("/auth/near/verify", {
    challengeId: c.challengeId,
    accountId: operator.accountId,
    publicKey: s.publicKey.toString(),
    signature: Buffer.from(s.signature).toString("base64"),
  });
}
const first = await login(),
  again = await login();
assert.equal(first.data.player.id, again.data.player.id);
assert.equal(again.data.returning, true);
assert.equal(first.data.player.gold_u, again.data.player.gold_u);
const me = await request("/me", undefined, again.cookie);
assert.equal(me.data.player.id, first.data.player.id);
const result = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  api: base,
  account: operator.accountId,
  method: "NEP-413 with live RPC FullAccess verification",
  sameExplorerRestored: true,
  noDuplicateDemoGrant: true,
  sessionVerified: true,
  chainTransactionSubmitted: false,
  playerPrivateKeysOnServer: false,
};
mkdirSync("output/qa/W03", { recursive: true });
writeFileSync(
  "output/qa/W03/live-near-identity.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));

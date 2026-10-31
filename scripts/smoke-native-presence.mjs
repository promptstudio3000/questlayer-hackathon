// Temporary synthetic DEMO position, never a claim of physical GPS presence.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { Account } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { PLZEN } from "../server/spatial/city-pack.mjs";
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const account = new Account(
    operator.accountId,
    "https://test.rpc.fastnear.com",
    operator.secretKey,
  ),
  base = process.env.PRESENCE_API_URL || "http://127.0.0.1:8787",
  origin = process.env.PRESENCE_ORIGIN || "http://localhost:5173";
assert.ok(
  ["127.0.0.1", "localhost", "questlayer.promptstudio3000.com"].includes(
    new URL(base).hostname,
  ),
);
async function api(path, data, cookie, expected = 200) {
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
  assert.equal(r.status, expected, result.error || "Presence request failed");
  return { data: result, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
const c = (
  await api("/auth/near/challenge", {
    accountId: operator.accountId,
    name: "Native proof explorer",
  })
).data;
const s = await signMessage({
  signerAccount: account,
  payload: {
    message: c.message,
    recipient: c.recipient,
    nonce: new Uint8Array(Buffer.from(c.nonce, "base64")),
  },
});
const actor = await api("/auth/near/verify", {
  challengeId: c.challengeId,
  accountId: operator.accountId,
  publicKey: s.publicKey.toString(),
  signature: Buffer.from(s.signature).toString("base64"),
});
await api(
  "/native/outfit",
  { enabled: true, accountId: operator.accountId },
  actor.cookie,
);
const observer = await api(
    "/session",
    { name: "Presence proof observer" },
    undefined,
    201,
  ),
  leaseId = randomUUID(),
  position = { lat: PLZEN.center.lat + 0.0005, lng: PLZEN.center.lng + 0.0005 };
const send = (renew) =>
  api(
    "/presence",
    { ...position, enabled: true, renew, arena: true, leaseId },
    actor.cookie,
  );
try {
  await send(true);
  const visible = (
    await api(
      `/presence?arena=1&lat=${PLZEN.center.lat}&lng=${PLZEN.center.lng}`,
      undefined,
      observer.cookie,
    )
  ).data.players.find((p) => p.id === actor.data.player.id);
  assert.ok(visible);
  assert.equal(visible.appearance.source, "native");
  assert.equal(visible.appearance.above, "#9edfc5");
  assert.equal(visible.appearance.below, "#c2a0df");
  assert.ok(!JSON.stringify(visible).includes(operator.accountId));
  assert.ok(!JSON.stringify(visible).includes("aura:"));
  const physical = (
    await api(
      `/presence?arena=0&lat=${PLZEN.center.lat}&lng=${PLZEN.center.lng}`,
      undefined,
      observer.cookie,
    )
  ).data.players;
  assert.ok(!physical.some((p) => p.id === actor.data.player.id));
  const proof = {
    verifiedAt: new Date().toISOString(),
    api: base,
    mode: "synthetic demo position; not physical GPS",
    nativeAboveVerified: true,
    nativeBelowVerified: true,
    walletAddressAbsentFromPeerDTO: true,
    nativeTokenIDsAbsentFromPeerDTO: true,
    physicalModeIsolation: true,
    playerPrivateKeyUploaded: false,
    appearance: visible.appearance,
  };
  writeFileSync(
    process.env.PRESENCE_REPORT_PATH || "output/qa/W04/native-presence-api.json",
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      nativePeerReady: true,
      appearance: visible.appearance,
      temporaryDemoSharingSeconds: 120,
    }),
  );
  for (let tick = 0; tick < 12; tick++) {
    await new Promise((r) => setTimeout(r, 10000));
    await send(false);
  }
} finally {
  await api("/presence", { enabled: false, leaseId }, actor.cookie);
  console.log(JSON.stringify({ demoSharingStopped: true }));
}

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const PORT = 19073,
  base = `http://127.0.0.1:${PORT}`,
  origin = `http://localhost:${PORT}`;
const sha = (data) => createHash("sha256").update(data).digest();
function credential(challenge, options = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" }),
    rawId = randomBytes(32);
  const cose = isoCBOR.encode(
    new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
    ]),
  );
  const len = Buffer.alloc(2);
  len.writeUInt16BE(rawId.length);
  const authData = Buffer.concat([
    sha("localhost"),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    len,
    rawId,
    Buffer.from(cose),
  ]);
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge,
      origin: options.origin || origin,
    }),
  );
  const att = isoCBOR.encode(
    new Map([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", new Uint8Array(authData)],
    ]),
  );
  return {
    privateKey,
    id: rawId.toString("base64url"),
    registration: {
      id: rawId.toString("base64url"),
      rawId: rawId.toString("base64url"),
      type: "public-key",
      response: {
        clientDataJSON: clientData.toString("base64url"),
        attestationObject: Buffer.from(att).toString("base64url"),
        transports: ["internal"],
      },
      clientExtensionResults: { credProps: { rk: true } },
      authenticatorAttachment: "platform",
    },
  };
}
function assertion(key, challenge) {
  const client = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin }),
  );
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(1);
  const auth = Buffer.concat([sha("localhost"), Buffer.from([5]), counter]);
  const signature = sign(
    "sha256",
    Buffer.concat([auth, sha(client)]),
    key.privateKey,
  );
  return {
    id: key.id,
    rawId: key.id,
    type: "public-key",
    response: {
      clientDataJSON: client.toString("base64url"),
      authenticatorData: auth.toString("base64url"),
      signature: signature.toString("base64url"),
      userHandle: null,
    },
    clientExtensionResults: {},
  };
}
test("HTTP integration: accounts, coins, market, escrow, signatures and passkey recovery", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-http-"));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      APP_ORIGIN: origin,
      DATABASE_PATH: join(dir, "db.sqlite"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((r) => {
      child.once("exit", r);
      setTimeout(r, 3000).unref();
    });
    rmSync(dir, { recursive: true, force: true });
  });
  let ready = false;
  // Generous: four servers boot at once under npm test on a laptop.
  const startupDeadline = Date.now() + 30000;
  while (Date.now() < startupDeadline) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, output);
  const missingChunk = await fetch(base + "/assets/missing-abcdefgh.js");
  assert.equal(missingChunk.status, 404);
  assert.match(missingChunk.headers.get("content-type"), /application\/json/);
  async function request(path, data, cookie, requestOrigin = origin) {
    const r = await fetch(base + "/api" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: requestOrigin }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") || undefined,
    };
  }
  const a = await request("/session", { name: "HTTP Alice" }),
    b = await request("/session", { name: "HTTP Bob" });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  // New explorers start with 0 GOLD; the local practice paths below (bounty)
  // need a balance, so the fixture tops Alice up directly in the database.
  assert.equal(a.data.player.gold_u, 0);
  {
    const fixture = new DatabaseSync(join(dir, "db.sqlite"));
    fixture.exec("PRAGMA busy_timeout=5000");
    fixture.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(100_000_000, a.data.player.id);
    fixture.close();
  }
  assert.ok(a.cookie);
  assert.equal((await request("/me")).status, 401);
  {
    // Tester sign-in: only a hash set by server/cli/tester-account.mjs signs in.
    const { hashTesterPassword, setTesterLogin, initializeTesterLogin } = await import("../server/identity/test-login.mjs");
    const fixture = new DatabaseSync(join(dir, "db.sqlite"));
    fixture.exec("PRAGMA busy_timeout=5000");
    initializeTesterLogin(fixture);
    setTesterLogin(fixture, { name: "http-tester", playerId: b.data.player.id, secret: hashTesterPassword("tester-pass") });
    fixture.close();
    assert.equal((await request("/auth/tester", { name: "http-tester", password: "nope-nope" })).status, 401);
    const signed = await request("/auth/tester", { name: "HTTP-Tester", password: "tester-pass" });
    assert.equal(signed.status, 200);
    assert.equal(signed.data.player.id, b.data.player.id);
    assert.equal((await request("/me", undefined, signed.cookie)).status, 200);
  }
  assert.equal(
    (
      await request(
        "/native/profile?accountId=unlinked.testnet",
        undefined,
        a.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/native/profile/prepare",
        { accountId: "unlinked.testnet", publicConsent: true },
        a.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/native/profile/prepare",
        { accountId: "unlinked.testnet", publicConsent: false },
        a.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/native/profile/confirm",
        {
          accountId: "unlinked.testnet",
          mutationId: "profile_12345678-1234-1234-1234-123456789abc",
        },
        a.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/session",
        { name: "Cross Site" },
        null,
        "https://attacker.invalid",
      )
    ).status,
    403,
  );
  const w = await request(
    "/world",
    { arena: true, location: { lat: 49.74745, lng: 13.3774 } },
    a.cookie,
  );
  assert.equal(w.status, 200);
  const page = await request(
    "/world?id=" + encodeURIComponent(w.data.id) + "&limit=7",
    undefined,
    a.cookie,
  );
  assert.equal(page.status, 200);
  // World layers: the default theme is named in responses only.
  assert.equal(w.data.layerId, "aavegotchi");
  assert.equal(page.data.layerId, "aavegotchi");
  const config = await request("/config");
  assert.equal(config.data.layerId, "aavegotchi");
  assert.deepEqual(config.data.layers.map((l) => l.id), ["aavegotchi"]);
  assert.equal(page.data.coins.length, 7);
  assert.equal(page.data.cityZoneCount, 6);
  assert.ok(page.data.page.nextCursor);
  const nextPage = await request(
    "/world?id=" +
      encodeURIComponent(w.data.id) +
      "&limit=7&cursor=" +
      encodeURIComponent(page.data.page.nextCursor),
    undefined,
    a.cookie,
  );
  assert.equal(nextPage.status, 200);
  assert.ok(
    nextPage.data.coins.every(
      (c) => !page.data.coins.some((p) => p.id === c.id),
    ),
  );
  const badViewport = await request(
    "/world",
    {
      location: { lat: 50.08, lng: 14.42 },
      arena: false,
      bounds: [1, 1, 0, 0],
    },
    a.cookie,
  );
  assert.equal(badViewport.status, 400);
  const emptyViewport = await request(
    "/world?id=" + encodeURIComponent(w.data.id) + "&bbox=0,0,0.1,0.1",
    undefined,
    a.cookie,
  );
  assert.equal(emptyViewport.status, 200);
  assert.equal(emptyViewport.data.visibleZoneCount, 0);
  assert.equal(emptyViewport.data.cityZoneCount, 6);
  const coin = w.data.coins[0];
  const race = await Promise.all([
    request("/coins/claim", { coinId: coin.id, fix: coin }, a.cookie),
    request("/coins/claim", { coinId: coin.id, fix: coin }, b.cookie),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const chest = w.data.quests.find((q) => q.kind === "chest"),
    claim = await request(
      "/quests/claim",
      { questId: chest.id, fix: chest },
      a.cookie,
    );
  assert.equal(claim.status, 200);
  const item = claim.data.item;
  const ownWorld = await request(
      "/world?id=" + encodeURIComponent(w.data.id),
      undefined,
      a.cookie,
    ),
    otherWorld = await request(
      "/world?id=" + encodeURIComponent(w.data.id),
      undefined,
      b.cookie,
    );
  assert.equal(
    ownWorld.data.quests.find((q) => q.id === chest.id).completed,
    1,
  );
  assert.equal(
    otherWorld.data.quests.find((q) => q.id === chest.id).completed,
    0,
  );
  const list = await request(
    "/market/list",
    { itemId: item.id, price: 10_000_000 },
    a.cookie,
  );
  // Aura trades happen on NEAR now: the database practice market is closed.
  assert.equal(list.status, 410);
  assert.equal(list.data.code, "MARKET_ON_CHAIN");
  assert.equal(
    (await request("/market/buy", { listingId: "listing_x" }, b.cookie))
      .status,
    410,
  );
  assert.deepEqual((await request("/market", undefined, b.cookie)).data.listings, []);
  assert.equal(
    (await request("/equip", { itemId: item.id }, b.cookie)).status,
    403,
  );
  assert.equal(
    (await request("/equip", { itemId: item.id }, a.cookie)).status,
    200,
  );
  const route = w.data.quests.find((q) => q.kind === "route" && q.tier === 1);
  for (let checkpoint = 0; checkpoint < 3; checkpoint++) {
    const current = (
      await request(
        "/world?id=" + encodeURIComponent(w.data.id),
        undefined,
        a.cookie,
      )
    ).data.quests.find((q) => q.id === route.id);
    // The map draws the walk ahead: the next stop first, then the rest.
    assert.equal(current.stops.length, current.checkpointCount - checkpoint);
    assert.deepEqual(current.stops[0], { lat: current.nextPoint.lat, lng: current.nextPoint.lng });
    const r = await request(
      "/quests/checkpoint",
      { questId: route.id, checkpoint, fix: current.nextPoint },
      a.cookie,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.progress.completed, checkpoint + 1);
    if (checkpoint === 0)
      assert.equal(
        (
          await request(
            "/quests/checkpoint",
            { questId: route.id, checkpoint, fix: current.nextPoint },
            a.cookie,
          )
        ).status,
        409,
      );
  }
  const bounty = await request(
    "/bounties",
    {
      title: "Photograph the park sign",
      description: "A test-only task",
      amount: 1_000_000,
      lat: 49.74745,
      lng: 13.3774,
    },
    a.cookie,
  );
  assert.equal(bounty.status, 201);
  assert.equal(
    (
      await request(
        "/bounties/submit",
        {
          bountyId: bounty.data.id,
          evidence: "I completed this test-only task.",
        },
        b.cookie,
      )
    ).status,
    200,
  );
  const subs = await request(
    "/bounties/submissions?id=" + bounty.data.id,
    undefined,
    a.cookie,
  );
  assert.equal(subs.data.submissions.length, 1);
  assert.equal(
    (
      await request(
        "/bounties/approve",
        { submissionId: subs.data.submissions[0].id },
        a.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/bounties/approve",
        { submissionId: subs.data.submissions[0].id },
        a.cookie,
      )
    ).status,
    400,
  );
  const account = privateKeyToAccount(generatePrivateKey());
  const evm = await request(
    "/evm/challenge",
    { address: account.address },
    a.cookie,
  );
  const signature = await account.signMessage({ message: evm.data.message });
  assert.equal(
    (
      await request(
        "/evm/verify",
        { challengeId: evm.data.challengeId, signature },
        a.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/evm/verify",
        { challengeId: evm.data.challengeId, signature },
        a.cookie,
      )
    ).status,
    401,
  );
  const otherChallenge = await request(
    "/evm/challenge",
    { address: account.address },
    b.cookie,
  );
  const otherSignature = await account.signMessage({
    message: otherChallenge.data.message,
  });
  assert.equal(
    (
      await request(
        "/evm/verify",
        {
          challengeId: otherChallenge.data.challengeId,
          signature: otherSignature,
        },
        b.cookie,
      )
    ).status,
    409,
  );
  const reg = await request("/passkey/options", {
    action: "register",
    name: "Passkey Explorer",
  });
  assert.equal(reg.status, 200);
  const key = credential(reg.data.options.challenge);
  const registered = await request("/passkey/verify", {
    challengeId: reg.data.challengeId,
    response: key.registration,
  });
  assert.equal(registered.status, 200, JSON.stringify(registered.data));
  assert.equal(registered.data.player.name, "Passkey Explorer");
  const login = await request("/passkey/options", { action: "login" });
  const signed = assertion(key, login.data.options.challenge);
  const recovered = await request("/passkey/verify", {
    challengeId: login.data.challengeId,
    response: signed,
  });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
  assert.equal(recovered.data.player.id, registered.data.player.id);
  assert.equal(
    (
      await request("/passkey/verify", {
        challengeId: login.data.challengeId,
        response: signed,
      })
    ).status,
    401,
  );
  // Play first, secure later: a guest attaches a passkey to the same explorer.
  const guest = await request("/session", { name: "Guest Securing" });
  assert.equal(guest.status, 201);
  assert.equal(
    (await request("/passkey/options", { action: "register", attach: true }))
      .status,
    401,
    "attaching needs a signed-in explorer",
  );
  const attachOptions = await request(
    "/passkey/options",
    { action: "register", attach: true },
    guest.cookie,
  );
  assert.equal(attachOptions.status, 200, JSON.stringify(attachOptions.data));
  const attachKey = credential(attachOptions.data.options.challenge);
  assert.equal(
    (
      await request("/passkey/verify", {
        challengeId: attachOptions.data.challengeId,
        response: attachKey.registration,
      })
    ).status,
    401,
    "the same session must finish the attachment",
  );
  const attachOptions2 = await request(
    "/passkey/options",
    { action: "register", attach: true },
    guest.cookie,
  );
  const attachKey2 = credential(attachOptions2.data.options.challenge);
  const attached = await request(
    "/passkey/verify",
    {
      challengeId: attachOptions2.data.challengeId,
      response: attachKey2.registration,
    },
    guest.cookie,
  );
  assert.equal(attached.status, 200, JSON.stringify(attached.data));
  assert.equal(attached.data.player.id, guest.data.player.id);
  assert.equal(attached.data.player.name, "Guest Securing");
  const attachedLogin = await request("/passkey/options", { action: "login" });
  const attachedRecovered = await request("/passkey/verify", {
    challengeId: attachedLogin.data.challengeId,
    response: assertion(attachKey2, attachedLogin.data.options.challenge),
  });
  assert.equal(attachedRecovered.data.player.id, guest.data.player.id);
  await t.test("attaching a passkey rotates the guest bearer and binds the next attachment to the exact session", async () => {
    assert.equal((await request("/me", undefined, guest.cookie)).status, 401);
    const options = await request("/passkey/options", {action: "register", attach: true}, attached.cookie);
    assert.equal(options.status, 200);
    const newKey = credential(options.data.options.challenge);
    const finish = {challengeId: options.data.challengeId, response: newKey.registration};
    assert.equal((await request("/passkey/verify", finish, attachedRecovered.cookie)).status, 403);
    assert.equal((await request("/passkey/verify", finish, attached.cookie)).status, 200);
  });
  const wrong = await request("/passkey/options", {
    action: "register",
    name: "Wrong Origin",
  });
  const bad = credential(wrong.data.options.challenge, {
    origin: "https://attacker.invalid",
  });
  assert.notEqual(
    (
      await request("/passkey/verify", {
        challengeId: wrong.data.challengeId,
        response: bad.registration,
      })
    ).status,
    200,
  );
  const alive = await fetch(base + "/");
  assert.equal(alive.status, 200);
  assert.match(await alive.text(), /lang="en"/);
});

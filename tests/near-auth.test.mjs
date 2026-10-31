import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Account, KeyPair } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { nearAccountId, verifyNearIdentity } from "../server/identity/near.mjs";

test("native identity validates account syntax and distinguishes RPC failures", async () => {
  for (const value of ["alice.testnet", "a_b.testnet", "a".repeat(64)])
    assert.equal(nearAccountId(value), value);
  for (const value of ["A.testnet", ".testnet", "a..b", "x", "x".repeat(65)])
    assert.throws(() => nearAccountId(value));
  await assert.rejects(
    () => verifyNearIdentity({ network: "mainnet" }, {}, {}),
    /different network/,
  );
  await assert.rejects(
    () =>
      verifyNearIdentity(
        {
          network: "testnet",
          accountId: "alice.testnet",
          nonce: Buffer.alloc(32).toString("base64"),
        },
        {
          accountId: "alice.testnet",
          publicKey: "ed25519:test",
          signature: Buffer.alloc(64).toString("base64"),
        },
        {
          viewAccessKey: async () => {
            throw Error("RPC temporarily unavailable");
          },
        },
      ),
    (e) => e.status === 503,
  );
});

test("NEAR sign-in verifies real signatures, restores one explorer, isolates purposes and prevents replay", async (t) => {
  const port = 19074,
    rpcPort = 19075,
    base = `http://127.0.0.1:${port}`,
    origin = `http://localhost:${port}`,
    dir = mkdtempSync(join(tmpdir(), "questlayer-near-auth-"));
  const aliceKey = KeyPair.fromRandom("ed25519"),
    bobKey = KeyPair.fromRandom("ed25519"),
    functionKey = KeyPair.fromRandom("ed25519");
  const keys = new Map([
    ["alice.testnet", aliceKey.getPublicKey().toString()],
    ["bob.testnet", bobKey.getPublicKey().toString()],
    ["function.testnet", functionKey.getPublicKey().toString()],
  ]);
  keys.set("slow.testnet", aliceKey.getPublicKey().toString());
  let releaseRpc, startedRpc;
  const released = new Promise((resolve) => (releaseRpc = resolve)),
    started = new Promise((resolve) => (startedRpc = resolve));
  const rpc = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const q = JSON.parse(body);
    if (q.method === "status") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: q.id,
          result: { chain_id: "testnet", sync_info: { syncing: false } },
        }),
      );
      return;
    }
    if (q.params?.request_type === "call_function") {
      const args = JSON.parse(Buffer.from(q.params.args_base64, "base64"));
      const avatar = {
          token_id: "avatar:alice.testnet",
          owner_id: "alice.testnet",
          metadata: { title: "QuestLayer Explorer" },
        },
        aura = {
          token_id: "aura:polar:1",
          owner_id: "alice.testnet",
          metadata: { title: "Northern Lights" },
        };
      const fixtures = {
        nft_metadata: { name: "QuestLayer Collectibles" },
        nft_total_supply: "2",
        nft_tokens: [avatar, aura],
        get_version: 2,
        get_award_signer: null,
        nft_tokens_for_owner:
          args.account_id === "alice.testnet" ? [avatar, aura] : [],
        get_equipment: {
          above: args.account_id === "alice.testnet" ? "aura:polar:1" : null,
          below: null,
        },
        nft_supply_for_owner: args.account_id === "alice.testnet" ? "2" : "0",
        nft_token: args.token_id === "avatar:alice.testnet" ? avatar : null,
      };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: q.id,
          result: {
            result: Array.from(
              Buffer.from(JSON.stringify(fixtures[q.params.method_name])),
            ),
            block_height: 1000,
          },
        }),
      );
      return;
    }
    const known = keys.get(q.params.account_id) === q.params.public_key;
    if (q.params.account_id === "slow.testnet") {
      startedRpc();
      await released;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: q.id,
        ...(known
          ? {
              result: {
                block_height: 1000,
                block_hash: "11111111111111111111111111111111",
                nonce: 1,
                permission:
                  q.params.account_id === "function.testnet"
                    ? {
                        FunctionCall: {
                          receiver_id: "game.testnet",
                          method_names: ["play"],
                          allowance: null,
                        },
                      }
                    : "FullAccess",
              },
            }
          : {
              error: {
                code: -32000,
                message: "UNKNOWN_ACCESS_KEY",
                data: "UNKNOWN_ACCESS_KEY",
              },
            }),
      }),
    );
  });
  await new Promise((resolve) => rpc.listen(rpcPort, "127.0.0.1", resolve));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: origin,
      NEAR_RPC_URL: `http://127.0.0.1:${rpcPort}`,
      DATABASE_PATH: join(dir, "db.sqlite"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  t.after(async () => {
    releaseRpc();
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 3000).unref();
    });
    await new Promise((resolve) => rpc.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  let ready = false;
  const startupDeadline = Date.now() + 15000;
  while (Date.now() < startupDeadline) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, output);
  async function request(path, data, cookie) {
    const response = await fetch(base + "/api" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: origin }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function signed(
    challenge,
    accountId = "alice.testnet",
    key = aliceKey,
    changes = {},
  ) {
    const account = new Account(
      accountId,
      `http://127.0.0.1:${rpcPort}`,
      key.toString(),
    );
    const s = await signMessage({
      signerAccount: account,
      payload: {
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: new Uint8Array(Buffer.from(challenge.nonce, "base64")),
        ...changes,
      },
    });
    return {
      challengeId: challenge.challengeId,
      accountId,
      publicKey: s.publicKey.toString(),
      signature: Buffer.from(s.signature).toString("base64"),
    };
  }
  const c = await request("/auth/near/challenge", {
    accountId: "alice.testnet",
    name: "Native Alice",
  });
  assert.equal(c.status, 200);
  const proof = await signed(c.data),
    login = await request("/auth/near/verify", proof);
  assert.equal(login.status, 200);
  assert.equal(login.data.returning, false);
  assert.ok(login.cookie);
  assert.equal(login.data.player.name, "Native Alice");
  assert.equal(login.data.player.wallets[0].account_id, "alice.testnet");
  const playerId = login.data.player.id;
  assert.equal((await request("/auth/near/verify", proof)).status, 401);
  const again = await request("/auth/near/challenge", {
      accountId: "alice.testnet",
      name: "Changed name",
    }),
    restored = await request("/auth/near/verify", await signed(again.data));
  assert.equal(restored.status, 200);
  assert.equal(restored.data.returning, true);
  assert.equal(restored.data.player.id, playerId);
  assert.equal(restored.data.player.name, "Native Alice");
  assert.equal(restored.data.player.gold_u, login.data.player.gold_u);
  const wardrobe = await request(
    "/native/wardrobe",
    undefined,
    restored.cookie,
  );
  assert.equal(wardrobe.status, 200);
  assert.equal(wardrobe.data.accounts[0].items.length, 2);
  assert.equal(
    (
      await request(
        "/native/outfit",
        { enabled: true, accountId: "bob.testnet" },
        restored.cookie,
      )
    ).status,
    403,
  );
  const worn = await request(
    "/native/outfit",
    { enabled: true, accountId: "alice.testnet" },
    restored.cookie,
  );
  assert.equal(worn.status, 200);
  assert.equal(worn.data.player.nativeOutfit, true);
  const demoEquip = await request(
    "/equip",
    { itemId: restored.data.player.inventory[0].id },
    restored.cookie,
  );
  assert.equal(demoEquip.status, 200);
  assert.equal(demoEquip.data.player.nativeOutfit, false);
  const collection = await request("/native/collection");
  assert.equal(collection.status, 200);
  assert.equal(collection.data.items.length, 2);
  const wrong = await request("/auth/near/challenge", {
    accountId: "alice.testnet",
  });
  assert.equal(
    (
      await request(
        "/auth/near/verify",
        await signed(wrong.data, "alice.testnet", aliceKey, {
          recipient: "https://evil.invalid",
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/auth/near/verify",
        await signed(wrong.data, "bob.testnet", bobKey),
      )
    ).status,
    401,
  );
  const fc = await request("/auth/near/challenge", {
    accountId: "function.testnet",
  });
  assert.equal(
    (
      await request(
        "/auth/near/verify",
        await signed(fc.data, "function.testnet", functionKey),
      )
    ).status,
    401,
  );
  const guest = await request("/session", { name: "Linked Guest" }),
    link = await request(
      "/wallet/challenge",
      { accountId: "bob.testnet" },
      guest.cookie,
    ),
    linkProof = await signed(link.data, "bob.testnet", bobKey);
  assert.equal((await request("/auth/near/verify", linkProof)).status, 401);
  assert.equal(
    (await request("/wallet/verify", linkProof, guest.cookie)).status,
    200,
  );
  const bob = await request("/auth/near/challenge", {
      accountId: "bob.testnet",
    }),
    bobLogin = await request(
      "/auth/near/verify",
      await signed(bob.data, "bob.testnet", bobKey),
    );
  assert.equal(bobLogin.data.player.id, guest.data.player.id);
  const race = await request("/auth/near/challenge", {
      accountId: "alice.testnet",
    }),
    raceProof = await signed(race.data),
    results = await Promise.all([
      request("/auth/near/verify", raceProof),
      request("/auth/near/verify", raceProof),
    ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const slow = await request("/auth/near/challenge", {
      accountId: "slow.testnet",
    }),
    slowProof = await signed(slow.data, "slow.testnet", aliceKey);
  const pending = request("/auth/near/verify", slowProof);
  await started;
  const fixture = new DatabaseSync(join(dir, "db.sqlite"));
  fixture
    .prepare("UPDATE auth_challenges SET expires_at=? WHERE id=?")
    .run(Date.now() - 1, slow.data.challengeId);
  fixture.close();
  releaseRpc();
  assert.equal(
    (await pending).status,
    401,
    "A challenge must still be valid after RPC verification",
  );
  assert.equal(
    (await request("/auth/near/challenge", { accountId: "..invalid" })).status,
    400,
  );
  const sessionView = await request(
    "/identity/sessions",
    undefined,
    restored.cookie,
  );
  assert.equal(sessionView.status, 200);
  assert.equal(sessionView.data.sessions[0].current, true);
  assert.equal(sessionView.data.sessions[0].kind, "near-wallet");
  assert.ok(sessionView.data.activeSessionCount >= 3);
  assert.equal(sessionView.data.recovery.nativePasskeyAccount, false);
  assert.deepEqual(sessionView.data.recovery.nearAccounts, ["alice.testnet"]);
  assert.ok(
    !JSON.stringify(sessionView.data).includes(restored.cookie.split("=")[1]),
  );
  const conflictingLink = await request(
    "/wallet/challenge",
    { accountId: "alice.testnet" },
    guest.cookie,
  );
  assert.equal(
    (
      await request(
        "/wallet/verify",
        await signed(conflictingLink.data),
        guest.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/wallet/verify",
        await signed(conflictingLink.data),
        bobLogin.cookie,
      )
    ).status,
    403,
    "A link approval belongs to the browser that requested it",
  );
  const pendingLink = await request(
    "/wallet/challenge",
    { accountId: "slow.testnet" },
    login.cookie,
  );
  const pendingLinkProof = await signed(
    pendingLink.data,
    "slow.testnet",
    aliceKey,
  );
  assert.equal(
    (
      await request(
        "/identity/recovery/challenge",
        { accountId: "bob.testnet" },
        restored.cookie,
      )
    ).status,
    403,
  );
  const recovery = await request(
    "/identity/recovery/challenge",
    { accountId: "alice.testnet" },
    restored.cookie,
  );
  assert.equal(recovery.status, 200);
  assert.equal(recovery.data.purpose, "revoke-other-sessions");
  const recoveryProof = await signed(recovery.data);
  assert.equal((await request("/auth/near/verify", recoveryProof)).status, 401);
  assert.equal((await request("/passkey/verify", recoveryProof)).status, 401);
  assert.equal(
    (await request("/identity/recovery/verify", recoveryProof, login.cookie))
      .status,
    403,
  );
  assert.equal(
    (await request("/identity/recovery/verify", recoveryProof, bobLogin.cookie))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        "/identity/recovery/verify",
        await signed(recovery.data, "alice.testnet", aliceKey, {
          recipient: "https://evil.invalid",
        }),
        restored.cookie,
      )
    ).status,
    401,
  );
  const recovered = await request(
    "/identity/recovery/verify",
    recoveryProof,
    restored.cookie,
  );
  assert.equal(recovered.status, 200);
  assert.ok(recovered.data.revokedSessions >= 2);
  assert.equal(recovered.data.activeSessionCount, 1);
  assert.ok(recovered.cookie && recovered.cookie !== restored.cookie);
  assert.equal(recovered.data.token, undefined);
  assert.equal(
    (await request("/identity/sessions", undefined, restored.cookie)).status,
    401,
    "Copied retained cookies are invalidated too",
  );
  assert.equal(
    (await request("/identity/sessions", undefined, login.cookie)).status,
    401,
  );
  assert.equal(
    (await request("/identity/sessions", undefined, bobLogin.cookie)).status,
    200,
  );
  assert.equal(
    (await request("/wallet/verify", pendingLinkProof, recovered.cookie))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "/identity/recovery/verify",
        recoveryProof,
        recovered.cookie,
      )
    ).status,
    401,
  );
  const afterRecovery = await request("/auth/near/challenge", {
    accountId: "alice.testnet",
  });
  const returnAgain = await request(
    "/auth/near/verify",
    await signed(afterRecovery.data),
  );
  assert.equal(
    returnAgain.data.player.id,
    playerId,
    "A fresh wallet proof restores the same explorer after cookie loss",
  );
  assert.equal(
    returnAgain.data.player.gold_u,
    restored.data.player.gold_u,
    "Recovery cannot merge or cash out demo funds",
  );
});

test("identity refuses a mainnet RPC even when its access-key answer would be valid", async () => {
  let queriedKey = false;
  await assert.rejects(
    () =>
      verifyNearIdentity(
        {
          network: "testnet",
          accountId: "alice.testnet",
          nonce: Buffer.alloc(32).toString("base64"),
        },
        {
          accountId: "alice.testnet",
          publicKey: "ed25519:test",
          signature: Buffer.alloc(64).toString("base64"),
        },
        {
          viewNodeStatus: async () => ({ chain_id: "mainnet" }),
          viewAccessKey: async () => {
            queriedKey = true;
            return { permission: "FullAccess" };
          },
        },
      ),
    (e) => e.code === "WRONG_NETWORK" && e.status === 503,
  );
  assert.equal(queriedKey, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { evmKeyInfo } from "../server/identity/evm.mjs";

test("Ethereum sign-in creates one explorer, restores it, links on request and prevents replay", async (t) => {
  const port = 19094,
    base = `http://127.0.0.1:${port}`,
    origin = `http://localhost:${port}`,
    dir = mkdtempSync(join(tmpdir(), "questlayer-evm-auth-"));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: origin,
      NEAR_RPC_URL: "http://127.0.0.1:9",
      DATABASE_PATH: join(dir, "db.sqlite"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 3000).unref();
    });
    rmSync(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (const deadline = Date.now() + 15000; Date.now() < deadline; ) {
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
        ...(data === undefined ? {} : { "Content-Type": "application/json", Origin: origin }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const wallet = privateKeyToAccount(generatePrivateKey());
  async function signIn(account, extra = {}, cookie) {
    const c = await request("/auth/evm/challenge", { address: account.address, chainId: 11155111, name: "Eth Explorer", wallet: "MetaMask", ...extra }, cookie);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.ok(c.body.message.startsWith(`localhost:${port} wants you to sign in with your Ethereum account:`));
    const signature = await account.signMessage({ message: c.body.message });
    return { c, signature, verify: (sig = signature) => request("/auth/evm/verify", { challengeId: c.body.challengeId, signature: sig }, cookie) };
  }
  const first = await signIn(wallet);
  const wrong = await first.verify(await privateKeyToAccount(generatePrivateKey()).signMessage({ message: first.c.body.message }));
  assert.equal(wrong.status, 401);
  const ok = await first.verify();
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.returning, false);
  assert.equal(ok.body.address, wallet.address.toLowerCase());
  assert.equal(ok.body.intentsPublicKey, evmKeyInfo(wallet.publicKey).intentsPublicKey);
  assert.ok(ok.cookie);
  assert.equal((await first.verify()).status, 401, "a challenge signs in once");
  const again = await (await signIn(wallet)).verify();
  assert.equal(again.body.returning, true);
  assert.equal(again.body.player.id, ok.body.player.id);
  const mine = await request("/identity/evm", undefined, again.cookie);
  assert.equal(mine.body.wallets.length, 1);
  assert.equal(mine.body.wallets[0].wallet, "MetaMask");
  const sessions = await request("/identity/sessions", undefined, again.cookie);
  assert.ok(sessions.body.sessions.some((s) => s.current && s.kind === "evm-wallet"));
  // A second wallet links to the same explorer; it cannot be taken over.
  const rabby = privateKeyToAccount(generatePrivateKey());
  const linked = await (await signIn(rabby, { link: true, wallet: "Rabby" }, again.cookie)).verify();
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.player.id, ok.body.player.id);
  assert.equal(linked.cookie, undefined);
  assert.equal((await request("/identity/evm", undefined, again.cookie)).body.wallets.length, 2);
  const other = await (await signIn(privateKeyToAccount(generatePrivateKey()))).verify();
  const steal = await (await signIn(rabby, { link: true }, other.cookie)).verify();
  assert.equal(steal.status, 409);
  const db = new DatabaseSync(join(dir, "db.sqlite"), { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM evm_links").get().n, 3);
  db.close();
});

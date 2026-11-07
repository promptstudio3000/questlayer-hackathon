// Two browser origins + actual local QGOLD WASM. Uses only synthetic keys.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";
import { chromium } from "playwright";
import {
  KeyPair,
  KeyPairSigner,
  Account,
  actions,
  PublicKey,
} from "near-api-js";
import { createSigningVaultServer } from "../../server/signing-vault.mjs";
import { vaultCors } from "../../server/signing-vault-cors.mjs";
import { decodeSignedDelegate } from "../../server/relayer/delegate.mjs";
import { escrowLocalTransport } from "./escrow-rpc.mjs";
import { purchaseFixture } from "../fixtures/qgold-purchase.mjs";
import { setSpendRealm } from "../../server/gold-spend/ledger.mjs";
const [helper, wasmPath, output] = process.argv.slice(2);
assert.ok(helper && wasmPath && output);
mkdirSync(output, { recursive: true });
const { Sandbox, GenesisAccount } = await import(
  pathToFileURL(resolve(helper))
);
const NEAR = 10n ** 24n,
  keys = new Map(),
  root = resolve(),
  dir = mkdtempSync(join(tmpdir(), "questlayer-vault-browser-"));
const accounts = [
  "owner.testnet",
  "alice.testnet",
  "qgold.testnet",
  "relay.testnet",
].map((id) => {
  const key = KeyPair.fromRandom("ed25519");
  keys.set(id, key);
  return new GenesisAccount(
    id,
    key.getPublicKey().toString(),
    key.toString(),
    1000n * NEAR,
  );
});
const report = {
  startedAt: new Date().toISOString(),
  scope: "loopback actual WASM and Chromium, synthetic accounts",
  scenarios: [],
  screenshots: [],
  hardwareVerified: false,
  releaseReady: false,
};
let sandbox,
  browser,
  appServer,
  vaultServer,
  f,
  owner,
  relay,
  alice,
  vaultOrigin;
const listen = (server, port = 0) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
const close = (server) =>
  server ? new Promise((resolve) => server.close(resolve)) : Promise.resolve();
const passed = (name, details = {}) => {
  report.scenarios.push({ name, passed: true, ...details });
  console.log(`PASS ${name}`);
};
try {
  const fixtureEntry = join(dir, "fixture-entry.js");
  writeFileSync(
    fixtureEntry,
    `import {indexedDbKeyStore,createDeviceKey,bindAccount,signDelegate,signerFor} from ${JSON.stringify(join(root, "src/player-key.ts"))}; import {vaultRequest} from ${JSON.stringify(join(root, "src/signing-vault/client.ts"))}; window.fixture={store:indexedDbKeyStore(),createDeviceKey,bindAccount,signDelegate,signerFor,vaultRequest};`,
  );
  await build({
    configFile: false,
    logLevel: "error",
    build: {
      outDir: dir,
      emptyOutDir: false,
      target: "es2022",
      rolldownOptions: {
        input: fixtureEntry,
        output: {
          entryFileNames: "fixture.js",
          chunkFileNames: "[name]-[hash].js",
        },
      },
    },
  });
  sandbox = await Sandbox.start({
    version: "2.14.0",
    config: { additionalAccounts: accounts },
  });
  const t = (id) =>
    escrowLocalTransport({
      rpcUrl: sandbox.rpcUrl,
      accountId: id,
      secretKey: keys.get(id).toString(),
    });
  owner = await t("owner.testnet");
  relay = await t("relay.testnet");
  alice = await t("alice.testnet");
  const token = await t("qgold.testnet"),
    code = readFileSync(wasmPath);
  report.wasm = {
    sha256: createHash("sha256").update(code).digest("hex"),
    bytes: code.length,
  };
  await token.account.deployContract(code);
  await owner.call("qgold.testnet", "new", {
    council: ["owner.testnet"],
    threshold: 1,
    guardian_id: "owner.testnet",
    treasury_id: "owner.testnet",
    minters: ["owner.testnet"],
    initial_rate: "1000000000000000000000",
    metadata: {
      spec: "ft-1.0.0",
      name: "Local QGOLD",
      symbol: "QGOLD",
      decimals: 6,
    },
  });
  for (const account_id of ["alice.testnet", "owner.testnet"])
    await owner.call("qgold.testnet", "mint_for", { account_id }, NEAR);
  const limitedKey = KeyPair.fromRandom("ed25519");
  await alice.account.signAndSendTransaction({
    receiverId: "alice.testnet",
    actions: [
      actions.addFunctionCallAccessKey(
        limitedKey.getPublicKey(),
        "qgold.testnet",
        ["ft_burn"],
        NEAR,
      ),
    ],
    waitUntil: "FINAL",
  });
  const limited = new Account(
    "alice.testnet",
    alice.provider,
    KeyPairSigner.fromSecretKey(limitedKey.toString()),
  );
  await assert.rejects(
    limited.callFunctionRaw({
      contractId: "qgold.testnet",
      methodName: "ft_burn",
      args: { amount: "1", memo: "limited-key-control" },
      gas: 30000000000000n,
      deposit: 1n,
      waitUntil: "FINAL",
    }),
    /deposit|Deposit|access key/i,
  );
  await assert.rejects(
    limited.callFunctionRaw({
      contractId: "qgold.testnet",
      methodName: "ft_burn",
      args: { amount: "1", memo: "limited-key-control" },
      gas: 30000000000000n,
      deposit: 0n,
      waitUntil: "FINAL",
    }),
  );
  passed(
    "actual function-call key cannot perform the existing one-yocto burn; zero deposit is rejected by QGOLD",
  );
  setSpendRealm("qgold");
  f = purchaseFixture();
  await assert.rejects(f.run(), (e) => e.code === "QGOLD_BURN");
  const purchase = f.prepare();
  appServer = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1"),
      json = (value) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(value));
      };
    if (
      vaultCors(req, res, url.pathname, vaultOrigin) &&
      req.method === "OPTIONS"
    )
      return;
    if (url.pathname === "/api/config")
      return json({ network: "testnet", signingVaultOrigin: vaultOrigin });
    if (url.pathname === "/api/gold/burn/intent") {
      const p = f.row();
      return json({
        accountId: p.account_id,
        contractId: p.contract_id,
        amount: String(p.amount_u),
        memo: p.memo,
        state: p.state,
      });
    }
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      return res.end(
        '<!doctype html><html><head><title>Local signer test</title></head><body><button id="act">Start account action</button><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
    if (/^\/[a-zA-Z0-9_.-]+\.js$/.test(url.pathname)) {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(readFileSync(join(dir, url.pathname.slice(1))));
    }
    res.writeHead(404).end();
  });
  const appPort = await listen(appServer),
    probe = createServer(),
    vaultPort = await listen(probe);
  await close(probe);
  const appOrigin = `http://127.0.0.1:${appPort}`;
  vaultOrigin = `http://127.0.0.1:${vaultPort}`;
  vaultServer = createSigningVaultServer({
    config: {
      appOrigin,
      vaultOrigin,
      rpcUrl: sandbox.rpcUrl,
      network: "testnet",
      contracts: { qgold: "qgold.testnet", collectibles: "nft.testnet" },
    },
  });
  await listen(vaultServer, vaultPort);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(appOrigin);
  await page.waitForFunction(() => !!window.fixture);
  const meta = await page.evaluate(async () => {
    const f = window.fixture;
    const records = await Promise.all([
      f.createDeviceKey(f.store),
      f.createDeviceKey(f.store),
    ]);
    if (records[0].publicKey !== records[1].publicKey)
      throw Error("Concurrent key creation changed the key");
    f.key = records[0];
    return f.key;
  });
  assert.equal(meta.secretKey, "");
  assert.equal(meta.vaultId, vaultOrigin);
  await alice.account.signAndSendTransaction({
    receiverId: "alice.testnet",
    actions: [actions.addFullAccessKey(PublicKey.fromString(meta.publicKey))],
    waitUntil: "FINAL",
  });
  await page.evaluate(async () => {
    const f = window.fixture;
    await f.bindAccount(f.store, "alice.testnet");
    f.key = await f.store.get("device");
  });
  const isolation = await page.evaluate(async () => {
    let denied = false;
    try {
      document.querySelector("iframe").contentWindow.document.body;
    } catch {
      denied = true;
    }
    return { denied, names: (await indexedDB.databases()).map((d) => d.name) };
  });
  assert.equal(isolation.denied, true);
  assert.ok(!isolation.names.includes("questlayer-secure-account"));
  passed(
    "isolated-origin key never reaches the game; concurrent initialization keeps one key",
  );
  await page.evaluate(async () => {
    try {
      await window.fixture.vaultRequest("signBytes", { bytes: "AAAA" });
      throw Error("raw signing accepted");
    } catch (e) {
      if (!/account key changed|Unsupported/i.test(e.message)) throw e;
    }
  });
  passed("unreviewed raw-byte signing is refused");
  const params = async (call) => {
    const access = await owner.provider.query({
      request_type: "view_access_key",
      account_id: "alice.testnet",
      public_key: meta.publicKey,
      finality: "final",
    });
    const block = await owner.provider.viewBlock({ finality: "final" });
    return {
      senderId: "alice.testnet",
      receiverId: "qgold.testnet",
      call,
      nonce: String(BigInt(access.nonce) + 1n),
      maxBlockHeight: String(block.header.height + 120),
    };
  };
  const balance = async (id) =>
    BigInt(
      await owner.view("qgold.testnet", "ft_balance_of", { account_id: id }),
    );
  const burn = await page.evaluate(
    async (input) => window.fixture.signDelegate(window.fixture.key, input),
    await params({
      methodName: "ft_burn",
      args: purchase.args,
      gas: purchase.gas,
      deposit: "1",
    }),
  );
  assert.equal(
    context.pages().length,
    1,
    "ordinary purchase must not open a confirmation",
  );
  const before = await balance("alice.testnet");
  const result = await relay.account.signAndSendTransaction({
    receiverId: "alice.testnet",
    actions: [
      actions.signedDelegate(
        decodeSignedDelegate(burn.signedDelegateBase64).signedDelegate,
      ),
    ],
    waitUntil: "FINAL",
  });
  const hash = result.transaction.hash,
    proof = await owner.provider.viewTransactionStatusWithReceipts({
      txHash: hash,
      accountId: "relay.testnet",
      waitUntil: "FINAL",
    });
  await f.confirm(proof, { txHash: hash, relayerId: "relay.testnet" });
  await f.run();
  assert.equal(
    before - (await balance("alice.testnet")),
    BigInt(purchase.args.amount),
  );
  passed(
    "actual paid gameplay signs and delivers once without any approval window",
    { tx: hash },
  );
  const transfer = {
    methodName: "ft_transfer",
    args: { receiver_id: "owner.testnet", amount: "1000000" },
    gas: "30000000000000",
    deposit: "1",
  };
  async function startProtected() {
    const input = await params(transfer);
    await page.evaluate((input) => {
      const f = window.fixture;
      f.result = null;
      f.error = null;
      document.querySelector("#act").onclick = () => {
        f.signDelegate(f.key, input).then(
          (r) => {
            f.result = r;
          },
          (e) => {
            f.error = e.message;
          },
        );
      };
    }, input);
    const popup = page.waitForEvent("popup");
    await page.click("#act");
    const p = await popup;
    await p.waitForSelector("button.primary");
    return p;
  }
  let popup = await startProtected();
  assert.equal(await page.evaluate(() => window.fixture.result), null);
  for (const [name, width, height] of [
    ["phone-360", 360, 780],
    ["phone-390", 390, 844],
    ["landscape", 844, 390],
    ["desktop", 1280, 900],
  ]) {
    await popup.setViewportSize({ width, height });
    await popup.screenshot({
      path: join(output, `${name}.png`),
      fullPage: true,
    });
    report.screenshots.push(`${name}.png`);
    assert.ok(
      await popup
        .locator("button.primary")
        .evaluate((e) => e.getBoundingClientRect().height >= 48),
    );
    assert.ok(
      await popup
        .locator("button.primary")
        .evaluate(
          (e) =>
            e.getBoundingClientRect().top >=
            document.querySelector("section").getBoundingClientRect().bottom,
        ),
      "Approval controls must not cover the reviewed recipient or amount",
    );
  }
  await popup.setViewportSize({ width: 390, height: 844 });
  await popup.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  await popup.screenshot({
    path: join(output, "enlarged-text.png"),
    fullPage: true,
  });
  report.screenshots.push("enlarged-text.png");
  await popup.keyboard.press("Escape");
  await page.waitForFunction(() => !!window.fixture.error);
  assert.match(await page.evaluate(() => window.fixture.error), /cancelled/);
  assert.equal(
    await balance("alice.testnet"),
    before - BigInt(purchase.args.amount),
  );
  passed(
    "asset transfer waits for isolated approval; keyboard cancellation releases no signature",
  );
  popup = await startProtected();
  const approvalHeaders = await (await fetch(popup.url())).headers;
  assert.equal(approvalHeaders.get("x-frame-options"), "DENY");
  assert.match(
    approvalHeaders.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  await popup.getByRole("button", { name: "Approve", exact: true }).focus();
  await popup.keyboard.press("Enter");
  await page.waitForFunction(
    () => !!window.fixture.result || !!window.fixture.error,
  );
  assert.equal(await page.evaluate(() => window.fixture.error), null);
  const approved = await page.evaluate(() => window.fixture.result),
    transferBefore = await balance("owner.testnet");
  const sent = await relay.account.signAndSendTransaction({
    receiverId: "alice.testnet",
    actions: [
      actions.signedDelegate(
        decodeSignedDelegate(approved.signedDelegateBase64).signedDelegate,
      ),
    ],
    waitUntil: "FINAL",
  });
  assert.equal((await balance("owner.testnet")) - transferBefore, 1000000n);
  passed(
    "approved transfer moves the exact amount to the reviewed recipient; approval page cannot be framed",
    { tx: sent.transaction.hash },
  );
  popup = await startProtected();
  const vaultFrame = page
    .frames()
    .find((frame) => frame.url() === `${vaultOrigin}/`);
  const changeAccount = (accountId) =>
    vaultFrame.evaluate(
      (accountId) =>
        new Promise((resolve, reject) => {
          const opened = indexedDB.open("questlayer-secure-account");
          opened.onerror = () => reject(opened.error);
          opened.onsuccess = () => {
            const db = opened.result,
              tx = db.transaction("records", "readwrite"),
              s = tx.objectStore("records"),
              r = s.get("key:device");
            r.onsuccess = () => {
              if (!r.result) {
                reject(Error("Missing isolated key record"));
                tx.abort();
                return;
              }
              s.put({ ...r.result, accountId }, "key:device");
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      accountId,
    );
  await changeAccount("changed.testnet");
  await popup.getByRole("button", { name: "Approve", exact: true }).click();
  await page.waitForFunction(() => !!window.fixture.error);
  assert.match(
    await page.evaluate(() => window.fixture.error),
    /account changed after review/,
  );
  assert.equal(await page.evaluate(() => window.fixture.result), null);
  await changeAccount("alice.testnet");
  passed("an account changed after review cannot authorize the stale request");
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await close(vaultServer);
  await close(appServer);
  if (sandbox) await sandbox.stop();
  if (f) f.db.close();
  setSpendRealm("practice");
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
}

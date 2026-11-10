// End-to-end journey through the secure signing vault on a phone: the real
// game (server/index.mjs + dist/) frames the real vault build
// (`vite build --mode signing-vault`, served by server/signing-vault.mjs) from
// a second, cross-site loopback origin, exactly as production frames
// questlayer-signer.promptstudio3000.com.
//
//   1. A new explorer starts playing; the game asks the vault for a device
//      key, the account is created for that public key and bound in the vault.
//   2. The explorer account publishes its profile in the background: the vault
//      signs a NEP-366 delegate without a confirmation window and the game
//      sends it to the sponsored relayer.
//   3. After a reload the vault still holds the key: no new account, the same
//      device key, the Devices list shows this device.
//   5. Encrypted inbox (docs/PLAYER-INBOX.md): the vault creates the X25519
//      inbox key, the account publishes it through the relayer. The explorer
//      shares their position, taps the peer standing next to them, and on
//      the peer's card chooses "Write a message"; the message is sealed in
//      the vault against the peer key it reads from (stubbed) NEAR Social and
//      decrypts in Node with the peer's secret. The peer's reply, sealed in
//      Node, opens in the vault and shows in the conversation; after closing,
//      the envelope badge ("Messages: 1 new") leads to the list and back into
//      the conversation, which is then read.
//   4. Storage blocked inside the vault frame (indexedDB/localStorage throw,
//      as in a browser that blocks third-party site data): the player sees a
//      clear "Secure account unavailable" message with Try again, no account
//      is created and nothing is signed.
//
// There is no chain or relayer key here. The NEAR factory, the relayer and
// the RPC are stubbed at the network layer (context.route). The relay stub
// runs the server's own admission code on every signed delegate
// (decodeSignedDelegate, verifySignedDelegate, validateDelegate), so a
// signature or delegate the real relayer would refuse fails this test.
// Every key is generated in the browser at run time.
//
// Usage:  npm run build && npm run e2e:signing-vault [-- --device=<name>]
//   --device=phone-390  Chromium at 390 x 844 (default)
//   --device=iphone     WebKit with Playwright's iPhone 15 profile
//   --device=pixel      Chromium with Playwright's Pixel 7 profile
//   --device=all        all three in turn against one server
// E2E_DEVICE does the same as --device. WebKit runs only where it is
// installed (`npx playwright install webkit`, as CI does); locally a missing
// engine is skipped, in CI (CI=true) it fails. Screenshots and report.json
// land in output/qa/2026-11-signing-vault/<device>/ (override with E2E_SHOTS).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium, devices, webkit } from "playwright";
import { build } from "vite";
import { closeOpenSheet } from "./lib/e2e-nav.mjs";
import { serveBlankMapStyle } from "./lib/e2e-map-style.mjs";
import { createSigningVaultServer } from "../server/signing-vault.mjs";
import { decodeSignedDelegate, verifySignedDelegate } from "../server/relayer/delegate.mjs";
import { validateDelegate, SOCIAL_CONTRACT, STORAGE_DEPOSIT } from "../server/relayer/policy.mjs";
import {
  generateInboxKey,
  openInboxMessage,
  sealInboxMessage,
  toBase64Url,
  validInboxRecord,
} from "../server/inbox/crypto.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS_ROOT = resolve(process.env.E2E_SHOTS || join(ROOT, "output/qa/2026-11-signing-vault"));
const DEVICES = {
  "phone-390": {
    engine: chromium,
    profile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  },
  iphone: { engine: webkit, profile: strip(devices["iPhone 15"]) },
  pixel: { engine: chromium, profile: strip(devices["Pixel 7"]) },
};
function strip({ defaultBrowserType, ...profile }) {
  return profile;
}
const STORAGE_BLOCKED = /blocking the storage your explorer account key needs/;
// Chain context the stubbed relayer reports (access-key nonce, final block).
const CHAIN = { nonce: 1000, blockHeight: 5000, blockTtl: 120 };

async function freePort() {
  return new Promise((done, fail) => {
    const s = createNetServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}
const listen = (server, port, host) =>
  new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => done());
  });

// The vault build goes to a throwaway directory so it never touches dist/.
async function buildVault() {
  const outDir = mkdtempSync(join(tmpdir(), "questlayer-vault-dist-"));
  await build({
    root: ROOT,
    mode: "signing-vault",
    logLevel: "error",
    publicDir: false,
    build: { outDir, emptyOutDir: true },
  });
  assert.ok(existsSync(join(outDir, "signing-vault.html")), "vault build has its page");
  return outDir;
}

// The game on http://127.0.0.1:<port>, the vault on http://localhost:<port>:
// two different sites, so the vault frame is a genuine third-party iframe.
async function startServers() {
  const vaultPort = await freePort();
  const vaultOrigin = `http://localhost:${vaultPort}`;
  const port = await freePort();
  const appOrigin = `http://127.0.0.1:${port}`;
  const vaultDist = await buildVault();
  const config = {
    appOrigin,
    vaultOrigin,
    // Same-origin RPC path, answered by the route stub below.
    rpcUrl: `${vaultOrigin}/rpc`,
    network: "testnet",
    contracts: { social: SOCIAL_CONTRACT, collectibles: "collectibles-e2e.testnet" },
  };
  const vaultServers = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const s = createSigningVaultServer({ config, dist: vaultDist });
    try {
      await listen(s, vaultPort, host);
      vaultServers.push(s);
    } catch (e) {
      if (host === "127.0.0.1") throw e; // ::1 is optional (no IPv6 loopback)
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "questlayer-e2e-vault-"));
  const child = spawn(process.execPath, [join(ROOT, "server/index.mjs")], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: appOrigin,
      SIGNING_VAULT_ORIGIN: vaultOrigin,
      DATABASE_PATH: join(dir, "e2e.sqlite"),
      DISABLE_RELAYER: "1",
      DISABLE_NATIVE_ATTESTATIONS: "1",
      NEAR_RPC_URL: "http://127.0.0.1:9",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const h = await (await fetch(`${appOrigin}/api/health`)).json();
      if (h.worldPreparation?.days?.some((d) => d.state === "ready")) break;
    } catch {}
    if (Date.now() > deadline) throw Error("Server did not become ready.");
    await new Promise((r) => setTimeout(r, 500));
  }
  const config2 = await (await fetch(`${appOrigin}/api/config`)).json();
  assert.equal(config2.signingVaultOrigin, vaultOrigin, "the game advertises the vault origin");
  return {
    appOrigin,
    vaultOrigin,
    stop() {
      child.kill("SIGTERM");
      for (const s of vaultServers) s.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(vaultDist, { recursive: true, force: true });
    },
  };
}

// Network-layer stand-ins for the account factory, the relayer, NEAR Social
// reads and the RPC. Everything they saw is recorded in `log`.
async function stubChain(context, { appOrigin, vaultOrigin }, { inbox = null } = {}) {
  const log = { creates: [], accessKeyQueries: [], prepares: [], relayed: [], profilePrepares: 0, rejected: [], inboxSends: [] };
  // unread: the peer's reply until the list is opened after the badge saw it.
  const state = { account: null, playerName: null, published: false, jobs: new Map(), social: {}, messages: [], unread: 0, unreadSeen: false };
  // NEAR Social as a nested object: every relayed `set` is merged in.
  const merge = (into, from) => {
    for (const [k, v] of Object.entries(from)) {
      if (v && typeof v === "object") merge((into[k] ??= {}), v);
      else into[k] = v;
    }
  };
  if (inbox) merge(state.social, { [inbox.peer.accountId]: { questlayer: { inbox_key: inbox.peer.keyRecord } } });
  const socialGet = (keys) => {
    const out = {};
    for (const key of keys) {
      const path = key.replace(/\/\*\*$/, "").split("/");
      let v = state.social;
      for (const part of path) v = v?.[part];
      if (v === undefined) continue;
      let o = out;
      path.slice(0, -1).forEach((part) => (o = o[part] ??= {}));
      o[path.at(-1)] = structuredClone(v);
    }
    return out;
  };
  const ownInboxKey = () => state.social[state.account?.accountId]?.questlayer?.inbox_key?.key ?? null;
  const json = (route, status, body) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const accountView = () => ({ network: "testnet", enabled: true, factoryId: "play-e2e.testnet", account: state.account });
  await context.route(
    (url) =>
      url.origin === appOrigin &&
      (/^\/api\/(account|relay|me$|native\/profile)/.test(url.pathname) || (!!inbox && url.pathname.startsWith("/api/inbox"))),
    async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname,
        body = req.postData() ? JSON.parse(req.postData()) : null;
      try {
        if (path === "/api/me") {
          // The real server answers; once the explorer account exists it is
          // listed among the linked accounts, as the factory would record it.
          const response = await route.fetch();
          const data = await response.json();
          if (data.player) state.playerName = data.player.name;
          if (data.player && state.account?.state === "ready")
            data.player.wallets = [...(data.player.wallets || []), { account_id: state.account.accountId, verified_at: Date.now() }];
          return route.fulfill({ response, body: JSON.stringify(data) });
        }
        if (path === "/api/account" && req.method() === "GET") return json(route, 200, accountView());
        if (path === "/api/account/create" && req.method() === "POST") {
          assert.deepEqual(Object.keys(body), ["publicKey"], "only the public key goes to the factory");
          assert.match(body.publicKey, /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
          log.creates.push(body.publicKey);
          state.account = {
            accountId: `mira${randomUUID().slice(0, 8)}.play-e2e.testnet`,
            state: "ready",
            errorCode: null,
            error: null,
            keys: [{ publicKey: body.publicKey, kind: "device", state: "active", label: null, createdAt: Date.now() }],
          };
          return json(route, 201, { account: state.account });
        }
        if (path === "/api/relay/prepare") {
          assert.equal(body.accountId, state.account?.accountId);
          log.prepares.push(body);
          return json(route, 200, {
            nonce: String(CHAIN.nonce + 1),
            maxBlockHeight: String(CHAIN.blockHeight + 100),
            publicKey: body.publicKey,
            remainingJobs: 49,
          });
        }
        if (path === "/api/relay" && req.method() === "POST") {
          // The relayer's own admission checks on the bytes the vault signed.
          const decoded = decodeSignedDelegate(body.signedDelegateBase64);
          assert.ok(verifySignedDelegate(decoded), "the delegate signature verifies");
          const call = validateDelegate(decoded, {
            accountId: state.account.accountId,
            keys: state.account.keys.map((k) => k.publicKey),
            nonce: String(CHAIN.nonce),
            blockHeight: CHAIN.blockHeight,
            blockTtl: CHAIN.blockTtl,
            contracts: { collectibles: "collectibles-e2e.testnet", social: SOCIAL_CONTRACT },
          });
          const job = {
            id: `relay_${randomUUID()}`,
            kind: "call",
            state: "queued",
            accountId: call.senderId,
            receiverId: call.receiverId,
            methodName: call.methodName,
            transactionHash: null,
            result: null,
            errorCode: null,
            error: null,
            updatedAt: Date.now(),
          };
          state.jobs.set(job.id, job);
          log.relayed.push({ ...call, delegateHash: decoded.delegateHash, preview: body.preview });
          if (call.receiverId === SOCIAL_CONTRACT) merge(state.social, call.args.data);
          return json(route, 202, job);
        }
        const jobPath = /^\/api\/relay\/(relay_[a-f0-9-]{36})$/.exec(path);
        if (jobPath) {
          const job = state.jobs.get(jobPath[1]);
          if (!job) return json(route, 404, { error: "Unknown job." });
          Object.assign(job, { state: "confirmed", transactionHash: "E2EStubbedTransactionHash1111111111111111111", updatedAt: Date.now() });
          return json(route, 200, job);
        }
        if (path === "/api/relay") return json(route, 200, { jobs: [...state.jobs.values()] });
        if (path === "/api/native/profile") {
          const accountId = url.searchParams.get("accountId");
          return json(route, 200, {
            network: "testnet",
            contractId: SOCIAL_CONTRACT,
            accountId,
            status: state.published ? "published" : "unpublished",
            profile: null,
            avatarVerified: false,
            publishAvatar: null,
            storage: null,
            minimumStorage: String(STORAGE_DEPOSIT),
            deposit: String(STORAGE_DEPOSIT),
            publishEnabled: true,
          });
        }
        if (path === "/api/native/profile/prepare") {
          log.profilePrepares += 1;
          const profile = {
            schema: "1",
            name: state.playerName.trim(),
            avatar_contract: "",
            avatar_token_id: "",
            updated_at: String(Date.now()),
            mutation_id: `profile_${randomUUID()}`,
          };
          return json(route, 200, {
            network: "testnet",
            receiverId: SOCIAL_CONTRACT,
            accountId: body.accountId,
            methodName: "set",
            gas: "80000000000000",
            deposit: String(STORAGE_DEPOSIT),
            profile,
            args: { data: { [body.accountId]: { questlayer: { profile } } } },
          });
        }
        if (inbox && path === "/api/inbox/summary") {
          if (state.unread) state.unreadSeen = true;
          return json(route, 200, { unread: state.unread, requests: 0 });
        }
        if (inbox && path === "/api/inbox") {
          const last = state.messages.at(-1);
          return json(route, 200, {
            enabled: true,
            accountId: state.account?.accountId ?? null,
            publicKey: ownInboxKey(),
            unread: state.unread,
            requests: 0,
            incoming: [],
            conversations: last
              ? [{ playerId: inbox.peer.playerId, name: inbox.peer.name, state: "open", unread: state.unread, lastAt: last.at, lastMine: last.mine }]
              : [],
          });
        }
        if (inbox && path === "/api/inbox/key/prepare") {
          const record = { schema: "questlayer.inbox-key/1", key: body.publicKey, created_at: String(Date.now()), mutation_id: `inboxkey_${randomUUID()}` };
          return json(route, 200, {
            receiverId: SOCIAL_CONTRACT,
            accountId: state.account.accountId,
            methodName: "set",
            gas: "80000000000000",
            deposit: "1",
            record,
            args: { data: { [state.account.accountId]: { questlayer: { inbox_key: record } } } },
          });
        }
        if (inbox && path === "/api/inbox/key/sync") return json(route, 200, { published: !!ownInboxKey(), publicKey: ownInboxKey() });
        if (inbox && path === "/api/inbox/thread") {
          // Opening the conversation marks it read, once the badge counted it.
          if (state.unreadSeen) state.unread = 0;
          return json(route, 200, {
            peer: { id: inbox.peer.playerId, name: inbox.peer.name, accountId: inbox.peer.accountId, inbox: true },
            state: "open",
            muted: false,
            messages: state.messages,
          });
        }
        if (inbox && path === "/api/inbox/send") {
          assert.equal(body.playerId, inbox.peer.playerId);
          assert.ok(validInboxRecord(body.record), "the vault produced a valid inbox record");
          assert.equal(body.record.from_key, ownInboxKey(), "sealed with the published inbox key");
          assert.equal(body.record.to_key, inbox.peer.publicKey, "sealed to the peer key read from NEAR Social");
          // The peer, holding only its own secret, reads the message.
          const text = openInboxMessage({
            secret: inbox.peer.secret,
            accountId: inbox.peer.accountId,
            senderAccountId: state.account.accountId,
            recipientAccountId: inbox.peer.accountId,
            messageId: body.messageId,
            record: body.record,
          });
          log.inboxSends.push({ messageId: body.messageId, text, record: body.record });
          state.messages.push({ id: body.messageId, mine: true, sender: state.account.accountId, recipient: inbox.peer.accountId, state: "pending", at: Date.now() });
          return json(route, 200, {
            receiverId: SOCIAL_CONTRACT,
            accountId: state.account.accountId,
            methodName: "set",
            gas: "80000000000000",
            deposit: "1",
            messageId: body.messageId,
            peer: { id: inbox.peer.playerId, name: inbox.peer.name },
            args: { data: { [state.account.accountId]: { questlayer: { inbox: { [body.messageId]: body.record } } } } },
          });
        }
        if (inbox && path === "/api/inbox/confirm") {
          const m = state.messages.find((x) => x.id === body.messageId);
          const onChain = state.social[state.account.accountId]?.questlayer?.inbox?.[body.messageId];
          const sent = log.inboxSends.find((x) => x.messageId === body.messageId);
          if (m && onChain && JSON.stringify(onChain) === JSON.stringify(sent.record)) m.state = "delivered";
          return json(route, 200, { state: m?.state ?? "failed" });
        }
        if (path === "/api/native/profile/confirm") {
          state.published = log.relayed.length > 0;
          return json(route, 200, { confirmed: state.published });
        }
        return route.continue();
      } catch (error) {
        log.rejected.push(`${path}: ${error.message}`);
        console.error(`  stub refused ${path}: ${error.message}`);
        return json(route, 400, { error: error.message, code: "E2E_STUB" });
      }
    },
  );
  // NEAR RPC as the vault sees it when binding: the key is a full-access key
  // of the new account.
  await context.route(
    (url) => url.origin === vaultOrigin && url.pathname === "/rpc",
    async (route) => {
      const rpc = JSON.parse(route.request().postData() || "{}");
      const p = rpc.params || {};
      if (inbox && rpc.method === "query" && p.request_type === "call_function" && p.account_id === SOCIAL_CONTRACT && p.method_name === "get") {
        const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString());
        const result = [...Buffer.from(JSON.stringify(socialGet(args.keys)))];
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { result, logs: [], block_height: CHAIN.blockHeight, block_hash: "11111111111111111111111111111111" } }) });
      }
      if (rpc.method !== "query" || p.request_type !== "view_access_key")
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "unsupported in e2e", data: "unsupported" } }) });
      log.accessKeyQueries.push({ accountId: p.account_id, publicKey: p.public_key });
      const registered = state.account?.accountId === p.account_id && state.account.keys.some((k) => k.publicKey === p.public_key);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          registered
            ? { jsonrpc: "2.0", id: rpc.id, result: { nonce: CHAIN.nonce, permission: "FullAccess", block_height: CHAIN.blockHeight, block_hash: "11111111111111111111111111111111" } }
            : { jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "Server error", data: "access key does not exist", name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCESS_KEY", info: {} } } },
        ),
      });
    },
  );
  return { log, state, merge };
}

// Mimics a browser that blocks third-party site data: inside the vault frame
// every storage accessor throws, as Safari does with "Block all cookies".
function blockVaultStorage(vaultOrigin) {
  if (location.origin !== vaultOrigin) return;
  const deny = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  for (const name of ["indexedDB", "localStorage", "sessionStorage"])
    for (const target of [window, Object.getPrototypeOf(window), Window.prototype])
      try {
        Object.defineProperty(target, name, { get: deny, configurable: true });
      } catch {}
  // In case an engine keeps its own accessor: opening a database fails too.
  try {
    IDBFactory.prototype.open = deny;
  } catch {}
}

/**
 * Bob, the simulated peer, stands next to the explorer once they share their
 * position: the real presence answer gets him added, and his card is served.
 */
async function placePeerNearby(context, appOrigin, peer) {
  let at = null;
  await context.route(
    (url) => url.origin === appOrigin && (url.pathname === "/api/presence" || url.pathname === "/api/players/card"),
    async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.pathname === "/api/players/card") {
        if (url.searchParams.get("playerId") !== peer.playerId) return route.continue();
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: peer.playerId, name: peer.name, level: 3, xp: 420, demoBot: false, joinedAt: Date.now() - 86_400_000,
            badges: 1, self: false, wearables: [], auras: { above: null, below: null }, original: false,
            canWave: true, waveHint: null, phrases: [{ key: "hello", text: "Hello!" }],
          }),
        });
      }
      if (req.method() === "POST") {
        const body = JSON.parse(req.postData() || "{}");
        if (body.enabled && Number.isFinite(body.lat)) at = { lat: body.lat, lng: body.lng };
        return route.continue();
      }
      const response = await route.fetch();
      const data = await response.json();
      if (at)
        data.players = [
          ...(data.players || []),
          { id: peer.playerId, name: peer.name, color: "#2fa36b", lat: at.lat + 0.00008, lng: at.lng + 0.00008,
            appearance: { color: "#2fa36b", above: null, below: null, skinTokenId: null, source: "demo" } },
        ];
      return route.fulfill({ response, json: data });
    },
  );
}
async function sharePosition(page) {
  const tabs = page.getByRole("tablist", { name: "Profile", exact: true });
  if (!(await tabs.isVisible().catch(() => false))) {
    await closeOpenSheet(page);
    await page.locator(".topbar .profile-pill").click();
    await tabs.waitFor();
  }
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Share my position for 15 min/ }).click();
  await page.getByRole("button", { name: /Stop sharing my position/ }).waitFor();
  await closeOpenSheet(page);
}
async function startPlaying(page, url, name) {
  await page.goto(url);
  await page.getByPlaceholder("Your explorer name").fill(name);
  await page.getByRole("button", { name: "Start exploring" }).click();
  await page.getByRole("button", { name: "Let's explore", exact: true }).click();
  await page.locator(".topbar .profile-pill").waitFor();
}
async function openAccountAndDevices(page) {
  // A reload can bring Profile back open; otherwise open it from the top bar.
  const tabs = page.getByRole("tablist", { name: "Profile", exact: true });
  if (!(await tabs.isVisible().catch(() => false))) {
    await closeOpenSheet(page);
    await page.locator(".topbar .profile-pill").click();
    await tabs.waitFor();
  }
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const group = page.locator("details.settings-group", { hasText: "Account and devices" });
  if (!(await group.evaluate((d) => d.open))) await group.locator(":scope > summary").click();
  return group;
}
async function waitFor(check, what, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error(`Timed out waiting for ${what}.`);
}

async function runDevice(name, servers) {
  const { engine, profile } = DEVICES[name];
  if (!existsSync(engine.executablePath())) {
    const message = `${engine.name()} is not installed (npx playwright install ${engine.name()})`;
    if (process.env.CI) return [`[${name}] ${message}`];
    console.log(`\n== ${name}: SKIPPED, ${message} ==`);
    return [];
  }
  const shots = join(SHOTS_ROOT, name);
  mkdirSync(shots, { recursive: true });
  let shot = 0;
  const capture = async (page, label, focus) => {
    if (focus) await focus.scrollIntoViewIfNeeded();
    shot += 1;
    await page.screenshot({ path: join(shots, `${String(shot).padStart(2, "0")}-${label}.png`) });
  };
  const report = { device: name, browser: engine.name(), appOrigin: servers.appOrigin, vaultOrigin: servers.vaultOrigin, scenarios: [] };
  const problems = [];
  const browser = await engine.launch();
  console.log(`\n== ${name} (${engine.name()} ${browser.version()}) ==`);
  const newContext = async () => {
    // The game's service worker would answer API requests itself on WebKit,
    // where Playwright cannot route service-worker traffic; block it so the
    // stubs below see every request on every engine.
    const context = await browser.newContext({ ...profile, reducedMotion: "reduce", locale: "en-GB", serviceWorkers: "block" });
    // Unrelated hosts (map tiles, fonts) stay offline; the journey is loopback only.
    await context.route((url) => !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), (r) => r.abort());
    // ...except the map style, served blank so the map (and explorers on it) loads offline.
    await serveBlankMapStyle(context);
    return context;
  };
  const dismissInstallCard = (page) =>
    page.addLocatorHandler(page.locator(".pwa-install"), (card) => card.getByRole("button", { name: /Got it|Not now/ }).click());
  try {
    // 1-3: fresh explorer, sponsored signature, reload.
    {
      const context = await newContext();
      const { log, state } = await stubChain(context, servers);
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await dismissInstallCard(page);

      console.log("1. New explorer: device key in the vault, account for its public key");
      await startPlaying(page, servers.appOrigin, `Mira vault ${name}`);
      const vaultFrame = () => page.frames().find((f) => f.url().startsWith(servers.vaultOrigin));
      await waitFor(() => !!vaultFrame(), "the vault iframe");
      const frameEl = page.locator(`iframe[src^="${servers.vaultOrigin}"]`);
      assert.equal(await frameEl.getAttribute("title"), "QuestLayer secure signing service");
      // The game cannot reach into the vault: different origin and site.
      assert.equal(
        await page.evaluate(() => {
          try {
            return !!document.querySelector("iframe").contentWindow.document;
          } catch {
            return false;
          }
        }),
        false,
        "the game cannot read the vault document",
      );
      await waitFor(async () => log.creates.length > 0 || (await page.getByText(STORAGE_BLOCKED).count()) > 0, "account creation or the storage message");
      const group = await openAccountAndDevices(page);
      if (log.creates.length === 0) {
        // Only acceptable on WebKit: the engine kept third-party storage from
        // the vault and the player is told what to do.
        assert.equal(engine, webkit, "Chromium must give the vault frame (partitioned) storage");
        await group.getByText(STORAGE_BLOCKED).waitFor();
        await group.getByRole("button", { name: "Try again", exact: true }).waitFor();
        await capture(page, "webkit-storage-blocked", group.locator(".account-devices"));
        report.scenarios.push({ name: "third-party storage", mechanism: "blocked by the engine; recovery message shown" });
        console.log("  WebKit blocked vault storage; the recovery message is shown");
      } else {
        const publicKey = log.creates[0];
        await group.locator(".account-devices").getByRole("heading", { name: "Devices" }).waitFor({ timeout: 30_000 });
        const devicesText = await group.locator(".account-devices").innerText();
        assert.ok(devicesText.includes(state.account.accountId), "the Devices list names the explorer account");
        assert.ok(log.accessKeyQueries.some((q) => q.accountId === state.account.accountId && q.publicKey === publicKey), "the vault bound the account after checking its key on chain");
        // The private key stays in the vault frame's own storage.
        assert.equal(
          await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).some((d) => d.name === "questlayer-secure-account") : false)),
          false,
          "the game origin has no secure-account database",
        );
        assert.equal(
          await page.evaluate(() => Object.keys(localStorage).some((k) => /ed25519:|secret/i.test(localStorage.getItem(k) || ""))),
          false,
          "the game origin stores no private key",
        );
        await capture(page, "account-ready", group.locator(".account-devices"));
        report.scenarios.push({ name: "account creation", accountId: state.account.accountId, publicKey });
        console.log(`  ${state.account.accountId} with ${publicKey}`);

        console.log("2. Sponsored signature: profile publication through vault and relayer");
        await waitFor(() => log.relayed.length > 0, "the sponsored profile transaction", 45_000);
        const [relayed] = log.relayed;
        assert.equal(relayed.senderId, state.account.accountId);
        assert.equal(relayed.publicKey, publicKey, "signed by the vault's device key");
        assert.equal(relayed.receiverId, SOCIAL_CONTRACT);
        assert.equal(relayed.methodName, "set");
        assert.equal(relayed.deposit, String(STORAGE_DEPOSIT));
        assert.equal(relayed.nonce, String(CHAIN.nonce + 1));
        assert.deepEqual(Object.keys(relayed.args.data), [state.account.accountId]);
        assert.equal(context.pages().length, 1, "a storage-class profile publication opens no approval window");
        await waitFor(() => state.published, "the profile confirmation");
        report.scenarios.push({ name: "sponsored transaction", receiverId: relayed.receiverId, methodName: relayed.methodName, delegateHash: relayed.delegateHash });

        console.log("3. Reload: the vault still holds the device key");
        const queriesBefore = log.accessKeyQueries.length;
        await page.reload();
        await page.locator(".topbar .profile-pill").waitFor({ state: "attached" });
        await waitFor(() => log.accessKeyQueries.length > queriesBefore || page.getByText("This device is not set up yet").count().then((n) => n > 0), "the vault after reload");
        const again = await openAccountAndDevices(page);
        if (log.accessKeyQueries.length > queriesBefore) {
          await again.locator(".account-devices").getByRole("heading", { name: "Devices" }).waitFor({ timeout: 30_000 });
          assert.equal(log.creates.length, 1, "no second account after reload");
          assert.equal(log.accessKeyQueries.at(-1).publicKey, publicKey, "the same device key after reload");
          report.scenarios.push({ name: "reload", mechanism: `third-party storage kept by ${engine.name()} (partitioned per game site)`, publicKey });
        } else {
          // Key lost on reload: only acceptable on WebKit, with the recovery path.
          assert.equal(engine, webkit, "Chromium keeps the vault key across reloads");
          await again.getByRole("button", { name: "Use my recovery passkey" }).waitFor();
          report.scenarios.push({ name: "reload", mechanism: "storage cleared by the engine; recovery passkey path shown" });
        }
        await capture(page, "after-reload", again.locator(".account-devices"));
        assert.equal(log.relayed.length, 1, "the profile is published once");
      }
      assert.deepEqual(log.rejected, [], "every stubbed call was accepted");
      if (pageErrors.length) report.pageErrors = pageErrors;
      await context.close();
    }

    // 5: encrypted inbox between this explorer and a peer simulated in Node.
    {
      console.log("5. Encrypted inbox: key in the vault, seal against the chain key, open the reply");
      const peerKey = generateInboxKey();
      const peer = {
        playerId: `player_${randomUUID()}`,
        name: "Bob",
        accountId: "bob.play-e2e.testnet",
        secret: peerKey.secret,
        publicKey: toBase64Url(peerKey.publicKey),
        keyRecord: { schema: "questlayer.inbox-key/1", key: toBase64Url(peerKey.publicKey), created_at: "1794268800000", mutation_id: `inboxkey_${randomUUID()}` },
      };
      const context = await newContext();
      const { log, state, merge } = await stubChain(context, servers, { inbox: { peer } });
      await placePeerNearby(context, servers.appOrigin, peer);
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await dismissInstallCard(page);
      await startPlaying(page, servers.appOrigin, `Mira inbox ${name}`);
      await waitFor(async () => log.creates.length > 0 || (await page.getByText(STORAGE_BLOCKED).count()) > 0, "account creation or the storage message");
      if (log.creates.length === 0) {
        assert.equal(engine, webkit, "Chromium must give the vault frame (partitioned) storage");
        report.scenarios.push({ name: "encrypted inbox", mechanism: "skipped: vault storage blocked by the engine" });
      } else {
        await waitFor(() => !!state.social[state.account.accountId]?.questlayer?.inbox_key, "the published inbox key", 60_000);
        const keyCall = log.relayed.find((r) => r.args.data[state.account.accountId].questlayer.inbox_key);
        assert.equal(keyCall.deposit, "1");
        assert.equal(context.pages().length, 1, "publishing the inbox key opens no approval window");
        const text = "Ahoj Bobe, jsem u kašny 🐉";
        // The way a player starts a conversation: share the position, tap Bob
        // standing nearby, "Write a message" on his card.
        await sharePosition(page);
        const bob = page.getByRole("button", { name: /^Bob · nearby explorer/ });
        await bob.waitFor({ timeout: 30_000 });
        await bob.click();
        const card = page.getByRole("dialog", { name: peer.name });
        await card.getByText(/Level \d+/).first().waitFor();
        await capture(page, "inbox-player-card", card);
        await card.getByRole("button", { name: "Write a message" }).click();
        const dialog = page.getByRole("dialog", { name: "Messages" });
        await dialog.getByLabel("Message to Bob").fill(text).catch(async (e) => {
          await capture(page, "inbox-compose-missing");
          throw Error(`no compose field; the dialog says: ${(await dialog.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400)}`, { cause: e });
        });
        await dialog.getByRole("button", { name: "Send" }).click();
        await waitFor(() => log.inboxSends.length > 0, "the sealed message");
        assert.equal(log.inboxSends[0].text, text, "the peer decrypts exactly what was typed");
        await waitFor(() => state.messages[0]?.state === "delivered", "the message on chain");
        // The reply, sealed outside the browser to the vault's published key.
        const replyId = `msg_${randomUUID()}`;
        const reply = "Vidím tě! Za minutu jsem tam.";
        const record = sealInboxMessage({
          secret: peer.secret,
          accountId: peer.accountId,
          peerAccountId: state.account.accountId,
          peerPublicKey: Buffer.from(state.social[state.account.accountId].questlayer.inbox_key.key, "base64url"),
          messageId: replyId,
          text: reply,
          createdAt: Date.now(),
        });
        merge(state.social, { [peer.accountId]: { questlayer: { inbox: { [replyId]: record } } } });
        state.messages.push({ id: replyId, mine: false, sender: peer.accountId, recipient: state.account.accountId, state: "delivered", at: Date.now() });
        await dialog.getByText(reply).waitFor({ timeout: 30_000 });
        await dialog.getByText(text).waitFor();
        assert.equal(
          await page.evaluate(() => Object.keys(localStorage).some((k) => /inbox|secret/i.test(k + (localStorage.getItem(k) || "")))),
          false,
          "the game origin stores no inbox secret",
        );
        await capture(page, "inbox-conversation", dialog);
        // Unread reply → the envelope badge → the list → the conversation.
        state.unread = 1;
        await dialog.getByRole("button", { name: "Close" }).first().click();
        await dialog.waitFor({ state: "hidden" });
        const pill = page.getByRole("button", { name: "Messages: 1 new" });
        await pill.waitFor({ timeout: 40_000 });
        await capture(page, "inbox-badge");
        await pill.click();
        const list = page.getByRole("dialog", { name: "Messages" });
        const row = list.locator(".inbox-row", { hasText: peer.name });
        await row.getByText("1 new").waitFor();
        await capture(page, "inbox-list", list);
        await row.click();
        await list.getByText(reply).waitFor({ timeout: 30_000 });
        await list.getByRole("button", { name: "All messages" }).click();
        await list.locator(".inbox-row", { hasText: peer.name }).waitFor();
        assert.equal(await list.locator(".inbox-row", { hasText: "1 new" }).count(), 0, "the conversation is read");
        await list.getByRole("button", { name: "Close" }).first().click();
        report.scenarios.push({ name: "encrypted inbox", sent: log.inboxSends[0].messageId, received: replyId, via: "player card → Write a message; badge → list → conversation" });
      }
      assert.deepEqual(log.rejected, [], "every stubbed call was accepted");
      if (pageErrors.length) report.pageErrors = pageErrors;
      await context.close();
    }

    // 4: storage blocked inside the vault frame.
    {
      console.log("4. Vault storage blocked: the player sees the recovery message");
      const context = await newContext();
      await context.addInitScript(blockVaultStorage, servers.vaultOrigin);
      const { log } = await stubChain(context, servers);
      const page = await context.newPage();
      await dismissInstallCard(page);
      await startPlaying(page, servers.appOrigin, `Mira blocked ${name}`);
      const group = await openAccountAndDevices(page);
      const message = group.getByText(STORAGE_BLOCKED);
      await message.waitFor({ timeout: 30_000 });
      await group.getByRole("heading", { name: "Secure account unavailable on this device" }).waitFor();
      await capture(page, "storage-blocked", group.locator(".account-devices"));
      const retry = group.getByRole("button", { name: "Try again", exact: true });
      await retry.click();
      await message.waitFor();
      assert.equal(log.creates.length, 0, "no account is created without a stored key");
      assert.equal(log.relayed.length, 0, "nothing is signed");
      // Free play continues: closing Profile returns to the map.
      await page.getByRole("button", { name: "Close panel", exact: true }).first().click();
      await page.locator(".topbar .profile-pill").waitFor();
      report.scenarios.push({ name: "blocked vault storage", mechanism: "recovery message with Try again" });
      await context.close();
    }
    console.log(`  ${name}: signing vault journey passed`);
  } catch (error) {
    problems.push(`[${name}] ${error.stack || error.message}`);
  } finally {
    report.problems = problems;
    writeFileSync(join(shots, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
  }
  return problems;
}

function deviceList() {
  const arg = process.argv.find((a) => a.startsWith("--device="))?.slice(9);
  const want = arg || process.env.E2E_DEVICE || "phone-390";
  const list = want === "all" ? Object.keys(DEVICES) : [want];
  for (const d of list) assert.ok(DEVICES[d], `unknown device ${d}; use ${Object.keys(DEVICES).join(", ")} or all`);
  return list;
}

async function main() {
  const list = deviceList();
  const servers = await startServers();
  const problems = [];
  try {
    for (const name of list) problems.push(...(await runDevice(name, servers)));
  } finally {
    servers.stop();
  }
  if (problems.length) {
    console.error(`\nFAILED:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("\nSigning vault journey passed.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

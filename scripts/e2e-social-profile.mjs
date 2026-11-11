// Cross-browser journeys through the social and profile surfaces a player
// reaches after the first session:
//
//   1. Sign in with an Ethereum wallet (Welcome → "I already have an explorer" → Ethereum, "Continue with
//      MetaMask or Rabby"). The wallet is an EIP-1193 provider injected into
//      the page whose personal_sign is answered in Node by a throwaway viem
//      key, so the server verifies a real SIWE signature. Base RPC is a local
//      stub that answers the Aavegotchi diamond's eth_calls for two gotchis,
//      so the explorer arrives dressed in the higher-BRS one and the
//      Backpack lists both ("Your Aavegotchis"). Wearing the other one
//      changes the look.
//   2. Tap your own avatar on the map: your profile card (worn original and
//      its BRS, "Change outfit") opens; the linked wallet
//      shows under Settings → Ethereum wallets.
//   3. Player dialog: a second explorer shares their position next to the
//      first; tapping their marker opens their card (name, level, wave
//      play stats, equipment slots; "Wave" opens the ready phrases). A wave
//      reaches the other explorer as a toast. Without a secure NEAR account
//      the "Message" button stays off (the encrypted inbox itself runs in
//      scripts/e2e-signing-vault.mjs, where the vault exists).
//
// Each key screen gets an axe scan (serious/critical WCAG A/AA fail).
// Nothing here touches a chain: no NEAR RPC (pointed at a closed port), no
// relayer, a stubbed Base RPC and a wallet key made at run time.
//
// The world is generated from the date, so the server and the browsers run
// on the fixed e2e day (scripts/lib/e2e-clock.mjs) and see the same map on
// every run, at any hour.
//
// Usage:  npm run build && npm run e2e:social-profile [-- --device=<name>]
//   --device=phone-390 | iphone | pixel | all   (default phone-390)
// Screenshots and report.json land in output/qa/2026-11-social-profile/<device>/
// (override the root with E2E_SHOTS).
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium, devices, webkit } from "playwright";
import { decodeFunctionData, encodeFunctionResult, stringToHex, toHex, pad, concat, size } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AAVEGOTCHI, AAVEGOTCHI_ABI } from "../server/aavegotchi.mjs";
import { closeOpenSheet, openScreen } from "./lib/e2e-nav.mjs";
import { fixedDayOffset, shiftBrowserClock } from "./lib/e2e-clock.mjs";
import { serveBlankMapStyle } from "./lib/e2e-map-style.mjs";

const require = createRequire(import.meta.url);
const AXE_SOURCE = require("axe-core").source;
const ROOT = resolve(import.meta.dirname, "..");
const SHOTS_ROOT = resolve(process.env.E2E_SHOTS || join(ROOT, "output/qa/2026-11-social-profile"));
const CLOCK_OFFSET_MS = fixedDayOffset();
const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PHONE_390 = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const strip = ({ defaultBrowserType, ...profile }) => profile;
const DEVICES = {
  "phone-390": { engine: chromium, profile: PHONE_390 },
  iphone: { engine: webkit, profile: strip(devices["iPhone 15"]) },
  pixel: { engine: chromium, profile: strip(devices["Pixel 7"]) },
};

// Two gotchis: the higher rarity score is the default look.
const GOTCHIS = [
  { tokenId: 4242n, name: "Mirakulix", brs: 612n },
  { tokenId: 6741n, name: "Bramblebee", brs: 548n },
];
const gotchiSvg = (fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${fill}"/><circle cx="32" cy="30" r="18" fill="#fff"/></svg>`;

/** getAavegotchi: only the name is decoded (decodeGotchiName), so encode a tuple whose second word points at it. */
function encodeGotchiStruct(tokenId, name) {
  const bytes = stringToHex(name);
  const len = size(bytes);
  const padded = pad(bytes, { size: Math.ceil(len / 32) * 32, dir: "right" });
  return concat([
    pad(toHex(32), { size: 32 }), // offset of the tuple
    pad(toHex(tokenId), { size: 32 }), // tuple word 0: tokenId
    pad(toHex(64), { size: 32 }), // tuple word 1: offset of the name, from the tuple
    pad(toHex(len), { size: 32 }),
    padded,
  ]);
}

/** A local Base JSON-RPC that answers the Aavegotchi diamond for `owner` only. */
async function startBaseRpc(owner) {
  const calls = [];
  const byId = new Map(GOTCHIS.map((g) => [g.tokenId, g]));
  const server = createHttpServer(async (req, res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    const answer = (request) => {
      if (request.method === "eth_chainId") return { result: "0x2105" };
      if (request.method !== "eth_call") return { error: { code: -32601, message: "not stubbed" } };
      const call = request.params[0];
      if (call.to.toLowerCase() !== AAVEGOTCHI.toLowerCase()) return { error: { code: -32000, message: "unknown contract" } };
      const { functionName, args } = decodeFunctionData({ abi: AAVEGOTCHI_ABI, data: call.data });
      calls.push(functionName);
      const mine = args?.[0]?.toLowerCase?.() === owner.toLowerCase();
      const gotchi = typeof args?.[0] === "bigint" ? byId.get(args[0]) : byId.get(args?.[1]);
      if (functionName === "getAavegotchi") return { result: encodeGotchiStruct(gotchi.tokenId, gotchi.name) };
      const result = {
        tokenIdsOfOwner: () => (mine ? GOTCHIS.map((g) => Number(g.tokenId)) : []),
        itemBalances: () => (mine ? [{ itemId: 85n, balance: 1n }] : []),
        itemBalancesOfToken: () => [],
        equippedWearables: () => Array(16).fill(0),
        getAavegotchiSvg: () => gotchiSvg(gotchi.tokenId === 4242n ? "#7c4dff" : "#2fa36b"),
        getItemSvg: () => gotchiSvg("#f5a623"),
        modifiedTraitsAndRarityScore: () => [[50, 50, 50, 50, 50, 50], gotchi.brs],
      }[functionName]?.();
      if (result === undefined) return { error: { code: -32000, message: `no stub for ${functionName}` } };
      return { result: encodeFunctionResult({ abi: AAVEGOTCHI_ABI, functionName, result }) };
    };
    const reply = (r) => ({ jsonrpc: "2.0", id: r.id, ...answer(r) });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}`, calls, stop: () => server.close() };
}

async function freePort() {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

async function startServer(baseRpcUrl) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "questlayer-social-e2e-"));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", join(ROOT, "scripts/lib/e2e-clock.mjs"), join(ROOT, "server/index.mjs")], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      E2E_CLOCK_OFFSET_MS: String(CLOCK_OFFSET_MS),
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: url,
      DATABASE_PATH: join(dir, "e2e.sqlite"),
      DISABLE_RELAYER: "1",
      DISABLE_NATIVE_ATTESTATIONS: "1",
      NEAR_RPC_URL: "http://127.0.0.1:9",
      BASE_RPC_URL: baseRpcUrl,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const h = await (await fetch(`${url}/api/health`)).json();
      if (h.worldPreparation?.days?.some((d) => d.state === "ready")) break;
    } catch {}
    if (Date.now() > deadline) throw Error("Server did not become ready.");
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    url,
    stop() {
      child.kill("SIGTERM");
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function newContext(browser, profile) {
  const context = await browser.newContext({ ...profile, reducedMotion: "reduce", locale: "en-GB" });
  await shiftBrowserClock(context, CLOCK_OFFSET_MS);
  // The map (and the explorer markers on it) loads offline, the same on every run.
  await serveBlankMapStyle(context);
  return context;
}

// The home-screen offer (iPhone, after 45 s of play) may cover the top bar;
// dismiss it as a player would. Update notices are never dismissed.
async function dismissInstallOffer(page) {
  await page.addLocatorHandler(page.locator(".pwa-install"), async (card) => {
    await card.getByRole("button", { name: /Got it|Not now/ }).click();
  });
}

/** An EIP-1193 wallet in the page whose signatures come from Node. */
async function injectWallet(page, account) {
  const signed = [];
  await page.exposeFunction("__e2eSign", async (hex) => {
    const signature = await account.signMessage({ message: { raw: hex } });
    signed.push(Buffer.from(hex.slice(2), "hex").toString("utf8"));
    return signature;
  });
  await page.addInitScript((address) => {
    const provider = {
      isMetaMask: true,
      async request({ method, params }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return "0xaa36a7"; // Sepolia: testnet only
        if (method === "personal_sign") {
          if (String(params?.[1]).toLowerCase() !== address.toLowerCase()) throw Error("wrong account");
          return window.__e2eSign(params[0]);
        }
        throw Object.assign(Error(`unsupported ${method}`), { code: 4200 });
      },
      on() {},
      removeListener() {},
    };
    window.ethereum = provider;
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: Object.freeze({
            info: { uuid: "e2e-wallet", name: "MetaMask", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "io.metamask" },
            provider,
          }),
        }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
  }, account.address);
  return signed;
}

async function startPlaying(page, url, name) {
  await page.goto(url);
  await page.getByPlaceholder("Your explorer name").fill(name);
  await page.getByRole("button", { name: "Start exploring" }).click();
  await page.getByRole("button", { name: "Let's explore", exact: true }).click();
  await page.locator(".topbar .profile-pill").waitFor();
}

async function openSettings(page) {
  const tabs = page.getByRole("tablist", { name: "Profile", exact: true });
  if (!(await tabs.isVisible().catch(() => false))) {
    await closeOpenSheet(page);
    await page.locator(".topbar .profile-pill").click();
    await tabs.waitFor();
  }
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
}

async function waitFor(check, what, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error(`Timed out waiting for ${what}`);
}

async function runDevice(name, server, rpc, account) {
  const { engine, profile } = DEVICES[name];
  const shots = join(SHOTS_ROOT, name);
  mkdirSync(shots, { recursive: true });
  const report = { device: name, browser: engine.name(), a11y: {}, scenarios: [] };
  const problems = [];
  let shot = 0;
  const capture = async (page, label) => {
    shot += 1;
    await page.screenshot({ path: join(shots, `${String(shot).padStart(2, "0")}-${label}.png`) });
  };
  const scan = async (page, screen, include) => {
    assert.equal(await page.locator(".pwa-update").count(), 0, `false "New version ready" on ${screen}`);
    if (!(await page.evaluate(() => typeof window.axe === "object"))) await page.addScriptTag({ content: AXE_SOURCE });
    const violations = await page.evaluate(
      async ({ tags, include }) =>
        (await window.axe.run(include ? document.querySelector(include) : document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] })).violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
        })),
      { tags: A11Y_TAGS, include },
    );
    report.a11y[screen] = violations;
    for (const v of violations)
      if (v.impact === "serious" || v.impact === "critical") problems.push(`a11y ${screen}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes.join(" | ")}`);
    console.log(`  a11y ${screen}: ${violations.length ? violations.map((v) => `${v.id}(${v.impact})`).join(", ") : "clean"}`);
  };
  const browser = await engine.launch();
  console.log(`\n== ${name} (${engine.name()} ${browser.version()}) ==`);
  try {
    // 1. Ethereum sign-in → Aavegotchis.
    console.log("1. Sign in with an Ethereum wallet; the explorer arrives in their best Aavegotchi");
    const ethContext = await newContext(browser, profile);
    const eth = await ethContext.newPage();
    eth.on("pageerror", (e) => console.error("page error:", e.message));
    await dismissInstallOffer(eth);
    const signed = await injectWallet(eth, account);
    await eth.goto(server.url);
    await eth.getByPlaceholder("Your explorer name").fill(`Eth ${name}`);
    await eth.getByRole("button", { name: "I already have an explorer", exact: true }).click();
    await scan(eth, "welcome-login");
    await eth.getByRole("button", { name: "Ethereum", exact: true }).click();
    // A returning wallet (second device run) restores the same explorer.
    await eth.locator(".topbar .profile-pill").waitFor({ timeout: 30_000 });
    assert.equal(signed.length, 1, "the wallet signed one message");
    assert.match(signed[0], /wants you to sign in with your Ethereum account/, "a SIWE text, not a transaction");
    const lets = eth.getByRole("button", { name: "Let's explore", exact: true });
    if (await lets.isVisible().catch(() => false)) await lets.click();
    await capture(eth, "eth-signed-in");

    await openScreen(eth, "Inventory");
    const owned = eth.getByRole("region", { name: "Your Aavegotchis" });
    await owned.waitFor({ timeout: 30_000 });
    const choices = owned.locator(".owned-gotchi-row button");
    await waitFor(async () => (await choices.count()) === 2, "both Aavegotchis");
    assert.deepEqual(
      (await owned.locator(".owned-gotchi-row strong").allInnerTexts()).map((t) => t.trim()),
      GOTCHIS.map((g) => g.name),
      "best rarity score first",
    );
    assert.equal(await choices.nth(0).getAttribute("aria-pressed"), "true", "dressed in the higher-BRS gotchi");
    await capture(eth, "inventory-aavegotchis");
    await scan(eth, "inventory-aavegotchis");
    await choices.nth(1).click();
    await waitFor(async () => (await choices.nth(1).getAttribute("aria-pressed")) === "true", "wearing the second gotchi", 15_000);
    assert.equal(await choices.nth(0).getAttribute("aria-pressed"), "false");
    console.log(`  wearing ${GOTCHIS[1].name}; Base RPC calls: ${[...new Set(rpc.calls)].join(", ")}`);
    report.scenarios.push({ name: "ethereum sign-in", address: account.address, gotchis: GOTCHIS.map((g) => g.name), wearing: GOTCHIS[1].name });

    // 2. Own avatar → your public profile card (worn original, BRS, slots);
    // the linked wallet is listed in Settings.
    console.log("2. Tap your own avatar: your profile card, then the linked wallet");
    await closeOpenSheet(eth);
    const self = eth.getByRole("button", { name: /^You · open your profile: Your linked Aavegotchi/ });
    await self.waitFor({ timeout: 30_000 });
    await self.click();
    const own = eth.getByRole("dialog", { name: `Eth ${name}` });
    await own.waitFor();
    await own.getByText(`${GOTCHIS[1].name} · BRS ${GOTCHIS[1].brs}`).waitFor({ timeout: 15_000 });
    await own.getByRole("button", { name: "Change outfit" }).waitFor();
    assert.equal(await own.getByRole("button", { name: "Message", exact: true }).count(), 0, "no Message on your own card");
    await capture(eth, "own-avatar-profile");
    await scan(eth, "profile");
    await own.getByRole("button", { name: "Close" }).first().click();
    await own.waitFor({ state: "hidden" });
    await openSettings(eth);
    const account_ = eth.locator("details.settings-group", { hasText: "Account and devices" });
    if (!(await account_.evaluate((d) => d.open))) await account_.locator(":scope > summary").click();
    const wallets = account_.locator("details.native-extras", { hasText: "Ethereum wallets" });
    await wallets.waitFor({ timeout: 15_000 });
    if (!(await wallets.evaluate((d) => d.open))) await wallets.locator(":scope > summary").click();
    const shown = `${account.address.slice(0, 6)}…${account.address.slice(-4)}`.toLowerCase();
    await waitFor(
      async () => (await wallets.locator(".session-account").allInnerTexts()).some((t) => t.toLowerCase().includes(shown)),
      `the linked wallet ${shown} under Ethereum wallets`,
      15_000,
    );
    await wallets.scrollIntoViewIfNeeded();
    await capture(eth, "settings-ethereum-wallet");
    await ethContext.close();

    // 3. Player dialog and a wave between two explorers.
    console.log("3. Player dialog: tap another explorer, wave");
    const aContext = await newContext(browser, profile);
    const bContext = await newContext(browser, profile);
    const a = await aContext.newPage();
    const b = await bContext.newPage();
    for (const p of [a, b]) {
      p.on("pageerror", (e) => console.error("page error:", e.message));
      await dismissInstallOffer(p);
    }
    const nameA = `Mira ${name}`;
    const nameB = `Bob ${name}`;
    await startPlaying(a, server.url, nameA);
    await startPlaying(b, server.url, nameB);
    for (const p of [a, b]) {
      await openSettings(p);
      await p.getByRole("button", { name: /Share my position for 15 min/ }).click();
      await p.getByRole("button", { name: /Stop sharing my position/ }).waitFor();
      await closeOpenSheet(p);
    }
    const bob = a.locator(`.other-player-marker[aria-label^="${nameB}"]`);
    await bob.waitFor({ timeout: 30_000 });
    await bob.click();
    const card = a.getByRole("dialog", { name: nameB });
    await card.waitFor();
    await card.getByText(/Level \d+/).first().waitFor();
    await card.getByText("Exploring since").waitFor();
    assert.equal(await card.locator(".player-card-slots li").count() >= 7, true, "seven equipment slots");
    const write = card.getByRole("button", { name: "Message", exact: true });
    assert.equal(await write.isDisabled(), true, "no inbox without a secure NEAR account");
    await card.getByRole("button", { name: "Wave", exact: true }).click();
    await capture(a, "player-card");
    await scan(a, "player-card");
    const hello = card.getByRole("button", { name: "Hello!", exact: true });
    await hello.click();
    await card.getByText("Sent: “Hello!”").waitFor({ timeout: 10_000 });
    await b.getByText(`${nameA} waves: “Hello!”`).waitFor({ timeout: 30_000 });
    await capture(b, "wave-received");
    await card.getByRole("button", { name: "Close" }).first().click();
    await card.waitFor({ state: "hidden" });
    report.scenarios.push({ name: "player dialog", from: nameA, to: nameB, wave: "Hello!" });
    await aContext.close();
    await bContext.close();
  } catch (error) {
    problems.push(error.stack || error.message);
  } finally {
    report.problems = problems;
    writeFileSync(join(shots, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
  }
  return problems;
}

function chosenDevices() {
  const arg = process.argv.find((x) => x.startsWith("--device="))?.slice(9);
  const want = arg || process.env.E2E_DEVICE || "phone-390";
  const list = want === "all" ? Object.keys(DEVICES) : want.split(",");
  for (const d of list) assert.ok(DEVICES[d], `unknown device ${d}; use ${Object.keys(DEVICES).join(", ")} or all`);
  return list;
}

async function main() {
  const list = chosenDevices();
  const problems = [];
  for (const name of list) {
    // A fresh wallet, Base stub and server per device, so every run signs in a new explorer.
    const account = privateKeyToAccount(generatePrivateKey());
    const rpc = await startBaseRpc(account.address);
    const server = await startServer(rpc.url);
    try {
      for (const p of await runDevice(name, server, rpc, account)) problems.push(`[${name}] ${p}`);
    } finally {
      server.stop();
      rpc.stop();
    }
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`\nSocial and profile journeys passed on ${list.join(", ")}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

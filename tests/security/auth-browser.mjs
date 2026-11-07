// Run with Node 24, installed Playwright Chromium and a locally built application.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
const reportPath = process.argv[2];
assert.ok(reportPath, "Supply a report destination.");
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = "http://localhost:" + port,
  dir = mkdtempSync(join(tmpdir(), "questlayer-browser-auth-"));
const report = {
  scope: "Loopback HTTP, Chromium virtual authenticator, no physical hardware",
  scenarios: [],
  passed: false,
};
const child = spawn(process.execPath, ["server/index.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    APP_ORIGIN: origin,
    DATABASE_PATH: join(dir, "game.sqlite"),
    DISABLE_BACKGROUND_WORKERS: "1",
    DISABLE_NATIVE_ATTESTATIONS: "1",
    NEAR_RPC_URL: "http://127.0.0.1:9",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const exit = once(child, "exit");
let browser;
try {
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      if (String(d).includes("QuestLayer server:")) resolve();
    });
    exit.then(() => reject(Error("Test server exited")));
  });
  browser = await chromium.launch();
  async function fixture(context) {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/audit-fixture")
        return route.fulfill({
          body: "<!doctype html><title>Authentication fixture</title>",
          contentType: "text/html",
        });
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(origin + "/audit-fixture");
    return page;
  }
  const context = await browser.newContext(),
    page = await fixture(context);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const api = (page, path, data) =>
    page.evaluate(
      async ({ path, data }) => {
        const r = await fetch(path, {
          method: data === undefined ? "GET" : "POST",
          headers:
            data === undefined ? {} : { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        return { status: r.status, data: await r.json() };
      },
      { path, data },
    );
  const guest = await api(page, "/api/session", { name: "Browser Explorer" });
  assert.equal(guest.status, 201);
  const athlete = guest.data.player.id;
  const old = (await context.cookies()).find(
    (c) => c.name === "questlayer-hackathon",
  );
  const opt = await api(page, "/api/passkey/options", {
    action: "register",
    attach: true,
  });
  const credential = await page.evaluate(
    async (options) =>
      (
        await navigator.credentials.create({
          publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
        })
      ).toJSON(),
    opt.data.options,
  );
  const added = await api(page, "/api/passkey/verify", {
    challengeId: opt.data.challengeId,
    response: credential,
  });
  assert.equal(added.status, 200);
  assert.equal(added.data.player.id, athlete);
  const cookies = await context.cookies(),
    current = cookies.find((c) => c.name === "questlayer-hackathon"),
    proof = cookies.find((c) => c.name === "questlayer-management");
  assert.notEqual(current.value, old.value);
  assert.ok(current.httpOnly && proof.httpOnly && proof.sameSite === "Strict");
  report.scenarios.push(
    "Guest attaches a real browser-generated passkey to the same explorer; the session rotates",
  );
  const copied = await browser.newContext(),
    other = await fixture(copied);
  await copied.addCookies([old]);
  assert.equal((await api(other, "/api/me")).status, 401);
  await copied.addCookies([current]);
  assert.equal((await api(other, "/api/me")).data.player.id, athlete);
  assert.equal(
    (
      await api(other, "/api/passkey/options", {
        action: "register",
        attach: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api(page, "/api/passkey/options", {
        action: "register",
        attach: true,
      })
    ).status,
    200,
  );
  report.scenarios.push(
    "An old cookie is revoked; a copy of only the current game cookie can play but cannot add a credential",
  );
  await api(page, "/api/logout", {});
  assert.equal((await api(other, "/api/me")).status, 401);
  const login = await api(page, "/api/passkey/options", { action: "login" });
  const signed = await page.evaluate(
    async (options) =>
      (
        await navigator.credentials.get({
          publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
        })
      ).toJSON(),
    login.data.options,
  );
  const restored = await api(page, "/api/passkey/verify", {
    challengeId: login.data.challengeId,
    response: signed,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.player.id, athlete);
  assert.equal(
    (
      await api(page, "/api/passkey/verify", {
        challengeId: login.data.challengeId,
        response: signed,
      })
    ).status,
    401,
  );
  report.scenarios.push(
    "Existing passkey restores the same explorer after logout and cannot replay its assertion",
  );
  report.passed = true;
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
  await exit;
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
}

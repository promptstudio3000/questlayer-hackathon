import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const origin = "http://localhost:5173";
test("live HTTP authorization boundaries", { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-auth-http-"));
  const child = spawn(
    process.execPath,
    ["--import", "./tests/fixtures/auth-body-barrier.mjs", "server/index.mjs"],
    {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        APP_ORIGIN: origin,
        NEAR_RPC_URL:
          "http://127.0.0.1:9/server-only-path?token=private-fixture",
        PUBLIC_NEAR_RPC_URL: "http://127.0.0.1:9/public",
        DATABASE_PATH: join(dir, "game.sqlite"),
        DISABLE_BACKGROUND_WORKERS: "1",
        DISABLE_NATIVE_ATTESTATIONS: "1",
        MARKET_MODERATORS: "moderator.testnet",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const exited = once(child, "exit");
  t.after(async () => {
    child.kill("SIGTERM");
    await exited;
    rmSync(dir, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      const address = /QuestLayer server: (http:\/\/127\.0\.0\.1:\d+)/.exec(
        String(d),
      );
      if (address) resolve(address[1]);
    });
    exited.then(() =>
      reject(new Error("Test server exited before listening.")),
    );
  });
  const db = new DatabaseSync(join(dir, "game.sqlite"));
  t.after(() => db.close());
  const post = (path, data, cookie, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: JSON.stringify(data),
    });
  const guest = async () => {
    const r = await post("/api/session", { name: "Test Explorer" });
    assert.equal(r.status, 201);
    return {
      player: (await r.json()).player.id,
      cookie: r.headers.getSetCookie()[0].split(";")[0],
    };
  };
  await t.test("public config returns only the browser RPC", async () => {
    const r = await fetch(base + "/api/config");
    const text = await r.text();
    assert.equal(JSON.parse(text).rpcUrl, "http://127.0.0.1:9/public");
    assert.doesNotMatch(text, /server-only-path|private-fixture/);
  });
  await t.test(
    "hostile request metadata and JSON lookalikes cannot create accounts",
    async () => {
      assert.equal(
        (
          await post("/api/session", { name: "Forged" }, "", {
            "Sec-Fetch-Site": "cross-site",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await post("/api/session", { name: "Forged" }, "", {
            "Content-Type": "application/json-malformed",
          })
        ).status,
        415,
      );
      assert.equal(
        (
          await post("/api/session", { name: "Valid" }, "", {
            "Content-Type": "application/json; charset=UTF-8",
          })
        ).status,
        201,
      );
    },
  );
  await t.test(
    "logout while a request body is in flight prevents its mutation",
    async () => {
      const a = await guest();
      const started = once(child, "message");
      const req = httpRequest(base + "/api/bounties", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: a.cookie,
          "x-test-body-barrier": "1",
        },
      });
      const replied = once(req, "response");
      const payload = JSON.stringify({
        title: "Delayed request",
        description: "Synthetic test",
        lat: 49.7,
        lng: 13.3,
        amount: 1,
      });
      req.write(payload.slice(0, 10));
      assert.equal((await started)[0], "reading-body");
      assert.equal((await post("/api/logout", {}, a.cookie)).status, 200);
      req.end(payload.slice(10));
      const [response] = await replied;
      response.resume();
      assert.equal(response.statusCode, 401);
      assert.equal(
        db
          .prepare("SELECT COUNT(*) n FROM bounties WHERE creator=?")
          .get(a.player).n,
        0,
      );
    },
  );
  await t.test("logout closes only that session's event stream", async () => {
    const a = await guest(),
      b = await guest();
    const controller = new AbortController();
    try {
      const stream = await fetch(base + "/api/events", {
        headers: { Cookie: a.cookie },
        signal: controller.signal,
      });
      const reader = stream.body.getReader();
      assert.equal((await reader.read()).done, false);
      assert.equal((await post("/api/logout", {}, a.cookie)).status, 200);
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        assert.equal((await reader.read()).done, true);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(
        (await fetch(base + "/api/me", { headers: { Cookie: b.cookie } }))
          .status,
        200,
      );
    } finally {
      controller.abort();
    }
  });
  await t.test(
    "an expired streaming session receives no later social event",
    async () => {
      const a = await guest();
      const controller = new AbortController();
      try {
        const reader = (
          await fetch(base + "/api/events", {
            headers: { Cookie: a.cookie },
            signal: controller.signal,
          })
        ).body.getReader();
        await reader.read();
        const hash = createHash("sha256")
          .update(a.cookie.split("=")[1])
          .digest("hex");
        db.prepare("UPDATE sessions SET expires_at=0 WHERE token_hash=?").run(
          hash,
        );
        const b = await guest();
        const posted = await post(
          "/api/messages",
          {
            clientId: "audit-event-note",
            text: "Synthetic local note",
            lat: 49.74745,
            lng: 13.3774,
            arena: true,
            publicConsent: true,
            shareGps: false,
          },
          b.cookie,
        );
        assert.equal(posted.status, 201, await posted.text());
        const outcome = await reader.read();
        assert.equal(outcome.done, true);
      } finally {
        controller.abort();
      }
    },
  );
  await t.test(
    "ordinary players cannot grant themselves moderator rights through profile data or the request body",
    async () => {
      const a = await guest();
      db.prepare("UPDATE players SET native_account=? WHERE id=?").run(
        "moderator.testnet",
        a.player,
      );
      for (const route of ["task/resolve", "secret/resolve"])
        assert.equal(
          (
            await post(
              "/api/market/" + route,
              { moderator: true, actor: "moderator.testnet" },
              a.cookie,
            )
          ).status,
          403,
        );
      assert.equal((await fetch(base + "/api/identity/sessions")).status, 401);
      assert.equal(
        (
          await fetch(base + "/api/market/funding-intent?id=another-owner", {
            headers: { Cookie: a.cookie },
          })
        ).status,
        404,
      );
    },
  );
});

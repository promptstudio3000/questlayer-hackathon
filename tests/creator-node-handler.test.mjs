import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import { createNodeCreatorHandler } from "../server/creators/node-handler.mjs";

test("the real Node HTTP bridge preserves sessions, origin, bounded bodies and host fallback", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Private player");
  const services = createCreatorServices(db, {
    policy: { version: "test-only", xpCommitment: 200 },
  });
  let handler;
  let abortedHandled;
  const abortedFinished = new Promise((resolve) => {
    abortedHandled = resolve;
  });
  const server = createServer(async (req, res) => {
    try {
      if (await handler(req, res)) return;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Existing host route");
    } catch {
      res.writeHead(500);
      res.end("Bridge error");
    } finally {
      if (req.headers["x-test-case"] === "aborted") abortedHandled();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(done);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createNodeCreatorHandler({
    ...services,
    origin,
    enabled: true,
    authenticate: (req) =>
      req.headers.cookie === "session=player" ? player : null,
  });
  const root = origin + "/api/creator-community";
  const profile = {
    operationId: "profile-http",
    expectedVersion: 0,
    profile: { displayName: "Public Explorer", bio: "", public: true },
    publicConsent: true,
  };
  const send = (body, headers = {}) =>
    fetch(root + "/profile", {
      method: "PUT",
      headers: {
        Cookie: "session=player",
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const saved = await send(profile);
  assert.equal(saved.status, 200);
  const receipt = await saved.json();
  assert.deepEqual(await (await send(profile)).json(), receipt);
  const me = await fetch(root + "/me", {
    headers: { Cookie: "session=player" },
  });
  assert.equal((await me.json()).profile.displayName, "Public Explorer");
  assert.equal((await fetch(root + "/me")).status, 401);
  assert.equal(
    (await send(profile, { Origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal((await send("x".repeat(17000))).status, 413);
  const streamingStatus = await new Promise((resolve, reject) => {
    const upload = httpRequest(
      root + "/profile",
      {
        method: "PUT",
        headers: {
          Cookie: "session=player",
          Origin: origin,
          "Content-Type": "application/json",
        },
      },
      (response) => {
        response.resume();
        upload.end();
        resolve(response.statusCode);
      },
    );
    upload.on("error", reject);
    upload.setTimeout(2000, () =>
      upload.destroy(new Error("Oversized upload did not receive a response.")),
    );
    upload.write("x".repeat(9000));
    setImmediate(() => upload.write("x".repeat(9000)));
  });
  assert.equal(
    streamingStatus,
    413,
    "Reject an ongoing upload without destroying its response socket",
  );
  const incomingSeen = once(server, "request");
  const interrupted = httpRequest(root + "/profile", {
    method: "PUT",
    headers: {
      Cookie: "session=player",
      Origin: origin,
      "Content-Type": "application/json",
      "X-Test-Case": "aborted",
    },
  });
  interrupted.on("error", () => {});
  interrupted.write('{"operationId":"interrupted","profile":');
  await incomingSeen;
  interrupted.destroy();
  let abortTimeout;
  try {
    await Promise.race([
      abortedFinished,
      new Promise((_, reject) => {
        abortTimeout = setTimeout(
          () =>
            reject(new Error("Aborted request left a hanging body reader.")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(abortTimeout);
  }
  assert.equal(
    services.community.myProfile(player).version,
    1,
    "Aborted input cannot mutate a profile",
  );
  assert.equal(
    await (await fetch(origin + "/health")).text(),
    "Existing host route",
  );
});

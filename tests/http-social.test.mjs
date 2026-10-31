import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

test("HTTP notes preserve consent, replay, visibility, photo permissions and block/presence boundaries", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-social-http-"));
  const base = "http://127.0.0.1:19082";
  const child = spawn(process.execPath, [resolve("server/index.mjs")], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: "19082",
      HOST: "127.0.0.1",
      APP_ORIGIN: base,
      DATABASE_PATH: join(dir, "test.sqlite"),
      REWARD_ATTESTOR_PATH: "",
      REWARD_WORKER_KEY_PATH: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (part) => (output += part));
  child.stderr.on("data", (part) => (output += part));
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((done) => {
      child.once("exit", done);
      setTimeout(done, 3000).unref();
    });
    rmSync(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  assert(ready, output);
  async function request(path, { method = "GET", data, cookie } = {}) {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(method !== "GET"
          ? { "Content-Type": "application/json", Origin: base }
          : {}),
      },
      ...(method !== "GET" ? { body: JSON.stringify(data ?? {}) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const alice = await request("/session", {
    method: "POST",
    data: { name: "Photo trail author" },
  });
  const bob = await request("/session", {
    method: "POST",
    data: { name: "Nearby reader" },
  });
  const aId = (await request("/me", { cookie: alice.cookie })).data.player.id;
  assert.equal((await request("/messages")).status, 401);
  assert.equal(
    (
      await request("/native/transactions/confirm", {
        method: "POST",
        data: {},
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/native/transactions/confirm", {
        method: "POST",
        data: { accountId: "unlinked.testnet" },
        cookie: alice.cookie,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/native/transactions/confirm", {
        method: "POST",
        data: {
          accountId: "unlinked.testnet",
          quote: { receiverId: "questlayer-tasks-20261031.testnet" },
        },
        cookie: alice.cookie,
      })
    ).status,
    403,
  );
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#672eeb" },
  })
    .png()
    .toBuffer();
  const note = {
    clientId: "http-photo-note",
    text: "Synthetic trail test",
    lat: 49.74745,
    lng: 13.3774,
    arena: true,
    publicConsent: true,
    shareGps: false,
    image: "data:image/png;base64," + image.toString("base64"),
  };
  assert.equal(
    (
      await request("/messages", {
        method: "POST",
        cookie: alice.cookie,
        data: { ...note, publicConsent: false },
      })
    ).status,
    400,
  );
  const created = await request("/messages", {
    method: "POST",
    cookie: alice.cookie,
    data: note,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const replay = await request("/messages", {
    method: "POST",
    cookie: alice.cookie,
    data: note,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.id, created.data.id);
  assert.equal(
    (
      await request("/messages", {
        method: "POST",
        cookie: alice.cookie,
        data: { ...note, text: "Changed same ID" },
      })
    ).status,
    409,
  );
  const nearby = "/messages?arena=1&lat=49.747&lng=13.377";
  const list = await request(nearby, { cookie: bob.cookie });
  assert.equal(list.data.messages.length, 1);
  assert.equal(list.data.messages[0].author_fix, null);
  const url = list.data.messages[0].image;
  const photo = await fetch(base + url, { headers: { Cookie: bob.cookie } });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("cache-control"), "private,no-store");
  assert.equal((await fetch(base + url)).status, 401);
  assert.equal(
    (
      await request(nearby.replace("arena=1", "arena=0"), {
        cookie: bob.cookie,
      })
    ).data.messages.length,
    0,
  );
  const report = await request(`/messages/${created.data.id}/report`, {
    method: "POST",
    cookie: bob.cookie,
    data: { reason: "privacy", detail: "Synthetic report only" },
  });
  assert.equal(report.status, 200);
  assert.equal(
    (await request(nearby, { cookie: bob.cookie })).data.messages.length,
    1,
    "reports do not censor automatically",
  );
  await request("/presence", {
    method: "POST",
    cookie: alice.cookie,
    data: {
      enabled: true,
      renew: true,
      leaseId: "http-photo-presence",
      arena: true,
      lat: note.lat,
      lng: note.lng,
    },
  });
  assert.equal(
    (
      await request("/presence?arena=1&lat=49.747&lng=13.377", {
        cookie: bob.cookie,
      })
    ).data.players.length,
    1,
  );
  assert.equal(
    (
      await request("/social/blocks", {
        method: "POST",
        cookie: bob.cookie,
        data: { targetPlayerId: aId },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(nearby, { cookie: bob.cookie })).data.messages.length,
    0,
  );
  assert.equal(
    (await fetch(base + url, { headers: { Cookie: bob.cookie } })).status,
    404,
  );
  assert.equal(
    (
      await request("/presence?arena=1&lat=49.747&lng=13.377", {
        cookie: bob.cookie,
      })
    ).data.players.length,
    0,
  );
  assert.equal(
    (
      await request("/social/blocks", {
        method: "DELETE",
        cookie: bob.cookie,
        data: { targetPlayerId: aId },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(nearby, { cookie: bob.cookie })).data.messages.length,
    1,
  );
  assert.equal(
    (
      await request(`/messages/${created.data.id}`, {
        method: "DELETE",
        cookie: bob.cookie,
      })
    ).status,
    403,
  );
  const deleted = await request(`/messages/${created.data.id}`, {
    method: "DELETE",
    cookie: alice.cookie,
  });
  assert.equal(deleted.status, 200);
  assert(!("removedImage" in deleted.data));
  assert.equal(
    (await fetch(base + url, { headers: { Cookie: alice.cookie } })).status,
    404,
  );
  const afterDelete = await request("/messages", {
    method: "POST",
    cookie: alice.cookie,
    data: note,
  });
  assert.equal(afterDelete.data.state, "deleted");
  assert.equal(
    (await request(nearby, { cookie: alice.cookie })).data.messages.length,
    0,
  );
  const absent = "never-sent-operation";
  assert.equal(
    (
      await request("/messages/operation/abandon", {
        method: "POST",
        cookie: alice.cookie,
        data: { clientId: absent },
      })
    ).data.state,
    "abandoned",
  );
  assert.equal(
    (
      await request("/messages", {
        method: "POST",
        cookie: alice.cookie,
        data: { ...note, clientId: absent },
      })
    ).status,
    409,
  );
});

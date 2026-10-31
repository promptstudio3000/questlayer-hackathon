import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { AAVEGOTCHI, AAVEGOTCHI_ABI } from "../server/aavegotchi.mjs";
import { openDatabase } from "../server/database.mjs";

test("HTTP original items preserve ownership checks around shared cache and refresh a removed appearance", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-original-art-")),
    port = 19079,
    base = `http://127.0.0.1:${port}`,
    appOrigin = `http://localhost:${port}`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0h2v2H0z"/></svg>';
  let artReads = 0;
  const calls = [];
  const rpc = createServer(async (req, res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    const request = JSON.parse(input);
    const call = request.params[0];
    assert.equal(request.method, "eth_call");
    assert.equal(call.to.toLowerCase(), AAVEGOTCHI.toLowerCase());
    const { functionName } = decodeFunctionData({
      abi: AAVEGOTCHI_ABI,
      data: call.data,
    });
    calls.push(functionName);
    assert.ok(
      ["getItemSvg", "tokenIdsOfOwner", "itemBalances"].includes(functionName),
    );
    if (functionName === "getItemSvg") artReads++;
    const result = encodeFunctionResult({
      abi: AAVEGOTCHI_ABI,
      functionName,
      result: functionName === "getItemSvg" ? svg : [],
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
  rpc.listen(0, "127.0.0.1");
  await once(rpc, "listening");
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      APP_ORIGIN: appOrigin,
      DATABASE_PATH: join(dir, "db.sqlite"),
      BASE_RPC_URL: `http://127.0.0.1:${rpc.address().port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    fixtureDb;
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  t.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    fixtureDb?.close();
    rpc.closeAllConnections();
    await new Promise((resolve) => rpc.close(resolve));
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  const session = await fetch(base + "/api/session", {
    method: "POST",
    headers: { Origin: appOrigin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Original art QA" }),
  });
  assert.equal(session.status, 201);
  const cookie = session.headers.get("set-cookie").split(";")[0],
    player = (await session.json()).player;
  const db = (fixtureDb = openDatabase(join(dir, "db.sqlite")));
  const address = "0x1111111111111111111111111111111111111111",
    snapshot = {
      address,
      gotchis: [{ tokenId: "999", svg }],
      wearables: [{ itemId: "85", quantity: "1" }],
      verifiedAt: Date.now(),
    };
  db.prepare("INSERT INTO external_links VALUES(?,?,?,?)").run(
    address,
    player.id,
    JSON.stringify(snapshot),
    Date.now(),
  );
  db.prepare("UPDATE players SET appearance=? WHERE id=?").run(
    JSON.stringify({ originTokenId: "6741", address }),
    player.id,
  );
  const get = (path) => fetch(base + path, { headers: { Cookie: cookie } });
  const inventory = await (await get("/api/aavegotchi")).json();
  assert.equal(inventory.lookUnavailable, true);
  assert.equal(inventory.gotchis[0].hasImage, true);
  assert.equal(
    inventory.gotchis[0].svg,
    undefined,
    "inventory JSON does not duplicate raw artwork",
  );
  assert.deepEqual(inventory.appearance, {});
  assert.deepEqual(
    JSON.parse(
      db.prepare("SELECT appearance FROM players WHERE id=?").get(player.id)
        .appearance,
    ),
    {},
  );
  assert.equal((await get("/api/aavegotchi/wearable/86.svg")).status, 403);
  assert.equal(artReads, 0);
  const picture = await get("/api/aavegotchi/wearable/85.svg");
  assert.equal(picture.status, 200);
  assert.equal(await picture.text(), svg);
  assert.match(picture.headers.get("content-security-policy"), /sandbox/);
  assert.match(picture.headers.get("cache-control"), /private/);
  assert.equal(artReads, 1);
  snapshot.wearables = [];
  db.prepare("UPDATE external_links SET data=? WHERE address=?").run(
    JSON.stringify(snapshot),
    address,
  );
  assert.equal((await get("/api/aavegotchi/wearable/85.svg")).status, 403);
  assert.equal(
    artReads,
    1,
    "a cached public image cannot bypass the current ownership snapshot",
  );
  const refreshed = await get("/api/aavegotchi?refresh=1");
  assert.equal(refreshed.status, 200);
  assert.deepEqual((await refreshed.json()).wearables, []);
  assert.ok(calls.includes("tokenIdsOfOwner"));
  const statuses = [];
  for (let i = 0; i < 2; i++)
    statuses.push((await get("/api/aavegotchi?refresh=1")).status);
  assert.ok(statuses.includes(429));
});

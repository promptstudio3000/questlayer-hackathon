import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import { createSigningVaultServer } from "../server/signing-vault.mjs";
test("malformed request targets cannot stop the signer and config returns only public fields", async (t) => {
  const server = createSigningVaultServer({
    config: {
      appOrigin: "http://localhost:5173",
      vaultOrigin: "http://localhost:8990",
      rpcUrl: "http://localhost:8991",
      network: "testnet",
      contracts: { qgold: "gold.testnet", extra: "private-fixture" },
      extra: "private-fixture",
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const get = async (path) => {
    const req = request({
      host: "127.0.0.1",
      port: server.address().port,
      path,
    });
    req.setTimeout(2500, () => req.destroy(new Error("No HTTP response")));
    const received = once(req, "response");
    req.end();
    const [res] = await received;
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    return { status: res.statusCode, body: Buffer.concat(chunks).toString() };
  };
  assert.equal((await get("//[")).status, 400);
  const config = await get("/vault-config.json");
  assert.equal(config.status, 200);
  assert.doesNotMatch(config.body, /private-fixture/);
  assert.equal(JSON.parse(config.body).contracts.qgold, "gold.testnet");
});

import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keeperFixture, NOW } from "./fixtures/qgold-keeper.mjs";
import { KEEPER_LEASE_MS } from "../server/qgold/keeper-journal.mjs";

async function child(config) {
  const process = fork(new URL("./fixtures/qgold-keeper-child.mjs", import.meta.url), [], {
    env: { PATH: globalThis.process.env.PATH, NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let boundary = false, result, failure, stderr = "";
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { process.kill("SIGKILL"); reject(Error("keeper child timeout")); }, 20_000);
    process.stdout.on("data", (data) => {
      if (data.toString().includes("KEEPER_FINAL_COMMIT_BOUNDARY")) { boundary = true; process.kill("SIGKILL"); }
    });
    process.stderr.on("data", (data) => { stderr += data; });
    process.on("message", (message) => {
      if (message.type === "boundary") { boundary = true; process.kill("SIGKILL"); }
      if (message.type === "done") result = message.result;
      if (message.type === "error") failure = message.message;
    });
    process.on("error", reject);
    process.on("exit", (code, signal) => {
      clearTimeout(timeout);
      try {
        if (config.stop) { assert.equal(boundary, true, failure ?? stderr); assert.equal(signal, "SIGKILL"); }
        else { assert.equal(code, 0, failure ?? stderr); assert.ok(result, failure ?? stderr); }
        resolve({ result, signal });
      } catch (error) { reject(error); }
    });
  });
  process.send(config); return done;
}
function paths(t, mode = "inverse") {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-keeper-process-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = { dbPath: join(dir, "app.sqlite"), ledgerPath: join(dir, "modeled-chain.sqlite"), now: NOW, leaseNow: NOW, mode };
  const f = keeperFixture(config); config.secret = f.secret; f.close();
  return config;
}
for (const method of ["near_deposit", "ft_transfer_call", "ft_burn"]) for (const phase of ["before", "after"])
  test(`actual SIGKILL ${phase} ${method}: restart preserves one allocation and one successful step`, async (t) => {
    const config = paths(t); await child({ ...config, stop: { phase, method } });
    const restarted = await child({ ...config, tickNow: NOW + 3_600_001, leaseNow: NOW + KEEPER_LEASE_MS + 1 });
    assert.deepEqual(restarted.result.operations, ["done"]); assert.equal(restarted.result.calls, 3);
    assert.equal(restarted.result.spent, String(10n ** 24n)); assert.equal(restarted.result.sentRows, 1);
    const replayed = await child({ ...config, tickNow: NOW + 3_600_002, leaseNow: NOW + KEEPER_LEASE_MS * 2 });
    assert.deepEqual(replayed.result, restarted.result);
  });
for (const method of ["deposit", "ft_transfer_call"])
  test(`actual SIGKILL after sale ${method}: recovery never repeats the vault purchase`, async (t) => {
    const config = paths(t, "sale"); await child({ ...config, stop: { phase: "after", method } });
    const restarted = await child({ ...config, tickNow: NOW + 3_600_001, leaseNow: NOW + KEEPER_LEASE_MS + 1 });
    assert.deepEqual(restarted.result.operations, ["done"]); assert.equal(restarted.result.calls, 2); assert.equal(restarted.result.sentRows, 1);
    const replayed = await child({ ...config, tickNow: NOW + 3_600_002, leaseNow: NOW + KEEPER_LEASE_MS * 2 });
    assert.deepEqual(replayed.result, restarted.result);
  });
test("SIGKILL inside final accounting rolls back only the acknowledgement and never repeats chain steps", async (t) => {
  const config = paths(t); await child({ ...config, stop: { phase: "commit" } });
  const restarted = await child({ ...config, tickNow: NOW + 3_600_001, leaseNow: NOW + KEEPER_LEASE_MS + 1 });
  assert.deepEqual(restarted.result.operations, ["done"]); assert.equal(restarted.result.calls, 3); assert.equal(restarted.result.sentRows, 1);
  const replayed = await child({ ...config, tickNow: NOW + 3_600_002, leaseNow: NOW + KEEPER_LEASE_MS * 2 });
  assert.deepEqual(replayed.result, restarted.result);
});
test("two independent keeper processes sharing a database produce one completed operation", async (t) => {
  const config = paths(t); const runs = await Promise.all([child(config), child(config)]);
  assert.ok(runs.every((r) => r.signal === null));
  const f = keeperFixture(config);
  try {
    assert.equal(f.calls().length, 3); assert.equal(f.balance("spent"), 10n ** 24n);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM qgold_keeper_ops WHERE state='done'").get().n, 1);
  } finally { f.close(); }
});

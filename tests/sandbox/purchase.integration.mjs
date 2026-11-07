// Real QGOLD WASM, synthetic signers and a loopback-only NEAR node.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import {
  KeyPair,
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
} from "near-api-js";
import { escrowLocalTransport } from "./escrow-rpc.mjs";
import { purchaseFixture } from "../fixtures/qgold-purchase.mjs";
import { setSpendRealm } from "../../server/gold-spend/ledger.mjs";
import { openDatabase, createPlayer } from "../../server/database.mjs";
import { SubsidyBudget } from "../../server/relayer/subsidy-budget.mjs";
import { ManagedAccounts } from "../../server/relayer/accounts.mjs";
import { Relayer } from "../../server/relayer/relay.mjs";
import { relayTransport } from "../../server/relayer/key-transport.mjs";
const [helper, wasmPath, reportPath] = process.argv.slice(2);
assert.ok(helper && wasmPath && reportPath);
const { Sandbox, GenesisAccount } = await import(
  pathToFileURL(resolve(helper))
);
const NEAR = 10n ** 24n,
  token = "qgold.testnet",
  ownerId = "owner.testnet",
  relayId = "relay.testnet";
const keys = new Map(),
  transports = new Map(),
  code = readFileSync(wasmPath),
  dir = mkdtempSync(join(tmpdir(), "questlayer-purchase-wasm-"));
const report = {
  scope: "loopback synthetic local chain",
  startedAt: new Date().toISOString(),
  wasm: {
    sha256: createHash("sha256").update(code).digest("hex"),
    bytes: code.length,
  },
  scenarios: [],
  transactions: [],
  releaseReady: false,
};
const genesis = [ownerId, token, relayId, "alice.testnet"].map((id) => {
  const key = KeyPair.fromRandom("ed25519");
  keys.set(id, key);
  return new GenesisAccount(
    id,
    key.getPublicKey().toString(),
    key.toString(),
    1000n * NEAR,
  );
});
let sandbox, owner;
const transport = async (id) => {
  if (!transports.has(id))
    transports.set(
      id,
      await escrowLocalTransport({
        rpcUrl: sandbox.rpcUrl,
        accountId: id,
        secretKey: keys.get(id).toString(),
      }),
    );
  return transports.get(id);
};
const record = (response) => {
  const r = structuredClone(response);
  if (r.transaction?.signature) delete r.transaction.signature;
  for (const a of r.transaction?.actions ?? [])
    if (a.Delegate) delete a.Delegate.signature;
  report.transactions.push(r);
  return response;
};
const call = async (method, args, deposit = 0n, account = ownerId) =>
  record(await (await transport(account)).call(token, method, args, deposit));
const balance = async () =>
  BigInt(
    await owner.view(token, "ft_balance_of", { account_id: "alice.testnet" }),
  );
const status = (hash, account) =>
  owner.provider.viewTransactionStatusWithReceipts({
    txHash: hash,
    accountId: account,
    waitUntil: "FINAL",
  });
async function scenario(name, work) {
  try {
    const result = await work();
    report.scenarios.push({ name, passed: true, ...result });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.scenarios.push({ name, passed: false, error: error.message });
    console.log(`FAIL ${name}: ${error.message.slice(0, 220)}`);
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
async function purchase() {
  const f = purchaseFixture({ owner: "alice.testnet", token });
  await assert.rejects(f.run(), (e) => e.code === "QGOLD_BURN");
  return { ...f, call: f.prepare() };
}
async function fundingProcess(input) {
  const child = fork(
    new URL("./subsidy-worker-child.mjs", import.meta.url),
    [],
    {
      env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Funding child timed out"));
    }, 60000);
    let observed;
    child.on("message", (message) => {
      observed = message;
      if (message.phase) child.kill("SIGKILL");
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (observed?.error || (!observed?.done && !observed?.phase))
        reject(
          Error(observed?.error ?? `Unexpected child exit ${code}/${signal}`),
        );
      else resolve({ ...observed, signal, code });
    });
    child.send(input);
  });
}
async function delegate(account, call, maxBlockHeight) {
  const access = await account.provider.query({
    request_type: "view_access_key",
    account_id: account.accountId,
    public_key: keys.get(account.accountId).getPublicKey().toString(),
    finality: "final",
  });
  const block = await account.provider.viewBlock({ finality: "final" });
  return (
    await account.signer.signDelegateAction(
      buildDelegateAction({
        senderId: account.accountId,
        receiverId: token,
        publicKey: await account.signer.getPublicKey(),
        nonce: BigInt(access.nonce) + 1n,
        maxBlockHeight: maxBlockHeight ?? BigInt(block.header.height + 120),
        actions: [
          actions.functionCall("ft_burn", call.args, BigInt(call.gas), 1n),
        ],
      }),
    )
  ).signedDelegate;
}
try {
  sandbox = await Sandbox.start({
    version: "2.14.0",
    config: {
      additionalAccounts: genesis,
      additionalGenesis: { epoch_length: 10_000_000 },
    },
  });
  owner = await transport(ownerId);
  const alice = (await transport("alice.testnet")).account,
    relay = (await transport(relayId)).account;
  report.node = {
    version: owner.status.version.version,
    chainId: owner.status.chain_id,
    protocol: owner.status.protocol_version,
  };
  await (await transport(token)).account.deployContract(code);
  await call("new", {
    council: [ownerId],
    threshold: 1,
    guardian_id: ownerId,
    treasury_id: ownerId,
    minters: [ownerId],
    initial_rate: "1000000000000000000000",
    metadata: {
      spec: "ft-1.0.0",
      name: "Local QGOLD",
      symbol: "QGOLD",
      decimals: 6,
    },
  });
  await call(
    "mint_for",
    { account_id: alice.accountId, memo: "synthetic test balance" },
    10n * NEAR,
  );
  setSpendRealm("qgold");
  for (const delegated of [false, true])
    await scenario(
      `${delegated ? "delegated" : "direct"} actual burn: exact receipt proof and one delivery`,
      async () => {
        const f = await purchase(),
          before = await balance();
        try {
          let r;
          if (delegated)
            r = await relay.signAndSendTransaction({
              receiverId: alice.accountId,
              actions: [actions.signedDelegate(await delegate(alice, f.call))],
              waitUntil: "FINAL",
            });
          else
            r = await alice.callFunctionRaw({
              contractId: token,
              methodName: "ft_burn",
              args: f.call.args,
              gas: BigInt(f.call.gas),
              deposit: 1n,
              waitUntil: "FINAL",
            });
          const tx = (r.final_execution_outcome ?? r).transaction.hash,
            proof = record(
              await status(tx, delegated ? relayId : alice.accountId),
            );
          await f.confirm(proof, { txHash: tx, relayerId: relayId });
          const result = await f.run();
          assert.deepEqual(await f.run(), result);
          assert.equal(before - (await balance()), BigInt(f.call.args.amount));
          assert.equal(
            f.db.prepare("SELECT COUNT(*) n FROM gold_unlocks").get().n,
            1,
          );
          return { tx, burned: f.call.args.amount };
        } finally {
          f.db.close();
        }
      },
    );
  await scenario(
    "actual rejected burn does not spend tokens and permits a bounded retry",
    async () => {
      const f = await purchase(),
        before = await balance();
      try {
        await call("pause", {});
        const r = await (
          await transport(alice.accountId)
        ).call(token, "ft_burn", f.call.args, 1n, BigInt(f.call.gas));
        const tx = r.transaction.hash,
          proof = record(await status(tx, alice.accountId));
        await assert.rejects(
          f.confirm(proof, { txHash: tx }),
          (e) => e.code === "BURN_REJECTED",
        );
        assert.equal(await balance(), before);
        assert.equal(f.prepare().submission, 1);
        await call("unpause", {});
        const ok = await (
          await transport(alice.accountId)
        ).call(token, "ft_burn", f.call.args, 1n, BigInt(f.call.gas));
        await f.confirm(
          record(await status(ok.transaction.hash, alice.accountId)),
          { txHash: ok.transaction.hash },
        );
        await f.run();
        assert.equal(before - (await balance()), BigInt(f.call.args.amount));
        return { failed: tx, succeeded: ok.transaction.hash };
      } finally {
        if ((await owner.view(token, "get_state")).paused)
          await call("unpause", {});
        f.db.close();
      }
    },
  );
  await scenario(
    "relayer database restart and unavailable status replay identical bytes without another burn",
    async () => {
      const file = join(dir, "relay-synthetic.sqlite"),
        f = purchaseFixture({ file, owner: alice.accountId, token });
      await assert.rejects(f.run(), (e) => e.code === "QGOLD_BURN");
      const burn = f.prepare(),
        before = await balance();
      let now = Date.now(),
        sends = 0,
        db = f.db;
      const service = {
        account: relay,
        accountId: relayId,
        publicKey: keys.get(relayId).getPublicKey().toString(),
      };
      const make = () =>
        new Relayer(db, owner.provider, relayTransport(service), {
          accounts: new ManagedAccounts(db, owner.provider, null, {
            factoryId: ownerId,
            subsidyBudget: new SubsidyBudget(db, {
              dailyYocto: 100n * NEAR,
              dailyOperations: 1000,
              gasReserveYocto: NEAR,
              clock: () => now,
            }),
          }),
          contracts: { collectibles: "nft.testnet", qgold: token },
          clock: () => now,
        });
      let worker = make();
      db.prepare(
        "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,funded_yocto,created_at,ready_at,updated_at) VALUES(?,?,?,?,?,'ready',?,?,?,?)",
      ).run(
        alice.accountId,
        f.player,
        "alice",
        ownerId,
        "testnet",
        "0",
        now,
        now,
        now,
      );
      db.prepare(
        "INSERT INTO managed_account_keys VALUES(?,?,'device','active','synthetic key',?,?)",
      ).run(
        alice.accountId,
        keys.get(alice.accountId).getPublicKey().toString(),
        now,
        now,
      );
      const signedDelegateBase64 = Buffer.from(
        encodeSignedDelegate(await delegate(alice, burn)),
      ).toString("base64");
      const job = await worker.submit(f.player, { signedDelegateBase64 });
      const sign = worker.transport.sign;
      worker.transport.sign = async (request) => {
        const tx = await sign(request);
        const send = tx.send;
        tx.send = async () => {
          sends++;
          record(await send());
          throw Error("reply lost after final burn");
        };
        return tx;
      };
      assert.equal((await worker.runRelayJobs()).retried, 1);
      const saved = db.prepare("SELECT * FROM relay_submissions").get();
      assert.equal(await balance(), before - BigInt(burn.args.amount));
      db.close();
      db = openDatabase(file);
      now += 10_000;
      worker = make();
      worker.transport.status = async () => {
        throw Error("UNKNOWN_TRANSACTION");
      };
      const restore = worker.transport.restore;
      worker.transport.restore = (row, request) => {
        const tx = restore(row, request),
          send = tx.send;
        tx.send = async () => {
          sends++;
          return record(await send());
        };
        return tx;
      };
      await worker.runRelayJobs();
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM relay_submissions").get().n,
        1,
      );
      assert.equal(
        db.prepare("SELECT signed_tx FROM relay_submissions").get().signed_tx,
        saved.signed_tx,
      );
      assert.equal(await balance(), before - BigInt(burn.args.amount));
      worker.transport = relayTransport(service);
      now += 20_000;
      await worker.runRelayJobs();
      assert.equal(
        db.prepare("SELECT state FROM relay_jobs WHERE id=?").get(job.id).state,
        "confirmed",
      );
      const next = purchaseFixture({
        db,
        player: f.player,
        owner: alice.accountId,
        token,
      });
      await next.confirm(record(await status(saved.hash, relayId)), {
        intentId: f.id,
        txHash: saved.hash,
        relayerId: relayId,
      });
      await next.run(undefined, f.id);
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM gold_unlocks").get().n,
        1,
      );
      db.close();
      return {
        tx: saved.hash,
        sends,
        submissions: 1,
        burned: burn.args.amount,
        restart: "database closed, new worker and connection",
      };
    },
  );
  await scenario(
    "native account creation has final journal proof and one shared sponsor reservation",
    async () => {
      const db = openDatabase(":memory:"),
        player = createPlayer(db, "Local creation"),
        device = KeyPair.fromRandom("ed25519");
      const budget = new SubsidyBudget(db, {
        dailyYocto: 100n * NEAR,
        dailyOperations: 1000,
        gasReserveYocto: NEAR,
      });
      const accounts = new ManagedAccounts(db, owner.provider, owner.account, {
        factoryId: ownerId,
        fundYocto: NEAR / 10n,
        subsidyBudget: budget,
      });
      await accounts.create(player, {
        publicKey: device.getPublicKey().toString(),
      });
      const worker = new Relayer(
        db,
        owner.provider,
        relayTransport({
          account: relay,
          accountId: relayId,
          publicKey: keys.get(relayId).getPublicKey().toString(),
        }),
        { accounts, contracts: { collectibles: "nft.testnet" } },
      );
      const result = await worker.runRelayJobs();
      assert.equal(
        result.completed,
        1,
        JSON.stringify(
          db.prepare("SELECT error_code,last_error FROM relay_jobs").get(),
        ),
      );
      const row = db.prepare("SELECT * FROM native_funding_attempts").get();
      assert.equal(row.state, "succeeded");
      record(JSON.parse(row.outcome));
      assert.equal(budget.snapshot().pending, 0);
      assert.equal(budget.snapshot().operations, 1);
      db.close();
      return { tx: row.hash, accountCreated: true };
    },
  );
  await scenario(
    "lost native topup reply and a fresh worker reconcile exactly one transfer",
    async () => {
      const file = join(dir, "native-topup.sqlite");
      let db = openDatabase(file);
      const make = () =>
        new ManagedAccounts(db, owner.provider, owner.account, {
          factoryId: ownerId,
          topupCapYocto: 2000n * NEAR,
          subsidyBudget: new SubsidyBudget(db, {
            dailyYocto: 3000n * NEAR,
            dailyOperations: 1000,
            gasReserveYocto: NEAR,
          }),
        });
      let accounts = make();
      const player = createPlayer(db, "Local topup"),
        now = Date.now();
      db.prepare(
        "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,?,'ready',?,?)",
      ).run(alice.accountId, player, "alice", ownerId, "testnet", now, now);
      const before = BigInt(
        (await owner.provider.viewAccount({ accountId: alice.accountId }))
          .amount,
      );
      const needed = before + NEAR / 10n,
        send = owner.provider.sendTransactionUntil.bind(owner.provider);
      owner.provider.sendTransactionUntil = async (...args) => {
        record(await send(...args));
        throw Error("lost native funding reply");
      };
      try {
        await assert.rejects(
          accounts.ensureFunded(alice.accountId, needed, {
            jobId: "local-native-topup",
          }),
          (e) => e.code === "FUNDING_PENDING",
        );
      } finally {
        owner.provider.sendTransactionUntil = send;
      }
      const row = db.prepare("SELECT * FROM native_funding_attempts").get(),
        after = BigInt(
          (await owner.provider.viewAccount({ accountId: alice.accountId }))
            .amount,
        );
      assert.equal(after - before, NEAR / 10n);
      db.close();
      db = openDatabase(file);
      accounts = make();
      await accounts.ensureFunded(alice.accountId, needed, {
        jobId: "local-native-topup",
      });
      assert.equal(
        BigInt(
          (await owner.provider.viewAccount({ accountId: alice.accountId }))
            .amount,
        ),
        after,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM native_funding_attempts").get().n,
        1,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM managed_account_funding").get().n,
        1,
      );
      db.close();
      return { tx: row.hash, transfers: 1 };
    },
  );
  for (const killAt of ["before-send", "after-final"])
    await scenario(
      `OS SIGKILL ${killAt}: native funding recovers exactly once`,
      async () => {
        const file = join(dir, `process-${killAt}.sqlite`),
          db = openDatabase(file);
        new ManagedAccounts(db, owner.provider, owner.account, {
          factoryId: ownerId,
        });
        const player = createPlayer(db, "Process recovery"),
          now = Date.now();
        db.prepare(
          "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,created_at,updated_at) VALUES(?,?,?,?,?,'ready',?,?)",
        ).run(alice.accountId, player, "alice", ownerId, "testnet", now, now);
        db.close();
        const before = BigInt(
            (await owner.provider.viewAccount({ accountId: alice.accountId }))
              .amount,
          ),
          needed = before + NEAR / 10n;
        const input = {
          rpcUrl: sandbox.rpcUrl,
          accountId: ownerId,
          secretKey: keys.get(ownerId).toString(),
          recipient: alice.accountId,
          file,
          needed: String(needed),
        };
        const killed = await fundingProcess({ ...input, killAt });
        assert.equal(killed.signal, "SIGKILL");
        const restarted = await fundingProcess(input);
        assert.equal(restarted.done, true);
        const after = BigInt(
          (await owner.provider.viewAccount({ accountId: alice.accountId }))
            .amount,
        );
        assert.equal(after - before, NEAR / 10n);
        const check = openDatabase(file),
          saved = check
            .prepare("SELECT hash,state FROM native_funding_attempts")
            .all();
        assert.equal(saved.length, 1);
        assert.equal(saved[0].state, "succeeded");
        assert.equal(
          check.prepare("SELECT COUNT(*) n FROM managed_account_funding").get()
            .n,
          1,
        );
        check.close();
        return {
          tx: saved[0].hash,
          workers: [killed, restarted],
          transfers: 1,
        };
      },
    );
} catch (error) {
  report.fatal = error.message;
  console.error(error.message);
} finally {
  setSpendRealm("practice");
  if (sandbox) await sandbox.stop();
  report.finishedAt = new Date().toISOString();
  report.passed =
    !report.fatal &&
    report.scenarios.length > 0 &&
    report.scenarios.every((s) => s.passed);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

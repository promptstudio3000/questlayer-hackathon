// Dry run of the one-command mainnet slice (scripts/deploy-mainnet-slice.mjs)
// against a fake chain: no network, no keys, nothing signed. The last test
// boots the real server on NEAR_NETWORK=mainnet with the manifests the run
// wrote and performs the DISABLE_RELAYER pause drill from docs/OWNER-RUNBOOK.md.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { KeyPair } from "near-api-js";
import {
  slicePlan,
  runSlice,
  codeHash,
  base58,
  nearAmount,
  SOCIAL_CODE_HASH,
  NEAR,
  runtimeEnvText,
} from "../scripts/lib/mainnet-slice.mjs";

const wasm = Buffer.from("fake collectibles wasm v3");
const AWARD = Buffer.alloc(32, 7).toString("base64");
const OPERATOR = "questlayer.near";
const mainnetEnv = {
  COLLECTIBLES_WASM_SHA256: (await import("node:crypto"))
    .createHash("sha256")
    .update(wasm)
    .digest("hex"),
  COLLECTIBLES_FUND_NEAR: "3",
  PLAYER_FACTORY_FUND_NEAR: "5",
  RELAYER_FUND_NEAR: "5",
};
const plan = (env = mainnetEnv, network = "mainnet", operatorId = OPERATOR) =>
  slicePlan({
    network,
    operatorId,
    env,
    wasm,
    awardPublicKey: AWARD,
    stamp: "20261109",
  });

// In-memory chain with the same semantics as the near-api-js adapter.
function fakeChain({ chainId = "mainnet", operatorBalance = 20n * NEAR } = {}) {
  const accounts = new Map([
    [
      OPERATOR,
      {
        amount: String(operatorBalance),
        code_hash: "11111111111111111111111111111111",
      },
    ],
    ["social.near", { amount: "0", code_hash: SOCIAL_CODE_HASH }],
  ]);
  const state = new Map();
  const sent = [];
  let n = 0;
  const tx = (what) => {
    sent.push(what);
    return `tx${++n}`;
  };
  const debit = (fund) => {
    const op = accounts.get(OPERATOR);
    op.amount = String(BigInt(op.amount) - fund);
  };
  return {
    accounts,
    state,
    sent,
    chainId: async () => chainId,
    account: async (id) => accounts.get(id) ?? null,
    async view(id, method) {
      const s = state.get(id);
      if (!s) throw new Error(`no contract ${id}`);
      if (method === "get_version") return s.version;
      if (method === "get_award_signer") return s.signer;
      throw new Error(`MethodNotFound ${method}`);
    },
    async deployContractAccount({ accountId, fund, wasm, initArgs }) {
      assert.ok(!accounts.has(accountId));
      assert.deepEqual(initArgs, { owner_id: OPERATOR, oracle_id: OPERATOR });
      debit(fund);
      accounts.set(accountId, {
        amount: String(fund),
        code_hash: codeHash(wasm),
      });
      state.set(accountId, {
        version: 3,
        signer: null,
        owner: initArgs.owner_id,
      });
      return tx({ deploy: accountId });
    },
    async createAccount({ accountId, publicKey, fund }) {
      assert.ok(!accounts.has(accountId));
      assert.match(publicKey, /^ed25519:/);
      debit(fund);
      accounts.set(accountId, {
        amount: String(fund),
        code_hash: "11111111111111111111111111111111",
        publicKey,
      });
      return tx({ create: accountId });
    },
    async call(contractId, method, args, deposit) {
      assert.equal(method, "set_award_signer");
      assert.equal(deposit, 1n);
      state.get(contractId).signer = args.public_key;
      return tx({ call: method });
    },
  };
}
function fakeKeys() {
  const files = new Map();
  return {
    files,
    read: (f) => files.get(f) ?? null,
    create(f, record) {
      assert.ok(!files.has(f), `${f} would be overwritten`);
      files.set(f, record);
    },
    newKeyPair() {
      const k = KeyPair.fromRandom("ed25519");
      return {
        publicKey: k.getPublicKey().toString(),
        secretKey: k.toString(),
      };
    },
  };
}

test("base58 code hash matches NEAR's encoding", () => {
  assert.equal(base58(Buffer.from([0, 0, 1])), "112");
  assert.equal(base58(Buffer.from("hello")), "Cn8eVZg");
  assert.equal(nearAmount("X", "0.5"), NEAR / 2n);
  assert.equal(nearAmount("X", "12.0025"), 12n * NEAR + 25n * 10n ** 20n);
  for (const bad of ["", "0", "-1", "1e3", "10000", "0.00001", "5 "])
    assert.throws(() => nearAmount("X", bad), /NEAR amount|more than zero/);
});

test("mainnet plan needs the reviewed WASM fingerprint and written amounts", () => {
  assert.throws(
    () => plan({ ...mainnetEnv, COLLECTIBLES_WASM_SHA256: undefined }),
    /reviewed build/,
  );
  assert.throws(
    () => plan({ ...mainnetEnv, COLLECTIBLES_WASM_SHA256: "ab".repeat(32) }),
    /not the reviewed/,
  );
  assert.throws(
    () => plan({ ...mainnetEnv, RELAYER_FUND_NEAR: undefined }),
    /RELAYER_FUND_NEAR/,
  );
  assert.throws(
    () => plan({ ...mainnetEnv, COLLECTIBLES_ACCOUNT: "nfts.evil.near" }),
    /direct sub-account/,
  );
  assert.throws(
    () => plan({ ...mainnetEnv, RELAYER_ACCOUNT: "a.b.questlayer.near" }),
    /direct sub-account/,
  );
  // The contract account must hold its code: 350,650 bytes need 3.5065 NEAR
  // plus the 0.5 NEAR state margin, so 3 NEAR would fail on chain.
  const real = Buffer.alloc(350650, 1);
  const realEnv = {
    ...mainnetEnv,
    COLLECTIBLES_WASM_SHA256: createHash("sha256").update(real).digest("hex"),
  };
  const sized = (env) =>
    slicePlan({
      network: "mainnet",
      operatorId: OPERATOR,
      env,
      wasm: real,
      awardPublicKey: AWARD,
      stamp: "20261109",
    });
  assert.throws(() => sized(realEnv), /at least 4\.0065 NEAR for 350650 bytes/);
  assert.equal(
    sized({ ...realEnv, COLLECTIBLES_FUND_NEAR: "4.5" }).collectibles.fund,
    (45n * NEAR) / 10n,
  );
  const p = plan();
  assert.equal(p.collectibles.accountId, "nfts.questlayer.near");
  assert.equal(p.factory.accountId, "play-20261109.questlayer.near");
  assert.equal(p.factory.keyFile, ".data/player-factory-mainnet.json");
  assert.equal(p.total, 13n * NEAR);
  // Testnet keeps defaults and needs no fingerprint, but its key files are
  // still network-suffixed so a rehearsal never touches the live testnet keys.
  const t = plan({}, "testnet", "ops.testnet");
  assert.equal(t.relayer.keyFile, ".data/relayer-testnet.json");
  assert.equal(t.total, 30n * NEAR);
});

test("plan mode reads the chain, signs nothing and writes nothing", async () => {
  const chain = fakeChain(),
    keys = fakeKeys();
  const r = await runSlice({ plan: plan(), chain, keys, wasm });
  assert.equal(r.status, "planned");
  assert.equal(chain.sent.length, 0);
  assert.equal(keys.files.size, 0);
  assert.equal(r.manifests, null);
  assert.ok(r.steps.filter((s) => s.planned).length >= 4);
});

test("execute deploys the slice once and a re-run only verifies", async () => {
  const chain = fakeChain(),
    keys = fakeKeys();
  const r = await runSlice({
    plan: plan(),
    chain,
    keys,
    wasm,
    execute: true,
    clock: () => new Date("2026-11-09T12:00:00Z"),
  });
  assert.equal(r.status, "deployed");
  assert.deepEqual(
    chain.sent.map((s) => Object.values(s)[0]),
    [
      "nfts.questlayer.near",
      "set_award_signer",
      "play-20261109.questlayer.near",
      "relay-20261109.questlayer.near",
    ],
  );
  assert.equal(chain.state.get("nfts.questlayer.near").signer, AWARD);
  const claims = r.manifests["native-claims-mainnet.json"];
  assert.equal(claims.network, "mainnet");
  assert.equal(claims.contractId, "nfts.questlayer.near");
  assert.equal(claims.attestationPublicKey, AWARD);
  assert.equal(claims.wasmSha256, mainnetEnv.COLLECTIBLES_WASM_SHA256);
  assert.equal(claims.transactions.length, 2);
  const deployment = r.manifests["mainnet-deployment.json"];
  assert.equal(deployment.collectiblesContract, "nfts.questlayer.near");
  assert.equal(deployment.transactions.length, 4);
  assert.equal(r.runtimeEnv.MAINNET_FEATURES, "collectibles,relayer,social");
  assert.equal(
    r.runtimeEnv.PLAYER_FACTORY_FUND_YOCTO,
    "20000000000000000000000",
  );
  assert.equal(r.runtimeEnv.VITE_NEAR_NETWORK, "mainnet");
  assert.equal(keys.files.get(".data/relayer-mainnet.json").network, "mainnet");

  const again = await runSlice({
    plan: plan(),
    chain,
    keys,
    wasm,
    execute: true,
  });
  assert.equal(chain.sent.length, 4, "a re-run sends nothing new");
  assert.equal(again.transactions.length, 0);
});

test("refuses wrong chain, foreign code, another signer, short balance and an unpinned Social", async () => {
  await assert.rejects(
    runSlice({
      plan: plan(),
      chain: fakeChain({ chainId: "testnet" }),
      keys: fakeKeys(),
      wasm,
    }),
    /serves testnet/,
  );
  await assert.rejects(
    runSlice({
      plan: plan(),
      chain: fakeChain({ operatorBalance: 13n * NEAR }),
      keys: fakeKeys(),
      wasm,
    }),
    /needs 13 NEAR plus a 1 NEAR reserve/,
  );
  const foreign = fakeChain();
  foreign.accounts.set("nfts.questlayer.near", {
    amount: "1",
    code_hash: "Other",
  });
  await assert.rejects(
    runSlice({ plan: plan(), chain: foreign, keys: fakeKeys(), wasm }),
    /Upgrades are a separate/,
  );

  const signer = fakeChain(),
    keys = fakeKeys();
  await runSlice({ plan: plan(), chain: signer, keys, wasm, execute: true });
  signer.state.get("nfts.questlayer.near").signer = Buffer.alloc(
    32,
    9,
  ).toString("base64");
  await assert.rejects(
    runSlice({ plan: plan(), chain: signer, keys, wasm }),
    /trusts award signer/,
  );

  const lostKey = fakeChain(),
    k2 = fakeKeys();
  await runSlice({
    plan: plan(),
    chain: lostKey,
    keys: k2,
    wasm,
    execute: true,
  });
  k2.files.delete(".data/relayer-mainnet.json");
  await assert.rejects(
    runSlice({ plan: plan(), chain: lostKey, keys: k2, wasm }),
    /restore the key file/,
  );

  const social = fakeChain();
  social.accounts.get("social.near").code_hash = "Changed";
  await assert.rejects(
    runSlice({ plan: plan(), chain: social, keys: fakeKeys(), wasm }),
    /pinned/,
  );
});

// Minimal JSON-RPC node for the server's start-up checks.
function fakeRpc(keys) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      const reply = (result) =>
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      const fail = (message) =>
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32000,
              message,
              data: message,
              name: "HANDLER_ERROR",
              cause: { name: "UNKNOWN_ACCOUNT", info: {} },
            },
          }),
        );
      if (method === "status")
        return reply({
          chain_id: "mainnet",
          sync_info: {
            latest_block_height: 1,
            latest_block_hash: "11111111111111111111111111111111",
            syncing: false,
          },
        });
      if (
        method === "query" &&
        params.request_type === "view_access_key" &&
        keys.has(`${params.account_id}:${params.public_key}`)
      )
        return reply({
          nonce: 1,
          permission: "FullAccess",
          block_height: 1,
          block_hash: "11111111111111111111111111111111",
        });
      fail(`fake rpc: ${method} ${params?.request_type ?? ""} not served`);
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function boot(appDir, env, port) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: `http://localhost:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const stop = () =>
    new Promise((r) => {
      child.once("exit", r);
      child.kill("SIGTERM");
      setTimeout(r, 3000).unref();
    });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return { health: await res.json(), stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await stop();
  assert.fail(`server did not start on mainnet:\n${output}`);
}

test("the server boots on mainnet from the slice manifests; DISABLE_RELAYER pauses sponsoring", async (t) => {
  const repo = resolve(import.meta.dirname, "..");
  const app = mkdtempSync(join(tmpdir(), "questlayer-mainnet-slice-"));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  cpSync(join(repo, "server"), join(app, "server"), { recursive: true });
  cpSync(join(repo, "public"), join(app, "public"), { recursive: true });
  cpSync(join(repo, "package.json"), join(app, "package.json"));
  symlinkSync(join(repo, "node_modules"), join(app, "node_modules"), "dir");

  const chain = fakeChain(),
    keys = fakeKeys();
  const r = await runSlice({ plan: plan(), chain, keys, wasm, execute: true });
  for (const [name, body] of Object.entries(r.manifests))
    writeFileSync(join(app, "public", name), JSON.stringify(body));
  const data = join(app, ".data");
  mkdirSync(data, { mode: 0o700 });
  const onChainKeys = new Set();
  for (const [file, record] of keys.files) {
    writeFileSync(join(app, file), JSON.stringify(record), { mode: 0o600 });
    onChainKeys.add(`${record.accountId}:${record.publicKey}`);
  }
  const rpc = await fakeRpc(onChainKeys);
  t.after(() => rpc.close());
  const env = {
    ...Object.fromEntries(
      runtimeEnvText(r.runtimeEnv)
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
    ),
    NEAR_RPC_URL: `http://127.0.0.1:${rpc.address().port}`,
    DATABASE_PATH: join(data, "db.sqlite"),
    AWARD_SIGNER_PATH: join(data, "award-attestor-mainnet.pem"),
    DISABLE_BACKGROUND_WORKERS: "1",
    // Synthetic configuration only; no public RPC or signing service is used.
    SIGNING_VAULT_ORIGIN: "http://127.0.0.1:19183",
  };
  delete env.REWARD_ATTESTOR_PATH;

  const unconfigured = await boot(app, { ...env, SIGNING_VAULT_ORIGIN: "" }, 19184);
  try { assert.notEqual(unconfigured.health.relayer.enabled, true, "missing isolated signer fails closed"); }
  finally { await unconfigured.stop(); }
  const live = await boot(app, env, 19181);
  try {
    assert.equal(live.health.network, "mainnet");
    assert.deepEqual(live.health.features, [
      "collectibles",
      "relayer",
      "social",
    ]);
    assert.equal(live.health.relayer.enabled, true);
    assert.equal(live.health.relayer.relayer, "relay-20261109.questlayer.near");
    assert.equal(live.health.nativeRewards.status, "not-configured");
    assert.equal(live.health.creatorMoney.status, "not-configured");
  } finally {
    await live.stop();
  }

  const paused = await boot(app, { ...env, DISABLE_RELAYER: "1" }, 19182);
  try {
    assert.equal(paused.health.network, "mainnet");
    assert.notEqual(
      paused.health.relayer.enabled,
      true,
      "DISABLE_RELAYER=1 stops sponsored actions",
    );
  } finally {
    await paused.stop();
  }
});

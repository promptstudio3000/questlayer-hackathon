import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  base58Hex,
  codeHashOf,
  compareYieldSnapshots,
  decodeYieldRaw,
  diffValues,
  droppedExports,
  pinnedFactoryFor,
  positionAccounts,
  positionTotals,
  predictYieldStorageReserve,
  rawStateDigest,
  recordReplacedDeployment,
  rolloutOptions,
  sha256Hex,
  wasmEmbeds,
  wasmExports,
  yieldAccountingMismatches,
  yieldBusyReasons,
  YIELD_NEW_CONFIG_FIELDS,
  deployBalanceOk,
} from "../scripts/lib/vault-rollout.mjs";

// Read-only snapshot of questlayer-yield-20261102.testnet (block 276944736,
// 9 Nov 2026) taken by the script's dry run: public chain data, no keys.
const snapshot = JSON.parse(readFileSync(new URL("./fixtures/yield-vault-snapshot-20261109.json", import.meta.url)));
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));
// The records as they were before the rollout (the live files change when it runs).
const records = JSON.parse(readFileSync(new URL("./fixtures/vault-rollout-records-20261109.json", import.meta.url)));
const frozen = (p) =>
  structuredClone(
    { "public/native-rewards-testnet.json": records.rewards, "public/native-yield-vault-testnet.json": records.yieldVault, "contracts/wasm-sha256.json": records.pins }[p],
  );

test("code hashes are base58(sha256) as recorded in the manifests", () => {
  const rewards = read("public/native-rewards-testnet.json");
  assert.equal(base58Hex(rewards.wasmSha256), rewards.codeHash);
  assert.equal(base58Hex(rewards.factory.vaultWasmSha256), rewards.factory.vaultCodeHash);
  const bytes = Buffer.from("questlayer");
  assert.equal(codeHashOf(bytes), base58Hex(sha256Hex(bytes)));
  assert.equal(base58Hex("00" + "ff".repeat(31)).startsWith("1"), true);
});

test("only testnet runs, and it has to be said", () => {
  assert.throws(() => rolloutOptions([]), /--network testnet/);
  assert.throws(() => rolloutOptions(["--network", "mainnet"]), /refuse mainnet/);
  assert.throws(() => rolloutOptions(["--network=mainnet", "--execute"]), /refuse mainnet/);
  const dry = rolloutOptions(["--network", "testnet"]);
  assert.equal(dry.execute, false);
  const run = rolloutOptions(["--network=testnet", "--execute", "--wasm-dir", "/tmp/a", "--rollback=/x.wasm"]);
  assert.equal(run.execute, true);
  assert.equal(run.value("--wasm-dir"), "/tmp/a");
  assert.equal(run.value("--rollback"), "/x.wasm");
  assert.equal(run.value("--deploy-tx"), undefined);
});

test("rewards trusts exactly the factory of its own generation", () => {
  assert.equal(pinnedFactoryFor("questlayer-rewards-20261101b.testnet"), "questlayer-vaults-20261101b.testnet");
  assert.throws(() => pinnedFactoryFor("rewards.testnet"), /generation/);
  const rewards = read("public/native-rewards-testnet.json");
  assert.equal(pinnedFactoryFor(rewards.contractId), rewards.factory.contractId);
});

// A minimal module: (export "new" (func 0)) (export "memory" (memory 0)) after a type section.
function wasmWith(names) {
  const entries = [];
  for (const [name, kind] of names) entries.push(name.length, ...Buffer.from(name), kind, 0);
  const exportSection = [names.length, ...entries];
  return Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, 7, exportSection.length, ...exportSection]);
}

test("WASM exports and embedding are read from the bytes", () => {
  const old = wasmWith([["new", 0], ["withdraw", 0], ["memory", 2]]);
  const next = wasmWith([["new", 0], ["withdraw", 0], ["reconcile_idle", 0], ["memory", 2]]);
  assert.deepEqual(wasmExports(next), ["new", "reconcile_idle", "withdraw"]);
  assert.deepEqual(droppedExports(old, next), []);
  assert.deepEqual(droppedExports(next, old), ["reconcile_idle"]);
  assert.throws(() => wasmExports(Buffer.from("not wasm at all")), /Not a WASM/);
  const inner = Buffer.from("vault-bytes-v3");
  assert.equal(wasmEmbeds(Buffer.concat([Buffer.from("factory:"), inner, Buffer.from(":end")]), inner), true);
  assert.equal(wasmEmbeds(Buffer.from("factory:vault-bytes-v2:end"), inner), false);
  assert.equal(wasmEmbeds(Buffer.from("x"), Buffer.alloc(0)), false);
});

test("diffValues reports paths, honours ignore and additive fields", () => {
  const a = { x: 1, nested: { y: "2", list: [1, 2] }, gone: true };
  const b = { x: 1, nested: { y: "3", list: [1, 2, 3] }, added: 5 };
  assert.deepEqual(
    diffValues(a, b).map((d) => d.path),
    ["added", "gone", "nested.list.2", "nested.y"],
  );
  assert.deepEqual(diffValues(a, b, { ignore: ["nested.*", "gone"], additive: ["added"] }), []);
  assert.deepEqual(diffValues(a, a), []);
  assert.deepEqual(diffValues({ a: null }, { a: {} }).map((d) => d.path), ["a"]);
});

test("the live yield-vault storage decodes with the source layout, every byte", () => {
  const decoded = decodeYieldRaw(snapshot.raw.values);
  assert.deepEqual(decoded, snapshot.decoded);
  assert.equal(rawStateDigest(snapshot.raw.values), snapshot.raw.digest);
  assert.equal(decoded.state.tokens.length, 4);
  assert.deepEqual(positionAccounts(decoded.positions), ["questlayer-dev-20261101.testnet"]);
  // The views agree with the raw decode.
  for (const t of snapshot.views.tokens) {
    const raw = decoded.state.tokens.find((x) => x.id === t.token_id);
    assert.equal(raw.principal, t.principal);
    assert.equal(raw.idle, t.idle);
    assert.equal(raw.op, t.op);
  }
  const totals = positionTotals(decoded.positions);
  for (const rows of Object.values(snapshot.views.positions))
    for (const r of rows) assert.equal(totals[r.token_id].principal, r.principal);
  assert.deepEqual(yieldAccountingMismatches(decoded), []);
  assert.deepEqual(yieldBusyReasons(decoded.state), []);
  // Digest is order independent.
  assert.equal(rawStateDigest([...snapshot.raw.values].reverse()), snapshot.raw.digest);
});

test("a different layout, a stray key or a lost record fails the decode", () => {
  const values = structuredClone(snapshot.raw.values);
  const root = values.find((v) => Buffer.from(v.key, "base64").toString() === "STATE");
  root.value = Buffer.concat([Buffer.from(root.value, "base64"), Buffer.from([0])]).toString("base64");
  assert.throws(() => decodeYieldRaw(values), /trailing bytes/);
  assert.throws(() => decodeYieldRaw([...snapshot.raw.values, { key: Buffer.from("zz").toString("base64"), value: "" }]), /Unknown storage key/);
  const lost = snapshot.raw.values.filter((v) => !Buffer.from(v.key, "base64").toString("latin1").includes("usdc"));
  assert.throws(() => decodeYieldRaw(lost), /position_count 2 but 1/);
  const short = structuredClone(snapshot.raw.values);
  const pos = short.find((v) => Buffer.from(v.key, "base64").toString("latin1").includes("usdc"));
  pos.value = Buffer.from(pos.value, "base64").subarray(0, 50).toString("base64");
  assert.throws(() => decodeYieldRaw(short), /need/);
  assert.throws(() => decodeYieldRaw([]), /No STATE/);
});

test("busy tokens and broken totals are named", () => {
  const state = structuredClone(snapshot.decoded.state);
  state.tokens[0].op = 2;
  state.tokens[2].outgoing = "5";
  state.tokens[2].inbound = "7";
  state.tokens[1].pending = "1";
  const reasons = yieldBusyReasons(state);
  assert.equal(reasons.length, 4);
  assert.match(reasons.join("|"), /keeper operation 2.*pending|outgoing payout 5/);
  const decoded = structuredClone(snapshot.decoded);
  decoded.state.tokens[2].principal = "1";
  assert.deepEqual(yieldAccountingMismatches(decoded), ["usdc.fakes.testnet: token principal 1, positions 1507914"]);
});

test("storage predictions follow the contract's reserve rule", () => {
  const base = { balance: "3012940000000000000000000", storageUsage: 292430, oldCodeBytes: 290607, newCodeBytes: 297731, positionCount: "2" };
  const ok = predictYieldStorageReserve(base);
  assert.equal(ok.used, String(292430 - 290607 + 297731));
  assert.equal(ok.needed, ((292430n - 290607n + 297731n + 1200n + 540n) * 10n ** 19n).toString());
  assert.equal(predictYieldStorageReserve({ ...base, balance: (BigInt(ok.needed) - 1n).toString() }).ok, false);
  assert.equal(ok.ok, BigInt(base.balance) >= BigInt(ok.needed));
  assert.equal(deployBalanceOk({ balance: 10n ** 24n, storageUsage: 1000, oldCodeBytes: 0, newCodeBytes: 0 }), true);
  assert.equal(deployBalanceOk({ balance: 10n ** 20n, storageUsage: 400000, oldCodeBytes: 0, newCodeBytes: 0 }), false);
});

test("snapshot comparison: identical passes, any accounting change fails", () => {
  assert.deepEqual(compareYieldSnapshots(snapshot, structuredClone(snapshot)), []);

  // The new code adds three get_config fields; only allowed when said so.
  const upgraded = structuredClone(snapshot);
  Object.assign(upgraded.views.config, { position_bytes: 600, queue_entry_bytes: 180, storage_reserve_ok: true });
  assert.deepEqual(compareYieldSnapshots(snapshot, upgraded, { newConfigFields: true }), []);
  assert.deepEqual(
    compareYieldSnapshots(snapshot, upgraded).map((d) => d.path),
    YIELD_NEW_CONFIG_FIELDS.map((f) => `views.config.${f}`),
  );
  assert.deepEqual(compareYieldSnapshots(upgraded, snapshot, { droppedConfigFields: true }), []);

  // Pausing deposits changes the raw state; only the flag may differ.
  const paused = structuredClone(snapshot);
  paused.raw.digest = "other";
  paused.decoded.state.deposits_paused = true;
  paused.views.config.deposits_paused = true;
  assert.deepEqual(compareYieldSnapshots(snapshot, paused, { allowPausedFlag: true }), []);
  assert.deepEqual(compareYieldSnapshots(snapshot, paused).map((d) => d.path), ["raw.digest", "decoded.state.deposits_paused", "views.config.deposits_paused"]);
  paused.decoded.state.tokens[0].idle = "0";
  assert.deepEqual(compareYieldSnapshots(snapshot, paused, { allowPausedFlag: true }).map((d) => d.path), ["decoded.state.tokens.0.idle"]);

  // A position, a token balance or a Rhea share that moves is caught.
  const moved = structuredClone(snapshot);
  const key = Object.keys(moved.decoded.positions)[0];
  moved.decoded.positions[key].tranches[0].amount = "1";
  moved.external.balances["meta-v2.pool.testnet"] = "0";
  moved.external.rheaSupplyShares["usdc.fakes.testnet"] = "1";
  assert.deepEqual(
    compareYieldSnapshots(snapshot, moved).map((d) => d.path).sort(),
    [`decoded.positions.${key}.tranches.0.amount`, "views.external.balances.meta-v2.pool.testnet", "views.external.rheaSupplyShares.usdc.fakes.testnet"].sort(),
  );

  // A tranche that unlocks between two blocks folds into withdrawable: not a change.
  const later = structuredClone(snapshot);
  for (const rows of Object.values(later.views.positions))
    for (const r of rows) {
      r.withdrawable = r.principal;
      r.tranches = [];
    }
  assert.deepEqual(compareYieldSnapshots(snapshot, later), []);
  later.views.positions["questlayer-dev-20261101.testnet"][0].principal = "1";
  assert.equal(compareYieldSnapshots(snapshot, later).length, 1);
});

/** Same rule as scripts/check-wasm-hashes.mjs section 3, over one manifest. */
function wasmRecordErrors(file, manifest, pins) {
  const built = new Set(Object.values(pins.contracts));
  const listed = pins.testnetDeploymentsNotFromThisBuild;
  const errors = [];
  const walk = (node, path) => {
    for (const [k, v] of Object.entries(node || {})) {
      const here = path ? `${path}.${k}` : k;
      if (/wasmsha256$/i.test(k) && typeof v === "string") {
        const codeKey = k.replace(/WasmSha256$/, "CodeHash").replace(/^wasmSha256$/, "codeHash");
        if (typeof node[codeKey] === "string" && node[codeKey] !== base58Hex(v)) errors.push(`${here}: code hash`);
        if (!built.has(v) && listed[`${file}:${here}`]?.sha256 !== v) errors.push(`${here}: unlisted ${v}`);
      } else if (v && typeof v === "object") walk(v, here);
    }
  };
  walk(manifest, "");
  for (const id of Object.keys(listed)) if (id.startsWith(`${file}:`) && !id.endsWith(":about")) {
    const path = id.slice(file.length + 1).split(".");
    if (path.reduce((n, k) => n?.[k], manifest) === undefined) errors.push(`${id}: listed but absent`);
  }
  return errors;
}

test("recording factory v3 keeps the old generation and the hash exceptions consistent", () => {
  const file = "public/native-rewards-testnet.json";
  const manifest = frozen(file);
  const pins = frozen("contracts/wasm-sha256.json");
  assert.deepEqual(wasmRecordErrors(file, manifest, pins), []);
  const built = pins.contracts;
  const r = recordReplacedDeployment({
    manifest,
    exceptions: pins.testnetDeploymentsNotFromThisBuild,
    manifestFile: file,
    currentPath: "factory",
    historyKey: "factoryHistory",
    record: manifest.factory,
    extra: { replacedAt: "2026-11-09T18:00:00.000Z", replacedBy: "TX" },
    hashKeys: { wasmSha256: "questlayer_vault_factory", vaultWasmSha256: "questlayer_vault" },
    newHashes: { wasmSha256: built.questlayer_vault_factory, vaultWasmSha256: built.questlayer_vault },
    built,
  });
  r.manifest.factory = {
    ...manifest.factory,
    codeHash: base58Hex(built.questlayer_vault_factory),
    wasmSha256: built.questlayer_vault_factory,
    vaultCodeHash: base58Hex(built.questlayer_vault),
    vaultWasmSha256: built.questlayer_vault,
  };
  assert.equal(r.index, 0);
  assert.deepEqual(r.manifest.factoryHistory[0], { ...manifest.factory, replacedAt: "2026-11-09T18:00:00.000Z", replacedBy: "TX" });
  assert.equal(r.exceptions[`${file}:factory.wasmSha256`], undefined);
  assert.equal(r.exceptions[`${file}:factory.vaultWasmSha256`], undefined);
  assert.equal(r.exceptions[`${file}:factoryHistory.0.wasmSha256`].sha256, manifest.factory.wasmSha256);
  assert.equal(r.exceptions[`${file}:factoryHistory.0.vaultWasmSha256`].sha256, manifest.factory.vaultWasmSha256);
  // The standalone v2 treasury vault keeps its listed old hash.
  assert.equal(r.exceptions[`${file}:vaults.0.wasmSha256`].sha256, manifest.vaults[0].wasmSha256);
  assert.deepEqual(wasmRecordErrors(file, r.manifest, { ...pins, testnetDeploymentsNotFromThisBuild: r.exceptions }), []);
  // Inputs are not mutated.
  assert.equal(manifest.factoryHistory, undefined);
  assert.ok(pins.testnetDeploymentsNotFromThisBuild[`${file}:factory.wasmSha256`]);
  assert.throws(
    () => recordReplacedDeployment({ manifest, exceptions: {}, manifestFile: file, currentPath: "factory", historyKey: "h", record: manifest.factory, hashKeys: { wasmSha256: "questlayer_vault_factory" }, newHashes: { wasmSha256: "beef" }, built }),
    /not the pinned/,
  );
});

test("recording the yield-vault upgrade moves its root record to previousDeployments", () => {
  const file = "public/native-yield-vault-testnet.json";
  const manifest = frozen(file);
  const pins = frozen("contracts/wasm-sha256.json");
  const built = pins.contracts;
  const old = { codeHash: manifest.codeHash, wasmSha256: manifest.wasmSha256, verifiedAt: manifest.verifiedAt };
  const r = recordReplacedDeployment({
    manifest,
    exceptions: pins.testnetDeploymentsNotFromThisBuild,
    manifestFile: file,
    currentPath: "",
    historyKey: "previousDeployments",
    record: old,
    extra: { replacedAt: "2026-11-09T18:00:00.000Z" },
    hashKeys: { wasmSha256: "questlayer_yield_vault" },
    newHashes: { wasmSha256: built.questlayer_yield_vault },
    built,
  });
  Object.assign(r.manifest, { codeHash: base58Hex(built.questlayer_yield_vault), wasmSha256: built.questlayer_yield_vault });
  assert.equal(r.exceptions[`${file}:wasmSha256`], undefined);
  assert.equal(r.exceptions[`${file}:previousDeployments.0.wasmSha256`].sha256, old.wasmSha256);
  assert.deepEqual(wasmRecordErrors(file, r.manifest, { ...pins, testnetDeploymentsNotFromThisBuild: r.exceptions }), []);
});

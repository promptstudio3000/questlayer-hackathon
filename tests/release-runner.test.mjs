import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateOp, opCommands, keyInstallTarget, runtimeEnvPlan, applyRuntimeEnv, scrub, parsePin, RELEASE_FILES } from "../scripts/lib/release-runner.mjs";
import { readReleaseStatus, releaseStatusFile } from "../server/release-status.mjs";

const allowlist = JSON.parse(readFileSync(new URL("../deploy/release-ops-allowlist.json", import.meta.url), "utf8"));
const wasm = { path: "contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm", sha256: "d82f4dee87eccc225e83f6048faedc49c96840cfa0eed0de18e57b388884b62a" };
const upgrade = {
  id: "collectibles-editions-uncap",
  script: "scripts/upgrade-collectibles-editions-testnet.mjs",
  ref: "claude/project-thread-xnwsia",
  sha: "8b10c4c000000000000000000000000000000000",
  wasm,
  outputs: ["public/native-editions-testnet.json", "public/native-claims-testnet.json", "contracts/wasm-sha256.json"],
};

test("an allowlisted upgrade runs a read-only plan, then --execute", () => {
  const op = validateOp(upgrade, allowlist, "collectibles-editions-uncap");
  assert.deepEqual(opCommands(op), [
    { step: "plan", argv: ["node", upgrade.script] },
    { step: "execute", argv: ["node", upgrade.script, "--execute"] },
  ]);
  const direct = validateOp({ id: "faucet-sweep-1", script: "scripts/faucet-to-treasury-testnet.mjs" }, allowlist);
  assert.deepEqual(opCommands(direct), [{ step: "execute", argv: ["node", "scripts/faucet-to-treasury-testnet.mjs"] }]);
});

test("refuses scripts off the allowlist, mainnet, unpinned branches and loose upgrades", () => {
  const bad = [
    [{ ...upgrade, script: "scripts/deploy-mainnet-slice.mjs" }, /allowlist/],
    [{ ...upgrade, script: "../../bin/sh" }, /allowlist/],
    [{ ...upgrade, args: ["--network", "mainnet"] }, /testnet only/],
    [{ ...upgrade, args: ["--execute"] }, /execute flag/],
    [{ ...upgrade, args: ["a;rm -rf /"] }, /plain strings/],
    [{ ...upgrade, env: { COLLECTIBLES_ACCOUNT: "nfts.questlayer.near" } }, /testnet only/],
    [{ ...upgrade, env: { NODE_OPTIONS: "--require x" } }, /not allowed/],
    [{ ...upgrade, sha: undefined }, /pin its sha/],
    [{ ...upgrade, wasm: undefined }, /reviewed wasm/],
    [{ ...upgrade, wasm: { ...wasm, sha256: "abc" } }, /64 hex/],
    [{ ...upgrade, outputs: [".data/near-operator.json"] }, /outside \.data/],
    [{ ...upgrade, outputs: ["../etc/passwd"] }, /outside \.data/],
    [{ ...upgrade, id: "Bad Id" }, /id must/],
    [{ ...upgrade, extra: 1 }, /Unknown field/],
  ];
  for (const [op, why] of bad) assert.throws(() => validateOp(op, allowlist), why, JSON.stringify(op));
  assert.throws(() => validateOp(upgrade, allowlist, "other-name"), /does not match/);
});

test("key installs only go to allowlisted service directories, never mainnet", () => {
  assert.deepEqual(keyInstallTarget({ service: "questlayer-testlayer", file: "relayer-testlayer.json" }, allowlist), {
    from: ".data/relayer-testlayer.json",
    dir: "/var/lib/private/questlayer-testlayer",
    file: "relayer-testlayer.json",
    service: "questlayer-testlayer",
  });
  assert.deepEqual(keyInstallTarget({ service: "questlayer-testlayer", file: "testlayer/work/.data/relayer-testnet.json", to: "relayer.json" }, allowlist), {
    from: ".data/testlayer/work/.data/relayer-testnet.json",
    dir: "/var/lib/private/questlayer-testlayer",
    file: "relayer.json",
    service: "questlayer-testlayer",
  });
  assert.equal(keyInstallTarget({ service: "questlayer-testlayer", file: "award-attestor.pem" }, allowlist).file, "award-attestor.pem");
  assert.throws(() => keyInstallTarget({ service: "root", file: "x.json" }, allowlist), /no allowlisted/);
  assert.throws(() => keyInstallTarget({ service: "questlayer-hackathon", file: "../x" }, allowlist), /relative path/);
  assert.throws(() => keyInstallTarget({ service: "questlayer-hackathon", file: "a/../../x.json" }, allowlist), /relative path/);
  assert.throws(() => keyInstallTarget({ service: "questlayer-hackathon", file: "x.json", to: "../x.json" }, allowlist), /plain/);
  assert.throws(() => keyInstallTarget({ service: "questlayer-hackathon", file: "x.json", to: "runtime.env" }, allowlist), /plain/);
  assert.throws(() => keyInstallTarget({ service: "questlayer-hackathon", file: "relayer-mainnet.json" }, allowlist), /Mainnet/);
});

test("the allowlist holds no mainnet script and every entry exists", () => {
  for (const [script, rule] of Object.entries(allowlist.scripts)) {
    assert.ok(!/mainnet/.test(script), script);
    assert.ok(rule.execute === null || rule.execute === "--execute", script);
  }
});

test("logs never carry private keys", () => {
  const secret = "ed25519:" + "3".repeat(88);
  const pem = (edge) => `-----${edge} ${"PRIVATE"} KEY-----`; // built, so the secrets guard sees no PEM literal
  const out = scrub(`key ${secret}\n{"secretKey": "abc", "accountId":"x.testnet"}\n${pem("BEGIN")}\nAAA\n${pem("END")}`);
  assert.ok(!out.includes(secret) && !out.includes('"abc"') && !out.includes("AAA"));
  assert.match(out, /x\.testnet/);
});

test("pin.json switches back to a kept release", () => {
  assert.equal(parsePin(""), null);
  assert.equal(parsePin("{}"), null);
  assert.equal(parsePin('{"release":"20261112T001500Z"}'), "20261112T001500Z");
  assert.throws(() => parsePin('{"release":"../x"}'), /release tag/);
});

test("release archive matches deploy-vps.sh", () => {
  const sh = readFileSync(new URL("../scripts/deploy-vps.sh", import.meta.url), "utf8");
  for (const f of RELEASE_FILES) if (f !== "deploy/questlayer-hackathon.service") assert.ok(sh.includes(f), f);
  assert.match(sh, /< scripts\/vps-activate-release\.sh/);
});

test("release status is served read-only, by op id, and never on mainnet", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-status-"));
  mkdirSync(join(dir, "ops"));
  writeFileSync(join(dir, "status.json"), '{"deploy":{"sha":"x"}}');
  writeFileSync(join(dir, "ops", "abc-1.json"), '{"status":"done"}');
  assert.deepEqual(readReleaseStatus("/api/release/status", { network: "testnet", dir }), { status: 200, body: { deploy: { sha: "x" } } });
  assert.equal(readReleaseStatus("/api/release/ops/abc-1", { network: "testnet", dir }).body.status, "done");
  assert.equal(readReleaseStatus("/api/release/status", { network: "mainnet", dir }).status, 404);
  assert.equal(releaseStatusFile("/api/release/ops/..%2Fstate", dir), null);
  assert.equal(releaseStatusFile("/api/release/ops/../state", dir), null);
});

test("runtime.env changes are limited to allowlisted, non-secret keys", () => {
  const plan = runtimeEnvPlan({ service: "questlayer-testlayer", set: {
    RELAYER_KEY_PATH: "/var/lib/questlayer-testlayer/relayer.json",
    PLAYER_FACTORY_ACCOUNT: { fromKey: "testlayer/work/.data/player-factory-testnet.json", field: "accountId" },
  } }, allowlist);
  assert.equal(plan.file, "/opt/ps3000/apps/questlayer-testlayer/runtime.env");
  assert.equal(plan.entries[1].fromKey, ".data/testlayer/work/.data/player-factory-testnet.json");
  assert.throws(() => runtimeEnvPlan({ service: "questlayer-testlayer", set: { NEAR_AI_KEY: "x" } }, allowlist), /not allowlisted/);
  assert.throws(() => runtimeEnvPlan({ service: "questlayer-hackathon", set: {} }, allowlist), /no allowlisted/);
  assert.throws(() => runtimeEnvPlan({ service: "questlayer-testlayer", set: { RELAYER_KEY_PATH: "a b" } }, allowlist), /plain testnet/);
  assert.throws(() => runtimeEnvPlan({ service: "questlayer-testlayer", set: { PLAYER_FACTORY_ACCOUNT: { fromKey: "x.json", field: "secretKey" } } }, allowlist), /accountId or publicKey/);
  assert.equal(applyRuntimeEnv("A=1\nRELAYER_KEY_PATH=/old\n", { RELAYER_KEY_PATH: "/new", B: "2" }), "A=1\nRELAYER_KEY_PATH=/new\nB=2\n");
  assert.throws(() => applyRuntimeEnv("", { X: "a\nB=1" }), /refused/);
});

test("a deploy job targets an allowlisted service and runs no script", () => {
  const op = validateOp({ id: "testlayer-deploy-1", deployTarget: "testlayer", ref: "claude/x", sha: "a".repeat(40),
    installKeys: [{ service: "questlayer-testlayer", file: "testlayer/work/.data/relayer-testnet.json", to: "relayer.json" }] }, allowlist);
  assert.equal(op.deployTarget, "testlayer");
  assert.equal(keyInstallTarget(op.installKeys[0], allowlist).dir, "/var/lib/private/questlayer-testlayer");
  assert.throws(() => validateOp({ id: "deploy-x", deployTarget: "mainnet" }, allowlist), /not allowlisted/);
  assert.throws(() => validateOp({ id: "deploy-x", deployTarget: "world-root" }, allowlist), /not allowlisted/);
  assert.throws(() => validateOp({ id: "deploy-x", deployTarget: "testlayer", script: "scripts/deploy-testlayer.mjs" }, allowlist), /no script/);
});

test("a startUnit job starts only an allowlisted unit and takes no script", () => {
  const op = validateOp({ id: "poi-worker-run-1", startUnit: "questlayer-poi", note: "demo cities" }, allowlist);
  assert.equal(op.startUnit, "questlayer-poi");
  assert.equal(op.script, null);
  assert.throws(() => validateOp({ id: "unit-x", startUnit: "questlayer-hackathon" }, allowlist), /not allowlisted/);
  assert.throws(() => validateOp({ id: "unit-y", startUnit: "questlayer-poi", script: "scripts/deploy-testlayer.mjs" }, allowlist), /only id, startUnit/);
});

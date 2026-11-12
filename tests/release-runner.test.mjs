import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateOp, opCommands, keyInstallTarget, scrub, parsePin, RELEASE_FILES } from "../scripts/lib/release-runner.mjs";
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
    dir: "/var/lib/questlayer-testlayer",
    file: "relayer-testlayer.json",
    service: "questlayer-testlayer",
  });
  assert.throws(() => keyInstallTarget({ service: "root", file: "x.json" }, allowlist), /no allowlisted/);
  assert.throws(() => keyInstallTarget({ service: "questlayer-hackathon", file: "../x" }, allowlist), /plain file/);
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
  const out = scrub(`key ${secret}\n{"secretKey": "abc", "accountId":"x.testnet"}\n-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----`);
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

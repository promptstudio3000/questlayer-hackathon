#!/usr/bin/env node
// VPS release runner (docs/VPS-RELEASE-RUNNER.md). Runs on the VPS as root from
// the copy installed in /usr/local/lib/questlayer-release (taken from main,
// never from the deploy branch). Every step that runs repository code (npm ci,
// tests, builds, operator scripts) runs as the unprivileged questlayer-release
// user; root only activates releases with the installed scripts and installs
// key files into allowlisted service directories. Testnet only.
//
//   release-runner.mjs tick              timer entry: self-update, deploy, ops
//   release-runner.mjs run-op <id> <sha> one queued operation (systemd-run)
//   release-runner.mjs status            print the public status
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  statSync,
  copyFileSync,
  chownSync,
  chmodSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateOp,
  opCommands,
  keyInstallTarget,
  applyRuntimeEnv,
  scrub,
  tail,
  parsePin,
  RELEASE_FILES,
  OP_ID,
  SHA,
} from "./lib/release-runner.mjs";

const INSTALL = process.env.RELEASE_INSTALL_DIR || join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.RELEASE_HOME || "/var/lib/questlayer-release";
const STATE_DIR = process.env.RELEASE_STATE_DIR || "/var/lib/questlayer-release-state";
const STATUS_DIR = process.env.RELEASE_STATUS_DIR || "/var/lib/questlayer-release-status";
const USER = process.env.RELEASE_USER || "questlayer-release";
const DEPLOY_BRANCH = process.env.RELEASE_DEPLOY_BRANCH || "claude/project-thread-0rica6";
const MAIN_BRANCH = process.env.RELEASE_MAIN_BRANCH || "claude/upbeat-gauss-5czir7";
const ENABLED = process.env.RELEASE_DEPLOY_ENABLED === "1";
const APP = { name: "questlayer-hackathon", port: 7091, domain: "questlayer.promptstudio3000.com" };
const APP_DIR = `/opt/ps3000/apps/${APP.name}`;
const REPO = join(HOME, "repo");
const KEYS = join(HOME, "keys");
const WORK = join(HOME, "work");
const NODE = process.execPath;
// Files the runner installs from main; a change on main updates the runner.
const RUNNER_FILES = [
  "scripts/release-runner.mjs",
  "scripts/lib/release-runner.mjs",
  "scripts/vps-activate-release.sh",
  "scripts/vps-install-signing-vault-release.sh",
  "deploy/release-ops-allowlist.json",
];

const now = () => new Date().toISOString();
const tag = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
function writeJson(p, data, mode = 0o644) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(data, null, 2) + "\n", { mode });
  renameSync(`${p}.tmp`, p);
}

// Runs argv as the release user. Returns { ok, out } with a scrubbed tail.
function asUser(argv, { cwd = HOME, env = {}, timeout = 60 * 60_000 } = {}) {
  const r = spawnSync(
    "runuser",
    ["-u", USER, "--", "env", `HOME=${HOME}`, `PATH=${HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin`, ...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...argv],
    { cwd, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 },
  );
  const out = scrub(`${r.stdout || ""}${r.stderr || ""}${r.error ? `\n${r.error.message}` : ""}`);
  return { ok: r.status === 0, code: r.status, out };
}
function must(result, what) {
  if (!result.ok) throw Object.assign(new Error(`${what} failed (exit ${result.code})`), { log: tail(result.out, 80) });
  return result.out;
}
const git = (args, opts) => must(asUser(["git", "-C", REPO, ...args], opts), `git ${args[0]}`).trim();
function asRoot(argv, opts = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024, ...opts });
  const out = scrub(`${r.stdout || ""}${r.stderr || ""}`);
  if (r.status !== 0) throw Object.assign(new Error(`${argv[0]} ${argv[1] || ""} failed (exit ${r.status})`), { log: tail(out, 80) });
  return out;
}

const statePath = join(STATE_DIR, "state.json");
const loadState = () => readJson(statePath, { deploy: {}, ops: {}, runner: {} });
const saveState = (s) => writeJson(statePath, s, 0o600);
function publish(state) {
  // Public: no keys, no runtime.env values. Threads read it at /api/release/status.
  writeJson(join(STATUS_DIR, "status.json"), {
    updatedAt: now(),
    deployBranch: DEPLOY_BRANCH,
    enabled: ENABLED,
    deploy: state.deploy,
    runner: state.runner,
    ops: Object.fromEntries(
      Object.entries(state.ops).map(([id, o]) => [id, { status: o.status, sha: o.sha, startedAt: o.startedAt, finishedAt: o.finishedAt, error: o.error || null }]),
    ),
  });
}

// --- worktrees --------------------------------------------------------------
function worktree(name, sha) {
  const dir = join(WORK, name);
  if (existsSync(dir)) asUser(["git", "-C", REPO, "worktree", "remove", "--force", dir]);
  rmSync(dir, { recursive: true, force: true });
  git(["worktree", "add", "--detach", dir, sha]);
  return dir;
}
function dropWorktree(dir) {
  asUser(["git", "-C", REPO, "worktree", "remove", "--force", dir]);
  rmSync(dir, { recursive: true, force: true });
}

// --- self-update from main ----------------------------------------------------
function selfUpdate(state) {
  const main = git(["rev-parse", `origin/${MAIN_BRANCH}`]);
  let changed = [];
  for (const f of RUNNER_FILES) {
    const wanted = asUser(["git", "-C", REPO, "show", `${main}:${f}`]);
    if (!wanted.ok) continue; // not on main yet
    const target = join(INSTALL, f);
    if (!existsSync(target) || readFileSync(target, "utf8") !== wanted.out) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, wanted.out, { mode: f.endsWith(".sh") ? 0o755 : 0o644 });
      changed.push(f);
    }
  }
  state.runner = { mainSha: main, checkedAt: now(), ...(changed.length ? { updatedAt: now(), updated: changed } : { updatedAt: state.runner?.updatedAt, updated: state.runner?.updated }) };
  return changed.length > 0;
}

// --- deploy -----------------------------------------------------------------
function healthy() {
  const r = spawnSync("curl", ["-fsS", "--retry", "20", "--retry-delay", "1", "--retry-all-errors", `http://127.0.0.1:${APP.port}/api/health`], { encoding: "utf8" });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
}

function switchTo(release, state) {
  const dir = join(APP_DIR, "releases", release);
  if (!existsSync(join(dir, "server/index.mjs"))) throw new Error(`Release ${release} is not on the VPS (12 are kept).`);
  const previous = asRoot(["readlink", join(APP_DIR, "current")]).trim();
  asRoot(["ln", "-sfn", dir, join(APP_DIR, "current")]);
  asRoot(["systemctl", "restart", APP.name]);
  if (!healthy()) {
    asRoot(["ln", "-sfn", previous, join(APP_DIR, "current")]);
    asRoot(["systemctl", "restart", APP.name]);
    throw new Error(`Release ${release} did not answer /api/health; switched back.`);
  }
  state.deploy = { ...state.deploy, live: release, pinned: release, switchedAt: now() };
}

function build(sha) {
  const dir = worktree("deploy", sha);
  try {
    const log = [];
    log.push(must(asUser(["npm", "ci", "--no-audit", "--no-fund"], { cwd: dir }), "npm ci"));
    log.push(must(asUser(["npm", "run", "check"], { cwd: dir, timeout: 45 * 60_000 }), "npm run check"));
    writeFileSync(join(dir, "build-id.txt"), `${sha}\n`);
    const files = RELEASE_FILES.filter((f) => existsSync(join(dir, f)));
    const pub = readdirSync(join(dir, "public")).filter((f) => f.endsWith(".json")).map((f) => `public/${f}`);
    const release = tag();
    const archive = `/tmp/${APP.name}-${release}.tgz`;
    asRoot(["tar", "--no-xattrs", "-czf", archive, "-C", dir, ...files, ...pub]);
    return { release, archive, dir, log: tail(log.join("\n"), 40) };
  } catch (e) {
    dropWorktree(dir);
    throw e;
  }
}

function signingVault(dir) {
  // Same rule as deploy-vps.sh: reinstall when the fingerprint of its inputs changed.
  const want = must(asUser(["bash", "scripts/signing-vault-fingerprint.sh"], { cwd: dir }), "signing vault fingerprint").trim();
  const have = existsSync("/opt/ps3000/apps/questlayer-signer/current/inputs.sha256")
    ? readFileSync("/opt/ps3000/apps/questlayer-signer/current/inputs.sha256", "utf8").trim()
    : "";
  if (want === have) return { status: "unchanged", fingerprint: want };
  const stage = join(HOME, "signer-stage");
  rmSync(stage, { recursive: true, force: true });
  must(asUser(["mkdir", "-p", stage]), "mkdir");
  must(asUser(["bash", "scripts/install-signing-vault-vps.sh"], { cwd: dir, env: { SIGNING_VAULT_STAGE_DIR: stage } }), "signing vault build");
  const root = "/opt/ps3000/apps/questlayer-signer", release = tag();
  asRoot(["install", "-d", "-m", "755", `${root}/releases/${release}`]);
  asRoot(["cp", "-R", `${stage}/.`, `${root}/releases/${release}/`]);
  asRoot(["chown", "-R", "root:root", `${root}/releases/${release}`]);
  asRoot(["bash", join(INSTALL, "scripts/vps-install-signing-vault-release.sh"), root, release, "questlayer-signer.promptstudio3000.com", "7092"]);
  rmSync(stage, { recursive: true, force: true });
  return { status: "reinstalled", fingerprint: want, release };
}

function deploy(state, head) {
  const pinFile = asUser(["git", "-C", REPO, "show", `${head}:deploy/pin.json`]);
  const pin = parsePin(pinFile.ok ? pinFile.out : "");
  if (pin) {
    // "vrať to": switch to a kept release without building.
    if (state.deploy.live !== pin) switchTo(pin, state);
    return;
  }
  if (state.deploy.sha === head || state.deploy.failedSha === head) return;
  state.deploy = { ...state.deploy, building: head, buildStartedAt: now() };
  saveState(state);
  publish(state);
  let built;
  try {
    built = build(head);
    asRoot(["bash", join(INSTALL, "scripts/vps-activate-release.sh"), built.release, "testnet", APP.name, String(APP.port), APP.domain], { cwd: "/" });
    const vault = signingVault(built.dir);
    state.deploy = { sha: head, release: built.release, live: built.release, pinned: null, deployedAt: now(), signingVault: vault, failedSha: null, error: null };
  } catch (e) {
    state.deploy = { ...state.deploy, building: null, failedSha: head, failedAt: now(), error: `${e.message}\n${e.log || ""}`.slice(0, 6000) };
  } finally {
    if (built) {
      rmSync(built.archive, { force: true });
      dropWorktree(built.dir);
    }
  }
}

// --- operations ---------------------------------------------------------------
const allowlist = () => readJson(join(INSTALL, "deploy/release-ops-allowlist.json"), { scripts: {}, keyDirs: {} });
const opUnit = (id) => `questlayer-op-${id}`;
const unitActive = (id) => spawnSync("systemctl", ["is-active", "--quiet", opUnit(id)]).status === 0;

function queueOps(state, head) {
  const listing = asUser(["git", "-C", REPO, "ls-tree", "--name-only", `${head}:deploy/ops`]);
  if (!listing.ok) {
    state.opsBaselineAt ??= now();
    return;
  }
  const running = Object.entries(state.ops).find(([id, o]) => o.status === "running");
  if (running) {
    if (unitActive(running[0])) return; // one operation at a time: they share the operator key
    const result = readJson(join(STATUS_DIR, "ops", `${running[0]}.json`), null);
    state.ops[running[0]] = { ...running[1], status: result?.status === "done" ? "done" : "failed", finishedAt: result?.finishedAt || now(), error: result?.error || (result ? null : "The operation stopped without a result.") };
  }
  const names = listing.out.split("\n").filter((n) => n.endsWith(".json")).sort();
  if (!state.opsBaselineAt) {
    // First run: operations already in the tree before the runner existed were
    // run by hand; never replay them. Only operations added later run.
    for (const n of names) state.ops[n.slice(0, -5)] ??= { status: "baseline", sha: head, finishedAt: now() };
    state.opsBaselineAt = now();
    return;
  }
  for (const name of names) {
    const id = name.slice(0, -5);
    if (!OP_ID.test(id) || state.ops[id]) continue;
    try {
      validateOp(JSON.parse(asUser(["git", "-C", REPO, "show", `${head}:deploy/ops/${name}`]).out), allowlist(), id);
    } catch (e) {
      state.ops[id] = { status: "refused", sha: head, finishedAt: now(), error: e.message };
      writeJson(join(STATUS_DIR, "ops", `${id}.json`), { id, status: "refused", error: e.message, finishedAt: now() });
      continue;
    }
    asRoot(["systemd-run", `--unit=${opUnit(id)}`, "--collect", "--property=TimeoutStartSec=infinity", NODE, join(INSTALL, "scripts/release-runner.mjs"), "run-op", id, head]);
    state.ops[id] = { status: "running", sha: head, startedAt: now() };
    return;
  }
}

function runOp(id, deploySha) {
  if (!OP_ID.test(id) || !SHA.test(deploySha)) throw new Error("run-op <id> <deploy-sha>");
  const result = { id, status: "running", startedAt: now(), steps: [] };
  const save = () => writeJson(join(STATUS_DIR, "ops", `${id}.json`), result);
  let dir;
  try {
    const op = validateOp(JSON.parse(git(["show", `${deploySha}:deploy/ops/${id}.json`])), allowlist(), id);
    const rule = allowlist().scripts[op.script];
    Object.assign(result, { script: op.script, args: op.args, ref: op.ref, note: op.note });
    let sha = deploySha;
    if (op.ref) {
      git(["fetch", "--quiet", "origin", `+refs/heads/${op.ref}:refs/remotes/origin/${op.ref}`]);
      must(asUser(["git", "-C", REPO, "merge-base", "--is-ancestor", op.sha, `origin/${op.ref}`]), `${op.sha} on ${op.ref}`);
      sha = op.sha;
    }
    result.sha = sha;
    save();
    dir = worktree(`op-${id}`, sha);
    symlinkSync(KEYS, join(dir, ".data"));
    must(asUser(["npm", "ci", "--no-audit", "--no-fund"], { cwd: dir }), "npm ci");
    if (rule.contracts || op.wasm) {
      result.steps.push({ step: "contracts", log: tail(must(asUser(["bash", "scripts/build-contracts.sh", "--no-check"], { cwd: dir, timeout: 90 * 60_000 }), "contract build"), 20) });
      save();
    }
    if (op.wasm) {
      const got = createHash("sha256").update(readFileSync(join(dir, op.wasm.path))).digest("hex");
      if (got !== op.wasm.sha256) throw new Error(`${op.wasm.path} built on the VPS hashes ${got}, the operation expects ${op.wasm.sha256}. Nothing was signed.`);
      result.wasm = { path: op.wasm.path, sha256: got, verified: true };
    }
    for (const { step, argv } of opCommands(op)) {
      const r = asUser(argv, { cwd: dir, env: { ...op.env, NEAR_NETWORK: "testnet" }, timeout: 48 * 3600_000 });
      result.steps.push({ step, ok: r.ok, exit: r.code, log: tail(r.out, 300) });
      save();
      if (!r.ok) throw new Error(`${step} failed (exit ${r.code})`);
    }
    // Repository files the script rewrote (manifests, records): a thread commits them.
    result.outputs = {};
    for (const p of op.outputs) {
      const file = join(dir, p);
      if (!existsSync(file)) { result.outputs[p] = null; continue; }
      if (statSync(file).size > 512 * 1024) throw new Error(`Output ${p} is over 512 KB.`);
      result.outputs[p] = scrub(readFileSync(file, "utf8"));
    }
    result.installedKeys = op.installKeys.map((item) => installKey(keyInstallTarget(item, allowlist())));
    if (op.runtimeEnv) result.runtimeEnv = writeRuntimeEnv(op.runtimeEnv);
    result.status = "done";
  } catch (e) {
    result.status = "failed";
    result.error = `${e.message}${e.log ? `\n${e.log}` : ""}`.slice(0, 8000);
  } finally {
    result.finishedAt = now();
    save();
    if (dir) dropWorktree(dir);
  }
}

// Root: copy a key file the operation wrote into .data/ to a service state
// directory. Never replaces a different existing file; owner follows the directory.
function installKey({ from, dir, file, service }) {
  const src = join(KEYS, from.slice(".data/".length));
  const target = join(dir, file);
  const st = statSync(src, { throwIfNoEntry: false });
  if (!st || !st.isFile() || st.size > 16 * 1024) throw new Error(`${from} is missing or not a small key file.`);
  if (existsSync(target)) {
    if (!readFileSync(target).equals(readFileSync(src))) throw new Error(`${target} exists and differs; move it aside deliberately first.`);
    return { service, file, installed: false, reason: "already identical" };
  }
  const owner = statSync(dir);
  copyFileSync(src, target);
  chmodSync(target, 0o600);
  chownSync(target, owner.uid, owner.gid);
  return { service, file, installed: true, restartNeeded: service };
}

// Root: set allowlisted, non-secret runtime.env keys (paths, account ids read
// from a key file's public fields). Restart or redeploy the service afterwards.
function writeRuntimeEnv({ service, file, entries }) {
  const values = {};
  for (const e of entries) {
    if (e.value !== undefined) values[e.key] = e.value;
    else {
      const key = JSON.parse(readFileSync(join(KEYS, e.fromKey.slice(".data/".length)), "utf8"));
      if (typeof key[e.field] !== "string") throw new Error(`${e.fromKey} has no ${e.field}.`);
      values[e.key] = key[e.field];
    }
  }
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  mkdirSync(dirname(file), { recursive: true });
  if (before) copyFileSync(file, `${file}.before-${tag()}`);
  writeFileSync(`${file}.tmp`, applyRuntimeEnv(before, values), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  return { service, file, keys: Object.keys(values), restartNeeded: service };
}

// --- tick ---------------------------------------------------------------------
function tick() {
  const state = loadState();
  try {
    git(["fetch", "--quiet", "--prune", "origin", `+refs/heads/${DEPLOY_BRANCH}:refs/remotes/origin/${DEPLOY_BRANCH}`, `+refs/heads/${MAIN_BRANCH}:refs/remotes/origin/${MAIN_BRANCH}`]);
    if (selfUpdate(state)) {
      saveState(state);
      publish(state);
      return; // the next tick runs the updated runner
    }
    const head = git(["rev-parse", `origin/${DEPLOY_BRANCH}`]);
    state.deploy.head = head;
    if (ENABLED) deploy(state, head);
    queueOps(state, head);
    state.runner.error = null;
  } catch (e) {
    state.runner = { ...state.runner, error: `${e.message}\n${e.log || ""}`.slice(0, 4000), errorAt: now() };
  }
  saveState(state);
  publish(state);
}

const [command, ...rest] = process.argv.slice(2);
if (process.getuid?.() !== 0) throw new Error("The release runner runs as root (it drops to questlayer-release for repository code).");
if (command === "tick") tick();
else if (command === "run-op") runOp(rest[0], rest[1]);
else if (command === "status") console.log(readFileSync(join(STATUS_DIR, "status.json"), "utf8"));
else {
  console.error("Usage: release-runner.mjs tick | run-op <id> <sha> | status");
  process.exit(2);
}

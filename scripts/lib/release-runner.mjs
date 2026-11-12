// Pure parts of the VPS release runner (docs/VPS-RELEASE-RUNNER.md): operation
// validation against the allowlist, the commands an operation runs, log
// scrubbing and key-install checks. No IO, so tests/release-runner.test.mjs
// covers every refusal. The runner itself is scripts/release-runner.mjs.

export const OP_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const SHA = /^[0-9a-f]{40}$/;
export const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const ARG = /^[A-Za-z0-9._,:=/@+-]{1,200}$/;
const REPO_PATH = /^(?!\/)(?!.*\.\.)(?!\.data\/)[A-Za-z0-9._/-]{1,200}$/;
const KEY_FILE = /^[A-Za-z0-9._-]{1,100}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export class RunnerError extends Error {
  constructor(message) {
    super(message);
    this.code = "RELEASE_RUNNER";
  }
}
const refuse = (message) => {
  throw new RunnerError(message);
};

// Arguments or environment that could point a script at mainnet are refused
// outright: the runner is testnet only and never holds a mainnet key.
function assertTestnet(args, env) {
  for (const a of args)
    if (/mainnet|\.near$/i.test(a)) refuse(`Argument "${a}" is not allowed: testnet only.`);
  for (const [k, v] of Object.entries(env))
    if (/mainnet|\.near$/i.test(String(v)) || /MAINNET/.test(k))
      refuse(`Environment ${k} is not allowed: testnet only.`);
}

// op = deploy/ops/<id>.json on the deploy branch. allowlist =
// deploy/release-ops-allowlist.json as installed on the VPS (from main).
export function validateOp(op, allowlist, fileId) {
  if (!op || typeof op !== "object" || Array.isArray(op)) refuse("Operation must be a JSON object.");
  const known = new Set(["id", "script", "args", "env", "ref", "sha", "wasm", "outputs", "installKeys", "runtimeEnv", "deployTarget", "note"]);
  for (const k of Object.keys(op)) if (!known.has(k)) refuse(`Unknown field "${k}".`);
  if (!OP_ID.test(op.id || "")) refuse("id must be 3-64 characters of a-z, 0-9 and -.");
  if (fileId !== undefined && fileId !== op.id) refuse(`File name ${fileId}.json does not match id ${op.id}.`);
  if (op.deployTarget !== undefined) {
    if (!allowlist.deployTargets?.[op.deployTarget] || /mainnet/i.test(op.deployTarget)) refuse(`Deploy target ${op.deployTarget} is not allowlisted.`);
    if (op.script !== undefined || op.args !== undefined || op.env !== undefined || op.wasm !== undefined) refuse("A deploy job runs no script.");
  }
  const rule = op.deployTarget !== undefined ? { execute: null } : allowlist.scripts?.[op.script];
  if (!rule) refuse(`Script ${op.script} is not in the runner allowlist.`);
  const args = op.args ?? [];
  if (!Array.isArray(args) || args.length > 20 || !args.every((a) => typeof a === "string" && ARG.test(a)))
    refuse("args must be up to 20 plain strings.");
  if (args.includes(rule.execute || "--execute")) refuse("Do not pass the execute flag; the runner adds it after the plan.");
  const env = op.env ?? {};
  if (typeof env !== "object" || Array.isArray(env)) refuse("env must be an object.");
  for (const [k, v] of Object.entries(env)) {
    if (!(rule.env || []).includes(k)) refuse(`Environment ${k} is not allowed for ${op.script}.`);
    if (typeof v !== "string" || !ARG.test(v)) refuse(`Environment ${k} must be a plain string.`);
  }
  assertTestnet(args, env);
  if (op.ref !== undefined && !BRANCH.test(op.ref)) refuse("ref must be a branch name.");
  if (op.sha !== undefined && !SHA.test(op.sha)) refuse("sha must be a full 40-character commit id.");
  if (op.ref !== undefined && op.sha === undefined) refuse("An operation on another branch must pin its sha.");
  if (op.wasm !== undefined) {
    if (!REPO_PATH.test(op.wasm.path || "") || !op.wasm.path.endsWith(".wasm")) refuse("wasm.path must be a repository .wasm path.");
    if (!HEX64.test(op.wasm.sha256 || "")) refuse("wasm.sha256 must be 64 hex characters.");
  }
  if (rule.wasm && op.wasm === undefined) refuse(`${op.script} upgrades a contract; name the reviewed wasm and its sha256.`);
  const outputs = op.outputs ?? [];
  if (!Array.isArray(outputs) || outputs.length > 30 || !outputs.every((p) => typeof p === "string" && REPO_PATH.test(p)))
    refuse("outputs must be up to 30 repository paths outside .data/.");
  const installKeys = op.installKeys ?? [];
  if (!Array.isArray(installKeys) || installKeys.length > 16) refuse("installKeys must be a list of up to 16.");
  for (const item of installKeys) keyInstallTarget(item, allowlist);
  const runtimeEnv = op.runtimeEnv === undefined ? null : runtimeEnvPlan(op.runtimeEnv, allowlist);
  return {
    id: op.id,
    script: op.script,
    args,
    env,
    ref: op.ref ?? null,
    sha: op.sha ?? null,
    wasm: op.wasm ?? null,
    outputs,
    installKeys,
    runtimeEnv,
    execute: rule.execute === null ? null : rule.execute || "--execute",
    deployTarget: op.deployTarget ?? null,
    note: typeof op.note === "string" ? op.note.slice(0, 300) : "",
  };
}

// Commands for a validated op, run as the unprivileged release user in the
// op's own checkout. A script with an execute flag runs once read-only first.
export function opCommands(op) {
  const base = ["node", op.script, ...op.args];
  return op.execute === null
    ? [{ step: "execute", argv: base }]
    : [
        { step: "plan", argv: base },
        { step: "execute", argv: [...base, op.execute] },
      ];
}

// A key file the op wrote under .data/ (a relative path, e.g.
// testlayer/work/.data/relayer-testnet.json) goes to one of the allowlisted
// service state directories as `to` (default: its own name).
export function keyInstallTarget(item, allowlist) {
  if (!item || typeof item !== "object") refuse("installKeys entries must be objects.");
  const parts = String(item.file || "").split("/");
  if (parts.length > 6 || !parts.every((x) => KEY_FILE.test(x) && x !== "." && x !== ".."))
    refuse("installKeys.file must be a relative path under .data/.");
  const to = item.to ?? parts[parts.length - 1];
  if (!KEY_FILE.test(to) || !/\.(json|pem)$/.test(to)) refuse("installKeys.to must be a plain .json or .pem file name.");
  const dir = allowlist.keyDirs?.[item.service];
  if (!dir) refuse(`Service ${item.service} has no allowlisted key directory.`);
  if (/mainnet/i.test(item.file) || /mainnet/i.test(to) || /mainnet/i.test(item.service)) refuse("Mainnet keys are never installed by the runner.");
  return { from: `.data/${parts.join("/")}`, dir, file: to, service: item.service };
}

// runtimeEnv: { service, set: { KEY: "value" | { fromKey: "<.data path>", field: "accountId" } } }.
// Only keys allowlisted for that service, non-secret values (paths, account ids).
export function runtimeEnvPlan(spec, allowlist) {
  if (!spec || typeof spec !== "object") refuse("runtimeEnv must be an object.");
  const rule = allowlist.runtimeEnv?.[spec.service];
  if (!rule) refuse(`Service ${spec.service} has no allowlisted runtime.env.`);
  const set = spec.set;
  if (!set || typeof set !== "object" || Array.isArray(set)) refuse("runtimeEnv.set must be an object.");
  const entries = [];
  for (const [k, v] of Object.entries(set)) {
    if (!rule.keys.includes(k)) refuse(`runtime.env ${k} is not allowlisted for ${spec.service}.`);
    if (typeof v === "string") {
      if (!ARG.test(v) || /mainnet|\.near$/i.test(v)) refuse(`runtime.env ${k} must be a plain testnet value.`);
      entries.push({ key: k, value: v });
    } else {
      const parts = String(v?.fromKey || "").split("/");
      if (!parts.every((x) => KEY_FILE.test(x) && x !== "." && x !== "..")) refuse(`runtime.env ${k}.fromKey must be a path under .data/.`);
      if (!["accountId", "publicKey"].includes(v.field)) refuse(`runtime.env ${k}.field must be accountId or publicKey.`);
      entries.push({ key: k, fromKey: `.data/${parts.join("/")}`, field: v.field });
    }
  }
  return { service: spec.service, file: rule.file, entries };
}

// Rewrites only the given keys in a runtime.env text; other lines stay.
export function applyRuntimeEnv(text, values) {
  const lines = String(text || "").split("\n").filter((l, i, a) => !(i === a.length - 1 && l === ""));
  for (const [k, v] of Object.entries(values)) {
    if (/[\n\r]/.test(v) || /mainnet|\.near$/i.test(v)) refuse(`runtime.env ${k} value refused.`);
    const at = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (at >= 0) lines[at] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  return lines.join("\n") + "\n";
}

// Private keys never leave the VPS, also not through a log line.
export function scrub(text) {
  return String(text)
    .replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/g, "ed25519:[redacted]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/("(?:secretKey|secret_key|private_key|privateKey)"\s*:\s*)"[^"]*"/g, '$1"[redacted]"');
}

export function tail(text, lines = 200) {
  const all = String(text).split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

// deploy/pin.json: { "release": "20261112T001500Z" } pins the live release to
// an earlier one ("vrať to"); an empty object or no file means "follow HEAD".
export function parsePin(text) {
  if (!text) return null;
  const pin = JSON.parse(text);
  if (!pin || typeof pin !== "object") refuse("pin.json must be an object.");
  if (pin.release === undefined || pin.release === null || pin.release === "") return null;
  if (!/^\d{8}T\d{6}Z$/.test(pin.release)) refuse("pin.json release must be a release tag like 20261112T001500Z.");
  return pin.release;
}

// The files deploy-vps.sh packs into a release archive.
export const RELEASE_FILES = [
  "build-id.txt",
  "dist",
  "server",
  "package.json",
  "package-lock.json",
  "deploy/questlayer-hackathon.service",
  "deploy/retain-static-assets.py",
  "scripts/poi",
  "scripts/treasury-worker-vps.sh",
  "scripts/stnear-treasury-testnet.mjs",
  "scripts/treasury-mix-testnet.mjs",
  "scripts/treasury-dao-testnet.mjs",
];

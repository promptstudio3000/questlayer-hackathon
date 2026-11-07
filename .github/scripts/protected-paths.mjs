#!/usr/bin/env node
// Protected-paths guard for pull requests (docs/HANDOFF-WEEKEND.md).
//
// Fails when a pull request changes contracts, deploy and signing scripts,
// chain/money server code, economy numbers, deployment records, CI or
// dependencies, unless the owner added the `owner-approved` label. Also fails
// when added lines look like a private key or a secret file is committed.
//
// Pull requests from `claude/` branches are the owner's Claude project threads,
// which work under the owner's standing rules; they skip the path rule but not
// the secret scan. The branch name is a convention, not an identity, so the
// guard's own files, CI and agent rules are never exempt: changing them always
// needs the owner's label.
//
// CI runs this script from the BASE commit (guard.yml, pull_request_target),
// so a pull request cannot weaken the guard that checks it.
//
// Usage (CI sets these):
//   BASE_SHA=<base> HEAD_SHA=<head> HEAD_REF=<branch> PR_LABELS='["a","b"]' \
//     node .github/scripts/protected-paths.mjs
// Local check before opening a PR:
//   node .github/scripts/protected-paths.mjs --base origin/claude/upbeat-gauss-5czir7

import { execFileSync } from "node:child_process";

const APPROVAL_LABEL = "owner-approved";
const EXEMPT_BRANCH_PREFIX = "claude/";

// Each rule: a test on the repo-relative path and the reason shown on failure.
// Paths that need the label even on `claude/` branches.
const NEVER_EXEMPT = (p) =>
  p.startsWith(".github/") || ["AGENTS.md", "GEMINI.md", "CLAUDE.md", "docs/HANDOFF-WEEKEND.md"].includes(p);

const RULES = [
  [(p) => p.startsWith("contracts/") || p === "rust-toolchain.toml", "smart contracts, WASM hashes and the Rust toolchain"],
  [(p) => p.startsWith(".github/"), "CI workflows, this guard and CODEOWNERS"],
  [(p) => ["AGENTS.md", "GEMINI.md", "CLAUDE.md", "docs/HANDOFF-WEEKEND.md"].includes(p), "agent rules and the hand-off"],
  [(p) => p.startsWith("deploy/"), "VPS service units and backups"],
  [(p) => p === "package.json" || p === "package-lock.json", "dependencies and npm scripts"],
  [
    (p) =>
      /^scripts\/(deploy-|upgrade-|install-|migrate-|bootstrap-|build-contracts|prove-|verify-|topup-)/.test(p) ||
      /^scripts\/.*(testnet|mainnet|operator|wasm).*$/.test(p) ||
      p.startsWith("scripts/lib/") ||
      p === "scripts/check-bundle-budget.mjs" ||
      p === "scripts/wiki-check.mjs",
    "deploy, signing, chain and budget scripts",
  ],
  [
    (p) =>
      /^server\/(native|payouts|qgold|relayer|market|chain-ledger|identity|creators|map-rewards|gold-spend|operator)\//.test(p) ||
      /^server\/(fair-play|http-security|staker-gates|levels|near-provider|state-path|database)\.mjs$/.test(p),
    "chain, money, identity and anti-cheat server code",
  ],
  [
    (p) =>
      // Sessions, sign-in and account management live in the main API file.
      p === "server/index.mjs" ||
      /^server\/signing-vault[^/]*\.mjs$/.test(p) ||
      p === "signing-vault.html" ||
      p.startsWith("src/signing-vault/") ||
      /^src\/(player-key|native-signer|order-signers|qgold-burn|account-recovery|relayed-native-transaction|self-paid-native-transaction|confirmed-native-transaction)\.ts$/.test(p),
    "sign-in, sessions, device keys and transaction signing",
  ],
  [
    (p) => /^server\/data\/(level-table|staker-gates|gold-spend|aura-catalog|cities|place-badges)\.json$/.test(p),
    "economy and reward numbers",
  ],
  [(p) => /^public\/.*(native-|testnet|mainnet|proof|deployment).*\.json$/.test(p), "on-chain deployment records and proofs"],
];

// Files that must never be committed by anyone.
const FORBIDDEN_FILES = [
  /(^|\/)runtime\.env$/,
  /(^|\/)\.env(\.|$)(?!example$)/,
  /(^|\/)\.data\//,
  /(^|\/)\.near-credentials\//,
  /(^|\/)held-keys\//,
  /\.(pem|key)$/,
  /\.sqlite(-.*)?$/,
];

// Added lines that look like secrets. NEAR private keys are `ed25519:` + ~88
// base58 chars (public keys are ~44, so they pass).
const SECRET_PATTERNS = [
  [/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/, "NEAR private key"],
  [/"(private_key|secret_key)"\s*:\s*"[^"]{20,}"/, "private key field"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
  [/\bsk-[A-Za-z0-9_-]{32,}/, "API key (sk-...)"],
  [/\b(OLLAMA_API_KEY|NEAR_AI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*=\s*['"]?[A-Za-z0-9._-]{16,}/, "API key assignment"],
];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const argBase = process.argv.indexOf("--base");
const base = argBase > 0 ? process.argv[argBase + 1] : process.env.BASE_SHA;
const head = process.env.HEAD_SHA || "HEAD";
if (!base) {
  console.error("Set BASE_SHA or pass --base <ref>.");
  process.exit(2);
}
const headRef = process.env.HEAD_REF || git("rev-parse", "--abbrev-ref", "HEAD").trim();
let labels = [];
try {
  labels = JSON.parse(process.env.PR_LABELS || "[]");
} catch {
  labels = [];
}

const range = `${base}...${head}`;
const changed = git("diff", "--name-only", "--no-renames", range).split("\n").filter(Boolean);
const renamedFrom = git("diff", "--name-status", "-M", range)
  .split("\n")
  .filter((l) => l.startsWith("R"))
  .map((l) => l.split("\t")[1]);
const paths = [...new Set([...changed, ...renamedFrom])];

const problems = [];

for (const p of paths) {
  if (FORBIDDEN_FILES.some((re) => re.test(p))) problems.push(`${p}: secret or state file, never commit it`);
}

const added = git("diff", "--unified=0", "--no-color", range)
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
for (const line of added) {
  for (const [re, what] of SECRET_PATTERNS) {
    if (re.test(line)) problems.push(`added line looks like a ${what}: ${line.slice(0, 60)}…`);
  }
}

const exemptBranch = headRef.startsWith(EXEMPT_BRANCH_PREFIX);
const approved = labels.includes(APPROVAL_LABEL);
const protectedHits = [];
let touchesNeverExempt = false;
for (const p of paths) {
  const rule = RULES.find(([test]) => test(p));
  if (rule) protectedHits.push(`${p}  (${rule[1]})`);
  if (NEVER_EXEMPT(p)) touchesNeverExempt = true;
}
const exempt = exemptBranch && !touchesNeverExempt;

console.log(`Branch ${headRef}, ${paths.length} changed files, labels: ${labels.join(", ") || "none"}.`);
if (protectedHits.length) {
  console.log(`\nProtected paths touched:\n  ${protectedHits.join("\n  ")}`);
  if (approved) console.log(`\nLabel "${APPROVAL_LABEL}" present: allowed by the owner.`);
  else if (exempt) console.log(`\n(${EXEMPT_BRANCH_PREFIX} branch: owner's Claude thread, path rule skipped.)`);
  else
    problems.push(
      `this PR changes protected paths. Only the owner may allow that by adding the "${APPROVAL_LABEL}" label. ` +
        `Agents: revert these files, or stop and ask the owner. See docs/HANDOFF-WEEKEND.md.`,
    );
}

if (problems.length) {
  console.error(`\nProtected-paths guard failed:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log("\nProtected-paths guard OK.");

// Local-only MetaLayer preview, with an explicit environment allowlist and
// loopback-only server fetch. No developer .env, signer or public RPC is used.
// Build first, then: node scripts/preview-metalayer.mjs [--state-dir <own temp directory>]
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === "--state-dir"), "Use --state-dir only for this preview's own temporary state.");
assert(!existsSync(join(root, ".env")), "Use a checkout without developer runtime configuration.");
assert(existsSync(join(root, "dist/index.html")), "Build the app before starting its preview.");
const temporaryRoot = realpathSync(tmpdir());
const state = args.length ? realpathSync(args[1]) : mkdtempSync(join(temporaryRoot, "metalayer-local-preview-"));
assert(state.startsWith(temporaryRoot + sep) && dirname(state) === temporaryRoot && /metalayer-local-preview-[\w-]+$/.test(state),
  "Reuse only this preview's own temporary directory.");
const guard = join(state, "loopback.mjs");
writeFileSync(guard, `const original=globalThis.fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))return Promise.reject(Error('Local preview permits loopback only'));return original(input,options);};`);
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: {
    PATH: dirname(process.execPath) + ":/usr/bin:/bin", PORT: "7099", HOST: "127.0.0.1",
    APP_ORIGIN: "http://127.0.0.1:7099", DATABASE_PATH: join(state, "preview.sqlite"),
    DISABLE_NATIVE_ATTESTATIONS: "1", DISABLE_BACKGROUND_WORKERS: "1", DISABLE_RELAYER: "1",
    NPC_TRADER_ENABLED: "0", QGOLD_KEEPER_ENABLED: "0", QGOLD_KEEPER_EXECUTE: "0",
    NEAR_RPC_URL: "http://127.0.0.1:9", NODE_ENV: "test", LAYER_ENABLED: "1", NODE_OPTIONS: `--import=${guard}`,
  }, stdio: ["ignore", "inherit", "inherit"],
});
console.log("MetaLayer preview: http://127.0.0.1:7099/?lang=cs");
console.log("Temporary preview state:", state);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill("SIGTERM"));
child.on("exit", code => process.exit(code ?? 0));

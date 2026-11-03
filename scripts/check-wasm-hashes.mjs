// Checks the contract WASM in contracts/target against every pinned sha256:
//   1. contracts/wasm-sha256.json            (all contracts, reproducible Docker build)
//   2. contracts/collectibles/WASM_SHA256 and the last reviewed hash in
//      docs/COLLECTIBLES-REVIEW.md          (the reviewed collectibles build)
//   3. every *wasmSha256 in public/native-*-testnet.json: it must equal a current
//      build, or be listed with that exact hash under testnetDeploymentsNotFromThisBuild.
//      public/native-*-mainnet.json records must equal a current build, no exceptions.
//      A sibling codeHash (base58 of the same sha256) must agree with it.
// `--write` records the current build in contracts/wasm-sha256.json (it never touches
// the reviewed collectibles hash, which needs a review). Writes SHA256SUMS next to the WASM.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const wasmDir = process.env.WASM_DIR || "contracts/target/wasm32-unknown-unknown/release";
const manifestPath = "contracts/wasm-sha256.json";
const reviewedPath = "contracts/collectibles/WASM_SHA256";
const reviewDocPath = "docs/COLLECTIBLES-REVIEW.md";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const errors = [];

const built = {};
for (const file of readdirSync(wasmDir).filter((f) => f.endsWith(".wasm")).sort()) {
  const bytes = readFileSync(join(wasmDir, file));
  built[file.replace(/\.wasm$/, "")] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
}
writeFileSync(
  join(wasmDir, "SHA256SUMS"),
  Object.entries(built).map(([n, b]) => `${b.sha256}  ${n}.wasm\n`).join(""),
);

if (process.argv.includes("--write")) {
  manifest.contracts = Object.fromEntries(Object.entries(built).map(([n, b]) => [n, b.sha256]));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`recorded ${Object.keys(built).length} hashes in ${manifestPath}`);
}

// 1. Every contract matches the reproducible build manifest.
for (const name of new Set([...Object.keys(manifest.contracts), ...Object.keys(built)])) {
  const want = manifest.contracts[name];
  const got = built[name]?.sha256;
  const line = `${name.padEnd(26)} ${got ?? "(not built)"} ${built[name] ? built[name].size + " B" : ""}`;
  if (want === got) console.log(`ok   ${line}`);
  else {
    console.log(`FAIL ${line}`);
    errors.push(`${name}: built ${got ?? "nothing"}, ${manifestPath} pins ${want ?? "nothing"}`);
  }
}

// 2. The reviewed collectibles build.
const collectibles = built.questlayer_collectibles?.sha256;
const reviewed = readFileSync(reviewedPath, "utf8").trim();
if (reviewed !== collectibles)
  errors.push(`${reviewedPath} pins ${reviewed}, build is ${collectibles} (contract changes need a new review)`);
const docHashes = readFileSync(reviewDocPath, "utf8").match(/\b[0-9a-f]{64}\b/g) ?? [];
const docLatest = docHashes.at(-1);
if (docLatest !== collectibles)
  errors.push(`${reviewDocPath} latest reviewed sha256 is ${docLatest}, build is ${collectibles}`);

// 3. Testnet deployment records.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(hex) {
  let n = BigInt("0x" + hex);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === "00"; i += 2) out = "1" + out;
  return out;
}
const byHash = new Map(Object.entries(built).map(([n, b]) => [b.sha256, n]));
const allowed = manifest.testnetDeploymentsNotFromThisBuild ?? {};
const seen = new Set();
function walk(file, node, path) {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const here = path ? `${path}.${key}` : key;
    if (/wasmsha256$/i.test(key) && typeof value === "string") {
      const id = `${file}:${here}`;
      seen.add(id);
      const codeKey = key.replace(/WasmSha256$/, "CodeHash").replace(/^wasmSha256$/, "codeHash");
      if (typeof node[codeKey] === "string" && node[codeKey] !== base58(value))
        errors.push(`${id}: ${codeKey} ${node[codeKey]} is not base58(${value})`);
      if (byHash.has(value)) console.log(`ok   ${id} = ${byHash.get(value)} (this build)`);
      else if (/-mainnet\.json$/.test(file))
        errors.push(`${id} pins ${value}: a mainnet record must be the reproducible build, never listed as older.`);
      else if (allowed[id]?.sha256 === value)
        console.log(`old  ${id} = ${allowed[id].contract}, deployed before this build (listed)`);
      else
        errors.push(
          `${id} pins ${value}, which is no current build and not listed under ` +
            `testnetDeploymentsNotFromThisBuild in ${manifestPath}. Deploy the Docker/CI build ` +
            "(macOS builds hash differently) or list the record on purpose.",
        );
    } else walk(file, value, here);
  }
}
// Mainnet records (written by scripts/deploy-mainnet-slice.mjs) must always be this build.
for (const file of readdirSync("public").filter((f) => /^native-.*-(testnet|mainnet)\.json$/.test(f)).sort())
  walk(`public/${file}`, JSON.parse(readFileSync(`public/${file}`, "utf8")), "");
for (const id of Object.keys(allowed))
  if (id !== "about" && !seen.has(id)) errors.push(`${manifestPath} lists ${id}, which no longer exists`);

if (errors.length) {
  console.error(`\n${errors.length} WASM hash mismatch(es):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAll contract WASM hashes match their pins.");

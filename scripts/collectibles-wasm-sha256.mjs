// Prints the collectibles WASM sha256 and checks it against the reviewed value
// in contracts/collectibles/WASM_SHA256 (the value COLLECTIBLES_WASM_SHA256 takes
// for scripts/deploy-mainnet-slice.mjs). `--write` records a new reviewed build.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const wasmPath =
  "contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm";
const recordPath = "contracts/collectibles/WASM_SHA256";
const wasm = readFileSync(wasmPath);
const sha256 = createHash("sha256").update(wasm).digest("hex");
console.log(`questlayer_collectibles.wasm ${wasm.length} bytes sha256 ${sha256}`);
if (process.argv.includes("--write")) {
  writeFileSync(recordPath, sha256 + "\n");
  console.log(`recorded in ${recordPath}`);
} else {
  const recorded = readFileSync(recordPath, "utf8").trim();
  if (recorded !== sha256) {
    console.error(
      `Collectibles WASM is not the reviewed build: expected ${recorded}. ` +
        "If the contract changed on purpose, review it and run " +
        "`node scripts/collectibles-wasm-sha256.mjs --write`.",
    );
    process.exit(1);
  }
}

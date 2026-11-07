#!/usr/bin/env node
import { resolve } from "node:path";
import { prepareGlobalDay } from "../server/world-preparation/worker.mjs";

// Explicit local JSON inputs only. This command never opens runtime state or
// enables the live world, financial workers, environment files or chain access.
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (
    !["--snapshot", "--out", "--day"].includes(key) ||
    !args[i + 1] ||
    options[key]
  )
    throw Error(
      "Usage: node scripts/prepare-global-world.mjs --snapshot <snapshot.json> --out <isolated-output-dir> --day YYYY-MM-DD",
    );
  options[key] = args[i + 1];
}
if (!options["--snapshot"] || !options["--out"] || !options["--day"])
  throw Error(
    "--snapshot, --out and --day are all required; there are no production defaults.",
  );
try {
  const result = await prepareGlobalDay({
    snapshotFile: resolve(options["--snapshot"]),
    outputDir: resolve(options["--out"]),
    day: options["--day"],
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.state !== "content-prepared") process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

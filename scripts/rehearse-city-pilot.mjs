// Three-day city pilot rehearsal: backup, restore, native reconciliation after
// the restore and a worker takeover. No keys, no network; safe on a fresh clone.
import { writeFileSync } from "node:fs";
import { runCityPilot } from "../server/qa/city-pilot.mjs";
import { assert } from "../server/domain.mjs";
const args = process.argv.slice(2);
assert(
  !args.length || (args.length === 2 && args[0] === "--output" && args[1]),
  "Use [--output NEW_REPORT_JSON]. The pilot always creates its own temporary state.",
);
const report = await runCityPilot();
if (args.length)
  writeFileSync(args[1], JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
console.log(JSON.stringify(report, null, 2));

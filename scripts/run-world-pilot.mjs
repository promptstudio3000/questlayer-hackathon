import { writeFileSync } from "node:fs";
import { runWorldPilot } from "../server/qa/world-pilot.mjs";
import { assert } from "../server/domain.mjs";
const args = process.argv.slice(2);
assert(
  !args.length || (args.length === 2 && args[0] === "--output" && args[1]),
  "Use [--output NEW_REPORT_JSON]. The pilot always creates its own temporary state.",
);
const report = await runWorldPilot();
if (args.length)
  writeFileSync(args[1], JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
console.log(JSON.stringify(report, null, 2));

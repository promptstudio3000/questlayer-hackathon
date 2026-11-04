// Operator-only local command for world controls (W11). OS access to the
// protected database is the authority; there is no HTTP mutation route.
//
//   report  --database PATH [--chain]        world + treasury health (read only)
//   audit   --database PATH                  operator audit log (read only)
//   pause | resume                --database PATH --input FILE --apply
//   adjust | clear-adjustment     --database PATH --input FILE [--apply]
//   close-place | reopen-place    --database PATH --input FILE --apply
//
// adjust without --apply prints the zones the adjusted day would use and
// writes nothing. Input files carry the exact operation fields, including
// actor, operationId, reason and expectedVersion from the latest report.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../server/database.mjs";
import "../server/schema-catalog.mjs";
import { assert } from "../server/domain.mjs";
import { LIVE_CITIES } from "../server/spatial/city-pack.mjs";
import {
  changeDayAdjustment,
  changePlace,
  changeWorldPause,
  operatorAudit,
  worldHealthReport,
} from "../server/operator/world-controls.mjs";

const ACTIONS = {
  pause: "pause",
  resume: "resume",
  adjust: "set",
  "clear-adjustment": "clear",
  "close-place": "close",
  "reopen-place": "reopen",
};
const [command, ...args] = process.argv.slice(2),
  options = {};
assert(
  ["report", "audit", ...Object.keys(ACTIONS)].includes(command),
  `Use ${["report", "audit", ...Object.keys(ACTIONS)].join("|")} --database PATH [--input JSON_FILE --apply] [--chain].`,
);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  assert(
    ["--database", "--input", "--apply", "--chain"].includes(arg) &&
      !Object.hasOwn(options, arg),
    "Unknown or repeated operator option.",
  );
  options[arg] = ["--apply", "--chain"].includes(arg) ? true : args[++i];
  assert(options[arg], "Missing operator option value.");
}
assert(
  options["--database"] && existsSync(options["--database"]),
  "Select an existing database explicitly.",
);
const readOnly = command === "report" || command === "audit";
if (readOnly)
  assert(!options["--input"] && !options["--apply"], `${command} is read only.`);
else {
  assert(
    options["--input"] && statSync(options["--input"]).size <= 8192,
    "Mutation requires --input JSON_FILE (8 KB at most).",
  );
  assert(
    options["--apply"] === true || command === "adjust",
    "Review the report first, then add --apply.",
  );
}
assert(!options["--chain"] || command === "report", "--chain is for report.");

async function chainReader() {
  const [{ createNearProvider }, { NativeContractReader }, network] =
    await Promise.all([
      import("../server/near-provider.mjs"),
      import("../server/native/reader.mjs"),
      import("../server/native/network.mjs"),
    ]);
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        `../public/${network.manifestName("native-rewards")}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return new NativeContractReader(
    createNearProvider(process.env.NEAR_RPC_URL || network.DEFAULT_RPC),
    manifest.contractId,
  );
}

const db = readOnly
  ? new DatabaseSync(resolve(options["--database"]), { readOnly: true })
  : openDatabase(resolve(options["--database"]));
try {
  let result;
  if (command === "report")
    result = await worldHealthReport(db, {
      chain: options["--chain"] ? await chainReader() : null,
    });
  else if (command === "audit") result = operatorAudit(db, { limit: 100 });
  else {
    const input = JSON.parse(readFileSync(options["--input"], "utf8"));
    assert(
      input?.action === ACTIONS[command],
      `Input action must be "${ACTIONS[command]}" for ${command}.`,
    );
    const authority = { isOperator: () => true };
    if (command === "pause" || command === "resume")
      result = changeWorldPause(db, input, authority);
    else if (command === "adjust" || command === "clear-adjustment")
      result = await changeDayAdjustment(db, input, {
        ...authority,
        preview: options["--apply"] !== true,
      });
    else {
      const city = LIVE_CITIES.find((c) => c.id === input.cityId);
      assert(city, "Select a live city with cityId.");
      const { cityId, ...place } = input;
      result = changePlace(db, city, place, authority);
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}

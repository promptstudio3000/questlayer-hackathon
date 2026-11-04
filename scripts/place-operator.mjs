import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../server/database.mjs";
import "../server/schema-catalog.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { assert } from "../server/domain.mjs";
import {
  changeSystemPlace,
  placeSafetyAudit,
} from "../server/spatial/place-safety.mjs";
const [command, ...args] = process.argv.slice(2),
  options = {};
assert(
  ["audit", "close", "reopen"].includes(command),
  "Use audit|close|reopen --database PATH [--input JSON_FILE --apply].",
);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  assert(
    ["--database", "--input", "--apply"].includes(arg) &&
      !Object.hasOwn(options, arg),
    "Unknown or repeated operator option.",
  );
  options[arg] = arg === "--apply" ? true : args[++i];
  assert(options[arg], "Missing operator option value.");
}
assert(
  options["--database"] && existsSync(options["--database"]),
  "Select an existing database explicitly.",
);
if (command === "audit")
  assert(!options["--input"] && !options["--apply"], "Audit is read only.");
else
  assert(
    options["--input"] &&
      options["--apply"] === true &&
      statSync(options["--input"]).size <= 4096,
    "Mutation requires --input JSON_FILE and --apply.",
  );
const db =
  command === "audit"
    ? new DatabaseSync(resolve(options["--database"]), { readOnly: true })
    : openDatabase(resolve(options["--database"]));
try {
  const input =
    command === "audit"
      ? null
      : JSON.parse(readFileSync(options["--input"], "utf8"));
  if (input)
    assert(
      input.action === command,
      "Input action must match the selected command.",
    );
  const result =
    command === "audit"
      ? placeSafetyAudit(db)
      : changeSystemPlace(db, PLZEN, input, { isOperator: () => true });
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}

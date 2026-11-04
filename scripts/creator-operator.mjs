import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../server/database.mjs";
import "../server/schema-catalog.mjs";
import { createCreatorRuntime } from "../server/creators/runtime.mjs";
import { creatorAudit, creatorOperator } from "../server/creators/operator.mjs";
import { creatorAssert as fail } from "../server/creators/operations.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const [command, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  fail(
    ["--database", "--input", "--limit"].includes(args[i]) &&
      args[i + 1] &&
      !options[args[i]],
    "Use audit|review|resolve|suspend|review-report|review-completion --database PATH [--input JSON_FILE] [--limit 1..100].",
    "CREATOR_INPUT",
    400,
  );
  options[args[i]] = args[i + 1];
}
fail(
  [
    "audit",
    "review",
    "resolve",
    "suspend",
    "review-report",
    "review-completion",
  ].includes(command),
  "Choose audit, review, resolve, suspend or review-report.",
  "CREATOR_INPUT",
  400,
);
fail(
  options["--database"] && existsSync(options["--database"]),
  "Select an existing database explicitly with --database.",
  "CREATOR_INPUT",
  400,
);
const path = resolve(options["--database"]);
const db =
  command === "audit"
    ? new DatabaseSync(path, { readOnly: true })
    : openDatabase(path);
try {
  let result;
  if (command === "audit") {
    fail(
      !options["--input"],
      "Audit does not accept mutation input.",
      "CREATOR_INPUT",
      400,
    );
    result = creatorAudit(db, {
      limit: options["--limit"] === undefined ? 50 : Number(options["--limit"]),
    });
  } else {
    fail(
      options["--input"] && !options["--limit"],
      "Operator mutations require --input JSON_FILE and no --limit.",
      "CREATOR_INPUT",
      400,
    );
    const bytes = readFileSync(options["--input"]);
    fail(
      bytes.length <= 16384,
      "Operator input exceeds 16 KiB.",
      "CREATOR_INPUT",
      400,
    );
    const runtime = createCreatorRuntime(db, {
      drafts: false,
      origin: "http://localhost",
      authenticate: () => null,
    });
    result = creatorOperator(
      runtime.services,
      command,
      JSON.parse(bytes.toString("utf8")),
    );
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  db.close();
}

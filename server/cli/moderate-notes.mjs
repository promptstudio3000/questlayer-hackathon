// Operator-only local command. OS access to the protected database is required.
// There is deliberately no HTTP endpoint that accepts a claimed operator role.
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
// Load every module schema first: the live database holds tables that modules
// create lazily, and preflight rejects tables it does not know.
import "../schema-catalog.mjs";
import { openDatabase } from "../database.mjs";
import { SocialContent } from "../social-content.mjs";
import { assert } from "../domain.mjs";

const [command, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  assert(
    [
      "--database",
      "--operator",
      "--note",
      "--reason",
      "--state",
      "--apply",
    ].includes(name),
    "Unknown option.",
  );
  assert(!(name in options), "Repeated option.");
  if (name === "--apply") options[name] = true;
  else {
    assert(args[i + 1] && !args[i + 1].startsWith("--"), `Missing ${name}.`);
    options[name] = args[++i];
  }
}
assert(
  ["list", "hide", "restore", "dismiss"].includes(command),
  "Use list, hide, restore or dismiss with --database /absolute/existing.sqlite --operator NAME. Mutations also require --note ID --reason TEXT --apply.",
);
const path = options["--database"],
  operator = options["--operator"];
assert(
  typeof path === "string" && isAbsolute(path) && existsSync(path),
  "An existing absolute database path is required.",
);
assert(
  typeof operator === "string" && /^[A-Za-z0-9_.@-]{1,80}$/.test(operator),
  "Use an explicit operator audit name.",
);
if (command !== "list")
  assert(
    options["--apply"] && options["--note"] && options["--reason"],
    "Review the report first, then provide --note, --reason and --apply.",
  );
const db = openDatabase(path);
try {
  const social = new SocialContent(db, {
    authorizeOperator: (actor) => actor === operator,
  });
  const result =
    command === "list"
      ? social.reports(operator, {
          state: options["--state"] || "open",
          limit: 50,
        })
      : social.moderate(operator, {
          noteId: options["--note"],
          action: command,
          reason: options["--reason"],
        });
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}

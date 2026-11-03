// Operator previews of AI content. OS access to the protected database is the
// authority; there is deliberately no HTTP endpoint for these actions.
//
//   node server/cli/ai-operator.mjs preview-day --database /abs/db.sqlite --operator NAME --city plzen --day YYYY-MM-DD
//   node server/cli/ai-operator.mjs draft       --database ... --operator NAME --city plzen --candidate ID --template visit|trail|chest [--stops N] [--language en|cs] [--notes TEXT]
//   node server/cli/ai-operator.mjs list        --database ... --operator NAME [--state previewed|approved|rejected]
//   node server/cli/ai-operator.mjs decide      --database ... --operator NAME --proposal ID --action approve|reject --reason TEXT --apply
//   node server/cli/ai-operator.mjs audit       --database ... --operator NAME
//   node server/cli/ai-operator.mjs verify      --database ... --operator NAME
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
// Load every module schema first: the live database holds tables that modules
// create lazily, and preflight rejects tables it does not know.
import "../schema-catalog.mjs";
import { openDatabase } from "../database.mjs";
import { assert } from "../domain.mjs";
import { createAiOperations, verifyAiAudit } from "../ai/operations.mjs";

const COMMANDS = ["preview-day", "draft", "list", "decide", "audit", "verify"];
const [command, ...args] = process.argv.slice(2);
const options = {};
const allowed = [
  "--database", "--operator", "--city", "--day", "--candidate", "--template",
  "--stops", "--language", "--notes", "--state", "--proposal", "--action",
  "--reason", "--limit", "--apply",
];
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  assert(allowed.includes(name), `Unknown option ${name}.`);
  assert(!(name in options), "Repeated option.");
  if (name === "--apply") options[name] = true;
  else {
    assert(args[i + 1] !== undefined && !args[i + 1].startsWith("--"), `Missing ${name}.`);
    options[name] = args[++i];
  }
}
assert(COMMANDS.includes(command), `Use ${COMMANDS.join(", ")} with --database /absolute/existing.sqlite --operator NAME.`);
const path = options["--database"];
assert(typeof path === "string" && isAbsolute(path) && existsSync(path), "An existing absolute database path is required.");
if (command === "decide")
  assert(
    options["--apply"] && options["--proposal"] && options["--action"] && options["--reason"],
    "List proposals first, then provide --proposal, --action, --reason and --apply.",
  );
const db = openDatabase(path);
try {
  const ops = createAiOperations(db, { operator: options["--operator"] });
  let result;
  if (command === "preview-day")
    result = ops.previewDay({ cityId: options["--city"], day: options["--day"] });
  else if (command === "draft")
    result = await ops.proposeDraft({
      cityId: options["--city"],
      candidateId: options["--candidate"],
      template: options["--template"],
      ...(options["--stops"] ? { stops: Number(options["--stops"]) } : {}),
      ...(options["--language"] ? { language: options["--language"] } : {}),
      ...(options["--notes"] ? { notes: options["--notes"] } : {}),
    });
  else if (command === "list")
    result = ops.list({
      state: options["--state"],
      limit: options["--limit"] ? Number(options["--limit"]) : 50,
    });
  else if (command === "decide")
    result = ops.decide({
      proposalId: options["--proposal"],
      action: options["--action"],
      reason: options["--reason"],
    });
  else if (command === "audit") result = ops.audit();
  else result = { broken: verifyAiAudit(db) };
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}

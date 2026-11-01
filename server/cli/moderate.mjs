// Operator moderation queue for notes, records, creator quests and private
// task photo evidence. OS access to the protected database is the authority;
// there is deliberately no HTTP endpoint that accepts a claimed operator role.
//
//   node server/cli/moderate.mjs queue  --database /abs/db.sqlite --operator NAME [--state open|resolved] [--kind note,record,quest,evidence]
//   node server/cli/moderate.mjs decide --database ... --operator NAME --kind KIND --target ID --action hide|restore|dismiss|tombstone --reason TEXT --apply
//   node server/cli/moderate.mjs audit  --database ... --operator NAME [--kind KIND] [--target ID]
//   node server/cli/moderate.mjs verify --database ... --operator NAME
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { openDatabase } from "../database.mjs";
import { assert } from "../domain.mjs";
import { Moderation, MODERATION_KINDS } from "../moderation.mjs";
import { TaskEvidence } from "../task-evidence.mjs";
import { creatorConfiguration } from "../creators/runtime.mjs";
import { createCreatorServices } from "../creators/services.mjs";

const [command, ...args] = process.argv.slice(2);
const options = {};
const allowed = [
  "--database",
  "--operator",
  "--kind",
  "--target",
  "--action",
  "--reason",
  "--state",
  "--limit",
  "--evidence-dir",
  "--apply",
];
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  assert(allowed.includes(name), `Unknown option ${name}.`);
  assert(!(name in options), "Repeated option.");
  if (name === "--apply") options[name] = true;
  else {
    assert(args[i + 1] && !args[i + 1].startsWith("--"), `Missing ${name}.`);
    options[name] = args[++i];
  }
}
assert(
  ["queue", "decide", "audit", "verify"].includes(command),
  "Use queue, decide, audit or verify with --database /absolute/existing.sqlite --operator NAME.",
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
if (command === "decide")
  assert(
    options["--apply"] &&
      options["--kind"] &&
      options["--target"] &&
      options["--action"] &&
      options["--reason"],
    "Review the queue first, then provide --kind, --target, --action, --reason and --apply.",
  );
const db = openDatabase(path);
try {
  const config = creatorConfiguration();
  const creators = config.enabled
    ? createCreatorServices(db, {
        policy: config.policy,
        isModerator: (actor) => config.moderators.includes(actor),
        isCompletionAuthority: (actor) =>
          config.completionAuthorities.includes(actor),
      })
    : null;
  const moderation = new Moderation(db, {
    authorizeOperator: (actor) => actor === operator,
    creators,
    evidence: new TaskEvidence(db, {
      directory: options["--evidence-dir"] || ".data/evidence",
    }),
  });
  const limit = options["--limit"] ? Number(options["--limit"]) : 50;
  let result;
  if (command === "queue")
    result = moderation.queue(operator, {
      state: options["--state"] || "open",
      kinds: options["--kind"]
        ? options["--kind"].split(",")
        : MODERATION_KINDS,
      limit,
    });
  else if (command === "decide")
    result = await moderation.decide(operator, {
      kind: options["--kind"],
      targetId: options["--target"],
      action: options["--action"],
      reason: options["--reason"],
    });
  else if (command === "audit")
    result = moderation.audit(operator, {
      kind: options["--kind"],
      targetId: options["--target"],
      limit,
    });
  else {
    moderation.operator(operator);
    result = moderation.verifyAudit();
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
